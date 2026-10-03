import { AnimatePresence, m } from 'framer-motion'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Agent, AgentAction, ModelOption } from '../../api/types'
import { hsl } from '../../lib/color'
import { money } from '../../lib/format'
import { useIsDesktop } from '../../lib/hooks'
import { navigate, type DotTab } from '../../lib/router'
import { useScene } from '../../scene/sceneStore'
import { useHive } from '../../store/store'
import { Icon, type IconName } from '../../ui/Icon'
import { Button, EmptyState, IconButton, Meter, Orb, Segmented, StatusPill } from '../../ui/primitives'
import { cx } from '../../lib/cx'
import { Sheet } from '../../ui/Sheet'
import { describeLlmError } from '../../lib/llmErrors'
import { Chat } from './Chat'
import { MemoryInspector } from './MemoryInspector'
import { MindTimeline } from './MindTimeline'
import { Schedule } from './Schedule'

type Tab = DotTab

const TAB_ORDER: Tab[] = ['chat', 'mind', 'memory', 'schedule', 'model']

export default function DotPanel({ id, tab: routeTab }: { id: string; tab?: DotTab }) {
  const agent = useHive((s) => s.agents[id])
  const ready = useHive((s) => s.ready)
  const close = () => navigate({ name: 'hive' })
  const tab: Tab = routeTab ?? 'chat'
  const setTab = (t: Tab) => navigate({ name: 'dot', id, tab: t }, { replace: true })
  // slide direction follows the tab order
  const [prevTab, setPrevTab] = useState(tab)
  const [dir, setDir] = useState(1)
  if (prevTab !== tab) {
    setDir(TAB_ORDER.indexOf(tab) > TAB_ORDER.indexOf(prevTab) ? 1 : -1)
    setPrevTab(tab)
  }
  const bodyRef = useRef<HTMLDivElement>(null)
  const desktop = useIsDesktop()
  const setAnchor = useScene((s) => s.setChatAnchor)
  const loadWakeups = useHive((s) => s.loadWakeups)
  useEffect(() => {
    loadWakeups(id).catch(() => undefined)
  }, [id, loadWakeups])

  // tell the scene where "the chat" is so message light can fly to it
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const report = () => {
      const r = el.getBoundingClientRect()
      setAnchor(desktop ? { x: r.left - 6, y: r.top + r.height * 0.7 } : { x: window.innerWidth / 2, y: r.top - 4 })
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    const t = setInterval(report, 600)
    return () => {
      ro.disconnect()
      clearInterval(t)
      setAnchor(null)
    }
  }, [desktop, setAnchor])

  if (!agent) {
    return (
      <Sheet label="Dot" onClose={close}>
        <div ref={bodyRef} className="flex flex-1 items-center justify-center">
          {ready ? (
            <EmptyState icon="alert" title="This dot is gone" body="It may have been deleted. Its memory is kept on disk." action={<Button onClick={close}>Back to the hive</Button>} />
          ) : (
            <div className="eyebrow animate-pulse">Finding dot…</div>
          )}
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet label={`${agent.name} panel`} onClose={close} header={<PanelHeader agent={agent} onClose={close} tab={tab} setTab={setTab} />} initialSnap={desktop ? 'full' : 'peek'} peekHeight="66dvh">
      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <m.div
            key={tab}
            custom={dir}
            className={cx('flex min-h-0 flex-1 flex-col', tab !== 'chat' && tab !== 'mind' && 'thin-scroll overflow-y-auto')}
            variants={{ in: (d: number) => ({ opacity: 0, x: 14 * d }), on: { opacity: 1, x: 0 }, out: (d: number) => ({ opacity: 0, x: -14 * d }) }}
            initial="in"
            animate="on"
            exit="out"
            transition={{ duration: 0.16 }}
          >
            {tab === 'chat' ? (
              <Chat key={agent.id} agent={agent} />
            ) : tab === 'mind' ? (
              <MindTimeline key={agent.id} agent={agent} />
            ) : tab === 'memory' ? (
              <MemoryInspector key={agent.id} agent={agent} />
            ) : tab === 'schedule' ? (
              <Schedule key={agent.id} agent={agent} />
            ) : (
              <ModelSettings key={agent.id} agent={agent} />
            )}
          </m.div>
        </AnimatePresence>
        <LogTail agent={agent} />
      </div>
    </Sheet>
  )
}

function PanelHeader({ agent, onClose, tab, setTab }: { agent: Agent; onClose: () => void; tab: Tab; setTab: (t: Tab) => void }) {
  const thinking = useHive((s) => s.thinking[agent.id])
  const wakeups = useHive((s) => {
    let n = 0
    for (const w of Object.values(s.wakeups)) if (w.agent_id === agent.id && w.enabled) n++
    return n
  })
  const swarm = useHive((s) => (agent.swarm_id ? s.swarms[agent.swarm_id] : undefined))
  return (
    <div className="relative shrink-0 px-4 pt-1 md:pt-4">
      <div className="pointer-events-none absolute inset-x-0 -top-10 h-40 opacity-70" style={{ background: `radial-gradient(60% 100% at 20% 0%, ${hsl(agent.hue, 90, 55, 0.28)}, transparent)` }} />
      <div className="relative flex items-center gap-3">
        <Orb hue={agent.hue} status={agent.status} thinking={thinking} size={42} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-display text-[20px] leading-tight font-semibold tracking-tight">{agent.name}</h2>
            <StatusPill status={agent.status} thinking={thinking} />
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-x-1.5 overflow-hidden text-[12px] whitespace-nowrap text-ink-3">
            <span className="capitalize">{agent.kind}</span>
            <span aria-hidden="true">·</span>
            {swarm ? (
              <button onClick={() => navigate({ name: 'swarm', id: swarm.id })} className="inline-flex min-h-6 items-center gap-1 text-ink-2 hover:text-ink">
                <span className="size-1.5 rounded-full" style={{ background: hsl(swarm.hue, 90, 65) }} />
                {swarm.name}
              </button>
            ) : (
              <span>wanderer</span>
            )}
            <span aria-hidden="true">·</span>
            <span className="truncate font-mono text-[11px]">{agent.model}</span>
          </div>
        </div>
        <IconButton icon="x" label="Close panel" onClick={onClose} className="-mr-2" />
      </div>
      <div className="mt-3 flex items-stretch gap-2">
        <Controls agent={agent} />
        <Budget agent={agent} />
      </div>
      <AnimatePresence initial={false}>{agent.last_error && <LastError key="err" agent={agent} onFix={() => setTab('model')} />}</AnimatePresence>
      <Segmented<Tab>
        dense
        label="Panel section"
        value={tab}
        onChange={setTab}
        className="mt-2.5 mb-1.5 w-full"
        options={[
          { value: 'chat', label: 'Chat' },
          {
            value: 'mind',
            label: 'Mind',
            badge: thinking && thinking !== 'idle' ? <span className="size-1.5 animate-pulse rounded-full" style={{ background: hsl(thinking === 'skills' ? agent.hue + 55 : agent.hue, 100, 72), boxShadow: `0 0 6px ${hsl(agent.hue, 100, 65)}` }} aria-label="thinking" /> : undefined,
          },
          { value: 'memory', label: 'Memory' },
          { value: 'schedule', label: 'Schedule', badge: wakeups ? <span className="font-mono text-[10px] text-ink-4">{wakeups}</span> : undefined },
          { value: 'model', label: 'Model' },
        ]}
      />
    </div>
  )
}

const ACTIONS: Record<AgentAction, { label: string; icon: IconName }> = {
  start: { label: 'Start', icon: 'play' },
  wake: { label: 'Wake', icon: 'sun' },
  sleep: { label: 'Sleep', icon: 'moon' },
  stop: { label: 'Stop', icon: 'stop' },
}

function Controls({ agent }: { agent: Agent }) {
  const act = useHive((s) => s.agentAction)
  const [busy, setBusy] = useState<AgentAction | null>(null)
  const available: AgentAction[] =
    agent.status === 'awake'
      ? ['sleep', 'stop']
      : agent.status === 'asleep'
        ? ['wake', 'stop']
        : agent.status === 'starting'
          ? ['stop']
          : ['start']
  const run = async (a: AgentAction) => {
    setBusy(a)
    await act(agent.id, a)
    setBusy(null)
  }
  return (
    <div className="flex shrink-0 gap-1.5" role="group" aria-label="Status controls">
      {available.map((a, i) => (
        <Button key={a} variant={i === 0 ? 'primary' : 'subtle'} hue={agent.hue} icon={ACTIONS[a].icon} onClick={() => run(a)} disabled={!!busy} className="px-3.5" aria-label={`${ACTIONS[a].label} ${agent.name}`}>
          {busy === a ? '…' : ACTIONS[a].label}
        </Button>
      ))}
    </div>
  )
}

/** Why the dot is unwell: gateway refusals (402 / 429) get a plain-language title and a fix. */
function LastError({ agent, onFix }: { agent: Agent; onFix: () => void }) {
  const info = describeLlmError(agent.last_error)
  if (!info) return null
  const budgetish = info.code === 'no_budget' || info.code === 'budget_exhausted' || info.code === 'unpriced_model'
  const tone = info.code === 'rate_limited' ? '#fbbf24' : '#fb7185'
  return (
    <m.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
      <div role="status" className="mt-2 flex items-start gap-2.5 rounded-xl border px-3 py-2" style={{ borderColor: `${tone}40`, background: `${tone}0f` }}>
        <Icon name={info.code === 'rate_limited' ? 'clock' : 'alert'} size={16} className="mt-0.5 shrink-0" style={{ color: tone }} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[13px] font-semibold" style={{ color: tone }}>
              {info.title}
            </span>
            {info.status && (
              <code className="font-mono text-[10.5px] text-ink-4">
                {info.status} {info.code}
              </code>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-3" title={agent.last_error ?? undefined}>
            {info.hint}
          </p>
        </div>
        {budgetish && (
          <button onClick={onFix} className="shrink-0 self-center rounded-lg px-2 py-1.5 text-[12px] font-semibold text-ink hover:bg-white/[0.07]">
            {info.code === 'unpriced_model' ? 'Change model' : 'Fix budget'}
          </button>
        )}
      </div>
    </m.div>
  )
}

function Budget({ agent }: { agent: Agent }) {
  const unlimited = agent.budget_usd <= 0
  const pct = unlimited ? 0 : agent.spent_usd / agent.budget_usd
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center rounded-xl border border-line bg-white/[0.025] px-3 py-1.5">
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[11px] whitespace-nowrap">
        <span className="flex items-center gap-1 text-ink-3">
          Budget
          {!unlimited && pct > 0.85 && (
            <span className="inline-flex items-center gap-0.5 text-warn">
              <Icon name="alert" size={11} /> {Math.round(pct * 100)}%
            </span>
          )}
        </span>
        <span className="truncate font-mono text-ink-3">
          <span className="text-ink">{money(agent.spent_usd)}</span>
          {unlimited ? ' · ∞' : ` / ${money(agent.budget_usd)}`}
        </span>
      </div>
      <Meter value={agent.spent_usd} max={agent.budget_usd} hue={agent.hue} label={`${agent.name} budget used`} />
    </div>
  )
}

function ModelSettings({ agent }: { agent: Agent }) {
  const models = useHive((s) => s.models)
  const patch = useHive((s) => s.patchAgent)
  const toast = useHive((s) => s.toast)
  const client = useHive((s) => s.client)
  const [persona, setPersona] = useState(agent.persona)
  const [budget, setBudget] = useState(String(agent.budget_usd))
  const [hue, setHue] = useState(agent.hue)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)


  const grouped = useMemo(() => {
    const m = new Map<string, ModelOption[]>()
    for (const o of models) {
      if (!m.has(o.provider)) m.set(o.provider, [])
      m.get(o.provider)!.push(o)
    }
    return [...m.entries()]
  }, [models])

  const dirty = persona !== agent.persona
  const savePersona = async () => {
    setSaving(true)
    const ok = await patch(agent.id, { persona })
    setSaving(false)
    if (ok) toast({ tone: 'success', title: 'Persona saved', body: `${agent.name} will use it from the next turn.` })
  }

  return (
    <div className="space-y-6 px-4 pt-2 pb-6">
      <section aria-labelledby="model-h">
        <h3 id="model-h" className="eyebrow mb-2">Model</h3>
        {models.length === 0 ? (
          <div className="text-sm text-ink-3">No models available.</div>
        ) : (
          <div role="radiogroup" aria-labelledby="model-h" className="space-y-3">
            {grouped.map(([provider, list]) => (
              <div key={provider}>
                <div className="mb-1 px-1 text-[11px] text-ink-4 capitalize">{provider}</div>
                <div className="overflow-hidden rounded-xl border border-line">
                  {list.map((m, i) => {
                    const on = m.id === agent.model
                    return (
                      <button
                        key={m.id}
                        role="radio"
                        aria-checked={on}
                        onClick={async () => {
                          if (on) return
                          const ok = await patch(agent.id, { model: m.id })
                          if (ok) toast({ tone: 'success', title: `${agent.name} now runs on ${m.label}` })
                        }}
                        className={cx('flex min-h-12 w-full items-center gap-3 px-3 text-left transition-colors', i > 0 && 'border-t border-line', on ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]')}
                      >
                        <span className={cx('flex size-4 items-center justify-center rounded-full border', on ? 'border-transparent' : 'border-line-2')} style={on ? { background: hsl(agent.hue, 100, 75), boxShadow: `0 0 10px ${hsl(agent.hue, 100, 65, 0.7)}` } : undefined}>
                          {on && <span className="size-1.5 rounded-full bg-[#0b0820]" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-ink">{m.label}</span>
                          <span className="block truncate font-mono text-[11px] text-ink-4">{m.id}</span>
                        </span>
                        {m.local && <span className="rounded-md border border-good/30 bg-good/10 px-1.5 py-0.5 text-[10px] font-medium text-good">local</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="persona-h">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 id="persona-h" className="eyebrow">Persona</h3>
          <span className="text-[11px] text-ink-4 tabular-nums">{persona.length} chars</span>
        </div>
        <textarea
          aria-labelledby="persona-h"
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          rows={6}
          className="thin-scroll w-full resize-y rounded-xl border border-line bg-black/25 p-3 text-[14px] leading-relaxed text-ink outline-none focus:border-line-2"
        />
        <AnimatePresence>
          {dirty && (
            <m.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex justify-end gap-2 overflow-hidden pt-2">
              <Button variant="ghost" onClick={() => setPersona(agent.persona)}>
                Revert
              </Button>
              <Button variant="primary" hue={agent.hue} onClick={savePersona} disabled={saving}>
                {saving ? 'Saving…' : 'Save persona'}
              </Button>
            </m.div>
          )}
        </AnimatePresence>
      </section>

      <section aria-labelledby="hue-h">
        <h3 id="hue-h" className="eyebrow mb-2">Colour</h3>
        <div className="flex items-center gap-3">
          <Orb hue={hue} size={36} />
          <input
            type="range"
            min={0}
            max={359}
            value={hue}
            aria-labelledby="hue-h"
            onChange={(e) => setHue(Number(e.target.value))}
            onPointerUp={() => hue !== agent.hue && patch(agent.id, { hue })}
            onKeyUp={() => hue !== agent.hue && patch(agent.id, { hue })}
            className="hue-range flex-1"
          />
        </div>
      </section>

      <section aria-labelledby="budget-h">
        <h3 id="budget-h" className="eyebrow mb-2">Budget cap</h3>
        <div className="flex items-center gap-2">
          <div className="flex min-h-11 flex-1 items-center rounded-xl border border-line bg-black/25 px-3 focus-within:border-line-2">
            <span className="text-ink-3">$</span>
            <input
              inputMode="decimal"
              aria-labelledby="budget-h"
              value={budget}
              onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ''))}
              className="w-full bg-transparent px-1.5 font-mono text-ink outline-none"
            />
          </div>
          <Button
            disabled={Number(budget) === agent.budget_usd || Number.isNaN(Number(budget))}
            onClick={async () => {
              const ok = await patch(agent.id, { budget_usd: Number(budget) })
              if (ok) toast({ tone: 'success', title: 'Budget updated' })
            }}
          >
            Save
          </Button>
        </div>
        <p className="mt-1.5 text-[12px] text-ink-4">
          0 means unlimited for local models; a paid model with a $0 cap is refused (402 no_budget). The gateway checks each call’s worst-case cost against the cap before it runs.
        </p>
      </section>

      <section className="rounded-xl border border-bad/20 bg-bad/[0.04] p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Delete {agent.name}</div>
            <div className="text-[12px] text-ink-3">Stops the dot. Memory stays on disk.</div>
          </div>
          {confirmDelete ? (
            <div className="flex gap-1.5">
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  try {
                    await client?.deleteAgent(agent.id)
                    toast({ tone: 'info', title: `${agent.name} was released` })
                    navigate({ name: 'hive' })
                  } catch (e) {
                    toast({ tone: 'error', title: 'Could not delete', body: e instanceof Error ? e.message : undefined })
                  }
                }}
              >
                Delete
              </Button>
            </div>
          ) : (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete…
            </Button>
          )}
        </div>
      </section>
    </div>
  )
}

const EMPTY: string[] = []

function LogTail({ agent }: { agent: Agent }) {
  const lines = useHive((s) => s.logs[agent.id] ?? EMPTY)
  const loaded = useHive((s) => !!s.logsLoaded[agent.id])
  const loadLogs = useHive((s) => s.loadLogs)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    if (!loaded) loadLogs(agent.id).catch(() => undefined)
  }, [agent.id, loaded, loadLogs])

  useLayoutEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [lines.length, open])

  const last = lines[lines.length - 1]
  return (
    <div className="shrink-0 border-t border-line bg-black/20">
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={`log-${agent.id}`} className="flex min-h-11 w-full items-center gap-2 px-4 text-left">
        <Icon name="terminal" size={15} className="shrink-0 text-ink-3" />
        <span className="eyebrow shrink-0">Live log</span>
        {!open && last && (
          <m.span key={last} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-3">
            {last}
          </m.span>
        )}
        <Icon name="chevronDown" size={16} className={cx('ml-auto shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <m.div id={`log-${agent.id}`} initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 40 }} className="overflow-hidden">
            <div
              ref={ref}
              onScroll={() => {
                const el = ref.current
                if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
              }}
              className="thin-scroll max-h-[34dvh] overflow-y-auto px-4 pb-3 font-mono text-[11px] leading-[1.7]"
              role="log"
              aria-label={`${agent.name} log`}
            >
              {lines.length === 0 ? (
                <div className="text-ink-4">{loaded ? 'No log lines yet.' : 'Loading…'}</div>
              ) : (
                lines.map((l, i) => <LogLine key={i} line={l} />)
              )}
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function LogLine({ line }: { line: string }) {
  const m = /^(\S+)\s+(INFO|WARN|ERROR|DEBUG)\s+(\S+:)?(.*)$/.exec(line)
  if (!m) return <div className="break-all whitespace-pre-wrap text-ink-3">{line}</div>
  const [, ts, level, src, rest] = m
  return (
    <div className="break-all whitespace-pre-wrap">
      <span className="text-ink-4">{ts} </span>
      <span className={level === 'ERROR' ? 'text-bad' : level === 'WARN' ? 'text-warn' : 'text-[#7dd3fc]/70'}>{level.padEnd(5)} </span>
      {src && <span className="text-[#c4b5fd]">{src}</span>}
      <span className={level === 'ERROR' ? 'text-bad/90' : 'text-ink-2'}>{rest}</span>
    </div>
  )
}
