import test from 'node:test'
import assert from 'node:assert/strict'
import { E2EClient } from './harness.js'
import type { ScriptedResponse } from './fixtures/script.js'

// Retries fire after 1 ms instead of pi's default 2 s backoff.
const FAST_RETRY = { retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 } }

async function runTurn(responses: ScriptedResponse[]) {
  const c = E2EClient.start({ piSettings: FAST_RETRY, script: { responses } })
  const { sessionId } = await c.newSession()
  return { c, result: c.prompt(sessionId, 'go') }
}

test('e2e: a response cut off by the token limit ends the turn with max_tokens', async () => {
  const { c, result } = await runTurn([{ content: [{ text: 'partial answer' }], stopReason: 'length' }])
  try {
    assert.equal((await result).stopReason, 'max_tokens')
    assert.match(c.agentText(), /partial answer/)
  } finally {
    await c.close()
  }
})

test('e2e: a non-retryable provider error fails the prompt with the provider message', async () => {
  const { c, result } = await runTurn([
    {
      content: [{ text: 'started' }],
      stopReason: 'error',
      errorMessage: 'insufficient_quota: You exceeded your current quota'
    }
  ])
  try {
    await assert.rejects(result, (err: Error) => {
      assert.match(err.message, /Internal error/)
      assert.match(err.message, /insufficient_quota: You exceeded your current quota/)
      return true
    })
    // Whatever streamed before the failure still reached the client.
    assert.match(c.agentText(), /started/)
    // The failure is also recorded in the chat, so it survives a reload (clients may show
    // the JSON-RPC error only transiently, e.g. IntelliJ's banner above the input box).
    assert.match(c.agentText(), /Request failed: insufficient_quota: You exceeded your current quota/)
  } finally {
    await c.close()
  }
})

test('e2e: an error pi retries successfully still ends the turn normally', async () => {
  const { c, result } = await runTurn([
    { content: [], stopReason: 'error', errorMessage: '503 service unavailable' },
    { content: [{ text: 'recovered' }] }
  ])
  try {
    assert.equal((await result).stopReason, 'end_turn')
    assert.match(c.agentText(), /recovered/)
  } finally {
    await c.close()
  }
})

test('e2e: a response pi aborts on its own ends the turn as cancelled', async () => {
  const { c, result } = await runTurn([{ content: [{ text: 'stopped early' }], stopReason: 'aborted' }])
  try {
    assert.equal((await result).stopReason, 'cancelled')
  } finally {
    await c.close()
  }
})
