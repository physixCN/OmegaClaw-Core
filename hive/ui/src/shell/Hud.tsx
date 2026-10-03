import { animate, AnimatePresence, m, useMotionValue, useTransform } from 'framer-motion'
import { useEffect, useMemo } from 'react'
import { compact, money } from '../lib/format'
import { useIsDesktop } from '../lib/hooks'
import { useRoute } from '../lib/router'
import { computeStats } from '../store/reducer'
import { useHive } from '../store/store'
import { Icon } from '../ui/Icon'
import { Kbd } from '../ui/primitives'
import { cx } from '../lib/cx'

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
            {mode === 'sim' ? 'Simulation' : live ? 'Live' : connection === 'reconnecting' ? 'Reconnecting' : 'Connecting'}
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
    <div className="glass flex items-stretch rounded-2xl" role="group" aria-label="Hive statistics">
      {items.map((it, i) => (
        <div key={it.label} className={cx('flex min-w-0 flex-1 flex-col justify-center px-3 py-2 md:px-4', i > 0 && 'border-l border-line')}>
          <div className="flex items-center gap-1.5 text-[10px] font-medium tracking-[0.12em] text-ink-3 uppercase">
            {it.dot && <span className="size-1.5 rounded-full bg-[#5eead4]" style={{ boxShadow: '0 0 8px #5eead4' }} />}
            {it.label}
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
        <button
          onClick={() => setPalette(true)}
          style={{ opacity: panel ? 0 : 1, pointerEvents: panel ? 'none' : undefined, transition: 'opacity 200ms' }}
          tabIndex={panel ? -1 : undefined}
          className="glass pointer-events-auto flex min-h-11 items-center gap-3 rounded-2xl px-3.5 text-sm text-ink-3 transition-colors hover:text-ink"
          aria-label="Open command palette"
        >
          <Icon name="search" size={17} />
          <span className="pr-6">Jump to…</span>
          <span className="flex gap-1">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
      </header>
    )
  }
  return (
    <header className="pointer-events-none fixed top-0 right-0 left-0 z-20 px-3" style={{ paddingTop: 'calc(var(--sat) + 8px)' }}>
      <div className="pointer-events-auto flex items-center justify-between">
        <Brand />
        <button onClick={() => setPalette(true)} className="glass flex size-11 items-center justify-center rounded-2xl text-ink-2" aria-label="Search and commands">
          <Icon name="search" size={19} />
        </button>
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
            className="glass-strong pointer-events-auto flex max-w-sm items-start gap-3 rounded-2xl px-4 py-3"
            role={t.tone === 'error' ? 'alert' : 'status'}
          >
            <span className={cx('mt-0.5', t.tone === 'error' ? 'text-bad' : t.tone === 'success' ? 'text-good' : 'text-accent')}>
              <Icon name={t.tone === 'error' ? 'alert' : t.tone === 'success' ? 'check' : 'info'} size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t.title}</div>
              {t.body && <div className="mt-0.5 text-[13px] text-ink-3">{t.body}</div>}
            </div>
            <button onClick={() => dismiss(t.id)} className="-m-2 flex size-9 items-center justify-center text-ink-3 hover:text-ink" aria-label="Dismiss">
              <Icon name="x" size={16} />
            </button>
          </m.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
