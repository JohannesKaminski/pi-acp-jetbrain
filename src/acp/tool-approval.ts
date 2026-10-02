import type { PermissionOption, SessionConfigOption } from '@agentclientprotocol/sdk'
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
