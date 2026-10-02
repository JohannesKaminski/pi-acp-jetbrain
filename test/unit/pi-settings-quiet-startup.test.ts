import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getQuietStartup, getQuietStartupMode } from '../../src/acp/pi-settings.js'

test('getQuietStartupMode: maps pi quietStartup values, project settings override global', () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-acp-quiet-'))
  const prev = process.env.PI_CODING_AGENT_DIR
  try {
    const agentDir = join(root, 'agent')
    const project = join(root, 'project')
    mkdirSync(agentDir)
    mkdirSync(join(project, '.pi'), { recursive: true })
    process.env.PI_CODING_AGENT_DIR = agentDir
    const setGlobal = (value: unknown) => writeFileSync(join(agentDir, 'settings.json'), JSON.stringify(value))

    const cases: Array<[unknown, string, boolean]> = [
      [{}, 'off', false],
      [{ quietStartup: false }, 'off', false],
      [{ quietStartup: true }, 'quiet', true],
      [{ quietStartup: 'header' }, 'header', true],
      [{ quietStartup: 'loud' }, 'off', false],
      [{ quietStart: true }, 'quiet', true]
    ]
    for (const [settings, mode, quiet] of cases) {
      setGlobal(settings)
      assert.equal(getQuietStartupMode(project), mode, JSON.stringify(settings))
      assert.equal(getQuietStartup(project), quiet, JSON.stringify(settings))
    }

    setGlobal({ quietStartup: true })
    writeFileSync(join(project, '.pi', 'settings.json'), JSON.stringify({ quietStartup: 'header' }))
    assert.equal(getQuietStartupMode(project), 'header')
  } finally {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = prev
    rmSync(root, { recursive: true, force: true })
  }
})
