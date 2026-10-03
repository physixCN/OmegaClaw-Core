import {
  ApiError,
  Emitter,
  type ConnectionListener,
  type ConnectionState,
  type EventListener,
  type HiveClient,
} from './client'
import type {
  Agent,
  AgentAction,
  ApiErrorBody,
  Approval,
  ApprovalStatus,
  CreateGoalBody,
  CreatePolicyBody,
  CreateWakeupBody,
  Goal,
  MemoryAtom,
  MemorySpace,
  PatchGoalBody,
  PatchWakeupBody,
  PolicyRule,
  Trace,
  Wakeup,
  Belief,
  BeliefDetail,
  CreateAgentBody,
  CreatedAgent,
  CreateSwarmBody,
  HiveEvent,
  HiveInfo,
  LabHistory,
  LabRun,
  LabRunSummary,
  LabScorecardEntry,
  LabSuite,
  Message,
  ModelOption,
  PatchAgentBody,
  Swarm,
  Usage,
} from './types'

const TOKEN_KEY = 'omegadots.hive.token'

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}
function writeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage unavailable (private mode): the token lives in memory only */
  }
}

const enc = encodeURIComponent

/** REST + WebSocket client for a real `hive/core` server. */
export class LiveClient implements HiveClient {
  readonly mode = 'live' as const
  private base: string
  private token: string | null
  private ws: WebSocket | null = null
  private wantOpen = false
  private retry = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private events = new Emitter<HiveEvent>()
  private conn = new Emitter<ConnectionState>()
  private state: ConnectionState = 'idle'

  constructor(baseUrl: string) {
    this.base = baseUrl.replace(/\/+$/, '')
    this.token = readToken()
  }

  needsAuth(): boolean {
    return !this.token
  }

  async login(password: string): Promise<void> {
    const res = await this.request<{ token: string }>('POST', '/api/auth/login', { password }, false)
    this.token = res.token
    writeToken(res.token)
  }

  logout(): void {
    this.token = null
    writeToken(null)
    this.disconnect()
    this.setState('unauthorized')
  }

  // ---------- REST ----------

  private async request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (auth && this.token) headers.Authorization = `Bearer ${this.token}`
    let res: Response
    try {
      res = await fetch(this.base + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (err) {
      throw new ApiError(0, 'network', err instanceof Error ? err.message : 'Network error')
    }
    if (!res.ok) {
      let code = `http_${res.status}`
      let message = res.statusText || 'Request failed'
      try {
        const data = (await res.json()) as Partial<ApiErrorBody>
        if (data.error) {
          code = data.error.code
          message = data.error.message
        }
      } catch {
        /* non-JSON error body */
      }
      if (res.status === 401 && auth) {
        this.token = null
        writeToken(null)
        this.setState('unauthorized')
      }
      throw new ApiError(res.status, code, message)
    }
    return (await res.json()) as T
  }

  getHive = () => this.request<HiveInfo>('GET', '/api/hive')
  getModels = () => this.request<ModelOption[]>('GET', '/api/models')
  listSwarms = () => this.request<Swarm[]>('GET', '/api/swarms')
  createSwarm = (body: CreateSwarmBody) => this.request<Swarm>('POST', '/api/swarms', body)
  getSwarm = (id: string) => this.request<Swarm>('GET', `/api/swarms/${enc(id)}`)
  listBeliefs = (id: string) => this.request<Belief[]>('GET', `/api/swarms/${enc(id)}/beliefs`)
  getBeliefDetail = (id: string, statement: string) =>
    this.request<BeliefDetail>('GET', `/api/swarms/${enc(id)}/beliefs/detail?statement=${enc(statement)}`)
  getVocab = (id: string) => this.request<string[]>('GET', `/api/swarms/${enc(id)}/vocab`)
  addVocab = (id: string, terms: string[]) =>
    this.request<string[]>('POST', `/api/swarms/${enc(id)}/vocab`, { terms })
  listAgents = () => this.request<Agent[]>('GET', '/api/agents')
  createAgent = (body: CreateAgentBody) => this.request<CreatedAgent>('POST', '/api/agents', body)
  getAgent = (id: string) => this.request<Agent>('GET', `/api/agents/${enc(id)}`)
  patchAgent = (id: string, body: PatchAgentBody) =>
    this.request<Agent>('PATCH', `/api/agents/${enc(id)}`, body)
  deleteAgent = (id: string) => this.request<{ ok: true }>('DELETE', `/api/agents/${enc(id)}`)
  agentAction = (id: string, action: AgentAction) =>
    this.request<Agent>('POST', `/api/agents/${enc(id)}/${action}`)
  listMessages = (id: string, opts: { conversation_id?: string; limit?: number } = {}) => {
    const q = new URLSearchParams()
    if (opts.conversation_id) q.set('conversation_id', opts.conversation_id)
    if (opts.limit) q.set('limit', String(opts.limit))
    const qs = q.toString()
    return this.request<Message[]>('GET', `/api/agents/${enc(id)}/messages${qs ? `?${qs}` : ''}`)
  }
  sendMessage = (id: string, body: { text: string; conversation_id?: string }) =>
    this.request<Message>('POST', `/api/agents/${enc(id)}/messages`, body)
  getLogs = (id: string, tail = 200) =>
    this.request<{ lines: string[] }>('GET', `/api/agents/${enc(id)}/logs?tail=${tail}`)
  listUsage = (opts: { agent_id?: string; since?: string } = {}) => {
    const q = new URLSearchParams()
    if (opts.agent_id) q.set('agent_id', opts.agent_id)
    if (opts.since) q.set('since', opts.since)
    const qs = q.toString()
    return this.request<Usage[]>('GET', `/api/usage${qs ? `?${qs}` : ''}`)
  }

  // ---------- Phase 2 ----------

  listPolicy = () => this.request<PolicyRule[]>('GET', '/api/policy')
  createPolicy = (body: CreatePolicyBody) => this.request<PolicyRule>('POST', '/api/policy', body)
  deletePolicy = (id: string) => this.request<{ ok: true }>('DELETE', `/api/policy/${enc(id)}`)
  listApprovals = (status?: ApprovalStatus) =>
    this.request<Approval[]>('GET', `/api/approvals${status ? `?status=${enc(status)}` : ''}`)
  approve = (id: string, remember = false) =>
    this.request<Approval>('POST', `/api/approvals/${enc(id)}/approve`, { remember })
  deny = (id: string) => this.request<Approval>('POST', `/api/approvals/${enc(id)}/deny`, {})
  listGoals = (swarmId: string) => this.request<Goal[]>('GET', `/api/swarms/${enc(swarmId)}/goals`)
  createGoal = (swarmId: string, body: CreateGoalBody) =>
    this.request<Goal>('POST', `/api/swarms/${enc(swarmId)}/goals`, body)
  patchGoal = (id: string, body: PatchGoalBody) => this.request<Goal>('PATCH', `/api/goals/${enc(id)}`, body)
  listTraces = (agentId: string, limit?: number) =>
    this.request<Trace[]>('GET', `/api/agents/${enc(agentId)}/traces${limit ? `?limit=${limit}` : ''}`)
  listWakeups = (agentId: string) => this.request<Wakeup[]>('GET', `/api/agents/${enc(agentId)}/wakeups`)
  createWakeup = (agentId: string, body: CreateWakeupBody) =>
    this.request<Wakeup>('POST', `/api/agents/${enc(agentId)}/wakeups`, body)
  patchWakeup = (id: string, body: PatchWakeupBody) => this.request<Wakeup>('PATCH', `/api/wakeups/${enc(id)}`, body)
  deleteWakeup = (id: string) => this.request<{ ok: true }>('DELETE', `/api/wakeups/${enc(id)}`)
  listMemory = (agentId: string) => this.request<MemorySpace[]>('GET', `/api/agents/${enc(agentId)}/memory`)
  listAtoms = (agentId: string, space: string, opts: { q?: string; limit?: number } = {}) => {
    const q = new URLSearchParams()
    if (opts.q) q.set('q', opts.q)
    if (opts.limit) q.set('limit', String(opts.limit))
    const qs = q.toString()
    return this.request<MemoryAtom[]>('GET', `/api/agents/${enc(agentId)}/memory/${enc(space)}${qs ? `?${qs}` : ''}`)
  }
  retireAtom = (agentId: string, space: string, atom: string) =>
    this.request<{ queued: true }>('POST', `/api/agents/${enc(agentId)}/memory/${enc(space)}/retire`, { atom })
  resetMemory = (agentId: string) => this.request<{ queued: true }>('POST', `/api/agents/${enc(agentId)}/memory/reset`, {})
  stopAll = () => this.request<{ stopped: number }>('POST', '/api/hive/stop-all', {})

  // ---------- Lab ----------

  listLabSuites = () => this.request<LabSuite[]>('GET', '/api/lab/suites')
  listLabRuns = (opts: { suite?: string; limit?: number } = {}) => {
    const q = new URLSearchParams()
    if (opts.suite) q.set('suite', opts.suite)
    if (opts.limit) q.set('limit', String(opts.limit))
    const qs = q.toString()
    return this.request<LabRunSummary[]>('GET', `/api/lab/runs${qs ? `?${qs}` : ''}`)
  }
  startLabRun = (suite: string) => this.request<LabRun>('POST', '/api/lab/runs', { suite })
  getLabRun = (id: string) => this.request<LabRun>('GET', `/api/lab/runs/${enc(id)}`)
  cancelLabRun = (id: string) => this.request<{ cancelling: true }>('POST', `/api/lab/runs/${enc(id)}/cancel`, {})
  getLabScorecard = () => this.request<LabScorecardEntry[]>('GET', '/api/lab/scorecard')
  getLabHistory = (suite: string, limit = 30) =>
    this.request<LabHistory>('GET', `/api/lab/history/${enc(suite)}?limit=${limit}`)

  // ---------- WebSocket ----------

  private setState(s: ConnectionState) {
    if (this.state === s) return
    this.state = s
    this.conn.emit(s)
  }

  connect(): void {
    this.wantOpen = true
    if (this.ws || !this.token) return
    this.open()
  }

  private open() {
    if (!this.token) {
      this.setState('unauthorized')
      return
    }
    this.setState(this.retry ? 'reconnecting' : 'connecting')
    const url = new URL(this.base + '/api/events', window.location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('token', this.token)
    const ws = new WebSocket(url)
    this.ws = ws
    ws.onopen = () => {
      this.retry = 0
      this.setState('open')
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
      }, 25_000)
    }
    ws.onmessage = (ev) => {
      try {
        const frame = JSON.parse(String(ev.data)) as HiveEvent | { type: 'pong' }
        if (frame && typeof frame === 'object' && 'type' in frame && frame.type !== 'pong') {
          this.events.emit(frame as HiveEvent)
        }
      } catch {
        /* ignore malformed frames */
      }
    }
    ws.onclose = (ev) => {
      if (this.pingTimer) clearInterval(this.pingTimer)
      this.pingTimer = null
      this.ws = null
      if (ev.code === 4401 || ev.code === 1008) {
        this.setState('unauthorized')
        return
      }
      if (!this.wantOpen) {
        this.setState('idle')
        return
      }
      this.retry++
      this.setState('reconnecting')
      const delay = Math.min(15_000, 500 * 2 ** Math.min(this.retry, 5)) * (0.75 + Math.random() * 0.5)
      this.retryTimer = setTimeout(() => this.open(), delay)
    }
  }

  disconnect(): void {
    this.wantOpen = false
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.ws?.close()
    this.ws = null
  }

  subscribe(listener: EventListener): () => void {
    return this.events.on(listener)
  }

  onConnection(listener: ConnectionListener): () => void {
    listener(this.state)
    return this.conn.on(listener)
  }
}
