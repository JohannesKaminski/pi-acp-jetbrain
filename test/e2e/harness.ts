// End-to-end harness: the real adapter (src/index.ts via tsx) drives the real pi
// binary from node_modules, whose model is scripted by fixtures/scripted-model.ts.
// Everything runs in a temp dir with an isolated pi agent dir; no network, no keys.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'
import {
  ClientSideConnection,
  ndJsonStream,
  type Client,
  type ClientCapabilities,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type InitializeResponse,
  type LoadSessionResponse,
  type NewSessionResponse,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type SessionUpdate
} from '@agentclientprotocol/sdk'
import type { ScriptedModelScript } from './fixtures/script.js'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const PI_BIN = join(REPO_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'pi.cmd' : 'pi')
const SCRIPTED_MODEL_EXTENSION = join(import.meta.dirname, 'fixtures', 'scripted-model.ts')
const SCRIPTED_MODEL_ID = 'scripted/scripted'

export type E2EOptions = {
  script: ScriptedModelScript
  /** Merged over the harness defaults in the isolated agent dir's settings.json. */
  piSettings?: Record<string, unknown>
  /** Sent in `initialize`; defaults to none (every optional capability unsupported). */
  clientCapabilities?: ClientCapabilities
}

export class E2EClient {
  readonly updates: SessionNotification[] = []
  readonly permissionRequests: RequestPermissionRequest[] = []
  readonly elicitationRequests: CreateElicitationRequest[] = []
  /** Answers each elicitation request; defaults to cancel. */
  onElicitation: (req: CreateElicitationRequest) => CreateElicitationResponse = () => ({ action: 'cancel' })
  /** Answers each permission request; defaults to the first option. */
  onPermission: (req: RequestPermissionRequest) => RequestPermissionResponse = req => ({
    outcome: { outcome: 'selected', optionId: req.options[0]!.optionId }
  })

  /**
   * session/update params exactly as the adapter wrote them. The SDK client validates
   * incoming updates against its own schema and drops fields it doesn't know, so assert
   * on these for what real clients (possibly on older SDKs) receive.
   */
  readonly wireUpdates: SessionNotification[] = []
  readonly conn: ClientSideConnection
  readonly workspace: string
  private stderr = ''
  private stdoutBuffer = ''

  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly root: string,
    private readonly clientCapabilities: ClientCapabilities
  ) {
    this.workspace = join(root, 'workspace')
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => {
      this.stderr += chunk
    })

    const client: Client = {
      sessionUpdate: async params => {
        this.updates.push(params)
      },
      requestPermission: async params => {
        this.permissionRequests.push(params)
        return this.onPermission(params)
      },
      createElicitation: async params => {
        this.elicitationRequests.push(params)
        return this.onElicitation(params)
      }
    }
    child.stdout.on('data', (chunk: Buffer) => this.captureWire(chunk))
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
    )
    this.conn = new ClientSideConnection(() => client, stream)
  }

  static start(opts: E2EOptions): E2EClient {
    const root = mkdtempSync(join(tmpdir(), 'pi-acp-e2e-'))
    const agentDir = join(root, 'agent')
    mkdirSync(agentDir)
    mkdirSync(join(root, 'workspace'))

    const scriptPath = join(root, 'script.json')
    writeFileSync(scriptPath, JSON.stringify(opts.script))
    writeFileSync(
      join(agentDir, 'settings.json'),
      JSON.stringify({
        defaultProvider: 'scripted',
        defaultModel: 'scripted',
        defaultThinkingLevel: 'off',
        quietStartup: true,
        extensions: [SCRIPTED_MODEL_EXTENSION],
        ...opts.piSettings
      })
    )

    // Spawn from the repo so `--import tsx` resolves; sessions get the workspace as cwd.
    const child = spawn(process.execPath, ['--import', 'tsx', join(REPO_ROOT, 'src', 'index.ts')], {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: agentDir,
        PI_ACP_SESSION_MAP: join(root, 'session-map.json'),
        PI_ACP_PI_COMMAND: PI_BIN,
        PI_ACP_E2E_SCRIPT: scriptPath,
        // The adapter's update notice runs `npm view`; fail it fast instead of hitting the network.
        npm_config_offline: 'true'
      }
    })
    return new E2EClient(child, root, opts.clientCapabilities ?? {})
  }

  initialize(): Promise<InitializeResponse> {
    return this.withStderr(this.conn.initialize({ protocolVersion: 1, clientCapabilities: this.clientCapabilities }))
  }

  async newSession(): Promise<NewSessionResponse> {
    await this.initialize()
    const res = await this.withStderr(this.conn.newSession({ cwd: this.workspace, mcpServers: [] }))
    // pi 0.99.2 startup race: when the default model comes from an extension provider, pi
    // occasionally starts with an `unknown` model and the first prompt fails with "No API key
    // found". Selecting the model explicitly (the real ACP model-switch path) makes it deterministic.
    await this.withStderr(
      this.conn.setSessionConfigOption({ sessionId: res.sessionId, configId: 'model', value: SCRIPTED_MODEL_ID })
    )
    return res
  }

  loadSession(sessionId: string): Promise<LoadSessionResponse> {
    return this.withStderr(this.conn.loadSession({ sessionId, cwd: this.workspace, mcpServers: [] }))
  }

  prompt(sessionId: string, text: string): Promise<PromptResponse> {
    return this.withStderr(this.conn.prompt({ sessionId, prompt: [{ type: 'text', text }] }))
  }

  /** Rethrows a failed request with the adapter's stderr attached, so CI failures are diagnosable. */
  private async withStderr<T>(request: Promise<T>): Promise<T> {
    try {
      return await request
    } catch (err) {
      const detail = err instanceof Error ? err.message : JSON.stringify(err)
      throw new Error(`${detail}\n--- adapter stderr ---\n${this.stderrTail()}`, { cause: err })
    }
  }

  private captureWire(chunk: Buffer): void {
    this.stdoutBuffer += chunk.toString('utf8')
    const lines = this.stdoutBuffer.split('\n')
    this.stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) {
      try {
        const msg = JSON.parse(line) as { method?: string; params?: SessionNotification }
        if (msg.method === 'session/update' && msg.params) this.wireUpdates.push(msg.params)
      } catch {
        // not JSON-RPC; ignore
      }
    }
  }

  /** Raw wire session updates of one kind, in arrival order, with all fields the adapter sent. */
  wireUpdatesOf(kind: SessionUpdate['sessionUpdate']): Array<Record<string, unknown>> {
    return this.wireUpdates
      .map(n => n.update as unknown as Record<string, unknown>)
      .filter(u => u.sessionUpdate === kind)
  }

  /** Session updates of one kind, in arrival order. */
  updatesOf<K extends SessionUpdate['sessionUpdate']>(kind: K): Array<Extract<SessionUpdate, { sessionUpdate: K }>> {
    return this.updates
      .map(n => n.update)
      .filter((u): u is Extract<SessionUpdate, { sessionUpdate: K }> => u.sessionUpdate === kind)
  }

  /** All agent_message_chunk text joined. */
  agentText(): string {
    return this.updatesOf('agent_message_chunk')
      .map(u => (u.content.type === 'text' ? u.content.text : ''))
      .join('')
  }

  /** Adapter stderr so far; attach to assertion messages when a scenario fails. */
  stderrTail(lines = 40): string {
    return this.stderr.split('\n').slice(-lines).join('\n')
  }

  /** Close stdin, wait for the adapter (and its pi child) to exit, then remove the temp dir. */
  async close(): Promise<void> {
    const exited = new Promise<void>(resolve => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) resolve()
      else this.child.once('exit', () => resolve())
    })
    this.child.stdin.end()
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 10_000)
    await exited
    clearTimeout(timer)
    rmSync(this.root, { recursive: true, force: true })
  }
}
