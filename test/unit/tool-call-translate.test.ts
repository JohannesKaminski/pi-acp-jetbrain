import test from 'node:test'
import assert from 'node:assert/strict'
import { toolKind, toolTitle } from '../../src/acp/translate/tool-call.js'

const CWD = '/work/project'

test('toolKind: maps pi built-in tools to ACP kinds', () => {
  assert.deepEqual(
    ['read', 'write', 'edit', 'bash', 'powershell', 'grep', 'find', 'ls', 'ide_idea_get_file', 'custom'].map(toolKind),
    ['read', 'edit', 'edit', 'execute', 'execute', 'search', 'search', 'search', 'other', 'other']
  )
})

test('toolTitle: read shows the line range in every offset/limit combination', () => {
  assert.equal(toolTitle('read', { path: 'a.ts' }, CWD), 'Read a.ts')
  assert.equal(toolTitle('read', { path: 'a.ts', offset: 10, limit: 5 }, CWD), 'Read a.ts (lines 10–14)')
  assert.equal(toolTitle('read', { path: 'a.ts', offset: 10 }, CWD), 'Read a.ts (from line 10)')
  assert.equal(toolTitle('read', { path: 'a.ts', limit: 20 }, CWD), 'Read a.ts (first 20 lines)')
  // Non-positive or fractional numbers are ignored rather than rendered.
  assert.equal(toolTitle('read', { path: 'a.ts', offset: 0, limit: 2.5 }, CWD), 'Read a.ts')
})

test('toolTitle: absolute paths inside the cwd are shown relative; others stay absolute', () => {
  assert.equal(toolTitle('edit', { path: '/work/project/src/a.ts' }, CWD), 'Edit src/a.ts')
  assert.equal(toolTitle('write', { path: '/etc/hosts' }, CWD), 'Write /etc/hosts')
  assert.equal(toolTitle('read', { path: '/work/project-other/a.ts' }, CWD), 'Read /work/project-other/a.ts')
  assert.equal(toolTitle('ls', { path: '/work/project' }, CWD), 'List .')
  assert.equal(toolTitle('read', { path: '/work/project/..notes' }, CWD), 'Read ..notes')
  assert.equal(toolTitle('read', { path: '/work/a.ts' }, CWD), 'Read /work/a.ts')
})

test('toolTitle: search tools include pattern, path and glob when present', () => {
  assert.equal(toolTitle('grep', { pattern: 'TODO' }, CWD), 'Search for "TODO"')
  assert.equal(
    toolTitle('grep', { pattern: 'TODO', path: 'src', glob: '*.ts' }, CWD),
    'Search for "TODO" in src (*.ts)'
  )
  assert.equal(toolTitle('find', { pattern: '*.md', path: 'docs' }, CWD), 'Find "*.md" in docs')
  assert.equal(toolTitle('ls', {}, CWD), 'List .')
})

test('toolTitle: shell tools use the command', () => {
  assert.equal(toolTitle('bash', { command: 'npm test' }, CWD), 'npm test')
  assert.equal(toolTitle('powershell', { command: 'Get-ChildItem' }, CWD), 'Get-ChildItem')
})

test('toolTitle: falls back to the tool name for missing or partial args and unknown tools', () => {
  for (const [name, args] of [
    ['read', undefined],
    ['read', {}],
    ['edit', { path: '   ' }],
    ['grep', { path: 'src' }],
    ['find', {}],
    ['bash', {}],
    ['write', 'not-an-object'],
    ['ide_idea_get_file', { path: 'a.ts' }]
  ] as const) {
    assert.equal(toolTitle(name, args, CWD), name, `${name} ${JSON.stringify(args)}`)
  }
})
