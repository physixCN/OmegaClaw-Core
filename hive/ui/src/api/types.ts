// Types mirroring hive/API.md (Phase 1). Keep this file in lockstep with the contract.

export type AgentKind = 'omega' | 'iter' | 'module'
export type AgentStatus = 'created' | 'starting' | 'awake' | 'asleep' | 'stopped' | 'error'

export interface Agent {
  id: string
  name: string
  kind: AgentKind
  swarm_id: string | null
  model: string
  persona: string
  hue: number
  status: AgentStatus
  driver: string
  budget_usd: number
  spent_usd: number
  connected: boolean
  /** Why status is "error" (server sets it; absent in older servers). */
  last_error?: string | null
  last_active_at: string | null
  created_at: string
}

export interface Swarm {
  id: string
  name: string
  description: string
  hue: number
  member_ids: string[]
  created_at: string
}

export interface Message {
  id: string
  agent_id: string
  conversation_id: string
  direction: 'in' | 'out'
  sender: string
  text: string
  created_at: string
}

export interface TruthValue {
  f: number
  c: number
}

export interface Belief {
  swarm_id: string
  statement: string
  tv: TruthValue
  stamp: string[]
  sources: string[]
  updated_at: string
}

export type AssertionOutcome =
  | 'adopted'
  | 'revised'
  | 'chosen'
  | 'kept'
  | 'duplicate'
  | 'quarantined'
  | 'denied'

export interface Assertion {
  agent_id: string
  statement: string
  tv: TruthValue
  stamp: string[]
  outcome: AssertionOutcome
  created_at: string
}

export interface BeliefDetail extends Belief {
  assertions: Assertion[]
  choices: { kept: string[]; rejected: string[] }[]
}

export interface Usage {
  agent_id: string
  model: string
  prompt_tokens: number
  completion_tokens: number
  cost_usd: number
  created_at: string
}

export interface ModelOption {
  id: string
  provider: string
  label: string
  local: boolean
}

export interface HiveInfo {
  name: string
  version: string
  agents: number
  swarms: number
  awake: number
  beliefs: number
  spent_usd: number
}

// ---- REST bodies ----

export interface CreateSwarmBody {
  name: string
  description?: string
  hue?: number
}

export interface CreateAgentBody {
  name: string
  kind: AgentKind
  swarm_id?: string | null
  model: string
  persona?: string
  hue?: number
  budget_usd?: number
}

export type CreatedAgent = Agent & { token: string }

export type PatchAgentBody = Partial<
  Pick<Agent, 'name' | 'swarm_id' | 'model' | 'persona' | 'hue' | 'budget_usd'>
>

export type AgentAction = 'start' | 'stop' | 'sleep' | 'wake'

export interface ApiErrorBody {
  error: { code: string; message: string }
}

// ---- Live events (WS /api/events) ----

export type ThinkingPhase = 'llm' | 'skills' | 'idle'

interface EventBase<T extends string> {
  type: T
  at: string
}

export type HiveEvent =
  | (EventBase<'hello'> & { hive: HiveInfo })
  | (EventBase<'agent.updated'> & { agent: Agent })
  | (EventBase<'agent.deleted'> & { agent_id: string })
  | (EventBase<'swarm.updated'> & { swarm: Swarm })
  | (EventBase<'message'> & { message: Message })
  | (EventBase<'agent.thinking'> & { agent_id: string; phase: ThinkingPhase })
  | (EventBase<'belief.published'> & { swarm_id: string; assertion: Assertion })
  | (EventBase<'belief.updated'> & { belief: Belief; outcome?: 'adopted' | 'revised' | 'chosen' })
  | (EventBase<'usage'> & { usage: Usage })
  | (EventBase<'log'> & { agent_id: string; line: string })

export type HiveEventType = HiveEvent['type']
export type EventOf<T extends HiveEventType> = Extract<HiveEvent, { type: T }>
