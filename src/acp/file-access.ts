import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import { parseFileAccessMode, type FileAccessMode } from '../pi-extension/editor-files.js'

// Adapter side of editor file access. The pi side (read/edit/write with swappable file
// I/O) lives in src/pi-extension/editor-files.ts.

export const FILE_ACCESS_CONFIG_ID = 'file_access'

const MODE_NAMES: Record<FileAccessMode, string> = {
  disk: 'Disk',
  editor: 'Through the editor'
}

/** Default mode for new sessions: PI_ACP_FILE_ACCESS=disk|editor (default disk). */
export function defaultFileAccessMode(): FileAccessMode {
  return parseFileAccessMode(process.env.PI_ACP_FILE_ACCESS) ?? 'disk'
}

export function fileAccessConfigOption(mode: FileAccessMode): SessionConfigOption {
  return {
    type: 'select',
    id: FILE_ACCESS_CONFIG_ID,
    name: 'File access',
    description:
      "How pi's read, edit and write tools reach files. 'Through the editor' sees unsaved changes and puts edits into the editor; search tools and shell commands still use the disk.",
    currentValue: mode,
    options: (Object.keys(MODE_NAMES) as FileAccessMode[]).map(value => ({ value, name: MODE_NAMES[value] }))
  }
}
