import { chmodSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Writes a Node script as a command the adapter can launch like pi: a `#!` script on Unix,
 * and on Windows a `.cmd` launcher calling Node (how npm installs pi there). `source` is
 * CommonJS. Returns the path to use as PI_ACP_PI_COMMAND.
 */
export function writeNodeExecutable(dir: string, name: string, source: string): string {
  if (process.platform === 'win32') {
    const script = join(dir, `${name}.cjs`)
    writeFileSync(script, source)
    const launcher = join(dir, `${name}.cmd`)
    writeFileSync(launcher, `@"${process.execPath}" "%~dp0${name}.cjs" %*\r\n`)
    return launcher
  }
  const executable = join(dir, name)
  writeFileSync(executable, `#!/usr/bin/env node\n${source}`)
  chmodSync(executable, 0o755)
  return executable
}
