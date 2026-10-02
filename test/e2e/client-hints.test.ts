import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { E2EClient } from './harness.js'
import type { ClientCapabilities } from '@agentclientprotocol/sdk'

async function systemPromptWith(clientCapabilities: ClientCapabilities): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'pi-acp-hints-'))
  const capture = join(dir, 'requests.jsonl')
  const c = E2EClient.start({
    clientCapabilities,
    env: { PI_ACP_E2E_CAPTURE: capture },
    script: { responses: [{ content: [{ text: 'ok' }] }] }
  })
  try {
    const { sessionId } = await c.newSession()
    await c.prompt(sessionId, 'explain the architecture')
    return (JSON.parse(readFileSync(capture, 'utf8').trim().split('\n')[0]!) as { systemPrompt: string }).systemPrompt
  } finally {
    await c.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

test('e2e: a client that renders Mermaid gets a system prompt hint; others do not', async () => {
  assert.match(await systemPromptWith({ _meta: { 'mermaid-rendering': true } }), /```mermaid/)
  assert.doesNotMatch(await systemPromptWith({}), /mermaid/i)
})
