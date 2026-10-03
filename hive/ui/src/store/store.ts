import { create } from 'zustand'
import { ApiError, Emitter, type ConnectionState, type HiveClient } from '../api/client'
import type {
  Agent,
  AgentAction,
  CreateAgentBody,
  CreatedAgent,
  HiveEvent,
  Message,
  ModelOption,
  PatchAgentBody,
} from '../api/types'
import { emptyData, mergeMessages, reduce, upsertMessage, type HiveData } from './reducer'

export interface PendingMessage {
  tempId: string
  agent_id: string
  text: string
  status: 'sending' | 'failed'
  created_at: string
  error?: string
}

export interface Toast {
  id: number
  tone: 'info' | 'success' | 'error'
  title: string
  body?: string
}

export interface UIState {
  client: HiveClient | null
  connection: ConnectionState
  ready: boolean
  bootError: string | null
  models: ModelOption[]
  pending: Record<string, PendingMessage[]>
  /** Message ids that arrived live in this session (they get a streamed reveal). */
  freshMessages: Record<string, true>
  messagesLoaded: Record<string, true>
  logsLoaded: Record<string, true>
  paletteOpen: boolean
  reveal: { agent: Agent; token: string } | null
  toasts: Toast[]
  /** Set while the create flow is waiting for a dot to be born in the scene. */
  focusBirth: string | null
}

export interface Actions {
  init(client: HiveClient): Promise<void>
  hydrate(): Promise<void>
  loadBeliefs(swarmId: string, force?: boolean): Promise<void>
  loadMessages(agentId: string): Promise<void>
  loadLogs(agentId: string): Promise<void>
  sendMessage(agentId: string, text: string): Promise<void>
  retryMessage(agentId: string, tempId: string): Promise<void>
  dismissPending(agentId: string, tempId: string): void
  agentAction(agentId: string, action: AgentAction): Promise<void>
  patchAgent(agentId: string, body: PatchAgentBody): Promise<Agent | null>
  createAgent(body: CreateAgentBody): Promise<CreatedAgent>
  setPalette(open: boolean): void
  clearReveal(): void
  toast(t: Omit<Toast, 'id'>): void
  dismissToast(id: number): void
  /** Apply an event (exposed for tests and for the client subscription). */
  apply(e: HiveEvent): void
}

export type Store = HiveData & UIState & Actions

/** Fan-out of raw events for imperative consumers (the scene). */
export const hiveBus = new Emitter<HiveEvent>()

let toastSeq = 0
let tempSeq = 0
let unsub: (() => void)[] = []

function errText(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return 'Something went wrong'
}

export const useHive = create<Store>()((set, get) => ({
  ...emptyData(),
  client: null,
  connection: 'idle',
  ready: false,
  bootError: null,
  models: [],
  pending: {},
  freshMessages: {},
  messagesLoaded: {},
  logsLoaded: {},
  paletteOpen: false,
  reveal: null,
  toasts: [],
  focusBirth: null,

  apply(e) {
    set((s) => {
      const data = reduce(s, e)
      if (e.type === 'message' && !s.messages[e.message.agent_id]?.some((m) => m.id === e.message.id)) {
        return { ...data, freshMessages: { ...s.freshMessages, [e.message.id]: true } }
      }
      return data
    })
    hiveBus.emit(e)
  },

  async init(client) {
    unsub.forEach((u) => u())
    unsub = []
    set({ client, ready: false, bootError: null })
    unsub.push(client.onConnection((connection) => set({ connection })))
    unsub.push(client.subscribe((e) => get().apply(e)))
    if (client.needsAuth()) return
    await get().hydrate()
  },

  async hydrate() {
    const client = get().client
    if (!client) return
    try {
      const [hive, agents, swarms, models] = await Promise.all([
        client.getHive(),
        client.listAgents(),
        client.listSwarms(),
        client.getModels(),
      ])
      set({
        hive,
        models,
        agents: Object.fromEntries(agents.map((a) => [a.id, a])),
        swarms: Object.fromEntries(swarms.map((s) => [s.id, s])),
        ready: true,
        bootError: null,
      })
      client.connect()
      // Commons are small in Phase 1: load all of them so the scene can show belief motes.
      await Promise.all(swarms.map((s) => get().loadBeliefs(s.id)))
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        set({ ready: false, bootError: null })
        return
      }
      set({ bootError: errText(err) })
    }
  },

  async loadBeliefs(swarmId, force = false) {
    const client = get().client
    if (!client || (!force && get().beliefsLoaded[swarmId])) return
    const list = await client.listBeliefs(swarmId)
    set((s) => ({
      beliefs: { ...s.beliefs, [swarmId]: { ...Object.fromEntries(list.map((b) => [b.statement, b])), ...pickNewer(s.beliefs[swarmId], list) } },
      beliefsLoaded: { ...s.beliefsLoaded, [swarmId]: true },
    }))
  },

  async loadMessages(agentId) {
    const client = get().client
    if (!client) return
    const list = await client.listMessages(agentId, { limit: 100 })
    set((s) => ({
      messages: { ...s.messages, [agentId]: mergeMessages(s.messages[agentId], list) },
      messagesLoaded: { ...s.messagesLoaded, [agentId]: true },
    }))
  },

  async loadLogs(agentId) {
    const client = get().client
    if (!client) return
    const { lines } = await client.getLogs(agentId, 200)
    set((s) => {
      // Live lines that arrived while the request was in flight are appended after the tail.
      const live = s.logs[agentId] ?? []
      const tailSet = new Set(lines)
      const extra = live.filter((l) => !tailSet.has(l))
      return { logs: { ...s.logs, [agentId]: [...lines, ...extra] }, logsLoaded: { ...s.logsLoaded, [agentId]: true } }
    })
  },

  async sendMessage(agentId, text) {
    const tempId = `tmp_${++tempSeq}`
    const p: PendingMessage = { tempId, agent_id: agentId, text, status: 'sending', created_at: new Date().toISOString() }
    set((s) => ({ pending: { ...s.pending, [agentId]: [...(s.pending[agentId] ?? []), p] } }))
    await deliver(agentId, p)
  },

  async retryMessage(agentId, tempId) {
    const p = get().pending[agentId]?.find((x) => x.tempId === tempId)
    if (!p) return
    patchPending(agentId, tempId, { status: 'sending', error: undefined })
    await deliver(agentId, { ...p, status: 'sending' })
  },

  dismissPending(agentId, tempId) {
    set((s) => ({ pending: { ...s.pending, [agentId]: (s.pending[agentId] ?? []).filter((x) => x.tempId !== tempId) } }))
  },

  async agentAction(agentId, action) {
    const client = get().client
    if (!client) return
    try {
      const agent = await client.agentAction(agentId, action)
      set((s) => ({ agents: { ...s.agents, [agent.id]: agent } }))
    } catch (err) {
      get().toast({ tone: 'error', title: `Could not ${action}`, body: errText(err) })
    }
  },

  async patchAgent(agentId, body) {
    const client = get().client
    if (!client) return null
    try {
      const agent = await client.patchAgent(agentId, body)
      set((s) => ({ agents: { ...s.agents, [agent.id]: agent } }))
      return agent
    } catch (err) {
      get().toast({ tone: 'error', title: 'Could not save', body: errText(err) })
      return null
    }
  },

  async createAgent(body) {
    const client = get().client
    if (!client) throw new Error('Not connected')
    const created = await client.createAgent(body)
    const { token, ...agent } = created
    set((s) => ({ agents: { ...s.agents, [agent.id]: s.agents[agent.id] ?? agent }, focusBirth: agent.id }))
    return { ...agent, token }
  },

  setPalette(open) {
    set({ paletteOpen: open })
  },
  clearReveal() {
    set({ reveal: null, focusBirth: null })
  },
  toast(t) {
    const id = ++toastSeq
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }))
    setTimeout(() => get().dismissToast(id), t.tone === 'error' ? 6000 : 3500)
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
}))

function pickNewer(cur: Record<string, import('../api/types').Belief> | undefined, list: { statement: string; updated_at: string }[]) {
  // Keep any live update that is newer than what the REST snapshot returned.
  const out: Record<string, import('../api/types').Belief> = {}
  if (!cur) return out
  const snap = new Map(list.map((b) => [b.statement, b.updated_at]))
  for (const [k, b] of Object.entries(cur)) {
    const at = snap.get(k)
    if (!at || b.updated_at > at) out[k] = b
  }
  return out
}

function patchPending(agentId: string, tempId: string, patch: Partial<PendingMessage>) {
  useHive.setState((s) => ({
    pending: {
      ...s.pending,
      [agentId]: (s.pending[agentId] ?? []).map((x) => (x.tempId === tempId ? { ...x, ...patch } : x)),
    },
  }))
}

async function deliver(agentId: string, p: PendingMessage) {
  const client = useHive.getState().client
  if (!client) return
  try {
    const m: Message = await client.sendMessage(agentId, { text: p.text })
    useHive.setState((s) => ({
      messages: { ...s.messages, [agentId]: upsertMessage(s.messages[agentId], m) },
      pending: { ...s.pending, [agentId]: (s.pending[agentId] ?? []).filter((x) => x.tempId !== p.tempId) },
    }))
  } catch (err) {
    patchPending(agentId, p.tempId, { status: 'failed', error: errText(err) })
  }
}
