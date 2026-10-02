/**
 * Bundled pi extension for ACP tool approval (pi-acp-jetbrain).
 *
 * pi has no approval step of its own. The adapter loads this extension into every pi
 * process and sets its mode with an internal command; with approval off (the default)
 * the hook returns immediately. When a tool needs approval, the extension asks through
 * pi's select dialog with a marked title carrying the real tool-call id; the adapter
 * turns that into an ACP session/request_permission attached to the tool call.
 *
 * Self-contained on purpose (no runtime imports): pi loads it from dist/ in real use
 * and from source in the e2e tests.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export type ToolApprovalMode = 'off' | 'edits' | 'all'

/** Internal command the adapter sends (as an RPC prompt) to set the mode. */
export const TOOL_APPROVAL_COMMAND = 'pi-acp-tool-approval'
/** Prefix of the select-dialog title that marks an approval request. */
export const TOOL_APPROVAL_MARKER = '\u0000pi-acp-tool-approval:'
export const APPROVAL_ALLOW_ONCE = 'allow_once'
export const APPROVAL_ALLOW_ALWAYS = 'allow_always'
export const APPROVAL_REJECT = 'reject'

// Tools that only read: never asked about in `edits` mode. Everything else (edit, write,
// bash, powershell, extension and IDE tools) can change state and is asked about.
const READ_ONLY_TOOLS = new Set(['read', 'grep', 'find', 'ls'])

export function parseToolApprovalMode(value: string | undefined): ToolApprovalMode | undefined {
  const v = value?.trim()
  return v === 'off' || v === 'edits' || v === 'all' ? v : undefined
}

export function needsApproval(mode: ToolApprovalMode, toolName: string): boolean {
  if (mode === 'off') return false
  if (mode === 'edits') return !READ_ONLY_TOOLS.has(toolName)
  return true
}

export type ToolApprovalRequest = { toolCallId: string; toolName: string }

export function encodeApprovalTitle(req: ToolApprovalRequest): string {
  return `${TOOL_APPROVAL_MARKER}${JSON.stringify(req)}`
}

export function decodeApprovalTitle(title: unknown): ToolApprovalRequest | null {
  if (typeof title !== 'string' || !title.startsWith(TOOL_APPROVAL_MARKER)) return null
  try {
    const req = JSON.parse(title.slice(TOOL_APPROVAL_MARKER.length)) as Partial<ToolApprovalRequest>
    return typeof req.toolCallId === 'string' && typeof req.toolName === 'string'
      ? { toolCallId: req.toolCallId, toolName: req.toolName }
      : null
  } catch {
    return null
  }
}

export default function toolApprovalExtension(pi: ExtensionAPI): void {
  let mode: ToolApprovalMode = 'off'
  // "Always allow" is per tool name and lasts for this pi process, i.e. this session.
  const alwaysAllowed = new Set<string>()

  pi.registerCommand(TOOL_APPROVAL_COMMAND, {
    description: 'pi-acp-jetbrain internal: set the tool approval mode (off | edits | all)',
    handler: async args => {
      mode = parseToolApprovalMode(args) ?? mode
    }
  })

  pi.on('tool_call', async (event, ctx) => {
    if (!needsApproval(mode, event.toolName) || alwaysAllowed.has(event.toolName)) return undefined

    const choice = await ctx.ui.select(
      encodeApprovalTitle({ toolCallId: event.toolCallId, toolName: event.toolName }),
      [APPROVAL_ALLOW_ONCE, APPROVAL_ALLOW_ALWAYS, APPROVAL_REJECT]
    )
    if (choice === APPROVAL_ALLOW_ALWAYS) {
      alwaysAllowed.add(event.toolName)
      return undefined
    }
    if (choice === APPROVAL_ALLOW_ONCE) return undefined
    // Rejected, dismissed, or the dialog failed: never run the tool without approval.
    return { block: true, reason: 'The user rejected this tool call.' }
  })
}
