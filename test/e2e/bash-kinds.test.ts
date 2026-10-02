import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { E2EClient } from './harness.js'

test('e2e: simple read-only bash commands get the search or read kind; others stay execute', async () => {
  const commands = ['ls', 'grep -n TODO notes.txt', 'cat notes.txt', 'grep TODO notes.txt | wc -l', 'echo hi > out.txt']
  const c = E2EClient.start({
    script: {
      responses: [
        { content: commands.map(command => ({ tool: 'bash', args: { command } })) },
        { content: [{ text: 'ok' }] }
      ]
    }
  })
  try {
    writeFileSync(join(c.workspace, 'notes.txt'), 'TODO one\n')
    const { sessionId } = await c.newSession()
    assert.equal((await c.prompt(sessionId, 'go')).stopReason, 'end_turn')

    const kinds = c.updatesOf('tool_call').map(u => [u.title, u.kind])
    assert.deepEqual(kinds, [
      ['ls', 'search'],
      ['grep -n TODO notes.txt', 'search'],
      ['cat notes.txt', 'read'],
      ['grep TODO notes.txt | wc -l', 'execute'],
      ['echo hi > out.txt', 'execute']
    ])
    // Output still streams as a terminal for every bash call.
    assert.match(JSON.stringify(c.updatesOf('tool_call_update')), /TODO one/)

    await c.loadSession(sessionId)
    assert.deepEqual(
      c
        .updatesOf('tool_call')
        .slice(kinds.length)
        .map(u => [u.title, u.kind]),
      kinds
    )
  } finally {
    await c.close()
  }
})
