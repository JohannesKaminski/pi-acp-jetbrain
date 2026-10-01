// Smoke: legacy session/set_mode still sets the thinking level; the change is reported
// only as a config_option_update (no current_mode_update: thinking levels are not modes).
import { SmokeHarness, assert } from './lib/acp-smoke.mjs'

const h = new SmokeHarness().start()
try {
  await h.expectResult(1, 'initialize', { protocolVersion: 1 })
  const created = await h.expectResult(2, 'session/new', { cwd: process.cwd(), mcpServers: [] })
  assert(typeof created?.sessionId === 'string', 'missing sessionId')

  await h.expectResult(3, 'session/set_mode', { sessionId: created.sessionId, modeId: 'low' }, { timeoutMs: 30_000 })
  const lowLevel = u =>
    u?.sessionUpdate === 'config_option_update' &&
    u.configOptions?.some?.(o => o?.category === 'thought_level' && o.currentValue === 'low')
  await h.waitForUpdate(lowLevel, { timeoutMs: 15_000 })
  assert(!h.updates.some(u => u?.sessionUpdate === 'current_mode_update'), 'unexpected current_mode_update')

  console.log('OK smoke-modes (set_mode applied; config_option_update observed)')
} catch (err) {
  await h.close().catch(() => {})
  console.error(`FAIL smoke-modes: ${err.message}`)
  if (h.stderr.length) console.error('adapter stderr tail:\n' + h.stderr.slice(-20).join(''))
  process.exit(1)
}
await h.close()
h.assertExited(0)
