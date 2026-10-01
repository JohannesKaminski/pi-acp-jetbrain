import test from 'node:test'
import assert from 'node:assert/strict'
import { E2EClient } from './harness.js'

test('e2e: usage_update after a turn carries context size and cumulative USD cost', async () => {
  const c = E2EClient.start({
    script: { model: { contextWindow: 100_000 }, responses: [{ content: [{ text: 'reply' }] }] }
  })
  try {
    const { sessionId } = await c.newSession()
    const res = await c.prompt(sessionId, 'hello')
    assert.equal(res.stopReason, 'end_turn')

    const last = c.updatesOf('usage_update').at(-1)
    assert.equal(last?.size, 100_000)
    assert.ok((last?.used ?? 0) > 0, 'context tokens reported')
    // pi-ai's faux provider always reports zero cost; non-zero amounts are covered by unit tests.
    assert.equal(last?.cost?.currency, 'USD')
    const responseCost = (res.usage?._meta as { piAcp?: { cost?: number } } | undefined)?.piAcp?.cost
    assert.equal(typeof responseCost, 'number')
    assert.equal(last?.cost?.amount, responseCost)
  } finally {
    await c.close()
  }
})
