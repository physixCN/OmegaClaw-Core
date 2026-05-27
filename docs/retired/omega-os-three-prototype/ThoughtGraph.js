import * as THREE from 'three'

const COLORS = {
  default: 0x079f89,
  provider: 0x00a7c8,
  metta: 0x12b886,
  memory: 0x16866f,
  assume: 0x4c9dff,
  body: 0x28b475,
  immune: 0xd59d43,
  active: 0xffffff
}

const SHELL_RADIUS = 60

const CLUSTER_DIRECTIONS = {
  metta: new THREE.Vector3(0, .06, -1),
  provider: new THREE.Vector3(-.7, .34, -.62),
  memory: new THREE.Vector3(.68, .16, -.72),
  assume: new THREE.Vector3(-.58, -.46, -.68),
  body: new THREE.Vector3(.62, -.48, -.62),
  immune: new THREE.Vector3(0, .82, -.57)
}

const DEFAULT_NODES = [
  { id: 'loop', activity: 1 },
  { id: 'metta', activity: 1 },
  { id: 'provider', activity: 1 },
  { id: 'spaces', activity: 1 },
  { id: 'skills', activity: 1 },
  { id: 'actions', activity: 1 },
  { id: 'assume', activity: 0 }
]

const DEFAULT_FLOWS = [
  { from: 'loop', to: 'provider', active: true },
  { from: 'provider', to: 'metta', active: true },
  { from: 'metta', to: 'spaces', active: true },
  { from: 'metta', to: 'skills', active: true },
  { from: 'skills', to: 'actions', active: true },
  { from: 'metta', to: 'assume', active: false }
]

let pulseTexture = null

function getPulseTexture() {
  if (pulseTexture) return pulseTexture
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 31)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(.22, 'rgba(255,255,255,.88)')
  gradient.addColorStop(.56, 'rgba(255,255,255,.22)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 64, 64)
  pulseTexture = new THREE.CanvasTexture(canvas)
  pulseTexture.colorSpace = THREE.SRGBColorSpace
  return pulseTexture
}

function hashUnit(value) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967295
}

function nodeCluster(id = '', layer = '') {
  const key = `${id} ${layer}`.toLowerCase()
  if (/(provider|llm|openrouter|model|glm|qwen|cognition)/.test(key)) return 'provider'
  if (/(memory|persistent|world|belief|event|agenda|history|chroma|atomspace|space)/.test(key)) return 'memory'
  if (/(assume|fabric|predict|causal|graph)/.test(key)) return 'assume'
  if (/(skill|action|whatsapp|telegram|home|house|web|vision|image|video|body|sense|device|channel|habitat|receive)/.test(key)) return 'body'
  if (/(immune|ecan|attention|energy|syntax|guard|hygiene|sleep)/.test(key)) return 'immune'
  return 'metta'
}

function tangentFrame(direction) {
  const normal = direction.clone().normalize()
  const reference = Math.abs(normal.y) > .86 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  const tangent = new THREE.Vector3().crossVectors(reference, normal).normalize()
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize()
  return { normal, tangent, bitangent }
}

function nodePosition(id, ordinal, totalInCluster, clusterName, radius = SHELL_RADIUS) {
  const direction = (CLUSTER_DIRECTIONS[clusterName] || CLUSTER_DIRECTIONS.metta).clone().normalize()
  const { normal, tangent, bitangent } = tangentFrame(direction)
  const angle = Math.PI * 2 * ((ordinal / Math.max(1, totalInCluster)) + hashUnit(`${id}:a`) * .12)
  const scatter = radius * (.035 + hashUnit(`${id}:r`) * .055)
  const raw = normal.multiplyScalar(radius)
    .add(tangent.multiplyScalar(Math.cos(angle) * scatter))
    .add(bitangent.multiplyScalar(Math.sin(angle) * scatter))
  return raw.normalize().multiplyScalar(radius)
}

function webKnotPoints(center, radius, seed) {
  const direction = center.clone().normalize()
  const { tangent, bitangent } = tangentFrame(direction)
  const points = []
  const count = 24
  for (let i = 0; i < count; i += 1) {
    const a = ((i / count) - .5) * radius * (2.1 + hashUnit(`${seed}:sx`) * .9)
    const b = (hashUnit(`${seed}:${i}:b`) - .5) * radius * 1.7
    const c = (hashUnit(`${seed}:${i}:c`) - .5) * radius * .62
    points.push(center.clone()
      .add(tangent.clone().multiplyScalar(a))
      .add(bitangent.clone().multiplyScalar(b))
      .add(direction.clone().multiplyScalar(c)))
  }
  const segments = []
  for (let i = 0; i < count; i += 1) {
    const a = points[i]
    const b = points[(i + 3 + (i % 5)) % count]
    const mid = a.clone().lerp(b, .5).normalize().multiplyScalar(center.length() + radius * (.3 + hashUnit(`${seed}:m:${i}`) * .9))
    segments.push(a, mid, mid, b)
  }
  return segments
}

function normalizeActivity(value) {
  const number = Number(value || 0)
  if (!Number.isFinite(number) || number <= 0) return 0
  return Math.min(1, Math.log10(number + 1) / 2.2)
}

function nodeGeometry(id, clusterName, radius) {
  if (id === 'loop') return new THREE.TorusGeometry(radius * 1.7, radius * .22, 10, 44)
  if (id === 'metta') return new THREE.IcosahedronGeometry(radius * 1.42, 1)
  if (clusterName === 'provider') return new THREE.OctahedronGeometry(radius * 1.55, 0)
  if (clusterName === 'memory') return new THREE.BoxGeometry(radius * 1.55, radius * 1.55, radius * 1.55, 1, 1, 1)
  if (clusterName === 'assume') return new THREE.TorusKnotGeometry(radius * .92, radius * .18, 36, 8)
  if (clusterName === 'body') return new THREE.ConeGeometry(radius * 1.05, radius * 2.35, 5, 1)
  if (clusterName === 'immune') return new THREE.DodecahedronGeometry(radius * 1.36, 0)
  return new THREE.SphereGeometry(radius, 18, 12)
}

function enrichBrain(brain) {
  const architecture = brain?.architecture || {}
  const byId = new Map()
  const nodes = []
  ;(architecture.nodes?.length ? architecture.nodes : DEFAULT_NODES).forEach(node => {
    byId.set(node.id, node)
    nodes.push(node)
  })
  ;(brain?.spaces || []).forEach(space => {
    const id = space.name
    const node = {
      id,
      label: `&${id}`,
      layer: 'memory',
      activity: space.recent_activity,
      pressure: space.pressure,
      source: `memory/${id}.metta`,
      role: `${id} AtomSpace`
    }
    if (!byId.has(id)) nodes.push(node)
    else Object.assign(byId.get(id), node)
  })

  const flows = [...(architecture.flows?.length ? architecture.flows : DEFAULT_FLOWS)]
  ;(brain?.spaces || []).forEach(space => {
    flows.push({ from: 'spaces', to: space.name, active: Number(space.recent_activity || 0) > 0, order: 100 })
  })
  return { nodes, flows }
}

export class ThoughtGraph {
  constructor(scene, options = {}) {
    this.group = new THREE.Group()
    this.radius = options.radius || SHELL_RADIUS
    this.scale = options.scale || 1
    this.isMiniature = Boolean(options.miniature)
    this.layerAlpha = 1
    this.group.position.copy(options.position || new THREE.Vector3())
    if (this.isMiniature) this.group.scale.setScalar(this.scale)
    scene.add(this.group)
    this.nodes = new Map()
    this.nodeMeshes = new Map()
    this.clusterShells = []
    this.pulses = []
    this.liveActivity = new Map()
    this.liveFlows = new Map()
    this.recursionPhase = 0
    this.lastSignature = ''
    this.focus = { activeUntil: 0, node: 'provider', pulse: 0 }
    this.build(DEFAULT_NODES, DEFAULT_FLOWS)
  }

  applyBrain(brain) {
    const { nodes, flows } = enrichBrain(brain)
    const signature = JSON.stringify({
      nodes: nodes.map(node => node.id),
      flows: flows.map(flow => `${flow.from}->${flow.to}`)
    })
    if (signature !== this.lastSignature) {
      this.lastSignature = signature
      this.build(nodes, flows)
    }
    this.updateLiveState(nodes, flows)
  }

  updateLiveState(nodes, flows) {
    this.liveActivity.clear()
    nodes.forEach(node => this.liveActivity.set(node.id, normalizeActivity(node.activity)))
    flows.forEach(flow => {
      const key = `${flow.from}->${flow.to}`
      const sourceActivity = this.liveActivity.get(flow.from) || 0
      const targetActivity = this.liveActivity.get(flow.to) || 0
      this.liveFlows.set(key, {
        active: Boolean(flow.active) || sourceActivity > .18 || targetActivity > .18,
        energy: Math.max(sourceActivity, targetActivity, flow.active ? .55 : 0),
        count: Math.max(1, Math.min(5, Math.ceil(Math.max(sourceActivity, targetActivity, flow.active ? .55 : 0) * 5)))
      })
    })
  }

  build(nodes, flows) {
    this.group.clear()
    this.nodes.clear()
    this.nodeMeshes.clear()
    this.clusterShells = []
    this.pulses = []

    this.createCoreLoop()
    this.createClusterShells()
    const clusterBuckets = new Map()
    nodes.forEach(node => {
      const cluster = nodeCluster(node.id, node.layer)
      if (!clusterBuckets.has(cluster)) clusterBuckets.set(cluster, [])
      clusterBuckets.get(cluster).push(node)
    })

    clusterBuckets.forEach((bucket, clusterName) => {
      bucket.forEach((node, index) => this.createNode(node, index, bucket.length, clusterName))
    })

    flows.forEach((flow, index) => this.createFlow(flow, index))
    this.updateLiveState(nodes, flows)
  }

  createCoreLoop() {
    const points = new THREE.EllipseCurve(0, 0, this.radius, this.radius, 0, Math.PI * 2).getPoints(320)
      .map(p => new THREE.Vector3(p.x, 0, p.y))
    const loop = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color: COLORS.metta,
        transparent: true,
        opacity: this.isMiniature ? .2 : .052,
        blending: THREE.NormalBlending,
        depthWrite: false
      })
    )
    loop.userData = { coreLoop: true }
    this.group.add(loop)
  }

  createClusterShells() {
    Object.entries(CLUSTER_DIRECTIONS).forEach(([id, direction], index) => {
      const clusterColor = COLORS[id] || COLORS.default
      const center = direction.clone().normalize().multiplyScalar(this.radius)
      const shellRadius = this.radius * (this.isMiniature ? .115 : .105)
      const shellMaterial = new THREE.LineBasicMaterial({
        color: clusterColor,
        transparent: true,
        opacity: this.isMiniature ? .052 : .012,
        blending: THREE.NormalBlending,
        depthWrite: false
      })
      const shell = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(webKnotPoints(center, shellRadius * 1.75, id)),
        shellMaterial
      )
      shell.rotation.set(index * .31, index * .49, index * .17)
      shell.userData = { index, id, baseOpacity: shellMaterial.opacity }
      this.clusterShells.push(shell)
      this.group.add(shell)
    })
  }

  createNode(node, index, total, clusterName) {
    const pos = nodePosition(node.id, index, total, clusterName, this.radius)
    const color = this.nodeColor(node.id, clusterName)
    this.nodes.set(node.id, pos)

    const baseRadius = this.radius * (node.id === 'loop' || node.id === 'provider' || node.id === 'metta' ? .008 : .0052)
    const nodeMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: node.id === 'provider' ? .32 : .2,
      blending: THREE.NormalBlending,
      depthWrite: false
    })
    const mesh = new THREE.Mesh(nodeGeometry(node.id, clusterName, baseRadius), nodeMaterial)
    mesh.position.copy(pos)
    mesh.userData = {
      id: node.id,
      clusterName,
      baseOpacity: nodeMaterial.opacity,
      baseRadius,
      pressure: node.pressure || 'low'
    }
    mesh.rotation.set(hashUnit(`${node.id}:rx`) * Math.PI, hashUnit(`${node.id}:ry`) * Math.PI, hashUnit(`${node.id}:rz`) * Math.PI)
    this.nodeMeshes.set(node.id, mesh)
    this.group.add(mesh)

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(baseRadius * 5, 14, 10),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: node.id === 'provider' ? .024 : .012,
        blending: THREE.NormalBlending,
        depthWrite: false
      })
    )
    glow.position.copy(pos)
    glow.userData = { id: node.id, glow: true, baseOpacity: glow.material.opacity }
    this.group.add(glow)
  }

  createFlow(flow, index) {
    const a = this.nodes.get(flow.from)
    const b = this.nodes.get(flow.to)
    if (!a || !b) return
    const mid = a.clone().lerp(b, .5).normalize().multiplyScalar(this.radius * (.93 + hashUnit(`${flow.from}:${flow.to}`) * .12))
    const curve = new THREE.CatmullRomCurve3([a, mid, b])
    const color = this.flowColor(flow)
    const tubeRadius = this.radius * (this.isMiniature ? .0018 : .00105)
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 72, tubeRadius, this.isMiniature ? 5 : 6, false),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: .012,
        blending: THREE.NormalBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    )
    tube.userData = { key: `${flow.from}->${flow.to}`, baseOpacity: .018, baseScale: 1 }
    this.group.add(tube)

    const particleCount = this.isMiniature ? 22 : 38
    const particleGeometry = new THREE.BufferGeometry()
    particleGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(particleCount * 3), 3))
    particleGeometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(particleCount * 3), 3))
    const pulse = new THREE.Points(
      particleGeometry,
      new THREE.PointsMaterial({
        color: 0xffffff,
        map: getPulseTexture(),
        vertexColors: true,
        size: this.radius * (this.isMiniature ? .0065 : .0018),
        sizeAttenuation: true,
        transparent: true,
        alphaTest: .02,
        opacity: 0,
        blending: THREE.NormalBlending,
        depthWrite: false
      })
    )
    pulse.userData = {
      curve,
      flow,
      key: `${flow.from}->${flow.to}`,
      offset: (index % 23) / 23,
      speed: .028 + (index % 9) * .006,
      color,
      tube,
      particleCount,
      baseColor: new THREE.Color(color),
      seeds: Array.from({ length: particleCount }, (_, seedIndex) => ({
        radial: hashUnit(`${flow.from}:${flow.to}:radial:${seedIndex}`),
        angle: hashUnit(`${flow.from}:${flow.to}:angle:${seedIndex}`) * Math.PI * 2,
        slip: hashUnit(`${flow.from}:${flow.to}:slip:${seedIndex}`)
      }))
    }
    this.pulses.push(pulse)
    this.group.add(pulse)
  }

  nodeColor(id, clusterName) {
    if (id === 'provider') return COLORS.provider
    return COLORS[clusterName] || COLORS.default
  }

  flowColor(flow) {
    const key = `${flow.from} ${flow.to}`.toLowerCase()
    if (/(syntax|guard|immune|format)/.test(key)) return COLORS.immune
    if (/(channel|whatsapp|telegram|receive|send)/.test(key)) return 0x00a7c8
    if (/(habitat|house|home|glucose|vision|image|audio|web)/.test(key)) return COLORS.body
    if (/(export|persistent|history|world|belief|event|agenda|spaces)/.test(key)) return COLORS.memory
    if (/(assume|fabric|predict)/.test(key)) return COLORS.assume
    if (/(provider|llm|context)/.test(key)) return COLORS.provider
    if (/(metta|skill)/.test(key)) return COLORS.metta
    const from = nodeCluster(flow.from)
    const to = nodeCluster(flow.to)
    if (from === 'assume' || to === 'assume') return COLORS.assume
    if (from === 'provider' || to === 'provider') return COLORS.provider
    if (from === 'body' || to === 'body') return COLORS.body
    if (from === 'immune' || to === 'immune') return COLORS.immune
    if (from === 'memory' || to === 'memory') return COLORS.memory
    return COLORS.default
  }

  focusNode(id = 'provider') {
    this.focus = {
      activeUntil: performance.now() + 1450,
      node: id,
      pulse: 1
    }
  }

  getNodeLocalPosition(id = 'provider') {
    return (this.nodes.get(id) || nodePosition('provider', 0, 1, 'provider', this.radius)).clone()
  }

  setRecursion(phase = 0) {
    this.recursionPhase = phase
  }

  setLayerAlpha(alpha = 1) {
    this.layerAlpha = THREE.MathUtils.clamp(alpha, 0, 1)
  }

  update(time, state) {
    const activity = state.activity ?? .25
    const quality = state.quality ?? 1
    const layerAlpha = this.layerAlpha
    const now = performance.now()
    const drift = this.isMiniature ? .06 : .012
    this.group.rotation.y += ((Math.sin(time * .045) * drift) - this.group.rotation.y) * .015
    this.group.rotation.x += (((this.isMiniature ? .08 : -.015) + Math.sin(time * .035) * drift) - this.group.rotation.x) * .025
    this.group.rotation.z += ((Math.sin(time * .025) * drift) - this.group.rotation.z) * .018

    this.focus.pulse *= .94
    const recursiveGlow = this.isMiniature ? this.recursionPhase : 1 - this.recursionPhase
    this.clusterShells.forEach(shell => {
      const shellActivity = this.liveActivity.get(shell.userData.id) || activity
      shell.rotation.x += .0008 + shell.userData.index * .00006
      shell.rotation.y -= .0006 + shell.userData.index * .00004
      shell.material.opacity = (shell.userData.baseOpacity + shellActivity * (this.isMiniature ? .14 : .026) + recursiveGlow * (this.isMiniature ? .14 : .009)) * (.65 + quality * .35) * layerAlpha
    })

    this.nodeMeshes.forEach(mesh => {
      const live = this.liveActivity.get(mesh.userData.id) || 0
      const selected = mesh.userData.id === this.focus.node && now < this.focus.activeUntil
      const throb = .5 + .5 * Math.sin(time * (1.6 + live * 3.4) + hashUnit(mesh.userData.id) * 8)
      const pressureBoost = mesh.userData.pressure === 'high' ? .24 : (mesh.userData.pressure === 'medium' ? .1 : 0)
      mesh.material.opacity = (mesh.userData.baseOpacity + throb * .04 + live * .26 + pressureBoost + recursiveGlow * .06 + (selected ? this.focus.pulse * .32 : 0)) * layerAlpha
      mesh.scale.setScalar(1 + throb * .08 + live * .74 + activity * .04 + recursiveGlow * .14 + (selected ? this.focus.pulse * 1.3 : 0))
      mesh.rotation.x += (.001 + live * .008) * quality
      mesh.rotation.y += (.0015 + live * .01) * quality
    })

    this.pulses.forEach(pulse => {
      const live = this.liveFlows.get(pulse.userData.key) || { active: false, energy: 0 }
      const providerBoost = pulse.userData.flow.from === 'provider' || pulse.userData.flow.to === 'provider'
      const focusBoost = now < this.focus.activeUntil && providerBoost ? .62 : 0
      const energy = live.energy || 0
      const speed = pulse.userData.speed * (state.thoughtSpeed ?? 1) * (1 + energy * 3.2 + recursiveGlow * 1.2) * (.55 + quality * .45)
      const u = (pulse.userData.offset + time * speed) % 1
      const activeOpacity = THREE.MathUtils.clamp((.018 + energy * .3 + (live.active ? .09 : 0) + recursiveGlow * .035 + Math.sin((u + time) * Math.PI * 2) * .018 + focusBoost * .3) * (.62 + quality * .38) * layerAlpha, 0, .56)
      pulse.material.opacity = activeOpacity
      pulse.material.size = this.radius * (this.isMiniature ? .0058 : .00155) * (1 + energy * .75 + focusBoost * .35)
      this.updateParticleStream(pulse, u, time, activeOpacity, energy, live.active || energy > .2, live.count || 1)
      if (pulse.userData.tube) {
        pulse.userData.tube.material.opacity = (.006 + energy * .055 + (live.active ? .024 : 0)) * (.58 + quality * .42) * layerAlpha
        pulse.userData.tube.scale.setScalar(1 + Math.min(.14, energy * .09 + (live.active ? .025 : 0)))
      }
    })
  }

  updateParticleStream(pulse, u, time, activeOpacity, energy, isActive, streamCount = 1) {
    const positions = pulse.geometry.attributes.position.array
    const colors = pulse.geometry.attributes.color.array
    const count = pulse.userData.particleCount
    const color = pulse.userData.baseColor
    const tubeWidth = this.radius * (this.isMiniature ? .0038 : .0018) * (1 + energy * .95)
    for (let i = 0; i < count; i += 1) {
      const seed = pulse.userData.seeds[i]
      const streamIndex = i % streamCount
      const age = i / Math.max(1, count - 1)
      const spread = Math.pow(age, 1.35) * (.22 + energy * .12)
      const streamOffset = streamIndex / Math.max(1, streamCount)
      const particleU = (u + streamOffset - spread + seed.slip * .018 + 1) % 1
      const point = pulse.userData.curve.getPointAt(particleU)
      const tangent = pulse.userData.curve.getTangentAt(particleU).normalize()
      const reference = Math.abs(tangent.y) > .85 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
      const normal = new THREE.Vector3().crossVectors(tangent, reference).normalize()
      const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize()
      const jitterRadius = tubeWidth * (seed.radial ** .55) * (.25 + age * 1.3)
      const flicker = Math.sin(time * (5.0 + seed.slip * 7.0) + i * .73) * tubeWidth * .28
      point.add(normal.multiplyScalar(Math.cos(seed.angle + time * .7) * jitterRadius + flicker))
      point.add(binormal.multiplyScalar(Math.sin(seed.angle - time * .55) * jitterRadius))
      positions[i * 3] = point.x
      positions[i * 3 + 1] = point.y
      positions[i * 3 + 2] = point.z

      const localAge = ((age * streamCount) % 1)
      const intensity = Math.min(.68, (1 - localAge) ** 1.7 * (isActive ? 1 : .24) * activeOpacity)
      colors[i * 3] = Math.min(1, color.r * (.46 + intensity * .92) + intensity * .18)
      colors[i * 3 + 1] = Math.min(1, color.g * (.46 + intensity * .86) + intensity * .14)
      colors[i * 3 + 2] = Math.min(1, color.b * (.46 + intensity * .82) + intensity * .1)
    }
    pulse.geometry.attributes.position.needsUpdate = true
    pulse.geometry.attributes.color.needsUpdate = true
  }
}

export { enrichBrain }
