import test from 'node:test'
import assert from 'node:assert/strict'
import { E2EClient } from './harness.js'

// Enough history for pi to find a compaction cut point (keepRecentTokens: 100).
const LONG_REPLY = 'lorem ipsum dolor sit amet '.repeat(100)

test('e2e: automatic overflow compaction is announced and the turn retries', async () => {
  const c = E2EClient.start({
    piSettings: { compaction: { keepRecentTokens: 100 } },
    script: {
      responses: [
        { content: [{ text: LONG_REPLY }] },
        // pi treats this provider error as a context overflow: compact, then retry.
        { content: [], stopReason: 'error', errorMessage: 'prompt is too long: 250000 tokens > 200000 maximum' },
        { content: [{ text: 'SUMMARY' }] },
        { content: [{ text: 'retried reply' }] }
      ]
    }
  })
  try {
    const { sessionId } = await c.newSession()
    assert.equal((await c.prompt(sessionId, 'hello')).stopReason, 'end_turn', c.stderrTail())

    const res = await c.prompt(sessionId, 'more')

    assert.equal(res.stopReason, 'end_turn', c.stderrTail())
    const text = c.agentText()
    assert.match(text, /Context window exceeded; compacting and retrying/)
    assert.match(text, /Compaction finished/)
    assert.match(text, /retried reply/)
    assert.ok(
      text.indexOf('Compaction finished') < text.indexOf('retried reply'),
      'compaction notice should precede the retried reply'
    )
  } finally {
    await c.close()
  }
})

test('e2e: /compact on a session too small to compact answers in the chat instead of failing', async () => {
  const c = E2EClient.start({ script: { responses: [] } })
  try {
    const { sessionId } = await c.newSession()
    const res = await c.prompt(sessionId, '/compact')

    assert.equal(res.stopReason, 'end_turn')
    assert.match(c.agentText(), /Nothing to compact yet; the session is too small\./)
  } finally {
    await c.close()
  }
})
