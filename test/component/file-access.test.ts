import test from 'node:test'
import assert from 'node:assert/strict'
import { PiAcpSession } from '../../src/acp/session.js'
import {
  FILE_ACCESS_COMMAND,
  decodeFileRequest,
  encodeFileRequest,
  parseFileAccessMode
} from '../../src/pi-extension/editor-files-protocol.js'
import { FakeAgentSideConnection, FakePiRpcProcess, asAgentConn } from '../helpers/fakes.js'

const FS = { fs: { readTextFile: true, writeTextFile: true } }
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

function makeSession(proc: FakePiRpcProcess, conn: FakeAgentSideConnection, clientCapabilities: object = FS) {
  ;(proc as any).getCommands = async () => ({ commands: [{ name: FILE_ACCESS_COMMAND, source: 'extension' }] })
  return new PiAcpSession({
    sessionId: 's1',
    cwd: process.cwd(),
    mcpServers: [],
    proc: proc as any,
    conn: asAgentConn(conn),
    fileCommands: [],
    clientCapabilities
  })
}

test('file access: request titles round-trip; malformed ones are ignored', () => {
  const write = { op: 'write' as const, path: '/a.ts', content: 'x' }
  assert.deepEqual(decodeFileRequest(encodeFileRequest(write)), write)
  assert.deepEqual(decodeFileRequest(encodeFileRequest({ op: 'read', path: '/a.ts' })), { op: 'read', path: '/a.ts' })
  assert.equal(decodeFileRequest('Commit message?'), null)
  assert.equal(decodeFileRequest(encodeFileRequest({ op: 'write', path: '/a.ts' } as any)), null)
  assert.equal(parseFileAccessMode('editor'), 'editor')
  assert.equal(parseFileAccessMode('cloud'), undefined)
})

test('PiAcpSession: file access needs both fs capabilities from the client', async () => {
  const readOnly = makeSession(new FakePiRpcProcess(), new FakeAgentSideConnection(), {
    fs: { readTextFile: true, writeTextFile: false }
  })
  assert.equal(await readOnly.fileAccessOption(), null)

  const full = makeSession(new FakePiRpcProcess(), new FakeAgentSideConnection())
  assert.equal((await full.fileAccessOption())?.currentValue, 'editor', 'editor is the default with fs support')
})

test('PiAcpSession: a failing editor read is reported back to pi as an error, not as empty text', async () => {
  const proc = new FakePiRpcProcess()
  const conn = new FakeAgentSideConnection()
  ;(conn as any).readTextFile = async () => {
    throw new Error('file not open')
  }
  makeSession(proc, conn)

  proc.emit({
    type: 'extension_ui_request',
    id: 'f1',
    method: 'input',
    title: encodeFileRequest({ op: 'read', path: '/nope.ts' })
  })
  await flush()

  const [response] = proc.extensionUiResponses as Array<{ id: string; value: string }>
  assert.equal(response?.id, 'f1')
  assert.deepEqual(JSON.parse(response!.value), { ok: false, error: 'Editor read failed for /nope.ts: file not open' })
  assert.equal(conn.elicitationRequests.length, 0, 'file requests never become input forms')
})
