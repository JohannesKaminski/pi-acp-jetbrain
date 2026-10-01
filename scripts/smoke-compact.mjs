// Smoke: /compact on a too-small session is a normal answer, not an error: the turn
// ends with end_turn and the chat says there is nothing to compact yet.
import { SmokeHarness, assert } from './lib/acp-smoke.mjs'

const h = new SmokeHarness().start()
try {
  await h.expectResult(1, 'initialize', { protocolVersion: 1 })
  const created = await h.expectResult(2, 'session/new', { cwd: process.cwd(), mcpServers: [] })
  const res = await h.expectResult(3, 'session/prompt', {
    sessionId: created?.sessionId,
    prompt: [{ type: 'text', text: '/compact Keep it short' }]
  })
  assert(res?.stopReason === 'end_turn', `unexpected stopReason: ${res?.stopReason}`)
  await h.waitForUpdate(
    u => u?.sessionUpdate === 'agent_message_chunk' && /Nothing to compact yet/.test(u?.content?.text ?? ''),
    { timeoutMs: 15_000 }
  )
  console.log('OK smoke-compact (too-small session: end_turn with a "Nothing to compact yet" message)')
} catch (err) {
  await h.close().catch(() => {})
  console.error(`FAIL smoke-compact: ${err.message}`)
  if (h.stderr.length) console.error('adapter stderr tail:\n' + h.stderr.slice(-20).join(''))
  process.exit(1)
}
await h.close()
h.assertExited(0)
