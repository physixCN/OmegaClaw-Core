import { animate, AnimatePresence, m, useMotionValue, useTransform } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { hsl } from '../lib/color'
import { compact, money } from '../lib/format'
import { useEscape, useIsDesktop } from '../lib/hooks'
import { navigate, useRoute } from '../lib/router'
import { computeStats, countPending } from '../store/reducer'
import { useHive } from '../store/store'
import { Icon, type IconName } from '../ui/Icon'
import { CountBadge, Kbd, Orb } from '../ui/primitives'
import { cx } from '../lib/cx'
import { LabBadge } from './LabBadge'
import { SimChip } from '../ui/SimChip'
import { useIntro } from '../tour/introStore'

function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const mv = useMotionValue(value)
  const text = useTransform(mv, (v) => format(v))
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.8, ease: [0.16, 1, 0.3, 1] })
    return () => c.stop()
  }, [mv, value])
  return <m.span>{text}</m.span>
}

export function Brand({ compactMode = false }: { compactMode?: boolean }) {
  const mode = useHive((s) => s.client?.mode)
  const connection = useHive((s) => s.connection)
  const live = connection === 'open'
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative size-9 shrink-0">
        <svg viewBox="0 0 36 36" className="size-9" aria-hidden="true">
          <defs>
            <radialGradient id="brand-g" cx="50%" cy="50%" r="50%">
              <stop offset="0" stopColor="#fff" />
              <stop offset=".3" stopColor="#b9a8ff" />
              <stop offset="1" stopColor="#7c6cff" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="18" cy="18" r="17" fill="url(#brand-g)" opacity=".55" />
          <ellipse cx="18" cy="18" rx="15" ry="6" fill="none" stroke="#c9beff" strokeOpacity=".55" strokeWidth="1" transform="rotate(-24 18 18)" />
          <circle cx="18" cy="18" r="3.4" fill="#fff" />
          <circle cx="30.5" cy="12.6" r="1.8" fill="#7ee8ff" />
        </svg>
      </div>
      {!compactMode && (
        <div className="leading-none">
          <div className="font-display text-[15px] font-semibold tracking-tight">
            OmegaDots <span className="text-ink-3">Hive</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-ink-3 uppercase">
            <span
              className={cx('size-1.5 rounded-full', live ? 'bg-good' : connection === 'reconnecting' ? 'bg-warn animate-pulse' : 'bg-ink-4')}
              style={live ? { boxShadow: '0 0 8px #4ade80' } : undefined}
            />
            {mode === 'sim'
              ? 'Simulation'
              : live
                ? 'Live'
                : connection === 'reconnecting'
                  ? 'Reconnecting'
                  : connection === 'connecting'
                    ? 'Connecting'
                    : connection === 'unauthorized'
                      ? 'Signed out'
                      : 'Offline'}
          </div>
        </div>
      )}
    </div>
  )
}

export function Stats() {
  const agents = useHive((s) => s.agents)
  const beliefs = useHive((s) => s.beliefs)
  const hive = useHive((s) => s.hive)
  const loaded = useHive((s) => s.beliefsLoaded)
  const swarms = useHive((s) => s.swarms)
  const stats = useMemo(() => computeStats({ agents, beliefs, hive, beliefsLoaded: loaded, swarms }), [agents, beliefs, hive, loaded, swarms])
  const items = [
    { label: 'Dots', value: stats.agents, fmt: (n: number) => String(Math.round(n)) },
    { label: 'Awake', value: stats.awake, fmt: (n: number) => String(Math.round(n)), dot: true },
    { label: 'Beliefs', value: stats.beliefs, fmt: (n: number) => compact(n) },
    { label: 'Spend', value: stats.spent, fmt: (n: number) => money(n) },
  ]
  return (
    <div className="glass flex items-stretch rounded-2xl" role="group" aria-label="Hive statistics" data-tour="hud-stats">
      {items.map((it, i) => (
        <div key={it.label} className={cx('flex min-w-0 flex-1 flex-col justify-center px-3 py-2 md:px-4', i > 0 && 'border-l border-line')}>
          <div className="flex items-center gap-1.5 text-[10px] font-medium tracking-[0.12em] text-ink-3 uppercase">
            {it.dot && <span className="size-1.5 rounded-full bg-[#5eead4]" style={{ boxShadow: '0 0 8px #5eead4' }} />}
            {it.label}
            {it.label === 'Spend' && <SimChip className="tracking-[0.06em]" />}
          </div>
          <div className="mt-0.5 font-display text-[17px] leading-tight font-semibold md:text-lg">
            <AnimatedNumber value={it.value} format={it.fmt} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function TopBar() {
  const desktop = useIsDesktop()
  const setPalette = useHive((s) => s.setPalette)
  const route = useRoute()
  const panel = route.name === 'dot' || route.name === 'new'
  if (desktop) {
    return (
      <header className="pointer-events-none fixed top-0 right-0 left-0 z-20 flex items-start justify-between gap-4 p-4">
        <div className="pointer-events-auto glass rounded-2xl px-3 py-2">
          <Brand />
        </div>
        <div className="pointer-events-auto w-[440px]">
          <Stats />
        </div>
        <div
          className="pointer-events-auto flex items-center gap-2"
          style={{ opacity: panel ? 0 : 1, pointerEvents: panel ? 'none' : undefined, transition: 'opacity 200ms' }}
          aria-hidden={panel || undefined}
        >
          <LabBadge />
          <InboxButton />
          <button
            onClick={() => setPalette(true)}
            tabIndex={panel ? -1 : undefined}
            className="glass flex min-h-11 items-center gap-3 rounded-2xl px-3.5 text-sm text-ink-3 transition-colors hover:text-ink"
            data-tour="hud-search"
            aria-label="Open command palette"
          >
            <Icon name="search" size={17} />
            <span className="pr-4">Jump to…</span>
            <span className="flex gap-1">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
          <OverflowMenu />
        </div>
      </header>
    )
  }
  return (
    <header className="pointer-events-none fixed top-0 right-0 left-0 z-20 px-3" style={{ paddingTop: 'calc(var(--sat) + 8px)' }}>
      <div className="pointer-events-auto flex items-center justify-between gap-2">
        <Brand />
        <div className="flex items-center gap-2">
          {/* phones have room for one status pill: approvals waiting outrank the Lab */}
          <MobileLab />
          <InboxButton compactMode />
          <button onClick={() => setPalette(true)} data-tour="hud-search" className="glass flex size-11 items-center justify-center rounded-2xl text-ink-2" aria-label="Search and commands">
            <Icon name="search" size={19} />
          </button>
          <OverflowMenu />
        </div>
      </div>
      <div className="pointer-events-auto mt-2.5">
        <Stats />
      </div>
    </header>
  )
}

export function Toasts() {
  const toasts = useHive((s) => s.toasts)
  const dismiss = useHive((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex flex-col items-center gap-2 p-3" style={{ paddingTop: 'calc(var(--sat) + 12px)' }} aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <m.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 500, damping: 34 }}
            className="glass-strong pointer-events-auto relative flex w-full max-w-sm items-start gap-3 overflow-hidden rounded-2xl px-4 py-3"
            role={t.tone === 'error' ? 'alert' : 'status'}
          >
            {t.hue !== undefined && (
              <span className="pointer-events-none absolute inset-y-0 left-0 w-24" style={{ background: `radial-gradient(80% 90% at 0% 50%, ${hsl(t.hue, 90, 60, 0.22)}, transparent)` }} />
            )}
            <span className={cx('relative mt-0.5', t.tone === 'error' ? 'text-bad' : t.tone === 'success' ? 'text-good' : 'text-accent')}>
              {t.hue !== undefined ? (
                <span className="relative block">
                  <Orb hue={t.hue} size={22} />
                  {t.icon && (
                    <span className="absolute -right-1.5 -bottom-1 flex size-4 items-center justify-center rounded-full bg-[#1b1406] text-warn ring-1 ring-warn/40">
                      <Icon name={t.icon} size={10} strokeWidth={2.4} />
                    </span>
                  )}
                </span>
              ) : (
                <Icon name={t.icon ?? (t.tone === 'error' ? 'alert' : t.tone === 'success' ? 'check' : 'info')} size={18} />
              )}
            </span>
            {t.action ? (
              <button
                className="relative min-w-0 flex-1 text-left"
                onClick={() => {
                  t.action!.run()
                  dismiss(t.id)
                }}
              >
                <span className="block text-sm font-medium">{t.title}</span>
                {t.body && <span className="mt-0.5 block truncate font-mono text-[12px] text-ink-3">{t.body}</span>}
                <span className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-warn">
                  {t.action.label} <Icon name="chevron" size={13} strokeWidth={2.2} />
                </span>
              </button>
            ) : (
              <div className="relative min-w-0 flex-1">
                <div className="text-sm font-medium">{t.title}</div>
                {t.body && <div className="mt-0.5 text-[13px] text-ink-3">{t.body}</div>}
              </div>
            )}
            <button onClick={() => dismiss(t.id)} className="-m-2 flex size-9 items-center justify-center text-ink-3 hover:text-ink" aria-label="Dismiss">
              <Icon name="x" size={16} />
            </button>
          </m.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

/** Pending approvals at a glance; tapping opens the inbox. Hidden on phones when nothing waits. */
function InboxButton({ compactMode }: { compactMode?: boolean }) {
  const pending = useHive((s) => countPending(s.approvals))
  if (compactMode) {
    return (
      <AnimatePresence>
        {pending > 0 && (
          <m.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => navigate({ name: 'approvals' })}
            className="glass relative flex h-11 items-center gap-1.5 rounded-2xl pr-3 pl-2.5 text-[13px] font-semibold text-warn"
            aria-label={`Approvals inbox, ${pending} waiting`}
          >
            <span className="absolute inset-0 rounded-2xl border border-warn/30" style={{ boxShadow: '0 0 18px -4px rgb(251 191 36 / 0.55)' }} aria-hidden="true" />
            <Icon name="shield" size={17} />
            <span className="tabular-nums">{pending}</span>
          </m.button>
        )}
      </AnimatePresence>
    )
  }
  return (
    <button
      onClick={() => navigate({ name: 'approvals' })}
      className={cx('glass relative flex size-11 items-center justify-center rounded-2xl transition-colors', pending ? 'text-warn' : 'text-ink-3 hover:text-ink')}
      aria-label={pending ? `Approvals inbox, ${pending} waiting` : 'Approvals inbox'}
      title="Approvals (G I)"
    >
      {pending > 0 && <span className="absolute inset-0 rounded-2xl border border-warn/30" style={{ boxShadow: '0 0 18px -4px rgb(251 191 36 / 0.55)' }} aria-hidden="true" />}
      <Icon name="inbox" size={19} />
      <CountBadge n={pending} className="absolute -top-1 -right-1" />
    </button>
  )
}

function MobileLab() {
  const pending = useHive((s) => countPending(s.approvals))
  return pending > 0 ? null : <LabBadge compactMode />
}

interface MenuItem {
  label: string
  icon: IconName
  run: () => void
  danger?: boolean
  badge?: number
  hint?: string
  tour?: string
}

/** HUD overflow: secondary destinations and the global kill switch. */
function OverflowMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const pending = useHive((s) => countPending(s.approvals))
  const awake = useHive((s) => Object.values(s.agents).filter((a) => a.status !== 'stopped').length)
  const setStopAll = useHive((s) => s.setStopAll)
  useEscape(() => setOpen(false), open)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])
  const go = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }
  const items: (MenuItem | null)[] = [
    { label: 'Approvals inbox', icon: 'inbox', run: go(() => navigate({ name: 'approvals' })), badge: pending },
    { label: 'Policy rules', icon: 'rules', run: go(() => navigate({ name: 'approvals', tab: 'rules' })) },
    { label: 'Goals board', icon: 'target', run: go(() => navigate({ name: 'goals' })) },
    { label: 'Lab · tests & benchmarks', icon: 'flask', run: go(() => navigate({ name: 'lab' })) },
    null,
    { label: 'Replay the tour', icon: 'compass', run: go(() => useIntro.getState().startTour({})), hint: '2 min', tour: 'menu-tour' },
    { label: 'Help & shortcuts', icon: 'question', run: go(() => useIntro.getState().setHelp(true)), hint: '?', tour: 'menu-help' },
    null,
    { label: 'Stop all dots…', icon: 'power', run: go(() => setStopAll(true)), danger: true, hint: `${awake} running`, tour: 'menu-stop-all' },
  ]
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        data-tour="hud-more"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More"
        className={cx('glass flex size-11 items-center justify-center rounded-2xl text-ink-2 transition-colors hover:text-ink', open && 'text-ink')}
      >
        <Icon name="more" size={22} strokeWidth={2.6} />
      </button>
      <AnimatePresence>
        {open && (
          <m.div
            role="menu"
            initial={{ opacity: 0, scale: 0.94, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 600, damping: 36 }}
            style={{ transformOrigin: 'top right' }}
            className="glass-strong absolute top-full right-0 z-40 mt-2 w-60 rounded-2xl p-1.5"
          >
            {items.map((it, i) =>
              it ? (
                <button
                  key={it.label}
                  role="menuitem"
                  data-tour={it.tour}
                  onClick={it.run}
                  className={cx(
                    'flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[14px] transition-colors',
                    it.danger ? 'text-bad hover:bg-bad/10' : 'text-ink-2 hover:bg-white/[0.06] hover:text-ink',
                  )}
                >
                  <Icon name={it.icon} size={18} />
                  <span className="flex-1">{it.label}</span>
                  {it.badge ? <CountBadge n={it.badge} /> : it.hint ? <span className="text-[11px] text-ink-4">{it.hint}</span> : null}
                </button>
              ) : (
                <div key={i} className="mx-2 my-1 h-px bg-line" />
              ),
            )}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}
