import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { E2EClient } from './harness.js'

// A valid 1×1 PNG.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

test('e2e: images in tool results reach the client as image content, live and on reload', async () => {
  const c = E2EClient.start({
    script: {
      responses: [{ content: [{ tool: 'read', args: { path: 'dot.png' } }] }, { content: [{ text: 'a dot' }] }]
    }
  })
  try {
    writeFileSync(join(c.workspace, 'dot.png'), PNG_1X1)
    const { sessionId } = await c.newSession()
    assert.equal((await c.prompt(sessionId, 'look')).stopReason, 'end_turn')

    const images = () =>
      c
        .updatesOf('tool_call_update')
        .flatMap(u => u.content ?? [])
        .filter(item => item.type === 'content' && item.content.type === 'image')
    const live = images()
    assert.equal(live.length, 1, 'the read result carries the image')
    const image = live[0]!
    assert.ok(image.type === 'content' && image.content.type === 'image')
    assert.equal(image.content.mimeType, 'image/png')
    assert.ok(image.content.data.length > 0)

    await c.loadSession(sessionId)
    assert.equal(images().length, 2, 'session/load replays the image too')
  } finally {
    await c.close()
  }
})
