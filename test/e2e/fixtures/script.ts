import type { StopReason, ToolCall } from '@earendil-works/pi-ai'

/** One content block of a scripted assistant message. */
export type ScriptedBlock =
  | { text: string }
  | { thinking: string }
  | { tool: string; args: ToolCall['arguments']; id?: string }

/** One scripted model response, consumed in order, one per model request. */
export type ScriptedResponse = {
  content: ScriptedBlock[]
  /** Defaults to `toolUse` when the message has a tool call, else `stop`. */
  stopReason?: StopReason
  errorMessage?: string
}

export type ScriptedModelScript = {
  model?: { contextWindow?: number; maxTokens?: number }
  responses: ScriptedResponse[]
}
