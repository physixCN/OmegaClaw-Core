import { AnimatePresence, MotionConfig } from 'framer-motion'
import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { useIsDesktop } from './lib/hooks'
import { navigate, useRoute } from './lib/router'
import { HiveScene } from './scene/HiveScene'
import { useScene } from './scene/sceneStore'
import { ActivityTicker, BootScreen, DotDirectory, EmptyHive, Login, SceneControls } from './shell/Ambient'
import { Toasts, TopBar } from './shell/Hud'
import { Nav } from './shell/Nav'
import { useShortcuts } from './shell/shortcuts'
import { useHive } from './store/store'

const DotPanel = lazy(() => import('./features/dot/DotPanel'))
const SwarmsIndex = lazy(() => import('./features/swarm/SwarmsIndex'))
const SwarmView = lazy(() => import('./features/swarm/SwarmView'))
const CreateFlow = lazy(() => import('./features/create/CreateFlow'))
const TokenReveal = lazy(() => import('./features/create/TokenReveal'))
const UsageView = lazy(() => import('./features/usage/UsageView'))
const CommandPalette = lazy(() => import('./features/palette/CommandPalette'))

/**
 * Each lazy view gets its own Suspense boundary: a shared one would re-suspend (and hide)
 * every open view whenever another chunk loads, interrupting their exit animations.
 */
function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>
}

/** Warm the lazy chunks once the hive is idle so the first open is instant. */
function prefetch() {
  const go = () => {
    void import('./features/dot/DotPanel')
    void import('./features/palette/CommandPalette')
    void import('./features/swarm/SwarmView')
    void import('./features/create/CreateFlow')
    void import('./features/swarm/SwarmsIndex')
    void import('./features/usage/UsageView')
    void import('./features/create/TokenReveal')
  }
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 4000 })
  else setTimeout(go, 2500)
}

export function App() {
  const client = useHive((s) => s.client)
  const ready = useHive((s) => s.ready)
  const bootError = useHive((s) => s.bootError)
  const connection = useHive((s) => s.connection)
  const paletteOpen = useHive((s) => s.paletteOpen)
  const reveal = useHive((s) => s.reveal)
  const hydrate = useHive((s) => s.hydrate)
  const route = useRoute()
  const setDimmed = useScene((s) => s.setDimmed)
  useShortcuts()

  const page = route.name === 'swarms' || route.name === 'swarm' || route.name === 'usage'
  useEffect(() => setDimmed(page), [page, setDimmed])
  // keep the camera centred in the space the HUD leaves free
  const desktop = useIsDesktop()
  const setInset = useScene((s) => s.setInset)
  useEffect(() => {
    setInset('hud', ready ? (desktop ? { top: 76, left: 72, bottom: 20 } : { top: 150, bottom: 128 }) : null)
  }, [desktop, ready, setInset])
  useEffect(() => {
    if (ready) prefetch()
  }, [ready])

  // unknown dot ids fall back to the hive once data is in
  useEffect(() => {
    if (route.name === 'swarm' && ready && !useHive.getState().swarms[route.id]) navigate({ name: 'swarms' }, { replace: true })
  }, [route, ready])

  const needsLogin = !!client && (connection === 'unauthorized' || (client.needsAuth() && !ready))

  return (
    <MotionConfig reducedMotion="user">
      <HiveScene />
      {needsLogin ? (
        <Login />
      ) : !ready ? (
        <BootScreen error={bootError} onRetry={() => void hydrate()} />
      ) : (
        <>
          {!page && <TopBar />}
          <Nav />
          <ActivityTicker />
          <SceneControls />
          <DotDirectory />
          <EmptyHive />
          <AnimatePresence>
            {route.name === 'dot' && (
              <Lazy key="dot">
                <DotPanel id={route.id} />
              </Lazy>
            )}
            {route.name === 'new' && (
              <Lazy key="new">
                <CreateFlow swarmId={route.swarm} />
              </Lazy>
            )}
          </AnimatePresence>
          <AnimatePresence mode="wait">
            {route.name === 'swarms' && (
              <Lazy key="swarms">
                <SwarmsIndex />
              </Lazy>
            )}
            {route.name === 'swarm' && (
              <Lazy key={`swarm-${route.id}`}>
                <SwarmView id={route.id} statement={route.statement} />
              </Lazy>
            )}
            {route.name === 'usage' && (
              <Lazy key="usage">
                <UsageView />
              </Lazy>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {reveal && (
              <Lazy key="reveal">
                <TokenReveal />
              </Lazy>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {paletteOpen && (
              <Lazy key="palette">
                <CommandPalette />
              </Lazy>
            )}
          </AnimatePresence>
        </>
      )}
      <Toasts />
    </MotionConfig>
  )
}
