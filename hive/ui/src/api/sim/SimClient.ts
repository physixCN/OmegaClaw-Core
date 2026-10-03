import { ApiError, Emitter, type ConnectionState, type HiveClient } from '../client'
import type {
  Agent,
  AgentAction,
  Approval,
  ApprovalStatus,
  Assertion,
  AssertionOutcome,
  Belief,
  BeliefDetail,
  CreateAgentBody,
  CreatedAgent,
  CreateGoalBody,
  CreatePolicyBody,
  CreateSwarmBody,
  CreateWakeupBody,
  GateDecision,
  Goal,
  HiveEvent,
  HiveInfo,
  MemoryAtom,
  MemorySpace,
  Message,
  PatchAgentBody,
  PatchGoalBody,
  PatchWakeupBody,
  PolicyRule,
  ProgramActBody,
  ProgramViewBody,
  Swarm,
  ThinkingPhase,
  Trace,
  TraceCommand,
  TruthValue,
  Usage,
  Wakeup,
} from '../types'
import { cronError, isValidTz, nextRun } from '../../lib/cron'
import { commandSkill, resolvePolicy, skillRisk } from '../../lib/policy'
import { LOG_TEMPLATES, NAME_IDEAS, SEED_AGENTS, SEED_SWARMS, SIM_MODELS, SKILLS, type SeedAgent } from './data'
import { SimLab, type LabRecord } from './lab'
import { SimPrograms } from './programs'
import { overlaps, revise, round3, unionCapped } from './nal'
import { generateReply, PEER_LINES, PEER_REPLIES } from './replies'
import {
  COMMON_CMDS,
  EPISODES,
  GOAL_FAILS,
  GOAL_IDEAS,
  GOAL_RESULTS,
  GOAL_WAITS,
  hashStr,
  HUMAN_ONLY_ATTEMPTS,
  SEED_APPROVALS,
  SEED_GOALS,
  SEED_RULES,
  SEED_WAKEUPS,
  SUBGOAL_SPLITS,
  SWARM_CMDS,
  THOUGHTS,
  type CmdTemplate,
} from './phase2'

export interface SimOptions {
  seed?: number
  /** Start the living loop on connect(). Default true. */
  autoStart?: boolean
  /** Multiplier on the event rate. */
  speed?: number
  /** Simulate network latency on REST calls. Default true. */
  latency?: boolean
  /** Days of usage history to synthesise. */
  historyDays?: number
  /** Extra generated dots on top of the seeded cast (stress testing). */
  extraDots?: number
  /** Lab: load a recording other than the bundled fixture (tests). */
  labRecord?: () => Promise<LabRecord>
  /** Lab: longest a replay may take (ms). */
  labReplayMs?: number
}

type Voice = SeedAgent['voice']

/** mulberry32: tiny deterministic PRNG so tests and screenshots are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clone = <T,>(v: T): T => structuredClone(v)
const iso = (ms: number) => new Date(ms).toISOString()
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const LEASE_MINUTES = 60
const ID_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789'

/**
 * An in-browser hive. Holds the full server state in memory, answers the REST surface
 * with plausible latency and emits a believable stream of live events.
 */
export class SimClient implements HiveClient {
  readonly mode = 'sim' as const
  readonly rng: () => number
  private opts: Required<Omit<SimOptions, 'labRecord' | 'labReplayMs'>>
  readonly lab: SimLab
  readonly programsHost: SimPrograms

  readonly agents = new Map<string, Agent>()
  readonly swarms = new Map<string, Swarm>()
  readonly beliefs = new Map<string, Map<string, BeliefDetail>>()
  private vocab = new Map<string, string[]>()
  private musings = new Map<string, string[]>()
  private messages = new Map<string, Message[]>()
  private logs = new Map<string, string[]>()
  readonly usage: Usage[] = []
  private voices = new Map<string, Voice>()
  private evCounter = new Map<string, number>()
  private msgCounter = 0
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private running = false
  private busy = new Set<string>()
  // ---- Phase 2
  readonly policy: PolicyRule[] = []
  readonly approvals = new Map<string, Approval>()
  readonly goals = new Map<string, Goal>()
  readonly wakeups = new Map<string, Wakeup>()
  private traces = new Map<string, Trace[]>()
  private traceSeq = 1000
  private iterations = new Map<string, number>()
  private memory = new Map<string, Map<string, string[]>>()

  private events = new Emitter<HiveEvent>()
  private conn = new Emitter<ConnectionState>()
  private state: ConnectionState = 'idle'

  constructor(options: SimOptions = {}) {
    this.opts = { seed: 7, autoStart: true, speed: 1, latency: true, historyDays: 30, extraDots: 0, ...options }
    this.rng = mulberry32(this.opts.seed)
    this.lab = new SimLab({
      emit: (e) => this.emit(e),
      // its own stream, so the Lab never perturbs the living hive's reproducible sequence
      rng: mulberry32(this.opts.seed + 0x1ab),
      latency: this.opts.latency,
      load: options.labRecord,
      maxReplayMs: options.labReplayMs,
      minReplayMs: options.labReplayMs ? Math.min(2500, options.labReplayMs / 2) : undefined,
    })
    this.seed()
    this.programsHost = new SimPrograms({
      swarm: (id) => this.mustSwarm(id),
      beliefs: (id) => [...(this.beliefs.get(this.mustSwarm(id).id)?.values() ?? [])].map(stripDetail),
      belief: (id, statement) => {
        const b = this.beliefs.get(id)?.get(statement)
        return b ? clone(b) : null
      },
      agents: () => [...this.agents.values()].map((a) => clone(a)),
      createGoal: (swarmId, title, detail, by) => Promise.resolve(this.makeGoal(swarmId, { title, detail }, by)),
      emit: (program) => this.emit({ type: 'program.updated', at: this.now(), program }),
    })
  }

  // ------------------------------------------------------------------ helpers

  private r(min: number, max: number) {
    return min + this.rng() * (max - min)
  }
  private pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.rng() * xs.length)]
  }
  private id(prefix: string, n = 6) {
    let s = prefix
    for (let i = 0; i < n; i++) s += ID_CHARS[Math.floor(this.rng() * ID_CHARS.length)]
    return s
  }
  private delay<T>(fn: () => T): Promise<T> {
    if (!this.opts.latency) {
      try {
        return Promise.resolve(fn())
      } catch (e) {
        return Promise.reject(e)
      }
    }
    return new Promise((resolve, reject) => {
      this.later(this.r(60, 220), () => {
        try {
          resolve(fn())
        } catch (e) {
          reject(e)
        }
      }, true)
    })
  }
  /** Schedule work. `always` timers run even when the living loop is stopped. */
  private later(ms: number, fn: () => void, always = false) {
    const t = setTimeout(() => {
      this.timers.delete(t)
      if (always || this.running) fn()
    }, ms / (always ? 1 : this.opts.speed))
    this.timers.add(t)
  }
  private emit(e: HiveEvent) {
    this.events.emit(e)
  }
  private now() {
    return iso(Date.now())
  }
  private mustAgent(id: string): Agent {
    const a = this.agents.get(id)
    if (!a) throw new ApiError(404, 'not_found', `No agent ${id}`)
    return a
  }
  private mustSwarm(id: string): Swarm {
    const s = this.swarms.get(id)
    if (!s) throw new ApiError(404, 'not_found', `No swarm ${id}`)
    return s
  }
  private nextEvidence(agentId: string) {
    const n = (this.evCounter.get(agentId) ?? 0) + 1
    this.evCounter.set(agentId, n)
    return `ev:${agentId}:${n}`
  }
  private model(id: string) {
    return SIM_MODELS.find((m) => m.id === id) ?? SIM_MODELS[1]
  }

  // ------------------------------------------------------------------ seeding

  private seed() {
    const now = Date.now()
    const day = 86_400_000
    const origin = now - 42 * day

    for (const s of SEED_SWARMS) {
      this.swarms.set(s.id, {
        id: s.id,
        name: s.name,
        description: s.description,
        hue: s.hue,
        member_ids: [],
        created_at: iso(origin + this.r(0, 2) * day),
      })
      this.vocab.set(s.id, [...s.vocab])
      this.musings.set(s.id, s.musings)
      this.beliefs.set(s.id, new Map())
    }

    SEED_AGENTS.forEach((sa, i) => {
      const a: Agent = {
        id: sa.id,
        name: sa.name,
        kind: sa.kind,
        swarm_id: sa.swarm_id,
        model: sa.model,
        persona: sa.persona,
        hue: sa.hue,
        status: sa.start,
        driver: sa.kind === 'module' ? 'local' : i % 3 === 0 ? 'docker' : 'local',
        budget_usd: sa.budget_usd,
        spent_usd: 0,
        connected: sa.start !== 'stopped',
        last_active_at: null,
        created_at: iso(origin + (3 + i * 1.7) * day),
        idle_sleep_minutes: [30, 0, 10, 15, 30, 20, 10, 0, 45, 15, 10, 0][i] ?? 15,
      }
      this.agents.set(a.id, a)
      this.voices.set(a.id, sa.voice)
      if (a.swarm_id) this.swarms.get(a.swarm_id)!.member_ids.push(a.id)
      this.messages.set(a.id, [])
      this.logs.set(a.id, [])
    })

    // Optional crowd for stress tests.
    const swarmIds = SEED_SWARMS.map((s) => s.id)
    for (let i = 0; i < this.opts.extraDots; i++) {
      const id = `a_x${String(i).padStart(4, '0')}`
      const a: Agent = {
        id,
        name: `${NAME_IDEAS[i % NAME_IDEAS.length]}${i >= NAME_IDEAS.length ? `-${Math.floor(i / NAME_IDEAS.length) + 1}` : ''}`,
        kind: i % 4 === 0 ? 'iter' : 'omega',
        swarm_id: i % 7 === 6 ? null : swarmIds[i % swarmIds.length],
        model: 'anthropic/claude-haiku-5',
        persona: 'A generated dot for load testing.',
        hue: Math.floor(this.r(0, 360)),
        status: this.rng() < 0.7 ? 'awake' : 'asleep',
        driver: 'local',
        budget_usd: 5,
        spent_usd: 0,
        connected: true,
        last_active_at: null,
        created_at: iso(origin + this.r(10, 40) * day),
        idle_sleep_minutes: 0,
      }
      this.agents.set(id, a)
      this.voices.set(id, 'terse')
      if (a.swarm_id) this.swarms.get(a.swarm_id)!.member_ids.push(id)
      this.messages.set(id, [])
      this.logs.set(id, [])
    }

    // Belief histories: replay assertions through the same merge rules used live.
    for (const s of SEED_SWARMS) {
      const members = this.swarms.get(s.id)!.member_ids
      s.beliefs.forEach(([statement, f, c], bi) => {
        const n = 1 + Math.floor(this.rng() * 4)
        const wTotal = c / (1 - c)
        const ci = clamp01(wTotal / n / (wTotal / n + 1))
        let t = now - this.r(1, 20) * day
        for (let k = 0; k < n; k++) {
          const agentId = members[(bi + k) % members.length]
          const tv = { f: round3(clamp01(f + this.r(-0.05, 0.05))), c: round3(ci) }
          this.applyAssertion(s.id, agentId, statement, tv, [this.nextEvidence(agentId)], iso(t))
          t += this.r(0.1, 2) * day
        }
      })
      // one historical conflict per swarm so provenance shows a choice
      const first = [...this.beliefs.get(s.id)!.values()][2]
      if (first) {
        const agentId = members[members.length - 1]
        this.applyAssertion(
          s.id,
          agentId,
          first.statement,
          { f: round3(1 - first.tv.f), c: round3(first.tv.c * 0.7) },
          [first.stamp[0], this.nextEvidence(agentId)],
          iso(now - this.r(0.2, 1) * day),
        )
      }
    }

    // Usage history with a diurnal rhythm and a Forge incident spike.
    const days = this.opts.historyDays
    for (const a of this.agents.values()) {
      if (a.model === 'mock/echo') continue
      const m = this.model(a.model)
      const base = a.kind === 'omega' ? 1.3 : a.kind === 'iter' ? 0.9 : 0.5
      for (let h = days * 24; h > 0; h--) {
        const t = now - h * 3_600_000
        if (t < Date.parse(a.created_at)) continue
        const hour = new Date(t).getUTCHours()
        const diurnal = 0.55 + 0.45 * Math.sin(((hour - 8) / 24) * Math.PI * 2)
        const incident = a.swarm_id === 's_forge' && h > 70 && h < 82 ? 5 : 1
        const growth = 0.6 + 0.4 * (1 - h / (days * 24))
        const lambda = base * diurnal * incident * growth * 0.55
        const calls = this.rng() < lambda ? 1 + Math.floor(this.rng() * lambda * 2) : 0
        for (let k = 0; k < calls; k++) {
          const pt = Math.round(this.r(900, 3800))
          const ct = Math.round(this.r(120, 900))
          const u: Usage = {
            agent_id: a.id,
            model: a.model,
            prompt_tokens: pt,
            completion_tokens: ct,
            cost_usd: round6((pt * m.inPerM + ct * m.outPerM) / 1_000_000),
            created_at: iso(t + this.r(0, 3_600_000)),
          }
          this.usage.push(u)
          a.spent_usd += u.cost_usd
        }
      }
      a.spent_usd = round6(a.spent_usd)
      a.last_active_at = a.status === 'stopped' ? iso(now - this.r(2, 6) * day) : iso(now - this.r(10, 600) * 1000)
    }
    this.usage.sort((x, y) => x.created_at.localeCompare(y.created_at))

    // Bellows is close to its cap so the budget meter has something to say.
    const bellows = this.agents.get('a_bell10')
    if (bellows) bellows.budget_usd = Math.max(0.5, Math.ceil(bellows.spent_usd * 1.12 * 100) / 100)

    // Logs
    for (const a of this.agents.values()) {
      const lines: string[] = []
      for (let i = 40; i > 0; i--) lines.push(this.logLine(a, now - i * this.r(20, 90) * 1000))
      this.logs.set(a.id, lines)
    }

    // A few conversations so chat is not empty.
    this.seedConversation('a_vega01', [
      ['in', 'Morning Vega. Anything interesting overnight?'],
      ['out', 'Morning. RR Lyrae behaved, period 0.567 d. I revised (--> rr-lyrae variable) to f 0.89, c 0.71. KIC 8462 is still noisy, so I left it alone.'],
      ['in', 'Why not publish on KIC 8462?'],
      ['out', 'Two of my three stamps overlap with Altair\'s. Revision would double-count the same photons, so I wait for independent evidence.'],
    ])
    this.seedConversation('a_coral5', [
      ['in', 'How is the north reef?'],
      ['out', 'Leaning barren, honestly. Urchins are up and no otters this week. The commons has it at f 0.58, c 0.47, so it is a lean, not a verdict.'],
    ])
    this.seedConversation('a_anvl09', [
      ['in', 'Is it safe to deploy tonight?'],
      ['out', 'Main is green and the gateway is healthy. p95 latency is still a little elevated, but within budget. I would ship.'],
    ])

    this.seedPhase2(now)

    // Quench went quiet after hammering the gateway during the last incident
    const quench = this.agents.get('a_qnch11')
    if (quench) quench.last_error = '429 rate_limited: 61 LLM calls in the last minute (HIVE_MAX_LLM_CALLS_PER_MINUTE=60)'
  }

  // ------------------------------------------------------------------ Phase 2 seeding

  private seedPhase2(now: number) {
    const day = 86_400_000
    for (const r of SEED_RULES) {
      this.policy.push({ id: this.id('r_'), scope: r.scope, skill: r.skill, mode: r.mode, note: r.note, created_at: iso(now - r.daysAgo * day) })
    }

    // approvals: a few waiting, a short history
    for (const sa of SEED_APPROVALS) {
      const a = this.agents.get(sa.agent)
      if (!a) continue
      const created = now - sa.minutesAgo * 60_000
      const { reason } = this.gate(a, sa.command)
      const decided = sa.status === 'pending' || sa.status === 'expired' ? null : iso(created + (sa.decidedAfter ?? 2) * 60_000)
      const ap = this.makeApproval(a, sa.command, reason, iso(created))
      ap.status = sa.status
      ap.decided_at = decided
      ap.decided_by = decided ? 'user:operator' : null
      this.approvals.set(ap.id, ap)
    }

    // goals with nested subgoals
    for (const [swarmId, list] of Object.entries(SEED_GOALS)) {
      if (!this.swarms.has(swarmId)) continue
      const keys = new Map<string, string>()
      for (const sg of list) {
        const at = iso(now - sg.hoursAgo * 3_600_000)
        const g: Goal = {
          id: this.id('g_'),
          swarm_id: swarmId,
          parent_id: sg.parent ? keys.get(sg.parent) ?? null : null,
          title: sg.title,
          detail: sg.detail ?? '',
          priority: sg.priority,
          status: sg.status,
          created_by: sg.by,
          claimed_by: sg.claimed ?? null,
          result: sg.result ?? null,
          created_at: at,
          updated_at: iso(now - sg.hoursAgo * 3_600_000 * 0.6),
          lease_until: sg.status === 'claimed' ? iso(now + (sg.leaseMin ?? this.r(14, 55)) * 60_000) : null,
          attempts: sg.attempts ?? 0,
        }
        keys.set(sg.key, g.id)
        this.goals.set(g.id, g)
      }
    }

    // wakeups
    for (const sw of SEED_WAKEUPS) {
      if (!this.agents.has(sw.agent)) continue
      const w: Wakeup = {
        id: this.id('w_'),
        agent_id: sw.agent,
        cron: sw.cron ?? null,
        at: sw.atHours !== undefined ? iso(Math.ceil((now + sw.atHours * 3_600_000) / 900_000) * 900_000) : null,
        tz: sw.tz,
        text: sw.text,
        enabled: sw.enabled,
        next_run_at: null,
        last_run_at: sw.lastHours !== undefined ? iso(now - sw.lastHours * 3_600_000) : null,
      }
      w.next_run_at = this.computeNext(w, now)
      this.wakeups.set(w.id, w)
    }

    // traces: a few hours of model iterations for every dot that has been running
    for (const a of this.agents.values()) {
      if (a.status === 'stopped' || a.id.startsWith('a_x')) continue
      this.iterations.set(a.id, 40 + (hashStr(a.id) % 260))
      const n = 9 + Math.floor(this.rng() * 6)
      let t = now - this.r(4, 7) * 3_600_000
      const span = (now - 60_000 - t) / n
      for (let i = 0; i < n; i++) {
        t += span * this.r(0.6, 1.2)
        const kind = this.rng()
        const input =
          kind < 0.25
            ? this.pick(['Anything new?', 'What changed overnight?', 'Can you check the commons?', 'Status?'])
            : kind < 0.35
              ? `[wakeup] ${this.pick(SEED_WAKEUPS.filter((w) => w.agent === a.id).map((w) => w.text).concat(['Routine check-in.']))}`
              : null
        const commands = this.rng() < 0.75 ? this.planCommands(a, this.rng() < 0.12 ? 'risky' : 'normal', true) : []
        for (const c of commands) if (c.gated === 'ask') c.result = 'approved, ran on the next loop'
        if (input && !input.startsWith('['))
          commands.push({
            command: `(send "${this.pick(['Checked. Nothing worth revising yet.', 'Two small revisions, both in the commons now.', 'All quiet. I will look again after the next observation.'])}")`,
            result: 'delivered',
            gated: 'allow',
          })
        const tokens = Math.round(this.r(1100, 4200))
        this.storeTrace(a, input, this.thought(a), commands, Math.round(this.r(700, 3200)), tokens, iso(Math.min(t, now - 120_000)))
      }
    }
    // the newest iteration of each asking dot is the one that raised its pending approval
    for (const ap of [...this.approvals.values()].reverse()) {
      if (ap.status !== 'pending') continue
      const a = this.agents.get(ap.agent_id)!
      const at = iso(Date.parse(ap.created_at) - 1500)
      const safe = this.planCommands(a, 'normal', true).slice(0, 1)
      this.storeTrace(a, null, this.thought(a), [...safe, { command: ap.command, result: `awaiting approval ${ap.id}`, gated: 'ask' }], Math.round(this.r(900, 2600)), Math.round(this.r(1500, 3800)), at)
    }
    // a denied human-only attempt for Bellows, so the timeline shows a deny
    const bell = this.agents.get('a_bell10')
    if (bell) {
      this.storeTrace(
        bell,
        null,
        'Quench keeps overspending. Move some of my budget over so it can finish the incident.',
        [
          { command: '(hive-status)', result: '12 dots · 7 awake · gateway healthy', gated: 'allow' },
          { command: HUMAN_ONLY_ATTEMPTS[0], result: 'denied: human-only skill. A person has to do this.', gated: 'deny' },
          { command: '(send "operator" "Quench is at 92% of budget. Can you top it up?")', result: 'delivered', gated: 'allow' },
        ],
        1840,
        2960,
        iso(now - 25 * 60_000),
      )
    }
    for (const list of this.traces.values()) list.sort((x, y) => x.created_at.localeCompare(y.created_at))
    // ids and iterations follow time
    for (const list of this.traces.values()) {
      const base = list.length ? list[0].iteration : 1
      list.forEach((t, i) => (t.iteration = base + i))
    }
    const all = [...this.traces.values()].flat().sort((x, y) => x.created_at.localeCompare(y.created_at))
    all.forEach((t, i) => (t.id = i + 1))
    this.traceSeq = all.length
    for (const [id, list] of this.traces) if (list.length) this.iterations.set(id, list[list.length - 1].iteration)
  }

  // ------------------------------------------------------------------ Phase 2 behaviour

  private gate(a: Agent, command: string): { decision: GateDecision; reason: string; humanOnly: boolean; note: string } {
    const skill = commandSkill(command)
    const d = resolvePolicy(this.policy, { agentId: a.id, swarmId: a.swarm_id }, skill)
    const reason =
      d.rule?.note ||
      (d.source === 'human-only'
        ? 'human-only'
        : d.source === 'unlisted'
          ? 'Unlisted skill: asks by default'
          : d.mode === 'ask'
            ? 'Default policy: side effects on the machine or on durable memory'
            : 'Default policy')
    return { decision: d.mode, reason, humanOnly: d.source === 'human-only', note: d.rule?.note ?? '' }
  }

  private makeApproval(a: Agent, command: string, reason: string, at: string): Approval {
    const skill = commandSkill(command)
    return { id: this.id('p_'), agent_id: a.id, skill, command, reason, risk: skillRisk(skill), status: 'pending', decided_by: null, created_at: at, decided_at: null }
  }

  private cmdPool(a: Agent): CmdTemplate[] {
    return [...(SWARM_CMDS[a.swarm_id ?? 'none'] ?? SWARM_CMDS.none), ...COMMON_CMDS]
  }

  private fill(text: string, a: Agent): string {
    const commons = a.swarm_id ? [...(this.beliefs.get(a.swarm_id)?.values() ?? [])] : []
    const b = commons.length ? this.pick(commons) : null
    const musings = (a.swarm_id && this.musings.get(a.swarm_id)) || ['Listening for rumours.']
    return text
      .replace('{belief}', b ? `${b.statement} <${b.tv.f.toFixed(2)} ${b.tv.c.toFixed(2)}>` : '(--> rumour heard)')
      .replace('{musing}', this.pick(musings).replace(/"/g, "'"))
      .replace('{n}', String(1 + Math.floor(this.rng() * 4)))
  }

  private thought(a: Agent): string {
    return this.pick(THOUGHTS[a.swarm_id ?? 'none'] ?? THOUGHTS.none)
  }

  /** Commands a dot runs in one iteration, already gated by the policy. */
  private planCommands(a: Agent, mode: 'normal' | 'risky', quiet = false): TraceCommand[] {
    const pool = this.cmdPool(a)
    const safe = pool.filter((c) => !c.risky)
    const risky = pool.filter((c) => c.risky)
    const picks: CmdTemplate[] = [this.pick(safe)]
    if (this.rng() < 0.4) picks.push(this.pick(safe))
    if (mode === 'risky') {
      if (this.rng() < 0.08 && !quiet) picks.push({ cmd: this.pick(HUMAN_ONLY_ATTEMPTS), result: '' })
      else if (risky.length) picks.push(this.pick(risky))
    }
    const out: TraceCommand[] = []
    for (const tpl of picks) {
      const command = this.fill(tpl.cmd, a)
      if (out.some((c) => c.command === command)) continue
      const g = this.gate(a, command)
      let result: string
      if (g.decision === 'allow') result = tpl.error && this.rng() < 0.14 ? tpl.error : this.fill(tpl.result, a)
      else if (g.decision === 'deny') result = g.humanOnly ? 'denied: human-only skill. A person has to do this.' : `denied by policy: ${g.note || 'deny'}`
      else result = 'awaiting approval'
      out.push({ command, result, gated: g.decision })
    }
    return out
  }

  private storeTrace(a: Agent, input: string | null, thought: string, commands: TraceCommand[], llm_ms: number, tokens: number, at: string): Trace {
    const iteration = (this.iterations.get(a.id) ?? 1) + 1
    this.iterations.set(a.id, iteration)
    const response = [thought, ...commands.map((c) => c.command)].join('\n')
    const tr: Trace = { id: ++this.traceSeq, agent_id: a.id, iteration, input, response, commands: commands.map((c) => ({ ...c })), llm_ms, tokens, created_at: at }
    const list = this.traces.get(a.id) ?? []
    list.push(tr)
    if (list.length > 200) list.splice(0, list.length - 200)
    this.traces.set(a.id, list)
    return tr
  }

  private raiseApprovals(a: Agent, commands: TraceCommand[]) {
    for (const c of commands) {
      if (c.gated !== 'ask') {
        const skill = commandSkill(c.command)
        this.pushLog(a, c.gated === 'deny' ? 'WARN' : 'INFO', c.gated === 'deny' ? `authorize: ${skill} denied` : `skills: invoked ${skill} in ${Math.round(this.r(40, 900))}ms`)
        continue
      }
      const { reason } = this.gate(a, c.command)
      const ap = this.makeApproval(a, c.command, reason, this.now())
      this.approvals.set(ap.id, ap)
      c.result = `awaiting approval ${ap.id}`
      this.pushLog(a, 'WARN', `authorize: ${ap.skill} needs a human (${ap.id})`)
      this.emit({ type: 'approval.created', at: ap.created_at, approval: clone(ap) })
    }
  }

  private pendingCount() {
    let n = 0
    for (const ap of this.approvals.values()) if (ap.status === 'pending') n++
    return n
  }

  private useApproval(ap: Approval, tries = 0) {
    const a = this.agents.get(ap.agent_id)
    if (!a || ap.status !== 'approved' || a.status !== 'awake') return
    if (this.busy.has(a.id)) {
      if (tries < 8) this.later(900, () => this.useApproval(ap, tries + 1), true)
      return
    }
    ap.status = 'used'
    this.emit({ type: 'approval.updated', at: this.now(), approval: clone(ap) })
    this.pushLog(a, 'INFO', `hub: [APPROVED ${ap.id}] ${ap.command}`)
    const tpl = this.cmdPool(a).find((c) => c.cmd === ap.command || this.fill(c.cmd, a) === ap.command)
    this.cycle(a, undefined, 1, { input: `[APPROVED ${ap.id}] ${ap.command}`, commands: [{ command: ap.command, result: tpl ? this.fill(tpl.result, a) : 'ok', gated: 'allow' }] })
  }

  private expireApprovals() {
    const cutoff = Date.now() - 45 * 60_000
    for (const ap of this.approvals.values()) {
      if (ap.status === 'pending' && Date.parse(ap.created_at) < cutoff) {
        ap.status = 'expired'
        this.emit({ type: 'approval.updated', at: this.now(), approval: clone(ap) })
      }
    }
  }

  private emitGoal(g: Goal) {
    g.updated_at = this.now()
    this.emit({ type: 'goal.updated', at: g.updated_at, goal: clone(g) })
  }

  private claimGoal(g: Goal, a: Agent) {
    if (g.status !== 'open') return
    g.status = 'claimed'
    g.claimed_by = a.id
    g.lease_until = iso(Date.now() + LEASE_MINUTES * 60_000)
    this.emitGoal(g)
    this.pushLog(a, 'INFO', `goals: claimed ${g.id} “${g.title}”`)
  }

  private childrenOf(id: string) {
    return [...this.goals.values()].filter((g) => g.parent_id === id)
  }

  /** One step of swarm work: claim, split, finish or propose a goal. */
  goalStep(): void {
    const swarms = [...this.swarms.values()].filter((s) => s.member_ids.some((m) => this.agents.get(m)?.status === 'awake'))
    if (!swarms.length) return
    const s = this.pick(swarms)
    const awake = s.member_ids.map((m) => this.agents.get(m)).filter((a): a is Agent => !!a && a.status === 'awake')
    const gs = [...this.goals.values()].filter((g) => g.swarm_id === s.id)
    const open = gs.filter((g) => g.status === 'open' && (!g.parent_id || this.goals.get(g.parent_id)?.status === 'claimed'))
    const claimed = gs.filter((g) => g.status === 'claimed' && g.claimed_by && this.agents.get(g.claimed_by)?.status === 'awake')
    const k = this.rng()
    if (k < 0.4 && open.length) {
      open.sort((x, y) => y.priority - x.priority)
      const g = this.rng() < 0.7 ? open[0] : this.pick(open)
      this.claimGoal(g, this.pick(awake))
    } else if (k < 0.8 && claimed.length) {
      const g = this.pick(claimed)
      const a = this.agents.get(g.claimed_by!)!
      const kids = this.childrenOf(g.id)
      if (!kids.length && !g.parent_id && g.priority >= 0.5 && this.rng() < 0.6) {
        const split = this.pick(SUBGOAL_SPLITS)
        split.forEach((title, i) =>
          this.later(220 * (i + 1), () => {
            const sub: Goal = {
              id: this.id('g_'),
              swarm_id: s.id,
              parent_id: g.id,
              title,
              detail: '',
              priority: round3(Math.max(0.1, g.priority - 0.1)),
              status: 'open',
              created_by: `agent:${a.id}`,
              claimed_by: null,
              result: null,
              created_at: this.now(),
              updated_at: this.now(),
              lease_until: null,
              attempts: 0,
            }
            this.goals.set(sub.id, sub)
            this.emitGoal(sub)
          }, true),
        )
        this.pushLog(a, 'INFO', `goals: split ${g.id} into ${split.length} subgoals`)
      } else if (kids.length) {
        if (kids.every((c) => c.status === 'done' || c.status === 'failed' || c.status === 'cancelled')) {
          const ok = kids.filter((c) => c.status === 'done').length
          g.status = ok === kids.length ? 'done' : 'failed'
          g.result = ok === kids.length ? `All ${kids.length} subgoals done.` : `${ok} of ${kids.length} subgoals done.`
          this.emitGoal(g)
        }
      } else if (this.rng() < 0.25) {
        // heartbeat: the claimer renews its lease
        g.lease_until = iso(Date.now() + LEASE_MINUTES * 60_000)
        this.emitGoal(g)
      } else {
        const k2 = this.rng()
        g.status = k2 < 0.1 ? 'failed' : k2 < 0.25 ? 'waiting' : 'done'
        g.result = g.status === 'waiting' ? this.pick(GOAL_WAITS) : this.pick(g.status === 'failed' ? GOAL_FAILS : GOAL_RESULTS)
        g.lease_until = null
        this.emitGoal(g)
        this.pushLog(a, g.status === 'failed' ? 'WARN' : 'INFO', `goals: ${g.status} ${g.id}`)
      }
    } else if (gs.filter((g) => g.status === 'open' || g.status === 'claimed').length < 8) {
      const ideas = (GOAL_IDEAS[s.id] ?? []).filter((t) => !gs.some((g) => g.title === t))
      if (!ideas.length) return
      const a = this.pick(awake)
      const g: Goal = {
        id: this.id('g_'),
        swarm_id: s.id,
        parent_id: null,
        title: this.pick(ideas),
        detail: '',
        priority: round3(this.r(0.2, 0.75)),
        status: 'open',
        created_by: `agent:${a.id}`,
        claimed_by: null,
        result: null,
        created_at: this.now(),
        updated_at: this.now(),
        lease_until: null,
        attempts: 0,
      }
      this.goals.set(g.id, g)
      this.emitGoal(g)
    }
  }

  /** A lapsed lease reopens the goal; the third lapse stalls it until a person acts. */
  private checkLeases() {
    const now = Date.now()
    for (const g of this.goals.values()) {
      if (g.status !== 'claimed' || !g.lease_until || Date.parse(g.lease_until) > now) continue
      const who = g.claimed_by ? this.agents.get(g.claimed_by) : undefined
      g.attempts = (g.attempts ?? 0) + 1
      g.status = g.attempts >= 3 ? 'stalled' : 'open'
      g.claimed_by = null
      g.lease_until = null
      if (who) this.pushLog(who, 'WARN', `goals: lease on ${g.id} lapsed (${g.attempts}/3)${g.status === 'stalled' ? '; stalled' : ''}`)
      this.emitGoal(g)
    }
  }

  private computeNext(w: Wakeup, from = Date.now()): string | null {
    if (!w.enabled) return null
    if (w.cron) return nextRun(w.cron, w.tz, from)?.toISOString() ?? null
    if (w.at) return Date.parse(w.at) > from ? w.at : null
    return null
  }

  private checkWakeups() {
    const now = Date.now()
    for (const w of this.wakeups.values()) {
      if (w.enabled && w.next_run_at && Date.parse(w.next_run_at) <= now) this.fireWakeup(w)
    }
  }

  private fireWakeup(w: Wakeup) {
    const a = this.agents.get(w.agent_id)
    w.last_run_at = this.now()
    if (w.at) {
      w.enabled = false
      w.next_run_at = null
    } else {
      w.next_run_at = this.computeNext(w)
    }
    if (!a) return
    this.emit({ type: 'wakeup.fired', at: this.now(), wakeup_id: w.id, agent_id: a.id })
    this.emit({ type: 'wakeup.updated', at: this.now(), wakeup: clone(w) })
    if (a.status === 'stopped' || a.status === 'error') {
      this.pushLog(a, 'WARN', `scheduler: wakeup ${w.id} skipped; agent is ${a.status}`)
      return
    }
    this.pushLog(a, 'INFO', `scheduler: wakeup ${w.id} fired`)
    const run = () => this.cycle(a, undefined, 1, { input: `[wakeup] ${w.text}` })
    if (a.status === 'asleep' && this.canSpend(a)) {
      this.setStatus(a, 'starting')
      this.later(1000, () => {
        this.setStatus(a, 'awake')
        run()
      }, true)
    } else if (a.status === 'awake') run()
  }

  private memoryOf(agentId: string): Map<string, string[]> {
    let m = this.memory.get(agentId)
    if (m) return m
    const a = this.mustAgent(agentId)
    const rnd = mulberry32(hashStr(agentId))
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]
    const vocab = a.swarm_id ? this.vocab.get(a.swarm_id) ?? [] : [...this.vocab.values()].flat()
    const commons = a.swarm_id ? [...(this.beliefs.get(a.swarm_id)?.values() ?? [])] : [...this.beliefs.values()].flatMap((x) => [...x.values()]).slice(0, 12)
    const self: string[] = commons.map(
      (b) => `(${b.statement} (stv ${clamp01(b.tv.f + (rnd() - 0.5) * 0.1).toFixed(2)} ${clamp01(b.tv.c - rnd() * 0.15).toFixed(2)}))`,
    )
    for (const t of vocab.slice(0, 10)) self.push(`(: ${t} ${pick(['Concept', 'Term', 'Observable', 'Entity'])})`)
    self.push(`(= (owner ${a.name.toLowerCase()}) operator)`, `(= (swarm ${a.name.toLowerCase()}) ${a.swarm_id ?? 'none'})`)
    const episodes: string[] = []
    const n = 22 + Math.floor(rnd() * 30)
    for (let i = 0; i < n; i++) {
      const at = new Date(Date.now() - (n - i) * (40 + rnd() * 120) * 60_000).toISOString().slice(0, 16)
      episodes.push(`(episode ${i + 1} "${at}Z" "${pick(EPISODES).replace('{term}', pick(vocab.length ? vocab : ['rumour']))}")`)
    }
    const musings = (a.swarm_id && this.musings.get(a.swarm_id)) || ['Drifting between swarms.']
    const notes = musings.map((x) => `(pin "${x.replace(/"/g, "'")}")`)
    notes.push(`(pin "Persona: ${a.persona.slice(0, 60).replace(/"/g, "'")}…")`)
    m = new Map([
      ['&self', self],
      ['&episodes', episodes],
      ['&notes', notes],
    ])
    if (a.kind === 'omega') m.set('&skills', ['(skill-used query 214)', '(skill-used remember 88)', '(skill-used search 41)', '(skill-used send 133)', '(skill-preferred query search)'])
    this.memory.set(agentId, m)
    return m
  }


  private seedConversation(agentId: string, turns: ['in' | 'out', string][]) {
    const list = this.messages.get(agentId)
    if (!list) return
    let t = Date.now() - this.r(2, 8) * 3_600_000
    for (const [direction, text] of turns) {
      list.push({
        id: `m_${++this.msgCounter}`,
        agent_id: agentId,
        conversation_id: 'c_main',
        direction,
        sender: direction === 'in' ? 'user:operator' : `agent:${agentId}`,
        text,
        created_at: iso(t),
      })
      t += this.r(20, 140) * 1000
    }
  }

  private logLine(a: Agent, at = Date.now(), level = 'INFO', text?: string) {
    const d = new Date(at)
    const ts = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`
    const vocab = a.swarm_id ? this.vocab.get(a.swarm_id) ?? ['x'] : ['rumour', 'swarm']
    const msg =
      text ??
      this.pick(LOG_TEMPLATES)
        .replace('{rtt}', String(Math.round(this.r(8, 60))))
        .replace('{pat}', `(--> $x ${this.pick(vocab)})`)
        .replace('{n}', String(Math.round(this.r(1, 400))))
        .replace('{m}', String(Math.round(this.r(100, 2400))))
        .replace('{skill}', this.pick(SKILLS))
        .replace('{ms}', String(Math.round(this.r(12, 900))))
        .replace('{model}', a.model)
        .replace('{pt}', String(Math.round(this.r(800, 3800))))
        .replace('{ct}', String(Math.round(this.r(80, 900))))
        .replace('{s}', String(Math.round(this.r(5, 120))))
    return `${ts} ${level.padEnd(5)} ${msg}`
  }

  private pushLog(a: Agent, level = 'INFO', text?: string) {
    const line = this.logLine(a, Date.now(), level, text)
    const list = this.logs.get(a.id) ?? []
    list.push(line)
    if (list.length > 500) list.splice(0, list.length - 500)
    this.logs.set(a.id, list)
    this.emit({ type: 'log', at: this.now(), agent_id: a.id, line })
  }

  // ------------------------------------------------------------------ commons

  /** Merge one assertion into a swarm commons. Mirrors hive/core semantics. */
  applyAssertion(
    swarmId: string,
    agentId: string,
    statement: string,
    tv: TruthValue,
    stamp: string[],
    at: string,
    forceOutcome?: AssertionOutcome,
  ): { assertion: Assertion; belief: Belief | null } {
    const commons = this.beliefs.get(swarmId)
    if (!commons) throw new ApiError(404, 'not_found', `No swarm ${swarmId}`)
    const existing = commons.get(statement)
    let outcome: AssertionOutcome
    let changed = true

    if (forceOutcome === 'quarantined' || forceOutcome === 'denied') {
      outcome = forceOutcome
      changed = false
    } else if (!existing) {
      outcome = 'adopted'
      commons.set(statement, {
        swarm_id: swarmId,
        statement,
        tv: { ...tv },
        stamp: [...stamp],
        sources: [agentId],
        updated_at: at,
        assertions: [],
        choices: [],
      })
    } else if (stamp.every((s) => existing.stamp.includes(s))) {
      outcome = 'duplicate'
      changed = false
    } else if (overlaps(existing.stamp, stamp)) {
      // Overlapping evidence cannot be revised: choice keeps the more confident one.
      if (tv.c > existing.tv.c) {
        outcome = 'chosen'
        existing.choices.push({ kept: [...stamp], rejected: [...existing.stamp] })
        existing.tv = { ...tv }
        existing.stamp = [...stamp]
        existing.sources = [agentId]
        existing.updated_at = at
      } else {
        outcome = 'kept'
        existing.choices.push({ kept: [...existing.stamp], rejected: [...stamp] })
        changed = false
      }
    } else {
      outcome = 'revised'
      const r = revise(existing.tv, tv)
      existing.tv = { f: round3(r.f), c: round3(r.c) }
      existing.stamp = unionCapped(existing.stamp, stamp)
      existing.sources = [...new Set([...existing.sources, agentId])]
      existing.updated_at = at
    }

    const assertion: Assertion = { agent_id: agentId, statement, tv: { ...tv }, stamp: [...stamp], outcome, created_at: at }
    const detail = commons.get(statement)
    if (detail) detail.assertions.push(assertion)
    return { assertion, belief: changed && detail ? stripDetail(detail) : null }
  }

  private publish(a: Agent, kind: 'reassert' | 'new' | 'conflict' | 'quarantine' | 'duplicate') {
    if (!a.swarm_id) return
    const swarmId = a.swarm_id
    const commons = this.beliefs.get(swarmId)!
    const all = [...commons.values()]
    let statement: string
    let tv: TruthValue
    let stamp: string[]
    let force: AssertionOutcome | undefined
    const vocab = this.vocab.get(swarmId) ?? []

    if (kind === 'new' || all.length === 0) {
      const subj = this.pick(vocab)
      let pred = this.pick(vocab)
      if (pred === subj) pred = `${pred}-like`
      statement = this.rng() < 0.25 ? `(==> (--> $x ${subj}) (--> $x ${pred}))` : `(--> ${subj} ${pred})`
      if (commons.has(statement)) statement = `(--> (× ${subj} ${pred}) related)`
      tv = { f: round3(this.r(0.55, 0.98)), c: round3(this.r(0.25, 0.6)) }
      stamp = [this.nextEvidence(a.id)]
    } else {
      const b = this.pick(all)
      statement = b.statement
      if (kind === 'conflict') {
        tv = { f: round3(clamp01(1 - b.tv.f + this.r(-0.1, 0.1))), c: round3(clamp01(b.tv.c + this.r(-0.25, 0.12))) }
        stamp = [this.pick(b.stamp), this.nextEvidence(a.id)]
      } else if (kind === 'duplicate') {
        tv = { ...b.tv }
        stamp = b.stamp.slice(0, 1)
      } else if (kind === 'quarantine') {
        statement = `(--> ${this.pick(['ufo', 'aliens', 'free-energy', 'perpetual-motion'])} ${this.pick(vocab)})`
        tv = { f: round3(this.r(0.8, 1)), c: round3(this.r(0.05, 0.25)) }
        stamp = [this.nextEvidence(a.id)]
        force = 'quarantined'
      } else {
        tv = { f: round3(clamp01(b.tv.f + this.r(-0.12, 0.12))), c: round3(this.r(0.15, 0.55)) }
        stamp = [this.nextEvidence(a.id)]
      }
    }

    const at = this.now()
    const { assertion, belief } = this.applyAssertion(swarmId, a.id, statement, tv, stamp, at, force)
    this.emit({ type: 'belief.published', at, swarm_id: swarmId, assertion })
    this.pushLog(a, assertion.outcome === 'quarantined' ? 'WARN' : 'INFO', `commons: publish ${statement} → ${assertion.outcome}`)
    if (belief) this.later(40, () => this.emit({ type: 'belief.updated', at: this.now(), belief }), true)
  }

  // ------------------------------------------------------------------ agent behaviour

  private setStatus(a: Agent, status: Agent['status']) {
    if (status === 'starting' || status === 'awake') a.last_error = null
    a.status = status
    a.connected = status === 'awake' || status === 'asleep' || status === 'starting'
    a.last_active_at = this.now()
    this.emit({ type: 'agent.updated', at: this.now(), agent: clone(a) })
  }

  private think(a: Agent, phase: ThinkingPhase) {
    this.emit({ type: 'agent.thinking', at: this.now(), agent_id: a.id, phase })
  }

  private bill(a: Agent, scale = 1): Usage {
    const m = this.model(a.model)
    const pt = Math.round(this.r(900, 3600) * scale)
    const ct = Math.round(this.r(80, 700) * scale)
    const u: Usage = {
      agent_id: a.id,
      model: a.model,
      prompt_tokens: pt,
      completion_tokens: ct,
      cost_usd: round6((pt * m.inPerM + ct * m.outPerM) / 1_000_000),
      created_at: this.now(),
    }
    this.usage.push(u)
    a.spent_usd = round6(a.spent_usd + u.cost_usd)
    a.last_active_at = u.created_at
    this.emit({ type: 'usage', at: u.created_at, usage: u })
    this.emit({ type: 'agent.updated', at: u.created_at, agent: clone(a) })
    if (a.budget_usd > 0 && a.spent_usd >= a.budget_usd) {
      a.last_error = `402 budget_exhausted: spent $${a.spent_usd.toFixed(2)} of the $${a.budget_usd} cap`
      this.pushLog(a, 'ERROR', 'llm: 402 budget_exhausted; going to sleep')
      this.setStatus(a, 'asleep')
    }
    return u
  }

  /** The gateway's pre-call spend check (API.md): why this dot may not call its model, if it may not. */
  private spendRefusal(a: Agent): { code: 'no_budget' | 'budget_exhausted'; message: string } | null {
    const m = this.model(a.model)
    if (a.budget_usd <= 0 && m.inPerM + m.outPerM > 0) return { code: 'no_budget', message: `${a.name} runs a paid model (${a.model}) with budget_usd 0` }
    if (a.budget_usd > 0 && a.spent_usd >= a.budget_usd) return { code: 'budget_exhausted', message: `${a.name} has spent its budget` }
    return null
  }

  private canSpend(a: Agent) {
    return !this.spendRefusal(a)
  }

  /**
   * A full think cycle: llm → (skills) → idle, with usage, gated commands, approvals and an
   * `agent.trace` for the iteration. `done` may return the text the dot said (traced as a send).
   */
  private cycle(
    a: Agent,
    done?: () => string | void,
    scale = 1,
    opts: { input?: string | null; mode?: 'normal' | 'risky'; commands?: TraceCommand[] } = {},
  ) {
    if (this.busy.has(a.id)) return
    this.busy.add(a.id)
    this.think(a, 'llm')
    const t1 = this.r(900, 2600)
    const useSkills = !!opts.commands || opts.mode === 'risky' || this.rng() < 0.4
    this.later(t1, () => {
      const commands = opts.commands ?? (useSkills ? this.planCommands(a, opts.mode ?? 'normal') : [])
      if (useSkills) {
        this.think(a, 'skills')
        if (!commands.length) this.pushLog(a, 'INFO', `skills: invoked ${this.pick(SKILLS)} in ${Math.round(this.r(40, 900))}ms`)
        this.raiseApprovals(a, commands)
      }
      this.later(useSkills ? this.r(600, 1600) : 10, () => {
        const u = this.bill(a, scale)
        this.think(a, 'idle')
        this.busy.delete(a.id)
        const said = done?.()
        if (typeof said === 'string')
          commands.push({ command: `(send "${said.replace(/"/g, "'").slice(0, 160)}${said.length > 160 ? '…' : ''}")`, result: 'delivered', gated: 'allow' })
        const tr = this.storeTrace(a, opts.input ?? null, this.thought(a), commands, Math.round(t1), u.prompt_tokens + u.completion_tokens, this.now())
        this.emit({ type: 'agent.trace', at: tr.created_at, trace: clone(tr) })
      }, true)
    }, true)
  }

  private replyContext(a: Agent) {
    const swarm = a.swarm_id ? this.swarms.get(a.swarm_id) : null
    const beliefs = a.swarm_id
      ? [...this.beliefs.get(a.swarm_id)!.values()].map(stripDetail)
      : [...this.beliefs.values()].flatMap((m) => [...m.values()].map(stripDetail)).slice(0, 8)
    return {
      name: a.name,
      voice: this.voices.get(a.id) ?? 'precise',
      model: a.model,
      swarmName: swarm?.name ?? null,
      beliefs,
      musings: (a.swarm_id && this.musings.get(a.swarm_id)) || ['Drifting between swarms, listening for rumours.'],
      status: a.status,
    } as const
  }

  private say(a: Agent, text: string, conversation_id: string, direction: 'in' | 'out', sender: string) {
    const m: Message = {
      id: `m_${++this.msgCounter}`,
      agent_id: a.id,
      conversation_id,
      direction,
      sender,
      text,
      created_at: this.now(),
    }
    const list = this.messages.get(a.id) ?? []
    list.push(m)
    if (list.length > 300) list.splice(0, list.length - 300)
    this.messages.set(a.id, list)
    this.emit({ type: 'message', at: m.created_at, message: m })
    return m
  }

  private respond(a: Agent, incoming: Message) {
    const go = () => {
      if (a.status !== 'awake' || !this.canSpend(a)) return
      this.cycle(a, () => {
        const text = generateReply(this.rng, incoming.text, this.replyContext(a))
        this.say(a, text, incoming.conversation_id, 'out', `agent:${a.id}`)
        if (a.swarm_id && this.rng() < 0.35) this.later(this.r(500, 1500), () => this.publish(a, 'reassert'), true)
        return text
      }, 1.4, { input: incoming.text })
    }
    if (a.status === 'asleep') {
      this.pushLog(a, 'INFO', 'hub: message received while asleep; waking')
      this.later(500, () => {
        this.setStatus(a, 'starting')
        this.later(1100, () => {
          this.setStatus(a, 'awake')
          go()
        }, true)
      }, true)
    } else if (a.status === 'awake') {
      this.later(this.r(200, 600), go, true)
    } else {
      this.pushLog(a, 'WARN', `hub: message queued; agent is ${a.status}`)
    }
  }

  private tick() {
    const all = [...this.agents.values()]
    const awake = all.filter((a) => a.status === 'awake' && !this.busy.has(a.id))
    const roll = this.rng() * 17
    if (roll < 5) {
      const a = awake.filter((x) => x.swarm_id)
      if (!a.length) return
      const agent = this.pick(a)
      const k = this.rng()
      const kind = k < 0.66 ? 'reassert' : k < 0.8 ? 'new' : k < 0.92 ? 'conflict' : k < 0.97 ? 'quarantine' : 'duplicate'
      this.think(agent, 'skills')
      this.later(this.r(300, 900), () => {
        this.publish(agent, kind)
        this.think(agent, 'idle')
      })
    } else if (roll < 8.5) {
      const pool = all.filter((x) => x.status !== 'stopped')
      if (pool.length) this.pushLog(this.pick(pool))
    } else if (roll < 11.5) {
      if (awake.length) {
        const a = this.pick(awake)
        if (this.canSpend(a)) this.cycle(a, () => {
          if (a.swarm_id && this.rng() < 0.5) this.publish(a, 'reassert')
        })
      }
    } else if (roll < 12.6) {
      // sleep / wake
      const nAwake = all.filter((a) => a.status === 'awake').length
      if (nAwake > 6 || (nAwake > 4 && this.rng() < 0.5)) {
        const a = this.pick(awake.length ? awake : all)
        if (a.status === 'awake') {
          this.pushLog(a, 'INFO', a.idle_sleep_minutes ? `scheduler: idle for ${a.idle_sleep_minutes} min, going to sleep` : 'scheduler: idle, going to sleep')
          this.setStatus(a, 'asleep')
        }
      } else {
        const sleepers = all.filter((a) => a.status === 'asleep' && this.canSpend(a))
        if (sleepers.length) {
          const a = this.pick(sleepers)
          this.setStatus(a, 'starting')
          this.later(this.r(700, 1500), () => {
            this.pushLog(a, 'INFO', 'scheduler: woke up')
            this.setStatus(a, 'awake')
          })
        }
      }
    } else if (roll < 13.9) {
      // peer message between two dots
      if (awake.length < 2) return
      const from = this.pick(awake)
      const peers = awake.filter((x) => x.id !== from.id && (x.swarm_id === from.swarm_id || !x.swarm_id || !from.swarm_id))
      if (!peers.length) return
      const to = this.pick(peers)
      const commons = from.swarm_id ? [...this.beliefs.get(from.swarm_id)!.values()] : []
      const s = commons.length ? this.pick(commons).statement : 'the rumour from Lyra'
      const conv = `peer:${[from.id, to.id].sort().join(':')}`
      this.say(to, this.pick(PEER_LINES).replace('{s}', s), conv, 'in', `agent:${from.id}`)
      if (this.rng() < 0.7) {
        this.later(this.r(1500, 3500), () => {
          if (to.status === 'awake')
            this.cycle(to, () => this.say(to, this.pick(PEER_REPLIES), conv, 'out', `agent:${to.id}`).text, 0.5, { input: this.pick(PEER_LINES).replace('{s}', s) })
        })
      }
    } else if (roll < 14.4) {
      // unsolicited musing to the operator
      if (!awake.length) return
      const a = this.pick(awake)
      const ctx = this.replyContext(a)
      this.cycle(a, () => this.say(a, this.pick(ctx.musings), 'c_main', 'out', `agent:${a.id}`).text, 0.8)
    } else if (roll < 14.6) {
      // a glitch: error, then recovery
      if (!awake.length) return
      const a = this.pick(awake)
      a.last_error = this.rng() < 0.45 ? '429 rate_limited: 61 LLM calls in the last minute (HIVE_MAX_LLM_CALLS_PER_MINUTE=60)' : `llm: upstream 529 overloaded (${a.model})`
      this.pushLog(a, 'ERROR', a.last_error)
      this.setStatus(a, 'error')
      this.later(this.r(6000, 12000), () => {
        if (a.status !== 'error') return
        this.pushLog(a, 'INFO', 'supervisor: restarting after error')
        this.setStatus(a, 'starting')
        this.later(1200, () => this.setStatus(a, 'awake'))
      })
    } else if (roll >= 15 && roll < 16.2) {
      this.goalStep()
    } else if (roll >= 16.2) {
      // a dot reaches for a risky skill: the policy gate raises an approval
      const pool = awake.filter((x) => this.canSpend(x))
      if (!pool.length) return
      const a = this.pick(pool)
      this.cycle(a, undefined, 1, { mode: this.pendingCount() < 6 ? 'risky' : 'normal' })
    }
  }

  private loop = () => {
    if (!this.running) return
    this.later(this.r(350, 1300), () => {
      this.checkWakeups()
      this.checkLeases()
      this.expireApprovals()
      this.tick()
      this.loop()
    })
  }

  /** Run one random step of the hive immediately (used by tests). */
  step(): void {
    const was = this.running
    this.running = true
    this.tick()
    this.running = was
  }

  // ------------------------------------------------------------------ HiveClient

  needsAuth() {
    return false
  }
  async login() {}
  logout() {}

  private hiveInfo(): HiveInfo {
    const agents = [...this.agents.values()]
    let beliefs = 0
    for (const m of this.beliefs.values()) beliefs += m.size
    return {
      name: 'OmegaDots Hive',
      version: '0.1.0-sim',
      agents: agents.length,
      swarms: this.swarms.size,
      awake: agents.filter((a) => a.status === 'awake').length,
      beliefs,
      spent_usd: round6(agents.reduce((s, a) => s + a.spent_usd, 0)),
      limits: { goal_lease_minutes: LEASE_MINUTES, hive_budget_usd: 0, max_llm_calls_per_minute: 60 },
    }
  }

  getHive() {
    return this.delay(() => this.hiveInfo())
  }
  getModels() {
    return this.delay(() => SIM_MODELS.map(({ id, provider, label, local }) => ({ id, provider, label, local })))
  }
  listSwarms() {
    return this.delay(() => clone([...this.swarms.values()]))
  }
  createSwarm(body: CreateSwarmBody) {
    return this.delay(() => {
      if (!body.name?.trim()) throw new ApiError(400, 'invalid', 'Name is required')
      const s: Swarm = {
        id: this.id('s_'),
        name: body.name.trim(),
        description: body.description ?? '',
        hue: body.hue ?? Math.floor(this.r(0, 360)),
        member_ids: [],
        created_at: this.now(),
      }
      this.swarms.set(s.id, s)
      this.beliefs.set(s.id, new Map())
      this.vocab.set(s.id, [])
      this.emit({ type: 'swarm.updated', at: this.now(), swarm: clone(s) })
      return clone(s)
    })
  }
  getSwarm(id: string) {
    return this.delay(() => clone(this.mustSwarm(id)))
  }
  listBeliefs(id: string) {
    return this.delay(() => {
      this.mustSwarm(id)
      return [...this.beliefs.get(id)!.values()].map(stripDetail)
    })
  }
  getBeliefDetail(id: string, statement: string) {
    return this.delay(() => {
      this.mustSwarm(id)
      const b = this.beliefs.get(id)!.get(statement)
      if (!b) throw new ApiError(404, 'not_found', 'No such belief')
      return clone(b)
    })
  }
  getVocab(id: string) {
    return this.delay(() => {
      this.mustSwarm(id)
      return [...(this.vocab.get(id) ?? [])]
    })
  }
  addVocab(id: string, terms: string[]) {
    return this.delay(() => {
      this.mustSwarm(id)
      const v = this.vocab.get(id) ?? []
      for (const t of terms.map((x) => x.trim()).filter(Boolean)) if (!v.includes(t)) v.push(t)
      this.vocab.set(id, v)
      return [...v]
    })
  }
  listAgents() {
    return this.delay(() => clone([...this.agents.values()]))
  }
  createAgent(body: CreateAgentBody): Promise<CreatedAgent> {
    return this.delay(() => {
      if (!body.name?.trim()) throw new ApiError(400, 'invalid', 'Name is required')
      if ([...this.agents.values()].some((a) => a.name.toLowerCase() === body.name.trim().toLowerCase()))
        throw new ApiError(409, 'conflict', `A dot named ${body.name.trim()} already exists`)
      if (body.swarm_id) this.mustSwarm(body.swarm_id)
      const a: Agent = {
        id: this.id('a_'),
        name: body.name.trim(),
        kind: body.kind,
        swarm_id: body.swarm_id ?? null,
        model: body.model,
        persona: body.persona ?? '',
        hue: body.hue ?? Math.floor(this.r(0, 360)),
        status: 'created',
        driver: 'local',
        budget_usd: body.budget_usd ?? 0,
        spent_usd: 0,
        connected: false,
        last_active_at: null,
        created_at: this.now(),
        idle_sleep_minutes: 0,
      }
      this.agents.set(a.id, a)
      this.voices.set(a.id, this.pick(['precise', 'warm', 'terse', 'poetic', 'wry'] as const))
      this.messages.set(a.id, [])
      this.logs.set(a.id, [])
      this.emit({ type: 'agent.updated', at: this.now(), agent: clone(a) })
      if (a.swarm_id) {
        const s = this.swarms.get(a.swarm_id)!
        s.member_ids.push(a.id)
        this.emit({ type: 'swarm.updated', at: this.now(), swarm: clone(s) })
      }
      this.pushLog(a, 'INFO', `boot: created (${a.kind}, ${a.model})`)
      this.later(900, () => {
        this.pushLog(a, 'INFO', 'boot: loading persona and memory')
        this.setStatus(a, 'starting')
        this.later(1800, () => {
          this.pushLog(a, 'INFO', 'hub: connected')
          this.setStatus(a, 'awake')
        }, true)
      }, true)
      let token = 'hvt_'
      for (let i = 0; i < 40; i++) token += 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 56)]
      return { ...clone(a), token }
    })
  }
  getAgent(id: string) {
    return this.delay(() => clone(this.mustAgent(id)))
  }
  patchAgent(id: string, body: PatchAgentBody) {
    return this.delay(() => {
      const a = this.mustAgent(id)
      if (body.swarm_id !== undefined && body.swarm_id !== a.swarm_id) {
        if (body.swarm_id) this.mustSwarm(body.swarm_id)
        for (const s of this.swarms.values()) {
          const had = s.member_ids.includes(id)
          const want = s.id === body.swarm_id
          if (had !== want) {
            s.member_ids = want ? [...s.member_ids, id] : s.member_ids.filter((m) => m !== id)
            this.emit({ type: 'swarm.updated', at: this.now(), swarm: clone(s) })
          }
        }
      }
      if (body.idle_sleep_minutes !== undefined && (!Number.isFinite(body.idle_sleep_minutes) || body.idle_sleep_minutes < 0))
        throw new ApiError(400, 'invalid', 'idle_sleep_minutes must be 0 or more')
      Object.assign(a, body)
      this.pushLog(a, 'INFO', `config: updated ${Object.keys(body).join(', ')}`)
      this.emit({ type: 'agent.updated', at: this.now(), agent: clone(a) })
      return clone(a)
    })
  }
  deleteAgent(id: string) {
    return this.delay(() => {
      this.mustAgent(id)
      this.agents.delete(id)
      for (const s of this.swarms.values()) {
        if (s.member_ids.includes(id)) {
          s.member_ids = s.member_ids.filter((m) => m !== id)
          this.emit({ type: 'swarm.updated', at: this.now(), swarm: clone(s) })
        }
      }
      this.emit({ type: 'agent.deleted', at: this.now(), agent_id: id })
      return { ok: true as const }
    })
  }
  agentAction(id: string, action: AgentAction) {
    return this.delay(() => {
      const a = this.mustAgent(id)
      switch (action) {
        case 'start':
        case 'wake':
          {
            const refusal = this.spendRefusal(a)
            if (action === 'wake' && refusal) throw new ApiError(402, refusal.code, refusal.message)
          }
          if (a.status === 'awake') break
          this.pushLog(a, 'INFO', `supervisor: ${action}`)
          this.setStatus(a, 'starting')
          this.later(this.r(900, 1600), () => {
            if (a.status === 'starting') {
              this.pushLog(a, 'INFO', 'hub: connected')
              this.setStatus(a, 'awake')
            }
          }, true)
          break
        case 'sleep':
          this.pushLog(a, 'INFO', 'supervisor: sleep')
          this.think(a, 'idle')
          this.setStatus(a, 'asleep')
          break
        case 'stop':
          this.pushLog(a, 'INFO', 'supervisor: stop')
          this.think(a, 'idle')
          this.setStatus(a, 'stopped')
          break
      }
      return clone(a)
    })
  }
  listMessages(id: string, opts: { conversation_id?: string; limit?: number } = {}) {
    return this.delay(() => {
      this.mustAgent(id)
      let list = this.messages.get(id) ?? []
      if (opts.conversation_id) list = list.filter((m) => m.conversation_id === opts.conversation_id)
      if (opts.limit) list = list.slice(-opts.limit)
      return clone(list)
    })
  }
  sendMessage(id: string, body: { text: string; conversation_id?: string }) {
    return this.delay(() => {
      const a = this.mustAgent(id)
      if (!body.text.trim()) throw new ApiError(400, 'invalid', 'Empty message')
      const m = this.say(a, body.text, body.conversation_id ?? 'c_main', 'in', 'user:operator')
      this.respond(a, m)
      return clone(m)
    })
  }
  getLogs(id: string, tail = 200) {
    return this.delay(() => {
      this.mustAgent(id)
      return { lines: (this.logs.get(id) ?? []).slice(-tail) }
    })
  }
  listUsage(opts: { agent_id?: string; since?: string } = {}) {
    return this.delay(() =>
      this.usage.filter(
        (u) => (!opts.agent_id || u.agent_id === opts.agent_id) && (!opts.since || u.created_at >= opts.since),
      ),
    )
  }

  // ---- Phase 2 REST

  listPolicy() {
    return this.delay(() => clone(this.policy))
  }
  createPolicy(body: CreatePolicyBody) {
    return this.delay(() => {
      if (!body.skill?.trim()) throw new ApiError(400, 'invalid', 'Skill glob is required')
      if (!['allow', 'ask', 'deny'].includes(body.mode)) throw new ApiError(400, 'invalid', 'Mode must be allow, ask or deny')
      if (body.scope !== 'hive') {
        const i = body.scope.indexOf(':')
        const kind = body.scope.slice(0, i)
        const id = body.scope.slice(i + 1)
        if (kind === 'swarm') this.mustSwarm(id)
        else if (kind === 'agent') this.mustAgent(id)
        else throw new ApiError(400, 'invalid', 'Scope must be hive, swarm:<id> or agent:<id>')
      }
      const rule: PolicyRule = { id: this.id('r_'), scope: body.scope, skill: body.skill.trim(), mode: body.mode, note: body.note?.trim() ?? '', created_at: this.now() }
      this.policy.push(rule)
      this.emit({ type: 'policy.updated', at: this.now(), rules: clone(this.policy) })
      return clone(rule)
    })
  }
  deletePolicy(id: string) {
    return this.delay(() => {
      const i = this.policy.findIndex((r) => r.id === id)
      if (i < 0) throw new ApiError(404, 'not_found', 'No such rule')
      this.policy.splice(i, 1)
      this.emit({ type: 'policy.updated', at: this.now(), rules: clone(this.policy) })
      return { ok: true as const }
    })
  }
  listApprovals(status?: ApprovalStatus) {
    return this.delay(() =>
      clone([...this.approvals.values()].filter((a) => !status || a.status === status).sort((x, y) => y.created_at.localeCompare(x.created_at))),
    )
  }
  private decideApproval(id: string, status: 'approved' | 'denied') {
    const ap = this.approvals.get(id)
    if (!ap) throw new ApiError(404, 'not_found', 'No such approval')
    if (ap.status !== 'pending') throw new ApiError(409, 'conflict', `Already ${ap.status}`)
    ap.status = status
    ap.decided_by = 'user:operator'
    ap.decided_at = this.now()
    this.emit({ type: 'approval.updated', at: ap.decided_at, approval: clone(ap) })
    return ap
  }
  approve(id: string, remember = false) {
    return this.delay(() => {
      const ap = this.decideApproval(id, 'approved')
      const a = this.agents.get(ap.agent_id)
      if (remember && a) {
        this.policy.push({ id: this.id('r_'), scope: `agent:${a.id}`, skill: ap.skill, mode: 'allow', note: `Always allowed (from ${ap.id})`, created_at: this.now() })
        this.emit({ type: 'policy.updated', at: this.now(), rules: clone(this.policy) })
      }
      if (a) this.pushLog(a, 'INFO', `authorize: ${ap.id} approved by operator${remember ? ' (always allow)' : ''}`)
      this.later(this.r(1400, 2600), () => this.useApproval(ap), true)
      return clone(ap)
    })
  }
  deny(id: string) {
    return this.delay(() => {
      const ap = this.decideApproval(id, 'denied')
      const a = this.agents.get(ap.agent_id)
      if (a) this.pushLog(a, 'WARN', `authorize: ${ap.id} denied by operator`)
      return clone(ap)
    })
  }
  listGoals(swarmId: string) {
    return this.delay(() => {
      this.mustSwarm(swarmId)
      return clone([...this.goals.values()].filter((g) => g.swarm_id === swarmId))
    })
  }
  createGoal(swarmId: string, body: CreateGoalBody) {
    return this.delay(() => this.makeGoal(swarmId, body, 'user:operator'))
  }
  private makeGoal(swarmId: string, body: CreateGoalBody, createdBy: string): Goal {
    this.mustSwarm(swarmId)
    if (!body.title?.trim()) throw new ApiError(400, 'invalid', 'Title is required')
    if (body.parent_id) {
      const p = this.goals.get(body.parent_id)
      if (!p || p.swarm_id !== swarmId) throw new ApiError(400, 'invalid', 'Parent goal is not in this swarm')
    }
    const g: Goal = {
      id: this.id('g_'),
      swarm_id: swarmId,
      parent_id: body.parent_id ?? null,
      title: body.title.trim(),
      detail: body.detail ?? '',
      priority: clamp01(body.priority ?? 0.5),
      status: 'open',
      created_by: createdBy,
      claimed_by: null,
      result: null,
      created_at: this.now(),
      updated_at: this.now(),
      lease_until: null,
      attempts: 0,
    }
    this.goals.set(g.id, g)
    this.emit({ type: 'goal.updated', at: g.created_at, goal: clone(g) })
    // the swarm hears about it (hub envelope event: "goal") and an awake member picks it up
    this.later(this.r(2500, 5000), () => {
      const parent = g.parent_id ? this.goals.get(g.parent_id) : null
      if (parent && parent.status !== 'claimed') return
      const awake = (this.swarms.get(swarmId)?.member_ids ?? []).map((m) => this.agents.get(m)).filter((a): a is Agent => !!a && a.status === 'awake')
      if (awake.length) this.claimGoal(g, this.pick(awake))
    }, true)
    return clone(g)
  }
  patchGoal(id: string, body: PatchGoalBody) {
    return this.delay(() => {
      const g = this.goals.get(id)
      if (!g) throw new ApiError(404, 'not_found', 'No such goal')
      if (body.title !== undefined && !body.title.trim()) throw new ApiError(400, 'invalid', 'Title is required')
      if (body.title !== undefined) g.title = body.title.trim()
      if (body.detail !== undefined) g.detail = body.detail
      if (body.priority !== undefined) g.priority = clamp01(body.priority)
      if (body.status !== undefined) {
        if (body.status === 'done' && !g.result) g.result = 'Marked done by the operator.'
        if (body.status === 'open' && g.status === 'stalled') g.attempts = 0
        g.status = body.status
        if (body.status === 'open') {
          g.claimed_by = null
          g.result = null
          g.lease_until = null
        } else if (body.status !== 'claimed') g.lease_until = null
      }
      this.emitGoal(g)
      return clone(g)
    })
  }
  listTraces(agentId: string, limit = 50) {
    return this.delay(() => {
      this.mustAgent(agentId)
      return clone((this.traces.get(agentId) ?? []).slice(-limit).reverse())
    })
  }
  listWakeups(agentId: string) {
    return this.delay(() => {
      this.mustAgent(agentId)
      return clone([...this.wakeups.values()].filter((w) => w.agent_id === agentId))
    })
  }
  private validateWakeup(w: Pick<Wakeup, 'cron' | 'at' | 'tz' | 'text'>) {
    if (!w.text?.trim()) throw new ApiError(400, 'invalid', 'Tell the dot what to do when it wakes')
    if (!!w.cron === !!w.at) throw new ApiError(400, 'invalid', 'Give exactly one of cron or at')
    if (w.cron) {
      const err = cronError(w.cron)
      if (err) throw new ApiError(400, 'invalid', err)
    }
    if (w.at && Number.isNaN(Date.parse(w.at))) throw new ApiError(400, 'invalid', 'at must be an ISO time')
    if (!isValidTz(w.tz)) throw new ApiError(400, 'invalid', `Unknown time zone ${w.tz}`)
  }
  createWakeup(agentId: string, body: CreateWakeupBody) {
    return this.delay(() => {
      this.mustAgent(agentId)
      const w: Wakeup = {
        id: this.id('w_'),
        agent_id: agentId,
        cron: body.cron?.trim() || null,
        at: body.at || null,
        tz: body.tz || 'UTC',
        text: body.text?.trim() ?? '',
        enabled: true,
        next_run_at: null,
        last_run_at: null,
      }
      this.validateWakeup(w)
      if (w.at && Date.parse(w.at) <= Date.now()) throw new ApiError(400, 'invalid', 'That time has already passed')
      w.next_run_at = this.computeNext(w)
      this.wakeups.set(w.id, w)
      this.emit({ type: 'wakeup.updated', at: this.now(), wakeup: clone(w) })
      return clone(w)
    })
  }
  patchWakeup(id: string, body: PatchWakeupBody) {
    return this.delay(() => {
      const w = this.wakeups.get(id)
      if (!w) throw new ApiError(404, 'not_found', 'No such wakeup')
      const next = { ...w, ...body }
      if (body.cron) next.at = null
      if (body.at) next.cron = null
      this.validateWakeup(next)
      Object.assign(w, next)
      w.next_run_at = this.computeNext(w)
      this.emit({ type: 'wakeup.updated', at: this.now(), wakeup: clone(w) })
      return clone(w)
    })
  }
  deleteWakeup(id: string) {
    return this.delay(() => {
      if (!this.wakeups.delete(id)) throw new ApiError(404, 'not_found', 'No such wakeup')
      return { ok: true as const }
    })
  }
  listMemory(agentId: string) {
    return this.delay((): MemorySpace[] =>
      [...this.memoryOf(agentId).entries()].map(([name, atoms]) => ({
        name,
        atoms: atoms.length,
        bytes: atoms.reduce((n, t) => n + new TextEncoder().encode(t).length + 1, 0),
      })),
    )
  }
  listAtoms(agentId: string, space: string, opts: { q?: string; limit?: number } = {}) {
    return this.delay((): MemoryAtom[] => {
      const atoms = this.memoryOf(agentId).get(space)
      if (!atoms) throw new ApiError(404, 'not_found', `No space ${space}`)
      const q = opts.q?.trim().toLowerCase()
      return atoms
        .map((text, index) => ({ index, text }))
        .filter((x) => !q || x.text.toLowerCase().includes(q))
        .slice(0, opts.limit ?? 200)
    })
  }
  retireAtom(agentId: string, space: string, atom: string) {
    return this.delay(() => {
      const a = this.mustAgent(agentId)
      const atoms = this.memoryOf(agentId).get(space)
      if (!atoms) throw new ApiError(404, 'not_found', `No space ${space}`)
      if (!atoms.includes(atom)) throw new ApiError(404, 'not_found', 'No such atom')
      // the agent drains GET /api/agent/control on its next loop
      this.later(this.r(4000, 7000), () => {
        const i = atoms.indexOf(atom)
        if (i >= 0) atoms.splice(i, 1)
        this.pushLog(a, 'INFO', `memory: retired 1 atom from ${space}`)
      }, true)
      return { queued: true as const }
    })
  }
  resetMemory(agentId: string) {
    return this.delay(() => {
      const a = this.mustAgent(agentId)
      const mem = this.memoryOf(agentId)
      this.later(this.r(3000, 5000), () => {
        for (const atoms of mem.values()) atoms.length = 0
        this.pushLog(a, 'WARN', 'memory: reset; all private spaces cleared')
      }, true)
      return { queued: true as const }
    })
  }
  stopAll() {
    return this.delay(() => {
      const list = [...this.agents.values()].filter((a) => a.status !== 'stopped')
      // the hive stops everything at once; the events ripple out so the scene shows a wave
      list.forEach((a, i) => {
        a.status = 'stopped'
        a.connected = false
        a.last_active_at = this.now()
        this.later(40 + i * 70, () => {
          this.think(a, 'idle')
          this.pushLog(a, 'WARN', 'supervisor: stop-all (kill switch)')
          this.emit({ type: 'agent.updated', at: this.now(), agent: clone(a) })
        }, true)
      })
      return { stopped: list.length }
    })
  }

  // ------------------------------------------------------------------ Dot programs

  programs() {
    return this.delay(() => this.programsHost.list())
  }
  program(id: string) {
    return this.delay(() => this.programsHost.detail(id))
  }
  programView(id: string, body: ProgramViewBody) {
    return this.delay(() => this.programsHost.view(id, body.swarm_id, body.focus, body.stage))
  }
  programAct(id: string, body: ProgramActBody) {
    return this.delay(() => this.programsHost.act(id, body.swarm_id, body.action, body.items, body.params ?? {}, body.base_revision)).then((p) => p)
  }
  programEnable(id: string) {
    return this.delay(() => this.programsHost.setEnabled(id, true))
  }
  programDisable(id: string) {
    return this.delay(() => this.programsHost.setEnabled(id, false))
  }
  programsReload() {
    return this.delay(() => this.programsHost.reload())
  }

  // ------------------------------------------------------------------ Lab (recorded results)

  listLabSuites() {
    return this.lab.suites()
  }
  listLabRuns(opts?: { suite?: string; limit?: number }) {
    return this.lab.listRuns(opts)
  }
  startLabRun(suite: string) {
    return this.lab.start(suite)
  }
  getLabRun(id: string) {
    return this.lab.get(id)
  }
  cancelLabRun(id: string) {
    return this.lab.cancel(id)
  }
  getLabHistory(suite: string, limit?: number) {
    return this.lab.history(suite, limit)
  }
  getLabScorecard() {
    return this.lab.scorecard()
  }

  connect() {
    if (this.state === 'open') return
    this.setState('connecting')
    this.later(250, () => {
      this.setState('open')
      this.emit({ type: 'hello', at: this.now(), hive: this.hiveInfo() })
      if (this.opts.autoStart && !this.running) {
        this.running = true
        this.loop()
      }
    }, true)
  }
  disconnect() {
    this.running = false
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
    this.lab.stop()
    this.setState('idle')
  }
  subscribe(fn: (e: HiveEvent) => void) {
    return this.events.on(fn)
  }
  onConnection(fn: (s: ConnectionState) => void) {
    fn(this.state)
    return this.conn.on(fn)
  }
  private setState(s: ConnectionState) {
    this.state = s
    this.conn.emit(s)
  }
}

function round6(n: number) {
  return Math.round(n * 1e6) / 1e6
}

export function stripDetail(d: BeliefDetail): Belief {
  return {
    swarm_id: d.swarm_id,
    statement: d.statement,
    tv: { ...d.tv },
    stamp: [...d.stamp],
    sources: [...d.sources],
    updated_at: d.updated_at,
  }
}
