import test from 'node:test'
import assert from 'node:assert/strict'
import { E2EClient } from './harness.js'

type Chunk = { sessionUpdate: string; messageId?: string; content: { text?: string } }

test('e2e: chunks carry one messageId per message; notices and replies get distinct ids', async () => {
  const c = E2EClient.start({
    piSettings: { retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 } },
    script: {
      responses: [
        { content: [{ thinking: 'pondering' }, { tool: 'bash', args: { command: 'true' } }] },
        // A retried error makes the adapter emit a "Retrying..." notice between replies.
        { content: [], stopReason: 'error', errorMessage: '503 service unavailable' },
        { content: [{ thinking: 'more thought' }, { text: 'final answer' }] }
      ]
    }
  })
  try {
    const { sessionId } = await c.newSession()
    assert.equal((await c.prompt(sessionId, 'go')).stopReason, 'end_turn')

    const chunks = [...c.wireUpdatesOf('agent_message_chunk'), ...c.wireUpdatesOf('agent_thought_chunk')] as Chunk[]
    assert.ok(chunks.length > 0)
    for (const ch of chunks) assert.equal(typeof ch.messageId, 'string', JSON.stringify(ch))

    const idOf = (re: RegExp) => chunks.find(ch => re.test(ch.content.text ?? ''))?.messageId
    const firstThought = idOf(/pondering/)
    const finalThought = idOf(/more thought/)
    const finalText = idOf(/final answer/)
    const notice = idOf(/Retrying/)

    assert.equal(finalThought, finalText, 'thinking and text of one reply share an id')
    assert.notEqual(firstThought, finalText, 'a new reply gets a new id')
    assert.ok(notice && notice !== firstThought && notice !== finalText, 'a notice is its own message')

    // Every chunk of the final reply's text uses that reply's id.
    const finalReply = chunks.filter(ch => ch.sessionUpdate === 'agent_message_chunk' && ch.messageId === finalText)
    assert.equal(finalReply.map(ch => ch.content.text).join(''), 'final answer')

    // session/load replays each stored message as its own message.
    const before = c.wireUpdates.length
    await c.loadSession(sessionId)
    const replayed = c.wireUpdates
      .slice(before)
      .map(n => n.update as unknown as Chunk)
      .filter(u => u.sessionUpdate === 'user_message_chunk' || u.sessionUpdate === 'agent_message_chunk')
    assert.ok(replayed.length >= 2, 'user prompt and assistant reply replayed')
    const ids = replayed.map(u => u.messageId)
    for (const id of ids) assert.equal(typeof id, 'string')
    assert.equal(new Set(ids).size, ids.length, 'each replayed message has its own id')
  } finally {
    await c.close()
  }
})
