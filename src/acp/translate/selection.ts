import { isAbsolute, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// IntelliJ attaches an editor selection as an embedded `resource` holding a JSON pointer in
// byte offsets, not the selected text:
//   {"description": "Byte offsets of selected text in filePath...", "offsetEncoding": "byte",
//    "selections": [{"startOffset": 440, "endOffset": 966}]}
// pi's read tool works in lines, so the adapter resolves the pointer into the text itself.

export type SelectionPointer = { path: string; selections: Array<{ start: number; end: number }> }

// Large selections stay pointers rather than flooding the prompt.
const MAX_SELECTION_BYTES = 100_000

/** Recognizes an IntelliJ selection pointer block; anything else returns null. */
export function parseSelectionPointer(block: unknown): SelectionPointer | null {
  const b = block as { type?: unknown; resource?: { uri?: unknown; mimeType?: unknown; text?: unknown } }
  const r = b?.type === 'resource' ? b.resource : undefined
  if (r?.mimeType !== 'application/json' || typeof r.text !== 'string' || typeof r.uri !== 'string') return null
  if (!r.uri.startsWith('file:')) return null
  let data: { offsetEncoding?: unknown; selections?: unknown }
  try {
    data = JSON.parse(r.text)
  } catch {
    return null
  }
  if (data?.offsetEncoding !== 'byte' || !Array.isArray(data.selections) || data.selections.length === 0) return null
  const selections: SelectionPointer['selections'] = []
  for (const s of data.selections as Array<{ startOffset?: unknown; endOffset?: unknown }>) {
    const start = s?.startOffset
    const end = s?.endOffset
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null
    selections.push({ start: start as number, end: end as number })
  }
  try {
    return { path: fileURLToPath(r.uri), selections }
  } catch {
    return null
  }
}

/**
 * The selected text of each range with its line range, as prompt text. Returns null when a
 * range doesn't fit the file (stale offsets), is empty, or is too large.
 */
export function renderSelections(content: string, pointer: SelectionPointer, cwd: string): string | null {
  const bytes = Buffer.from(content, 'utf8')
  const shown = displayPath(pointer.path, cwd)
  const parts: string[] = []
  for (const { start, end } of pointer.selections) {
    if (start < 0 || end <= start || end > bytes.length || end - start > MAX_SELECTION_BYTES) return null
    const text = bytes.subarray(start, end).toString('utf8')
    const firstLine = countNewlines(bytes, 0, start) + 1
    // A selection ending right after a newline doesn't reach into the next line.
    const lastLine = countNewlines(bytes, 0, end - 1) + 1
    const lines = firstLine === lastLine ? `line ${firstLine}` : `lines ${firstLine}–${lastLine}`
    const fence = text.includes('```') ? '````' : '```'
    parts.push(`Selection in ${shown}, ${lines}:\n${fence}\n${text}\n${fence}`)
  }
  return parts.join('\n\n')
}

function countNewlines(bytes: Buffer, from: number, to: number): number {
  let n = 0
  for (let i = from; i < to; i++) if (bytes[i] === 0x0a) n++
  return n
}

function displayPath(path: string, cwd: string): string {
  const rel = relative(cwd, path)
  return rel && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel) ? rel : path
}
