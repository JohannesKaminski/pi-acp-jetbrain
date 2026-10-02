/**
 * Bundled pi extension for ACP client hints (pi-acp-jetbrain).
 *
 * Tells the model about client abilities that change how it should write, such as the
 * client rendering Mermaid diagrams. The adapter derives the hints from the client's
 * `initialize` capabilities and passes them in PI_ACP_CLIENT_HINTS (comma-separated);
 * this extension appends the matching guidance to the system prompt before each turn.
 *
 * Self-contained on purpose (no runtime imports): pi loads it from dist/ in real use
 * and from source in the e2e tests.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export const CLIENT_HINTS_ENV = 'PI_ACP_CLIENT_HINTS'

export type ClientHint = 'mermaid'

const HINT_TEXT: Record<ClientHint, string> = {
  mermaid:
    'The chat client renders Mermaid diagrams. When a diagram explains something better than prose (architecture, data flow, sequences, state machines), include it as a ```mermaid code block.'
}

export function parseClientHints(value: string | undefined): ClientHint[] {
  return (value ?? '')
    .split(',')
    .map(v => v.trim())
    .filter((v): v is ClientHint => Object.hasOwn(HINT_TEXT, v))
}

export default function clientHintsExtension(pi: ExtensionAPI): void {
  const hints = parseClientHints(process.env[CLIENT_HINTS_ENV])
  if (hints.length === 0) return
  const guidance = hints.map(hint => HINT_TEXT[hint]).join('\n')
  pi.on('before_agent_start', ((event: { systemPrompt: string }) => ({
    systemPrompt: `${event.systemPrompt}\n\n${guidance}`
  })) as never)
}
