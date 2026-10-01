// pi extension loaded by the e2e harness. Registers pi-ai's faux provider as
// `scripted/scripted` and answers each model request with the next entry from
// the JSON script named by PI_ACP_E2E_SCRIPT.
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
}
