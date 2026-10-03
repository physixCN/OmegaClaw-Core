import { m } from 'framer-motion'
import { useIsDesktop } from '../lib/hooks'
import { navigate, useRoute, type Route } from '../lib/router'
import { useHive } from '../store/store'
import { Icon, type IconName } from '../ui/Icon'
import { CountBadge, Kbd } from '../ui/primitives'
import { cx } from '../lib/cx'
import { countPending, labHealth } from '../store/reducer'

interface Item {
  key: string
  label: string
  icon: IconName
  route: Route
  match: Route['name'][]
  keys: string[]
  badge?: boolean
}

const ITEMS: Item[] = [
  { key: 'hive', label: 'Hive', icon: 'hive', route: { name: 'hive' }, match: ['hive', 'dot'], keys: ['G', 'H'] },
  { key: 'swarms', label: 'Swarms', icon: 'swarms', route: { name: 'swarms' }, match: ['swarms', 'swarm'], keys: ['G', 'S'] },
  { key: 'inbox', label: 'Inbox', icon: 'inbox', route: { name: 'approvals' }, match: ['approvals'], keys: ['G', 'I'], badge: true },
  { key: 'goals', label: 'Goals', icon: 'target', route: { name: 'goals' }, match: ['goals'], keys: ['G', 'G'] },
  { key: 'usage', label: 'Usage', icon: 'chart', route: { name: 'usage' }, match: ['usage'], keys: ['G', 'U'] },
  { key: 'lab', label: 'Lab', icon: 'flask', route: { name: 'lab' }, match: ['lab'], keys: ['G', 'L'] },
  { key: 'programs', label: 'Programs', icon: 'apps', route: { name: 'programs' }, match: ['programs', 'program'], keys: ['G', 'P'] },
]
const byKey = (k: string) => ITEMS.find((i) => i.key === k)!

function usePending() {
  return useHive((s) => countPending(s.approvals))
}

function CreateButton({ big }: { big?: boolean }) {
  const route = useRoute()
  return (
    <button
      onClick={() => navigate({ name: 'new' })}
      data-tour="nav-create"
      aria-label="Create a new dot"
      title="New dot (N)"
      className={cx(
        'group relative flex items-center justify-center rounded-2xl text-[#0d0a24] transition-transform active:scale-95',
        big ? 'size-[52px] -translate-y-1.5' : 'size-11',
        route.name === 'new' && 'ring-2 ring-white/40',
      )}
      style={{
        background: 'radial-gradient(circle at 35% 30%, #ffffff, #c8bcff 40%, #8f7bff 100%)',
        boxShadow: '0 0 0 1px rgb(255 255 255 / 0.3) inset, 0 10px 34px -6px rgb(143 123 255 / 0.85)',
      }}
    >
      <Icon name="plus" size={big ? 24 : 20} strokeWidth={2.2} />
    </button>
  )
}

export function Nav() {
  const desktop = useIsDesktop()
  const route = useRoute()
  const setPalette = useHive((s) => s.setPalette)
  const pending = usePending()

  if (desktop) {
    return (
      <nav aria-label="Main" className="glass fixed top-1/2 left-4 z-20 flex -translate-y-1/2 flex-col items-center gap-1.5 rounded-2xl p-1.5">
        {ITEMS.slice(0, 2).map((it) => (
          <RailButton key={it.key} it={it} active={it.match.includes(route.name)} />
        ))}
        <div className="my-1">
          <CreateButton />
        </div>
        {ITEMS.slice(2).map((it) => (
          <RailButton key={it.key} it={it} active={it.match.includes(route.name)} badge={it.badge ? pending : 0} dot={it.key === 'lab' ? <LabDot /> : null} />
        ))}
      </nav>
    )
  }

  return (
    <nav
      aria-label="Main"
      className="glass-strong fixed inset-x-0 bottom-0 z-20 flex items-end justify-around rounded-t-[22px] px-2 pt-1.5"
      style={{ paddingBottom: 'calc(var(--sab) + 6px)' }}
    >
      {ITEMS.slice(0, 2).map((it) => (
        <TabButton key={it.key} it={it} active={it.match.includes(route.name)} />
      ))}
      <CreateButton big />
      <TabButton it={byKey('inbox')} active={route.name === 'approvals'} badge={pending} />
      <TabButton it={byKey('usage')} active={route.name === 'usage'} />
      <button onClick={() => setPalette(true)} data-tour="nav-jump" className="flex min-h-12 min-w-14 flex-col items-center justify-center gap-0.5 text-ink-3" aria-label="Search and commands">
        <Icon name="command" size={20} />
        <span className="text-[10px] font-medium">Jump</span>
      </button>
    </nav>
  )
}

function TabButton({ it, active, badge = 0 }: { it: Item; active: boolean; badge?: number }) {
  return (
    <button
      onClick={() => navigate(it.route)}
      data-tour={`nav-${it.key}`}
      aria-current={active ? 'page' : undefined}
      aria-label={badge ? `${it.label}, ${badge} waiting` : undefined}
      className={cx('relative flex min-h-12 min-w-14 flex-col items-center justify-center gap-0.5 transition-colors', active ? 'text-ink' : 'text-ink-3')}
    >
      {active && <m.span layoutId="tab-glow" className="absolute -top-1.5 h-0.5 w-6 rounded-full bg-accent" style={{ boxShadow: '0 0 12px #a493ff' }} />}
      <span className="relative">
        <Icon name={it.icon} size={21} />
        <CountBadge n={badge} className="absolute -top-1.5 -right-2.5" />
      </span>
      <span className="text-[10px] font-medium">{it.label}</span>
    </button>
  )
}

/** The Lab's last-run state as a tiny status dot on the rail icon. */
function LabDot() {
  const suites = useHive((s) => s.labSuites)
  const health = labHealth(suites)
  if (health.state === 'unknown') return null
  const color = health.state === 'failing' ? '#fb7185' : health.state === 'running' ? '#7dd3fc' : '#4ade80'
  return (
    <span
      className={cx('pointer-events-none absolute top-2 right-2 size-2 rounded-full', health.state === 'running' && 'animate-pulse')}
      style={{ background: color, boxShadow: `0 0 0 2px rgb(8 8 28), 0 0 8px ${color}` }}
      aria-hidden="true"
    />
  )
}

function RailButton({ it, active, badge = 0, dot }: { it: Item; active: boolean; badge?: number; dot?: React.ReactNode }) {
  return (
    <div className="group relative">
      <button
        onClick={() => navigate(it.route)}
        data-tour={`nav-${it.key}`}
        aria-label={badge ? `${it.label}, ${badge} waiting` : it.label}
        aria-current={active ? 'page' : undefined}
        className={cx('relative flex size-11 items-center justify-center rounded-xl transition-colors', active ? 'text-ink' : 'text-ink-3 hover:bg-white/[0.06] hover:text-ink')}
      >
        {active && (
          <m.span
            layoutId="rail-active"
            className="absolute inset-0 rounded-xl border border-line-2 bg-white/[0.08]"
            transition={{ type: 'spring', stiffness: 500, damping: 36 }}
          />
        )}
        <Icon name={it.icon} size={20} className="relative" />
        <CountBadge n={badge} className="absolute -top-0.5 -right-0.5" />
        {dot}
      </button>
      <div className="glass-strong pointer-events-none absolute top-1/2 left-full ml-3 flex -translate-y-1/2 items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs whitespace-nowrap opacity-0 transition-opacity group-hover:opacity-100">
        {it.label}
        <span className="flex gap-0.5">
          {it.keys.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
        </span>
      </div>
    </div>
  )
}
