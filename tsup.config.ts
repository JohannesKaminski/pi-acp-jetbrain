import { execSync } from 'node:child_process'
import { defineConfig } from 'tsup'

function gitRevision(): string {
  try {
    return execSync('git rev-parse --short=12 HEAD', { encoding: 'utf8', timeout: 5000 }).trim()
  } catch {
    return 'dev'
  }
}

function gitDirty(): boolean {
  try {
    return execSync('git status --porcelain', { encoding: 'utf8', timeout: 5000 }).toString().trim().length > 0
  } catch {
    return false
  }
}

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/pi-extension/acp-mcp-bridge.ts',
    'src/pi-extension/tool-approval.ts',
    'src/pi-extension/editor-files.ts',
    'src/pi-extension/client-hints.ts'
  ],
  // Never bundle pi-coding-agent. Extensions run inside the host pi and use its copy; the adapter
  // must not import it at runtime at all (it's only a devDependency, absent in installs).
  // scripts/smoke-pack.mjs installs the packed tarball cleanly to catch violations.
  external: ['@earendil-works/pi-coding-agent'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  dts: false,
  splitting: false,
  minify: false,
  define: {
    __PI_ACP_BUILD_REVISION__: JSON.stringify(gitRevision()),
    __PI_ACP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __PI_ACP_BUILD_DIRTY__: JSON.stringify(gitDirty())
  },
  banner: {
    js: '#!/usr/bin/env node'
  }
})
