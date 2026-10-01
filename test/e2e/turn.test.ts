import test from 'node:test'
import assert from 'node:assert/strict'
import { E2EClient } from './harness.js'

test('e2e: a prompt with a bash tool call streams the tool and the reply, then ends the turn', async () => {
  const c = E2EClient.start({
    script: {
      responses: [
        { content: [{ tool: 'bash', args: { command: 'echo hi-from-tool' } }] },
        { content: [{ text: 'All done.' }] }
      ]
    }
  })
  try {
    const { sessionId } = await c.newSession()
    const res = await c.prompt(sessionId, 'run it')

    assert.equal(res.stopReason, 'end_turn', c.stderrTail())
    assert.match(c.agentText(), /All done\./)

    const [call] = c.updatesOf('tool_call')
    assert.equal(call?.kind, 'execute')
    assert.equal(call?.title, 'echo hi-from-tool')
    const updates = c.updatesOf('tool_call_update').filter(u => u.toolCallId === call?.toolCallId)
    assert.equal(updates.at(-1)?.status, 'completed')
    // Bash output streams as Zed terminal _meta rather than tool content.
    assert.match(JSON.stringify(updates), /hi-from-tool/)
  } finally {
    await c.close()
  }
})
