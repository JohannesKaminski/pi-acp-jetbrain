// Protocol between the adapter and the editor-files pi extension: the internal mode command
// and the marked input-dialog requests. Kept free of runtime pi imports so the adapter can use
// it without pulling pi-coding-agent into its bundle.

export type FileAccessMode = 'disk' | 'editor'

/** Internal command the adapter sends (as an RPC prompt) to set the mode. */
export const FILE_ACCESS_COMMAND = 'pi-acp-file-access'
/** Prefix of the input-dialog title that marks an editor file request. */
export const FILE_ACCESS_MARKER = '\u0000pi-acp-file-access:'

export type EditorFileRequest = { op: 'read'; path: string } | { op: 'write'; path: string; content: string }
export type EditorFileResponse = { ok: true; content?: string } | { ok: false; error: string }

export const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

export function parseFileAccessMode(value: string | undefined): FileAccessMode | undefined {
  const v = value?.trim()
  return v === 'disk' || v === 'editor' ? v : undefined
}

export function encodeFileRequest(req: EditorFileRequest): string {
  return `${FILE_ACCESS_MARKER}${JSON.stringify(req)}`
}

export function decodeFileRequest(title: unknown): EditorFileRequest | null {
  if (typeof title !== 'string' || !title.startsWith(FILE_ACCESS_MARKER)) return null
  try {
    const req = JSON.parse(title.slice(FILE_ACCESS_MARKER.length)) as Partial<EditorFileRequest>
    if (typeof req.path !== 'string') return null
    if (req.op === 'read') return { op: 'read', path: req.path }
    if (req.op === 'write' && typeof (req as { content?: unknown }).content === 'string') {
      return { op: 'write', path: req.path, content: (req as { content: string }).content }
    }
    return null
  } catch {
    return null
  }
}
