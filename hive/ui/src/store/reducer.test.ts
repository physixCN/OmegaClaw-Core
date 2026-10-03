import { describe, expect, it } from 'vitest'
import type { Agent, Approval, Belief, Goal, HiveEvent, Message, Trace } from '../api/types'
import {
  askingByAgent,
  claimedByAgent,
  computeStats,
  countPending,
  emptyData,
  LOG_CAP,
  mergeTraces,
  pendingApprovals,
  reduce,
  TRACE_CAP,
  type HiveData,
} from './reducer'

const at = '2026-10-03T12:00:00.000Z'
const agent = (p: Partial<Agent> = {}): Agent => ({
  id: 'a_1', name: 'Vega', kind: 'omega', swarm_id: 's_1', model: 'mock/echo', persona: '', hue: 200,
  status: 'awake', driver: 'local', budget_usd: 0, spent_usd: 1, connected: true, last_active_at: null, created_at: at, ...p,
})
const msg = (p: Partial<Message> = {}): Message => ({
  id: 'm_1', agent_id: 'a_1', conversation_id: 'c', direction: 'in', sender: 'user:operator', text: 'hi', created_at: at, ...p,
})
const belief = (p: Partial<Belief> = {}): Belief => ({
  swarm_id: 's_1', statement: '(--> sky blue)', tv: { f: 0.9, c: 0.8 }, stamp: ['ev:a_1:1'], sources: ['a_1'], updated_at: at, ...p,
})
const run = (events: HiveEvent[], s: HiveData = emptyData()) => events.reduce(reduce, s)

describe('reduce', () => {
  it('hello stores hive info', () => {
    const s = run([{ type: 'hello', at, hive: { name: 'H', version: '1', agents: 0, swarms: 0, awake: 0, beliefs: 3, spent_usd: 0 } }])
    expect(s.hive?.name).toBe('H')
    expect(computeStats(s).beliefs).toBe(3)
  })

  it('upserts agents and records birth and status activity', () => {
    const s = run([
      { type: 'agent.updated', at, agent: agent() },
      { type: 'agent.updated', at, agent: agent({ status: 'asleep' }) },
    ])
    expect(s.agents.a_1.status).toBe('asleep')
    expect(s.activity.map((a) => a.kind)).toEqual(['status', 'birth'])
    expect(computeStats(s)).toMatchObject({ agents: 1, awake: 0, spent: 1 })
  })

  it('is pure', () => {
    const s0 = emptyData()
    const frozen = JSON.stringify(s0)
    reduce(s0, { type: 'agent.updated', at, agent: agent() })
    expect(JSON.stringify(s0)).toBe(frozen)
  })

  it('deduplicates messages by id and keeps them ordered', () => {
    const s = run([
      { type: 'message', at, message: msg({ id: 'm_2', created_at: '2026-10-03T12:00:02Z' }) },
      { type: 'message', at, message: msg({ id: 'm_1', created_at: '2026-10-03T12:00:01Z' }) },
      { type: 'message', at, message: msg({ id: 'm_2', created_at: '2026-10-03T12:00:02Z' }) },
    ])
    expect(s.messages.a_1.map((m) => m.id)).toEqual(['m_1', 'm_2'])
  })

  it('tracks thinking phases and clears them on idle or sleep', () => {
    let s = run([
      { type: 'agent.updated', at, agent: agent() },
      { type: 'agent.thinking', at, agent_id: 'a_1', phase: 'llm' },
    ])
    expect(s.thinking.a_1).toBe('llm')
    s = reduce(s, { type: 'agent.thinking', at, agent_id: 'a_1', phase: 'idle' })
    expect(s.thinking.a_1).toBeUndefined()
    s = run([{ type: 'agent.thinking', at, agent_id: 'a_1', phase: 'skills' }, { type: 'agent.updated', at, agent: agent({ status: 'asleep' }) }], s)
    expect(s.thinking.a_1).toBeUndefined()
  })

  it('stores beliefs per swarm and pulses them', () => {
    const s = run([
      { type: 'belief.published', at, swarm_id: 's_1', assertion: { agent_id: 'a_1', statement: '(--> sky blue)', tv: { f: 1, c: 0.5 }, stamp: ['e'], outcome: 'adopted', created_at: at } },
      { type: 'belief.updated', at, belief: belief() },
      { type: 'belief.updated', at, belief: belief({ tv: { f: 0.7, c: 0.9 } }) },
    ])
    expect(Object.keys(s.beliefs.s_1)).toHaveLength(1)
    expect(s.beliefs.s_1['(--> sky blue)'].tv.f).toBe(0.7)
    expect(Object.keys(s.beliefPulse)).toHaveLength(1)
    expect(s.activity[0].outcome).toBe('adopted')
  })

  it('removes deleted agents from swarms', () => {
    const s = run([
      { type: 'agent.updated', at, agent: agent() },
      { type: 'swarm.updated', at, swarm: { id: 's_1', name: 'S', description: '', hue: 1, member_ids: ['a_1'], created_at: at } },
      { type: 'agent.deleted', at, agent_id: 'a_1' },
    ])
    expect(s.agents.a_1).toBeUndefined()
    expect(s.swarms.s_1.member_ids).toEqual([])
  })

  it('caps the log tail', () => {
    let s = emptyData()
    for (let i = 0; i < LOG_CAP + 50; i++) s = reduce(s, { type: 'log', at, agent_id: 'a_1', line: `l${i}` })
    expect(s.logs.a_1).toHaveLength(LOG_CAP)
    expect(s.logs.a_1.at(-1)).toBe(`l${LOG_CAP + 49}`)
  })
})

// ---------------------------------------------------------------- Phase 2

const approval = (p: Partial<Approval> = {}): Approval => ({
  id: 'p_1', agent_id: 'a_1', skill: 'shell', command: '(shell "ls")', reason: 'human-only', risk: 'high', status: 'pending',
  decided_by: null, created_at: at, decided_at: null, ...p,
})
const goal = (p: Partial<Goal> = {}): Goal => ({
  id: 'g_1', swarm_id: 's_1', parent_id: null, title: 'Ship it', detail: '', priority: 0.5, status: 'open', created_by: 'user:operator',
  claimed_by: null, result: null, created_at: at, updated_at: at, ...p,
})
const trace = (id: number, p: Partial<Trace> = {}): Trace => ({
  id, agent_id: 'a_1', iteration: id, input: null, response: '(query x)', commands: [], llm_ms: 900, tokens: 1200, created_at: at, ...p,
})

describe('reduce · Phase 2', () => {
  it('tracks approvals, the pending count and an activity entry once', () => {
    let s = run([
      { type: 'agent.updated', at, agent: agent() },
      { type: 'approval.created', at, approval: approval() },
      { type: 'approval.created', at, approval: approval({ id: 'p_2', created_at: '2026-10-03T12:01:00Z' }) },
    ])
    expect(countPending(s.approvals)).toBe(2)
    expect(pendingApprovals(s.approvals).map((a) => a.id)).toEqual(['p_2', 'p_1'])
    expect(s.activity[0]).toMatchObject({ kind: 'approval', text: 'asks to run shell' })
    expect(askingByAgent(s.approvals)).toEqual({ a_1: 2 })
    const n = s.activity.length
    s = reduce(s, { type: 'approval.updated', at, approval: approval({ status: 'approved', decided_by: 'user:operator' }) })
    expect(countPending(s.approvals)).toBe(1)
    expect(s.activity.length).toBe(n)
  })

  it('stores policy rules wholesale', () => {
    const rules = [{ id: 'r', scope: 'hive' as const, skill: '*', mode: 'ask' as const, note: '', created_at: at }]
    expect(run([{ type: 'policy.updated', at, rules }]).policy).toEqual(rules)
    expect(emptyData().policy).toBeNull()
  })

  it('moves goals between statuses and counts claimed work per dot', () => {
    const s = run([
      { type: 'goal.updated', at, goal: goal() },
      { type: 'goal.updated', at, goal: goal({ status: 'claimed', claimed_by: 'a_1' }) },
      { type: 'goal.updated', at, goal: goal({ id: 'g_2', parent_id: 'g_1', status: 'claimed', claimed_by: 'a_1' }) },
    ])
    expect(s.goals.g_1.status).toBe('claimed')
    expect(claimedByAgent(s.goals)).toEqual({ a_1: 2 })
    expect(s.activity.filter((a) => a.kind === 'goal')).toHaveLength(2)
    const done = reduce(s, { type: 'goal.updated', at, goal: goal({ status: 'done', claimed_by: 'a_1' }) })
    expect(done.activity[0].text).toBe('finished “Ship it”')
    expect(claimedByAgent(done.goals)).toEqual({ a_1: 1 })
  })

  it('keeps traces unique, ordered and capped', () => {
    let s = run([
      { type: 'agent.trace', at, trace: trace(3) },
      { type: 'agent.trace', at, trace: trace(1) },
      { type: 'agent.trace', at, trace: trace(3, { response: 'updated' }) },
    ])
    expect(s.traces.a_1.map((t) => t.id)).toEqual([1, 3])
    expect(s.traces.a_1[1].response).toBe('updated')
    for (let i = 10; i < TRACE_CAP + 40; i++) s = reduce(s, { type: 'agent.trace', at, trace: trace(i) })
    expect(s.traces.a_1).toHaveLength(TRACE_CAP)
    expect(s.traces.a_1.at(-1)?.id).toBe(TRACE_CAP + 39)
    expect(mergeTraces([trace(5)], [trace(2), trace(5)]).map((t) => t.id)).toEqual([2, 5])
  })

  it('upserts wakeups and records when they fire', () => {
    const w = { id: 'w_1', agent_id: 'a_1', cron: '0 9 * * *', at: null, tz: 'UTC', text: 'hi', enabled: true, next_run_at: null, last_run_at: null }
    const s = run([
      { type: 'agent.updated', at, agent: agent() },
      { type: 'wakeup.updated', at, wakeup: w },
      { type: 'wakeup.updated', at, wakeup: { ...w, enabled: false } },
      { type: 'wakeup.fired', at, wakeup_id: 'w_1', agent_id: 'a_1' },
    ])
    expect(s.wakeups.w_1.enabled).toBe(false)
    expect(s.wakeFired.w_1).toBe(Date.parse(at))
    expect(s.activity[0]).toMatchObject({ kind: 'wakeup', agent_id: 'a_1' })
  })
})
