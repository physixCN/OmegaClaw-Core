import type { Agent, AgentStatus, AssertionOutcome, Belief, HiveEvent, Swarm, ThinkingPhase } from '../api/types'
import { freqRgb } from '../lib/color'
import { glowSprite, nebulaSprite, starTile, type SpriteCanvas } from './sprites'

/**
 * HiveEngine: an imperative 2.5D canvas renderer for the living hive.
 *
 * World space is a flat plane; every dot orbits its swarm core on a tilted ellipse whose
 * third axis (z) drives depth: scale, brightness, fog and draw order. Everything luminous is a
 * cached glow sprite composited additively, which reads as bloom without a GPU post-pass.
 */

export type HitTarget = { kind: 'dot'; id: string } | { kind: 'core'; id: string }

export interface EngineCallbacks {
  onHover(target: HitTarget | null): void
  onTap(target: HitTarget | null, pointerType: string): void
  /** Called when the user drags or zooms the camera themselves. */
  onUserCamera?(): void
}

export interface SceneData {
  agents: Agent[]
  swarms: Swarm[]
  thinking: Record<string, ThinkingPhase>
  beliefs: Record<string, Record<string, Belief>>
}

export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

type V2 = { x: number; y: number }

interface Dot {
  id: string
  name: string
  hue: number
  swarmId: string | null
  status: AgentStatus
  thinking: ThinkingPhase | null
  // orbit
  orbitR: number
  tilt: number
  node: number
  angle: number
  speed: number
  wobble: number
  // dynamics
  glow: number
  size: number
  ring: number
  errorMix: number
  hover: number
  birth: number
  dying: number
  glitchUntil: number
  glitchX: number
  phase: number
  // derived per frame
  x: number
  y: number
  z: number
  sx: number
  sy: number
  sr: number
  ox: number
  oy: number
}

interface Mote {
  r: number
  a: number
  w: number
  incl: number
  f: number
  c: number
  statement: string
  born: number
}

interface Core {
  id: string
  name: string
  hue: number
  x: number
  y: number
  tx: number
  ty: number
  motes: Mote[]
  flash: number
  spin: number
  spinBoost: number
  members: number
  sx: number
  sy: number
  hover: number
}

type ParticleKind = 'belief' | 'msg' | 'peer'
interface Particle {
  kind: ParticleKind
  from: () => V2 | null
  to: () => V2 | null
  t: number
  dur: number
  hue: number
  bend: number
  trail: V2[]
  outcome?: AssertionOutcome
  swarmId?: string
  f?: number
  key?: string
  done?: boolean
}

type EffectKind = 'ripple' | 'choice' | 'adopt' | 'quarantine' | 'duplicate' | 'birth' | 'spark'
interface Effect {
  kind: EffectKind
  at: () => V2 | null
  t: number
  dur: number
  hue: number
  seed: number
  jag?: number[]
  sparks?: { a: number; v: number; s: number }[]
  rejected?: boolean
}

interface Dust {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  a: number
}

const TAU = Math.PI * 2
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const damp = (a: number, b: number, k: number, dt: number) => lerp(a, b, 1 - Math.exp(-k * dt))
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const easeOut = (t: number) => 1 - (1 - t) ** 3
const easeOutBack = (t: number) => {
  const c1 = 1.5
  const c3 = c1 + 1
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
}

function hash(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

const STATUS_GLOW: Record<AgentStatus, number> = {
  awake: 1,
  starting: 0.75,
  created: 0.55,
  asleep: 0.32,
  stopped: 0.14,
  error: 0.95,
}
const STATUS_SIZE: Record<AgentStatus, number> = {
  awake: 1,
  starting: 0.9,
  created: 0.8,
  asleep: 0.72,
  stopped: 0.62,
  error: 1,
}
const STATUS_SPEED: Record<AgentStatus, number> = {
  awake: 1,
  starting: 1.6,
  created: 0.6,
  asleep: 0.22,
  stopped: 0.05,
  error: 0.4,
}

export class HiveEngine {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private cb: EngineCallbacks
  private dots = new Map<string, Dot>()
  private cores = new Map<string, Core>()
  private wanderCore: Core
  private particles: Particle[] = []
  private effects: Effect[] = []
  private dust: Dust[] = []
  private inFlight = new Map<string, number>()
  private convPeer = new Map<string, string>()

  private w = 0
  private h = 0
  private dpr = 1
  private maxDpr = 2
  private raf = 0
  private running = false
  private last = 0
  private time = 0
  private frameAcc = 0
  private fpsCap = 0
  private perf: number[] = []
  private synced = false
  private reduced = false
  private dimmed = false

  // camera
  private cam = { x: 0, y: 0, z: 0.8 }
  private camT = { x: 0, y: 0, z: 0.8 }
  private camK = 3.2
  private follow: string | null = null
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 }
  private center = { x: 0, y: 0 }
  private centerT = { x: 0, y: 0 }
  private anchor: V2 | null = null

  // input
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number; t: number; type: string }>()
  private dragging = false
  private pinch: { d: number; z: number; mx: number; my: number } | null = null
  private vel = { x: 0, y: 0 }
  private hoverTarget: HitTarget | null = null
  private selected: string | null = null
  private tracked = new Map<HTMLElement, string>()

  private stars: { far: SpriteCanvas; near: SpriteCanvas; farPat: CanvasPattern | null; nearPat: CanvasPattern | null }
  private twinkles: { x: number; y: number; p: number; s: number }[] = []

  constructor(canvas: HTMLCanvasElement, cb: EngineCallbacks, opts: { reducedMotion?: boolean } = {}) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('Canvas 2D unavailable')
    this.ctx = ctx
    this.cb = cb
    this.reduced = !!opts.reducedMotion
    this.wanderCore = this.makeCore('__wander', 'Wanderers', 210)
    const far = starTile(11, 512, 260, 0.9)
    const near = starTile(29, 640, 70, 1.6)
    this.stars = { far, near, farPat: ctx.createPattern(far, 'repeat'), nearPat: ctx.createPattern(near, 'repeat') }
    for (let i = 0; i < 46; i++) this.twinkles.push({ x: Math.random(), y: Math.random(), p: Math.random() * TAU, s: 0.5 + Math.random() * 1.5 })
    this.maxDpr = Math.min(2, window.devicePixelRatio || 1)
    this.resize()
    this.seedDust()
    this.bindInput()
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  // ================================================================== lifecycle

  start(): void {
    if (this.running) return
    this.running = true
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.frame)
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
  }

  destroy(): void {
    this.stop()
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.unbindInput()
  }

  private onVisibility = () => {
    if (document.hidden) this.stop()
    else this.start()
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect()
    this.w = Math.max(1, r.width)
    this.h = Math.max(1, r.height)
    this.dpr = Math.min(this.maxDpr, window.devicePixelRatio || 1)
    this.canvas.width = Math.round(this.w * this.dpr)
    this.canvas.height = Math.round(this.h * this.dpr)
    this.layout()
    this.updateCenter(true)
  }

  setReducedMotion(v: boolean): void {
    this.reduced = v
    this.seedDust()
  }

  /** Dim + throttle the scene while a full-screen view covers it. */
  setDimmed(v: boolean): void {
    this.dimmed = v
    this.fpsCap = v ? 24 : 0
  }

  setInsets(i: Insets): void {
    this.insets = i
    this.updateCenter(false)
  }

  setChatAnchor(p: V2 | null): void {
    this.anchor = p
  }

  // ================================================================== data sync

  private makeCore(id: string, name: string, hue: number): Core {
    return { id, name, hue, x: 0, y: 0, tx: 0, ty: 0, motes: [], flash: 0, spin: Math.random() * TAU, spinBoost: 0, members: 0, sx: 0, sy: 0, hover: 0 }
  }

  setData(d: SceneData): void {
    // swarms → cores
    const seenCores = new Set<string>()
    for (const s of d.swarms) {
      seenCores.add(s.id)
      let c = this.cores.get(s.id)
      if (!c) {
        c = this.makeCore(s.id, s.name, s.hue)
        this.cores.set(s.id, c)
      }
      c.name = s.name
      c.hue = s.hue
      c.members = s.member_ids.length
      this.syncMotes(c, d.beliefs[s.id])
    }
    for (const id of [...this.cores.keys()]) if (!seenCores.has(id)) this.cores.delete(id)
    this.layout()

    // agents → dots
    const seen = new Set<string>()
    const bySwarm = new Map<string, Agent[]>()
    for (const a of d.agents) {
      const k = a.swarm_id && this.cores.has(a.swarm_id) ? a.swarm_id : '__wander'
      if (!bySwarm.has(k)) bySwarm.set(k, [])
      bySwarm.get(k)!.push(a)
    }
    for (const [k, list] of bySwarm) {
      list.sort((a, b) => a.created_at.localeCompare(b.created_at))
      list.forEach((a, i) => {
        seen.add(a.id)
        let dot = this.dots.get(a.id)
        const h = hash(a.id)
        const orbitR = (k === '__wander' ? 46 : 56) + i * 13 + h * 14
        if (!dot) {
          dot = {
            id: a.id,
            name: a.name,
            hue: a.hue,
            swarmId: k === '__wander' ? null : k,
            status: a.status,
            thinking: null,
            orbitR,
            tilt: 0.95 + h * 0.5,
            node: hash(a.id + 'n') * TAU,
            angle: hash(a.id + 'a') * TAU,
            speed: STATUS_SPEED[a.status],
            wobble: hash(a.id + 'w') * TAU,
            glow: this.synced ? 0 : STATUS_GLOW[a.status],
            size: STATUS_SIZE[a.status],
            ring: 0,
            errorMix: a.status === 'error' ? 1 : 0,
            hover: 0,
            birth: this.synced ? 0 : 1,
            dying: 0,
            glitchUntil: 0,
            glitchX: 0,
            phase: h * TAU,
            x: 0, y: 0, z: 0, sx: 0, sy: 0, sr: 0, ox: 0, oy: 0,
          }
          this.dots.set(a.id, dot)
          if (this.synced) this.spawnBirth(dot)
        }
        dot.name = a.name
        dot.hue = a.hue
        dot.status = a.status
        dot.orbitR = orbitR
        const newSwarm = k === '__wander' ? null : k
        if (dot.swarmId !== newSwarm) dot.swarmId = newSwarm
        dot.thinking = d.thinking[a.id] ?? null
      })
    }
    for (const [id, dot] of this.dots) if (!seen.has(id) && dot.dying === 0) dot.dying = 0.0001
    this.wanderCore.members = bySwarm.get('__wander')?.length ?? 0
    this.synced = d.agents.length > 0 || this.synced
  }

  private syncMotes(c: Core, beliefs: Record<string, Belief> | undefined) {
    if (!beliefs) return
    const list = Object.values(beliefs)
    const byStmt = new Map(c.motes.map((m) => [m.statement, m]))
    const next: Mote[] = []
    for (const b of list.slice(0, 64)) {
      const m = byStmt.get(b.statement)
      if (m) {
        m.f = b.tv.f
        m.c = b.tv.c
        next.push(m)
      } else {
        const h = hash(b.statement)
        next.push({
          statement: b.statement,
          r: 9 + h * 22,
          a: hash(b.statement + 'a') * TAU,
          w: (0.25 + hash(b.statement + 'w') * 0.6) * (h > 0.5 ? 1 : -1),
          incl: hash(b.statement + 'i') * Math.PI,
          f: b.tv.f,
          c: b.tv.c,
          born: c.motes.length ? this.time : -10,
        })
      }
    }
    c.motes = next
  }

  /** Place swarm cores; the layout adapts to portrait vs landscape viewports. */
  private layout() {
    const cores = [...this.cores.values()]
    const n = cores.length
    const portrait = this.h > this.w * 1.15
    if (portrait) {
      // phones: a gentle zig-zag column, so clusters stay large on a narrow screen
      const gap = 290
      cores.forEach((c, i) => {
        c.tx = n === 1 ? 0 : (i % 2 ? 1 : -1) * 64
        c.ty = (i - (n - 1) / 2) * gap
      })
      this.wanderCore.tx = n > 1 ? 120 : 0
      this.wanderCore.ty = n > 1 ? -gap / 2 : n === 1 ? -260 : 0
    } else {
      const R = 330
      cores.forEach((c, i) => {
        const a = n === 1 ? 0 : -Math.PI / 2 + (i * TAU) / n + Math.PI / n
        const r = n === 1 ? 0 : n === 2 ? R * 0.8 : R
        c.tx = Math.cos(a) * r * 1.2
        c.ty = Math.sin(a) * r * 0.86
      })
      this.wanderCore.tx = n === 1 ? 300 : 0
      this.wanderCore.ty = 0
    }
    for (const c of cores) {
      if (c.x === 0 && c.y === 0) {
        c.x = c.tx
        c.y = c.ty
      }
    }
    if (this.wanderCore.x === 0 && this.wanderCore.y === 0) {
      this.wanderCore.x = this.wanderCore.tx
      this.wanderCore.y = this.wanderCore.ty
    }
  }

  private bounds() {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    const add = (x: number, y: number, r: number) => {
      minX = Math.min(minX, x - r)
      minY = Math.min(minY, y - r)
      maxX = Math.max(maxX, x + r)
      maxY = Math.max(maxY, y + r)
    }
    for (const c of this.cores.values()) {
      let r = 80
      for (const d of this.dots.values()) if (d.swarmId === c.id) r = Math.max(r, d.orbitR + 18)
      add(c.tx, c.ty, r)
    }
    for (const d of this.dots.values()) if (!d.swarmId) add(this.wanderCore.tx, this.wanderCore.ty, d.orbitR + 18)
    if (minX === Infinity) add(0, 0, 200)
    return { minX, minY, maxX, maxY }
  }

  // ================================================================== camera

  private updateCenter(snap: boolean) {
    const i = this.insets
    this.centerT = { x: i.left + (this.w - i.left - i.right) / 2, y: i.top + (this.h - i.top - i.bottom) / 2 }
    if (snap) this.center = { ...this.centerT }
  }

  private fitZoom() {
    const b = this.bounds()
    const i = this.insets
    const vw = Math.max(120, this.w - i.left - i.right - 24)
    const vh = Math.max(120, this.h - i.top - i.bottom - 24)
    return {
      z: clamp(Math.min(vw / (b.maxX - b.minX), vh / (b.maxY - b.minY)), 0.25, 1.6),
      x: (b.minX + b.maxX) / 2,
      y: (b.minY + b.maxY) / 2,
    }
  }

  overview(instant = false): void {
    this.follow = null
    const f = this.fitZoom()
    this.camT = { x: f.x, y: f.y, z: f.z }
    this.camK = 2.6
    if (instant) this.cam = { ...this.camT }
  }

  flyToDot(id: string): void {
    const d = this.dots.get(id)
    if (!d) return
    this.follow = id
    this.camT.z = clamp(Math.max(this.camT.z, Math.min(2.1, this.w / 300)), 0.6, 2.4)
    this.camK = 2.8
  }

  flyToSwarm(id: string): void {
    const c = this.cores.get(id)
    if (!c) return
    this.follow = null
    let r = 100
    for (const d of this.dots.values()) if (d.swarmId === id) r = Math.max(r, d.orbitR + 30)
    const i = this.insets
    const vw = this.w - i.left - i.right
    const vh = this.h - i.top - i.bottom
    this.camT = { x: c.tx, y: c.ty, z: clamp(Math.min(vw, vh) / (r * 2.3), 0.5, 2.2) }
    this.camK = 2.6
  }

  setSelected(id: string | null, fly = true): void {
    this.selected = id
    if (id && fly) this.flyToDot(id)
    if (!id) this.follow = null
  }

  zoomBy(f: number): void {
    this.camT.z = clamp(this.camT.z * f, 0.22, 4)
    this.cb.onUserCamera?.()
  }

  panBy(dx: number, dy: number): void {
    this.follow = null
    this.camT.x += dx / this.camT.z
    this.camT.y += dy / this.camT.z
    this.cb.onUserCamera?.()
  }

  private toScreen(x: number, y: number): V2 {
    return { x: (x - this.cam.x) * this.cam.z + this.center.x, y: (y - this.cam.y) * this.cam.z + this.center.y }
  }
  private toWorld(sx: number, sy: number): V2 {
    return { x: (sx - this.center.x) / this.cam.z + this.cam.x, y: (sy - this.center.y) / this.cam.z + this.cam.y }
  }

  /** Screen position of a dot (CSS px), for anchoring DOM overlays. */
  screenPos(id: string): { x: number; y: number; r: number } | null {
    const d = this.dots.get(id)
    if (!d) return null
    return { x: d.sx, y: d.sy, r: d.sr }
  }

  /** Keep a DOM element pinned to a dot; the engine writes its transform every frame. */
  track(el: HTMLElement, id: string | null): void {
    if (id) this.tracked.set(el, id)
    else this.tracked.delete(el)
  }

  // ================================================================== events

  handleEvent(e: HiveEvent): void {
    switch (e.type) {
      case 'belief.published': {
        const a = e.assertion
        const dot = this.dots.get(a.agent_id)
        const core = this.cores.get(e.swarm_id)
        if (!core) return
        const key = `${e.swarm_id}\u0000${a.statement}`
        this.inFlight.set(key, (this.inFlight.get(key) ?? 0) + 1)
        this.addParticle({
          kind: 'belief',
          from: () => (dot && this.dots.has(dot.id) ? { x: dot.x, y: dot.y } : { x: core.x + 140, y: core.y }),
          to: () => ({ x: core.x, y: core.y }),
          t: 0,
          dur: this.reduced ? 1.6 : 1.15 + Math.random() * 0.35,
          hue: dot?.hue ?? core.hue,
          bend: (Math.random() - 0.5) * 0.9,
          trail: [],
          outcome: a.outcome,
          swarmId: e.swarm_id,
          f: a.tv.f,
          key,
        })
        break
      }
      case 'belief.updated': {
        const key = `${e.belief.swarm_id}\u0000${e.belief.statement}`
        if (!this.inFlight.get(key)) this.coreEffect(e.belief.swarm_id, 'revised')
        break
      }
      case 'message': {
        const m = e.message
        const dot = this.dots.get(m.agent_id)
        if (!dot) return
        const peerId = m.sender.startsWith('agent:') ? m.sender.slice(6) : null
        if (m.direction === 'in' && peerId && peerId !== m.agent_id) {
          this.convPeer.set(m.conversation_id, peerId)
          const peer = this.dots.get(peerId)
          if (peer) this.addParticle(this.dotToDot(peer, dot))
        } else if (m.direction === 'out' && this.convPeer.has(m.conversation_id)) {
          const peer = this.dots.get(this.convPeer.get(m.conversation_id)!)
          if (peer) this.addParticle(this.dotToDot(dot, peer))
        } else {
          const edge = () => {
            const p = this.anchor ?? { x: this.w / 2, y: this.h + 30 }
            return this.toWorld(p.x, p.y)
          }
          const at = () => (this.dots.has(dot.id) ? { x: dot.x, y: dot.y } : null)
          this.addParticle({
            kind: 'msg',
            from: m.direction === 'in' ? edge : at,
            to: m.direction === 'in' ? at : edge,
            t: 0,
            dur: 1.25,
            hue: m.direction === 'in' ? 200 : dot.hue,
            bend: (Math.random() - 0.5) * 0.6,
            trail: [],
          })
        }
        break
      }
      case 'agent.updated': {
        const dot = this.dots.get(e.agent.id)
        if (dot && e.agent.status === 'error' && dot.status !== 'error') dot.glitchUntil = this.time + 0.4
        break
      }
      default:
        break
    }
  }

  private dotToDot(a: Dot, b: Dot): Particle {
    return {
      kind: 'peer',
      from: () => (this.dots.has(a.id) ? { x: a.x, y: a.y } : null),
      to: () => (this.dots.has(b.id) ? { x: b.x, y: b.y } : null),
      t: 0,
      dur: 1.1,
      hue: a.hue,
      bend: 0.45 * (Math.random() > 0.5 ? 1 : -1),
      trail: [],
    }
  }

  private addParticle(p: Particle) {
    if (this.particles.length > (this.reduced ? 24 : 70)) {
      const old = this.particles.shift()
      if (old) this.finishParticle(old)
    }
    this.particles.push(p)
  }

  private finishParticle(p: Particle) {
    if (p.done) return
    p.done = true
    if (p.kind === 'belief' && p.swarmId) {
      if (p.key) {
        const n = (this.inFlight.get(p.key) ?? 1) - 1
        if (n <= 0) this.inFlight.delete(p.key)
        else this.inFlight.set(p.key, n)
      }
      this.coreEffect(p.swarmId, p.outcome ?? 'revised', p.hue, p.f)
    }
  }

  private coreEffect(swarmId: string, outcome: AssertionOutcome, hue?: number, f?: number) {
    const c = this.cores.get(swarmId)
    if (!c) return
    const at = () => ({ x: c.x, y: c.y })
    const seed = Math.random()
    switch (outcome) {
      case 'revised':
        c.flash = Math.min(1, c.flash + 0.55)
        this.effects.push({ kind: 'ripple', at, t: 0, dur: this.reduced ? 2.2 : 1.6, hue: c.hue, seed })
        break
      case 'chosen':
      case 'kept': {
        c.flash = 1
        c.spinBoost = this.reduced ? 0.6 : 3
        const jag = Array.from({ length: 14 }, () => 0.72 + Math.random() * 0.5)
        this.effects.push({ kind: 'choice', at, t: 0, dur: 1.3, hue: c.hue, seed, jag, rejected: outcome === 'kept' })
        if (outcome === 'kept' && !this.reduced) {
          this.effects.push({
            kind: 'spark', at, t: 0, dur: 0.9, hue: hue ?? 330, seed,
            sparks: Array.from({ length: 7 }, () => ({ a: Math.random() * TAU, v: 90 + Math.random() * 80, s: 0.6 + Math.random() })),
          })
        }
        break
      }
      case 'adopted':
        c.flash = Math.min(1, c.flash + 0.8)
        this.effects.push({
          kind: 'adopt', at, t: 0, dur: 1.4, hue: f !== undefined ? -1 - f : c.hue, seed,
          sparks: this.reduced ? [] : Array.from({ length: 12 }, () => ({ a: Math.random() * TAU, v: 30 + Math.random() * 60, s: 0.5 + Math.random() })),
        })
        break
      case 'quarantined':
      case 'denied':
        this.effects.push({ kind: 'quarantine', at, t: 0, dur: 1.5, hue: 18, seed })
        break
      case 'duplicate':
        this.effects.push({ kind: 'duplicate', at, t: 0, dur: 0.8, hue: c.hue, seed })
        break
    }
  }

  private spawnBirth(dot: Dot) {
    const core = (dot.swarmId && this.cores.get(dot.swarmId)) || this.wanderCore
    core.flash = 1
    const at = () => ({ x: core.x, y: core.y })
    this.effects.push({
      kind: 'birth', at, t: 0, dur: 2.2, hue: dot.hue, seed: Math.random(),
      sparks: this.reduced ? [] : Array.from({ length: 22 }, () => ({ a: Math.random() * TAU, v: 60 + Math.random() * 140, s: 0.5 + Math.random() * 1.2 })),
    })
  }

  // ================================================================== input

  private bindInput() {
    const c = this.canvas
    c.addEventListener('pointerdown', this.onDown)
    c.addEventListener('pointermove', this.onMove)
    c.addEventListener('pointerup', this.onUp)
    c.addEventListener('pointercancel', this.onCancel)
    c.addEventListener('pointerleave', this.onLeave)
    c.addEventListener('wheel', this.onWheel, { passive: false })
  }
  private unbindInput() {
    const c = this.canvas
    c.removeEventListener('pointerdown', this.onDown)
    c.removeEventListener('pointermove', this.onMove)
    c.removeEventListener('pointerup', this.onUp)
    c.removeEventListener('pointercancel', this.onCancel)
    c.removeEventListener('pointerleave', this.onLeave)
    c.removeEventListener('wheel', this.onWheel)
  }

  private local(e: PointerEvent | WheelEvent): V2 {
    const r = this.canvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  private onDown = (e: PointerEvent) => {
    const p = this.local(e)
    this.canvas.setPointerCapture?.(e.pointerId)
    this.pointers.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y, t: performance.now(), type: e.pointerType })
    this.vel = { x: 0, y: 0 }
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()]
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.camT.z, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
      this.dragging = true
    }
  }

  private onMove = (e: PointerEvent) => {
    const p = this.local(e)
    const ptr = this.pointers.get(e.pointerId)
    if (!ptr) {
      if (e.pointerType === 'mouse') this.updateHover(p.x, p.y)
      return
    }
    const dx = p.x - ptr.x
    const dy = p.y - ptr.y
    ptr.x = p.x
    ptr.y = p.y
    if (this.pointers.size >= 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const before = this.toWorld(mx, my)
      const z = clamp((this.pinch.z * d) / Math.max(1, this.pinch.d), 0.22, 4)
      this.cam.z = this.camT.z = z
      const after = this.toWorld(mx, my)
      this.cam.x = this.camT.x += before.x - after.x
      this.cam.y = this.camT.y += before.y - after.y
      this.cam.x = this.camT.x -= (mx - this.pinch.mx) / z
      this.cam.y = this.camT.y -= (my - this.pinch.my) / z
      this.pinch.mx = mx
      this.pinch.my = my
      this.follow = null
      this.cb.onUserCamera?.()
      return
    }
    if (!this.dragging && Math.hypot(p.x - ptr.sx, p.y - ptr.sy) > 6) {
      this.dragging = true
      this.follow = null
      this.cb.onUserCamera?.()
    }
    if (this.dragging) {
      this.cam.x = this.camT.x -= dx / this.cam.z
      this.cam.y = this.camT.y -= dy / this.cam.z
      this.vel = { x: (dx / this.cam.z) * 60 * 0.5 + this.vel.x * 0.5, y: (dy / this.cam.z) * 60 * 0.5 + this.vel.y * 0.5 }
    }
  }

  private onUp = (e: PointerEvent) => {
    const ptr = this.pointers.get(e.pointerId)
    this.pointers.delete(e.pointerId)
    if (this.pointers.size < 2) this.pinch = null
    if (!ptr) return
    const tap = !this.dragging && performance.now() - ptr.t < 600
    if (this.pointers.size === 0) {
      if (tap) {
        const hit = this.hitTest(ptr.x, ptr.y, e.pointerType === 'mouse' ? 16 : 26)
        this.cb.onTap(hit, e.pointerType)
      }
      this.dragging = false
    }
  }

  private onCancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId)
    if (this.pointers.size < 2) this.pinch = null
    if (this.pointers.size === 0) this.dragging = false
  }

  private onLeave = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && !this.pointers.size) this.setHover(null)
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const p = this.local(e)
    const before = this.toWorld(p.x, p.y)
    const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))
    const z = clamp(this.cam.z * f, 0.22, 4)
    this.cam.z = this.camT.z = z
    const after = this.toWorld(p.x, p.y)
    this.cam.x = this.camT.x += before.x - after.x
    this.cam.y = this.camT.y += before.y - after.y
    this.follow = null
    this.cb.onUserCamera?.()
  }

  private updateHover(x: number, y: number) {
    this.setHover(this.hitTest(x, y, 16))
  }

  private setHover(t: HitTarget | null) {
    const same = t?.kind === this.hoverTarget?.kind && t?.id === this.hoverTarget?.id
    if (same) return
    this.hoverTarget = t
    this.canvas.style.cursor = t ? 'pointer' : 'grab'
    this.cb.onHover(t)
  }

  hitTest(x: number, y: number, slop: number): HitTarget | null {
    let best: HitTarget | null = null
    let bestD = Infinity
    for (const d of this.dots.values()) {
      if (d.dying) continue
      const dist = Math.hypot(d.sx - x, d.sy - y)
      const r = Math.max(slop, d.sr * 1.6)
      if (dist < r && dist < bestD) {
        best = { kind: 'dot', id: d.id }
        bestD = dist
      }
    }
    if (best) return best
    for (const c of this.cores.values()) {
      const dist = Math.hypot(c.sx - x, c.sy - y)
      if (dist < Math.max(26, 34 * this.cam.z)) return { kind: 'core', id: c.id }
    }
    return null
  }

  // ================================================================== frame

  private frame = (now: number) => {
    if (!this.running) return
    this.raf = requestAnimationFrame(this.frame)
    let dt = (now - this.last) / 1000
    if (this.fpsCap) {
      this.frameAcc += dt
      this.last = now
      if (this.frameAcc < 1 / this.fpsCap) return
      dt = this.frameAcc
      this.frameAcc = 0
    } else {
      this.last = now
    }
    dt = Math.min(dt, 0.1)
    this.time += dt
    this.adapt(dt)
    this.update(dt)
    this.render()
  }

  /** Adaptive resolution: if frames are consistently slow, render fewer pixels. */
  private adapt(dt: number) {
    if (this.fpsCap) return
    this.perf.push(dt)
    if (this.perf.length < 90) return
    const avg = this.perf.reduce((a, b) => a + b, 0) / this.perf.length
    this.perf.length = 0
    if (avg > 0.024 && this.maxDpr > 1) {
      this.maxDpr = Math.max(1, this.maxDpr - 0.5)
      this.resize()
    }
  }

  private update(dt: number) {
    const t = this.time
    // camera
    if (this.follow) {
      const d = this.dots.get(this.follow)
      if (d) {
        this.camT.x = d.x
        this.camT.y = d.y
      }
    }
    if (!this.dragging && !this.pinch && (Math.abs(this.vel.x) > 0.5 || Math.abs(this.vel.y) > 0.5)) {
      this.camT.x -= this.vel.x * dt
      this.camT.y -= this.vel.y * dt
      this.cam.x = this.camT.x
      this.cam.y = this.camT.y
      this.vel.x *= Math.exp(-4 * dt)
      this.vel.y *= Math.exp(-4 * dt)
    }
    const k = this.reduced ? 6 : this.camK
    if (!this.dragging) {
      this.cam.x = damp(this.cam.x, this.camT.x, k, dt)
      this.cam.y = damp(this.cam.y, this.camT.y, k, dt)
      this.cam.z = Math.exp(damp(Math.log(this.cam.z), Math.log(this.camT.z), k, dt))
    }
    this.center.x = damp(this.center.x, this.centerT.x, 5, dt)
    this.center.y = damp(this.center.y, this.centerT.y, 5, dt)

    // cores
    for (const c of [...this.cores.values(), this.wanderCore]) {
      c.x = damp(c.x, c.tx, 2, dt)
      c.y = damp(c.y, c.ty, 2, dt)
      c.flash = Math.max(0, c.flash - dt * 1.2)
      c.spinBoost = Math.max(0, c.spinBoost - dt * 2.2)
      c.spin += dt * (0.08 + c.spinBoost)
      for (const m of c.motes) m.a += dt * m.w * (this.reduced ? 0.3 : 1)
      const s = this.toScreen(c.x, c.y)
      c.sx = s.x
      c.sy = s.y
      const hovered = this.hoverTarget?.kind === 'core' && this.hoverTarget.id === c.id
      c.hover = damp(c.hover, hovered ? 1 : 0, 10, dt)
    }

    // dots
    const motion = this.reduced ? 0.35 : 1
    for (const [id, d] of this.dots) {
      const core = (d.swarmId && this.cores.get(d.swarmId)) || this.wanderCore
      const spd = STATUS_SPEED[d.status]
      d.speed = damp(d.speed, spd, 1.5, dt)
      d.angle += dt * d.speed * (26 / d.orbitR) * 0.55 * motion
      d.glow = damp(d.glow, STATUS_GLOW[d.status], 2.2, dt)
      d.size = damp(d.size, STATUS_SIZE[d.status], 3, dt)
      d.ring = damp(d.ring, d.thinking && d.thinking !== 'idle' ? 1 : 0, 5, dt)
      d.errorMix = damp(d.errorMix, d.status === 'error' ? 1 : 0, 4, dt)
      const hovered = (this.hoverTarget?.kind === 'dot' && this.hoverTarget.id === id) || this.selected === id
      d.hover = damp(d.hover, hovered ? 1 : 0, 10, dt)
      if (d.birth < 1) d.birth = Math.min(1, d.birth + dt / (this.reduced ? 1.2 : 2.4))
      if (d.dying > 0) {
        d.dying += dt / 0.9
        if (d.dying >= 1) {
          this.dots.delete(id)
          continue
        }
      }
      // asleep dots drift: the orbit loosens and wobbles
      const loose = d.status === 'asleep' || d.status === 'stopped' ? 1.12 : 1
      const r = d.orbitR * loose + Math.sin(t * 0.3 + d.wobble) * 4 * motion
      const ca = Math.cos(d.angle)
      const sa = Math.sin(d.angle)
      let lx = ca * r
      let ly = sa * r * Math.cos(d.tilt)
      const lz = sa * Math.sin(d.tilt)
      const cn = Math.cos(d.node)
      const sn = Math.sin(d.node)
      const rx = lx * cn - ly * sn
      const ry = lx * sn + ly * cn
      lx = rx
      ly = ry
      let wx = core.x + lx
      let wy = core.y + ly
      if (d.birth < 1) {
        const e = easeOutBack(d.birth)
        wx = lerp(core.x, wx, e)
        wy = lerp(core.y, wy, e)
      }
      // error glitch: brief horizontal tears
      if (d.status === 'error' && !this.reduced) {
        if (t > d.glitchUntil && Math.random() < dt * 2.5) {
          d.glitchUntil = t + 0.06 + Math.random() * 0.1
          d.glitchX = (Math.random() - 0.5) * 10
        }
      }
      d.x = wx
      d.y = wy
      d.z = lz
      const s = this.toScreen(wx, wy)
      d.sx = s.x
      d.sy = s.y
      const depth = 1 + d.z * 0.22
      d.sr = Math.max(2.6, 4.6 * Math.pow(this.cam.z, 0.6) * depth * d.size)
    }

    // particles
    for (const p of this.particles) {
      p.t += dt / p.dur
      if (p.t >= 1) this.finishParticle(p)
    }
    this.particles = this.particles.filter((p) => !p.done)

    // effects
    for (const e of this.effects) e.t += dt / e.dur
    this.effects = this.effects.filter((e) => e.t < 1)

    // dust
    for (const m of this.dust) {
      m.x += m.vx * dt
      m.y += m.vy * dt
    }

    // DOM trackers
    for (const [el, id] of this.tracked) {
      const d = this.dots.get(id)
      if (d) el.style.transform = `translate3d(${Math.round(d.sx)}px, ${Math.round(d.sy)}px, 0)`
    }
  }

  private seedDust() {
    const n = this.reduced ? 18 : Math.round(Math.min(90, (this.w * this.h) / 14000))
    this.dust = Array.from({ length: n }, () => ({
      x: Math.random() * 2000,
      y: Math.random() * 2000,
      z: 0.2 + Math.random() * 0.8,
      vx: (Math.random() - 0.5) * (this.reduced ? 2 : 8),
      vy: (Math.random() - 0.5) * (this.reduced ? 2 : 8) - 2,
      a: 0.15 + Math.random() * 0.4,
    }))
  }

  // ================================================================== render

  private render() {
    const ctx = this.ctx
    const { w, h } = this
    const z = this.cam.z
    const t = this.time
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1

    // ---- deep space backdrop
    const bg = ctx.createLinearGradient(0, 0, 0, h)
    bg.addColorStop(0, '#05051a')
    bg.addColorStop(0.55, '#070620')
    bg.addColorStop(1, '#030311')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)

    // ---- star layers (parallax)
    this.drawStars(this.stars.farPat, 512, 0.04, 0.9)
    this.drawStars(this.stars.nearPat, 640, 0.1, 0.8)

    ctx.globalCompositeOperation = 'lighter'
    // twinkles
    for (const s of this.twinkles) {
      const x = (((s.x * w - this.cam.x * 0.06) % w) + w) % w
      const y = (((s.y * h - this.cam.y * 0.06) % h) + h) % h
      const a = this.reduced ? 0.4 : 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * s.s + s.p))
      ctx.globalAlpha = a
      ctx.drawImage(glowSprite(225, 60), x - 5, y - 5, 10, 10)
    }

    // ---- nebulae around each swarm
    for (const c of this.cores.values()) {
      const s = this.toScreen(c.x * 0.85 + this.cam.x * 0.15, c.y * 0.85 + this.cam.y * 0.15)
      const R = 620 * Math.pow(z, 0.75)
      ctx.globalAlpha = 0.85
      ctx.drawImage(nebulaSprite(c.hue), s.x - R, s.y - R * 0.8, R * 2, R * 1.6)
      ctx.globalAlpha = 0.5
      const R2 = R * 0.6
      ctx.drawImage(nebulaSprite(c.hue + 40), s.x - R2 + R * 0.25, s.y - R2 * 0.9 - R * 0.12, R2 * 2, R2 * 1.8)
    }

    // ---- dust (screen space with parallax)
    for (const m of this.dust) {
      const x = (((m.x - this.cam.x * m.z * 0.35) % w) + w) % w
      const y = (((m.y - this.cam.y * m.z * 0.35) % h) + h) % h
      ctx.globalAlpha = m.a * (this.dimmed ? 0.5 : 1)
      const r = 1.5 + m.z * 3
      ctx.drawImage(glowSprite(240, 50, false), x - r, y - r, r * 2, r * 2)
    }

    // ---- tethers
    ctx.lineWidth = 1
    for (const d of this.dots.values()) {
      const core = (d.swarmId && this.cores.get(d.swarmId)) || null
      if (!core || d.glow < 0.4) continue
      const a = 0.05 + 0.1 * d.hover + (d.ring > 0.1 ? 0.05 * d.ring : 0)
      ctx.globalAlpha = a * (d.birth < 1 ? d.birth : 1) * (1 - d.dying)
      ctx.strokeStyle = `hsl(${d.hue} 90% 70%)`
      ctx.beginPath()
      ctx.moveTo(core.sx, core.sy)
      ctx.lineTo(d.sx, d.sy)
      ctx.stroke()
    }

    // ---- dots behind cores
    const sorted = [...this.dots.values()].sort((a, b) => a.z - b.z)
    for (const d of sorted) if (d.z < 0) this.drawDot(d)
    for (const c of this.cores.values()) this.drawCore(c)
    if (this.wanderCore.members > 0) this.drawWanderHub()
    for (const d of sorted) if (d.z >= 0) this.drawDot(d)

    // ---- particles & effects
    for (const p of this.particles) this.drawParticle(p)
    for (const e of this.effects) this.drawEffect(e)

    // ---- labels
    ctx.globalCompositeOperation = 'source-over'
    this.drawLabels(sorted)

    // ---- vignette & fog
    ctx.globalAlpha = 1
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.78)
    vg.addColorStop(0, 'rgba(2,2,10,0)')
    vg.addColorStop(1, 'rgba(2,2,10,0.72)')
    ctx.fillStyle = vg
    ctx.fillRect(0, 0, w, h)
    if (this.dimmed) {
      ctx.fillStyle = 'rgba(3,3,14,0.45)'
      ctx.fillRect(0, 0, w, h)
    }
  }

  private drawStars(pat: CanvasPattern | null, size: number, parallax: number, alpha: number) {
    if (!pat) return
    const ctx = this.ctx
    const ox = -((this.cam.x * parallax) % size)
    const oy = -((this.cam.y * parallax) % size)
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.translate(ox, oy)
    ctx.fillStyle = pat
    ctx.fillRect(-ox - size, -oy - size, this.w + size * 2, this.h + size * 2)
    ctx.restore()
  }

  private drawCore(c: Core) {
    const ctx = this.ctx
    const z = this.cam.z
    const t = this.time
    const zs = Math.pow(z, 0.8)
    const breathe = this.reduced ? 1 : 1 + 0.04 * Math.sin(t * 0.9 + c.spin)
    const scale = (1 + Math.min(0.4, c.motes.length / 90)) * breathe
    const { sx, sy } = c
    if (sx < -400 || sy < -400 || sx > this.w + 400 || sy > this.h + 400) return

    // halo
    let R = 170 * zs * scale * (1 + c.flash * 0.15 + c.hover * 0.08)
    ctx.globalAlpha = 0.55 + c.flash * 0.3
    ctx.drawImage(glowSprite(c.hue, 95, false), sx - R, sy - R, R * 2, R * 2)
    R = 58 * zs * scale
    ctx.globalAlpha = 0.9
    ctx.drawImage(glowSprite(c.hue, 100), sx - R, sy - R, R * 2, R * 2)

    // orbit rings (tilted ellipses)
    ctx.lineWidth = 1
    for (let i = 0; i < 3; i++) {
      const rr = (30 + i * 15) * zs * scale
      ctx.globalAlpha = 0.16 + c.flash * 0.2 + c.hover * 0.15 - i * 0.03
      ctx.strokeStyle = `hsl(${c.hue + i * 18} 90% 75%)`
      ctx.beginPath()
      ctx.ellipse(sx, sy, rr, rr * (0.32 + i * 0.08), c.spin * (i % 2 ? -1 : 1) + i * 0.9, 0, TAU)
      ctx.stroke()
    }

    // belief motes orbiting inside the core
    for (const m of c.motes) {
      const age = this.time - m.born
      const appear = age < 1.2 ? easeOut(Math.max(0, age) / 1.2) : 1
      const x = Math.cos(m.a) * m.r
      const y = Math.sin(m.a) * m.r * Math.cos(m.incl)
      const mx = sx + x * zs * scale
      const my = sy + y * zs * scale
      const [r, g, b] = freqRgb(m.f)
      ctx.globalAlpha = (0.35 + m.c * 0.65) * appear
      ctx.fillStyle = `rgb(${r},${g},${b})`
      const ms = (0.9 + m.c * 1.4) * Math.max(0.7, zs) * (age < 1.2 ? 1 + (1 - appear) * 3 : 1)
      ctx.beginPath()
      ctx.arc(mx, my, ms, 0, TAU)
      ctx.fill()
    }

    // nucleus
    R = (12 + c.flash * 10) * zs * scale
    ctx.globalAlpha = 1
    ctx.drawImage(glowSprite(c.hue, 60), sx - R, sy - R, R * 2, R * 2)
  }

  private drawWanderHub() {
    const ctx = this.ctx
    const s = this.toScreen(this.wanderCore.x, this.wanderCore.y)
    const R = 26 * Math.pow(this.cam.z, 0.8)
    ctx.globalAlpha = 0.25
    ctx.drawImage(glowSprite(this.wanderCore.hue, 40, false), s.x - R, s.y - R, R * 2, R * 2)
  }

  private drawDot(d: Dot) {
    const ctx = this.ctx
    const t = this.time
    const { sx, sy } = d
    if (sx < -60 || sy < -60 || sx > this.w + 60 || sy > this.h + 60) return
    const fade = (d.birth < 1 ? Math.min(1, d.birth * 3) : 1) * (1 - d.dying)
    const depthA = 0.72 + 0.28 * (d.z + 1) * 0.5
    let breathe = 1
    let alpha = d.glow * depthA * fade
    if (d.status === 'awake') breathe = 1 + (this.reduced ? 0.04 : 0.17) * Math.sin(t * 1.9 + d.phase)
    if (d.status === 'starting' || d.status === 'created') alpha *= 0.65 + 0.35 * Math.sin(t * (this.reduced ? 2 : 9) + d.phase)
    const r = d.sr * breathe * (1 + d.hover * 0.25) * (d.birth < 1 ? 0.4 + 0.6 * easeOutBack(d.birth) : 1)
    const hue = d.errorMix > 0.5 ? 0 : d.hue
    const gx = t < d.glitchUntil ? d.glitchX : 0

    // outer glow
    const G = r * (d.status === 'asleep' || d.status === 'stopped' ? 5 : 7.5) * (1 + d.hover * 0.3)
    ctx.globalAlpha = alpha * (0.75 + d.hover * 0.25)
    ctx.drawImage(glowSprite(hue, d.status === 'asleep' ? 55 : d.status === 'stopped' ? 15 : 100), sx - G + gx, sy - G, G * 2, G * 2)

    // error: chromatic split + scanline tears
    if (d.errorMix > 0.05) {
      const e = d.errorMix
      const split = this.reduced ? 1.5 : 2.5 + (t < d.glitchUntil ? 4 : 0)
      ctx.globalAlpha = 0.6 * e * fade
      ctx.drawImage(glowSprite(355, 100), sx - G * 0.5 - split + gx, sy - G * 0.5, G, G)
      ctx.drawImage(glowSprite(185, 100), sx - G * 0.5 + split + gx, sy - G * 0.5, G, G)
      if (!this.reduced && t < d.glitchUntil) {
        ctx.fillStyle = 'rgba(255,70,90,0.8)'
        for (let i = 0; i < 3; i++) {
          const yy = sy + (Math.random() - 0.5) * r * 6
          ctx.fillRect(sx - r * 4 + gx * 2, yy, r * 8 * Math.random(), 1)
        }
      }
    }

    // stopped dots show as a hollow ring
    if (d.status === 'stopped') {
      ctx.globalAlpha = 0.4 * fade
      ctx.strokeStyle = `hsl(${d.hue} 25% 70%)`
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(sx, sy, r * 1.6, 0, TAU)
      ctx.stroke()
    }

    // hot core
    const C = r * 2.2
    ctx.globalAlpha = Math.min(1, alpha * 1.15)
    ctx.drawImage(glowSprite(hue, 100), sx - C + gx, sy - C, C * 2, C * 2)

    // thinking ring
    if (d.ring > 0.02) {
      const skills = d.thinking === 'skills'
      const ringHue = skills ? (d.hue + 55) % 360 : d.hue
      const rr = r * 3.3 + 3
      const spin = t * (skills ? 4.2 : 2.4) * (this.reduced ? 0.25 : 1)
      ctx.globalAlpha = 0.85 * d.ring * fade
      ctx.strokeStyle = `hsl(${ringHue} 100% 78%)`
      ctx.lineWidth = 1.4
      ctx.lineCap = 'round'
      const segs = skills ? 4 : 2
      for (let i = 0; i < segs; i++) {
        const a0 = spin + (i * TAU) / segs
        ctx.beginPath()
        ctx.ellipse(sx, sy, rr, rr * 0.42, -0.35, a0, a0 + (skills ? 0.7 : 1.5))
        ctx.stroke()
      }
      // satellite spark
      const sa = spin * 1.3
      const px = sx + Math.cos(sa) * rr * Math.cos(-0.35) - Math.sin(sa) * rr * 0.42 * Math.sin(-0.35)
      const py = sy + Math.cos(sa) * rr * Math.sin(-0.35) + Math.sin(sa) * rr * 0.42 * Math.cos(-0.35)
      const S = 6 + r
      ctx.globalAlpha = d.ring * fade
      ctx.drawImage(glowSprite(ringHue, 100), px - S / 2, py - S / 2, S, S)
      // shimmer
      if (!this.reduced) {
        ctx.globalAlpha = 0.25 * d.ring * (0.5 + 0.5 * Math.sin(t * 12 + d.phase)) * fade
        const SH = G * 1.1
        ctx.drawImage(glowSprite(ringHue, 100, false), sx - SH, sy - SH, SH * 2, SH * 2)
      }
    }

    // selection reticle
    if (this.selected === d.id) {
      const rr = r * 4.2 + 6 + Math.sin(t * 2.4) * 1.5
      ctx.globalAlpha = 0.7 * fade
      ctx.strokeStyle = `hsl(${d.hue} 100% 82%)`
      ctx.lineWidth = 1.2
      for (let i = 0; i < 4; i++) {
        const a0 = t * 0.6 + (i * TAU) / 4
        ctx.beginPath()
        ctx.arc(sx, sy, rr, a0, a0 + 0.9)
        ctx.stroke()
      }
    }
  }

  private particlePos(p: Particle, t: number): V2 | null {
    const a = p.from()
    const b = p.to()
    if (!a || !b) return null
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    const dx = b.x - a.x
    const dy = b.y - a.y
    const cx = mx - dy * p.bend
    const cy = my + dx * p.bend
    const u = 1 - t
    return { x: u * u * a.x + 2 * u * t * cx + t * t * b.x, y: u * u * a.y + 2 * u * t * cy + t * t * b.y }
  }

  private drawParticle(p: Particle) {
    const ctx = this.ctx
    const e = easeInOut(Math.min(1, p.t))
    const quarantine = p.outcome === 'quarantined' || p.outcome === 'denied'
    const tt = quarantine ? Math.min(e, 0.86) : e
    const pos = this.particlePos(p, tt)
    if (!pos) {
      p.done = true
      return
    }
    const s = this.toScreen(pos.x, pos.y)
    p.trail.push(s)
    const maxTrail = this.reduced ? 6 : p.kind === 'belief' ? 16 : 20
    if (p.trail.length > maxTrail) p.trail.shift()
    const hue = p.kind === 'belief' && p.f !== undefined ? p.hue : p.hue
    const zs = Math.pow(this.cam.z, 0.6)
    // trail
    ctx.lineCap = 'round'
    for (let i = 1; i < p.trail.length; i++) {
      const k = i / p.trail.length
      ctx.globalAlpha = k * 0.55
      ctx.strokeStyle = `hsl(${hue} 100% ${70 + k * 15}%)`
      ctx.lineWidth = (p.kind === 'msg' ? 2.6 : 2) * k * zs + 0.3
      ctx.beginPath()
      ctx.moveTo(p.trail[i - 1].x, p.trail[i - 1].y)
      ctx.lineTo(p.trail[i].x, p.trail[i].y)
      ctx.stroke()
    }
    // head
    const H = (p.kind === 'msg' ? 16 : 12) * zs
    ctx.globalAlpha = quarantine && p.t > 0.8 ? 1 - (p.t - 0.8) / 0.2 : 1
    ctx.drawImage(glowSprite(hue, 100), s.x - H, s.y - H, H * 2, H * 2)
    if (p.kind === 'belief' && p.f !== undefined) {
      const [r, g, b] = freqRgb(p.f)
      ctx.globalAlpha = 0.9
      ctx.fillStyle = `rgb(${r},${g},${b})`
      ctx.beginPath()
      ctx.arc(s.x, s.y, 1.6 * zs + 0.6, 0, TAU)
      ctx.fill()
    }
  }

  private drawEffect(e: Effect) {
    const ctx = this.ctx
    const at = e.at()
    if (!at) return
    const s = this.toScreen(at.x, at.y)
    const zs = Math.pow(this.cam.z, 0.8)
    const t = e.t
    ctx.lineCap = 'round'
    switch (e.kind) {
      case 'ripple': {
        for (let i = 0; i < (this.reduced ? 1 : 2); i++) {
          const u = clamp(t * 1.25 - i * 0.22, 0, 1)
          if (u <= 0) continue
          const r = (34 + easeOut(u) * 120) * zs
          ctx.globalAlpha = (1 - u) * 0.65
          ctx.strokeStyle = `hsl(${e.hue} 100% 78%)`
          ctx.lineWidth = 2.2 * (1 - u) + 0.4
          ctx.beginPath()
          ctx.ellipse(s.x, s.y, r, r * 0.92, 0, 0, TAU)
          ctx.stroke()
        }
        break
      }
      case 'choice': {
        // a jagged, angular shockwave with radial fracture lines: decisively not a revision
        const u = easeOut(t)
        const jag = e.jag!
        const n = jag.length
        const r0 = (30 + u * 95) * zs
        ctx.globalAlpha = (1 - t) * 0.9
        ctx.strokeStyle = e.rejected ? 'hsl(330 100% 78%)' : 'hsl(48 100% 80%)'
        ctx.lineWidth = 1.6
        ctx.beginPath()
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * TAU + e.seed * TAU
          const rr = r0 * jag[i % n]
          const x = s.x + Math.cos(a) * rr
          const y = s.y + Math.sin(a) * rr
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
        // fracture spikes
        ctx.lineWidth = 1.1
        for (let i = 0; i < 6; i++) {
          const a = e.seed * 7 + (i * TAU) / 6
          const a1 = (18 + u * 30) * zs
          const a2 = (30 + u * 80) * zs * jag[i]
          ctx.globalAlpha = (1 - t) * 0.8
          ctx.beginPath()
          ctx.moveTo(s.x + Math.cos(a) * a1, s.y + Math.sin(a) * a1)
          ctx.lineTo(s.x + Math.cos(a + 0.08) * a2, s.y + Math.sin(a + 0.08) * a2)
          ctx.stroke()
        }
        // white flash
        if (t < 0.25) {
          const R = 70 * zs
          ctx.globalAlpha = (0.25 - t) * 3
          ctx.drawImage(glowSprite(0, 0), s.x - R, s.y - R, R * 2, R * 2)
        }
        break
      }
      case 'spark':
      case 'adopt':
      case 'birth': {
        const u = easeOut(t)
        if (e.kind !== 'spark') {
          const hue = e.hue < 0 ? undefined : e.hue
          const r = (e.kind === 'birth' ? 20 + u * 150 : 16 + u * 60) * zs
          ctx.globalAlpha = (1 - t) * (e.kind === 'birth' ? 0.9 : 0.6)
          if (hue === undefined) {
            const [rr, gg, bb] = freqRgb(-1 - e.hue)
            ctx.strokeStyle = `rgb(${rr},${gg},${bb})`
          } else {
            ctx.strokeStyle = `hsl(${hue} 100% 80%)`
          }
          ctx.lineWidth = e.kind === 'birth' ? 2.5 * (1 - t) + 0.5 : 1.4
          ctx.beginPath()
          ctx.arc(s.x, s.y, r, 0, TAU)
          ctx.stroke()
          if (e.kind === 'birth' && t < 0.4) {
            const R = (80 + t * 200) * zs
            ctx.globalAlpha = (0.4 - t) * 2
            ctx.drawImage(glowSprite(e.hue, 100), s.x - R, s.y - R, R * 2, R * 2)
          }
        }
        for (const sp of e.sparks ?? []) {
          const d = sp.v * u * zs
          const x = s.x + Math.cos(sp.a) * d
          const y = s.y + Math.sin(sp.a) * d
          const S = 7 * sp.s * zs * (1 - t)
          ctx.globalAlpha = 1 - t
          ctx.drawImage(glowSprite(e.hue < 0 ? 210 : e.hue, 100), x - S, y - S, S * 2, S * 2)
        }
        break
      }
      case 'quarantine': {
        // the membrane holds: an amber ring that contracts and blinks
        const r = (52 - easeOut(t) * 10) * zs
        const blink = this.reduced ? 1 : 0.55 + 0.45 * Math.cos(t * TAU * 3)
        ctx.globalAlpha = (1 - t) * 0.85 * blink
        ctx.strokeStyle = 'hsl(28 100% 64%)'
        ctx.lineWidth = 1.6
        ctx.setLineDash([4, 5])
        ctx.beginPath()
        ctx.arc(s.x, s.y, r, e.seed * TAU, e.seed * TAU + TAU)
        ctx.stroke()
        ctx.setLineDash([])
        break
      }
      case 'duplicate': {
        const R = (18 + t * 20) * zs
        ctx.globalAlpha = (1 - t) * 0.35
        ctx.drawImage(glowSprite(e.hue, 30, false), s.x - R, s.y - R, R * 2, R * 2)
        break
      }
    }
  }

  private drawLabels(sorted: Dot[]) {
    const ctx = this.ctx
    const z = this.cam.z
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    // swarm names
    for (const c of this.cores.values()) {
      const zs = Math.pow(z, 0.8)
      const y = c.sy + 70 * zs + 8
      ctx.globalAlpha = 0.9
      ctx.font = `600 ${z < 0.6 ? 11 : 12}px "Space Grotesk Variable", "Space Grotesk", system-ui, sans-serif`
      ctx.fillStyle = 'rgba(236,236,255,0.92)'
      setSpacing(ctx, '0.18em')
      ctx.fillText(c.name.toUpperCase(), c.sx, y)
      setSpacing(ctx, '0px')
      ctx.font = `500 10px "Inter Variable", Inter, system-ui, sans-serif`
      ctx.fillStyle = 'rgba(190,192,230,0.7)'
      ctx.fillText(`${c.motes.length} beliefs · ${c.members} dots`, c.sx, y + 16)
    }
    // dot names
    ctx.font = `500 ${z < 0.7 ? 10 : 11}px "Inter Variable", Inter, system-ui, sans-serif`
    for (const d of sorted) {
      const lit = d.status === 'awake' || d.status === 'error' || d.status === 'starting'
      const zMin = lit ? 0.42 : 0.75
      const show = z > zMin || d.hover > 0.05 || this.selected === d.id
      if (!show || d.dying) continue
      const base = z > zMin ? clamp((z - zMin) * 5, 0, 1) : 0
      const a = Math.max(base * (0.35 + 0.55 * d.glow) * ((d.z + 1.4) / 2.4), d.hover)
      if (a < 0.03) continue
      ctx.globalAlpha = a * (d.birth < 1 ? d.birth : 1)
      ctx.fillStyle = d.status === 'error' ? 'rgba(255,170,175,1)' : 'rgba(232,234,255,1)'
      ctx.fillText(d.name, d.sx, d.sy + d.sr * 2.2 + 6)
    }
  }
}

function setSpacing(ctx: CanvasRenderingContext2D, v: string) {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
  if ('letterSpacing' in c) c.letterSpacing = v
}
