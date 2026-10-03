import { AnimatePresence, m } from 'framer-motion'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Agent, Belief } from '../../api/types'
import { freqColor, hsl } from '../../lib/color'
import { ago, money } from '../../lib/format'
import { useIsDesktop, useNow } from '../../lib/hooks'
import { navigate } from '../../lib/router'
import { useScene } from '../../scene/sceneStore'
import { useHive } from '../../store/store'
import { Icon } from '../../ui/Icon'
import { MeTTa } from '../../ui/MeTTa'
import { Button, EmptyState, ErrorState, IconButton, Orb, Segmented, Skeleton, StatusPill } from '../../ui/primitives'
import { cx } from '../../lib/cx'
import { Page } from '../../ui/Page'
import { GoalsBoard } from '../goals/GoalsBoard'
import { Constellation, ConstellationLegend } from './Constellation'
import { Provenance } from './Provenance'

type Tab = 'commons' | 'members' | 'vocab'
type View = 'sky' | 'list' | 'goals'

const EMPTY: Record<string, Belief> = {}

export default function SwarmView({ id, statement }: { id: string; statement?: string }) {
  const swarm = useHive((s) => s.swarms[id])
  const agents = useHive((s) => s.agents)
  const beliefMap = useHive((s) => s.beliefs[id] ?? EMPTY)
  const loaded = useHive((s) => !!s.beliefsLoaded[id])
  const pulses = useHive((s) => s.beliefPulse)
  const loadBeliefs = useHive((s) => s.loadBeliefs)
  const desktop = useIsDesktop()
  const [tab, setTab] = useState<Tab>('commons')
  const [view, setView] = useState<View>('sky')
  const [err, setErr] = useState<string | null>(null)
  const engine = useScene((s) => s.engine)

  useEffect(() => {
    loadBeliefs(id).catch((e: unknown) => setErr(e instanceof Error ? e.message : 'Could not load beliefs'))
  }, [id, loadBeliefs])
  useEffect(() => engine?.flyToSwarm(id), [engine, id])

  const beliefs = useMemo(() => Object.values(beliefMap), [beliefMap])
  const members = useMemo(() => (swarm?.member_ids ?? []).map((m) => agents[m]).filter(Boolean) as Agent[], [swarm, agents])
  const openGoals = useHive((s) => {
    let n = 0
    for (const g of Object.values(s.goals)) if (g.swarm_id === id && (g.status === 'open' || g.status === 'claimed')) n++
    return n
  })

  if (!swarm) return null

  const select = (st: string | undefined) => navigate({ name: 'swarm', id, statement: st }, { replace: true })

  const commons = (
    // on phones the goals board grows with the page instead of scrolling inside a fixed box
    <div className={cx('flex min-h-0 flex-col', (desktop || view !== 'goals') && 'h-full')}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2">
        <div className="flex items-baseline gap-2">
          <h2 className="eyebrow">{view === 'goals' ? 'Goals' : 'Commons'}</h2>
          <span className="text-[12px] text-ink-3">{view === 'goals' ? `${openGoals} in flight` : `${beliefs.length} beliefs`}</span>
        </div>
        <Segmented<View>
          label="Commons view"
          value={view}
          onChange={setView}
          options={[
            { value: 'sky', label: 'Constellation' },
            { value: 'list', label: 'Table' },
            { value: 'goals', label: 'Goals' },
          ]}
        />
      </div>
      {view === 'goals' ? (
        <GoalsBoard swarmId={id} className={desktop ? 'min-h-0 flex-1' : undefined} />
      ) : (
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-[20px] border border-line" style={{ background: `radial-gradient(70% 70% at 50% 50%, ${hsl(swarm.hue, 80, 30, 0.22)}, rgb(4 4 16 / 0.6))` }}>
          {err && !beliefs.length ? (
            <ErrorState title="Could not load the commons" body={err} onRetry={() => loadBeliefs(id, true).then(() => setErr(null), () => undefined)} />
          ) : !loaded && !beliefs.length ? (
            <div className="flex h-full items-center justify-center">
              <div className="eyebrow animate-pulse">Charting the commons…</div>
            </div>
          ) : !beliefs.length ? (
            <EmptyState icon="sparkles" title="An empty sky" body="No beliefs yet. When members publish, stars appear here." />
          ) : view === 'sky' ? (
            <Constellation beliefs={beliefs} hue={swarm.hue} selected={statement} onSelect={(s) => select(s)} pulses={pulses} swarmId={id} />
          ) : (
            <BeliefTable beliefs={beliefs} onSelect={(s) => select(s)} selected={statement} />
          )}
        </div>
      )}
      {view === 'sky' && beliefs.length > 0 && <ConstellationLegend className="px-1 pt-2.5" />}
    </div>
  )

  return (
    <>
      <Page
        label={`${swarm.name} swarm`}
        eyebrow={
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full" style={{ background: hsl(swarm.hue, 95, 68), boxShadow: `0 0 8px ${hsl(swarm.hue, 95, 60)}` }} />
            Swarm
          </span>
        }
        title={swarm.name}
        onClose={() => navigate({ name: 'hive' })}
        onBack={() => navigate({ name: 'swarms' })}
        actions={
          <div className={statement ? 'hidden' : 'hidden sm:block'}>
            <Button variant="subtle" icon="plus" onClick={() => navigate({ name: 'new', swarm: id })}>
              New dot here
            </Button>
          </div>
        }
      >
        {desktop ? (
          <div className="grid h-full min-h-[560px] grid-cols-[300px_1fr] gap-5 px-6 pb-6 transition-[padding] duration-300" style={{ paddingRight: statement ? 484 : undefined }}>
            <aside className="thin-scroll min-h-0 space-y-6 overflow-y-auto pr-1">
              <p className="text-[13px] leading-relaxed text-ink-3">{swarm.description}</p>
              <Members members={members} />
              <Vocab swarmId={id} />
            </aside>
            {commons}
          </div>
        ) : (
          <div className="flex h-full flex-col px-3 pb-[calc(var(--sab)+84px)]">
            <p className="px-1 pb-3 text-[13px] leading-relaxed text-ink-3">{swarm.description}</p>
            <Segmented<Tab>
              label="Swarm section"
              value={tab}
              onChange={setTab}
              className="mb-3 w-full"
              options={[
                { value: 'commons', label: 'Commons' },
                { value: 'members', label: `Members · ${members.length}` },
                { value: 'vocab', label: 'Vocabulary' },
              ]}
            />
            <div className="min-h-[440px] flex-1">
              {tab === 'commons' ? commons : tab === 'members' ? <Members members={members} /> : <Vocab swarmId={id} />}
            </div>
          </div>
        )}
      </Page>
      <AnimatePresence>{statement && <Provenance key={statement} swarmId={id} statement={statement} onClose={() => select(undefined)} />}</AnimatePresence>
    </>
  )
}

function Members({ members }: { members: Agent[] }) {
  const thinking = useHive((s) => s.thinking)
  const now = useNow(15_000)
  return (
    <section aria-labelledby="mem-h">
      <h2 id="mem-h" className="eyebrow mb-2 px-1">
        Members · {members.length}
      </h2>
      {members.length === 0 ? (
        <p className="px-1 text-sm text-ink-3">No dots in this swarm yet.</p>
      ) : (
        <ul className="space-y-1">
          {members.map((a, i) => (
            <m.li key={a.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}>
              <button onClick={() => navigate({ name: 'dot', id: a.id })} className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2 text-left transition-colors hover:bg-white/[0.05]">
                <Orb hue={a.hue} status={a.status} thinking={thinking[a.id]} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{a.name}</span>
                  <span className="block truncate text-[11px] text-ink-4">
                    {a.kind} · {money(a.spent_usd)} · {ago(a.last_active_at, now)}
                  </span>
                </span>
                <StatusPill status={a.status} thinking={thinking[a.id]} />
              </button>
            </m.li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Vocab({ swarmId }: { swarmId: string }) {
  const client = useHive((s) => s.client)
  const toast = useHive((s) => s.toast)
  const [terms, setTerms] = useState<string[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [fresh, setFresh] = useState<string[]>([])

  useEffect(() => {
    if (!client) return
    client.getVocab(swarmId).then(setTerms, (e: unknown) => setErr(e instanceof Error ? e.message : 'Could not load vocabulary'))
  }, [client, swarmId])

  const add = async (e: FormEvent) => {
    e.preventDefault()
    const list = draft.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean)
    if (!client || !list.length) return
    try {
      const next = await client.addVocab(swarmId, list)
      setFresh(list)
      setTerms(next)
      setDraft('')
    } catch (x) {
      toast({ tone: 'error', title: 'Could not add terms', body: x instanceof Error ? x.message : undefined })
    }
  }

  return (
    <section aria-labelledby="voc-h">
      <h2 id="voc-h" className="eyebrow mb-2 px-1">
        Vocabulary {terms ? `· ${terms.length}` : ''}
      </h2>
      {err ? (
        <p className="px-1 text-sm text-bad">{err}</p>
      ) : !terms ? (
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-16" />
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {terms.length === 0 && <p className="px-1 text-sm text-ink-3">No terms yet. Anything goes until you add some.</p>}
          {terms.map((t) => (
            <m.span
              key={t}
              layout
              initial={fresh.includes(t) ? { opacity: 0, scale: 0.6 } : false}
              animate={{ opacity: 1, scale: 1 }}
              className="inline-flex min-h-7 items-center rounded-lg border border-line bg-white/[0.04] px-2 font-mono text-[12px] text-ink-2"
            >
              {t}
            </m.span>
          ))}
        </div>
      )}
      <form onSubmit={add} className="mt-2.5 flex gap-1.5">
        <label className="sr-only" htmlFor={`voc-${swarmId}`}>
          Add vocabulary terms
        </label>
        <input
          id={`voc-${swarmId}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="add terms, comma separated"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-black/25 px-3 font-mono text-[13px] text-ink outline-none placeholder:font-sans placeholder:text-ink-4 focus:border-line-2"
        />
        <IconButton icon="plus" label="Add terms" type="submit" className="border border-line" disabled={!draft.trim()} />
      </form>
    </section>
  )
}

type SortKey = 'statement' | 'f' | 'c' | 'sources' | 'updated'

function BeliefTable({ beliefs, onSelect, selected }: { beliefs: Belief[]; onSelect: (s: string) => void; selected?: string }) {
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'c', dir: -1 })
  const rows = useMemo(() => {
    const v = (b: Belief) => (sort.k === 'statement' ? b.statement : sort.k === 'f' ? b.tv.f : sort.k === 'c' ? b.tv.c : sort.k === 'sources' ? b.sources.length : b.updated_at)
    return [...beliefs].sort((a, b) => (v(a) < v(b) ? -1 : v(a) > v(b) ? 1 : 0) * sort.dir)
  }, [beliefs, sort])
  const th = (k: SortKey, label: string, cls = '') => (
    <th scope="col" className={cx('px-3 py-2 font-medium', cls)} aria-sort={sort.k === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="inline-flex min-h-8 items-center gap-1 hover:text-ink" onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : -1 }))}>
        {label}
        {sort.k === k && <Icon name="chevronDown" size={12} className={sort.dir === 1 ? 'rotate-180' : ''} />}
      </button>
    </th>
  )
  return (
    <div className="thin-scroll h-full overflow-auto">
      <table className="w-full text-left text-[13px]">
        <thead className="sticky top-0 z-[1] bg-[#0b0b26]/95 text-[11px] text-ink-3 backdrop-blur">
          <tr>
            {th('statement', 'Statement')}
            {th('f', 'f', 'text-right')}
            {th('c', 'c', 'text-right')}
            {th('sources', 'Src', 'text-right hidden sm:table-cell')}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((b) => (
            <tr key={b.statement} onClick={() => onSelect(b.statement)} className={cx('cursor-pointer border-t border-line transition-colors hover:bg-white/[0.04]', selected === b.statement && 'bg-white/[0.07]')}>
              <td className="px-3 py-2.5">
                <button className="text-left" onClick={(e) => (e.stopPropagation(), onSelect(b.statement))}>
                  <MeTTa src={b.statement} />
                </button>
              </td>
              <td className="px-3 py-2.5 text-right font-mono">
                <span className="mr-1.5 inline-block size-2 rounded-full align-middle" style={{ background: freqColor(b.tv.f) }} />
                {b.tv.f.toFixed(2)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono" style={{ opacity: 0.5 + b.tv.c * 0.5 }}>
                {b.tv.c.toFixed(2)}
              </td>
              <td className="hidden px-3 py-2.5 text-right font-mono text-ink-3 sm:table-cell">{b.sources.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
