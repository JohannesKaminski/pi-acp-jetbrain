import type { ClientCapabilities } from '@agentclientprotocol/sdk'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// pi extensions the adapter loads into every session's pi process: tool approval, editor
// file access, and client hints. Each stays inert until the adapter switches it on.
const SESSION_EXTENSIONS = ['tool-approval', 'editor-files', 'client-hints'] as const

const cache = new Map<string, string | null>()
/** A bundled extension: built JS next to dist/index.js, or the TS source when run via tsx. */
function resolveExtensionPath(name: string): string | null {
  if (cache.has(name)) return cache.get(name)!
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [join(here, 'pi-extension', `${name}.js`), join(here, '..', 'pi-extension', `${name}.ts`)]
  const found = candidates.find(c => existsSync(c)) ?? null
  cache.set(name, found)
  return found
}

/** Extensions for a session's pi process: the session extensions, then any bridge extension. */
export function sessionExtensionPaths(bridgePaths: string[] = []): string[] {
  const own = SESSION_EXTENSIONS.map(resolveExtensionPath).filter((p): p is string => p !== null)
  return [...own, ...bridgePaths]
}

/**
 * Environment for a session's pi process derived from the client's capabilities: the client
 * hints for the client-hints extension (e.g. IntelliJ declares `_meta["mermaid-rendering"]`).
 */
export function sessionExtensionEnv(clientCapabilities: ClientCapabilities | undefined): Record<string, string> {
  const hints: string[] = []
  if (clientCapabilities?._meta?.['mermaid-rendering'] === true) hints.push('mermaid')
  return hints.length > 0 ? { PI_ACP_CLIENT_HINTS: hints.join(',') } : {}
}
