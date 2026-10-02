import { spawn, type ChildProcess } from 'node:child_process'

/**
 * Stops a child process and everything it started. On Windows `kill()` ends only the direct
 * child: for a `.cmd` launcher (pi, npx) that is cmd.exe, and the real program keeps running.
 * `taskkill /T` ends the whole tree there.
 */
export function terminateProcessTree(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32' && child.pid !== undefined) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on(
        'error',
        () => {}
      )
    } catch {
      // Fall through to kill() below.
    }
    return
  }
  try {
    child.kill(signal)
  } catch {
    // The process may have exited between the check and kill.
  }
}
