import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PiRpcProcess } from '../../src/pi-rpc/process.js'
import { writeNodeExecutable } from '../helpers/fake-executable.js'

// Process startup is slower on Windows (cmd.exe launcher); poll instead of a fixed sleep.
async function waitUntil(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate() && Date.now() < deadline) await new Promise(r => setTimeout(r, 20))
}

test('PiRpcProcess: silent RPC requests reject at the configured deadline', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-acp-silent-rpc-'))
  const executable = writeNodeExecutable(dir, 'silent-pi', 'process.stdin.resume()\n')

  const startedAt = Date.now()
  const proc = await PiRpcProcess.spawn({ cwd: dir, piCommand: executable, requestTimeoutMs: 40 })

  await assert.rejects(proc.getState(), /pi RPC get_state timed out after 40ms/)
  assert.ok(Date.now() - startedAt < 1_000)

  proc.dispose()
  assert.equal(await proc.waitForExit(), true)
})

test('PiRpcProcess retains a stderr tail for diagnostics (P1-3 audit)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-acp-stderr-'))
  const executable = writeNodeExecutable(
    dir,
    'noisy-pi',
    'process.stderr.write("warn one\\n")\nprocess.stderr.write("warn two\\n")\nprocess.stdin.resume()\n'
  )

  const proc = await PiRpcProcess.spawn({ cwd: dir, piCommand: executable, requestTimeoutMs: 40 })
  await waitUntil(() => proc.stderrTailLines(10).length >= 2)
  assert.deepEqual(proc.stderrTailLines(10), ['warn one', 'warn two'])

  proc.dispose()
  await proc.waitForExit()
})

test('PiRpcProcess stderr tail is bounded', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-acp-stderr-'))
  const body = Array.from({ length: 300 }, (_, i) => `process.stderr.write('line ${i}\\n')`).join('\n')
  const executable = writeNodeExecutable(dir, 'noisy-pi', `${body}\nprocess.stdin.resume()\n`)

  const proc = await PiRpcProcess.spawn({ cwd: dir, piCommand: executable, requestTimeoutMs: 40 })
  await waitUntil(() => proc.stderrTailLines().at(-1) === 'line 299')
  const tail = proc.stderrTailLines()
  assert.ok(tail.length <= 40, `tail length ${tail.length}`)
  assert.equal(tail[0], 'line 260')
  assert.equal(tail[tail.length - 1], 'line 299')

  proc.dispose()
  await proc.waitForExit()
})
