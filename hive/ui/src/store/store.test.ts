import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { SimClient } from '../api/sim/SimClient'
import { hiveBus, useHive } from './store'

const fresh = () => new SimClient({ seed: 11, latency: false, autoStart: false, historyDays: 1 })

beforeEach(() => {
  vi.useFakeTimers()
  // a minimal window for wantsSim-free code paths that touch it
  vi.stubGlobal('window', { location: { search: '' } })
})
afterEach(() => {
  useHive.getState().client?.disconnect()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('store', () => {
  it('hydrates agents, swarms, models and every commons', async () => {
    const sim = fresh()
    await useHive.getState().init(sim)
    const s = useHive.getState()
    expect(s.ready).toBe(true)
    expect(Object.keys(s.agents).length).toBe(sim.agents.size)
    expect(Object.keys(s.swarms).length).toBe(sim.swarms.size)
    expect(s.models.length).toBeGreaterThan(0)
    for (const id of Object.keys(s.swarms)) expect(s.beliefsLoaded[id]).toBe(true)
  })

  it('applies live events from the client and fans them out to the scene bus', async () => {
    const sim = fresh()
    await useHive.getState().init(sim)
    const seen: string[] = []
    const off = hiveBus.on((e) => seen.push(e.type))
    await sim.agentAction('a_vega01', 'sleep')
    off()
    expect(useHive.getState().agents.a_vega01.status).toBe('asleep')
    expect(seen).toContain('agent.updated')
  })

  it('sends optimistically, then reconciles with the server message', async () => {
    const sim = fresh()
    await useHive.getState().init(sim)
    const p = useHive.getState().sendMessage('a_coral5', 'hello coral')
    expect(useHive.getState().pending.a_coral5).toHaveLength(1)
    expect(useHive.getState().pending.a_coral5[0].status).toBe('sending')
    await p
    const s = useHive.getState()
    expect(s.pending.a_coral5).toHaveLength(0)
    expect(s.messages.a_coral5.filter((m) => m.text === 'hello coral')).toHaveLength(1)
    vi.advanceTimersByTime(10_000)
    expect(useHive.getState().messages.a_coral5.some((m) => m.direction === 'out')).toBe(true)
  })

  it('keeps failed sends with an error and can retry them', async () => {
    const sim = fresh()
    await useHive.getState().init(sim)
    const spy = vi.spyOn(sim, 'sendMessage').mockRejectedValueOnce(new ApiError(503, 'unavailable', 'Hub offline'))
    await useHive.getState().sendMessage('a_anvl09', 'deploy?')
    const failed = useHive.getState().pending.a_anvl09[0]
    expect(failed.status).toBe('failed')
    expect(failed.error).toBe('Hub offline')
    await useHive.getState().retryMessage('a_anvl09', failed.tempId)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(useHive.getState().pending.a_anvl09).toHaveLength(0)
  })

  it('creates a dot, keeps the token out of the store and marks it for birth', async () => {
    const sim = fresh()
    await useHive.getState().init(sim)
    const created = await useHive.getState().createAgent({ name: 'Quill', kind: 'iter', swarm_id: 's_forge', model: 'mock/echo' })
    const s = useHive.getState()
    expect(created.token).toMatch(/^hvt_/)
    expect(s.agents[created.id]).toBeDefined()
    expect('token' in s.agents[created.id]).toBe(false)
    expect(s.focusBirth).toBe(created.id)
  })
})

describe('store · Phase 2', () => {
  it('hydrates approvals and goals, and decides an approval', async () => {
    const sim = fresh()
    await useHive.getState().init(sim)
    let s = useHive.getState()
    expect(s.approvalsLoaded).toBe(true)
    const pending = Object.values(s.approvals).filter((a) => a.status === 'pending')
    expect(pending.length).toBeGreaterThanOrEqual(3)
    for (const id of Object.keys(s.swarms)) expect(s.goalsLoaded[id]).toBe(true)
    const p = useHive.getState().decide(pending[0].id, 'deny')
    expect(useHive.getState().deciding[pending[0].id]).toBe('deny')
    await p
    s = useHive.getState()
    expect(s.approvals[pending[0].id].status).toBe('denied')
    expect(s.deciding[pending[0].id]).toBeUndefined()
  })

  it('patches goals optimistically and rolls back on failure', async () => {
    const sim = fresh()
    await useHive.getState().init(sim)
    const g = Object.values(useHive.getState().goals).find((x) => x.status === 'open')!
    vi.spyOn(sim, 'patchGoal').mockRejectedValueOnce(new ApiError(500, 'boom', 'Nope'))
    const p = useHive.getState().patchGoal(g.id, { status: 'cancelled' })
    expect(useHive.getState().goals[g.id].status).toBe('cancelled')
    await p
    expect(useHive.getState().goals[g.id].status).toBe('open')
    expect(useHive.getState().toasts.at(-1)?.title).toMatch(/goal/)
  })

  it('loads wakeups, toggles them and deletes with rollback', async () => {
    const sim = fresh()
    await useHive.getState().init(sim)
    await useHive.getState().loadWakeups('a_anvl09')
    const ws = Object.values(useHive.getState().wakeups).filter((w) => w.agent_id === 'a_anvl09')
    expect(ws.length).toBeGreaterThan(1)
    const on = ws.find((w) => w.enabled)!
    await useHive.getState().patchWakeup(on.id, { enabled: false })
    expect(useHive.getState().wakeups[on.id]).toMatchObject({ enabled: false, next_run_at: null })
    vi.spyOn(sim, 'deleteWakeup').mockRejectedValueOnce(new ApiError(500, 'boom', 'Nope'))
    await useHive.getState().deleteWakeup(on.id)
    expect(useHive.getState().wakeups[on.id]).toBeDefined()
  })

  it('stops the whole hive', async () => {
    const sim = fresh()
    await useHive.getState().init(sim)
    const n = await useHive.getState().stopAll()
    expect(n).toBeGreaterThan(0)
    vi.advanceTimersByTime(3000)
    expect(Object.values(useHive.getState().agents).every((a) => a.status === 'stopped')).toBe(true)
  })
})
