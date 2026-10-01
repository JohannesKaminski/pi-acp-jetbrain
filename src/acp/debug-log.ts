import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

// Opt-in ACP traffic log for diagnosing client behavior (which methods a client sends,
// with which parameters). PI_ACP_DEBUG_ACP=1 logs to ~/.pi/pi-acp/acp-debug.log; any other
// value is used as the log file path. Logs every incoming message and outgoing error
// responses. Prompt text, image data, env and headers are reduced to placeholders.

const MAX_STRING = 200
const MAX_ARRAY = 20
const MAX_DEPTH = 6
// `text` covers prompt and resource text; `data`/`blob` cover images and binary resources.
const CONTENT_KEYS = new Set(['text', 'data', 'blob'])
const SECRET_KEYS = new Set(['env', 'headers', 'authorization', 'token', 'apiKey', 'api_key', 'password'])

export type AcpDebugLog = {
  incoming(line: string): void
  outgoing(line: string): void
}

export function createAcpDebugLog(setting: string | undefined): AcpDebugLog | null {
  if (!setting) return null
  const file = setting === '1' ? join(homedir(), '.pi', 'pi-acp', 'acp-debug.log') : setting
  try {
    mkdirSync(dirname(file), { recursive: true })
  } catch {
    return null
  }

  const write = (dir: 'in' | 'out', msg: Record<string, unknown>) => {
    try {
      appendFileSync(file, `${JSON.stringify({ t: new Date().toISOString(), pid: process.pid, dir, ...msg })}\n`)
    } catch {
      // Never let debug logging affect the adapter.
    }
  }

  return {
    incoming(line) {
      const msg = parse(line)
      if (msg) write('in', summarizeMessage(msg))
    },
    outgoing(line) {
      const msg = parse(line)
      // Outgoing traffic is mostly session updates; only errors help diagnose a client.
      if (msg && msg.error !== undefined) write('out', summarizeMessage(msg))
    }
  }
}

function parse(line: string): Record<string, unknown> | null {
  try {
    const msg = JSON.parse(line)
    return msg && typeof msg === 'object' && !Array.isArray(msg) ? msg : null
  } catch {
    return null
  }
}

export function summarizeMessage(msg: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (msg.id !== undefined) out.id = msg.id
  if (typeof msg.method === 'string') out.method = msg.method
  if (msg.params !== undefined) out.params = summarize(msg.params, 0)
  if (msg.result !== undefined) out.result = summarize(msg.result, 0)
  if (msg.error !== undefined) out.error = summarize(msg.error, 0)
  return out
}

function summarize(value: unknown, depth: number, key?: string): unknown {
  if (key && SECRET_KEYS.has(key)) return '[redacted]'
  if (typeof value === 'string') {
    if (key && CONTENT_KEYS.has(key)) return `[${value.length} chars]`
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[${value.length} chars]` : value
  }
  if (value === null || typeof value !== 'object') return value
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? `[array(${value.length})]` : '[object]'
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY).map(item => summarize(item, depth + 1))
    if (value.length > MAX_ARRAY) items.push(`…[${value.length - MAX_ARRAY} more]`)
    return items
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) out[k] = summarize(v, depth + 1, k)
  return out
}

/** Splits a byte stream into newline-delimited lines (ACP stdio is NDJSON). */
export function lineTap(onLine: (line: string) => void): (chunk: Uint8Array) => void {
  const decoder = new TextDecoder()
  let buffer = ''
  return chunk => {
    buffer += decoder.decode(chunk, { stream: true })
    let nl = buffer.indexOf('\n')
    while (nl !== -1) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) onLine(line)
      nl = buffer.indexOf('\n')
    }
  }
}
