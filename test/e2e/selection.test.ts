import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ClientCapabilities } from '@agentclientprotocol/sdk'
import { E2EClient } from './harness.js'

// What IntelliJ sends for "file + selection": a link plus a JSON pointer in byte offsets.
function intellijPrompt(file: string, startOffset: number, endOffset: number) {
  const uri = pathToFileURL(file).href
  return [
    { type: 'text' as const, text: 'what does this do?' },
    { type: 'resource_link' as const, uri, name: 'notes.txt' },
    {
      type: 'resource' as const,
      resource: {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          description:
            'Byte offsets of selected text in filePath.\nUse these offsets to read selected text if it is required.',
          offsetEncoding: 'byte',
          selections: [{ startOffset, endOffset }]
        })
      }
    }
  ]
}

async function userTextFor(opts: {
  disk: string
  editor?: string
  start: number
  end: number
  clientCapabilities?: ClientCapabilities
}): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'pi-acp-sel-'))
  const capture = join(dir, 'requests.jsonl')
  const c = E2EClient.start({
    clientCapabilities: opts.clientCapabilities,
    env: { PI_ACP_E2E_CAPTURE: capture },
    script: { responses: [{ content: [{ text: 'ok' }] }] }
  })
  try {
    const file = join(c.workspace, 'notes.txt')
    writeFileSync(file, opts.disk)
    if (opts.editor !== undefined) c.editorFiles.set(file, opts.editor)
    const { sessionId } = await c.newSession()
    await c.conn.prompt({ sessionId, prompt: intellijPrompt(file, opts.start, opts.end) })
    return (JSON.parse(readFileSync(capture, 'utf8').trim().split('\n')[0]!) as { userText: string }).userText
  } finally {
    await c.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

test('e2e: an IntelliJ selection pointer reaches pi as the selected text with its line range', async () => {
  const disk = 'line one\nline two – ü\nline three\nline four\n'
  // Bytes of "line two – ü\nline three" (the en dash and ü are multi-byte in UTF-8).
  const start = Buffer.byteLength('line one\n')
  const end = start + Buffer.byteLength('line two – ü\nline three')
  const text = await userTextFor({ disk, start, end })

  assert.match(text, /Selection in notes\.txt, lines 2–3/)
  assert.match(text, /\n\nSelection in notes\.txt/, 'the selection starts on its own line after the file link')
  assert.match(text, /line two – ü\nline three/)
  assert.doesNotMatch(text, /Byte offsets/, 'the raw pointer is replaced')
})

test('e2e: with editor file access the selection is cut from the editor text, not the disk', async () => {
  const editor = 'unsaved first line\nselected words here\n'
  const start = Buffer.byteLength('unsaved first line\n')
  const text = await userTextFor({
    disk: 'something else entirely\n',
    editor,
    start,
    end: start + Buffer.byteLength('selected words'),
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } }
  })
  assert.match(text, /Selection in notes\.txt, line 2\b/)
  assert.match(text, /selected words/)
})

test('e2e: an unusable pointer falls back to passing it through unchanged', async () => {
  const text = await userTextFor({ disk: 'short\n', start: 2, end: 999 })
  assert.match(text, /Byte offsets/)
})
