import test from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseSelectionPointer, renderSelections } from '../../src/acp/translate/selection.js'

// Platform-native paths: on Windows these resolve under the current drive.
const CWD = resolve('/work/project')
const FILE = join(CWD, 'src', 'a.ts')
const SHOWN = join('src', 'a.ts')

const pointerBlock = (selections: unknown, extra: Record<string, unknown> = {}) => ({
  type: 'resource',
  resource: {
    uri: pathToFileURL(FILE).href,
    mimeType: 'application/json',
    text: JSON.stringify({ offsetEncoding: 'byte', selections, ...extra })
  }
})

test('parseSelectionPointer: recognizes only well-formed byte-offset pointers', () => {
  assert.deepEqual(parseSelectionPointer(pointerBlock([{ startOffset: 1, endOffset: 4 }])), {
    path: FILE,
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
  const cwd = CWD
  const p = (start: number, end: number) => ({ path: FILE, selections: [{ start, end }] })

  assert.equal(renderSelections(content, p(4, 7), cwd), `Selection in ${SHOWN}, line 2:\n\`\`\`\ntwo\n\`\`\``)
  // Ending right after a newline stays on the last selected line.
  assert.equal(renderSelections(content, p(4, 8), cwd), `Selection in ${SHOWN}, line 2:\n\`\`\`\ntwo\n\n\`\`\``)
  assert.match(renderSelections(content, p(0, 13), cwd)!, /lines 1–3/)
  // Stale or empty ranges fall back (null).
  assert.equal(renderSelections(content, p(4, 999), cwd), null)
  assert.equal(renderSelections(content, p(5, 5), cwd), null)
  // Code containing a fence gets a longer one.
  assert.ok(
    renderSelections('```js\nx\n```', p(0, 11), cwd)!.startsWith(`Selection in ${SHOWN}, lines 1–3:\n\`\`\`\`\n`)
  )
  // Several selections, and a path outside the cwd stays absolute.
  const two = {
    path: resolve('/elsewhere/b.ts'),
    selections: [
      { start: 0, end: 3 },
      { start: 8, end: 13 }
    ]
  }
  assert.equal(
    renderSelections(content, two, cwd),
    `Selection in ${resolve('/elsewhere/b.ts')}, line 1:\n\`\`\`\none\n\`\`\`\n\nSelection in ${resolve('/elsewhere/b.ts')}, line 3:\n\`\`\`\nthree\n\`\`\``
  )
})
