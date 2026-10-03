import { ApiError, Emitter, type ConnectionState, type HiveClient } from '../client'
import type {
  Agent,
  AgentAction,
  Assertion,
  AssertionOutcome,
  Belief,
  BeliefDetail,
  CreateAgentBody,
  CreatedAgent,
  CreateSwarmBody,
  HiveEvent,
  HiveInfo,
  Message,
  PatchAgentBody,
  Swarm,
  ThinkingPhase,
  TruthValue,
  Usage,
} from '../types'
import { LOG_TEMPLATES, NAME_IDEAS, SEED_AGENTS, SEED_SWARMS, SIM_MODELS, SKILLS, type SeedAgent } from './data'
import { overlaps, revise, round3, unionCapped } from './nal'
import { generateReply, PEER_LINES, PEER_REPLIES } from './replies'

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
const ID_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789'

/**
 * An in-browser hive. Holds the full server state in memory, answers the REST surface
 * with plausible latency and emits a believable stream of live events.
 */
export class SimClient implements HiveClient {
  readonly mode = 'sim' as const
  readonly rng: () => number
  private opts: Required<SimOptions>

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

  private events = new Emitter<HiveEvent>()
  private conn = new Emitter<ConnectionState>()
  private state: ConnectionState = 'idle'

  constructor(options: SimOptions = {}) {
    this.opts = { seed: 7, autoStart: true, speed: 1, latency: true, historyDays: 30, extraDots: 0, ...options }
    this.rng = mulberry32(this.opts.seed)
    this.seed()
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
        budget_usd: 0,
        spent_usd: 0,
        connected: true,
        last_active_at: null,
        created_at: iso(origin + this.r(10, 40) * day),
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
    a.status = status
    a.connected = status === 'awake' || status === 'asleep' || status === 'starting'
    a.last_active_at = this.now()
    this.emit({ type: 'agent.updated', at: this.now(), agent: clone(a) })
  }

  private think(a: Agent, phase: ThinkingPhase) {
    this.emit({ type: 'agent.thinking', at: this.now(), agent_id: a.id, phase })
  }

  private bill(a: Agent, scale = 1) {
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
      this.pushLog(a, 'ERROR', 'llm: 402 budget exhausted; going to sleep')
      this.setStatus(a, 'asleep')
    }
  }

  private canSpend(a: Agent) {
    return !(a.budget_usd > 0 && a.spent_usd >= a.budget_usd)
  }

  /** A full think cycle: llm → (skills) → idle, with usage and an optional callback. */
  private cycle(a: Agent, done?: () => void, scale = 1) {
    if (this.busy.has(a.id)) return
    this.busy.add(a.id)
    this.think(a, 'llm')
    const t1 = this.r(900, 2600)
    const useSkills = this.rng() < 0.4
    this.later(t1, () => {
      if (useSkills) {
        this.think(a, 'skills')
        this.pushLog(a, 'INFO', `skills: invoked ${this.pick(SKILLS)} in ${Math.round(this.r(40, 900))}ms`)
      }
      this.later(useSkills ? this.r(600, 1600) : 10, () => {
        this.bill(a, scale)
        this.think(a, 'idle')
        this.busy.delete(a.id)
        done?.()
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
      }, 1.4)
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
    const roll = this.rng() * 15
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
          this.pushLog(a, 'INFO', 'scheduler: idle, going to sleep')
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
          if (to.status === 'awake') this.cycle(to, () => this.say(to, this.pick(PEER_REPLIES), conv, 'out', `agent:${to.id}`), 0.5)
        })
      }
    } else if (roll < 14.4) {
      // unsolicited musing to the operator
      if (!awake.length) return
      const a = this.pick(awake)
      const ctx = this.replyContext(a)
      this.cycle(a, () => this.say(a, this.pick(ctx.musings), 'c_main', 'out', `agent:${a.id}`), 0.8)
    } else if (roll < 14.6) {
      // a glitch: error, then recovery
      if (!awake.length) return
      const a = this.pick(awake)
      this.pushLog(a, 'ERROR', `llm: upstream 529 overloaded (${a.model})`)
      this.setStatus(a, 'error')
      this.later(this.r(6000, 12000), () => {
        if (a.status !== 'error') return
        this.pushLog(a, 'INFO', 'supervisor: restarting after error')
        this.setStatus(a, 'starting')
        this.later(1200, () => this.setStatus(a, 'awake'))
      })
    }
  }

  private loop = () => {
    if (!this.running) return
    this.later(this.r(350, 1300), () => {
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
          if (action === 'wake' && !this.canSpend(a))
            throw new ApiError(402, 'budget_exhausted', `${a.name} has spent its budget`)
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
