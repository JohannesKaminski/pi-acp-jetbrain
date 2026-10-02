import type { ToolKind } from '@agentclientprotocol/sdk'
import { isAbsolute, relative, sep } from 'node:path'
import { bashCommand } from './bash.js'

// Titles and kinds for pi's built-in tools (read, bash, powershell, edit, write, grep,
// find, ls); bash calls are classified by their command. Argument names follow pi 1.0's tool schemas. Anything else, including
// extension and MCP tools, keeps its pi tool name as title and kind `other`.

export function toolKind(toolName: string, args?: unknown): ToolKind {
  switch (toolName) {
    case 'read':
      return 'read'
    case 'write':
    case 'edit':
      return 'edit'
    case 'bash':
      return shellCommandKind(bashCommand(args))
    case 'powershell':
      return 'execute'
    case 'grep':
    case 'find':
    case 'ls':
      return 'search'
    default:
      return 'other'
  }
}

// pi searches and reads through bash by default (grep/find/ls aren't enabled out of the box),
// so simple read-only commands get the kind of what they do. Deliberately conservative: only a
// single command, with no pipes, chaining, redirection, substitution, or backgrounding.
const SEARCH_COMMANDS = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'find', 'fd', 'ls', 'tree'])
const READ_COMMANDS = new Set(['cat', 'head', 'tail', 'wc', 'stat', 'file'])
const SHELL_OPERATORS = /[|;&<>`\n]|\$\(/

export function shellCommandKind(command: string | undefined): ToolKind {
  const trimmed = command?.trim()
  if (!trimmed || SHELL_OPERATORS.test(trimmed)) return 'execute'
  const words = trimmed.split(/\s+/)
  const program = words[0]!
  // find can delete files or run arbitrary commands.
  if (program === 'find' && words.some(w => /^-(exec|execdir|ok|okdir|delete|fprint\w*|fls)$/.test(w))) return 'execute'
  if (SEARCH_COMMANDS.has(program)) return 'search'
  if (READ_COMMANDS.has(program)) return 'read'
  return 'execute'
}

/**
 * Human-readable title built from the tool's arguments. Falls back to the tool name when
 * the arguments are missing or incomplete (e.g. while the model is still streaming them).
 */
export function toolTitle(toolName: string, args: unknown, cwd: string): string {
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>
  const str = (key: string): string | undefined => {
    const v = a[key]
    return typeof v === 'string' && v.trim() ? v : undefined
  }
  const num = (key: string): number | undefined => {
    const v = a[key]
    return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined
  }
  const path = str('path')
  const shown = path ? displayPath(path, cwd) : undefined

  switch (toolName) {
    case 'read': {
      if (!shown) break
      const offset = num('offset')
      const limit = num('limit')
      if (offset && limit) return `Read ${shown} (lines ${offset}–${offset + limit - 1})`
      if (offset) return `Read ${shown} (from line ${offset})`
      if (limit) return `Read ${shown} (first ${limit} lines)`
      return `Read ${shown}`
    }
    case 'write':
      if (shown) return `Write ${shown}`
      break
    case 'edit':
      if (shown) return `Edit ${shown}`
      break
    case 'grep': {
      const pattern = str('pattern')
      if (!pattern) break
      const glob = str('glob')
      return `Search for "${pattern}"${shown ? ` in ${shown}` : ''}${glob ? ` (${glob})` : ''}`
    }
    case 'find': {
      const pattern = str('pattern')
      if (!pattern) break
      return `Find "${pattern}"${shown ? ` in ${shown}` : ''}`
    }
    case 'ls':
      return `List ${shown ?? '.'}`
    case 'bash':
    case 'powershell':
      return bashCommand(args) ?? toolName
  }
  return toolName
}

/** Paths inside the session cwd are shown relative to it; others stay as given. */
function displayPath(path: string, cwd: string): string {
  if (!isAbsolute(path)) return path
  const rel = relative(cwd, path)
  if (rel === '') return '.'
  const outside = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
  return outside ? path : rel
}
