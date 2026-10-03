import type { Agent, Belief, Swarm } from '../api/types'
import type { Route } from '../lib/router'
import { sessionKey } from '../store/programSession'
import type { Store } from '../store/store'
import { meta } from './chapters'
import type { ChapterLike } from './machine'

/**
 * The guided tour, chapter by chapter. It drives the real app (router and store actions only, nothing
 * that changes the hive), points at real elements by their `data-tour` names, and every sentence
 * describes the app as it is built. Texts and targets are chosen for the device at build time.
 */

export type Rect = { x: number; y: number; w: number; h: number; round?: boolean }
export type TargetFn = (ctx: TourCtx) => Element | Rect | null
/** A `data-tour` name, or a function for things that are not elements (a dot on the canvas). */
export type Target = string | TargetFn

export interface Beat {
  text: string
  /** The pointer moves here and clicks, then `do` runs. */
  point?: Target
  /** Click the pointed element for real. Only for harmless UI toggles (a menu, a drawer). */
  press?: boolean
  do?: (ctx: TourCtx) => void | Promise<void>
  /** What the spotlight shows once `do` has run (defaults to `point`; null: no spotlight). */
  show?: Target | null
}

export interface Chapter extends ChapterLike {
  /** One line for the chapter list and the help sheet. */
  blurb: string
  setup(ctx: TourCtx): void | Promise<void>
  beats: Beat[]
}

export interface TourCtx {
  mobile: boolean
  sim: boolean
  store(): Store
  go(route: Route): void
  sleep(ms: number): Promise<void>
  /** The first visible element with this data-tour name. */
  find(name: string): HTMLElement | null
  /** Wait up to `ms` for it. */
  waitFor(name: string, ms?: number): Promise<HTMLElement | null>
  /** Open a program on a clean trail; the person's own trail comes back when the tour ends. */
  freshProgram(programId: string, swarmId: string): void
  scene: {
    overview(): void
    dot(id: string): { x: number; y: number; r: number } | null
    core(id: string): { x: number; y: number; r: number } | null
  }
}

// ---------------------------------------------------------------- choosing real things to show

export interface Picks {
  swarm: Swarm | null
  dot: Agent | null
  /** A second awake dot, to show what "asleep" looks like when there is one. */
  sleeper: Agent | null
  belief: Belief | null
  goalsSwarm: Swarm | null
  program: string | null
  explorer: string | null
}

export function pick(s: Store): Picks {
  const swarms = Object.values(s.swarms).sort((a, b) => a.created_at.localeCompare(b.created_at))
  const swarm = swarms[0] ?? null
  const agents = Object.values(s.agents)
  const members = swarm ? agents.filter((a) => a.swarm_id === swarm.id) : agents
  const dot = members.find((a) => a.status === 'awake') ?? agents.find((a) => a.status === 'awake') ?? members[0] ?? agents[0] ?? null
  const sleeper = members.find((a) => a.status === 'asleep') ?? agents.find((a) => a.status === 'asleep') ?? null
  const beliefs = swarm ? Object.values(s.beliefs[swarm.id] ?? {}) : []
  const belief = [...beliefs].sort((a, b) => b.sources.length - a.sources.length || b.tv.c - a.tv.c)[0] ?? null
  const goals = Object.values(s.goals)
  const goalsSwarmId = goals.find((g) => g.status === 'waiting')?.swarm_id ?? goals.find((g) => g.status === 'claimed')?.swarm_id ?? swarm?.id
  const enabled = (s.programs ?? []).filter((p) => p.enabled && !p.error)
  const program = enabled.find((p) => p.id === 'contract-fixture')?.id ?? enabled[0]?.id ?? null
  const explorer = enabled.find((p) => p.id === 'commons-explorer')?.id ?? enabled[0]?.id ?? null
  return { swarm, dot, sleeper, belief, goalsSwarm: (goalsSwarmId && s.swarms[goalsSwarmId]) || swarm, program, explorer }
}

// ---------------------------------------------------------------- small helpers

const dotTarget = (id: string | undefined): TargetFn => (ctx) => {
  const p = id ? ctx.scene.dot(id) : null
  if (!p) return null
  const r = Math.max(26, p.r * 3.2)
  return { x: p.x - r, y: p.y - r, w: r * 2, h: r * 2, round: true }
}
const coreTarget = (id: string | undefined): TargetFn => (ctx) => {
  const p = id ? ctx.scene.core(id) : null
  if (!p) return null
  const r = Math.max(40, p.r * 1.25)
  return { x: p.x - r, y: p.y - r, w: r * 2, h: r * 2, round: true }
}
const starTarget = (statement: string | undefined): TargetFn => () => {
  if (!statement) return null
  const stars = document.querySelectorAll<SVGGElement>('[data-tour="star"]')
  for (const g of stars) if (g.getAttribute('data-statement') === statement) return g
  return stars[0] ?? null
}

async function setExpanded(ctx: TourCtx, name: string, open: boolean) {
  const el = ctx.find(name)
  if (el && (el.getAttribute('aria-expanded') === 'true') !== open) {
    el.click()
    await ctx.sleep(380)
  }
}

/** Show a program step without piling up trail steps when a beat is replayed. */
function programStep(ctx: TourCtx, programId: string, swarmId: string, stage: 'unfold' | 'map' | 'compare' | 'detail', focus: string | null) {
  const key = sessionKey(programId, swarmId)
  const s = ctx.store()
  const sess = s.programSessions[key]
  const cur = sess?.trail[sess.trail.length - 1]
  if (cur && cur.stage === stage && (cur.focus === focus || stage === 'map')) return
  s.programGo(key, { stage, focus })
}

// ---------------------------------------------------------------- the script

export function buildChapters(ctx: TourCtx): Chapter[] {
  const p = pick(ctx.store())
  const { mobile, sim } = ctx
  const swarm = p.swarm?.id
  const dotId = p.dot?.id
  const dotName = p.dot?.name ?? 'a dot'
  const openDot = (tab?: 'mind' | 'memory' | 'schedule' | 'model') => () => {
    if (dotId) ctx.go({ name: 'dot', id: dotId, tab })
  }
  const goalsSwarm = p.goalsSwarm?.id
  const prog = p.program
  const progSwarm = swarm
  const closeOverlays = async () => {
    const s = ctx.store()
    if (s.stopAllOpen) s.setStopAll(false)
    if (s.paletteOpen) s.setPalette(false)
    await setExpanded(ctx, 'hud-more', false)
  }

  const chapters: Chapter[] = [
    {
      ...meta('hive'),
      async setup() {
        await closeOverlays()
        ctx.go({ name: 'hive' })
        await ctx.sleep(500)
        ctx.scene.overview()
        await ctx.sleep(900)
      },
      beats: [
        { text: 'Welcome to your hive. Every glowing dot here is an AI that stays on, day and night.', show: null },
        { text: 'Dots live together in swarms. Each swarm circles a bright core, which holds what its dots believe.', show: coreTarget(swarm) },
        {
          text: p.sleeper
            ? 'A bright, breathing dot is awake. A dim one is asleep. A spinning ring means it is thinking right now.'
            : 'A bright, breathing dot is awake, and a spinning ring around it means it is thinking right now.',
          show: dotTarget(dotId),
        },
        {
          text: sim
            ? 'Up top, you can see how many dots are awake, what they know, and their spend. In this demo, the spend is simulated.'
            : 'Up top, you can see how many dots are awake, how many beliefs they share, and what they have spent.',
          show: 'hud-stats',
        },
      ],
    },
    {
      ...meta('swarm'),
      async setup() {
        await closeOverlays()
        if (swarm) ctx.go({ name: 'swarm', id: swarm })
        await ctx.waitFor('swarm-sky')
      },
      beats: [
        { text: 'Open a swarm to see its commons: everything its dots have come to believe, drawn as a constellation.', show: 'swarm-sky' },
        { text: 'Each star is one belief. The brighter it is, and the nearer the core, the more sure the swarm is.', show: starTarget(p.belief?.statement) },
        { text: 'Colour shows how often the evidence says yes, from red for rarely to blue for almost always.', show: mobile ? 'swarm-sky' : 'sky-legend' },
        mobile
          ? { text: 'The members tab lists the dots that share this commons.', show: 'swarm-tab-members' }
          : { text: 'On the left are its members: the dots that share this commons.', show: 'swarm-members' },
      ],
    },
    {
      ...meta('dot'),
      async setup() {
        await closeOverlays()
        if (dotId) ctx.go({ name: 'dot', id: dotId })
        await ctx.waitFor('dot-header')
        await ctx.sleep(500)
      },
      beats: [
        { text: `Tap any dot to open its panel. This is ${dotName}. These buttons wake it, put it to sleep, or stop it.`, show: 'dot-controls' },
        { text: 'Chat talks to it directly. It answers in its own voice.', point: 'dot-tab-chat', do: openDot(), show: 'chat-composer' },
        { text: 'Mind lets you watch it think: each step, what it ran, and what the safety gate said.', point: 'dot-tab-mind', do: openDot('mind'), show: 'mind-replay' },
        { text: 'Memory is what it keeps privately. You can search it, or retire things it should forget.', point: 'dot-tab-memory', do: openDot('memory'), show: 'memory-spaces' },
        { text: 'Schedule is when it wakes itself up, and when it naps.', point: 'dot-tab-schedule', do: openDot('schedule'), show: 'schedule-wakeups' },
        { text: 'And Model picks its AI model, its personality and its spending cap.', point: 'dot-tab-model', do: openDot('model'), show: 'model-list' },
      ],
    },
    {
      ...meta('commons'),
      async setup() {
        await closeOverlays()
        if (swarm) ctx.go({ name: 'swarm', id: swarm })
        await ctx.waitFor('swarm-sky')
      },
      beats: [
        {
          text: 'Tap a star to see where a belief came from. The bars show how often it holds, and how sure the swarm is.',
          point: starTarget(p.belief?.statement),
          do: async () => {
            if (swarm && p.belief) ctx.go({ name: 'swarm', id: swarm, statement: p.belief.statement })
            await ctx.waitFor('prov-truth')
          },
          show: 'prov-truth',
        },
        { text: 'These are the dots that gave evidence for it.', show: 'prov-sources' },
        { text: 'Each new report is weighed against the old, so the belief is revised, never just overwritten. Reports that lean on the same evidence are not counted twice.', show: 'prov-assertions' },
        { text: 'Dots can also lend each other a private memory space for a limited time, with every read logged. That happens behind the scenes; this app does not show it yet.', show: null },
      ],
    },
    {
      ...meta('goals'),
      async setup() {
        await closeOverlays()
        ctx.go({ name: 'goals', swarm: goalsSwarm })
        await ctx.waitFor('goals-add')
      },
      beats: [
        { text: 'Goals are jobs for a swarm. You can post one here, and dots post their own too.', show: 'goals-add' },
        { text: 'A dot claims a goal and holds a lease, like a timer. It renews while the dot works. If it runs out, the goal goes back to Open.', show: 'goal-lease' },
        { text: 'When a dot has delivered and needs a person, the card turns amber: it is waiting on you.', show: 'goal-waiting' },
      ],
    },
    {
      ...meta('approvals'),
      async setup() {
        await closeOverlays()
        ctx.go({ name: 'approvals' })
        await ctx.waitFor('approval-card', 4000)
      },
      beats: [
        { text: 'Some actions are risky. When a dot reaches for one, it pauses and asks you here first.', show: 'approval-card' },
        { text: 'Approve once lets that exact command run one time. Always allow also adds a rule, so it will not ask again.', show: 'approval-actions' },
        {
          text: 'Rules decide what dots may do: allow, ask first, or deny, for the whole hive, one swarm, or one dot.',
          point: 'approvals-tab-rules',
          do: async () => {
            ctx.go({ name: 'approvals', tab: 'rules' })
            await ctx.waitFor('policy-rules', 4000)
          },
          show: 'policy-rules',
        },
        { text: 'Not sure what a rule will do? Try it shows the answer for any dot and skill.', show: 'policy-try' },
      ],
    },
    {
      ...meta('lab'),
      async setup() {
        await closeOverlays()
        ctx.go({ name: 'lab' })
        await ctx.waitFor('lab-scorecard', 4000)
      },
      beats: [
        {
          text: sim ? 'The Lab tests the hive itself. In this demo it shows recorded results, summed up in this scorecard.' : 'The Lab tests the hive itself. The scorecard sums up the latest run of every test and benchmark.',
          show: 'lab-scorecard',
        },
        { text: 'Each tile is one quality. Cost, for example, is a projection from measured token use. It is not money spent.', show: 'lab-dim-cost' },
        {
          text: 'Drift scenarios try to knock the hive off course, like echo storms and runaway spending. The leak counter must read zero.',
          do: async () => {
            ctx.go({ name: 'lab', suite: 'bench-drift' })
            await ctx.waitFor('drift-leaks', 4000)
          },
          show: 'drift-leaks',
        },
        {
          text: 'History shows how each result moves from run to run.',
          point: 'lab-suite-tab-history',
          do: async () => {
            ctx.go({ name: 'lab', suite: 'bench-drift', tab: 'history' })
            await ctx.waitFor('lab-history', 4000)
          },
          show: 'lab-history',
        },
      ],
    },
    {
      ...meta('programs'),
      async setup() {
        await closeOverlays()
        ctx.go({ name: 'programs' })
        await ctx.waitFor(p.explorer ? `program-card-${p.explorer}` : 'programs-list', 4000)
      },
      beats: [
        {
          text: 'Programs turn work into maps you can explore. Commons Explorer, for one, maps a swarm’s beliefs and the evidence behind them.',
          show: p.explorer ? `program-card-${p.explorer}` : 'programs-list',
        },
        {
          text: 'Here is a small test case. Unfold puts the question in the middle, with support on one side and doubts on the other.',
          do: async () => {
            if (!prog || !progSwarm) return
            ctx.freshProgram(prog, progSwarm)
            ctx.go({ name: 'program', id: prog, swarm: progSwarm })
            await ctx.waitFor('node-q1', 5000)
          },
          show: 'program-stage-view',
        },
        {
          text: 'Pick an item and its sources stay in view, with a warning when two come from the same place.',
          point: 'node-c1',
          do: async () => {
            if (prog && progSwarm) ctx.store().programSelect(sessionKey(prog, progSwarm), ['c1'])
            if (mobile) await setExpanded(ctx, 'program-drawer', true)
            await ctx.sleep(300)
          },
          show: 'program-sources',
        },
        {
          text: 'Map lays out the whole picture. Compare sets the groups side by side: what agrees, what conflicts, and what is missing.',
          point: 'program-stage-compare',
          do: async () => {
            if (mobile) await setExpanded(ctx, 'program-drawer', false)
            if (prog && progSwarm) programStep(ctx, prog, progSwarm, 'compare', 'c1')
            await ctx.sleep(500)
          },
          show: 'program-stage-view',
        },
        {
          text: 'Detail shows one item with its uncertainty: the exact numbers, and how they were worked out.',
          point: 'program-stage-detail',
          do: async () => {
            if (prog && progSwarm) programStep(ctx, prog, progSwarm, 'detail', 'c1')
            await ctx.waitFor('detail-uncertainty', 3000)
          },
          show: 'detail-uncertainty',
        },
        {
          text: 'Your trail keeps every step, and Back retraces them one at a time.',
          show: 'program-bar',
          do: async () => {
            await ctx.sleep(900)
            if (prog && progSwarm) ctx.store().programBack(sessionKey(prog, progSwarm))
          },
        },
      ],
    },
    {
      ...meta('safety'),
      async setup() {
        await closeOverlays()
        ctx.go({ name: 'hive' })
        await ctx.waitFor('hud-more')
      },
      beats: [
        {
          text: 'If anything looks wrong, Stop all is always one menu away.',
          point: 'hud-more',
          press: true,
          show: 'menu-stop-all',
        },
        {
          text: 'It halts every dot and keeps them stopped. You type “stop all” to confirm, so it never happens by accident.',
          do: async () => {
            await setExpanded(ctx, 'hud-more', false)
            ctx.store().setStopAll(true)
            await ctx.waitFor('stop-all-dialog')
          },
          show: 'stop-all-dialog',
        },
        {
          text: sim
            ? 'Each dot also has a budget cap, and calls that would go over it are refused. Here the costs are simulated: no model is called and nothing is charged.'
            : 'Each dot also has a budget cap. A call that would go over it is refused before it runs.',
          do: async () => {
            ctx.store().setStopAll(false)
            if (dotId) ctx.go({ name: 'dot', id: dotId })
            await ctx.waitFor('dot-budget')
            await ctx.sleep(400)
          },
          show: 'dot-budget',
        },
      ],
    },
    {
      ...meta('start'),
      async setup() {
        await closeOverlays()
        ctx.go({ name: 'hive' })
        await ctx.waitFor('nav-create')
        ctx.scene.overview()
      },
      beats: [
        { text: 'Your turn. Make a dot of your own with the plus button: give it a name, a home swarm and a model.', show: 'nav-create' },
        mobile
          ? { text: 'To get anywhere fast, tap Jump and type a dot, a swarm or a command.', show: 'nav-jump' }
          : { text: 'To get anywhere fast, press Command K, or Control K, and type a dot, a swarm or a command.', show: 'hud-search' },
        { text: 'Every view has a question mark button that explains it.', show: 'info-hive' },
        mobile
          ? { text: 'You can replay this tour any time from the more menu. Enjoy your hive.', show: 'hud-more' }
          : { text: 'Press the question mark key for shortcuts, or to replay this tour. Enjoy your hive.', show: null },
      ],
    },
  ]
  return chapters
}

/** Every target a beat uses, by name, for the end-to-end check. */
export function targetName(t: Target | null | undefined): string | null {
  if (t == null) return null
  return typeof t === 'string' ? t : t.name || 'canvas'
}
