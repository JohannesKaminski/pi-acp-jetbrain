import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { E2EClient } from './harness.js'

async function startupInfo(quietStartup: unknown): Promise<string> {
  const c = E2EClient.start({ piSettings: { quietStartup }, script: { responses: [] } })
  try {
    // A context file gives the full block a section to list.
    writeFileSync(join(c.workspace, 'AGENTS.md'), '# Agents\n')
    const res = await c.newSession()
    return String((res._meta as { piAcp?: { startupInfo?: unknown } } | undefined)?.piAcp?.startupInfo ?? '')
  } finally {
    await c.close()
  }
}

test('e2e: the startup block follows pi quietStartup, including pi 1.0\'s "header" value', async () => {
  const full = await startupInfo(false)
  assert.match(full, /pi v\d+\.\d+\.\d+/)
  assert.match(full, /## Context/, 'full block lists loaded resources')

  // pi 1.0: "header" keeps the version header and hides the resource listing.
  const header = await startupInfo('header')
  assert.match(header, /pi-acp-jetbrain .*\(build /)
  assert.match(header, /pi v\d+\.\d+\.\d+/)
  assert.doesNotMatch(header, /## (Extensions|Skills|Prompts|Context)/)

  assert.equal(await startupInfo(true), '', 'quiet shows nothing (no update notice offline)')
})
