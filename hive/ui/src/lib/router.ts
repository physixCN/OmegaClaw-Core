import { useSyncExternalStore } from 'react'

export type DotTab = 'chat' | 'mind' | 'memory' | 'schedule' | 'model'
export type ApprovalsTab = 'pending' | 'history' | 'rules'
const DOT_TABS: DotTab[] = ['chat', 'mind', 'memory', 'schedule', 'model']
const APPROVAL_TABS: ApprovalsTab[] = ['pending', 'history', 'rules']

export type Route =
  | { name: 'hive' }
  | { name: 'dot'; id: string; tab?: DotTab }
  | { name: 'swarms' }
  | { name: 'swarm'; id: string; statement?: string }
  | { name: 'new'; swarm?: string }
  | { name: 'usage' }
  | { name: 'approvals'; tab?: ApprovalsTab; focus?: string }
  | { name: 'goals'; swarm?: string }

export function parse(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/'
  const [path, query = ''] = raw.split('?')
  const q = new URLSearchParams(query)
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent)
  switch (parts[0]) {
    case 'dot':
      return parts[1] ? { name: 'dot', id: parts[1], tab: DOT_TABS.find((t) => t === parts[2]) } : { name: 'hive' }
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
    default:
      return { name: 'hive' }
  }
}

export function href(r: Route): string {
  switch (r.name) {
    case 'hive':
      return '#/'
    case 'dot':
      return `#/dot/${encodeURIComponent(r.id)}${r.tab && r.tab !== 'chat' ? `/${r.tab}` : ''}`
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
