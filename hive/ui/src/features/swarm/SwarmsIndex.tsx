import { motion } from 'framer-motion'
import { useMemo } from 'react'
import type { Agent, Swarm } from '../../api/types'
import { hsl } from '../../lib/color'
import { money } from '../../lib/format'
import { navigate } from '../../lib/router'
import { useHive } from '../../store/store'
import { Icon } from '../../ui/Icon'
import { Button, EmptyState, Orb } from '../../ui/primitives'
import { Page } from '../../ui/Page'

export default function SwarmsIndex() {
  const swarms = useHive((s) => s.swarms)
  const agents = useHive((s) => s.agents)
  const beliefs = useHive((s) => s.beliefs)
  const list = useMemo(() => Object.values(swarms).sort((a, b) => a.created_at.localeCompare(b.created_at)), [swarms])
  const wanderers = useMemo(() => Object.values(agents).filter((a) => !a.swarm_id || !swarms[a.swarm_id]), [agents, swarms])

  return (
    <Page label="Swarms" eyebrow="The hive" title="Swarms" onClose={() => navigate({ name: 'hive' })}>
      <div className="px-3 pb-28 md:px-6 md:pb-8">
        {list.length === 0 ? (
          <EmptyState icon="swarms" title="No swarms yet" body="Swarms share a commons of beliefs. Create a dot and give it a swarm to begin." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((s, i) => (
              <SwarmCard key={s.id} swarm={s} agents={s.member_ids.map((id) => agents[id]).filter(Boolean)} beliefCount={Object.keys(beliefs[s.id] ?? {}).length} index={i} />
            ))}
          </div>
        )}
        {wanderers.length > 0 && (
          <section className="mt-8" aria-labelledby="wander-h">
            <h2 id="wander-h" className="eyebrow mb-3 px-1">
              Wanderers · no swarm
            </h2>
            <div className="flex flex-wrap gap-2">
              {wanderers.map((a) => (
                <button key={a.id} onClick={() => navigate({ name: 'dot', id: a.id })} className="glass flex min-h-11 items-center gap-2 rounded-full py-1 pr-4 pl-2 text-sm hover:border-line-2">
                  <Orb hue={a.hue} status={a.status} size={22} />
                  {a.name}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </Page>
  )
}

function SwarmCard({ swarm, agents, beliefCount, index }: { swarm: Swarm; agents: Agent[]; beliefCount: number; index: number }) {
  const awake = agents.filter((a) => a.status === 'awake').length
  const spend = agents.reduce((s, a) => s + a.spent_usd, 0)
  return (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28, delay: 0.05 + index * 0.06 }}
      className="group relative overflow-hidden rounded-[22px] border border-line bg-white/[0.025] transition-colors hover:border-line-2"
    >
      <button onClick={() => navigate({ name: 'swarm', id: swarm.id })} className="block w-full text-left" aria-label={`Open ${swarm.name}`}>
        <div className="relative h-40 overflow-hidden">
          <div className="absolute inset-0" style={{ background: `radial-gradient(60% 80% at 50% 55%, ${hsl(swarm.hue, 90, 55, 0.35)}, transparent 70%)` }} />
          <MiniOrbit swarm={swarm} agents={agents} />
        </div>
        <div className="px-4 pt-1 pb-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold tracking-tight">{swarm.name}</h2>
            <Icon name="chevron" size={18} className="text-ink-3 transition-transform group-hover:translate-x-0.5" />
          </div>
          <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-3">{swarm.description || 'No description.'}</p>
          <dl className="mt-3 grid grid-cols-4 gap-2 text-[11px]">
            {[
              ['Dots', agents.length],
              ['Awake', awake],
              ['Beliefs', beliefCount],
              ['Spend', money(spend)],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-ink-4">{k}</dt>
                <dd className="font-display text-[15px] font-semibold text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </button>
      <div className="flex border-t border-line">
        <Button variant="ghost" icon="plus" className="flex-1 rounded-none" onClick={() => navigate({ name: 'new', swarm: swarm.id })}>
          New dot here
        </Button>
      </div>
    </motion.article>
  )
}

/** A tiny CSS-animated orrery of the swarm's members. */
function MiniOrbit({ swarm, agents }: { swarm: Swarm; agents: Agent[] }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
      <div className="absolute size-7 rounded-full" style={{ background: `radial-gradient(circle, #fff 0 12%, ${hsl(swarm.hue, 100, 75)} 30%, ${hsl(swarm.hue, 90, 60, 0)} 72%)`, boxShadow: `0 0 40px ${hsl(swarm.hue, 100, 60, 0.6)}` }} />
      {[46, 70, 94].map((r) => (
        <div key={r} className="absolute rounded-full border" style={{ width: r * 2, height: r * 0.8, borderColor: hsl(swarm.hue, 80, 75, 0.12) }} />
      ))}
      {agents.map((a, i) => {
        const rx = 46 + (i % 3) * 24
        const ry = rx * 0.4
        const T = 16 + i * 4.5
        const delay = -((i * 7.3) % T)
        return (
          <div
            key={a.id}
            className="absolute"
            style={{ ['--r' as string]: `${rx}px`, animation: `orbit-x ${T / 2}s ease-in-out ${delay}s infinite alternate` }}
          >
            <div style={{ ['--r' as string]: `${ry}px`, animation: `orbit-y ${T / 2}s ease-in-out ${delay - T / 4}s infinite alternate` }}>
              <Orb hue={a.hue} status={a.status} size={a.status === 'awake' ? 18 : 13} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
