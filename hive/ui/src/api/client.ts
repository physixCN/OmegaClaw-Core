import type {
  Agent,
  AgentAction,
  Approval,
  ApprovalStatus,
  Belief,
  BeliefDetail,
  CreateAgentBody,
  CreatedAgent,
  CreateGoalBody,
  CreatePolicyBody,
  CreateSwarmBody,
  CreateWakeupBody,
  Goal,
  HiveEvent,
  HiveInfo,
  MemoryAtom,
  MemorySpace,
  Message,
  ModelOption,
  PatchAgentBody,
  PatchGoalBody,
  PatchWakeupBody,
  PolicyRule,
  Swarm,
  Trace,
  Usage,
  Wakeup,
} from './types'

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'unauthorized'

export type EventListener = (event: HiveEvent) => void
export type ConnectionListener = (state: ConnectionState) => void

/**
 * The single data-access surface for the whole UI. Every component talks to the hive
 * through this interface only, so the in-browser simulator and the real server are
 * interchangeable.
 */
export interface HiveClient {
  readonly mode: 'live' | 'sim'
  /** True when the client needs an operator login before it can do anything. */
  needsAuth(): boolean
  login(password: string): Promise<void>
  logout(): void

  getHive(): Promise<HiveInfo>
  getModels(): Promise<ModelOption[]>

  listSwarms(): Promise<Swarm[]>
  createSwarm(body: CreateSwarmBody): Promise<Swarm>
  getSwarm(id: string): Promise<Swarm>
  listBeliefs(swarmId: string): Promise<Belief[]>
  getBeliefDetail(swarmId: string, statement: string): Promise<BeliefDetail>
  getVocab(swarmId: string): Promise<string[]>
  addVocab(swarmId: string, terms: string[]): Promise<string[]>

  listAgents(): Promise<Agent[]>
  createAgent(body: CreateAgentBody): Promise<CreatedAgent>
  getAgent(id: string): Promise<Agent>
  patchAgent(id: string, body: PatchAgentBody): Promise<Agent>
  deleteAgent(id: string): Promise<{ ok: true }>
  agentAction(id: string, action: AgentAction): Promise<Agent>
  listMessages(id: string, opts?: { conversation_id?: string; limit?: number }): Promise<Message[]>
  sendMessage(id: string, body: { text: string; conversation_id?: string }): Promise<Message>
  getLogs(id: string, tail?: number): Promise<{ lines: string[] }>

  listUsage(opts?: { agent_id?: string; since?: string }): Promise<Usage[]>

  // ---- Phase 2 ----
  listPolicy(): Promise<PolicyRule[]>
  createPolicy(body: CreatePolicyBody): Promise<PolicyRule>
  deletePolicy(id: string): Promise<{ ok: true }>
  /** Newest first. */
  listApprovals(status?: ApprovalStatus): Promise<Approval[]>
  /** `remember` also adds an `allow` rule for this agent and skill. */
  approve(id: string, remember?: boolean): Promise<Approval>
  deny(id: string): Promise<Approval>
  listGoals(swarmId: string): Promise<Goal[]>
  createGoal(swarmId: string, body: CreateGoalBody): Promise<Goal>
  patchGoal(id: string, body: PatchGoalBody): Promise<Goal>
  /** Newest first. */
  listTraces(agentId: string, limit?: number): Promise<Trace[]>
  listWakeups(agentId: string): Promise<Wakeup[]>
  createWakeup(agentId: string, body: CreateWakeupBody): Promise<Wakeup>
  patchWakeup(id: string, body: PatchWakeupBody): Promise<Wakeup>
  deleteWakeup(id: string): Promise<{ ok: true }>
  listMemory(agentId: string): Promise<MemorySpace[]>
  listAtoms(agentId: string, space: string, opts?: { q?: string; limit?: number }): Promise<MemoryAtom[]>
  /** Queued: the agent removes the atom on its next loop. */
  retireAtom(agentId: string, space: string, atom: string): Promise<{ queued: true }>
  resetMemory(agentId: string): Promise<{ queued: true }>
  /** Global kill switch. */
  stopAll(): Promise<{ stopped: number }>

  /** Open the live event stream. Safe to call more than once. */
  connect(): void
  disconnect(): void
  subscribe(listener: EventListener): () => void
  onConnection(listener: ConnectionListener): () => void
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Small typed emitter shared by both implementations. */
export class Emitter<T> {
  private listeners = new Set<(v: T) => void>()
  on(fn: (v: T) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  emit(v: T): void {
    for (const fn of [...this.listeners]) {
      try {
        fn(v)
      } catch (err) {
        console.warn('[hive] listener failed', err)
      }
    }
  }
  get size(): number {
    return this.listeners.size
  }
}

/** True when the app should run against the in-browser simulator. */
export function wantsSim(): boolean {
  const params = new URLSearchParams(window.location.search)
  if (params.get('sim') === '1') return true
  if (params.get('sim') === '0') return false
  return !import.meta.env.VITE_HIVE_URL
}

/** Lazily constructs the right client so the unused implementation is never downloaded. */
export async function createClient(): Promise<HiveClient> {
  if (wantsSim()) {
    const { SimClient } = await import('./sim/SimClient')
    const q = new URLSearchParams(window.location.search)
    return new SimClient({
      extraDots: Math.min(200, Number(q.get('dots')) || 0),
      speed: Math.min(10, Number(q.get('speed')) || 1),
    })
  }
  const { LiveClient } = await import('./live')
  // With ?sim=0 and no VITE_HIVE_URL, talk to the origin that served the UI (hive/core can host it).
  return new LiveClient(import.meta.env.VITE_HIVE_URL ?? '')
}
