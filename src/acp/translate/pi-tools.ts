import type { ToolCallContent } from '@agentclientprotocol/sdk'

type ImageBlock = { type: 'image'; data: string; mimeType: string }

function isImageBlock(block: unknown): block is ImageBlock {
  const b = block as Partial<ImageBlock> | null
  return b?.type === 'image' && typeof b.data === 'string' && typeof b.mimeType === 'string'
}

/**
 * Image blocks of a pi tool result as ACP tool-call content: pi's read tool on an image file,
 * codemode's generated images (pi 1.0 `models.generateImages()`), extension tools.
 */
export function toolResultImages(result: unknown): ToolCallContent[] {
  const content = (result as { content?: unknown } | null)?.content
  if (!Array.isArray(content)) return []
  return content
    .filter(isImageBlock)
    .map(block => ({ type: 'content', content: { type: 'image', data: block.data, mimeType: block.mimeType } }))
}

/**
 * The result with image bytes replaced by a size note, for `rawOutput`: the images already go out
 * as tool-call content, so this avoids sending every image twice.
 */
export function withoutImageData<T>(result: T): T {
  const content = (result as { content?: unknown } | null)?.content
  if (!Array.isArray(content) || !content.some(isImageBlock)) return result
  return {
    ...result,
    content: content.map(block =>
      isImageBlock(block) ? { ...block, data: `[${block.data.length} base64 chars, sent as image content]` } : block
    )
  }
}

export function toolResultToText(result: unknown): string {
  if (!result) return ''

  const details = (result as any)?.details

  // pi's edit tool returns a terse success message in content and the full unified diff in details.diff.
  const diff = details?.diff
  if (typeof diff === 'string' && diff.trim()) {
    return diff
  }

  // pi tool results generally look like: { content: [{type:"text", text:"..."}], details: {...} }
  const content = (result as { content?: unknown }).content
  if (Array.isArray(content)) {
    const texts = content
      .map((c: unknown) => {
        const block = c as { type?: unknown; text?: unknown } | null
        const text = block?.type === 'text' ? block.text : undefined
        return typeof text === 'string' ? text : ''
      })
      .filter(Boolean)
    if (texts.length) return texts.join('')
  }

  // The bash tool frequently returns stdout/stderr in `details` rather than content blocks.
  const stdout =
    (typeof details?.stdout === 'string' ? details.stdout : undefined) ??
    (typeof (result as any)?.stdout === 'string' ? (result as any).stdout : undefined) ??
    (typeof details?.output === 'string' ? details.output : undefined) ??
    (typeof (result as any)?.output === 'string' ? (result as any).output : undefined)

  const stderr =
    (typeof details?.stderr === 'string' ? details.stderr : undefined) ??
    (typeof (result as any)?.stderr === 'string' ? (result as any).stderr : undefined)

  const exitCode =
    (typeof details?.exitCode === 'number' ? details.exitCode : undefined) ??
    (typeof (result as any)?.exitCode === 'number' ? (result as any).exitCode : undefined) ??
    (typeof details?.code === 'number' ? details.code : undefined) ??
    (typeof (result as any)?.code === 'number' ? (result as any).code : undefined)

  if ((typeof stdout === 'string' && stdout.trim()) || (typeof stderr === 'string' && stderr.trim())) {
    const parts: string[] = []
    if (typeof stdout === 'string' && stdout.trim()) parts.push(stdout)
    if (typeof stderr === 'string' && stderr.trim()) parts.push(`stderr:\n${stderr}`)
    if (typeof exitCode === 'number') parts.push(`exit code: ${exitCode}`)
    return parts.join('\n\n').trimEnd()
  }

  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}
