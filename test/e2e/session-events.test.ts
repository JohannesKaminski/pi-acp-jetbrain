import test from 'node:test'
import assert from 'node:assert/strict'
import { E2EClient } from './harness.js'

test('e2e: pi session events reach the client: name, thinking level, extension errors', async () => {
  const c = E2EClient.start({
    script: {
      responses: [
        {
          content: [
            { tool: 'rename_session', args: { name: 'Refactor parser' } },
            { tool: 'set_thinking', args: { level: 'high' } },
            { tool: 'arm_extension_error', args: {} }
          ]
        },
        { content: [{ text: 'done' }] }
      ]
    }
  })
  try {
    const { sessionId } = await c.newSession()
    assert.equal((await c.prompt(sessionId, 'go')).stopReason, 'end_turn', c.stderrTail())

    // pi named the session: the chat title follows.
    const titles = c.updatesOf('session_info_update').map(u => u.title)
    assert.ok(titles.includes('Refactor parser'), `titles: ${JSON.stringify(titles)}`)

    // pi changed the thinking level on its own: the selector follows.
    const thought = c
      .updatesOf('config_option_update')
      .map(u => u.configOptions.find(o => o.id === 'thought_level')?.currentValue)
      .at(-1)
    assert.equal(thought, 'high')

    // A failing pi extension is visible instead of silent.
    assert.match(c.agentText(), /pi extension error.*scripted-model.*fixture extension failure/s)
  } finally {
    await c.close()
  }
})
