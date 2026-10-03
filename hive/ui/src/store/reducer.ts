import type {
  Agent,
  Approval,
  AssertionOutcome,
  Belief,
  Goal,
  HiveEvent,
  HiveInfo,
  LabCase,
  LabHistory,
  LabRunSummary,
  LabSuite,
  Message,
  PolicyRule,
  Swarm,
  ThinkingPhase,
  Trace,
  Usage,
  Wakeup,
} from '../api/types'

export const LOG_CAP = 400
export const USAGE_CAP = 20_000
export const ACTIVITY_CAP = 40
export const MESSAGE_CAP = 300
export const TRACE_CAP = 120
export const APPROVAL_CAP = 300
export const LAB_LOG_CAP = 300

export type ActivityKind = 'belief' | 'message' | 'status' | 'error' | 'birth' | 'approval' | 'goal' | 'wakeup'

export interface Activity {
  id: number
  at: string
  kind: ActivityKind
  agent_id: string | null
  swarm_id: string | null
  text: string
  statement?: string
  outcome?: AssertionOutcome
}

/** The pure, serialisable part of the app state that live events act upon. */
export interface HiveData {
  hive: HiveInfo | null
  agents: Record<string, Agent>
  swarms: Record<string, Swarm>
  thinking: Record<string, ThinkingPhase>
  /** Messages per agent, oldest first, deduplicated by id. */
  messages: Record<string, Message[]>
  /** Beliefs per swarm, keyed by statement. */
  beliefs: Record<string, Record<string, Belief>>
  /** Swarms whose belief list has been loaded from REST. */
  beliefsLoaded: Record<string, true>
  /** Last-updated time per statement, for "recently changed" highlights. */
  beliefPulse: Record<string, number>
  usage: Usage[]
  logs: Record<string, string[]>
  activity: Activity[]
  activitySeq: number
  // ---- Phase 2
  approvals: Record<string, Approval>
  /** null until the rules have been fetched. */
  policy: PolicyRule[] | null
  /** Every goal of every loaded swarm, by id. */
  goals: Record<string, Goal>
  goalsLoaded: Record<string, true>
  /** Model iterations per agent, oldest first, unique by id. */
  traces: Record<string, Trace[]>
  wakeups: Record<string, Wakeup>
  /** Last time each wakeup fired (ms), for a pulse in the schedule. */
  wakeFired: Record<string, number>
  // ---- Lab
  /** null until the suites have been fetched (or on a server without the Lab). */
  labSuites: LabSuite[] | null
  /** Every run summary seen, by id. */
  labRuns: Record<string, LabRunSummary>
  /** Cases per run, in arrival order, unique by case id. */
  labCases: Record<string, LabCase[]>
  /** Live log lines per run (lab.log). */
  labLogs: Record<string, string[]>
  /** Per-suite history (oldest first), kept current as runs finish. */
  labHistory: Record<string, LabHistory>
}

export const emptyData = (): HiveData => ({
  hive: null,
  agents: {},
  swarms: {},
  thinking: {},
  messages: {},
  beliefs: {},
  beliefsLoaded: {},
  beliefPulse: {},
  usage: [],
  logs: {},
  activity: [],
  activitySeq: 0,
  approvals: {},
  policy: null,
  goals: {},
  goalsLoaded: {},
  traces: {},
  wakeups: {},
  wakeFired: {},
  labSuites: null,
  labRuns: {},
  labCases: {},
  labLogs: {},
  labHistory: {},
})

const pulseKey = (swarmId: string, statement: string) => `${swarmId}\u0000${statement}`
export { pulseKey }

function pushActivity(s: HiveData, a: Omit<Activity, 'id'>): Pick<HiveData, 'activity' | 'activitySeq'> {
  const id = s.activitySeq + 1
  const activity = [{ ...a, id }, ...s.activity]
  if (activity.length > ACTIVITY_CAP) activity.length = ACTIVITY_CAP
  return { activity, activitySeq: id }
}

/** Insert or replace a message, keeping the list sorted by time and unique by id. */
export function upsertMessage(list: Message[] | undefined, m: Message): Message[] {
  const cur = list ?? []
  const idx = cur.findIndex((x) => x.id === m.id)
  if (idx >= 0) {
    const next = cur.slice()
    next[idx] = m
    return next
  }
  const next = [...cur, m]
  if (cur.length && cur[cur.length - 1].created_at > m.created_at) {
    next.sort((a, b) => a.created_at.localeCompare(b.created_at))
  }
  return next.length > MESSAGE_CAP ? next.slice(next.length - MESSAGE_CAP) : next
}

export function mergeMessages(list: Message[] | undefined, incoming: Message[]): Message[] {
  const map = new Map<string, Message>()
  for (const m of list ?? []) map.set(m.id, m)
  for (const m of incoming) map.set(m.id, m)
  return [...map.values()].sort((a, b) => a.created_at.localeCompare(b.created_at))
}

/** Insert or replace a trace, keeping the list ordered by id and capped. */
export function upsertTrace(list: Trace[] | undefined, t: Trace): Trace[] {
  const cur = list ?? []
  const idx = cur.findIndex((x) => x.id === t.id)
  if (idx >= 0) {
    const next = cur.slice()
    next[idx] = t
    return next
  }
  const next = [...cur, t]
  if (cur.length && cur[cur.length - 1].id > t.id) next.sort((a, b) => a.id - b.id)
  return next.length > TRACE_CAP ? next.slice(next.length - TRACE_CAP) : next
}

export function mergeTraces(list: Trace[] | undefined, incoming: Trace[]): Trace[] {
  const map = new Map<number, Trace>()
  for (const t of list ?? []) map.set(t.id, t)
  for (const t of incoming) map.set(t.id, t)
  const out = [...map.values()].sort((a, b) => a.id - b.id)
  return out.length > TRACE_CAP ? out.slice(out.length - TRACE_CAP) : out
}

function capApprovals(rec: Record<string, Approval>): Record<string, Approval> {
  const keys = Object.keys(rec)
  if (keys.length <= APPROVAL_CAP) return rec
  // drop the oldest decided ones; pending items are never dropped
  const decided = Object.values(rec)
    .filter((a) => a.status !== 'pending')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  const next = { ...rec }
  for (const a of decided.slice(0, keys.length - APPROVAL_CAP)) delete next[a.id]
  return next
}

const GOAL_TEXT: Partial<Record<Goal['status'], string>> = {
  claimed: 'claimed',
  waiting: 'delivered, waiting on you for',
  done: 'finished',
  failed: 'gave up on',
}

const STATUS_TEXT: Partial<Record<Agent['status'], string>> = {
  awake: 'woke up',
  asleep: 'fell asleep',
  stopped: 'stopped',
  error: 'hit an error',
}

/** Apply one live event. Pure: returns a new object, never mutates `s`. */
export function reduce(s: HiveData, e: HiveEvent): HiveData {
  switch (e.type) {
    case 'hello':
      return { ...s, hive: e.hive }

    case 'agent.updated': {
      const prev = s.agents[e.agent.id]
      const next: HiveData = { ...s, agents: { ...s.agents, [e.agent.id]: e.agent } }
      if (!prev) {
        return { ...next, ...pushActivity(s, { at: e.at, kind: 'birth', agent_id: e.agent.id, swarm_id: e.agent.swarm_id, text: 'was born' }) }
      }
      if (prev.status !== e.agent.status && STATUS_TEXT[e.agent.status]) {
        const thinking = e.agent.status === 'awake' ? s.thinking : omit(s.thinking, e.agent.id)
        return {
          ...next,
          thinking,
          ...pushActivity(s, {
            at: e.at,
            kind: e.agent.status === 'error' ? 'error' : 'status',
            agent_id: e.agent.id,
            swarm_id: e.agent.swarm_id,
            text: STATUS_TEXT[e.agent.status]!,
          }),
        }
      }
      return next
    }

    case 'agent.deleted': {
      if (!s.agents[e.agent_id]) return s
      return {
        ...s,
        agents: omit(s.agents, e.agent_id),
        thinking: omit(s.thinking, e.agent_id),
        swarms: Object.fromEntries(
          Object.entries(s.swarms).map(([id, sw]) => [
            id,
            sw.member_ids.includes(e.agent_id) ? { ...sw, member_ids: sw.member_ids.filter((m) => m !== e.agent_id) } : sw,
          ]),
        ),
      }
    }

    case 'swarm.updated':
      return { ...s, swarms: { ...s.swarms, [e.swarm.id]: e.swarm } }

    case 'message': {
      const m = e.message
      const known = s.messages[m.agent_id]?.some((x) => x.id === m.id)
      const next = { ...s, messages: { ...s.messages, [m.agent_id]: upsertMessage(s.messages[m.agent_id], m) } }
      if (known) return next
      const fromPeer = m.sender.startsWith('agent:') && m.sender !== `agent:${m.agent_id}`
      return {
        ...next,
        ...pushActivity(s, {
          at: e.at,
          kind: 'message',
          agent_id: m.direction === 'out' ? m.agent_id : fromPeer ? m.sender.slice(6) : m.agent_id,
          swarm_id: s.agents[m.agent_id]?.swarm_id ?? null,
          text: m.direction === 'out' ? 'said something' : fromPeer ? `messaged ${s.agents[m.agent_id]?.name ?? 'a dot'}` : 'received a message',
        }),
      }
    }

    case 'agent.thinking':
      return {
        ...s,
        thinking: e.phase === 'idle' ? omit(s.thinking, e.agent_id) : { ...s.thinking, [e.agent_id]: e.phase },
      }

    case 'belief.published':
      return {
        ...s,
        ...pushActivity(s, {
          at: e.at,
          kind: 'belief',
          agent_id: e.assertion.agent_id,
          swarm_id: e.swarm_id,
          text: e.assertion.outcome,
          statement: e.assertion.statement,
          outcome: e.assertion.outcome,
        }),
      }

    case 'belief.updated': {
      const b = e.belief
      const swarmBeliefs = s.beliefs[b.swarm_id] ?? {}
      const isNew = !swarmBeliefs[b.statement]
      const hive = s.hive && isNew && s.beliefsLoaded[b.swarm_id] ? { ...s.hive, beliefs: s.hive.beliefs + 1 } : s.hive
      return {
        ...s,
        hive,
        beliefs: { ...s.beliefs, [b.swarm_id]: { ...swarmBeliefs, [b.statement]: b } },
        beliefPulse: { ...s.beliefPulse, [pulseKey(b.swarm_id, b.statement)]: Date.parse(e.at) || Date.now() },
      }
    }

    case 'usage': {
      const usage = s.usage.length >= USAGE_CAP ? [...s.usage.slice(1), e.usage] : [...s.usage, e.usage]
      return { ...s, usage }
    }

    case 'log': {
      const cur = s.logs[e.agent_id] ?? []
      const next = cur.length >= LOG_CAP ? [...cur.slice(cur.length - LOG_CAP + 1), e.line] : [...cur, e.line]
      return { ...s, logs: { ...s.logs, [e.agent_id]: next } }
    }

    case 'approval.created':
    case 'approval.updated': {
      const a = e.approval
      const prev = s.approvals[a.id]
      const next = { ...s, approvals: capApprovals({ ...s.approvals, [a.id]: a }) }
      if (prev || a.status !== 'pending') return next
      return {
        ...next,
        ...pushActivity(s, { at: e.at, kind: 'approval', agent_id: a.agent_id, swarm_id: s.agents[a.agent_id]?.swarm_id ?? null, text: `asks to run ${a.skill}` }),
      }
    }

    case 'policy.updated':
      return { ...s, policy: e.rules }

    case 'goal.updated': {
      const g = e.goal
      const prev = s.goals[g.id]
      const next = { ...s, goals: { ...s.goals, [g.id]: g } }
      const verb = prev?.status !== g.status ? GOAL_TEXT[g.status] : undefined
      if (!verb || !g.claimed_by) return next
      return {
        ...next,
        ...pushActivity(s, { at: e.at, kind: 'goal', agent_id: g.claimed_by, swarm_id: g.swarm_id, text: `${verb} “${g.title}”` }),
      }
    }

    case 'agent.trace':
      return { ...s, traces: { ...s.traces, [e.trace.agent_id]: upsertTrace(s.traces[e.trace.agent_id], e.trace) } }

    case 'wakeup.updated':
      return { ...s, wakeups: { ...s.wakeups, [e.wakeup.id]: e.wakeup } }

    case 'wakeup.fired':
      return {
        ...s,
        wakeFired: { ...s.wakeFired, [e.wakeup_id]: Date.parse(e.at) || Date.now() },
        ...pushActivity(s, { at: e.at, kind: 'wakeup', agent_id: e.agent_id, swarm_id: s.agents[e.agent_id]?.swarm_id ?? null, text: 'woke on schedule' }),
      }

    case 'lab.run': {
      const run = e.run
      const labSuites = s.labSuites?.map((x) =>
        x.id === run.suite && (!x.last_run || x.last_run.id === run.id || x.last_run.started_at <= run.started_at) ? { ...x, last_run: run } : x,
      ) ?? null
      const next: HiveData = { ...s, labRuns: { ...s.labRuns, [run.id]: run }, labSuites }
      const h = s.labHistory[run.suite]
      if (!h || run.status === 'running') return next
      return { ...next, labHistory: { ...s.labHistory, [run.suite]: foldRunIntoHistory(h, run, s.labCases[run.id] ?? []) } }
    }

    case 'lab.case':
      return { ...s, labCases: { ...s.labCases, [e.case.run_id]: upsertCase(s.labCases[e.case.run_id], e.case) } }

    case 'lab.log': {
      const cur = s.labLogs[e.run_id] ?? []
      const next = cur.length >= LAB_LOG_CAP ? [...cur.slice(cur.length - LAB_LOG_CAP + 1), e.text] : [...cur, e.text]
      return { ...s, labLogs: { ...s.labLogs, [e.run_id]: next } }
    }

    default:
      return s
  }
}

export const isTerminal = (r: Pick<LabRunSummary, 'status'>) => r.status !== 'running'

export function upsertCase(list: LabCase[] | undefined, c: LabCase): LabCase[] {
  const cur = list ?? []
  const idx = cur.findIndex((x) => x.id === c.id)
  if (idx < 0) return [...cur, c]
  const next = cur.slice()
  next[idx] = c
  return next
}

/** Add (or replace) a finished run and its metric values in a suite's history. Pure. */
export function foldRunIntoHistory(h: LabHistory, run: LabRunSummary, cases: LabCase[]): LabHistory {
  const runs = [...h.runs.filter((r) => r.id !== run.id), run].sort((a, b) => a.started_at.localeCompare(b.started_at))
  const metrics = h.metrics.map((m) => ({ ...m, points: m.points.filter((p) => p.run_id !== run.id) }))
  for (const c of cases) {
    for (const mt of c.metrics) {
      let entry = metrics.find((m) => m.case_id === c.id && m.metric === mt.name)
      if (!entry) {
        entry = { case_id: c.id, case: c.name, metric: mt.name, unit: mt.unit, better: mt.better, target: mt.target, points: [] }
        metrics.push(entry)
      }
      entry.points.push({ run_id: run.id, at: run.started_at, value: mt.value, ok: mt.ok })
      entry.points.sort((a, b) => a.at.localeCompare(b.at))
    }
  }
  return { ...h, runs, metrics }
}

/** Overall Lab health from each suite's last run. */
export function labHealth(suites: LabSuite[] | null): { state: 'unknown' | 'running' | 'passing' | 'failing'; passing: number; total: number; ran: number } {
  if (!suites?.length) return { state: 'unknown', passing: 0, total: 0, ran: 0 }
  let passing = 0
  let ran = 0
  let failing = false
  let running = false
  for (const x of suites) {
    const r = x.last_run
    if (!r) continue
    if (r.status === 'running') running = true
    else ran++
    if (r.status === 'passed') passing++
    if (r.status === 'failed' || r.status === 'error') failing = true
  }
  return { state: failing ? 'failing' : running ? 'running' : ran ? 'passing' : 'unknown', passing, total: suites.length, ran }
}

function omit<T>(rec: Record<string, T>, key: string): Record<string, T> {
  if (!(key in rec)) return rec
  const next = { ...rec }
  delete next[key]
  return next
}

// ---------------------------------------------------------------- derived

export function pendingApprovals(approvals: Record<string, Approval>): Approval[] {
  return Object.values(approvals)
    .filter((a) => a.status === 'pending')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export const countPending = (approvals: Record<string, Approval>): number => {
  let n = 0
  for (const id in approvals) if (approvals[id].status === 'pending') n++
  return n
}

/** Goals a dot holds (claimed or waiting) per agent, for the task glyphs orbiting dots in the scene. */
export function claimedByAgent(goals: Record<string, Goal>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const id in goals) {
    const g = goals[id]
    if ((g.status === 'claimed' || g.status === 'waiting') && g.claimed_by) out[g.claimed_by] = (out[g.claimed_by] ?? 0) + 1
  }
  return out
}

/** Pending approvals per agent (an amber "asking" halo in the scene). */
export function askingByAgent(approvals: Record<string, Approval>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const id in approvals) {
    const a = approvals[id]
    if (a.status === 'pending') out[a.agent_id] = (out[a.agent_id] ?? 0) + 1
  }
  return out
}

export interface HiveStats {
  agents: number
  awake: number
  beliefs: number
  spent: number
  swarms: number
}

export function computeStats(s: Pick<HiveData, 'agents' | 'beliefs' | 'hive' | 'beliefsLoaded' | 'swarms'>): HiveStats {
  const agents = Object.values(s.agents)
  let beliefs = 0
  let anyLoaded = false
  for (const id of Object.keys(s.beliefs)) {
    if (s.beliefsLoaded[id]) anyLoaded = true
    beliefs += Object.keys(s.beliefs[id]).length
  }
  return {
    agents: agents.length,
    awake: agents.filter((a) => a.status === 'awake').length,
    beliefs: anyLoaded ? beliefs : s.hive?.beliefs ?? beliefs,
    spent: agents.reduce((sum, a) => sum + a.spent_usd, 0),
    swarms: Object.keys(s.swarms).length,
  }
}
