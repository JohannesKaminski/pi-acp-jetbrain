// pi extension loaded by the e2e harness. Registers pi-ai's faux provider as
// `scripted/scripted` and answers each model request with the next entry from
// the JSON script named by PI_ACP_E2E_SCRIPT. Also registers test-only tools that
// exercise pi's extension UI (e.g. `ask_user` → ctx.ui.input).
import { readFileSync } from 'node:fs'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
  type FauxContentBlock
} from '@earendil-works/pi-ai'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import type { ScriptedModelScript, ScriptedBlock } from './script.js'

function toBlock(block: ScriptedBlock): FauxContentBlock {
  if ('text' in block) return fauxText(block.text)
  if ('thinking' in block) return fauxThinking(block.thinking)
  return fauxToolCall(block.tool, block.args, block.id ? { id: block.id } : undefined)
}

export default function (pi: ExtensionAPI) {
  const path = process.env.PI_ACP_E2E_SCRIPT
  if (!path) throw new Error('PI_ACP_E2E_SCRIPT is not set')
  const script = JSON.parse(readFileSync(path, 'utf8')) as ScriptedModelScript

  const faux = fauxProvider({
    provider: 'scripted',
    models: [
      {
        id: 'scripted',
        reasoning: true,
        contextWindow: script.model?.contextWindow ?? 200_000,
        maxTokens: script.model?.maxTokens ?? 8_192
      }
    ]
  })

  faux.setResponses(
    script.responses.map(r =>
      fauxAssistantMessage(r.content.map(toBlock), {
        stopReason: r.stopReason ?? (r.content.some(b => 'tool' in b) ? 'toolUse' : 'stop'),
        errorMessage: r.errorMessage
      })
    )
  )

  pi.registerProvider(faux.provider)

  pi.registerTool({
    name: 'ask_user',
    label: 'Ask user',
    description: 'Ask the user for a line of text via the UI.',
    parameters: Type.Object({ question: Type.String() }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const answer = await ctx.ui.input(params.question, 'type here')
      return {
        content: [{ type: 'text', text: answer === undefined ? 'ANSWER:<none>' : `ANSWER:${answer}` }],
        details: undefined
      }
    }
  })

  // Tools that make pi emit session events the adapter forwards.
  const ok = (text: string) => ({ content: [{ type: 'text' as const, text }], details: undefined })
  pi.registerTool({
    name: 'rename_session',
    label: 'Rename session',
    description: 'Set the session name (emits session_info_changed).',
    parameters: Type.Object({ name: Type.String() }),
    async execute(_id, params) {
      pi.setSessionName(params.name)
      return ok('renamed')
    }
  })
  pi.registerTool({
    name: 'set_thinking',
    label: 'Set thinking',
    description: 'Set the thinking level (emits thinking_level_changed).',
    parameters: Type.Object({ level: Type.String() }),
    async execute(_id, params) {
      pi.setThinkingLevel(params.level as Parameters<typeof pi.setThinkingLevel>[0])
      return ok('thinking set')
    }
  })
  let failNextTurnEnd = false
  pi.registerTool({
    name: 'arm_extension_error',
    label: 'Arm extension error',
    description: 'Make this extension throw at the next turn end (emits extension_error).',
    parameters: Type.Object({}),
    async execute() {
      failNextTurnEnd = true
      return ok('armed')
    }
  })
  pi.on('turn_end', () => {
    if (!failNextTurnEnd) return
    failNextTurnEnd = false
    throw new Error('fixture extension failure')
  })
}
