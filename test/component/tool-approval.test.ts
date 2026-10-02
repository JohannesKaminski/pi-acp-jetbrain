import test from 'node:test'
import assert from 'node:assert/strict'
import { PiAcpSession } from '../../src/acp/session.js'
import {
  TOOL_APPROVAL_COMMAND,
  decodeApprovalTitle,
  encodeApprovalTitle,
  needsApproval,
  parseToolApprovalMode
} from '../../src/pi-extension/tool-approval.js'
import { FakeAgentSideConnection, FakePiRpcProcess, asAgentConn } from '../helpers/fakes.js'

function makeSession(proc: FakePiRpcProcess, conn = new FakeAgentSideConnection()) {
  return new PiAcpSession({
    sessionId: 's1',
    cwd: process.cwd(),
    mcpServers: [],
    proc: proc as any,
    conn: asAgentConn(conn),
    fileCommands: []
  })
}

function withCommands(proc: FakePiRpcProcess, names: string[]): FakePiRpcProcess {
  ;(proc as any).getCommands = async () => ({ commands: names.map(name => ({ name, source: 'extension' })) })
  return proc
}

test('tool approval: which tools need approval in each mode', () => {
  for (const tool of ['read', 'grep', 'find', 'ls']) {
    assert.equal(needsApproval('edits', tool), false, tool)
    assert.equal(needsApproval('all', tool), true, tool)
  }
  for (const tool of ['edit', 'write', 'bash', 'powershell', 'ide_idea_apply_patch']) {
    assert.equal(needsApproval('edits', tool), true, tool)
  }
  assert.equal(needsApproval('off', 'bash'), false)
  assert.equal(parseToolApprovalMode(' edits '), 'edits')
  assert.equal(parseToolApprovalMode('sometimes'), undefined)
})

test('tool approval: the dialog title round-trips and ordinary titles are not mistaken for it', () => {
  const req = { toolCallId: 'tool:1', toolName: 'bash' }
  assert.deepEqual(decodeApprovalTitle(encodeApprovalTitle(req)), req)
  assert.equal(decodeApprovalTitle('Pick a branch'), null)
  assert.equal(decodeApprovalTitle(undefined), null)
})

test('PiAcpSession: tool approval is unavailable, and no command is sent, when pi lacks the extension', async () => {
  const proc = withCommands(new FakePiRpcProcess(), ['some-other-command'])
  const session = makeSession(proc)

  assert.equal(await session.toolApprovalOption(), null)
  await assert.rejects(session.setToolApprovalMode('all'), /unavailable/)
  assert.deepEqual(proc.prompts, [], 'the internal command never reaches pi (it would become a model prompt)')
})

test('PiAcpSession: a mode change sends the internal command and updates the option', async () => {
  const proc = withCommands(new FakePiRpcProcess(), [TOOL_APPROVAL_COMMAND])
  const session = makeSession(proc)

  assert.equal((await session.toolApprovalOption())?.currentValue, 'off')
  await session.setToolApprovalMode('edits')

  assert.deepEqual(
    proc.prompts.map(p => p.message),
    [`/${TOOL_APPROVAL_COMMAND} edits`]
  )
  assert.equal((await session.toolApprovalOption())?.currentValue, 'edits')
})

test('PiAcpSession: a mode change during a running turn is applied when the turn settles', async () => {
  const proc = withCommands(new FakePiRpcProcess(), [TOOL_APPROVAL_COMMAND])
  const session = makeSession(proc)
  await session.toolApprovalOption()

  const turn = session.prompt('hello')
  await session.setToolApprovalMode('all')
  assert.deepEqual(
    proc.prompts.map(p => p.message),
    ['hello'],
    'not sent while the turn runs'
  )

  proc.emit({ type: 'agent_settled' })
  await turn
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(
    proc.prompts.map(p => p.message),
    ['hello', `/${TOOL_APPROVAL_COMMAND} all`]
  )
})

test('PiAcpSession: an approval dialog becomes a permission request; no answer means reject', async () => {
  const proc = withCommands(new FakePiRpcProcess(), [TOOL_APPROVAL_COMMAND])
  const conn = new FakeAgentSideConnection()
  conn.nextPermissionResponse = { outcome: { outcome: 'cancelled' } }
  makeSession(proc, conn)

  proc.emit({
    type: 'extension_ui_request',
    id: 'ui-1',
    method: 'select',
    title: encodeApprovalTitle({ toolCallId: 'tool:7', toolName: 'bash' }),
    options: ['allow_once', 'allow_always', 'reject']
  })
  await new Promise(resolve => setTimeout(resolve, 0))

  const req = conn.permissionRequests[0] as { toolCall: { toolCallId: string }; options: Array<{ name: string }> }
  assert.equal(req.toolCall.toolCallId, 'tool:7')
  assert.match(req.options[1]!.name, /Always allow bash in this session/)
  assert.deepEqual(proc.extensionUiResponses, [{ id: 'ui-1', value: 'reject' }])
})
