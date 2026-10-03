/** Chapter titles and one-liners, shared by the tour, its chapter list and the help sheet. */
export const CHAPTERS = [
  { id: 'hive', title: 'The hive and its dots', blurb: 'What the glowing dots are and how to read them.' },
  { id: 'swarm', title: 'A swarm and its constellation', blurb: 'The shared beliefs of one swarm, drawn as stars.' },
  { id: 'dot', title: "A dot's panel", blurb: 'Chat, Mind, Memory, Schedule and Model.' },
  { id: 'commons', title: 'Beliefs and where they came from', blurb: 'A belief, its sources and how it is revised.' },
  { id: 'goals', title: 'Goals', blurb: 'Posting, claiming, leases, and work waiting on you.' },
  { id: 'approvals', title: 'Approvals and policy', blurb: 'The safety gate: approve once, always allow, rules.' },
  { id: 'lab', title: 'The Lab', blurb: 'Scorecard, drift scenarios and history.' },
  { id: 'programs', title: 'Dot programs', blurb: 'Work as maps: unfold, map, compare, detail.' },
  { id: 'safety', title: 'Safety: stop all and budgets', blurb: 'The kill switch and spending caps.' },
  { id: 'start', title: 'Your turn', blurb: 'Where to start.' },
] as const

export type ChapterId = (typeof CHAPTERS)[number]['id']

export function meta(id: ChapterId): { id: ChapterId; title: string; blurb: string } {
  return CHAPTERS.find((c) => c.id === id)!
}
