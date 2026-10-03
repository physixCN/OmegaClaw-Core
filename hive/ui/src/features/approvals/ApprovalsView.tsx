import { AnimatePresence, m } from 'framer-motion'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { Agent, Approval, ApprovalStatus } from '../../api/types'
import { hsl } from '../../lib/color'
import { cx } from '../../lib/cx'
import { ago } from '../../lib/format'
import { copyText, useIsDesktop, useNow, useReducedMotion } from '../../lib/hooks'
import { navigate, useRoute, type ApprovalsTab } from '../../lib/router'
import { countPending } from '../../store/reducer'
import { useHive, type Decision } from '../../store/store'
import { Icon, type IconName } from '../../ui/Icon'
import { MeTTa } from '../../ui/MeTTa'
import { Page } from '../../ui/Page'
import { Button, EmptyState, IconButton, Orb, RiskChip, Segmented, Skeleton } from '../../ui/primitives'

const PolicyEditor = lazy(() => import('./PolicyEditor'))

export default function ApprovalsView() {
  const route = useRoute()
  const tab: ApprovalsTab = (route.name === 'approvals' && route.tab) || 'pending'
  const focus = route.name === 'approvals' ? route.focus : undefined
  const pending = useHive((s) => countPending(s.approvals))
  const loaded = useHive((s) => s.approvalsLoaded)
  const load = useHive((s) => s.loadApprovals)

  useEffect(() => {
    load().catch(() => undefined)
  }, [load])

  return (
    <Page label="Approvals" eyebrow="Policy gate" title="Approvals" onClose={() => navigate({ name: 'hive' })} info={tab === 'rules' ? 'policy' : 'approvals'}>
      <div className="w-full max-w-[1220px] px-3 pb-[calc(var(--sab)+96px)] md:px-6 md:pb-10">
        <div className="sticky top-0 z-[2] -mx-3 bg-[#0a0a1f] px-3 pt-1 pb-3 shadow-[0_14px_18px_-6px_#0a0a1f] md:-mx-6 md:bg-[#090920] md:px-6 md:shadow-[0_14px_18px_-6px_#090920]">
          <Segmented<ApprovalsTab>
            label="Approvals section"
            tour="approvals-tab"
            value={tab}
            onChange={(t) => navigate({ name: 'approvals', tab: t }, { replace: true })}
            className="w-full md:w-auto"
            options={[
              { value: 'pending', label: pending ? `Pending · ${pending}` : 'Pending' },
              { value: 'history', label: 'History' },
              { value: 'rules', label: 'Rules' },
            ]}
          />
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <m.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
            {!loaded && tab !== 'rules' ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-48 w-full rounded-[22px]" />
                ))}
              </div>
            ) : tab === 'pending' ? (
              <Pending focus={focus} />
            ) : tab === 'history' ? (
              <History />
            ) : (
              <Suspense fallback={<Skeleton className="h-64 w-full rounded-[22px]" />}>
                <PolicyEditor />
              </Suspense>
            )}
          </m.div>
        </AnimatePresence>
      </div>
    </Page>
  )
}

// ---------------------------------------------------------------- pending

const STAMP_MS = 900

function Pending({ focus }: { focus?: string }) {
  const approvals = useHive((s) => s.approvals)
  const agents = useHive((s) => s.agents)
  const desktop = useIsDesktop()
  // decided in this view: they stay for a beat to show the stamp, then leave
  const [stamped, setStamped] = useState<Record<string, Decision>>({})
  const list = useMemo(
    () => Object.values(approvals).filter((a) => a.status === 'pending' || stamped[a.id]).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [approvals, stamped],
  )
  const onDecided = (id: string, d: Decision) => {
    setStamped((s) => ({ ...s, [id]: d }))
    setTimeout(() => setStamped((s) => {
      const next = { ...s }
      delete next[id]
      return next
    }), STAMP_MS)
  }
  const byRisk = useMemo(() => {
    const out = { high: 0, medium: 0, low: 0 }
    for (const a of list) if (a.status === 'pending') out[a.risk]++
    return out
  }, [list])

  const cards = (
    <ul className="space-y-3" aria-label="Pending approvals">
      <AnimatePresence initial={false}>
        {list.map((a) => (
          <ApprovalCard key={a.id} approval={a} agent={agents[a.agent_id]} stamp={stamped[a.id]} focused={focus === a.id} onDecided={onDecided} />
        ))}
      </AnimatePresence>
      {list.length === 0 && (
        <m.li initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-[22px] border border-line bg-white/[0.02]">
          <EmptyState icon="shield" title="Nothing is waiting" body="When a dot reaches for a skill that needs a human, it lands here and the dot pauses on that command." />
        </m.li>
      )}
    </ul>
  )
  if (!desktop) return cards
  return (
    <div className="grid grid-cols-[1fr_300px] gap-6">
      {cards}
      <aside className="sticky top-16 space-y-3 self-start">
        <div className="rounded-[20px] border border-line bg-white/[0.025] p-4">
          <div className="eyebrow mb-3">Waiting by risk</div>
          {(['high', 'medium', 'low'] as const).map((r) => (
            <div key={r} className="flex min-h-9 items-center justify-between">
              <RiskChip risk={r} />
              <span className="font-display text-lg font-semibold tabular-nums">{byRisk[r]}</span>
            </div>
          ))}
        </div>
        <div className="rounded-[20px] border border-line bg-white/[0.025] p-4 text-[13px] leading-relaxed text-ink-3">
          <div className="eyebrow mb-2">What happens next</div>
          <p>
            <b className="font-medium text-ink-2">Approve</b> lets the dot run that exact command once. It hears{' '}
            <code className="rounded bg-black/30 px-1 font-mono text-[11px] text-ink-2">[APPROVED p_…]</code> on its next loop.
          </p>
          <p className="mt-2">
            <b className="font-medium text-ink-2">Always allow</b> also adds an <span className="text-good">allow</span> rule for that dot and skill.
          </p>
          <button onClick={() => navigate({ name: 'approvals', tab: 'rules' })} className="mt-3 inline-flex min-h-9 items-center gap-1 font-medium text-accent hover:text-ink">
            Edit policy rules <Icon name="chevron" size={14} />
          </button>
        </div>
      </aside>
    </div>
  )
}

const DECISION: Record<Decision, { label: string; color: string; icon: 'check' | 'x' }> = {
  approve: { label: 'Approved', color: '#4ade80', icon: 'check' },
  remember: { label: 'Approved · always allowed', color: '#4ade80', icon: 'check' },
  deny: { label: 'Denied', color: '#fb7185', icon: 'x' },
}

function ApprovalCard({
  approval: a,
  agent,
  stamp,
  focused,
  onDecided,
}: {
  approval: Approval
  agent: Agent | undefined
  stamp?: Decision
  focused: boolean
  onDecided: (id: string, d: Decision) => void
}) {
  const decide = useHive((s) => s.decide)
  const deciding = useHive((s) => s.deciding[a.id])
  const swarm = useHive((s) => (agent?.swarm_id ? s.swarms[agent.swarm_id] : undefined))
  const toast = useHive((s) => s.toast)
  const desktop = useIsDesktop()
  const reduced = useReducedMotion()
  const now = useNow(10_000)
  const ref = useRef<HTMLLIElement>(null)
  const hue = agent?.hue ?? 252
  const name = agent?.name ?? a.agent_id

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
  }, [focused, reduced])

  const run = async (d: Decision) => {
    const res = await decide(a.id, d)
    if (res) onDecided(a.id, d)
  }
  const shown = stamp ?? null
  const dir = shown === 'deny' ? -1 : 1
  const busy = !!deciding || !!shown

  return (
    <m.li
      ref={ref}
      layout={!reduced}
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: reduced ? 0 : dir * 36, height: 0, marginTop: 0, transition: { duration: 0.32, ease: [0.4, 0, 0.2, 1] } }}
      transition={{ type: 'spring', stiffness: 380, damping: 34 }}
      className="relative"
    >
      <article
        aria-label={`${name} asks to run ${a.skill}`}
        data-tour="approval-card"
        className={cx('relative overflow-hidden rounded-[22px] border bg-white/[0.025] transition-[border-color,box-shadow] duration-300', focused ? 'border-warn/50' : 'border-line')}
        style={{
          borderColor: shown ? `${DECISION[shown].color}88` : undefined,
          boxShadow: focused && !shown ? '0 0 0 4px rgb(251 191 36 / 0.12), 0 0 40px -10px rgb(251 191 36 / 0.5)' : undefined,
        }}
      >
        <div className="pointer-events-none absolute -top-16 -left-10 size-56 rounded-full opacity-70" style={{ background: `radial-gradient(circle, ${hsl(hue, 90, 55, 0.22)}, transparent 70%)` }} />
        <div className="relative p-4 md:p-5">
          <header className="flex items-start gap-3">
            <button onClick={() => navigate({ name: 'dot', id: a.agent_id, tab: 'mind' })} className="shrink-0" aria-label={`Open ${name}`}>
              <Orb hue={hue} status={agent?.status ?? 'awake'} size={38} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-display text-[16px] font-semibold">{name}</span>
                <span className="text-[13px] text-ink-3">wants to run</span>
                <span className="rounded-md border border-line-2 bg-white/[0.05] px-1.5 py-px font-mono text-[12px] text-ink">{a.skill}</span>
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-[12px] whitespace-nowrap text-ink-4">
                {swarm && (
                  <>
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: hsl(swarm.hue, 90, 65) }} />
                    <span className="truncate">{swarm.name}</span>
                    <span aria-hidden="true">·</span>
                  </>
                )}
                <time dateTime={a.created_at} title={new Date(a.created_at).toLocaleString()}>
                  {ago(a.created_at, now)}
                </time>
                <span aria-hidden="true" className="hidden sm:inline">·</span>
                <span className="hidden font-mono sm:inline">{a.id}</span>
              </div>
            </div>
            <RiskChip risk={a.risk} compact={!desktop} />
          </header>

          <div className="group relative mt-3.5 overflow-hidden rounded-xl border border-line bg-black/35">
            <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: `linear-gradient(${hsl(hue, 100, 72)}, ${hsl(hue, 90, 55, 0.3)})` }} />
            <div className="thin-scroll max-h-40 overflow-y-auto py-3 pr-11 pl-4 text-[13px]">
              <MeTTa src={a.command} />
            </div>
            <IconButton
              icon="copy"
              label="Copy command"
              size={16}
              className="absolute top-0.5 right-0.5 text-ink-4"
              onClick={async () => {
                if (await copyText(a.command)) toast({ tone: 'success', title: 'Command copied' })
              }}
            />
          </div>

          <p className="mt-3 flex items-start gap-2 text-[13px] leading-snug text-ink-2">
            <Icon name="info" size={15} className="mt-px shrink-0 text-ink-4" />
            <span>
              <span className="text-ink-4">Why it asks: </span>
              {a.reason === 'human-only' ? 'This skill is human-only. A person has to do it.' : a.reason}
            </span>
          </p>

          <div className={cx('mt-4 gap-2', desktop ? 'flex items-center justify-end' : 'grid grid-cols-2')} data-tour="approval-actions">
            <Button variant="danger" icon="x" disabled={busy} onClick={() => run('deny')} className={desktop ? 'mr-auto' : 'order-3'}>
              {deciding === 'deny' ? 'Denying…' : 'Deny'}
            </Button>
            <Button variant="subtle" icon="shield" disabled={busy} onClick={() => run('remember')} title={`Approve and add an allow rule for ${name} · ${a.skill}`} className={desktop ? '' : 'order-2'}>
              {deciding === 'remember' ? 'Saving…' : desktop ? 'Approve & always allow' : 'Always allow'}
            </Button>
            <Button variant="primary" hue={142} icon="check" disabled={busy} onClick={() => run('approve')} className={desktop ? 'min-w-32' : 'order-1 col-span-2'}>
              {deciding === 'approve' ? 'Approving…' : 'Approve once'}
            </Button>
          </div>
        </div>

        <AnimatePresence>{shown && <Stamp decision={shown} />}</AnimatePresence>
      </article>
    </m.li>
  )
}

/** The decision lands: a drawn check or cross over a soft tint. Quick, quiet, final. */
function Stamp({ decision }: { decision: Decision }) {
  const d = DECISION[decision]
  return (
    <m.div
      className="absolute inset-0 flex items-center justify-center gap-3 backdrop-blur-[6px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      style={{ background: `color-mix(in srgb, ${d.color} 10%, rgb(8 8 26 / 0.9))` }}
      role="status"
    >
      <m.span className="rounded-full" initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 520, damping: 18 }} style={{ boxShadow: `0 0 26px -2px ${d.color}88` }}>
      <svg width="46" height="46" viewBox="0 0 46 46" className="block">
        <m.circle cx="23" cy="23" r="20" fill="none" stroke={d.color} strokeWidth="2.2" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, ease: 'easeOut' }} />
        <m.path
          d={d.icon === 'check' ? 'M14.5 23.5l6 6L32 17' : 'M16 16l14 14 M30 16 16 30'}
          fill="none"
          stroke={d.color}
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.28, delay: 0.2, ease: 'easeOut' }}
        />
      </svg>
      </m.span>
      <m.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 }} className="font-display text-[16px] font-semibold" style={{ color: d.color }}>
        {d.label}
      </m.span>
    </m.div>
  )
}

// ---------------------------------------------------------------- history

const STATUS: Record<Exclude<ApprovalStatus, 'pending'>, { label: string; color: string; icon: IconName }> = {
  approved: { label: 'Approved', color: '#4ade80', icon: 'check' },
  used: { label: 'Used', color: '#5eead4', icon: 'bolt' },
  denied: { label: 'Denied', color: '#fb7185', icon: 'x' },
  expired: { label: 'Expired', color: '#8a89b3', icon: 'clock' },
}

function dayLabel(iso: string, now: number) {
  const d = new Date(iso)
  const today = new Date(now)
  const y = new Date(now - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })
}

function History() {
  const approvals = useHive((s) => s.approvals)
  const agents = useHive((s) => s.agents)
  const now = useNow(30_000)
  const [filter, setFilter] = useState<'all' | 'approved' | 'denied'>('all')
  const [open, setOpen] = useState<string | null>(null)
  const list = useMemo(
    () =>
      Object.values(approvals)
        .filter((a) => a.status !== 'pending')
        .filter((a) => filter === 'all' || (filter === 'approved' ? a.status === 'approved' || a.status === 'used' : a.status === 'denied'))
        .sort((a, b) => (b.decided_at ?? b.created_at).localeCompare(a.decided_at ?? a.created_at)),
    [approvals, filter],
  )
  const groups = useMemo(() => {
    const out: { day: string; items: Approval[] }[] = []
    for (const a of list) {
      const day = dayLabel(a.decided_at ?? a.created_at, now)
      if (out[out.length - 1]?.day !== day) out.push({ day, items: [] })
      out[out.length - 1].items.push(a)
    }
    return out
  }, [list, now])

  return (
    <div className="max-w-[860px]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[13px] text-ink-3">{list.length} decisions</span>
        <Segmented
          label="History filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'approved', label: 'Approved' },
            { value: 'denied', label: 'Denied' },
          ]}
        />
      </div>
      {groups.length === 0 && <EmptyState icon="history" title="No decisions yet" body="Approved, denied and expired requests collect here." />}
      {groups.map((g) => (
        <section key={g.day} className="mb-5" aria-label={g.day}>
          <h2 className="eyebrow mb-2 px-1">{g.day}</h2>
          <ul className="overflow-hidden rounded-[18px] border border-line bg-white/[0.02]">
            {g.items.map((a, i) => {
              const agent = agents[a.agent_id]
              const st = STATUS[a.status as Exclude<ApprovalStatus, 'pending'>]
              const isOpen = open === a.id
              return (
                <li key={a.id} className={cx(i > 0 && 'border-t border-line')}>
                  <button onClick={() => setOpen(isOpen ? null : a.id)} aria-expanded={isOpen} className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-white/[0.03] md:px-4">
                    <Orb hue={agent?.hue ?? 252} status={agent?.status ?? 'awake'} size={24} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="text-[14px] font-medium">{agent?.name ?? a.agent_id}</span>
                        <span className="font-mono text-[12px] text-ink-3">{a.skill}</span>
                      </span>
                      <span className="block truncate text-[12px] text-ink-4">
                        <MeTTa src={a.command} wrap={false} className="opacity-80" />
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ color: st.color, borderColor: `${st.color}55`, background: `${st.color}14` }}>
                        <Icon name={st.icon} size={11} strokeWidth={2.4} />
                        {st.label}
                      </span>
                      <span className="text-[11px] text-ink-4">{ago(a.decided_at ?? a.created_at, now)}</span>
                    </span>
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <m.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <div className="space-y-2 px-4 pb-4 text-[13px]">
                          <div className="rounded-xl border border-line bg-black/30 px-3 py-2.5">
                            <MeTTa src={a.command} />
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3">
                            <span>
                              <span className="text-ink-4">Reason </span>
                              {a.reason}
                            </span>
                            <RiskChip risk={a.risk} compact />
                            {a.decided_by && (
                              <span>
                                <span className="text-ink-4">By </span>
                                {a.decided_by.replace(/^user:/, '')}
                              </span>
                            )}
                            <span>
                              <span className="text-ink-4">Asked </span>
                              {new Date(a.created_at).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
                            </span>
                          </div>
                        </div>
                      </m.div>
                    )}
                  </AnimatePresence>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
