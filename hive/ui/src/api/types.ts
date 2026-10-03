// Types mirroring hive/API.md (Phase 1 + Phase 2). Keep this file in lockstep with the contract.

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
  /** Phase 2: minutes of idleness before the hive puts the dot to sleep (0 = never). Absent on Phase 1 servers. */
  idle_sleep_minutes?: number
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
  /** Server settings the UI needs to draw exact bars (absent on older servers). */
  limits?: HiveLimits
}

export interface HiveLimits {
  goal_lease_minutes: number
  hive_budget_usd: number
  max_llm_calls_per_minute: number
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
  Pick<Agent, 'name' | 'swarm_id' | 'model' | 'persona' | 'hue' | 'budget_usd' | 'idle_sleep_minutes'>
>

export type AgentAction = 'start' | 'stop' | 'sleep' | 'wake'

/** Gateway refusals before an LLM call (API.md "LLM spend is checked before the call"). */
export type LlmErrorCode = 'no_budget' | 'unpriced_model' | 'budget_exhausted' | 'hive_budget_exhausted' | 'rate_limited'

export interface ApiErrorBody {
  error: { code: string; message: string }
}

// ---- Phase 2: policy, approvals, goals, traces, wakeups, memory ----

export type PolicyMode = 'allow' | 'ask' | 'deny'
export type PolicyScope = 'hive' | `swarm:${string}` | `agent:${string}`

export interface PolicyRule {
  id: string
  /** Most specific scope wins: agent > swarm > hive > defaults. */
  scope: PolicyScope
  /** Glob over skill names: "shell*", "write-file", "*". */
  skill: string
  mode: PolicyMode
  note: string
  created_at: string
}

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'used'
export type Risk = 'low' | 'medium' | 'high'

export interface Approval {
  id: string
  agent_id: string
  skill: string
  /** Full MeTTa command text, e.g. (shell-confirm "ls /"). */
  command: string
  /** Why it needs a human: the rule note or "human-only". */
  reason: string
  risk: Risk
  status: ApprovalStatus
  decided_by: string | null
  created_at: string
  decided_at: string | null
}

/**
 * `waiting`: delivered, waiting on a person (the lease is paused).
 * `stalled`: the lease lapsed 3 times; a person has to act (PATCH status "open").
 */
export type GoalStatus = 'open' | 'claimed' | 'waiting' | 'stalled' | 'done' | 'failed' | 'cancelled'

export interface Goal {
  id: string
  swarm_id: string
  parent_id: string | null
  title: string
  detail: string
  /** 0..1 */
  priority: number
  status: GoalStatus
  /** "user:operator" | "agent:<id>" */
  created_by: string
  claimed_by: string | null
  result: string | null
  created_at: string
  updated_at: string
  /** A claim is a lease (HIVE_GOAL_LEASE_MINUTES, default 60). Null when not held or paused. */
  lease_until?: string | null
  /** Claims that lapsed so far; 3 lapses stall the goal. */
  attempts?: number
}

export type GateDecision = 'allow' | 'ask' | 'deny'

export interface TraceCommand {
  command: string
  result: string
  gated?: GateDecision
}

/** One loop iteration that called the model. */
export interface Trace {
  id: number
  agent_id: string
  iteration: number
  /** The new message that triggered it (null for autonomous turns). */
  input: string | null
  /** Raw model output. */
  response: string
  commands: TraceCommand[]
  llm_ms: number | null
  tokens: number | null
  created_at: string
}

export interface Wakeup {
  id: string
  agent_id: string
  /** 5-field cron, e.g. "0 9 * * 1-5". Exactly one of cron / at is set. */
  cron: string | null
  /** One-shot ISO time. */
  at: string | null
  /** IANA zone, default "UTC". */
  tz: string
  text: string
  enabled: boolean
  next_run_at: string | null
  last_run_at: string | null
}

export interface MemorySpace {
  name: string
  atoms: number
  bytes: number
}

export interface MemoryAtom {
  index: number
  text: string
}

export interface CreatePolicyBody {
  scope: PolicyScope
  skill: string
  mode: PolicyMode
  note?: string
}

export interface CreateGoalBody {
  title: string
  detail?: string
  priority?: number
  parent_id?: string | null
}

export type PatchGoalBody = Partial<Pick<Goal, 'status' | 'priority' | 'title' | 'detail'>>

export type CreateWakeupBody = { text: string; tz?: string } & ({ cron: string; at?: undefined } | { at: string; cron?: undefined })

export type PatchWakeupBody = Partial<Pick<Wakeup, 'enabled' | 'cron' | 'at' | 'tz' | 'text'>>

// ---- The Lab: test suites and benchmarks (hive/core/lab.py) ----

export type LabKind = 'tests' | 'bench'
export type LabRunStatus = 'running' | 'passed' | 'failed' | 'error' | 'cancelled' | 'skipped'
export type LabCaseStatus = 'passed' | 'failed' | 'skipped' | 'error'
export type Better = 'lower' | 'higher' | 'equal'

export interface LabRunSummary {
  id: string
  suite: string
  status: LabRunStatus
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  passed: number
  failed: number
  skipped: number
  errors: number
  commit_sha: string | null
  /**
   * Simulator only, never sent by a real hive. "recorded": real results from the recording;
   * "example": synthetic history jittered from the recording; "replay": a recorded run replayed.
   */
  demo?: 'recorded' | 'example' | 'replay'
}

export interface LabSuite {
  id: string
  kind: LabKind
  title: string
  description: string
  estimate_s: number
  needs: string[]
  missing: string[]
  runnable: boolean
  last_run: LabRunSummary | null
}

export interface LabMetric {
  name: string
  value: number
  unit: string
  better: Better
  /** The pass line (lower: <=, higher: >=, equal: ==). Null is informational. */
  target: number | null
  ok: boolean | null
}

export interface LabSeries {
  name: string
  unit: string
  kind: 'line' | 'bar' | 'step'
  /** x-axis label */
  x: string
  points: [number, number][]
}

export interface LabCase {
  run_id: string
  id: string
  name: string
  group: string
  status: LabCaseStatus
  duration_ms: number | null
  message: string | null
  notes: string | null
  metrics: LabMetric[]
  series: LabSeries[]
}

export type LabRun = LabRunSummary & { log: string; cases: LabCase[] }

export interface LabHistoryPoint {
  run_id: string
  at: string
  value: number
  ok: boolean | null
}

export interface LabHistoryMetric {
  case_id: string
  case: string
  metric: string
  unit: string
  better: Better | null
  target: number | null
  points: LabHistoryPoint[]
}

export interface LabHistory {
  suite: string
  /** Oldest first. */
  runs: LabRunSummary[]
  metrics: LabHistoryMetric[]
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
  // Phase 2
  | (EventBase<'approval.created'> & { approval: Approval })
  | (EventBase<'approval.updated'> & { approval: Approval })
  | (EventBase<'policy.updated'> & { rules: PolicyRule[] })
  | (EventBase<'goal.updated'> & { goal: Goal })
  | (EventBase<'agent.trace'> & { trace: Trace })
  | (EventBase<'wakeup.updated'> & { wakeup: Wakeup })
  | (EventBase<'wakeup.fired'> & { wakeup_id: string; agent_id: string })
  // Lab
  | (EventBase<'lab.run'> & { run: LabRunSummary })
  | (EventBase<'lab.case'> & { case: LabCase })
  | (EventBase<'lab.log'> & { run_id: string; text: string })

export type HiveEventType = HiveEvent['type']
export type EventOf<T extends HiveEventType> = Extract<HiveEvent, { type: T }>
