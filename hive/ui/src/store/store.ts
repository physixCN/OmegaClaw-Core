import { create } from 'zustand'
import { ApiError, Emitter, type ConnectionState, type HiveClient } from '../api/client'
import type {
  Agent,
  AgentAction,
  Approval,
  CreateAgentBody,
  CreatedAgent,
  CreateGoalBody,
  CreatePolicyBody,
  CreateWakeupBody,
  Goal,
  HiveEvent,
  LabRun,
  Message,
  ModelOption,
  PatchAgentBody,
  PatchGoalBody,
  PatchWakeupBody,
  Wakeup,
} from '../api/types'
import type { IconName } from '../ui/Icon'
import { emptyData, isTerminal, mergeMessages, mergeTraces, reduce, upsertCase, upsertMessage, type HiveData } from './reducer'

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
  icon?: IconName
  /** Identity colour (e.g. the dot that is asking). */
  hue?: number
  /** Tapping the toast runs this. */
  action?: { label: string; run: () => void }
  /** Override the auto-dismiss delay (ms). */
  ttl?: number
}

export type Decision = 'approve' | 'remember' | 'deny'

export const atomKey = (agentId: string, space: string, atom: string) => `${agentId}\u0000${space}\u0000${atom}`

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
  // ---- Phase 2
  approvalsLoaded: boolean
  /** Decisions in flight, for the confirmation motion. */
  deciding: Record<string, Decision>
  tracesLoaded: Record<string, true>
  wakeupsLoaded: Record<string, true>
  /** Atoms queued for retirement (atomKey). */
  retired: Record<string, true>
  resetQueued: Record<string, true>
  stopAllOpen: boolean
  // ---- Lab
  labLoaded: boolean
  /** The stored stdout tail of finished runs (GET /api/lab/runs/{id}). */
  labRunLog: Record<string, string>
  /** "Run everything": suites still to start, one after another. */
  labQueue: string[]
  /** Runs started or watched in this session (they toast when they finish). */
  labWatched: Record<string, true>
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
  // ---- Phase 2
  loadApprovals(): Promise<void>
  decide(id: string, d: Decision): Promise<Approval | null>
  loadPolicy(): Promise<void>
  addRule(body: CreatePolicyBody): Promise<boolean>
  deleteRule(id: string): Promise<void>
  loadGoals(swarmId: string, force?: boolean): Promise<void>
  createGoal(swarmId: string, body: CreateGoalBody): Promise<Goal | null>
  patchGoal(id: string, body: PatchGoalBody): Promise<void>
  loadTraces(agentId: string): Promise<void>
  loadWakeups(agentId: string): Promise<void>
  createWakeup(agentId: string, body: CreateWakeupBody): Promise<Wakeup | null>
  patchWakeup(id: string, body: PatchWakeupBody): Promise<void>
  deleteWakeup(id: string): Promise<void>
  retireAtom(agentId: string, space: string, atom: string): Promise<boolean>
  resetMemory(agentId: string): Promise<boolean>
  stopAll(): Promise<number | null>
  setStopAll(open: boolean): void
  // ---- Lab
  loadLab(): Promise<void>
  loadLabRun(id: string): Promise<LabRun | null>
  loadLabHistory(suite: string): Promise<void>
  startLab(suite: string): Promise<LabRun | null>
  cancelLab(id: string): Promise<void>
  /** Queue every runnable suite (tests first) and run them one at a time. */
  runAllLab(): Promise<void>
  stopLabQueue(): void
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
  approvalsLoaded: false,
  deciding: {},
  tracesLoaded: {},
  wakeupsLoaded: {},
  retired: {},
  resetQueued: {},
  stopAllOpen: false,
  labLoaded: false,
  labRunLog: {},
  labQueue: [],
  labWatched: {},

  apply(e) {
    set((s) => {
      const data = reduce(s, e)
      if (e.type === 'message' && !s.messages[e.message.agent_id]?.some((m) => m.id === e.message.id)) {
        return { ...data, freshMessages: { ...s.freshMessages, [e.message.id]: true } }
      }
      return data
    })
    hiveBus.emit(e)
    if (e.type === 'lab.run' && isTerminal(e.run)) onLabRunFinished(e.run.id)
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
      // Phase 2 surfaces are optional: a Phase 1 server simply leaves them empty.
      await Promise.allSettled([get().loadApprovals(), ...swarms.map((s) => get().loadGoals(s.id)), get().loadLab()])
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
    setTimeout(() => get().dismissToast(id), t.ttl ?? (t.tone === 'error' ? 6000 : 3500))
  },

  // ------------------------------------------------------------ Phase 2

  async loadApprovals() {
    const client = get().client
    if (!client) return
    const list = await client.listApprovals()
    set((s) => {
      const next: Record<string, Approval> = {}
      for (const a of list) next[a.id] = a
      // a live decision that raced the snapshot wins
      for (const [id, a] of Object.entries(s.approvals)) if (!next[id] || (next[id].status === 'pending' && a.status !== 'pending')) next[id] = a
      return { approvals: next, approvalsLoaded: true }
    })
  },

  async decide(id, d) {
    const client = get().client
    if (!client || get().deciding[id]) return null
    set((s) => ({ deciding: { ...s.deciding, [id]: d } }))
    try {
      const a = d === 'deny' ? await client.deny(id) : await client.approve(id, d === 'remember')
      set((s) => ({ approvals: { ...s.approvals, [a.id]: a } }))
      if (d === 'remember') void get().loadPolicy().catch(() => undefined)
      return a
    } catch (err) {
      get().toast({ tone: 'error', title: d === 'deny' ? 'Could not deny' : 'Could not approve', body: errText(err) })
      return null
    } finally {
      set((s) => ({ deciding: omitKey(s.deciding, id) }))
    }
  },

  async loadPolicy() {
    const client = get().client
    if (!client) return
    const rules = await client.listPolicy()
    set({ policy: rules })
  },

  async addRule(body) {
    const client = get().client
    if (!client) return false
    try {
      const rule = await client.createPolicy(body)
      set((s) => ({ policy: s.policy?.some((r) => r.id === rule.id) ? s.policy : [...(s.policy ?? []), rule] }))
      return true
    } catch (err) {
      get().toast({ tone: 'error', title: 'Could not add the rule', body: errText(err) })
      return false
    }
  },

  async deleteRule(id) {
    const client = get().client
    const before = get().policy
    if (!client || !before) return
    set({ policy: before.filter((r) => r.id !== id) })
    try {
      await client.deletePolicy(id)
    } catch (err) {
      set({ policy: before })
      get().toast({ tone: 'error', title: 'Could not delete the rule', body: errText(err) })
    }
  },

  async loadGoals(swarmId, force = false) {
    const client = get().client
    if (!client || (!force && get().goalsLoaded[swarmId])) return
    const list = await client.listGoals(swarmId)
    set((s) => {
      const goals = { ...s.goals }
      for (const g of list) if (!goals[g.id] || goals[g.id].updated_at <= g.updated_at) goals[g.id] = g
      return { goals, goalsLoaded: { ...s.goalsLoaded, [swarmId]: true } }
    })
  },

  async createGoal(swarmId, body) {
    const client = get().client
    if (!client) return null
    try {
      const g = await client.createGoal(swarmId, body)
      set((s) => ({ goals: { ...s.goals, [g.id]: s.goals[g.id] ?? g } }))
      return g
    } catch (err) {
      get().toast({ tone: 'error', title: 'Could not create the goal', body: errText(err) })
      return null
    }
  },

  async patchGoal(id, body) {
    const client = get().client
    const before = get().goals[id]
    if (!client || !before) return
    // optimistic: the card moves columns at once
    set((s) => ({ goals: { ...s.goals, [id]: { ...before, ...body } } }))
    try {
      const g = await client.patchGoal(id, body)
      set((s) => ({ goals: { ...s.goals, [g.id]: g } }))
    } catch (err) {
      set((s) => ({ goals: { ...s.goals, [id]: before } }))
      get().toast({ tone: 'error', title: 'Could not update the goal', body: errText(err) })
    }
  },

  async loadTraces(agentId) {
    const client = get().client
    if (!client) return
    const list = await client.listTraces(agentId, 60)
    set((s) => ({ traces: { ...s.traces, [agentId]: mergeTraces(s.traces[agentId], list) }, tracesLoaded: { ...s.tracesLoaded, [agentId]: true } }))
  },

  async loadWakeups(agentId) {
    const client = get().client
    if (!client) return
    const list = await client.listWakeups(agentId)
    set((s) => {
      const wakeups = { ...s.wakeups }
      for (const [id, w] of Object.entries(wakeups)) if (w.agent_id === agentId) delete wakeups[id]
      for (const w of list) wakeups[w.id] = w
      return { wakeups, wakeupsLoaded: { ...s.wakeupsLoaded, [agentId]: true } }
    })
  },

  async createWakeup(agentId, body) {
    const client = get().client
    if (!client) return null
    try {
      const w = await client.createWakeup(agentId, body)
      set((s) => ({ wakeups: { ...s.wakeups, [w.id]: w } }))
      return w
    } catch (err) {
      get().toast({ tone: 'error', title: 'Could not schedule the wakeup', body: errText(err) })
      return null
    }
  },

  async patchWakeup(id, body) {
    const client = get().client
    const before = get().wakeups[id]
    if (!client || !before) return
    set((s) => ({ wakeups: { ...s.wakeups, [id]: { ...before, ...body } } }))
    try {
      const w = await client.patchWakeup(id, body)
      set((s) => ({ wakeups: { ...s.wakeups, [w.id]: w } }))
    } catch (err) {
      set((s) => ({ wakeups: { ...s.wakeups, [id]: before } }))
      get().toast({ tone: 'error', title: 'Could not update the wakeup', body: errText(err) })
    }
  },

  async deleteWakeup(id) {
    const client = get().client
    const before = get().wakeups[id]
    if (!client || !before) return
    set((s) => ({ wakeups: omitKey(s.wakeups, id) }))
    try {
      await client.deleteWakeup(id)
    } catch (err) {
      set((s) => ({ wakeups: { ...s.wakeups, [id]: before } }))
      get().toast({ tone: 'error', title: 'Could not delete the wakeup', body: errText(err) })
    }
  },

  async retireAtom(agentId, space, atom) {
    const client = get().client
    if (!client) return false
    try {
      await client.retireAtom(agentId, space, atom)
      set((s) => ({ retired: { ...s.retired, [atomKey(agentId, space, atom)]: true } }))
      return true
    } catch (err) {
      get().toast({ tone: 'error', title: 'Could not retire the atom', body: errText(err) })
      return false
    }
  },

  async resetMemory(agentId) {
    const client = get().client
    if (!client) return false
    try {
      await client.resetMemory(agentId)
      set((s) => ({ resetQueued: { ...s.resetQueued, [agentId]: true } }))
      return true
    } catch (err) {
      get().toast({ tone: 'error', title: 'Could not reset memory', body: errText(err) })
      return false
    }
  },

  async stopAll() {
    const client = get().client
    if (!client) return null
    try {
      const { stopped } = await client.stopAll()
      return stopped
    } catch (err) {
      get().toast({ tone: 'error', title: 'Stop all failed', body: errText(err) })
      return null
    }
  },

  setStopAll(open) {
    set({ stopAllOpen: open })
  },

  // ------------------------------------------------------------ Lab

  async loadLab() {
    const client = get().client
    if (!client) return
    const [suites, runs] = await Promise.all([client.listLabSuites(), client.listLabRuns({ limit: 200 })])
    set((s) => {
      const labRuns = { ...s.labRuns }
      // a live update newer than the snapshot wins
      for (const r of runs) if (!labRuns[r.id] || !(labRuns[r.id].status !== 'running' && r.status === 'running')) labRuns[r.id] = r
      for (const x of suites) if (x.last_run && !labRuns[x.last_run.id]) labRuns[x.last_run.id] = x.last_run
      return {
        labSuites: suites.map((x) => (x.last_run && labRuns[x.last_run.id] ? { ...x, last_run: labRuns[x.last_run.id] } : x)),
        labRuns,
        labLoaded: true,
      }
    })
  },

  async loadLabRun(id) {
    const client = get().client
    if (!client) return null
    const run = await client.getLabRun(id)
    const { log, cases, ...summary } = run
    set((s) => {
      // cases that streamed in while the request was in flight are kept
      let merged = cases
      for (const c of s.labCases[id] ?? []) if (!merged.some((x) => x.id === c.id)) merged = upsertCase(merged, c)
      const cur = s.labRuns[id]
      const keep = cur && cur.status !== 'running' && summary.status === 'running'
      return {
        labRuns: { ...s.labRuns, [id]: keep ? cur : summary },
        labCases: { ...s.labCases, [id]: merged },
        labRunLog: { ...s.labRunLog, [id]: log },
      }
    })
    return run
  },

  async loadLabHistory(suite) {
    const client = get().client
    if (!client) return
    const h = await client.getLabHistory(suite, 30)
    set((s) => {
      const labRuns = { ...s.labRuns }
      for (const r of h.runs) if (!labRuns[r.id]) labRuns[r.id] = r
      return { labHistory: { ...s.labHistory, [suite]: h }, labRuns }
    })
  },

  async startLab(suite) {
    const client = get().client
    if (!client) return null
    try {
      const run = await client.startLabRun(suite)
      const { log: _log, cases, ...summary } = run
      void _log
      set((s) => ({
        labRuns: { ...s.labRuns, [run.id]: s.labRuns[run.id] && isTerminal(s.labRuns[run.id]) ? s.labRuns[run.id] : summary },
        labCases: { ...s.labCases, [run.id]: s.labCases[run.id] ?? cases },
        labSuites: s.labSuites?.map((x) => (x.id === suite && (!x.last_run || x.last_run.started_at <= run.started_at) ? { ...x, last_run: s.labRuns[run.id] ?? summary } : x)) ?? null,
        labWatched: { ...s.labWatched, [run.id]: true },
      }))
      return run
    } catch (err) {
      const title = get().labSuites?.find((x) => x.id === suite)?.title ?? suite
      get().toast({ tone: 'error', title: `Could not run ${title}`, body: errText(err) })
      return null
    }
  },

  async cancelLab(id) {
    const client = get().client
    if (!client) return
    set({ labQueue: [] })
    try {
      await client.cancelLabRun(id)
    } catch (err) {
      get().toast({ tone: 'error', title: 'Could not cancel the run', body: errText(err) })
    }
  },

  async runAllLab() {
    const suites = get().labSuites ?? []
    const order = [...suites.filter((x) => x.kind === 'tests'), ...suites.filter((x) => x.kind === 'bench')]
    const todo = order.filter((x) => x.runnable && x.last_run?.status !== 'running').map((x) => x.id)
    if (!todo.length) return
    set({ labQueue: todo.slice(1) })
    await get().startLab(todo[0])
  },

  stopLabQueue() {
    set({ labQueue: [] })
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
}))

const labRefetch = new Map<string, ReturnType<typeof setTimeout>>()

/** A run finished: toast it if this session watched it, start the next queued suite, resync history. */
function onLabRunFinished(runId: string) {
  const s = useHive.getState()
  const run = s.labRuns[runId]
  if (!run) return
  const suite = s.labSuites?.find((x) => x.id === run.suite)
  if (s.labWatched[runId]) {
    useHive.setState((st) => {
      const next = { ...st.labWatched }
      delete next[runId]
      return { labWatched: next }
    })
    const total = run.passed + run.failed + run.skipped + run.errors
    const good = run.status === 'passed'
    s.toast({
      tone: good ? 'success' : run.status === 'cancelled' ? 'info' : 'error',
      icon: 'flask',
      title: `${suite?.title ?? run.suite} ${run.status === 'cancelled' ? 'cancelled' : good ? 'passed' : run.status}`,
      body: run.status === 'cancelled' ? undefined : `${run.passed}/${total} passed${run.failed ? ` · ${run.failed} failed` : ''}${run.errors ? ` · ${run.errors} errors` : ''}`,
      action: { label: 'Open the run', run: () => (window.location.hash = `#/lab/run/${encodeURIComponent(runId)}`) },
    })
  }
  // "Run everything": the next suite starts when nothing from the queue is running
  if (s.labQueue.length) {
    const busy = Object.values(useHive.getState().labRuns).some((r) => r.status === 'running')
    if (!busy) {
      const [next, ...rest] = s.labQueue
      useHive.setState({ labQueue: rest })
      void s.startLab(next)
    }
  }
  if (s.labHistory[run.suite]) {
    clearTimeout(labRefetch.get(run.suite))
    labRefetch.set(run.suite, setTimeout(() => void useHive.getState().loadLabHistory(run.suite).catch(() => undefined), 600))
  }
}

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

function omitKey<T>(rec: Record<string, T>, key: string): Record<string, T> {
  if (!(key in rec)) return rec
  const next = { ...rec }
  delete next[key]
  return next
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
