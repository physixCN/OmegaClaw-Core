import type { AgentKind, ModelOption } from '../types'

export const SIM_MODELS: (ModelOption & { inPerM: number; outPerM: number })[] = [
  { id: 'anthropic/claude-opus-5-5', provider: 'anthropic', label: 'Claude Opus 5.5', local: false, inPerM: 15, outPerM: 75 },
  { id: 'anthropic/claude-sonnet-5-5', provider: 'anthropic', label: 'Claude Sonnet 5.5', local: false, inPerM: 3, outPerM: 15 },
  { id: 'anthropic/claude-haiku-5', provider: 'anthropic', label: 'Claude Haiku 5', local: false, inPerM: 0.8, outPerM: 4 },
  { id: 'openai/gpt-5-mini', provider: 'openai', label: 'GPT-5 mini', local: false, inPerM: 0.25, outPerM: 2 },
  { id: 'ollama/qwen3-14b', provider: 'ollama', label: 'Qwen3 14B (local)', local: true, inPerM: 0, outPerM: 0 },
  { id: 'mock/echo', provider: 'mock', label: 'Echo (mock)', local: true, inPerM: 0, outPerM: 0 },
]

export interface SeedSwarm {
  id: string
  name: string
  description: string
  hue: number
  vocab: string[]
  /** [statement, f, c] */
  beliefs: [string, number, number][]
  musings: string[]
}

export interface SeedAgent {
  id: string
  name: string
  kind: AgentKind
  swarm_id: string | null
  model: string
  hue: number
  persona: string
  budget_usd: number
  /** Personality flavour used by the reply generator. */
  voice: 'precise' | 'warm' | 'terse' | 'poetic' | 'wry'
  start: 'awake' | 'asleep' | 'stopped'
}

export const SEED_SWARMS: SeedSwarm[] = [
  {
    id: 's_lyra',
    name: 'Lyra',
    description: 'Sky-survey swarm. Watches variable stars and argues about what they mean.',
    hue: 258,
    vocab: ['star', 'vega', 'deneb', 'altair', 'variable', 'luminous', 'binary', 'nebula', 'redshift', 'pulsar', 'cepheid', 'flare', 'observed', 'periodic'],
    beliefs: [
      ['(--> vega star)', 1, 0.95],
      ['(--> vega luminous)', 0.94, 0.86],
      ['(--> deneb supergiant)', 0.88, 0.74],
      ['(--> altair (× rotates fast))', 0.91, 0.7],
      ['(==> (--> $x cepheid) (--> $x periodic))', 0.97, 0.9],
      ['(--> (× vega dust-disk) has)', 0.81, 0.63],
      ['(--> sheliak binary)', 0.92, 0.77],
      ['(--> ring-nebula planetary)', 0.96, 0.82],
      ['(--> rr-lyrae variable)', 0.89, 0.71],
      ['(==> (--> $x flare) (--> $x variable))', 0.72, 0.55],
      ['(--> kic-8462 dimming-anomaly)', 0.64, 0.41],
      ['(--> epsilon-lyrae (× double double))', 0.86, 0.68],
      ['(--> m57 (× ring observed))', 0.93, 0.72],
      ['(--> vega pole-on)', 0.77, 0.52],
    ],
    musings: [
      'Light curve on RR Lyrae came in clean. Period holds at 0.567 days.',
      'Someone keeps asserting KIC 8462 is artificial. Evidence is thin; confidence stays low.',
      'Vega is pole-on, which is why it looks so even. I would like more spectra before I commit.',
      'Cross-checked the ring nebula against the archive. Revised upward.',
    ],
  },
  {
    id: 's_kelp',
    name: 'Kelp Commons',
    description: 'Coastal-ecology swarm. Models a kelp forest and its urchins, otters and tides.',
    hue: 168,
    vocab: ['kelp', 'urchin', 'otter', 'tide', 'grazes', 'eats', 'canopy', 'barren', 'warm-water', 'recovers', 'sunflower-star', 'holdfast'],
    beliefs: [
      ['(--> (× urchin kelp) grazes)', 0.96, 0.88],
      ['(--> (× otter urchin) eats)', 0.93, 0.84],
      ['(==> (--> $x barren) (--> $x urchin-dominated))', 0.87, 0.73],
      ['(--> kelp canopy-former)', 0.98, 0.9],
      ['(==> warm-water (--> kelp stressed))', 0.82, 0.69],
      ['(--> sunflower-star urchin-predator)', 0.9, 0.66],
      ['(--> reef-north barren)', 0.58, 0.47],
      ['(--> holdfast habitat)', 0.91, 0.62],
      ['(==> (--> otter present) (--> kelp recovers))', 0.79, 0.6],
      ['(--> spring-tide (× low exposes))', 0.84, 0.58],
      ['(--> reef-south canopy)', 0.71, 0.5],
      ['(--> (× crab urchin-larva) eats)', 0.6, 0.38],
    ],
    musings: [
      'North reef transect: urchin density up 14%. That pulls (--> reef-north barren) higher.',
      'Otter sighting near the south holdfasts. Small, but it counts as evidence.',
      'Water at 17.8 °C today. Holding the warm-water stress rule steady.',
      'Two of us disagree about reef-south. Choice kept the stronger stamp.',
    ],
  },
  {
    id: 's_forge',
    name: 'Forge',
    description: 'Infra swarm. Keeps the hive itself healthy: builds, queues, budgets, uptime.',
    hue: 32,
    vocab: ['service', 'healthy', 'degraded', 'queue', 'latency', 'build', 'green', 'deploy', 'budget', 'gateway', 'backlog', 'cache'],
    beliefs: [
      ['(--> gateway healthy)', 0.97, 0.91],
      ['(--> build-main green)', 0.93, 0.85],
      ['(--> (× queue backlog) low)', 0.81, 0.7],
      ['(==> (--> $s degraded) (--> $s needs-page))', 0.95, 0.88],
      ['(--> cache-hit-rate high)', 0.76, 0.64],
      ['(--> llm-latency (× p95 elevated))', 0.44, 0.52],
      ['(--> nightly-deploy safe)', 0.83, 0.61],
      ['(--> disk-node-3 degraded)', 0.31, 0.57],
      ['(--> budget-burn on-track)', 0.88, 0.72],
      ['(==> (--> build-main red) (--> deploy blocked))', 0.99, 0.93],
    ],
    musings: [
      'p95 on the gateway crept to 2.4s, then settled. Not paging anyone.',
      'Main is green. Nightly deploy can proceed.',
      'Disk on node-3 looked bad, then fine. Conflicting stamps went through choice.',
      'Burn rate across the hive is on track for the month.',
    ],
  },
]

export const SEED_AGENTS: SeedAgent[] = [
  { id: 'a_vega01', name: 'Vega', kind: 'omega', swarm_id: 's_lyra', model: 'anthropic/claude-sonnet-5-5', hue: 248, voice: 'precise', start: 'awake', budget_usd: 40,
    persona: 'You are Vega, a careful observational astronomer. You never round up your confidence. You cite evidence stamps when you can.' },
  { id: 'a_deneb2', name: 'Deneb', kind: 'omega', swarm_id: 's_lyra', model: 'anthropic/claude-opus-5-5', hue: 205, voice: 'poetic', start: 'awake', budget_usd: 80,
    persona: 'You are Deneb, the swarm\'s theorist. You look for rules that generalise across stars and state them as implications.' },
  { id: 'a_altr03', name: 'Altair', kind: 'omega', swarm_id: 's_lyra', model: 'anthropic/claude-haiku-5', hue: 285, voice: 'terse', start: 'asleep', budget_usd: 15,
    persona: 'You are Altair. Fast, terse, and sceptical. You flag anomalies and leave the theory to others.' },
  { id: 'a_mira04', name: 'Mira', kind: 'iter', swarm_id: 's_lyra', model: 'ollama/qwen3-14b', hue: 320, voice: 'wry', start: 'awake', budget_usd: 0,
    persona: 'You are Mira, a variable-star tracker that runs on local hardware. You have a dry sense of humour about being periodic.' },
  { id: 'a_coral5', name: 'Coral', kind: 'omega', swarm_id: 's_kelp', model: 'anthropic/claude-sonnet-5-5', hue: 352, voice: 'warm', start: 'awake', budget_usd: 30,
    persona: 'You are Coral, a field ecologist. You care about the forest as a whole and explain trade-offs gently.' },
  { id: 'a_nori06', name: 'Nori', kind: 'omega', swarm_id: 's_kelp', model: 'anthropic/claude-haiku-5', hue: 150, voice: 'precise', start: 'awake', budget_usd: 12,
    persona: 'You are Nori. You count urchins, otters and stipes, and you publish numbers rather than opinions.' },
  { id: 'a_sedg07', name: 'Sedge', kind: 'iter', swarm_id: 's_kelp', model: 'openai/gpt-5-mini', hue: 95, voice: 'terse', start: 'asleep', budget_usd: 8,
    persona: 'You are Sedge, a tide-pool watcher. Short reports, always with time and place.' },
  { id: 'a_wrak08', name: 'Wrack', kind: 'module', swarm_id: 's_kelp', model: 'mock/echo', hue: 185, voice: 'wry', start: 'stopped', budget_usd: 0,
    persona: 'Wrack is an ingestion module that turns buoy telemetry into assertions.' },
  { id: 'a_anvl09', name: 'Anvil', kind: 'omega', swarm_id: 's_forge', model: 'anthropic/claude-sonnet-5-5', hue: 24, voice: 'precise', start: 'awake', budget_usd: 25,
    persona: 'You are Anvil, the hive\'s site-reliability engineer. Calm under pressure, allergic to hand-waving.' },
  { id: 'a_bell10', name: 'Bellows', kind: 'iter', swarm_id: 's_forge', model: 'anthropic/claude-haiku-5', hue: 45, voice: 'warm', start: 'awake', budget_usd: 6,
    persona: 'You are Bellows. You watch budgets and token burn and nudge others when they overspend.' },
  { id: 'a_qnch11', name: 'Quench', kind: 'omega', swarm_id: 's_forge', model: 'openai/gpt-5-mini', hue: 8, voice: 'wry', start: 'asleep', budget_usd: 10,
    persona: 'You are Quench, the on-call responder. You go quiet until something breaks, then you are very loud.' },
  { id: 'a_wisp12', name: 'Wisp', kind: 'module', swarm_id: null, model: 'anthropic/claude-haiku-5', hue: 58, voice: 'poetic', start: 'awake', budget_usd: 5,
    persona: 'Wisp is a free-roaming scout. It belongs to no swarm and carries rumours between them.' },
]

export const NAME_IDEAS = [
  'Lumen', 'Orrery', 'Tessel', 'Halcyon', 'Ember', 'Sable', 'Quill', 'Nimbus', 'Fable', 'Cinder', 'Moth', 'Atlas',
  'Rook', 'Juno', 'Pike', 'Wren', 'Thistle', 'Kestrel', 'Lark', 'Onyx', 'Pollen', 'Echo', 'Drift', 'Spindle',
]

export const PERSONA_TEMPLATES: { label: string; text: string }[] = [
  { label: 'Observer', text: 'You watch carefully and publish only what you have evidence for. Keep confidence honest.' },
  { label: 'Theorist', text: 'You look for general rules across the commons and express them as implications.' },
  { label: 'Sceptic', text: 'You challenge weak beliefs, ask for evidence, and flag anomalies quickly.' },
  { label: 'Steward', text: 'You keep the swarm healthy: summarise, tidy the vocabulary, and help newcomers.' },
]

export const LOG_TEMPLATES = [
  'hub: heartbeat ok rtt={rtt}ms',
  'metta: (match &self {pat} $x) -> {n} results',
  'skills: invoked {skill} in {ms}ms',
  'llm: {model} prompt={pt} completion={ct}',
  'atomspace: {n} atoms, {m} links',
  'commons: query {pat} -> {n} hits',
  'memory: consolidated {n} episodes',
  'scheduler: next wake in {s}s',
]

export const SKILLS = ['search-archive', 'compute-period', 'summarise', 'fetch-telemetry', 'plot-curve', 'diff-beliefs', 'notify']
