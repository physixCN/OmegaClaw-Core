import '@fontsource-variable/inter'
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/jetbrains-mono'
import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createClient } from './api/client'
import { useHive } from './store/store'

// The static demo opens on the Lab: it exists to review the recorded tests and benchmarks.
if (import.meta.env.MODE === 'demo' && !window.location.hash) history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/lab`)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

createClient()
  .then((client) => useHive.getState().init(client))
  .catch((err: unknown) => useHive.setState({ bootError: err instanceof Error ? err.message : String(err) }))
