import test from 'node:test'
import assert from 'node:assert/strict'
import { E2EClient } from './harness.js'
import type { ScriptedModelScript } from './fixtures/script.js'

// The model calls the fixture's ask_user tool (pi ctx.ui.input), then replies.
const SCRIPT: ScriptedModelScript = {
  responses: [{ content: [{ tool: 'ask_user', args: { question: 'Commit message?' } }] }, { content: [{ text: 'ok' }] }]
}

function toolOutput(c: E2EClient): string {
  return JSON.stringify(c.updatesOf('tool_call_update'))
}

test('e2e: pi input requests use ACP elicitation when the client declares form support', async () => {
  const c = E2EClient.start({ script: SCRIPT, clientCapabilities: { elicitation: { form: {} } } })
  c.onElicitation = () => ({ action: 'accept', content: { value: 'fix: ship it' } })
  try {
    const { sessionId } = await c.newSession()
    assert.equal((await c.prompt(sessionId, 'commit')).stopReason, 'end_turn')

    assert.equal(c.elicitationRequests.length, 1)
    assert.equal(c.elicitationRequests[0]?.message, 'Commit message?')
    assert.match(toolOutput(c), /ANSWER:fix: ship it/)
  } finally {
    await c.close()
  }
})

test('e2e: without the elicitation capability the input request is cancelled without calling the client', async () => {
  const c = E2EClient.start({ script: SCRIPT })
  try {
    const { sessionId } = await c.newSession()
    assert.equal((await c.prompt(sessionId, 'commit')).stopReason, 'end_turn')

    assert.equal(c.elicitationRequests.length, 0)
    assert.match(c.agentText(), /not supported by this ACP client/)
    assert.match(toolOutput(c), /ANSWER:<none>/)
  } finally {
    await c.close()
  }
})
