import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { E2EClient } from './harness.js'

test('e2e: PI_ACP_DEBUG_ACP logs incoming methods and error responses without prompt text', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-acp-debug-'))
  const logFile = join(dir, 'acp.log')
  const c = E2EClient.start({
    env: { PI_ACP_DEBUG_ACP: logFile },
    script: { responses: [{ content: [{ text: 'ok' }] }] }
  })
  try {
    const { sessionId } = await c.newSession()
    await c.conn.setSessionConfigOption({ sessionId, configId: 'thought_level', value: 'high' })
    await c.prompt(sessionId, 'SECRET-PROMPT-TEXT')
    await assert.rejects(c.conn.extMethod('vendor/unknown', { probe: 1 }))

    const lines = readFileSync(logFile, 'utf8')
      .trim()
      .split('\n')
      .map(l => JSON.parse(l) as { dir: string; method?: string; params?: any; error?: any })
    const methods = lines.filter(l => l.dir === 'in').map(l => l.method)
    for (const m of ['initialize', 'session/new', 'session/set_config_option', 'session/prompt', 'vendor/unknown']) {
      assert.ok(methods.includes(m), `logged ${m}: ${methods.join(', ')}`)
    }

    const set = lines.find(l => l.method === 'session/set_config_option' && l.params?.configId === 'thought_level')
    assert.ok(set, 'thought_level change logged')
    assert.equal(set?.params?.value, 'high')

    const raw = readFileSync(logFile, 'utf8')
    assert.ok(!raw.includes('SECRET-PROMPT-TEXT'), 'prompt text is not logged')
    assert.ok(
      lines.some(l => l.dir === 'out' && l.error),
      'the error response to the unknown method is logged'
    )
  } finally {
    await c.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
