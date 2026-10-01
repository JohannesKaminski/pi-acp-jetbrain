import test from 'node:test'
import assert from 'node:assert/strict'
import { lineTap, summarizeMessage } from '../../src/acp/debug-log.js'

test('summarizeMessage: keeps methods, ids and option values; hides content and secrets', () => {
  const summary = summarizeMessage({
    jsonrpc: '2.0',
    id: 7,
    method: 'session/prompt',
    params: {
      sessionId: 's1',
      prompt: [
        { type: 'text', text: 'my private prompt' },
        { type: 'image', mimeType: 'image/png', data: 'AAAA' }
      ],
      mcpServers: [{ name: 'x', command: 'run', env: [{ name: 'TOKEN', value: 'secret' }], headers: { a: 'b' } }],
      _meta: { ideThinking: 'minimal' }
    }
  })

  assert.deepEqual(summary, {
    id: 7,
    method: 'session/prompt',
    params: {
      sessionId: 's1',
      prompt: [
        { type: 'text', text: '[17 chars]' },
        { type: 'image', mimeType: 'image/png', data: '[4 chars]' }
      ],
      mcpServers: [{ name: 'x', command: 'run', env: '[redacted]', headers: '[redacted]' }],
      _meta: { ideThinking: 'minimal' }
    }
  })
})

test('summarizeMessage: truncates long strings and arrays', () => {
  const summary = summarizeMessage({
    method: 'm',
    params: { s: 'x'.repeat(250), a: Array.from({ length: 25 }, (_, i) => i) }
  })
  const params = summary.params as { s: string; a: unknown[] }
  assert.match(params.s, /…\[250 chars\]$/)
  assert.equal(params.a.length, 21)
  assert.equal(params.a.at(-1), '…[5 more]')
})

test('lineTap: reassembles lines split across chunks, including multi-byte characters', () => {
  const lines: string[] = []
  const tap = lineTap(line => lines.push(line))
  const bytes = new TextEncoder().encode('{"a":"ü"}\n{"b":1}\n\n{"c"')
  tap(bytes.slice(0, 7)) // splits the two-byte "ü"
  tap(bytes.slice(7))
  tap(new TextEncoder().encode(':2}\n'))
  assert.deepEqual(lines, ['{"a":"ü"}', '{"b":1}', '{"c":2}'])
})
