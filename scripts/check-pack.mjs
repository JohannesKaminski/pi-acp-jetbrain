// Packaging check: pack the npm tarball, install it into a clean temporary prefix, and
// confirm the installed `pi-acp` starts and answers `initialize`. Catches anything that
// works only inside this repo, e.g. a runtime import of a devDependency such as
// pi-coding-agent (installs don't have it). Doesn't need pi: initialize never spawns it.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'pi-acp-pack-'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function fail(message) {
  console.error(`FAIL check-pack: ${message}`)
  rmSync(work, { recursive: true, force: true })
  process.exit(1)
}

try {
  // Build first, then pack without lifecycle scripts so `--json` output stays parseable.
  execFileSync(npm, ['run', 'build'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] })
  const packJson = JSON.parse(
    execFileSync(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', work], {
      cwd: root,
      encoding: 'utf8'
    })
  )
  // npm ≤ 11 prints an array; npm 12 an object keyed by package name.
  const packed = [Array.isArray(packJson) ? packJson[0] : Object.values(packJson)[0]]
  const tarball = join(work, packed[0].filename)
  const prefix = join(work, 'prefix')
  execFileSync(npm, ['install', '-g', '--prefix', prefix, tarball, '--no-audit', '--no-fund'], {
    cwd: work,
    stdio: ['ignore', 'ignore', 'inherit']
  })

  const pkgDir =
    process.platform === 'win32'
      ? join(prefix, 'node_modules', 'pi-acp-jetbrain')
      : join(prefix, 'lib', 'node_modules', 'pi-acp-jetbrain')
  for (const file of [
    'dist/index.js',
    ...packed[0].files.map(f => f.path).filter(p => p.startsWith('dist/pi-extension/') && p.endsWith('.js'))
  ]) {
    if (!existsSync(join(pkgDir, file))) fail(`installed package is missing ${file}`)
  }

  const bin = process.platform === 'win32' ? join(prefix, 'pi-acp.cmd') : join(prefix, 'bin', 'pi-acp')
  const result = await new Promise((resolvePromise, reject) => {
    const child = spawn(bin, [], { cwd: work, stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`no initialize response within 15s; stderr:\n${stderr}`))
    }, 15_000)
    child.stdout.on('data', chunk => {
      stdout += chunk
      const line = stdout.split('\n').find(l => l.includes('"id":1'))
      if (line) {
        clearTimeout(timer)
        child.stdin.end()
        resolvePromise(JSON.parse(line))
      }
    })
    child.stderr.on('data', chunk => (stderr += chunk))
    child.on('exit', code => {
      clearTimeout(timer)
      if (!stdout.includes('"id":1'))
        reject(new Error(`pi-acp exited (code ${code}) before answering; stderr:\n${stderr}`))
    })
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } }) + '\n'
    )
  })
  if (result?.result?.protocolVersion !== 1) fail(`unexpected initialize response: ${JSON.stringify(result)}`)

  console.log(`OK check-pack (${packed[0].filename}: clean install starts and answers initialize)`)
  rmSync(work, { recursive: true, force: true })
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
