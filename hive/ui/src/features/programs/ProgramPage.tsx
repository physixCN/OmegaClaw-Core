import { useEffect, useMemo } from 'react'
import { hsl } from '../../lib/color'
import { navigate } from '../../lib/router'
import { sessionKey } from '../../store/programSession'
import { useHive } from '../../store/store'
import { Icon } from '../../ui/Icon'
import { iconOr } from '../../ui/iconPaths'
import { Page } from '../../ui/Page'
import ProgramHost from './ProgramHost'
import { programBackOrExit } from './style'

const SWARM_KEY = (id: string) => `omegadots.program.swarm.${id}`

function rememberedSwarm(id: string): string | null {
  try {
    return localStorage.getItem(SWARM_KEY(id))
  } catch {
    return null
  }
}

/** #/program/<id>[/<swarm>]: the host as a full page. A program call is scoped to one swarm. */
export default function ProgramPage({ id, swarm }: { id: string; swarm?: string }) {
  const swarms = useHive((s) => s.swarms)
  const program = useHive((s) => s.programs?.find((p) => p.id === id))
  const programsLoaded = useHive((s) => !!s.programs)
  const loadPrograms = useHive((s) => s.loadPrograms)
  const sorted = useMemo(() => Object.values(swarms).sort((a, b) => a.name.localeCompare(b.name)), [swarms])
  const current = swarm && swarms[swarm] ? swarm : null
  const title = useHive((s) => (current ? s.programSessions[sessionKey(id, current)]?.graph?.title : undefined))

  useEffect(() => {
    if (!programsLoaded) void loadPrograms().catch(() => undefined)
  }, [programsLoaded, loadPrograms])
  // pick the swarm: the route's, else the last used for this program, else the first
  useEffect(() => {
    if (current || !sorted.length) return
    const last = rememberedSwarm(id)
    const pick = last && swarms[last] ? last : sorted[0].id
    navigate({ name: 'program', id, swarm: pick }, { replace: true })
  }, [current, sorted, swarms, id])
  useEffect(() => {
    if (!current) return
    try {
      localStorage.setItem(SWARM_KEY(id), current)
    } catch {
      /* optional */
    }
  }, [current, id])

  const exit = () => navigate({ name: 'programs' })
  const sw = current ? swarms[current] : null
  return (
    <Page
      label={`${program?.name ?? id} program`}
      eyebrow={
        <span className="flex items-center gap-1.5">
          <Icon name={iconOr(program?.icon, 'spark')} size={12} />
          Program · {program?.name ?? id}
          {sw && (
            <>
              <span aria-hidden="true">·</span>
              <span className="size-1.5 rounded-full" style={{ background: hsl(sw.hue, 95, 68) }} />
              {sw.name}
            </>
          )}
        </span>
      }
      title={title ?? program?.name ?? id}
      onClose={() => navigate({ name: 'hive' })}
      onEscape={() => current && programBackOrExit(sessionKey(id, current), exit)}
      info="program"
      actions={
        sorted.length > 1 && current ? (
          <label className="relative hidden items-center sm:flex">
            <span className="sr-only">Swarm</span>
            <select
              value={current}
              onChange={(e) => navigate({ name: 'program', id, swarm: e.target.value })}
              className="min-h-10 appearance-none rounded-xl border border-line bg-white/[0.05] py-0 pr-8 pl-3 text-[13px] text-ink outline-none hover:border-line-2"
              title="The swarm this program works in"
            >
              {sorted.map((s) => (
                <option key={s.id} value={s.id} className="bg-[#0b0b22]">
                  {s.name}
                </option>
              ))}
            </select>
            <Icon name="chevronDown" size={14} className="pointer-events-none absolute right-2.5 text-ink-3" />
          </label>
        ) : undefined
      }
    >
      {current ? <ProgramHost key={`${id}-${current}`} programId={id} swarmId={current} variant="page" onExit={exit} /> : null}
    </Page>
  )
}
