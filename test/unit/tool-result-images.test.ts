import test from 'node:test'
import assert from 'node:assert/strict'
import { toolResultImages, withoutImageData } from '../../src/acp/translate/pi-tools.js'

const result = {
  content: [
    { type: 'text', text: 'Generated 1 image' },
    { type: 'image', data: 'QUJD', mimeType: 'image/png' },
    { type: 'image', data: 42, mimeType: 'image/png' }
  ],
  details: { prompt: 'a dot' }
}

test('toolResultImages: maps well-formed image blocks to ACP image content', () => {
  assert.deepEqual(toolResultImages(result), [
    { type: 'content', content: { type: 'image', data: 'QUJD', mimeType: 'image/png' } }
  ])
  assert.deepEqual(toolResultImages({ content: 'text only' }), [])
  assert.deepEqual(toolResultImages(null), [])
})

test('withoutImageData: replaces image bytes for rawOutput and leaves other results untouched', () => {
  const stripped = withoutImageData(result)
  assert.deepEqual(stripped.content[1], {
    type: 'image',
    data: '[4 base64 chars, sent as image content]',
    mimeType: 'image/png'
  })
  assert.deepEqual(stripped.content[0], result.content[0])
  assert.deepEqual(stripped.details, result.details)
  assert.equal(result.content[1]!.data, 'QUJD', 'the original is not mutated')

  const textOnly = { content: [{ type: 'text', text: 'hi' }] }
  assert.equal(withoutImageData(textOnly), textOnly)
})
