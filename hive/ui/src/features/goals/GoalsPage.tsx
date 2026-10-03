import { m } from 'framer-motion'
import { useMemo } from 'react'
import { hsl } from '../../lib/color'
import { cx } from '../../lib/cx'
import { navigate } from '../../lib/router'
import { useHive } from '../../store/store'
import { Page } from '../../ui/Page'
import { EmptyState } from '../../ui/primitives'
import { GoalsBoard } from './GoalsBoard'

/** #/goals[/swarm]: every swarm's work, one board at a time. */
export default function GoalsPage({ swarm }: { swarm?: string }) {
  const swarms = useHive((s) => s.swarms)
  const goals = useHive((s) => s.goals)
  const list = useMemo(() => Object.values(swarms).sort((a, b) => a.created_at.localeCompare(b.created_at)), [swarms])
  const active = (swarm && swarms[swarm] ? swarm : list[0]?.id) ?? null
  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const g of Object.values(goals)) if (g.status === 'open' || g.status === 'claimed') out[g.swarm_id] = (out[g.swarm_id] ?? 0) + 1
    return out
  }, [goals])

  return (
    <Page label="Goals" eyebrow="Swarm work" title="Goals" onClose={() => navigate({ name: 'hive' })}>
      <div className="flex h-full min-h-[600px] flex-col px-3 pb-[calc(var(--sab)+92px)] md:px-6 md:pb-6">
        {list.length === 0 ? (
          <EmptyState icon="target" title="No swarms yet" body="Goals belong to a swarm. Create a dot with a swarm first." />
        ) : (
          <>
            <div className="no-scrollbar -mx-3 mb-3 flex gap-2 overflow-x-auto px-3 md:mx-0 md:px-0" role="tablist" aria-label="Swarm">
              {list.map((s) => {
                const on = s.id === active
                return (
                  <button
                    key={s.id}
                    role="tab"
                    aria-selected={on}
                    onClick={() => navigate({ name: 'goals', swarm: s.id }, { replace: true })}
                    className={cx('relative flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[14px] transition-colors', on ? 'border-line-2 text-ink' : 'border-line text-ink-3 hover:text-ink-2')}
                  >
                    {on && <m.span layoutId="goals-swarm" className="absolute inset-0 rounded-full" style={{ background: hsl(s.hue, 80, 55, 0.14) }} transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                    <span className="relative size-2.5 rounded-full" style={{ background: hsl(s.hue, 95, 68), boxShadow: `0 0 10px ${hsl(s.hue, 100, 60)}` }} />
                    <span className="relative font-medium">{s.name}</span>
                    <span className="relative font-mono text-[12px] text-ink-4">{counts[s.id] ?? 0}</span>
                  </button>
                )
              })}
            </div>
            {active && <GoalsBoard key={active} swarmId={active} className="flex-1" />}
          </>
        )}
      </div>
    </Page>
  )
}
