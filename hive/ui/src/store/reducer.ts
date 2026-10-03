import type {
  Agent,
  AssertionOutcome,
  Belief,
  HiveEvent,
  HiveInfo,
  Message,
  Swarm,
  ThinkingPhase,
  Usage,
} from '../api/types'

export const LOG_CAP = 400
export const USAGE_CAP = 20_000
export const ACTIVITY_CAP = 40
export const MESSAGE_CAP = 300

export type ActivityKind = 'belief' | 'message' | 'status' | 'error' | 'birth'

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

    default:
      return s
  }
}

function omit<T>(rec: Record<string, T>, key: string): Record<string, T> {
  if (!(key in rec)) return rec
  const next = { ...rec }
  delete next[key]
  return next
}

// ---------------------------------------------------------------- derived

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
