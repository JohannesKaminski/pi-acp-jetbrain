import test from 'node:test'
import assert from 'node:assert/strict'
import { E2EClient } from './harness.js'
import type { ScriptedModelScript } from './fixtures/script.js'

function approvalOption(configOptions: Array<{ id: string; currentValue?: unknown }> | null | undefined) {
  return configOptions?.find(o => o.id === 'tool_approval')
}

function finalStatus(c: E2EClient, toolCallId: string | undefined) {
  return c
    .updatesOf('tool_call_update')
    .filter(u => u.toolCallId === toolCallId)
    .at(-1)?.status
}

test('e2e: tool approval is off by default and offered as a session option', async () => {
  const c = E2EClient.start({
    script: {
      responses: [{ content: [{ tool: 'bash', args: { command: 'echo free' } }] }, { content: [{ text: 'ok' }] }]
    }
  })
  try {
    const created = await c.newSession()
    assert.equal(approvalOption(created.configOptions)?.currentValue, 'off')

    assert.equal((await c.prompt(created.sessionId, 'go')).stopReason, 'end_turn')
    assert.equal(c.permissionRequests.length, 0)
    assert.equal(finalStatus(c, c.updatesOf('tool_call')[0]?.toolCallId), 'completed')
  } finally {
    await c.close()
  }
})

test('e2e: "edits" asks before bash but not before read; a rejection blocks the tool', async () => {
  const script: ScriptedModelScript = {
    responses: [
      {
        content: [
          { tool: 'read', args: { path: 'notes.txt' } },
          { tool: 'bash', args: { command: 'echo should-not-run' } }
        ]
      },
      { content: [{ text: 'ok' }] }
    ]
  }
  const c = E2EClient.start({ script })
  c.onPermission = () => ({ outcome: { outcome: 'selected', optionId: 'reject' } })
  try {
    const { writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    writeFileSync(join(c.workspace, 'notes.txt'), 'hello\n')

    const { sessionId } = await c.newSession()
    const res = await c.conn.setSessionConfigOption({ sessionId, configId: 'tool_approval', value: 'edits' })
    assert.equal(approvalOption(res.configOptions)?.currentValue, 'edits')

    assert.equal((await c.prompt(sessionId, 'go')).stopReason, 'end_turn')

    const [readCall, bashCall] = c.updatesOf('tool_call')
    assert.equal(c.permissionRequests.length, 1, 'only bash is asked about')
    const req = c.permissionRequests[0]!
    assert.equal(req.toolCall.toolCallId, bashCall?.toolCallId, 'the request is attached to the real tool call')
    assert.deepEqual(
      req.options.map(o => o.kind),
      ['allow_once', 'allow_always', 'reject_once']
    )
    assert.equal(finalStatus(c, readCall?.toolCallId), 'completed')
    assert.equal(finalStatus(c, bashCall?.toolCallId), 'failed')
    assert.doesNotMatch(JSON.stringify(c.updatesOf('tool_call_update')), /should-not-run\\n/)
  } finally {
    await c.close()
  }
})

test('e2e: "always allow" stops asking about that tool for the rest of the session', async () => {
  const c = E2EClient.start({
    script: {
      responses: [
        { content: [{ tool: 'bash', args: { command: 'echo one' } }] },
        { content: [{ tool: 'bash', args: { command: 'echo two' } }] },
        { content: [{ text: 'ok' }] }
      ]
    }
  })
  c.onPermission = () => ({ outcome: { outcome: 'selected', optionId: 'allow_always' } })
  try {
    const { sessionId } = await c.newSession()
    await c.conn.setSessionConfigOption({ sessionId, configId: 'tool_approval', value: 'all' })
    assert.equal((await c.prompt(sessionId, 'go')).stopReason, 'end_turn')

    assert.equal(c.permissionRequests.length, 1)
    const calls = c.updatesOf('tool_call')
    assert.equal(calls.length, 2)
    for (const call of calls) assert.equal(finalStatus(c, call.toolCallId), 'completed')
  } finally {
    await c.close()
  }
})

test('e2e: PI_ACP_TOOL_APPROVAL sets the default mode for new sessions', async () => {
  const c = E2EClient.start({
    env: { PI_ACP_TOOL_APPROVAL: 'edits' },
    script: {
      responses: [{ content: [{ tool: 'bash', args: { command: 'echo x' } }] }, { content: [{ text: 'ok' }] }]
    }
  })
  c.onPermission = () => ({ outcome: { outcome: 'selected', optionId: 'allow_once' } })
  try {
    const created = await c.newSession()
    assert.equal(approvalOption(created.configOptions)?.currentValue, 'edits')
    assert.equal((await c.prompt(created.sessionId, 'go')).stopReason, 'end_turn')
    assert.equal(c.permissionRequests.length, 1)
    assert.equal(finalStatus(c, c.updatesOf('tool_call')[0]?.toolCallId), 'completed')
  } finally {
    await c.close()
  }
})
