import type { AgentSideConnection } from '@agentclientprotocol/sdk'
import type { JsonAgentSessionEvent, RpcExtensionUIRequest } from '@earendil-works/pi-coding-agent'
import type { PiRpcEvent, PiSessionStats } from '../../src/pi-rpc/process.js'

/** Events pi actually emits on its RPC stdout, per pi's own exported types. */
type PiStdoutEvent = JsonAgentSessionEvent | RpcExtensionUIRequest

/**
 * A pi event for tests: `type` must be a real pi event name (so renamed or removed
 * events fail typecheck), while payload fields stay partial for brevity.
 */
export type FakePiEvent = {
  [K in PiStdoutEvent['type']]: { type: K } & LoosePayload<Extract<PiStdoutEvent, { type: K }>>
}[PiStdoutEvent['type']]

/** Optional fields; nested tagged unions (e.g. `assistantMessageEvent`) keep their checked `type`. */
type LoosePayload<T> = { [P in keyof T]?: LooseTagged<T[P]> } & Record<string, unknown>
type LooseTagged<V> = V extends { type: string } ? { type: V['type'] } & Partial<V> & Record<string, unknown> : V

type SessionUpdateMsg = Parameters<AgentSideConnection['sessionUpdate']>[0]

// noinspection JSUnusedGlobalSymbols
export class FakeAgentSideConnection {
  readonly updates: SessionUpdateMsg[] = []
  readonly permissionRequests: unknown[] = []
  nextPermissionResponse: { outcome: { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' } } = {
    outcome: { outcome: 'selected', optionId: 'allow' }
  }

  readonly elicitationRequests: unknown[] = []
  nextElicitationResponse: unknown = { action: 'cancel' }
  elicitationError: unknown = null

  /**
   * messageId of each entry in `updates` (aligned by index). It's random, so it's split
   * off the recorded update to keep exact-match assertions stable.
   */
  readonly messageIds: Array<string | undefined> = []

  async sessionUpdate(msg: SessionUpdateMsg): Promise<void> {
    const { messageId, ...update } = msg.update as SessionUpdateMsg['update'] & { messageId?: string | null }
    this.messageIds.push(messageId ?? undefined)
    this.updates.push({ ...msg, update: update as SessionUpdateMsg['update'] })
  }

  async requestPermission(
    params: unknown
  ): Promise<{ outcome: { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' } }> {
    this.permissionRequests.push(params)
    return this.nextPermissionResponse
  }

  async createElicitation(params: unknown): Promise<unknown> {
    this.elicitationRequests.push(params)
    if (this.elicitationError !== null) throw this.elicitationError
    return this.nextElicitationResponse
  }
}

// noinspection JSUnusedGlobalSymbols
export class FakePiRpcProcess {
  private handlers: Array<(ev: PiRpcEvent) => void> = []

  // spies
  readonly prompts: Array<{ message: string; attachments: unknown[] }> = []
  readonly extensionUiResponses: unknown[] = []
  abortCount = 0
  getSessionStatsCount = 0

  sessionStats: PiSessionStats = {}
  /** When set, `getSessionStats()` rejects with this error. */
  sessionStatsError: unknown = null

  onEvent(handler: (ev: PiRpcEvent) => void): () => void {
    this.handlers.push(handler)
    return () => {
      this.handlers = this.handlers.filter(h => h !== handler)
    }
  }

  private exitHandlers: Array<(code: number | null, signal: string | null) => void> = []

  onExit(handler: (code: number | null, signal: string | null) => void): void {
    this.exitHandlers.push(handler)
  }

  exit(code: number | null = 0, signal: string | null = null): void {
    for (const h of this.exitHandlers) h(code, signal)
  }

  emit(ev: FakePiEvent) {
    for (const h of this.handlers) h(ev as PiRpcEvent)
  }

  async prompt(message: string, attachments: unknown[] = []): Promise<void> {
    this.prompts.push({ message, attachments })
  }

  async abort(): Promise<void> {
    this.abortCount += 1
  }

  stderrTailLines(_limit = 40): string[] {
    return []
  }

  async sendExtensionUiResponse(response: unknown): Promise<void> {
    this.extensionUiResponses.push(response)
  }

  async getState(): Promise<any> {
    return {}
  }

  async getAvailableModels(): Promise<any> {
    return { models: [{ provider: 'test', id: 'model', name: 'model' }] }
  }

  async getAvailableThinkingLevels(): Promise<string[]> {
    return ['medium', 'high']
  }

  async getMessages(): Promise<any> {
    return { messages: [] }
  }

  async getSessionStats(): Promise<PiSessionStats> {
    this.getSessionStatsCount += 1
    if (this.sessionStatsError) throw this.sessionStatsError
    return this.sessionStats
  }
}

export function asAgentConn(conn: FakeAgentSideConnection): AgentSideConnection {
  // We only implement the method(s) used by PiAcpSession in tests.
  return conn as unknown as AgentSideConnection
}
