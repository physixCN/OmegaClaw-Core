/**
 * The tour drives the real app, so it takes a snapshot first and puts everything back afterwards:
 * the route, overlays it opened, and the program sessions (trails) it touched, in memory and in storage.
 */

export interface RestorableState {
  paletteOpen: boolean
  stopAllOpen: boolean
  programSessions: Record<string, unknown>
}

export interface RestoreEnv {
  getHash(): string
  /** Replace the route without adding a history entry. */
  replaceHash(hash: string): void
  getState(): RestorableState
  setState(partial: Partial<RestorableState>): void
  storage: {
    keys(): string[]
    get(key: string): string | null
    set(key: string, value: string): void
    remove(key: string): void
  }
}

export interface Snapshot {
  hash: string
  programSessions: Record<string, unknown>
  storage: Record<string, string>
}

/** Storage the tour may change while it plays (program trails, a program's remembered swarm). */
export const TOUR_TOUCHED_PREFIX = 'omegadots.program.'

export function takeSnapshot(env: RestoreEnv, returnTo?: string): Snapshot {
  const storage: Record<string, string> = {}
  for (const k of safeKeys(env)) {
    if (!k.startsWith(TOUR_TOUCHED_PREFIX)) continue
    const v = safeGet(env, k)
    if (v !== null) storage[k] = v
  }
  return { hash: returnTo ?? env.getHash(), programSessions: env.getState().programSessions, storage }
}

export function restoreSnapshot(env: RestoreEnv, snap: Snapshot): void {
  env.setState({ paletteOpen: false, stopAllOpen: false, programSessions: snap.programSessions })
  for (const k of safeKeys(env)) {
    if (k.startsWith(TOUR_TOUCHED_PREFIX) && !(k in snap.storage)) safe(() => env.storage.remove(k))
  }
  for (const [k, v] of Object.entries(snap.storage)) if (safeGet(env, k) !== v) safe(() => env.storage.set(k, v))
  const hash = snap.hash || '#/'
  if (env.getHash() !== hash) env.replaceHash(hash)
}

function safe(fn: () => void) {
  try {
    fn()
  } catch {
    /* storage unavailable */
  }
}
function safeKeys(env: RestoreEnv): string[] {
  try {
    return env.storage.keys()
  } catch {
    return []
  }
}
function safeGet(env: RestoreEnv, k: string): string | null {
  try {
    return env.storage.get(k)
  } catch {
    return null
  }
}

/** The real environment: location.hash, the zustand store, localStorage. */
export function browserRestoreEnv(store: { getState(): RestorableState; setState(p: Partial<RestorableState>): void }): RestoreEnv {
  return {
    getHash: () => window.location.hash || '#/',
    replaceHash(hash) {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`)
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    },
    getState: () => store.getState(),
    setState: (p) => store.setState(p),
    storage: {
      keys: () => {
        const out: string[] = []
        const ls = window.localStorage
        for (let i = 0; i < ls.length; i++) {
          const k = ls.key(i)
          if (k) out.push(k)
        }
        return out
      },
      get: (k) => window.localStorage.getItem(k),
      set: (k, v) => window.localStorage.setItem(k, v),
      remove: (k) => window.localStorage.removeItem(k),
    },
  }
}
