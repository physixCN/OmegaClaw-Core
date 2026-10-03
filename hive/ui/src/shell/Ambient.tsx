import { AnimatePresence, m } from 'framer-motion'
import { lazy, Suspense, useState, type FormEvent } from 'react'
import type { AssertionOutcome } from '../api/types'
import { useIsDesktop } from '../lib/hooks'
import { navigate, useRoute } from '../lib/router'
import { useScene } from '../scene/sceneStore'
import { useHive } from '../store/store'
import { Icon } from '../ui/Icon'
import { MeTTa } from '../ui/MeTTa'
import { Button, Orb } from '../ui/primitives'
import { cx } from '../lib/cx'
import { Brand } from './Hud'

// the explainer (copy for every view) loads with the views, not with the shell
const ViewInfo = lazy(() => import('../tour/ViewInfo').then((r) => ({ default: r.ViewInfo })))

const OUTCOME_VERB: Record<AssertionOutcome, string> = {
  adopted: 'introduced',
  revised: 'revised',
  chosen: 'won a choice on',
  kept: 'lost a choice on',
  duplicate: 'repeated',
  quarantined: 'was quarantined on',
  denied: 'was denied on',
}

/** A quiet live feed of what the hive is doing. */
export function ActivityTicker() {
  const activity = useHive((s) => s.activity)
  const agents = useHive((s) => s.agents)
  const desktop = useIsDesktop()
  const route = useRoute()
  if (route.name !== 'hive') return null
  const items = activity.slice(0, desktop ? 4 : 1)
  return (
    <div
      className={cx('pointer-events-none fixed z-10 flex flex-col gap-1.5', desktop ? 'bottom-5 left-24 w-[420px]' : 'inset-x-3')}
      style={desktop ? undefined : { bottom: 'calc(var(--sab) + 82px)' }}
      aria-live="off"
    >
      <AnimatePresence initial={false}>
        {items.map((a, i) => {
          const agent = a.agent_id ? agents[a.agent_id] : undefined
          return (
            <m.div
              key={a.id}
              initial={{ opacity: 0, y: 14, filter: 'blur(4px)' }}
              animate={{ opacity: 1 - i * 0.22, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              className="flex min-w-0 items-center gap-2 rounded-xl bg-black/25 px-2.5 py-1.5 text-[12px] text-ink-2 backdrop-blur-sm"
            >
              {agent ? <Orb hue={agent.hue} status={agent.status} size={14} /> : <span className="size-3.5" />}
              <span className="shrink-0 font-medium text-ink">{agent?.name ?? 'Someone'}</span>
              {a.kind === 'belief' && a.statement ? (
                <>
                  <span className={cx('shrink-0', a.outcome === 'quarantined' && 'text-warn', (a.outcome === 'chosen' || a.outcome === 'kept') && 'text-[#f5c06b]')}>
                    {OUTCOME_VERB[a.outcome ?? 'revised']}
                  </span>
                  <span className="min-w-0 truncate">
                    <MeTTa src={a.statement} wrap={false} />
                  </span>
                </>
              ) : (
                <span className={cx('truncate', a.kind === 'error' && 'text-bad')}>{a.text}</span>
              )}
            </m.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

export function SceneControls() {
  const engine = useScene((s) => s.engine)
  const desktop = useIsDesktop()
  const route = useRoute()
  if (!engine || route.name !== 'hive') return null
  if (!desktop) {
    return (
      <div className="fixed right-3 z-10 flex flex-col gap-2" style={{ top: 'calc(var(--sat) + 132px)' }}>
        <button onClick={() => engine.overview()} className="glass flex size-11 items-center justify-center rounded-2xl text-ink-2" aria-label="Recenter the hive">
          <Icon name="locate" size={19} />
        </button>
        <div className="glass min-h-11 rounded-2xl">
          <Suspense fallback={<span className="block size-11" />}>
            <ViewInfo view="hive" />
          </Suspense>
        </div>
      </div>
    )
  }
  return (
    <div className="glass fixed right-4 bottom-5 z-10 flex flex-col rounded-2xl p-1" role="group" aria-label="Camera">
      <Suspense fallback={<span className="block size-11" />}>
        <ViewInfo view="hive" />
      </Suspense>
      <button onClick={() => engine.zoomBy(1.3)} className="flex size-11 items-center justify-center rounded-xl text-ink-2 hover:bg-white/[0.06] hover:text-ink" aria-label="Zoom in">
        <Icon name="zoomIn" size={19} />
      </button>
      <button onClick={() => engine.zoomBy(1 / 1.3)} className="flex size-11 items-center justify-center rounded-xl text-ink-2 hover:bg-white/[0.06] hover:text-ink" aria-label="Zoom out">
        <Icon name="zoomOut" size={19} />
      </button>
      <button onClick={() => engine.overview()} className="flex size-11 items-center justify-center rounded-xl text-ink-2 hover:bg-white/[0.06] hover:text-ink" aria-label="Recenter the hive">
        <Icon name="locate" size={19} />
      </button>
    </div>
  )
}

/** Keyboard and screen-reader access to every dot: hidden until focused. */
export function DotDirectory() {
  const agents = useHive((s) => s.agents)
  const list = Object.values(agents).sort((a, b) => a.name.localeCompare(b.name))
  return (
    <nav
      aria-label="Dots"
      className="glass-strong fixed top-24 left-1/2 z-50 max-h-[60vh] w-72 -translate-x-1/2 overflow-auto rounded-2xl p-2 opacity-0 focus-within:pointer-events-auto focus-within:opacity-100 pointer-events-none"
    >
      <div className="eyebrow px-2 py-1">Dots</div>
      {list.map((a) => (
        <button key={a.id} onClick={() => navigate({ name: 'dot', id: a.id })} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-left text-sm hover:bg-white/[0.06]">
          <Orb hue={a.hue} status={a.status} size={16} />
          {a.name}
          <span className="ml-auto text-xs text-ink-3">{a.status}</span>
        </button>
      ))}
    </nav>
  )
}

export function EmptyHive() {
  const ready = useHive((s) => s.ready)
  const count = useHive((s) => Object.keys(s.agents).length)
  const route = useRoute()
  if (!ready || count > 0 || route.name !== 'hive') return null
  return (
    <m.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="fixed inset-0 z-10 flex items-center justify-center p-6 pointer-events-none">
      <div className="glass pointer-events-auto max-w-sm rounded-3xl p-6 text-center">
        <div className="font-display text-xl font-semibold">The hive is quiet</div>
        <p className="mt-2 text-sm text-ink-3">No dots yet. Spark the first one and watch it emerge from its swarm.</p>
        <Button variant="primary" icon="sparkles" className="mt-5" onClick={() => navigate({ name: 'new' })}>
          Create the first dot
        </Button>
      </div>
    </m.div>
  )
}

export function BootScreen({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-5 p-6">
      <m.div animate={{ scale: [1, 1.08, 1], opacity: [0.8, 1, 0.8] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}>
        <div className="size-20 rounded-full" style={{ background: 'radial-gradient(circle, #fff 0 8%, #b9a8ff 22%, rgb(124 108 255 / 0.25) 50%, transparent 70%)' }} />
      </m.div>
      {error ? (
        <div className="glass max-w-sm rounded-2xl p-5 text-center" role="alert">
          <div className="font-display font-semibold">Could not reach the hive</div>
          <p className="mt-1 text-sm text-ink-3">{error}</p>
          <Button className="mt-4" onClick={onRetry} icon="sparkles">
            Try again
          </Button>
        </div>
      ) : (
        <div className="eyebrow animate-pulse">Waking the hive…</div>
      )}
    </div>
  )
}

export function Login() {
  const client = useHive((s) => s.client)
  const hydrate = useHive((s) => s.hydrate)
  const [pw, setPw] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(0)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!client || !pw) return
    setBusy(true)
    setErr(null)
    try {
      await client.login(pw)
      await hydrate()
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Login failed')
      setShake((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-5">
      <m.form
        key={shake}
        onSubmit={submit}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={shake ? { x: [0, -10, 9, -6, 4, 0], opacity: 1, y: 0, scale: 1 } : { opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45 }}
        className="glass-strong w-full max-w-sm rounded-[26px] p-6"
        aria-label="Operator login"
      >
        <Brand />
        <h1 className="mt-6 font-display text-2xl font-semibold tracking-tight">Welcome back, operator</h1>
        <p className="mt-1.5 text-sm text-ink-3">Enter the hive password to wake the interface.</p>
        <label className="mt-6 block">
          <span className="eyebrow">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            className="mt-2 min-h-12 w-full rounded-xl border border-line bg-black/30 px-4 text-ink outline-none transition-colors placeholder:text-ink-4 focus:border-accent/60"
            placeholder="HIVE_ADMIN_PASSWORD"
            aria-invalid={!!err}
            aria-describedby={err ? 'login-err' : undefined}
          />
        </label>
        {err && (
          <p id="login-err" className="mt-2 text-sm text-bad" role="alert">
            {err}
          </p>
        )}
        <Button variant="primary" size="lg" type="submit" className="mt-5 w-full" disabled={busy || !pw}>
          {busy ? 'Waking…' : 'Enter the hive'}
        </Button>
      </m.form>
    </div>
  )
}
