import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { E2EClient } from './harness.js'

test('e2e: tool calls carry name, kind and a readable title for each pi built-in tool', async () => {
  const c = E2EClient.start({
    piSettings: { defaultTools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] },
    script: {
      responses: [
        {
          content: [
            { tool: 'read', args: { path: 'src/a.ts', offset: 2, limit: 2 } },
            { tool: 'grep', args: { pattern: 'TODO', path: 'src' } },
            { tool: 'find', args: { pattern: '*.ts' } },
            { tool: 'ls', args: { path: 'src' } },
            { tool: 'write', args: { path: 'src/b.ts', content: 'export {}\n' } },
            { tool: 'edit', args: { path: 'src/a.ts', edits: [{ oldText: 'two', newText: 'TWO' }] } },
            { tool: 'bash', args: { command: 'echo hi' } }
          ]
        },
        { content: [{ text: 'done' }] }
      ]
    }
  })
  try {
    mkdirSync(join(c.workspace, 'src'))
    writeFileSync(join(c.workspace, 'src', 'a.ts'), 'one\ntwo // TODO\nthree\nfour\n')

    const { sessionId } = await c.newSession()
    const res = await c.prompt(sessionId, 'look around')
    assert.equal(res.stopReason, 'end_turn')

    // Raw wire updates: what any client receives, whatever its SDK version.
    const toolCalls = () => c.wireUpdatesOf('tool_call').map(u => ({ name: u.name, kind: u.kind, title: u.title }))
    const live = toolCalls()
    assert.deepEqual(live, [
      { name: 'read', kind: 'read', title: 'Read src/a.ts (lines 2–3)' },
      { name: 'grep', kind: 'search', title: 'Search for "TODO" in src' },
      { name: 'find', kind: 'search', title: 'Find "*.ts"' },
      { name: 'ls', kind: 'search', title: 'List src' },
      { name: 'write', kind: 'edit', title: 'Write src/b.ts' },
      { name: 'edit', kind: 'edit', title: 'Edit src/a.ts' },
      { name: 'bash', kind: 'execute', title: 'echo hi' }
    ])

    // session/load replays history from pi's stored messages; the same details must come back.
    await c.loadSession(sessionId)
    assert.deepEqual(toolCalls().slice(live.length), live)
  } finally {
    await c.close()
  }
})
