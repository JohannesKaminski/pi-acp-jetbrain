import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSelectionPointer, renderSelections } from '../../src/acp/translate/selection.js'

const pointerBlock = (selections: unknown, extra: Record<string, unknown> = {}) => ({
  type: 'resource',
  resource: {
    uri: 'file:///work/project/src/a.ts',
    mimeType: 'application/json',
    text: JSON.stringify({ offsetEncoding: 'byte', selections, ...extra })
  }
})

test('parseSelectionPointer: recognizes only well-formed byte-offset pointers', () => {
  assert.deepEqual(parseSelectionPointer(pointerBlock([{ startOffset: 1, endOffset: 4 }])), {
    path: '/work/project/src/a.ts',
    selections: [{ start: 1, end: 4 }]
  })
  assert.equal(parseSelectionPointer(pointerBlock([])), null)
  assert.equal(parseSelectionPointer(pointerBlock([{ startOffset: 1.5, endOffset: 4 }])), null)
  assert.equal(
    parseSelectionPointer(pointerBlock([{ startOffset: 1, endOffset: 4 }], { offsetEncoding: 'utf16' })),
    null
  )
  assert.equal(
    parseSelectionPointer({ type: 'resource', resource: { uri: 'file:///a', mimeType: 'text/plain', text: '{}' } }),
    null
  )
  assert.equal(parseSelectionPointer({ type: 'resource_link', uri: 'file:///a' }), null)
  assert.equal(parseSelectionPointer({ type: 'text', text: 'hi' }), null)
})

test('renderSelections: cuts bytes, counts lines, and handles edge cases', () => {
  const content = 'one\ntwo\nthree\n'
  const cwd = '/work/project'
  const p = (start: number, end: number) => ({ path: '/work/project/src/a.ts', selections: [{ start, end }] })

  assert.equal(renderSelections(content, p(4, 7), cwd), 'Selection in src/a.ts, line 2:\n```\ntwo\n```')
  // Ending right after a newline stays on the last selected line.
  assert.equal(renderSelections(content, p(4, 8), cwd), 'Selection in src/a.ts, line 2:\n```\ntwo\n\n```')
  assert.match(renderSelections(content, p(0, 13), cwd)!, /lines 1–3/)
  // Stale or empty ranges fall back (null).
  assert.equal(renderSelections(content, p(4, 999), cwd), null)
  assert.equal(renderSelections(content, p(5, 5), cwd), null)
  // Code containing a fence gets a longer one.
  assert.match(renderSelections('```js\nx\n```', p(0, 11), cwd)!, /^Selection in src\/a\.ts, lines 1–3:\n````\n/)
  // Several selections, and a path outside the cwd stays absolute.
  const two = {
    path: '/elsewhere/b.ts',
    selections: [
      { start: 0, end: 3 },
      { start: 8, end: 13 }
    ]
  }
  assert.equal(
    renderSelections(content, two, cwd),
    'Selection in /elsewhere/b.ts, line 1:\n```\none\n```\n\nSelection in /elsewhere/b.ts, line 3:\n```\nthree\n```'
  )
})
