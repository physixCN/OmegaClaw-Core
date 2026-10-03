import { useSyncExternalStore } from 'react'

export type DotTab = 'chat' | 'mind' | 'memory' | 'schedule' | 'model'
export type ApprovalsTab = 'pending' | 'history' | 'rules'
const DOT_TABS: DotTab[] = ['chat', 'mind', 'memory', 'schedule', 'model']
const APPROVAL_TABS: ApprovalsTab[] = ['pending', 'history', 'rules']

export type Route =
  | { name: 'hive' }
  | { name: 'dot'; id: string; tab?: DotTab; program?: string }
  | { name: 'swarms' }
  | { name: 'swarm'; id: string; statement?: string }
  | { name: 'new'; swarm?: string }
  | { name: 'usage' }
  | { name: 'approvals'; tab?: ApprovalsTab; focus?: string }
  | { name: 'goals'; swarm?: string }
  | { name: 'lab'; suite?: string; run?: string; tab?: LabTab; dimension?: string }
  | { name: 'programs' }
  | { name: 'program'; id: string; swarm?: string }

export type LabTab = 'run' | 'history'

export function parse(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/'
  const [path, query = ''] = raw.split('?')
  const q = new URLSearchParams(query)
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent)
  switch (parts[0]) {
    case 'dot':
      if (parts[1] && parts[2] === 'program' && parts[3]) return { name: 'dot', id: parts[1], program: parts[3] }
      return parts[1] ? { name: 'dot', id: parts[1], tab: DOT_TABS.find((t) => t === parts[2]) } : { name: 'hive' }
    case 'programs':
      return { name: 'programs' }
    case 'program':
      return parts[1] ? { name: 'program', id: parts[1], swarm: parts[2] } : { name: 'programs' }
    case 'swarms':
      return parts[1] ? { name: 'swarm', id: parts[1], statement: q.get('b') ?? undefined } : { name: 'swarms' }
    case 'new':
      return { name: 'new', swarm: q.get('swarm') ?? undefined }
    case 'usage':
      return { name: 'usage' }
    case 'approvals':
      return { name: 'approvals', tab: APPROVAL_TABS.find((t) => t === parts[1]), focus: q.get('id') ?? undefined }
    case 'goals':
      return { name: 'goals', swarm: parts[1] }
    case 'lab':
      if (parts[1] === 'run' && parts[2]) return { name: 'lab', run: parts[2] }
      if (parts[1] === 'dim' && parts[2]) return { name: 'lab', dimension: parts[2] }
      return parts[1] ? { name: 'lab', suite: parts[1], tab: parts[2] === 'history' ? 'history' : undefined } : { name: 'lab' }
    default:
      return { name: 'hive' }
  }
}

export function href(r: Route): string {
  switch (r.name) {
    case 'hive':
      return '#/'
    case 'dot':
      if (r.program) return `#/dot/${encodeURIComponent(r.id)}/program/${encodeURIComponent(r.program)}`
      return `#/dot/${encodeURIComponent(r.id)}${r.tab && r.tab !== 'chat' ? `/${r.tab}` : ''}`
    case 'programs':
      return '#/programs'
    case 'program':
      return `#/program/${encodeURIComponent(r.id)}${r.swarm ? `/${encodeURIComponent(r.swarm)}` : ''}`
    case 'swarms':
      return '#/swarms'
    case 'swarm':
      return `#/swarms/${encodeURIComponent(r.id)}${r.statement ? `?b=${encodeURIComponent(r.statement)}` : ''}`
    case 'new':
      return `#/new${r.swarm ? `?swarm=${encodeURIComponent(r.swarm)}` : ''}`
    case 'usage':
      return '#/usage'
    case 'approvals':
      return `#/approvals${r.tab && r.tab !== 'pending' ? `/${r.tab}` : ''}${r.focus ? `?id=${encodeURIComponent(r.focus)}` : ''}`
    case 'goals':
      return `#/goals${r.swarm ? `/${encodeURIComponent(r.swarm)}` : ''}`
    case 'lab':
      if (r.run) return `#/lab/run/${encodeURIComponent(r.run)}`
      if (r.dimension) return `#/lab/dim/${encodeURIComponent(r.dimension)}`
      return `#/lab${r.suite ? `/${encodeURIComponent(r.suite)}${r.tab === 'history' ? '/history' : ''}` : ''}`
  }
}

export function navigate(r: Route, opts: { replace?: boolean } = {}): void {
  const h = href(r)
  if (window.location.hash === h) return
  if (opts.replace) {
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}${h}`)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else {
    window.location.hash = h
  }
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}
const snapshot = () => window.location.hash

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, snapshot, () => '')
  return parse(hash)
}
