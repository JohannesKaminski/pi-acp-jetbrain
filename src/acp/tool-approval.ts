import type { PermissionOption, SessionConfigOption } from '@agentclientprotocol/sdk'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APPROVAL_ALLOW_ALWAYS,
  APPROVAL_ALLOW_ONCE,
  APPROVAL_REJECT,
  parseToolApprovalMode,
  type ToolApprovalMode
} from '../pi-extension/tool-approval.js'

// Adapter side of tool approval. The pi side (the tool_call hook) lives in
// src/pi-extension/tool-approval.ts, which every session's pi process loads.

export const TOOL_APPROVAL_CONFIG_ID = 'tool_approval'

const MODE_NAMES: Record<ToolApprovalMode, string> = {
  off: 'Off',
  edits: 'Ask for edits & commands',
  all: 'Ask for everything'
}

/** Default mode for new sessions: PI_ACP_TOOL_APPROVAL=off|edits|all (default off). */
export function defaultToolApprovalMode(): ToolApprovalMode {
  return parseToolApprovalMode(process.env.PI_ACP_TOOL_APPROVAL) ?? 'off'
}

export function toolApprovalConfigOption(mode: ToolApprovalMode): SessionConfigOption {
  return {
    type: 'select',
    id: TOOL_APPROVAL_CONFIG_ID,
    name: 'Tool approval',
    description:
      "Ask before pi runs tools. 'Ask for edits & commands' lets read-only tools (read, grep, find, ls) run without asking.",
    currentValue: mode,
    options: (Object.keys(MODE_NAMES) as ToolApprovalMode[]).map(value => ({ value, name: MODE_NAMES[value] }))
  }
}

export function toolApprovalPermissionOptions(toolName: string): PermissionOption[] {
  return [
    { optionId: APPROVAL_ALLOW_ONCE, name: 'Allow', kind: 'allow_once' },
    { optionId: APPROVAL_ALLOW_ALWAYS, name: `Always allow ${toolName} in this session`, kind: 'allow_always' },
    { optionId: APPROVAL_REJECT, name: 'Reject', kind: 'reject_once' }
  ]
}

let cachedExtensionPath: string | null | undefined
/** The approval extension: built JS next to dist/index.js, or the TS source when run via tsx. */
export function resolveToolApprovalExtensionPath(): string | null {
  if (cachedExtensionPath !== undefined) return cachedExtensionPath
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, 'pi-extension', 'tool-approval.js'),
    join(here, '..', 'pi-extension', 'tool-approval.ts')
  ]
  cachedExtensionPath = candidates.find(c => existsSync(c)) ?? null
  return cachedExtensionPath
}

/** Extensions for a session's pi process: tool approval first, then any bridge extension. */
export function sessionExtensionPaths(bridgePaths: string[] = []): string[] {
  const approval = resolveToolApprovalExtensionPath()
  return approval ? [approval, ...bridgePaths] : [...bridgePaths]
}
