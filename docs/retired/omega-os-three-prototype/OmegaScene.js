import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { LiquidWalls } from './LiquidWalls.js'
import { ThoughtGraph } from './ThoughtGraph.js'
import { AtomClouds } from './AtomClouds.js'

export class OmegaScene {
  constructor(canvas) {
    this.canvas = canvas
    this.pointer = new THREE.Vector2(.5, .5)
    this.targetQuaternion = new THREE.Quaternion()
    this.drag = { active: false, moved: false, x: 0, y: 0, track: new THREE.Vector3() }
    this.lastGestureDragged = false
    this.recursion = { value: 0, target: 0, ratio: 7 }
    this.quality = { level: 'high', scale: 1, lastCheck: 0 }
    this.state = { thoughtSpeed: 1, activity: .28, quality: 1 }
    this.roomSurfaces = []
    this.raycaster = new THREE.Raycaster()
    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.FogExp2(0xdceee5, .018)

    this.camera = new THREE.PerspectiveCamera(58, 1, .1, 180)
    this.camera.position.set(0, 1.15, 12.5)

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.setClearColor(0xdceee5, 1)

    this.composer = new EffectComposer(this.renderer)
    this.renderPass = new RenderPass(this.scene, this.camera)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .2, .34, .2)
    this.composer.addPass(this.renderPass)
    this.composer.addPass(this.bloom)

    this.mindRoot = new THREE.Group()
    this.scene.add(this.mindRoot)
    this.roomRoot = new THREE.Group()
    this.scene.add(this.roomRoot)
    this.liquidWalls = new LiquidWalls(this.mindRoot)
    this.atomClouds = new AtomClouds(this.mindRoot)
    this.graphLayers = [-1, 0, 1].map(offset => ({
      offset,
      graph: new ThoughtGraph(this.mindRoot, { radius: 60 })
    }))
    this.graph = this.graphLayers.find(layer => layer.offset === 0).graph
    this.mindRoot.visible = false
    this.clock = new THREE.Clock()
    this.frameTimes = []

    this.addAtmosphere()
    this.createRoomShell()
    this.applyQualityLevel(this.preferredInitialQuality())
    this.resize()
    window.addEventListener('resize', () => this.resize())
    document.addEventListener('visibilitychange', () => {
      this.applyQualityLevel(document.hidden ? 'low' : this.quality.level)
    })
    window.addEventListener('pointermove', event => this.onPointer(event), { passive: true })
    canvas.addEventListener('pointerdown', event => this.onDragStart(event))
    canvas.addEventListener('pointerup', event => this.onDragEnd(event), { passive: true })
    canvas.addEventListener('wheel', event => this.onWheel(event), { passive: false })
    window.addEventListener('pointerup', event => this.onDragEnd(event), { passive: true })
    canvas.dataset.renderer = 'three-webgl'
  }

  addAtmosphere() {
    const ambient = new THREE.AmbientLight(0xffffff, .82)
    this.scene.add(ambient)
    const key = new THREE.DirectionalLight(0xffffff, .72)
    key.position.set(-5, 7, 10)
    this.scene.add(key)
    const rim = new THREE.PointLight(0x18d9b4, .52, 28)
    rim.position.set(0, 2.5, -10)
    this.scene.add(rim)

    const starMaterial = new THREE.PointsMaterial({
      size: .022,
      color: 0x7fcfbc,
      transparent: true,
      opacity: .045,
      blending: THREE.NormalBlending,
      depthWrite: false
    })
    const positions = []
    for (let i = 0; i < 980; i += 1) {
      const radius = 24 + Math.random() * 96
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(Math.random() * 2 - 1)
      positions.push(
        Math.cos(theta) * Math.sin(phi) * radius,
        Math.sin(theta) * Math.sin(phi) * radius,
        Math.cos(phi) * radius
      )
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    this.stars = new THREE.Points(geometry, starMaterial)
    this.scene.add(this.stars)
  }

  createRoomShell() {
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0xe8f5ee,
      roughness: .9,
      metalness: 0,
      transparent: true,
      opacity: .96,
      side: THREE.DoubleSide
    })
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0xd9eee4,
      roughness: .94,
      metalness: 0,
      side: THREE.DoubleSide
    })
    const ceilingMaterial = new THREE.MeshStandardMaterial({
      color: 0xf4fbf7,
      roughness: .88,
      metalness: 0,
      side: THREE.DoubleSide
    })
    const createPlane = (name, width, height, material, position, rotation) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 1, 1), material.clone())
      mesh.name = name
      mesh.userData.roomSurface = name
      mesh.position.copy(position)
      mesh.rotation.set(rotation.x, rotation.y, rotation.z)
      this.roomRoot.add(mesh)
      this.roomSurfaces.push(mesh)
      return mesh
    }
    createPlane('room-floor', 34, 34, floorMaterial, new THREE.Vector3(0, -4.2, -10), new THREE.Vector3(-Math.PI / 2, 0, 0))
    createPlane('room-ceiling', 34, 34, ceilingMaterial, new THREE.Vector3(0, 7.2, -10), new THREE.Vector3(Math.PI / 2, 0, 0))
    createPlane('room-back-wall', 34, 12, wallMaterial, new THREE.Vector3(0, 1.5, -26.8), new THREE.Vector3(0, 0, 0))
    createPlane('room-left-wall', 34, 12, wallMaterial, new THREE.Vector3(-17, 1.5, -10), new THREE.Vector3(0, Math.PI / 2, 0))
    createPlane('room-right-wall', 34, 12, wallMaterial, new THREE.Vector3(17, 1.5, -10), new THREE.Vector3(0, -Math.PI / 2, 0))

    const seamMaterial = new THREE.LineBasicMaterial({
      color: 0x7fb6a3,
      transparent: true,
      opacity: .18,
      depthWrite: false
    })
    const seamPoints = [
      [-17, -4.18, -26.7], [17, -4.18, -26.7],
      [-17, 7.18, -26.7], [17, 7.18, -26.7],
      [-16.9, -4.18, 7], [-16.9, -4.18, -26.7],
      [16.9, -4.18, 7], [16.9, -4.18, -26.7],
      [-16.9, 7.18, 7], [-16.9, 7.18, -26.7],
      [16.9, 7.18, 7], [16.9, 7.18, -26.7],
    ].map(point => new THREE.Vector3(...point))
    const seamGeometry = new THREE.BufferGeometry().setFromPoints(seamPoints)
    const seams = new THREE.LineSegments(seamGeometry, seamMaterial)
    seams.name = 'room-neumorphic-seams'
    this.roomRoot.add(seams)

    const centerGlow = new THREE.Mesh(
      new THREE.CircleGeometry(5.6, 72),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: .38,
        depthWrite: false
      })
    )
    centerGlow.name = 'room-soft-center'
    centerGlow.position.set(0, 1.2, -26.6)
    this.roomRoot.add(centerGlow)
  }

  resize() {
    const width = window.innerWidth || 1
    const height = window.innerHeight || 1
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
    this.composer.setSize(width, height)
    this.bloom.setSize(width, height)
  }

  preferredInitialQuality() {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    const lowMemory = navigator.deviceMemory && navigator.deviceMemory <= 8
    return reducedMotion || lowMemory ? 'medium' : 'high'
  }

  applyQualityLevel(level) {
    const chosen = ['low', 'medium', 'high'].includes(level) ? level : 'medium'
    this.quality.level = chosen
    this.quality.scale = chosen === 'low' ? .48 : (chosen === 'medium' ? .72 : 1)
    this.state.quality = this.quality.scale
    const pixelRatioCap = chosen === 'low' ? .78 : (chosen === 'medium' ? 1 : 1.25)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap))
    this.bloom.strength = chosen === 'low' ? .1 : (chosen === 'medium' ? .15 : .2)
    this.bloom.radius = chosen === 'low' ? .18 : (chosen === 'medium' ? .27 : .34)
    if (this.stars) {
      this.stars.material.opacity = chosen === 'low' ? .07 : (chosen === 'medium' ? .11 : .15)
      this.stars.material.size = chosen === 'low' ? .015 : (chosen === 'medium' ? .018 : .022)
    }
    this.canvas.dataset.quality = chosen
  }

  adjustQuality(time) {
    if (time - this.quality.lastCheck < 2.4) return
    this.quality.lastCheck = time
    if (document.hidden) {
      this.applyQualityLevel('low')
      return
    }
    const frameMs = this.averageFrameMs()
    if (!frameMs) return
    if (frameMs > 34 && this.quality.level !== 'low') this.applyQualityLevel('low')
    else if (frameMs > 24 && this.quality.level === 'high') this.applyQualityLevel('medium')
    else if (frameMs < 17 && this.quality.level === 'low') this.applyQualityLevel('medium')
    else if (frameMs < 14 && this.quality.level === 'medium') this.applyQualityLevel('high')
  }

  onPointer(event) {
    this.pointer.set(event.clientX / window.innerWidth, 1 - event.clientY / window.innerHeight)
    if (!this.drag.active) return
    const dx = event.clientX - this.drag.x
    const dy = event.clientY - this.drag.y
    if (Math.hypot(dx, dy) > 6) this.drag.moved = true
  }

  onDragStart(event) {
    if (event.button !== 0) return
    this.drag.active = true
    this.drag.moved = false
    this.drag.x = event.clientX
    this.drag.y = event.clientY
    this.drag.track.copy(this.trackballVector(event))
    this.lastGestureDragged = false
  }

  onDragEnd() {
    if (!this.drag.active) return
    this.lastGestureDragged = this.drag.moved
    this.drag.active = false
    window.setTimeout(() => {
      this.lastGestureDragged = false
    }, 120)
  }

  onWheel(event) {
    event.preventDefault()
    this.recursion.target += THREE.MathUtils.clamp(event.deltaY, -160, 160) * -.0028
  }

  trackballVector(event) {
    const x = (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1
    const y = 1 - (event.clientY / Math.max(1, window.innerHeight)) * 2
    const z2 = 1 - x * x - y * y
    const z = z2 > 0 ? Math.sqrt(z2) : 0
    return new THREE.Vector3(x, y, z).normalize()
  }

  focusNode(id = 'provider', event = null) {
    this.graph.focusNode(id)
  }

  pointerDirection(event) {
    const ndc = new THREE.Vector3(
      (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1,
      -(event.clientY / Math.max(1, window.innerHeight)) * 2 + 1,
      .5
    )
    return ndc.unproject(this.camera).sub(this.camera.position).normalize()
  }

  surfacePose(event) {
    if (!event || !this.roomSurfaces.length) return null
    const x = event.clientX ?? window.innerWidth / 2
    const y = event.clientY ?? window.innerHeight / 2
    const ndc = new THREE.Vector2(
      (x / Math.max(1, window.innerWidth)) * 2 - 1,
      -(y / Math.max(1, window.innerHeight)) * 2 + 1
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    const hit = this.raycaster.intersectObjects(this.roomSurfaces, false)[0]
    if (!hit) return null
    const surface = hit.object.userData.roomSurface || hit.object.name || 'room-surface'
    const localX = (x / Math.max(1, window.innerWidth)) - .5
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize()
    const pose = {
      surface,
      depth: 22,
      tiltX: 0,
      tiltY: 0,
      world: hit.point.toArray(),
      normal: normal.toArray()
    }
    if (surface === 'room-floor') {
      pose.tiltX = 13
      pose.tiltY = THREE.MathUtils.clamp(localX * 8, -5, 5)
      pose.depth = 18
    } else if (surface === 'room-ceiling') {
      pose.tiltX = -12
      pose.tiltY = THREE.MathUtils.clamp(localX * 6, -4, 4)
      pose.depth = 16
    } else if (surface === 'room-left-wall') {
      pose.tiltY = -15
      pose.tiltX = -2
      pose.depth = 26
    } else if (surface === 'room-right-wall') {
      pose.tiltY = 15
      pose.tiltX = -2
      pose.depth = 26
    } else {
      pose.tiltX = -1
      pose.tiltY = THREE.MathUtils.clamp(localX * 5, -3, 3)
      pose.depth = 24
    }
    return pose
  }

  pickAtom(event) {
    return null
  }

  applyBrain(brain) {
    const activeSpaces = (brain?.spaces || []).filter(space => Number(space.recent_activity || 0) > 0).length
    const liveNodes = (brain?.architecture?.nodes || []).filter(node => Number(node.activity || 0) > 0).length
    this.state.activity = Math.min(1, .16 + activeSpaces * .07 + liveNodes * .035)
  }

  applyOverview(overview) {
    this.state.thoughtSpeed = overview?.omega?.running ? 1 : .42
  }

  render() {
    const dt = this.clock.getDelta()
    const time = this.clock.elapsedTime
    this.frameTimes.push(dt)
    if (this.frameTimes.length > 90) this.frameTimes.shift()
    this.adjustQuality(time)

    this.camera.position.set(0, 1.15, 12.5)
    this.camera.lookAt(0, .8, -12)
    this.recursion.value += (this.recursion.target - this.recursion.value) * .12
    const phase = ((this.recursion.value % 1) + 1) % 1
    this.camera.zoom = 1
    this.camera.updateProjectionMatrix()
    this.updateRecursiveGraphStack(phase)
    this.stars.rotation.y = time * .001
    this.roomRoot.position.y = Math.sin(time * .28) * .018
    this.composer.render()
    requestAnimationFrame(() => this.render())
  }

  averageFrameMs() {
    if (!this.frameTimes.length) return 0
    return this.frameTimes.reduce((sum, value) => sum + value, 0) / this.frameTimes.length * 1000
  }

  updateRecursiveGraphStack(phase) {
    const ratio = this.recursion.ratio
    this.graphLayers.forEach(layer => {
      const exponent = layer.offset + phase
      const scale = Math.pow(ratio, exponent)
      const distance = Math.abs(exponent)
      const alpha = THREE.MathUtils.clamp(.4 - distance * .2, .012, .36)
      layer.graph.group.scale.setScalar(scale)
      layer.graph.setLayerAlpha(alpha)
      layer.graph.setRecursion(phase)
      layer.graph.group.visible = alpha > .025
    })
  }
}
