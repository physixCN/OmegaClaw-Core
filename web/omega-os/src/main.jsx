import './styles.css'
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { OmegaApi } from './api/OmegaApi.js'
import { OmegaRoom } from './scene/OmegaRoom.jsx'
import { SplineStage } from './scene/SplineStage.js'
import { WindowManager } from './ui/WindowManager.js'

const api = new OmegaApi()
const scene = new SplineStage(document.querySelector('#omega-canvas'))
const windows = new WindowManager(api, scene)

document.body.dataset.omegaOs = 'ready'
document.body.dataset.renderer = 'r3f-spline-runtime'

function OmegaVisualApp() {
  const [state, setState] = useState({
    running: false,
    activeSurface: scene.variables.active_surface,
    inputText: '',
    inputKind: 'idle',
    inputFocus: 'none'
  })

  useEffect(() => {
    const sync = event => {
      setState(current => ({
        ...current,
        activeSurface: event.detail?.active_surface || scene.variables.active_surface || 'idle'
      }))
    }
    const overview = event => {
      setState(current => ({
        ...current,
        running: Boolean(event.detail?.omega?.running)
      }))
    }
    const input = event => {
      setState(current => ({
        ...current,
        inputText: event.detail?.text || '',
        inputKind: event.detail?.kind || 'idle',
        inputFocus: event.detail?.focus || 'none'
      }))
    }
    window.addEventListener('omegaos:surface', sync)
    window.addEventListener('omegaos:overview', overview)
    window.addEventListener('omegaos:input', input)
    return () => {
      window.removeEventListener('omegaos:surface', sync)
      window.removeEventListener('omegaos:overview', overview)
      window.removeEventListener('omegaos:input', input)
    }
  }, [])

  return (
    <OmegaRoom
      running={state.running}
      activeSurface={state.activeSurface}
      inputText={state.inputText}
      inputKind={state.inputKind}
      inputFocus={state.inputFocus}
    />
  )
}

createRoot(document.querySelector('#r3f-root')).render(<OmegaVisualApp />)

async function refreshState() {
  try {
    const [overview] = await Promise.allSettled([api.overview()])
    if (overview.status === 'fulfilled') {
      scene.applyOverview(overview.value)
      window.dispatchEvent(new CustomEvent('omegaos:overview', { detail: overview.value }))
    }
  } catch {
    // The public landing can render without privileged Omega state.
  }
}

scene.render()
refreshState()
setInterval(refreshState, 3500)

window.omegaOS = {
  renderer: 'r3f-spline-runtime',
  scene,
  windows,
  api,
  frameMs: () => scene.averageFrameMs()
}
