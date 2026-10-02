/**
 * Bundled pi extension for ACP editor file access (pi-acp-jetbrain).
 *
 * Re-registers pi's built-in read, edit and write tools with the same behavior but
 * swappable file I/O. In `disk` mode (the default) they use the local file system,
 * exactly like the built-ins. In `editor` mode text reads and writes go to the ACP
 * client's editor (fs/read_text_file, fs/write_text_file), so pi sees unsaved changes
 * and its edits land in the editor. The adapter sets the mode with an internal command
 * and carries each file request over pi's input dialog, marked so it can tell them apart.
 *
 * Images and other binary files always stay on disk: ACP's file API is text-only.
 * Self-contained on purpose (no relative runtime imports): pi loads it from dist/ in
 * real use and from source in the e2e tests.
 */
import { access, mkdir, readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import {
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ExtensionAPI,
  type ToolDefinition
} from '@earendil-works/pi-coding-agent'

export type FileAccessMode = 'disk' | 'editor'

/** Internal command the adapter sends (as an RPC prompt) to set the mode. */
export const FILE_ACCESS_COMMAND = 'pi-acp-file-access'
/** Prefix of the input-dialog title that marks an editor file request. */
export const FILE_ACCESS_MARKER = '\u0000pi-acp-file-access:'

export type EditorFileRequest = { op: 'read'; path: string } | { op: 'write'; path: string; content: string }
export type EditorFileResponse = { ok: true; content?: string } | { ok: false; error: string }

const IMAGE_TYPES: Record<string, string> = {
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

type DialogContext = { ui: { input(title: string, placeholder?: string): Promise<string | undefined> } }

async function editorRequest(ctx: DialogContext, req: EditorFileRequest): Promise<string | undefined> {
  const raw = await ctx.ui.input(encodeFileRequest(req), '')
  if (raw === undefined) throw new Error('Editor file access is unavailable (no response from the client).')
  let res: EditorFileResponse
  try {
    res = JSON.parse(raw) as EditorFileResponse
  } catch {
    throw new Error('Editor file access returned an invalid response.')
  }
  if (!res.ok) throw new Error(res.error)
  return res.content
}

function editorOperations(ctx: DialogContext) {
  const readText = async (path: string): Promise<Buffer> =>
    IMAGE_TYPES[extname(path).toLowerCase()]
      ? readFile(path)
      : Buffer.from((await editorRequest(ctx, { op: 'read', path })) ?? '', 'utf8')
  return {
    readFile: readText,
    writeFile: async (path: string, content: string) => {
      await editorRequest(ctx, { op: 'write', path, content })
    },
    // A file may exist only as an unsaved editor buffer; ask the editor when disk says no.
    access: async (path: string) => {
      try {
        await access(path)
      } catch (error) {
        if (IMAGE_TYPES[extname(path).toLowerCase()]) throw error
        await editorRequest(ctx, { op: 'read', path })
      }
    },
    detectImageMimeType: async (path: string) => IMAGE_TYPES[extname(path).toLowerCase()] ?? null,
    mkdir: async (dir: string) => {
      await mkdir(dir, { recursive: true })
    }
  }
}

export default function editorFilesExtension(pi: ExtensionAPI): void {
  let mode: FileAccessMode = 'disk'

  pi.registerCommand(FILE_ACCESS_COMMAND, {
    description: 'pi-acp-jetbrain internal: set file access for read/edit/write (disk | editor)',
    handler: async args => {
      mode = parseFileAccessMode(args) ?? mode
    }
  })

  // Same definitions as the built-ins (schemas, prompts, rendering); only the file I/O is swapped
  // per call, so a mode change applies to the next tool call.
  type AnyTool = ToolDefinition<any, any, any>
  type Factory = (cwd: string, options?: { operations?: ReturnType<typeof editorOperations> }) => AnyTool
  const factories = [createReadToolDefinition, createEditToolDefinition, createWriteToolDefinition] as Factory[]
  for (const create of factories) {
    const base = create(process.cwd())
    const tool: AnyTool = {
      ...base,
      async execute(toolCallId, params, signal, onUpdate, ctx) {
        const def = mode === 'editor' ? create(ctx.cwd, { operations: editorOperations(ctx) }) : create(ctx.cwd)
        return def.execute(toolCallId, params, signal, onUpdate, ctx)
      }
    }
    pi.registerTool(tool)
  }
}
