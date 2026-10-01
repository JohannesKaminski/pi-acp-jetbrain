import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PiAcpSession } from '../../src/acp/session.js'
import { FakeAgentSideConnection, FakePiRpcProcess, asAgentConn, type FakePiEvent } from '../helpers/fakes.js'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

function makeSession(
  conn: FakeAgentSideConnection,
  proc: FakePiRpcProcess,
  cwd = process.cwd(),
  fileCommands: Array<{ name: string; description: string; content: string; source: string }> = []
) {
  return new PiAcpSession({
    sessionId: 's1',
    cwd,
    mcpServers: [],
    proc: proc as any,
    conn: asAgentConn(conn),
    fileCommands
  })
}

function assertToolCall(conn: FakeAgentSideConnection, locations: Array<{ path: string; line?: number }>) {
  assert.equal(conn.updates.length, 1)
  assert.equal(conn.updates[0]!.update.sessionUpdate, 'tool_call')
  assert.deepEqual((conn.updates[0]!.update as any).locations, locations)
}

test('PiAcpSession: emits agent_message_chunk for text_delta', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()

  makeSession(conn, proc)

  proc.emit({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', delta: 'hi' }
  })

  await flush()

  assert.equal(conn.updates.length, 1)
  assert.equal(conn.updates[0]!.sessionId, 's1')
  assert.deepEqual(conn.updates[0]!.update, {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'hi' }
  })
})

test('PiAcpSession: emits agent_thought_chunk for thinking_delta', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()

  makeSession(conn, proc)

  proc.emit({
    type: 'message_update',
    assistantMessageEvent: { type: 'thinking_delta', delta: 'thinking...' }
  })

  await flush()

  assert.equal(conn.updates.length, 1)
  assert.equal(conn.updates[0]!.sessionId, 's1')
  assert.deepEqual(conn.updates[0]!.update, {
    sessionUpdate: 'agent_thought_chunk',
    content: { type: 'text', text: 'thinking...' }
  })
})

test('PiAcpSession: emits tool_call + tool_call_update + completes', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()

  makeSession(conn, proc)

  proc.emit({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'bash', args: { command: 'ls' } })
  proc.emit({
    type: 'tool_execution_update',
    toolCallId: 't1',
    partialResult: { content: [{ type: 'text', text: 'running' }] }
  })
  proc.emit({
    type: 'tool_execution_end',
    toolCallId: 't1',
    isError: false,
    result: { content: [{ type: 'text', text: 'done' }] }
  })

  await flush()

  assert.equal(conn.updates.length, 3)

  assert.equal(conn.updates[0]!.update.sessionUpdate, 'tool_call')
  assert.equal((conn.updates[0]!.update as any).toolCallId, 't1')
  assert.equal((conn.updates[0]!.update as any).title, 'ls')
  assert.equal((conn.updates[0]!.update as any).kind, 'execute')
  assert.equal((conn.updates[0]!.update as any).status, 'in_progress')
  assert.equal((conn.updates[0]!.update as any).locations, undefined)
  assert.deepEqual((conn.updates[0]!.update as any).content, [{ type: 'terminal', terminalId: 't1' }])
  assert.deepEqual((conn.updates[0]!.update as any)._meta, {
    terminal_info: { terminal_id: 't1', cwd: process.cwd() }
  })
  assert.equal((conn.updates[0]!.update as any).rawInput, undefined)

  assert.equal(conn.updates[1]!.update.sessionUpdate, 'tool_call_update')
  assert.equal((conn.updates[1]!.update as any).toolCallId, 't1')
  assert.equal((conn.updates[1]!.update as any).status, 'in_progress')
  assert.equal((conn.updates[1]!.update as any).content, undefined)
  assert.deepEqual((conn.updates[1]!.update as any)._meta, {
    terminal_output: { terminal_id: 't1', data: 'running' }
  })
  assert.equal((conn.updates[1]!.update as any).rawOutput, undefined)

  assert.equal(conn.updates[2]!.update.sessionUpdate, 'tool_call_update')
  assert.equal((conn.updates[2]!.update as any).toolCallId, 't1')
  assert.equal((conn.updates[2]!.update as any).status, 'completed')
  assert.equal((conn.updates[2]!.update as any).content, undefined)
  assert.deepEqual((conn.updates[2]!.update as any)._meta, {
    terminal_output: { terminal_id: 't1', data: 'done' },
    terminal_exit: { terminal_id: 't1', exit_code: 0, signal: null }
  })
  assert.equal((conn.updates[2]!.update as any).rawOutput, undefined)
})

test('PiAcpSession: emits tool locations from pi path args', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()

  makeSession(conn, proc)

  proc.emit({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'read', args: { path: 'src/acp/session.ts' } })

  await flush()

  assert.equal(conn.updates.length, 1)
  assert.equal(conn.updates[0]!.update.sessionUpdate, 'tool_call')
  assert.deepEqual((conn.updates[0]!.update as any).locations, [{ path: `${process.cwd()}/src/acp/session.ts` }])
})

test('PiAcpSession: handles extension select via ACP permission request', async () => {
  const conn = new FakeAgentSideConnection()
  conn.nextPermissionResponse = { outcome: { outcome: 'selected', optionId: 'choice-1' } }
  const proc = new FakePiRpcProcess()

  makeSession(conn, proc)

  proc.emit({
    type: 'extension_ui_request',
    id: 'ui-1',
    method: 'select',
    title: 'Pick one',
    options: ['Alpha', 'Beta']
  })

  await flush()

  assert.equal(conn.permissionRequests.length, 1)
  assert.deepEqual(conn.permissionRequests[0], {
    sessionId: 's1',
    toolCall: {
      toolCallId: 'pi-ui-ui-1',
      title: 'Pick one',
      kind: 'other',
      status: 'pending',
      rawInput: { method: 'select', title: 'Pick one', options: ['Alpha', 'Beta'] }
    },
    options: [
      { optionId: 'choice-0', name: 'Alpha', kind: 'allow_once' },
      { optionId: 'choice-1', name: 'Beta', kind: 'allow_once' }
    ]
  })
  assert.deepEqual(proc.extensionUiResponses, [{ id: 'ui-1', value: 'Beta' }])
})

test('PiAcpSession: handles extension confirm via ACP permission request', async () => {
  const conn = new FakeAgentSideConnection()
  conn.nextPermissionResponse = { outcome: { outcome: 'selected', optionId: 'no' } }
  const proc = new FakePiRpcProcess()

  makeSession(conn, proc)

  proc.emit({
    type: 'extension_ui_request',
    id: 'ui-2',
    method: 'confirm',
    title: 'Clear session?',
    message: 'All messages will be lost.'
  })

  await flush()

  assert.equal(conn.permissionRequests.length, 1)
  assert.deepEqual((conn.permissionRequests[0] as any).options, [
    { optionId: 'yes', name: 'Yes', kind: 'allow_once' },
    { optionId: 'no', name: 'No', kind: 'reject_once' }
  ])
  assert.deepEqual(proc.extensionUiResponses, [{ id: 'ui-2', confirmed: false }])
})

test('PiAcpSession: sends cancelled response when ACP confirm is cancelled', async () => {
  const conn = new FakeAgentSideConnection()
  conn.nextPermissionResponse = { outcome: { outcome: 'cancelled' } }
  const proc = new FakePiRpcProcess()

  makeSession(conn, proc)

  proc.emit({ type: 'extension_ui_request', id: 'ui-5', method: 'confirm', title: 'Continue?' })

  await flush()

  assert.deepEqual(proc.extensionUiResponses, [{ id: 'ui-5', cancelled: true }])
})

test('PiAcpSession: routes input through elicitation and cancels editor with a visible fallback', async () => {
  const conn = new FakeAgentSideConnection()
  conn.nextElicitationResponse = { action: 'cancel' }
  const proc = new FakePiRpcProcess()

  makeSession(conn, proc)

  proc.emit({ type: 'extension_ui_request', id: 'ui-3', method: 'input', title: 'Enter name' })
  proc.emit({ type: 'extension_ui_request', id: 'ui-4', method: 'editor', title: 'Edit text' })

  await flush()

  // Input goes through the elicitation form (user canceled); the editor stays canceled.
  assert.equal(conn.elicitationRequests.length, 1)
  assert.deepEqual(proc.extensionUiResponses, [
    { id: 'ui-4', cancelled: true },
    { id: 'ui-3', cancelled: true }
  ])
  assert.equal(conn.updates.length, 1)
  assert.match((conn.updates[0]!.update as any).content.text, /editor UI request is not supported/)
})

test('PiAcpSession: emits agent_message_chunk for auto_retry_start with attempt/maxAttempts and rounded delay', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()

  makeSession(conn, proc)

  proc.emit({ type: 'auto_retry_start', attempt: 2, maxAttempts: 5, delayMs: 2400 })

  await flush()

  assert.equal(conn.updates.length, 1)
  assert.deepEqual(conn.updates[0]!.update, {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'Retrying (attempt 2/5, waiting 2s)...' }
  })
})

test('PiAcpSession: formats a positive sub-second auto_retry_start delay as waiting 1s', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()

  makeSession(conn, proc)

  proc.emit({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 1 })

  await flush()

  assert.equal(conn.updates.length, 1)
  assert.deepEqual(conn.updates[0]!.update, {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'Retrying (attempt 1/3, waiting 1s)...' }
  })
})

test('PiAcpSession: falls back to a generic retry message when auto_retry_start fields are missing or malformed', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()

  makeSession(conn, proc)

  proc.emit({ type: 'auto_retry_start', attempt: 'oops' as any, maxAttempts: null as any, delayMs: 'bad' as any })

  await flush()

  assert.equal(conn.updates.length, 1)
  assert.deepEqual(conn.updates[0]!.update, {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'Retrying...' }
  })
})

test('PiAcpSession: omits raw errorMessage content from surfaced auto_retry_start status text', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()

  makeSession(conn, proc)

  proc.emit({
    type: 'auto_retry_start',
    attempt: 1,
    maxAttempts: 4,
    delayMs: 1500,
    errorMessage: 'provider overloaded: 529'
  } as any)

  await flush()

  assert.equal(conn.updates.length, 1)
  assert.equal(conn.updates[0]!.update.sessionUpdate, 'agent_message_chunk')
  assert.equal((conn.updates[0]!.update as any).content.text, 'Retrying (attempt 1/4, waiting 2s)...')
  assert.equal((conn.updates[0]!.update as any).content.text.includes('provider overloaded'), false)
})

test('PiAcpSession: emits agent_message_chunk for auto_retry_end', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()

  makeSession(conn, proc)

  proc.emit({ type: 'auto_retry_end' })

  await flush()

  assert.equal(conn.updates.length, 1)
  assert.deepEqual(conn.updates[0]!.update, {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'Retry finished, resuming.' }
  })
})

const COMPACTION_NOTICES: Array<{ name: string; events: FakePiEvent[]; texts: string[] }> = [
  {
    name: 'threshold compaction',
    events: [
      { type: 'compaction_start', reason: 'threshold' },
      { type: 'compaction_end', reason: 'threshold', aborted: false, willRetry: false }
    ],
    texts: [
      'Context nearing limit; running automatic compaction...\n\n',
      'Compaction finished; earlier context was summarized.\n\n'
    ]
  },
  {
    name: 'overflow compaction with retry',
    events: [
      { type: 'compaction_start', reason: 'overflow' },
      { type: 'compaction_end', reason: 'overflow', aborted: false, willRetry: true }
    ],
    texts: [
      'Context window exceeded; compacting and retrying...\n\n',
      'Compaction finished; earlier context was summarized.\n\n'
    ]
  },
  {
    name: 'aborted compaction',
    events: [{ type: 'compaction_end', reason: 'threshold', aborted: true, willRetry: false }],
    texts: ['Compaction cancelled.\n\n']
  },
  {
    name: 'failed compaction',
    events: [
      { type: 'compaction_end', reason: 'overflow', aborted: false, willRetry: false, errorMessage: 'summary failed' }
    ],
    texts: ['Compaction failed: summary failed\n\n']
  },
  {
    // `/compact` reports its own result through the slash command.
    name: 'manual compaction',
    events: [
      { type: 'compaction_start', reason: 'manual' },
      { type: 'compaction_end', reason: 'manual', aborted: false, willRetry: false }
    ],
    texts: []
  }
]

for (const { name, events, texts } of COMPACTION_NOTICES) {
  test(`PiAcpSession: compaction notices for ${name}`, async () => {
    const conn = new FakeAgentSideConnection()
    const proc = new FakePiRpcProcess()

    makeSession(conn, proc)
    for (const ev of events) proc.emit(ev)
    await flush()

    assert.deepEqual(
      conn.updates.map(u => u.update),
      texts.map(text => ({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }))
    )
  })
}

test('PiAcpSession: preserves ordering when auto_retry_start is interleaved with text_delta events', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()

  makeSession(conn, proc)

  proc.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'before ' } })
  proc.emit({ type: 'auto_retry_start', attempt: 1, maxAttempts: 2, delayMs: 2000 })
  proc.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'after' } })

  await flush()

  assert.deepEqual(
    conn.updates.map(u => u.update),
    [
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'before ' } },
      {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Retrying (attempt 1/2, waiting 2s)...' }
      },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'after' } }
    ]
  )
})

test('PiAcpSession: emits streamed tool locations from pi path args', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()

  makeSession(conn, proc)

  proc.emit({
    type: 'message_update',
    assistantMessageEvent: {
      type: 'toolcall_start',
      toolCall: {
        id: 't1',
        name: 'write',
        arguments: { path: '/tmp/test.txt', content: 'hello' }
      }
    }
  })

  await flush()

  assert.equal(conn.updates.length, 1)
  assert.equal(conn.updates[0]!.update.sessionUpdate, 'tool_call')
  assert.deepEqual((conn.updates[0]!.update as any).locations, [{ path: '/tmp/test.txt' }])
})

test('PiAcpSession: emits edit tool line when oldText matches uniquely', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  const cwd = mkdtempSync(join(tmpdir(), 'pi-acp-lines-'))
  const filePath = join(cwd, 'a.txt')

  mkdirSync(cwd, { recursive: true })
  writeFileSync(filePath, 'one\ntwo\nneedle\nthree\n', 'utf8')

  makeSession(conn, proc, cwd)

  proc.emit({
    type: 'tool_execution_start',
    toolCallId: 't1',
    toolName: 'edit',
    args: { path: 'a.txt', oldText: 'needle' }
  })

  await flush()

  assertToolCall(conn, [{ path: filePath, line: 3 }])
})

test('PiAcpSession: emits edit tool line from edits array when oldText matches uniquely', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  const cwd = mkdtempSync(join(tmpdir(), 'pi-acp-lines-edits-'))
  const filePath = join(cwd, 'a.txt')

  mkdirSync(cwd, { recursive: true })
  writeFileSync(filePath, 'one\ntwo\nneedle\nthree\n', 'utf8')

  makeSession(conn, proc, cwd)

  proc.emit({
    type: 'tool_execution_start',
    toolCallId: 't1',
    toolName: 'edit',
    args: { path: 'a.txt', edits: [{ oldText: 'needle', newText: 'replacement' }] }
  })

  await flush()

  assertToolCall(conn, [{ path: filePath, line: 3 }])
})

test('PiAcpSession: emits edit tool line from stringified edits array', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  const cwd = mkdtempSync(join(tmpdir(), 'pi-acp-lines-edits-string-'))
  const filePath = join(cwd, 'a.txt')

  mkdirSync(cwd, { recursive: true })
  writeFileSync(filePath, 'one\ntwo\nneedle\nthree\n', 'utf8')

  makeSession(conn, proc, cwd)

  proc.emit({
    type: 'tool_execution_start',
    toolCallId: 't1',
    toolName: 'edit',
    args: { path: 'a.txt', edits: JSON.stringify([{ oldText: 'needle', newText: 'replacement' }]) }
  })

  await flush()

  assertToolCall(conn, [{ path: filePath, line: 3 }])
})

test('PiAcpSession: omits edit tool line when oldText matches multiple times', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  const cwd = mkdtempSync(join(tmpdir(), 'pi-acp-lines-dup-'))
  const filePath = join(cwd, 'a.txt')

  mkdirSync(cwd, { recursive: true })
  writeFileSync(filePath, 'one\nneedle\ntwo\nneedle\n', 'utf8')

  makeSession(conn, proc, cwd)

  proc.emit({
    type: 'tool_execution_start',
    toolCallId: 't2',
    toolName: 'edit',
    args: { path: 'a.txt', oldText: 'needle' }
  })

  await flush()

  assertToolCall(conn, [{ path: filePath }])
})

test('PiAcpSession: prompt stays open through retry runs until agent_settled', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()

  const session = makeSession(conn, proc)

  let resolved = false
  const p = session.prompt('hello').then(reason => {
    resolved = true
    return reason
  })

  proc.emit({ type: 'agent_start' })
  proc.emit({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 2000 })
  proc.emit({ type: 'agent_end', willRetry: true })
  await flush()
  assert.equal(resolved, false)

  proc.emit({ type: 'agent_start' })
  proc.emit({ type: 'turn_end' })
  proc.emit({ type: 'agent_end', willRetry: false })
  await flush()
  assert.equal(resolved, false)

  proc.emit({ type: 'agent_settled' })
  const reason = await p
  assert.equal(reason, 'end_turn')
})

test('PiAcpSession: does not re-emit startup info on first prompt after it was already sent', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()

  const session = makeSession(conn, proc)

  const notice = 'New version available: v0.74.0 (installed v0.73.1).'

  session.setStartupInfo(notice)
  session.sendStartupInfoIfPending()
  await flush()

  const p = session.prompt('hello')
  await flush()

  assert.equal(proc.prompts.length, 1)
  assert.equal(proc.prompts[0]!.message, 'hello')
  const startupUpdates = conn.updates.filter(
    entry =>
      entry.update.sessionUpdate === 'agent_message_chunk' &&
      (entry.update as any).content?.type === 'text' &&
      (entry.update as any).content?.text === notice
  )
  assert.equal(startupUpdates.length, 1)

  proc.emit({ type: 'agent_start' })
  proc.emit({ type: 'turn_end' })
  proc.emit({ type: 'agent_end' })
  proc.emit({ type: 'agent_settled' })

  const reason = await p
  assert.equal(reason, 'end_turn')
})

test('PiAcpSession: cancel flips stopReason to cancelled', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()

  const session = makeSession(conn, proc)

  const p = session.prompt('hello')
  await session.cancel()
  proc.emit({ type: 'agent_start' })
  proc.emit({ type: 'turn_end' })
  proc.emit({ type: 'agent_end' })
  proc.emit({ type: 'agent_settled' })
  const reason = await p

  assert.equal(proc.abortCount, 1)
  assert.equal(reason, 'cancelled')
})

test('PiAcpSession: queues concurrent prompt and starts it after agent_settled', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()

  const session = makeSession(conn, proc)

  const first = session.prompt('one')
  const second = session.prompt('two')

  assert.equal(proc.prompts.length, 1)
  assert.equal(proc.prompts[0]!.message, 'one')

  proc.emit({ type: 'agent_start' })
  proc.emit({ type: 'turn_end' })
  proc.emit({ type: 'agent_end' })
  proc.emit({ type: 'agent_settled' })

  const r1 = await first
  assert.equal(r1, 'end_turn')

  assert.equal(proc.prompts.length, 2)
  assert.equal(proc.prompts[1]!.message, 'two')

  proc.emit({ type: 'agent_start' })
  proc.emit({ type: 'turn_end' })
  proc.emit({ type: 'agent_end' })
  proc.emit({ type: 'agent_settled' })

  const r2 = await second
  assert.equal(r2, 'end_turn')
})

test('PiAcpSession: cancel clears queued prompts', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()

  const session = makeSession(conn, proc)

  const first = session.prompt('one')
  const second = session.prompt('two')

  assert.equal(proc.prompts.length, 1)

  await session.cancel()
  proc.emit({ type: 'agent_start' })
  proc.emit({ type: 'turn_end' })
  proc.emit({ type: 'agent_end' })
  proc.emit({ type: 'agent_settled' })

  const r1 = await first
  const r2 = await second

  assert.equal(r1, 'cancelled')
  assert.equal(r2, 'cancelled')
})

test('PiAcpSession: expands /command before sending to pi', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()

  const session = makeSession(conn, proc, process.cwd(), [
    { name: 'hello', description: 'test', content: 'Say hello to $1', source: '(project)' }
  ])

  const p = session.prompt('/hello world')
  assert.equal(proc.prompts.length, 1)
  assert.equal(proc.prompts[0]!.message, 'Say hello to world')

  proc.emit({ type: 'agent_start' })
  proc.emit({ type: 'turn_end' })
  proc.emit({ type: 'agent_end' })
  proc.emit({ type: 'agent_settled' })

  const reason = await p
  assert.equal(reason, 'end_turn')
})

test('PiAcpSession: tags extension notify chunks with severity in _meta', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()

  makeSession(conn, proc)

  proc.emit({
    type: 'extension_ui_request',
    id: 'n1',
    method: 'notify',
    message: 'MCP: connection failed',
    notifyType: 'error'
  })

  await flush()

  assert.equal(conn.updates.length, 1)
  assert.deepEqual(conn.updates[0]!.update, {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'MCP: connection failed' },
    _meta: { piAcp: { notify: { level: 'error' } } }
  })
  assert.deepEqual(proc.extensionUiResponses[0], { id: 'n1', cancelled: true })
})

test('PiAcpSession: defaults notify severity to info when notifyType is absent', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()

  makeSession(conn, proc)

  proc.emit({
    type: 'extension_ui_request',
    id: 'n2',
    method: 'notify',
    message: 'heads up'
  })

  await flush()

  assert.equal(conn.updates.length, 1)
  assert.deepEqual((conn.updates[0]!.update as any)._meta, {
    piAcp: { notify: { level: 'info' } }
  })
})
test('PiAcpSession: handles extension input via ACP elicitation form (accept)', async () => {
  const conn = new FakeAgentSideConnection()
  conn.nextElicitationResponse = { action: 'accept', content: { value: 'hello from user' } }
  const proc = new FakePiRpcProcess()

  makeSession(conn, proc)

  proc.emit({
    type: 'extension_ui_request',
    id: 'ui-in-1',
    method: 'input',
    title: 'Enter commit message',
    placeholder: 'e.g. fix: ship it'
  })

  await flush()

  assert.equal(conn.elicitationRequests.length, 1)
  assert.deepEqual(conn.elicitationRequests[0], {
    mode: 'form',
    sessionId: 's1',
    message: 'Enter commit message',
    requestedSchema: {
      type: 'object',
      title: 'Enter commit message',
      properties: { value: { type: 'string', description: 'e.g. fix: ship it' } },
      required: ['value']
    }
  })
  assert.deepEqual(proc.extensionUiResponses, [{ id: 'ui-in-1', value: 'hello from user' }])
})

test('PiAcpSession: handles extension input declined or cancelled by the user', async () => {
  const conn = new FakeAgentSideConnection()
  conn.nextElicitationResponse = { action: 'decline' }
  const proc = new FakePiRpcProcess()

  makeSession(conn, proc)

  proc.emit({ type: 'extension_ui_request', id: 'ui-in-2', method: 'input', title: 'Pick a value' })
  await flush()

  assert.equal(conn.elicitationRequests.length, 1)
  assert.deepEqual(proc.extensionUiResponses, [{ id: 'ui-in-2', cancelled: true }])
})

test('PiAcpSession: falls back to a visible cancellation when the client lacks elicitation support', async () => {
  const conn = new FakeAgentSideConnection()
  conn.elicitationError = new Error('method not found')
  const proc = new FakePiRpcProcess()

  makeSession(conn, proc)

  proc.emit({ type: 'extension_ui_request', id: 'ui-in-3', method: 'input', title: 'Input' })
  await flush()

  assert.deepEqual(proc.extensionUiResponses, [{ id: 'ui-in-3', cancelled: true }])
  assert.equal(conn.updates.length, 1)
  assert.equal((conn.updates[0]!.update as any).sessionUpdate, 'agent_message_chunk')
  assert.match(String((conn.updates[0]!.update as any).content.text), /not supported by this ACP client/)
})

test('PiAcpSession: keeps editor UI requests cancelled with a visible fallback', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()

  makeSession(conn, proc)

  proc.emit({ type: 'extension_ui_request', id: 'ui-ed-1', method: 'editor', title: 'Edit' })
  await flush()

  assert.equal(conn.elicitationRequests.length, 0)
  assert.deepEqual(proc.extensionUiResponses, [{ id: 'ui-ed-1', cancelled: true }])
})

test('PiAcpSession: emits usage_update from contextUsage before resolving prompt on agent_settled', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  proc.sessionStats = {
    tokens: { total: 999_999 },
    contextUsage: { tokens: 12_345, contextWindow: 200_000 }
  }

  const session = new PiAcpSession({
    sessionId: 's1',
    cwd: process.cwd(),
    mcpServers: [],
    proc: proc as any,
    conn: asAgentConn(conn),
    fileCommands: []
  })

  // Block delivery of usage_update to prove the prompt only resolves once it landed.
  let usageDeliveryStarted: () => void
  const deliveryStarted = new Promise<void>(resolve => {
    usageDeliveryStarted = resolve
  })
  let releaseDelivery: () => void
  const deliveryBlocked = new Promise<void>(resolve => {
    releaseDelivery = resolve
  })

  const originalSessionUpdate = conn.sessionUpdate.bind(conn)
  conn.sessionUpdate = async msg => {
    if (msg.update.sessionUpdate === 'usage_update') {
      usageDeliveryStarted()
      await deliveryBlocked
    }
    await originalSessionUpdate(msg)
  }

  let resolved = false
  const p = session.prompt('hello').then(reason => {
    resolved = true
    return reason
  })
  proc.emit({ type: 'agent_start' })
  proc.emit({ type: 'agent_end' })
  proc.emit({ type: 'agent_settled' })

  await deliveryStarted
  assert.equal(resolved, false)
  releaseDelivery!()

  assert.equal(await p, 'end_turn')
  assert.equal(proc.getSessionStatsCount, 1)
  assert.deepEqual(
    conn.updates.filter(u => u.update.sessionUpdate === 'usage_update').map(u => u.update),
    [{ sessionUpdate: 'usage_update', used: 12_345, size: 200_000 }]
  )
})

test('PiAcpSession: skips usage_update when contextUsage tokens are null', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  proc.sessionStats = {
    tokens: { total: 4_000 },
    contextUsage: { tokens: null, contextWindow: 200_000 }
  }

  const session = new PiAcpSession({
    sessionId: 's1',
    cwd: process.cwd(),
    mcpServers: [],
    proc: proc as any,
    conn: asAgentConn(conn),
    fileCommands: []
  })

  const p = session.prompt('hello')
  proc.emit({ type: 'agent_settled' })

  assert.equal(await p, 'end_turn')
  assert.equal(
    conn.updates.some(u => u.update.sessionUpdate === 'usage_update'),
    false
  )
})

test('PiAcpSession: skips usage_update for invalid contextUsage values', async () => {
  const invalid = [
    { name: 'missing contextUsage', contextUsage: undefined },
    { name: 'negative tokens', contextUsage: { tokens: -1, contextWindow: 100 } },
    { name: 'fractional tokens', contextUsage: { tokens: 1.5, contextWindow: 100 } },
    { name: 'NaN tokens', contextUsage: { tokens: Number.NaN, contextWindow: 100 } },
    { name: 'zero contextWindow', contextUsage: { tokens: 10, contextWindow: 0 } },
    { name: 'negative contextWindow', contextUsage: { tokens: 10, contextWindow: -1 } },
    { name: 'fractional contextWindow', contextUsage: { tokens: 10, contextWindow: 100.5 } },
    { name: 'null contextWindow', contextUsage: { tokens: 10, contextWindow: null } },
    { name: 'infinite contextWindow', contextUsage: { tokens: 10, contextWindow: Number.POSITIVE_INFINITY } }
  ]

  for (const { name, contextUsage } of invalid) {
    const conn = new FakeAgentSideConnection()
    const proc = new FakePiRpcProcess()
    proc.sessionStats = { contextUsage } as any

    const session = new PiAcpSession({
      sessionId: 's1',
      cwd: process.cwd(),
      mcpServers: [],
      proc: proc as any,
      conn: asAgentConn(conn),
      fileCommands: []
    })

    const p = session.prompt('hello')
    proc.emit({ type: 'agent_settled' })

    assert.equal(await p, 'end_turn', name)
    assert.equal(
      conn.updates.some(u => u.update.sessionUpdate === 'usage_update'),
      false,
      name
    )
  }
})

test('PiAcpSession: get_session_stats rejection does not break the prompt', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  proc.sessionStatsError = new Error('pi get_session_stats failed: unsupported')

  const session = new PiAcpSession({
    sessionId: 's1',
    cwd: process.cwd(),
    mcpServers: [],
    proc: proc as any,
    conn: asAgentConn(conn),
    fileCommands: []
  })

  const p = session.prompt('hello')
  proc.emit({ type: 'agent_settled' })

  assert.equal(await p, 'end_turn')
  assert.equal(proc.getSessionStatsCount, 1)
  assert.equal(
    conn.updates.some(u => u.update.sessionUpdate === 'usage_update'),
    false
  )
})

test('PiAcpSession: get_session_stats timeout does not block the prompt', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  // The timeout lives in PiRpcProcess.request (see test/unit/pi-rpc-request-timeout.test.ts);
  // from the session's point of view it surfaces as a rejection.
  proc.sessionStatsError = new Error('pi get_session_stats timed out after 1000ms')

  const session = new PiAcpSession({
    sessionId: 's1',
    cwd: process.cwd(),
    mcpServers: [],
    proc: proc as any,
    conn: asAgentConn(conn),
    fileCommands: []
  })

  const p = session.prompt('hello')
  proc.emit({ type: 'agent_settled' })

  assert.equal(await p, 'end_turn')
  assert.equal(proc.getSessionStatsCount, 1)
  assert.equal(
    conn.updates.some(u => u.update.sessionUpdate === 'usage_update'),
    false
  )
})

test('PiAcpSession: cancelled turn still reports cancelled after usage publish', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  proc.sessionStats = { contextUsage: { tokens: 42, contextWindow: 100 } }

  const session = new PiAcpSession({
    sessionId: 's1',
    cwd: process.cwd(),
    mcpServers: [],
    proc: proc as any,
    conn: asAgentConn(conn),
    fileCommands: []
  })

  const p = session.prompt('hello')
  await session.cancel()
  proc.emit({ type: 'agent_settled' })

  assert.equal(await p, 'cancelled')
  assert.deepEqual(
    conn.updates.filter(u => u.update.sessionUpdate === 'usage_update').map(u => u.update),
    [{ sessionUpdate: 'usage_update', used: 42, size: 100 }]
  )
})
