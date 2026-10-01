import test from 'node:test'
import assert from 'node:assert/strict'
import { PiAcpAgent } from '../../src/acp/agent.js'
import { PiAcpSession } from '../../src/acp/session.js'
import { SESSION_STATS_TIMEOUT_MS } from '../../src/pi-rpc/process.js'
import { FakeAgentSideConnection, FakePiRpcProcess, asAgentConn } from '../helpers/fakes.js'

class FakeSessions {
  constructor(private readonly session: any) {}

  async create() {
    return this.session
  }

  maybeGet(sessionId: string) {
    if (sessionId !== this.session.sessionId) return undefined
    return this.session
  }

  get(sessionId: string) {
    if (sessionId !== this.session.sessionId) {
      throw new Error(`Unknown sessionId: ${sessionId}`)
    }
    return this.session
  }
}

/** Let the `setTimeout(..., 0)` continuations scheduled after session/new or session/load run. */
async function drainScheduledWork(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise(resolve => setTimeout(resolve, 0))
}

function makeSession(proc: FakePiRpcProcess, conn: FakeAgentSideConnection): PiAcpSession {
  return new PiAcpSession({
    sessionId: 's1',
    cwd: process.cwd(),
    mcpServers: [],
    proc: proc as any,
    conn: asAgentConn(conn),
    fileCommands: []
  })
}

test('PiAcpSession: context usage request specifies the auxiliary timeout', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  let requestedTimeout: number | undefined
  proc.getSessionStats = async (timeoutMs?: number) => {
    requestedTimeout = timeoutMs
    return { contextUsage: { tokens: 100, contextWindow: 100_000 } }
  }

  await makeSession(proc, conn).publishContextUsage()

  assert.equal(requestedTimeout, SESSION_STATS_TIMEOUT_MS)
  assert.deepEqual(conn.updates, [
    { sessionId: 's1', update: { sessionUpdate: 'usage_update', used: 100, size: 100_000 } }
  ])
})

test('PiAcpAgent: newSession publishes context usage only after the response is returned', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  proc.sessionStats = { contextUsage: { tokens: 1_234, contextWindow: 100_000 } }
  proc.getState = async () => ({ thinkingLevel: 'medium' })
  const session = makeSession(proc, conn)

  const agent = new PiAcpAgent(asAgentConn(conn), {} as any)
  ;(agent as any).sessions = new FakeSessions(session) as any

  const result = await agent.newSession({ cwd: process.cwd(), mcpServers: [] } as any)
  assert.equal(result.sessionId, 's1')
  assert.equal(
    conn.updates.some(u => u.update.sessionUpdate === 'usage_update'),
    false
  )

  await drainScheduledWork()

  assert.deepEqual(
    conn.updates.filter(u => u.update.sessionUpdate === 'usage_update'),
    [{ sessionId: 's1', update: { sessionUpdate: 'usage_update', used: 1_234, size: 100_000 } }]
  )
})

test('PiAcpAgent: newSession tolerates a failing get_session_stats', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  proc.sessionStatsError = new Error('pi get_session_stats failed: unsupported')
  proc.getState = async () => ({ thinkingLevel: 'medium' })
  const session = makeSession(proc, conn)

  const agent = new PiAcpAgent(asAgentConn(conn), {} as any)
  ;(agent as any).sessions = new FakeSessions(session) as any

  const result = await agent.newSession({ cwd: process.cwd(), mcpServers: [] } as any)
  assert.equal(result.sessionId, 's1')

  await drainScheduledWork()

  assert.equal(
    conn.updates.some(u => u.update.sessionUpdate === 'usage_update'),
    false
  )
})

test('PiAcpAgent: switching the model config option refreshes context usage', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  const state: { thinkingLevel: string; model: { provider: string; id: string } } = {
    thinkingLevel: 'medium',
    model: { provider: 'test', id: 'alpha' }
  }
  proc.getAvailableModels = async () => ({
    models: [
      { provider: 'test', id: 'alpha', name: 'Alpha' },
      { provider: 'test', id: 'beta', name: 'Beta' }
    ]
  })
  proc.getState = async () => state
  ;(proc as any).setModel = async (provider: string, modelId: string) => {
    state.model = { provider, id: modelId }
    proc.sessionStats = { contextUsage: { tokens: 500, contextWindow: modelId === 'beta' ? 200_000 : 100_000 } }
  }
  proc.sessionStats = { contextUsage: { tokens: 500, contextWindow: 100_000 } }

  const session = makeSession(proc, conn)
  const agent = new PiAcpAgent(asAgentConn(conn), {} as any)
  ;(agent as any).sessions = new FakeSessions(session) as any

  await agent.setSessionConfigOption({ sessionId: 's1', configId: 'model', value: 'test/beta' } as any)

  assert.deepEqual(
    conn.updates.map(u => u.update.sessionUpdate),
    ['config_option_update', 'usage_update']
  )
  assert.deepEqual(conn.updates.at(-1), {
    sessionId: 's1',
    update: { sessionUpdate: 'usage_update', used: 500, size: 200_000 }
  })
})

test('PiAcpAgent: unstable_setSessionModel refreshes context usage', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  const state: { thinkingLevel: string; model: { provider: string; id: string } } = {
    thinkingLevel: 'medium',
    model: { provider: 'test', id: 'alpha' }
  }
  proc.getAvailableModels = async () => ({
    models: [
      { provider: 'test', id: 'alpha', name: 'Alpha' },
      { provider: 'test', id: 'beta', name: 'Beta' }
    ]
  })
  proc.getState = async () => state
  ;(proc as any).setModel = async (provider: string, modelId: string) => {
    state.model = { provider, id: modelId }
    proc.sessionStats = { contextUsage: { tokens: 700, contextWindow: modelId === 'beta' ? 200_000 : 100_000 } }
  }
  proc.sessionStats = { contextUsage: { tokens: 700, contextWindow: 100_000 } }

  const session = makeSession(proc, conn)
  const agent = new PiAcpAgent(asAgentConn(conn), {} as any)
  ;(agent as any).sessions = new FakeSessions(session) as any

  await agent.unstable_setSessionModel({ sessionId: 's1', modelId: 'test/beta' })

  assert.equal(proc.getSessionStatsCount, 1)
  assert.deepEqual(
    conn.updates.map(u => u.update.sessionUpdate),
    ['config_option_update', 'usage_update']
  )
  assert.deepEqual(conn.updates.at(-1), {
    sessionId: 's1',
    update: { sessionUpdate: 'usage_update', used: 700, size: 200_000 }
  })
})

test('PiAcpAgent: switching the thinking level does not publish context usage', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  const state: { thinkingLevel: string; model: { provider: string; id: string } } = {
    thinkingLevel: 'medium',
    model: { provider: 'test', id: 'alpha' }
  }
  proc.getState = async () => state
  ;(proc as any).setThinkingLevel = async (level: string) => {
    state.thinkingLevel = level
  }
  proc.sessionStats = { contextUsage: { tokens: 500, contextWindow: 100_000 } }

  const session = makeSession(proc, conn)
  const agent = new PiAcpAgent(asAgentConn(conn), {} as any)
  ;(agent as any).sessions = new FakeSessions(session) as any

  await agent.setSessionConfigOption({ sessionId: 's1', configId: 'thought_level', value: 'high' } as any)

  assert.equal(proc.getSessionStatsCount, 0)
  assert.equal(
    conn.updates.some(u => u.update.sessionUpdate === 'usage_update'),
    false
  )
})

test('PiAcpAgent: a settled turn fetches session stats once for usage_update and prompt usage', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  proc.sessionStats = {
    tokens: { input: 10, output: 5, total: 15 },
    cost: 0.5,
    contextUsage: { tokens: 300, contextWindow: 100_000 }
  }
  const session = makeSession(proc, conn)
  const agent = new PiAcpAgent(asAgentConn(conn), {} as any)

  const p = session.prompt('hello')
  proc.emit({ type: 'agent_settled' })
  assert.equal(await p, 'end_turn')

  const usage = await (agent as any).collectTurnUsage(session)

  assert.equal(proc.getSessionStatsCount, 1)
  assert.deepEqual(usage, { totalTokens: 15, inputTokens: 10, outputTokens: 5, _meta: { piAcp: { cost: 0.5 } } })
  assert.deepEqual(
    conn.updates.filter(u => u.update.sessionUpdate === 'usage_update').map(u => u.update),
    [{ sessionUpdate: 'usage_update', used: 300, size: 100_000, cost: { amount: 0.5, currency: 'USD' } }]
  )
})

test('PiAcpAgent: a turn that ends without settling fetches session stats for prompt usage', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  proc.sessionStats = { tokens: { input: 1, output: 2, total: 3 } }
  const session = makeSession(proc, conn)
  const agent = new PiAcpAgent(asAgentConn(conn), {} as any)

  const usage = await (agent as any).collectTurnUsage(session)

  assert.equal(proc.getSessionStatsCount, 1)
  assert.deepEqual(usage, { totalTokens: 3, inputTokens: 1, outputTokens: 2 })
})

test('PiAcpSession: usage_update includes cost only when pi reports a usable amount', async () => {
  const cases: Array<{ cost: unknown; expected: unknown }> = [
    { cost: 1.25, expected: { amount: 1.25, currency: 'USD' } },
    { cost: 0, expected: { amount: 0, currency: 'USD' } },
    { cost: undefined, expected: undefined },
    { cost: -1, expected: undefined },
    { cost: Number.NaN, expected: undefined },
    { cost: '3', expected: undefined }
  ]
  for (const { cost, expected } of cases) {
    const conn = new FakeAgentSideConnection()
    const proc = new FakePiRpcProcess()
    proc.sessionStats = { cost, contextUsage: { tokens: 10, contextWindow: 100 } } as any

    await makeSession(proc, conn).publishContextUsage()

    const update = conn.updates[0]?.update as { cost?: unknown } | undefined
    assert.deepEqual(update?.cost, expected, `cost ${String(cost)}`)
  }
})
