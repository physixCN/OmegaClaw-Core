import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HiveEvent } from '../types'
import { revise } from './nal'
import { SimClient } from './SimClient'

const make = () => new SimClient({ seed: 42, latency: false, autoStart: false, historyDays: 3 })

afterEach(() => vi.useRealTimers())

describe('NAL revision', () => {
  it('pools evidence: confidence grows and frequency is weighted', () => {
    const r = revise({ f: 1, c: 0.5 }, { f: 0, c: 0.5 })
    expect(r.f).toBeCloseTo(0.5)
    expect(r.c).toBeCloseTo(2 / 3)
    const strong = revise({ f: 0.9, c: 0.9 }, { f: 0.1, c: 0.1 })
    expect(strong.f).toBeGreaterThan(0.8)
    expect(strong.c).toBeGreaterThan(0.9)
  })
})

describe('SimClient', () => {
  it('seeds a believable hive', async () => {
    const sim = make()
    const swarms = await sim.listSwarms()
    const agents = await sim.listAgents()
    expect(swarms.length).toBeGreaterThanOrEqual(2)
    expect(swarms.length).toBeLessThanOrEqual(3)
    expect(agents.length).toBeGreaterThanOrEqual(8)
    expect(agents.length).toBeLessThanOrEqual(14)
    for (const s of swarms) {
      for (const id of s.member_ids) expect(agents.find((a) => a.id === id)?.swarm_id).toBe(s.id)
      expect((await sim.listBeliefs(s.id)).length).toBeGreaterThan(5)
    }
    const hive = await sim.getHive()
    expect(hive.agents).toBe(agents.length)
    expect(hive.spent_usd).toBeGreaterThan(0)
    expect((await sim.getModels()).some((m) => m.local)).toBe(true)
  })

  it('records provenance including a choice', async () => {
    const sim = make()
    const [swarm] = await sim.listSwarms()
    const beliefs = await sim.listBeliefs(swarm.id)
    const details = await Promise.all(beliefs.map((b) => sim.getBeliefDetail(swarm.id, b.statement)))
    expect(details.every((d) => d.assertions.length >= 1 && d.assertions[0].outcome === 'adopted')).toBe(true)
    expect(details.some((d) => d.choices.length > 0)).toBe(true)
  })

  it('applies revision, choice and duplicate outcomes', () => {
    const sim = make()
    const at = new Date().toISOString()
    const a = sim.applyAssertion('s_lyra', 'a_vega01', '(--> test thing)', { f: 1, c: 0.5 }, ['ev:x:1'], at)
    expect(a.assertion.outcome).toBe('adopted')
    const b = sim.applyAssertion('s_lyra', 'a_deneb2', '(--> test thing)', { f: 0, c: 0.5 }, ['ev:y:1'], at)
    expect(b.assertion.outcome).toBe('revised')
    expect(b.belief?.tv.f).toBeCloseTo(0.5, 2)
    expect(b.belief?.sources).toEqual(['a_vega01', 'a_deneb2'])
    const c = sim.applyAssertion('s_lyra', 'a_altr03', '(--> test thing)', { f: 0.2, c: 0.95 }, ['ev:x:1', 'ev:z:9'], at)
    expect(c.assertion.outcome).toBe('chosen')
    const d = sim.applyAssertion('s_lyra', 'a_altr03', '(--> test thing)', { f: 0.9, c: 0.1 }, ['ev:z:9'], at)
    expect(d.assertion.outcome).toBe('duplicate')
    expect(d.belief).toBeNull()
  })

  it('emits a believable stream of events while running', () => {
    vi.useFakeTimers()
    const sim = new SimClient({ seed: 3, latency: false, historyDays: 1 })
    const seen: HiveEvent[] = []
    sim.subscribe((e) => seen.push(e))
    sim.connect()
    vi.advanceTimersByTime(120_000)
    sim.disconnect()
    const types = new Set(seen.map((e) => e.type))
    expect(seen[0].type).toBe('hello')
    for (const t of ['belief.published', 'belief.updated', 'agent.thinking', 'usage', 'log', 'agent.updated'])
      expect(types.has(t as HiveEvent['type'])).toBe(true)
  })

  it('replies to chat and bills usage', async () => {
    vi.useFakeTimers()
    const sim = new SimClient({ seed: 5, latency: false, autoStart: false, historyDays: 1 })
    const seen: HiveEvent[] = []
    sim.subscribe((e) => seen.push(e))
    const before = (await sim.getAgent('a_vega01')).spent_usd
    const sent = await sim.sendMessage('a_vega01', { text: 'What do you believe most?' })
    expect(sent.direction).toBe('in')
    vi.advanceTimersByTime(10_000)
    const reply = seen.find((e) => e.type === 'message' && e.message.direction === 'out')
    expect(reply).toBeDefined()
    expect(seen.some((e) => e.type === 'agent.thinking' && e.phase === 'llm')).toBe(true)
    expect((await sim.getAgent('a_vega01')).spent_usd).toBeGreaterThan(before)
  })

  it('creates a dot that boots to awake and returns a one-time token', async () => {
    vi.useFakeTimers()
    const sim = new SimClient({ seed: 9, latency: false, autoStart: false, historyDays: 1 })
    const created = await sim.createAgent({ name: 'Lumen', kind: 'omega', swarm_id: 's_kelp', model: 'mock/echo', hue: 200 })
    expect(created.token).toMatch(/^hvt_/)
    expect(created.status).toBe('created')
    expect((await sim.getSwarm('s_kelp')).member_ids).toContain(created.id)
    vi.advanceTimersByTime(5000)
    const a = await sim.getAgent(created.id)
    expect(a.status).toBe('awake')
    expect('token' in a).toBe(false)
    await expect(sim.createAgent({ name: 'lumen', kind: 'omega', model: 'mock/echo' })).rejects.toThrow(/exists/)
  })

  it('handles sleep / wake / stop actions', async () => {
    vi.useFakeTimers()
    const sim = new SimClient({ seed: 1, latency: false, autoStart: false, historyDays: 1 })
    expect((await sim.agentAction('a_vega01', 'sleep')).status).toBe('asleep')
    expect((await sim.agentAction('a_vega01', 'wake')).status).toBe('starting')
    vi.advanceTimersByTime(3000)
    expect((await sim.getAgent('a_vega01')).status).toBe('awake')
    expect((await sim.agentAction('a_vega01', 'stop')).status).toBe('stopped')
  })
})
