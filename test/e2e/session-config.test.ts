import test from 'node:test'
import assert from 'node:assert/strict'
import { E2EClient } from './harness.js'

// Thinking levels are a `thought_level` config option. Sending them as legacy session
// `modes` too made clients like IntelliJ show two thinking selectors.
test('e2e: thinking levels are offered only as the thought_level config option', async () => {
  const c = E2EClient.start({ script: { responses: [{ content: [{ text: 'ok' }] }] } })
  try {
    const created = await c.newSession()
    assert.equal((created as { modes?: unknown }).modes, undefined, 'session/new sends no modes')

    const thought = created.configOptions?.find(o => o.category === 'thought_level')
    assert.ok(thought && thought.type === 'select', 'thought_level option present')
    const levels = thought.options.map(o => ('value' in o ? o.value : undefined))
    assert.ok(levels.includes('high'), `levels: ${levels.join(', ')}`)

    const res = await c.conn.setSessionConfigOption({
      sessionId: created.sessionId,
      configId: thought.id,
      value: 'high'
    })
    const updated = res.configOptions.find(o => o.id === thought.id)
    assert.equal(updated?.currentValue, 'high')
    assert.equal(c.updatesOf('current_mode_update').length, 0, 'no legacy mode updates')

    const loaded = await c.loadSession(created.sessionId)
    assert.equal((loaded as { modes?: unknown }).modes, undefined, 'session/load sends no modes')
  } finally {
    await c.close()
  }
})
