import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { E2EClient } from './harness.js'
import type { ScriptedModelScript } from './fixtures/script.js'

const FS = { fs: { readTextFile: true, writeTextFile: true } }

function fileAccessOption(configOptions: Array<{ id: string; currentValue?: unknown }> | null | undefined) {
  return configOptions?.find(o => o.id === 'file_access')
}

// The model reads notes.txt, then edits it.
const READ_THEN_EDIT: ScriptedModelScript = {
  responses: [
    { content: [{ tool: 'read', args: { path: 'notes.txt' } }] },
    { content: [{ tool: 'edit', args: { path: 'notes.txt', edits: [{ oldText: 'unsaved', newText: 'EDITED' }] } }] },
    { content: [{ text: 'done' }] }
  ]
}

test('e2e: "Through the editor" reads unsaved editor text and writes edits to the editor, not the disk', async () => {
  const c = E2EClient.start({ clientCapabilities: FS, script: READ_THEN_EDIT })
  try {
    const file = join(c.workspace, 'notes.txt')
    writeFileSync(file, 'saved text on disk\n')
    c.editorFiles.set(file, 'unsaved text in the editor\n')

    // "Through the editor" is the default whenever the client supports fs reads and writes.
    const created = await c.newSession()
    assert.equal(fileAccessOption(created.configOptions)?.currentValue, 'editor')

    assert.equal((await c.prompt(created.sessionId, 'go')).stopReason, 'end_turn', c.stderrTail())

    const [readCall, editCall] = c.updatesOf('tool_call')
    const updatesFor = (id: string | undefined) => c.updatesOf('tool_call_update').filter(u => u.toolCallId === id)
    assert.match(JSON.stringify(updatesFor(readCall?.toolCallId)), /unsaved text in the editor/, 'read saw the editor')
    assert.equal(c.editorFiles.get(file), 'EDITED text in the editor\n', 'the edit went to the editor')
    assert.equal(readFileSync(file, 'utf8'), 'saved text on disk\n', 'the disk is untouched')
    assert.ok(c.fsRequests.some(r => r.op === 'write' && c.editorFiles.get(r.path) !== undefined))

    // The diff shows the editor's before/after text, not the stale disk content.
    const diff = updatesFor(editCall?.toolCallId)
      .flatMap(u => u.content ?? [])
      .find(item => item.type === 'diff')
    assert.ok(diff && diff.type === 'diff', 'edit has a structured diff')
    assert.equal(diff.oldText, 'unsaved text in the editor\n')
    assert.equal(diff.newText, 'EDITED text in the editor\n')
  } finally {
    await c.close()
  }
})

test('e2e: switching to "Disk" stops asking the editor', async () => {
  const c = E2EClient.start({ clientCapabilities: FS, script: READ_THEN_EDIT })
  try {
    const file = join(c.workspace, 'notes.txt')
    writeFileSync(file, 'unsaved? no, saved on disk\n')
    const { sessionId } = await c.newSession()
    const res = await c.conn.setSessionConfigOption({ sessionId, configId: 'file_access', value: 'disk' })
    assert.equal(fileAccessOption(res.configOptions)?.currentValue, 'disk')
    assert.equal((await c.prompt(sessionId, 'go')).stopReason, 'end_turn')
    assert.deepEqual(c.fsRequests, [])
    assert.equal(readFileSync(file, 'utf8'), 'EDITED? no, saved on disk\n')
  } finally {
    await c.close()
  }
})

test('e2e: without client fs support the file access option is not offered', async () => {
  const c = E2EClient.start({ script: { responses: [] } })
  try {
    const created = await c.newSession()
    assert.equal(fileAccessOption(created.configOptions), undefined)
    await assert.rejects(
      c.conn.setSessionConfigOption({ sessionId: created.sessionId, configId: 'file_access', value: 'editor' }),
      /unavailable/
    )
  } finally {
    await c.close()
  }
})

test('e2e: PI_ACP_FILE_ACCESS=disk keeps the disk as the default', async () => {
  const c = E2EClient.start({ clientCapabilities: FS, env: { PI_ACP_FILE_ACCESS: 'disk' }, script: READ_THEN_EDIT })
  try {
    const file = join(c.workspace, 'notes.txt')
    writeFileSync(file, 'unsaved on disk\n')
    c.editorFiles.set(file, 'unsaved in the editor\n')
    const created = await c.newSession()
    assert.equal(fileAccessOption(created.configOptions)?.currentValue, 'disk')
    assert.equal((await c.prompt(created.sessionId, 'go')).stopReason, 'end_turn')
    assert.deepEqual(c.fsRequests, [])
    assert.equal(readFileSync(file, 'utf8'), 'EDITED on disk\n')
  } finally {
    await c.close()
  }
})
