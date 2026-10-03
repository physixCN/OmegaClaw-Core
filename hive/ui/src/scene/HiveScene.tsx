import { AnimatePresence, m } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ago, modelLabel, money } from '../lib/format'
import { SimChip } from '../ui/SimChip'
import { useFinePointer, useNow, useReducedMotion } from '../lib/hooks'
import { navigate, useRoute } from '../lib/router'
import { describeLlmError } from '../lib/llmErrors'
import { askingByAgent } from '../store/reducer'
import { hiveBus, useHive } from '../store/store'
import { Icon } from '../ui/Icon'
import { Orb, StatusPill } from '../ui/primitives'
import { HiveEngine, type HitTarget } from './engine'
import { combineInsets, useScene } from './sceneStore'

/** The full-bleed living hive. Owns the engine and bridges store ⇄ canvas. */
export function HiveScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<HiveEngine | null>(null)
  const reduced = useReducedMotion()
  const fine = useFinePointer()
  const route = useRoute()
  const [hover, setHover] = useState<HitTarget | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const setEngine = useScene((s) => s.setEngine)
  const insetSources = useScene((s) => s.insetSources)
  const chatAnchor = useScene((s) => s.chatAnchor)
  const dimmed = useScene((s) => s.dimmed)
  const ready = useHive((s) => s.ready)
  const fitted = useRef(false)
  const pinnedRef = useRef<string | null>(null)
  useEffect(() => {
    pinnedRef.current = pinned
  }, [pinned])

  const selectedId = route.name === 'dot' ? route.id : null

  // create engine once
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let engine: HiveEngine
    try {
      engine = new HiveEngine(
        canvas,
        {
          onHover: (t) => setHover(t),
          onTap: (t, pointerType) => {
            if (!t) {
              setPinned(null)
              return
            }
            if (t.kind === 'core') {
              navigate({ name: 'swarm', id: t.id })
              return
            }
            // Touch: first tap shows the card, second tap (or the card) opens the panel.
            if (pointerType !== 'mouse') {
              if (pinnedRef.current === t.id) {
                setPinned(null)
                navigate({ name: 'dot', id: t.id })
              } else {
                setPinned(t.id)
              }
              return
            }
            navigate({ name: 'dot', id: t.id })
          },
          onUserCamera: () => undefined,
        },
        { reducedMotion: reduced },
      )
    } catch {
      return
    }
    engineRef.current = engine
    setEngine(engine)
    // read-only hook for automated UI checks (screenshots, perf)
    window.__hiveScene = { screenPos: (id: string) => engine.screenPos(id), focus: (id: string) => engine.flyToDot(id) }
    engine.start()
    const ro = new ResizeObserver(() => engine.resize())
    ro.observe(canvas)
    const off = hiveBus.on((e) => engine.handleEvent(e))
    // sync store → engine without re-rendering React
    const push = () => {
      const s = useHive.getState()
      const claims: Record<string, string | null> = {}
      for (const g of Object.values(s.goals)) claims[g.id] = g.status === 'claimed' || g.status === 'waiting' ? g.claimed_by : null
      engine.setData({
        agents: Object.values(s.agents),
        swarms: Object.values(s.swarms),
        thinking: s.thinking,
        beliefs: s.beliefs,
        claims,
        asking: askingByAgent(s.approvals),
      })
    }
    push()
    const unsub = useHive.subscribe((s, p) => {
      if (s.agents !== p.agents || s.swarms !== p.swarms || s.thinking !== p.thinking || s.beliefs !== p.beliefs || s.goals !== p.goals || s.approvals !== p.approvals) push()
    })
    return () => {
      unsub()
      off()
      ro.disconnect()
      engine.destroy()
      delete window.__hiveScene
      engineRef.current = null
      setEngine(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => engineRef.current?.setReducedMotion(reduced), [reduced])
  useEffect(() => engineRef.current?.setDimmed(dimmed), [dimmed])
  useEffect(() => engineRef.current?.setChatAnchor(chatAnchor), [chatAnchor])

  const insets = useMemo(() => combineInsets(insetSources), [insetSources])
  useEffect(() => engineRef.current?.setInsets(insets), [insets])

  // first fit once data is in
  useEffect(() => {
    const e = engineRef.current
    if (!e || !ready || fitted.current) return
    fitted.current = true
    requestAnimationFrame(() => e.overview(true))
  }, [ready])

  // selection follows the route
  useEffect(() => {
    const e = engineRef.current
    if (!e) return
    e.setSelected(selectedId, true)
    if (!selectedId && route.name === 'hive' && fitted.current) e.overview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const cardId = (hover?.kind === 'dot' ? hover.id : null) ?? pinned
  const showCard = cardId && cardId !== selectedId && route.name === 'hive'

  useEffect(() => {
    const e = engineRef.current
    const el = cardRef.current
    if (!e || !el) return
    e.track(el, showCard ? cardId : null)
    return () => e.track(el, null)
  }, [cardId, showCard])

  const coreHover = hover?.kind === 'core' ? hover.id : null

  return (
    <div className="fixed inset-0" aria-label="The hive" role="region">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none select-none"
        style={{ cursor: 'grab' }}
        aria-label="Living view of every dot and swarm. Use the dot list or command palette for keyboard navigation."
        role="img"
      />
      <div ref={cardRef} className="pointer-events-none absolute top-0 left-0 z-10" style={{ willChange: 'transform' }}>
        <AnimatePresence>{showCard && <DotCard key={cardId} id={cardId} touch={!fine} />}</AnimatePresence>
      </div>
      <AnimatePresence>{coreHover && <CoreTip key={coreHover} id={coreHover} />}</AnimatePresence>
    </div>
  )
}

function DotCard({ id, touch }: { id: string; touch: boolean }) {
  const agent = useHive((s) => s.agents[id])
  const thinking = useHive((s) => s.thinking[id])
  const swarm = useHive((s) => (agent?.swarm_id ? s.swarms[agent.swarm_id] : undefined))
  const now = useNow(5000)
  if (!agent) return null
  return (
    <m.div
      initial={{ opacity: 0, y: 6, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.96, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 520, damping: 32 }}
      className="glass-strong pointer-events-auto absolute left-0 w-[252px] -translate-x-1/2 rounded-2xl p-3"
      style={{ top: 22 }}
    >
      <div className="flex items-center gap-2.5">
        <Orb hue={agent.hue} status={agent.status} thinking={thinking} size={30} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[15px] font-semibold leading-tight">{agent.name}</div>
          <div className="truncate text-[11px] text-ink-3">
            {agent.kind} · {swarm?.name ?? 'wanderer'}
          </div>
        </div>
        <StatusPill status={agent.status} thinking={thinking} />
      </div>
      <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <div className="col-span-2 flex items-baseline justify-between gap-2">
          <dt className="text-ink-4">Model</dt>
          <dd className="truncate font-mono text-ink-2">{modelLabel(agent.model)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="flex items-center gap-1 text-ink-4">
            Spend <SimChip />
          </dt>
          <dd className="font-mono text-ink-2">{money(agent.spent_usd)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-ink-4">Active</dt>
          <dd className="text-ink-2">{ago(agent.last_active_at, now)}</dd>
        </div>
      </dl>
      {agent.last_error && (
        <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-bad/10 px-2 py-1 text-[11px] text-bad">
          <Icon name="alert" size={12} className="shrink-0" />
          <span className="truncate">{describeLlmError(agent.last_error)?.title}</span>
        </div>
      )}
      {touch && (
        <button
          onClick={() => navigate({ name: 'dot', id })}
          className="mt-2.5 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-white/[0.08] text-[13px] font-medium text-ink"
        >
          Open {agent.name} <Icon name="chevron" size={16} />
        </button>
      )}
    </m.div>
  )
}

function CoreTip({ id }: { id: string }) {
  const swarm = useHive((s) => s.swarms[id])
  const count = useHive((s) => Object.keys(s.beliefs[id] ?? {}).length)
  if (!swarm) return null
  return (
    <m.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="glass pointer-events-none fixed bottom-24 left-1/2 z-10 -translate-x-1/2 rounded-2xl px-4 py-2.5 text-center"
    >
      <div className="font-display text-sm font-semibold">{swarm.name}</div>
      <div className="text-xs text-ink-3">
        {count} beliefs · {swarm.member_ids.length} dots · click to open the commons
      </div>
    </m.div>
  )
}
