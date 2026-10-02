// Packaging check: pack the npm tarball, install it into a clean temporary prefix, and
// confirm the installed `pi-acp` starts and answers `initialize`. Catches anything that
// works only inside this repo, e.g. a runtime import of a devDependency such as
// pi-coding-agent (installs don't have it). Doesn't need pi: initialize never spawns it.
import crossSpawn from 'cross-spawn'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'pi-acp-pack-'))
// cross-spawn runs Windows .cmd launchers (npm, pi-acp), which Node refuses without a shell.
function run(command, args, cwd) {
  const result = crossSpawn.sync(command, args, { cwd, stdio: ['ignore', 'ignore', 'inherit'] })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args[0]} exited with ${result.status}`)
}

function fail(message) {
  console.error(`FAIL check-pack: ${message}`)
  rmSync(work, { recursive: true, force: true })
  process.exit(1)
}

try {
  // Pack (which builds via prepare) and find the tarball on disk. npm's stdout differs between
  // versions (npm 10 interleaves the build log even with --json), so it isn't parsed.
  run('npm', ['pack', '--pack-destination', work], root)
  const tarballName = readdirSync(work).find(name => name.endsWith('.tgz'))
  if (!tarballName) fail('npm pack produced no tarball')
  const tarball = join(work, tarballName)
  const prefix = join(work, 'prefix')
  run('npm', ['install', '-g', '--prefix', prefix, tarball, '--no-audit', '--no-fund'], work)

  const pkgDir =
    process.platform === 'win32'
      ? join(prefix, 'node_modules', 'pi-acp-jetbrain')
      : join(prefix, 'lib', 'node_modules', 'pi-acp-jetbrain')
  // Every built entry (adapter and bundled pi extensions) must be in the installed package.
  const extensions = readdirSync(join(root, 'dist', 'pi-extension')).filter(name => name.endsWith('.js'))
  for (const file of ['dist/index.js', ...extensions.map(name => `dist/pi-extension/${name}`)]) {
    if (!existsSync(join(pkgDir, file))) fail(`installed package is missing ${file}`)
  }

  const bin = process.platform === 'win32' ? join(prefix, 'pi-acp.cmd') : join(prefix, 'bin', 'pi-acp')
  const result = await new Promise((resolvePromise, reject) => {
    const child = crossSpawn(bin, [], { cwd: work, stdio: ['pipe', 'pipe', 'pipe'] })
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

  console.log(`OK check-pack (${tarballName}: clean install starts and answers initialize)`)
  rmSync(work, { recursive: true, force: true })
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
