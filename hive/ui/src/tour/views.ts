/** "What's this?" copy for every main view, the one-line first-visit hints, and the tour chapter each one plays. */
export type ViewKey =
  | 'hive'
  | 'swarm'
  | 'dot-chat'
  | 'dot-mind'
  | 'dot-memory'
  | 'dot-schedule'
  | 'dot-model'
  | 'approvals'
  | 'policy'
  | 'goals'
  | 'lab'
  | 'programs'
  | 'program'

export interface ViewHelp {
  title: string
  body: string
  /** One gentle line, shown the first time someone opens the view on their own. */
  hint: string
  /** The hint is remembered per hint key (the dot panel's tabs share one). */
  hintKey: string
  /** The tour chapter "Show me" plays. */
  chapter: string
}

export const VIEW_HELP: Record<ViewKey, ViewHelp> = {
  hive: {
    title: 'The hive',
    body: 'Every glowing dot is an AI that stays on. Dots live in swarms, circling a shared core. Hover or tap a dot to see what it is doing, and open it to talk to it.',
    hint: 'Each glowing dot is an AI that stays on. Tap one to meet it.',
    hintKey: 'hive',
    chapter: 'hive',
  },
  swarm: {
    title: 'A swarm and its commons',
    body: 'A swarm is a group of dots that share one commons: the beliefs they have gathered, each backed by evidence. Nearer the core means more confident. Tap a star to see where it came from.',
    hint: 'Each star is a belief this swarm shares. Tap one to see its evidence.',
    hintKey: 'swarm',
    chapter: 'swarm',
  },
  'dot-chat': {
    title: 'Chat',
    body: 'Talk to this dot directly. It answers in its own voice and can draw on what its swarm believes. Status buttons up top wake it, put it to sleep or stop it.',
    hint: 'This is one dot. Its tabs show its chat, its thinking, memory, schedule and model.',
    hintKey: 'dot',
    chapter: 'dot',
  },
  'dot-mind': {
    title: 'Mind',
    body: 'Watch this dot think. Each step shows what woke it, what the model said, the commands it ran and what the safety gate decided. Replay steps back through recent thinking.',
    hint: 'This is one dot. Its tabs show its chat, its thinking, memory, schedule and model.',
    hintKey: 'dot',
    chapter: 'dot',
  },
  'dot-memory': {
    title: 'Memory',
    body: 'What this dot keeps privately, grouped into spaces. Search it, retire an item it should not keep, or reset its memory entirely.',
    hint: 'This is one dot. Its tabs show its chat, its thinking, memory, schedule and model.',
    hintKey: 'dot',
    chapter: 'dot',
  },
  'dot-schedule': {
    title: 'Schedule',
    body: 'When this dot wakes itself up and when it naps. Add wakeups that repeat or happen once, and choose how long it idles before it sleeps.',
    hint: 'This is one dot. Its tabs show its chat, its thinking, memory, schedule and model.',
    hintKey: 'dot',
    chapter: 'dot',
  },
  'dot-model': {
    title: 'Model',
    body: 'The AI model this dot runs on, its persona, its colour and its budget cap. A call that would go over the cap is refused before it runs.',
    hint: 'This is one dot. Its tabs show its chat, its thinking, memory, schedule and model.',
    hintKey: 'dot',
    chapter: 'dot',
  },
  approvals: {
    title: 'Approvals',
    body: 'When a dot reaches for something risky, it pauses and asks here. Approve once runs that exact command one time. Always allow also adds a rule. Deny says no.',
    hint: 'Dots ask here before risky actions. Nothing runs until you decide.',
    hintKey: 'approvals',
    chapter: 'approvals',
  },
  policy: {
    title: 'Policy rules',
    body: 'Rules decide what a dot may do: allow, ask first, or deny. Set them for the whole hive, one swarm or one dot; the most specific rule wins. Try it shows the answer for any dot and skill.',
    hint: 'Rules decide what dots may do on their own and what needs you.',
    hintKey: 'policy',
    chapter: 'approvals',
  },
  goals: {
    title: 'Goals',
    body: 'Goals are work a swarm takes on. A dot claims one and holds a timed lease while it works; if the lease runs out, the goal goes back to Open. Amber cards are waiting on you.',
    hint: 'Goals are jobs for a swarm. Amber ones are waiting on you.',
    hintKey: 'goals',
    chapter: 'goals',
  },
  lab: {
    title: 'The Lab',
    body: 'The Lab tests the hive itself: tests for correctness, and benchmarks for speed, cost, safety and drift. The scorecard sums up the latest run of each suite.',
    hint: 'The Lab tests the hive itself. The scorecard sums up the latest runs.',
    hintKey: 'lab',
    chapter: 'lab',
  },
  programs: {
    title: 'Programs',
    body: 'Programs turn a piece of work into a map you can explore. A program supplies items, links and sources; the hive lays them out and keeps your trail.',
    hint: 'Programs turn a piece of work into a map you can explore.',
    hintKey: 'programs',
    chapter: 'programs',
  },
  program: {
    title: 'A program',
    body: 'Unfold puts one item in the middle with support and doubts around it. Map shows the whole graph, Compare sets groups side by side, Detail shows one item. Sources and your trail stay in view.',
    hint: 'Try the four stages up top: Unfold, Map, Compare and Detail.',
    hintKey: 'program',
    chapter: 'programs',
  },
}
