import { Application } from '@splinetool/runtime'

const DEFAULT_VARIABLES = {
  omega_running: false,
  omega_activity: 0.28,
  thought_speed: 0.42,
  floor_console_open: false,
  inbox_attention: 0,
  house_attention: 0,
  memory_pressure: 0,
  active_surface: 'idle'
}

export class SplineStage {
  constructor(canvas) {
    this.canvas = canvas
    this.app = null
    this.ready = false
    this.lastGestureDragged = false
    this.sceneUrl = this.resolveSceneUrl()
    this.variables = { ...DEFAULT_VARIABLES }
    this.objects = {}
    this.fallback = null
    this.drag = { active: false, moved: false, x: 0, y: 0 }
    this.bindGestures()
    this.load()
    canvas.dataset.renderer = 'spline-runtime'
  }

  resolveSceneUrl() {
    const params = new URLSearchParams(location.search)
    return (
      params.get('spline') ||
      localStorage.getItem('omegaSplineSceneUrl') ||
      import.meta.env?.VITE_OMEGA_SPLINE_SCENE_URL ||
      ''
    ).trim()
  }

  bindGestures() {
    this.canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      this.drag.active = true
      this.drag.moved = false
      this.drag.x = event.clientX
      this.drag.y = event.clientY
      this.lastGestureDragged = false
    })
    window.addEventListener('pointermove', event => {
      if (!this.drag.active) return
      if (Math.hypot(event.clientX - this.drag.x, event.clientY - this.drag.y) > 6) {
        this.drag.moved = true
      }
    }, { passive: true })
    window.addEventListener('pointerup', () => {
      if (!this.drag.active) return
      this.lastGestureDragged = this.drag.moved
      this.drag.active = false
      window.setTimeout(() => {
        this.lastGestureDragged = false
      }, 120)
    }, { passive: true })
  }

  async load() {
    if (!this.sceneUrl) {
      this.canvas.dataset.splineState = 'waiting-for-scene'
      this.canvas.hidden = true
      return
    }
    try {
      this.canvas.hidden = false
      this.app = new Application(this.canvas, { renderMode: 'continuous' })
      await this.app.load(this.sceneUrl, this.variables)
      this.ready = true
      this.canvas.dataset.splineState = 'loaded'
      this.fallback?.remove()
      this.indexNamedObjects()
      this.bindSplineEvents()
    } catch (err) {
      this.canvas.dataset.splineState = 'failed'
      this.canvas.dataset.splineError = err?.message || String(err)
    }
  }

  indexNamedObjects() {
    const names = [
      'Omega_Core',
      'Floor_Console',
      'Chat_Surface',
      'Inbox_Surface',
      'Family_Wall',
      'Artifact_Floor',
      'Atomspace_Walls',
      'Memory_Wall',
      'House_Control_Surface'
    ]
    this.objects = Object.fromEntries(
      names.map(name => [name, this.app?.findObjectByName(name)]).filter(([, object]) => object)
    )
  }

  bindSplineEvents() {
    this.app?.addEventListener?.('mouseDown', event => {
      const name = event?.target?.name || ''
      if (name === 'Chat_Surface' || name === 'Floor_Console' || name === 'Omega_Core') {
        this.setVariable('floor_console_open', true)
        this.setVariable('active_surface', 'chat')
      }
    })
  }

  setVariable(name, value) {
    this.variables[name] = value
    if (this.ready) this.app?.setVariable?.(name, value)
    window.dispatchEvent(new CustomEvent('omegaos:surface', { detail: { ...this.variables } }))
  }

  setVariables(values) {
    Object.entries(values).forEach(([name, value]) => {
      this.variables[name] = value
    })
    if (this.ready) this.app?.setVariables?.(values)
    window.dispatchEvent(new CustomEvent('omegaos:surface', { detail: { ...this.variables } }))
  }

  focusNode(id = 'provider') {
    const surfaceByNode = {
      provider: 'chat',
      inbox: 'inbox',
      memory: 'memory',
      house: 'house',
      artifacts: 'artifacts'
    }
    this.setVariable('floor_console_open', true)
    this.setVariable('active_surface', surfaceByNode[id] || id)
    this.objects.Floor_Console?.emitEvent?.('mouseDown')
  }

  openSurface(surface = 'chat') {
    this.setVariable('floor_console_open', true)
    this.setVariable('active_surface', surface)
    window.dispatchEvent(new CustomEvent('omegaos:surface', { detail: { ...this.variables } }))
  }

  pickAtom() {
    return null
  }

  applyBrain(brain) {
    const activeSpaces = (brain?.spaces || []).filter(space => Number(space.recent_activity || 0) > 0).length
    const liveNodes = (brain?.architecture?.nodes || []).filter(node => Number(node.activity || 0) > 0).length
    this.setVariables({
      omega_activity: Math.min(1, .16 + activeSpaces * .07 + liveNodes * .035),
      memory_pressure: Math.min(1, activeSpaces / 8)
    })
  }

  applyOverview(overview) {
    this.setVariables({
      omega_running: Boolean(overview?.omega?.running),
      thought_speed: overview?.omega?.running ? 1 : .42
    })
  }

  render() {
    // Spline owns its own render loop. This method keeps WindowManager/main.js compatible.
  }

  averageFrameMs() {
    return 0
  }
}
