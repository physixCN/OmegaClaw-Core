import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'hive' }
  | { name: 'dot'; id: string }
  | { name: 'swarms' }
  | { name: 'swarm'; id: string; statement?: string }
  | { name: 'new'; swarm?: string }
  | { name: 'usage' }

export function parse(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/'
  const [path, query = ''] = raw.split('?')
  const q = new URLSearchParams(query)
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent)
  switch (parts[0]) {
    case 'dot':
      return parts[1] ? { name: 'dot', id: parts[1] } : { name: 'hive' }
    case 'swarms':
      return parts[1] ? { name: 'swarm', id: parts[1], statement: q.get('b') ?? undefined } : { name: 'swarms' }
    case 'new':
      return { name: 'new', swarm: q.get('swarm') ?? undefined }
    case 'usage':
      return { name: 'usage' }
    default:
      return { name: 'hive' }
  }
}

export function href(r: Route): string {
  switch (r.name) {
    case 'hive':
      return '#/'
    case 'dot':
      return `#/dot/${encodeURIComponent(r.id)}`
    case 'swarms':
      return '#/swarms'
    case 'swarm':
      return `#/swarms/${encodeURIComponent(r.id)}${r.statement ? `?b=${encodeURIComponent(r.statement)}` : ''}`
    case 'new':
      return `#/new${r.swarm ? `?swarm=${encodeURIComponent(r.swarm)}` : ''}`
    case 'usage':
      return '#/usage'
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
