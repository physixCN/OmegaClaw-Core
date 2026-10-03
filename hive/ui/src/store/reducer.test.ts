import { describe, expect, it } from 'vitest'
import type { Agent, Belief, HiveEvent, Message } from '../api/types'
import { computeStats, emptyData, LOG_CAP, reduce, type HiveData } from './reducer'

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
