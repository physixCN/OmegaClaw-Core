import * as THREE from 'three'

const SHELL_RADIUS = 58

const SPACE_REGIONS = {
  persistent: { direction: new THREE.Vector3(.55, .18, -.82), spreadX: 1.28, spreadY: .74, radius: 60, depth: 18 },
  world: { direction: new THREE.Vector3(.3, -.78, -.55), spreadX: 1.24, spreadY: .74, radius: 58, depth: 17 },
  beliefs: { direction: new THREE.Vector3(.88, .32, -.34), spreadX: .9, spreadY: .9, radius: 62, depth: 16 },
  events: { direction: new THREE.Vector3(-.76, -.48, -.44), spreadX: 1.22, spreadY: .72, radius: 58, depth: 17 },
  agenda: { direction: new THREE.Vector3(-.93, .16, -.34), spreadX: .86, spreadY: .98, radius: 60, depth: 16 },
  assume: { direction: new THREE.Vector3(-.3, -.1, -.95), spreadX: 1.12, spreadY: .86, radius: 64, depth: 19 },
  attention: { direction: new THREE.Vector3(.04, .93, -.36), spreadX: 1.08, spreadY: .64, radius: 60, depth: 15 },
  activity: { direction: new THREE.Vector3(-.2, .62, -.76), spreadX: .98, spreadY: .7, radius: 57, depth: 15 },
  history: { direction: new THREE.Vector3(.02, -.95, -.31), spreadX: 1.5, spreadY: .5, radius: 66, depth: 22 },
  promoted_memories: { direction: new THREE.Vector3(.36, .68, -.64), spreadX: .82, spreadY: .66, radius: 58, depth: 14 }
}

const SPACE_DIRECTIONS = Object.fromEntries(
  Object.entries(SPACE_REGIONS).map(([space, region]) => [space, region.direction])
)

const SPACE_COLORS = {
  persistent: 0x006f60,
  world: 0x0b7c4f,
  beliefs: 0x007ea0,
  events: 0x087c72,
  agenda: 0x357d70,
  assume: 0x176eb8,
  attention: 0x044f43,
  activity: 0x008b77,
  history: 0x536f84,
  promoted_memories: 0x08775c
}

const ACTION_COLORS = {
  read: 0x00a7c8,
  write: 0x11c996,
  remove: 0xde6b68,
  merge: 0x4c9dff,
  route: 0xffffff,
  touch: 0x18d9b4
}

let glowTexture = null

function getGlowTexture() {
  if (glowTexture) return glowTexture
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 31)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(.24, 'rgba(255,255,255,.78)')
  gradient.addColorStop(.58, 'rgba(255,255,255,.18)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 64, 64)
  glowTexture = new THREE.CanvasTexture(canvas)
  glowTexture.colorSpace = THREE.SRGBColorSpace
  return glowTexture
}

function hashUnit(value = '') {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967295
}

function tangentFrame(direction) {
  const normal = direction.clone().normalize()
  const reference = Math.abs(normal.y) > .86 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  const tangent = new THREE.Vector3().crossVectors(reference, normal).normalize()
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize()
  return { normal, tangent, bitangent }
}

function atomPosition(atom, index, kindIndex) {
  const region = SPACE_REGIONS[atom.space] || SPACE_REGIONS.persistent
  const { normal, tangent, bitangent } = tangentFrame(region.direction)
  const strand = (kindIndex % 13) / 12 - .5
  const lane = (Math.floor(kindIndex / 13) % 7) / 6 - .5
  const x = (hashUnit(`${atom.id}:x`) - .5) * region.spreadX + strand * .16
  const y = (hashUnit(`${atom.id}:y`) - .5) * region.spreadY + lane * .12
  const warp = Math.sin((x * 5.1) + (y * 3.7) + hashUnit(atom.kind) * 6) * .06
  const radius = region.radius || SHELL_RADIUS
  const volumeDepth = region.depth || 16
  const tangentSpan = radius * .38
  const bitangentSpan = radius * .34
  const radial = (hashUnit(`${atom.id}:depth`) - .5) * volumeDepth
  const chamberBreathe = Math.sin((x * 2.4) - (y * 2.1) + hashUnit(`${atom.space}:curl`) * 5) * volumeDepth * .16
  return normal.clone().multiplyScalar(radius + radial + chamberBreathe + (index % 23) * .012)
    .add(tangent.clone().multiplyScalar(x * tangentSpan))
    .add(bitangent.clone().multiplyScalar((y + warp) * bitangentSpan))
}

function curvedBetween(a, b, seed) {
  const mid = a.clone().lerp(b, .5)
  const lifted = mid.clone().normalize().multiplyScalar(Math.max(a.length(), b.length()) + 2.2 + hashUnit(`${seed}:lift`) * 5.6)
  return [a, lifted, b]
}

function atomColor(atom, isNew) {
  const base = new THREE.Color(SPACE_COLORS[atom.space] || 0xe9b84d)
  const kindTint = hashUnit(atom.kind || 'atom') * .2
  base.offsetHSL(kindTint - .1, .08, isNew ? .24 : .06)
  return base
}

export class AtomClouds {
  constructor(scene) {
    this.group = new THREE.Group()
    this.group.name = 'live-atom-map'
    scene.add(this.group)
    this.previousIds = new Set()
    this.currentIds = new Set()
    this.points = null
    this.webLines = null
    this.spaceVolumes = []
    this.tracePoints = null
    this.atomData = []
    this.atomIndex = new Map()
    this.baseColors = null
    this.basePositions = null
    this.traceByAtom = new Map()
    this.spaceTraceEnergy = new Map()
    this.traceSignature = ''
    this.raycaster = new THREE.Raycaster()
    this.raycaster.params.Points.threshold = .55
    this.pointer = new THREE.Vector2()
    this.material = new THREE.PointsMaterial({
      size: .085,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: .92,
      blending: THREE.NormalBlending,
      depthWrite: false
    })
    this.traceMaterial = new THREE.PointsMaterial({
      map: getGlowTexture(),
      size: .46,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: .82,
      alphaTest: .02,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
    this.signature = ''
    this.stats = { atoms: 0, spaces: 0, added: 0, removed: 0 }
  }

  applyBrain(brain) {
    const atoms = brain?.atom_map?.atoms || []
    const signature = atoms.map(atom => atom.id).join('|')
    if (signature !== this.signature) {
      const nextIds = new Set(atoms.map(atom => atom.id))
      const added = atoms.filter(atom => !this.previousIds.has(atom.id)).length
      const removed = [...this.previousIds].filter(id => !nextIds.has(id)).length
      this.signature = signature
      this.currentIds = nextIds
      this.stats = {
        atoms: atoms.length,
        spaces: new Set(atoms.map(atom => atom.space)).size,
        added,
        removed
      }

      this.rebuild(atoms)
      this.previousIds = nextIds
    }
    this.applyTraces(brain?.atom_traces?.traces || [])
  }

  rebuild(atoms) {
    if (this.points) {
      this.group.remove(this.points)
      this.points.geometry.dispose()
    }
    if (this.webLines) {
      this.group.remove(this.webLines)
      this.webLines.geometry.dispose()
      this.webLines = null
    }
    this.spaceVolumes.forEach(volume => {
      this.group.remove(volume)
      volume.geometry.dispose()
    })
    this.spaceVolumes = []

    this.atomData = atoms
    this.atomIndex.clear()
    const kindOrdinals = new Map()
    const positions = new Float32Array(atoms.length * 3)
    const colors = new Float32Array(atoms.length * 3)
    atoms.forEach((atom, index) => {
      this.atomIndex.set(atom.id, index)
      const kindKey = `${atom.space}:${atom.kind}`
      if (!kindOrdinals.has(kindKey)) kindOrdinals.set(kindKey, kindOrdinals.size)
      const position = atomPosition(atom, index, kindOrdinals.get(kindKey))
      const color = atomColor(atom, !this.previousIds.has(atom.id))
      positions[index * 3] = position.x
      positions[index * 3 + 1] = position.y
      positions[index * 3 + 2] = position.z
      colors[index * 3] = color.r
      colors[index * 3 + 1] = color.g
      colors[index * 3 + 2] = color.b
    })

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    this.basePositions = positions.slice()
    this.baseColors = colors.slice()
    this.points = new THREE.Points(geometry, this.material)
    this.points.userData = { kind: 'atom-map', source: 'memory/*.metta', atoms }
    this.group.add(this.points)
    this.rebuildWebLines(atoms, positions)
    this.rebuildSpaceVolumes(atoms)
    this.rebuildTraceOverlay()
  }

  spaceVolumePoint(region, x, y, z) {
    const { normal, tangent, bitangent } = tangentFrame(region.direction)
    const radius = region.radius || SHELL_RADIUS
  return normal.clone().multiplyScalar(radius + z * (region.depth || 16))
      .add(tangent.clone().multiplyScalar(x * radius * .38 * region.spreadX))
      .add(bitangent.clone().multiplyScalar(y * radius * .34 * region.spreadY))
  }

  spaceSilhouettePoint(space, region, angle, z, scale = 1) {
    const twist = z * (space === 'assume' ? 2.2 : (space === 'events' ? 1.1 : .45))
    const a = angle + twist
    let x = Math.cos(a)
    let y = Math.sin(a)
    let localScale = scale
    if (space === 'persistent') {
      localScale *= 1 + Math.sin(angle * 8) * .045
      y *= .72
    } else if (space === 'world') {
      localScale *= 1 + Math.max(0, Math.sin(angle * 5 + z * 4)) * .16
      y *= .82 + Math.cos(angle * 3) * .08
    } else if (space === 'beliefs') {
      localScale *= .86 + Math.sin(angle * 3 + z * 5) * .06
      y *= 1.12
    } else if (space === 'events') {
      localScale *= .72
      x *= 1.8
      y *= .45
    } else if (space === 'agenda') {
      localScale *= .76 + Math.abs(Math.sin(angle * 6)) * .28
    } else if (space === 'assume') {
      localScale *= .92 + Math.sin(angle * 3 + z * 9) * .18
      x += Math.sin(angle * 2 + z * 3) * .18
      y += Math.cos(angle * 3 - z * 2) * .12
    } else if (space === 'history') {
      localScale *= .7
      x *= 2.05
      y *= .34
    } else if (space === 'attention') {
      localScale *= .7 + Math.abs(Math.sin(angle * 4)) * .18
      y *= .76
    } else if (space === 'activity') {
      localScale *= .78 + Math.sin(angle * 5 + z * 6) * .1
    } else if (space === 'promoted_memories') {
      localScale *= .8
      y *= .68
    }
    return this.spaceVolumePoint(region, x * localScale, y * localScale, z)
  }

  rebuildSpaceVolumes(atoms) {
    const spaces = [...new Set(atoms.map(atom => atom.space))].filter(space => SPACE_REGIONS[space])
    spaces.forEach((space, spaceIndex) => {
      const region = SPACE_REGIONS[space]
      const color = new THREE.Color(SPACE_COLORS[space] || 0x079f89)
      const positions = []
      const colors = []
      const rings = space === 'persistent' ? 7 : (space === 'beliefs' ? 3 : 5)
      const meridians = space === 'persistent' ? 24 : (space === 'beliefs' ? 10 : 16)
      const steps = space === 'events' || space === 'history' ? 72 : 56
      const addSegment = (pa, pb, dimA = .18, dimB = dimA) => {
        positions.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z)
        colors.push(color.r * dimA, color.g * dimA, color.b * dimA, color.r * dimB, color.g * dimB, color.b * dimB)
      }
      for (let ring = 0; ring < rings; ring += 1) {
        const z = -.48 + ring * (.96 / Math.max(1, rings - 1))
        const squeeze = .62 + (1 - Math.abs(z) * 1.2) * .38
        for (let i = 0; i < steps; i += 1) {
          const a = (i / steps) * Math.PI * 2
          const b = ((i + 1) / steps) * Math.PI * 2
          const pa = this.spaceSilhouettePoint(space, region, a, z, squeeze)
          const pb = this.spaceSilhouettePoint(space, region, b, z, squeeze)
          addSegment(pa, pb, .26 + ring * .045)
        }
      }
      for (let i = 0; i < meridians; i += 1) {
        const a = (i / meridians) * Math.PI * 2
        const slices = 7
        for (let j = 0; j < slices - 1; j += 1) {
          const zA = -.5 + j / (slices - 1)
          const zB = -.5 + (j + 1) / (slices - 1)
          const squeezeA = .62 + (1 - Math.abs(zA) * 1.18) * .38
          const squeezeB = .62 + (1 - Math.abs(zB) * 1.18) * .38
          const pa = this.spaceSilhouettePoint(space, region, a, zA, squeezeA)
          const pb = this.spaceSilhouettePoint(space, region, a, zB, squeezeB)
          addSegment(pa, pb, .22, .34)
        }
      }
      if (space === 'world') {
        for (let i = 0; i < 18; i += 1) {
          const a = (i / 18) * Math.PI * 2
          const root = this.spaceSilhouettePoint(space, region, a, -.18, .35)
          const tip = this.spaceSilhouettePoint(space, region, a + Math.sin(i) * .32, .28 + hashUnit(`${space}:${i}:branch`) * .22, .95)
          addSegment(root, tip, .2, .44)
        }
      } else if (space === 'agenda') {
        const hub = this.spaceVolumePoint(region, 0, 0, 0)
        for (let i = 0; i < 24; i += 1) {
          const a = (i / 24) * Math.PI * 2
          const tip = this.spaceSilhouettePoint(space, region, a, (hashUnit(`${space}:${i}:z`) - .5) * .82, .94)
          addSegment(hub, tip, .13, .44)
        }
      } else if (space === 'assume') {
        for (let i = 0; i < 96; i += 1) {
          const a = (i / 96) * Math.PI * 2
          const b = ((i + 1) / 96) * Math.PI * 2
          const zA = Math.sin(a * 2.5) * .34
          const zB = Math.sin(b * 2.5) * .34
          const pa = this.spaceSilhouettePoint(space, region, a, zA, .72)
          const pb = this.spaceSilhouettePoint(space, region, b, zB, .72)
          addSegment(pa, pb, .34, .42)
        }
      } else if (space === 'events' || space === 'history') {
        for (let i = 0; i < 18; i += 1) {
          const y = (i / 17) * 1.4 - .7
          const pa = this.spaceVolumePoint(region, -1.15, y, -.42 + hashUnit(`${space}:${i}:a`) * .22)
          const pb = this.spaceVolumePoint(region, 1.15, y * .42, .28 + hashUnit(`${space}:${i}:b`) * .3)
          addSegment(pa, pb, .18, .42)
        }
      }
      const volume = new THREE.LineSegments(
        new THREE.BufferGeometry()
          .setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
          .setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)),
        new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: .46,
          blending: THREE.NormalBlending,
          depthTest: false,
          depthWrite: false
        })
      )
      volume.userData = { kind: 'atomspace-volume', source: `memory/${space}.metta`, space, index: spaceIndex }
      this.spaceVolumes.push(volume)
      this.group.add(volume)
    })
  }

  rebuildWebLines(atoms, positions) {
    const bySpace = new Map()
    atoms.forEach((atom, index) => {
      if (!bySpace.has(atom.space)) bySpace.set(atom.space, [])
      bySpace.get(atom.space).push({ atom, index })
    })
    const linePositions = []
    const lineColors = []
    bySpace.forEach((items, space) => {
      const color = new THREE.Color(SPACE_COLORS[space] || 0x079f89)
      const sorted = [...items].sort((a, b) => `${a.atom.kind}:${a.atom.id}`.localeCompare(`${b.atom.kind}:${b.atom.id}`))
      const budget = Math.min(520, Math.max(0, sorted.length - 1))
      for (let i = 0; i < budget; i += 1) {
        const a = sorted[i]
        const step = 1 + Math.floor(hashUnit(`${space}:${i}:step`) * Math.min(11, Math.max(1, sorted.length - i - 1)))
        const b = sorted[(i + step) % sorted.length]
        if (!b || a.index === b.index) continue
        const pa = new THREE.Vector3(positions[a.index * 3], positions[a.index * 3 + 1], positions[a.index * 3 + 2])
        const pb = new THREE.Vector3(positions[b.index * 3], positions[b.index * 3 + 1], positions[b.index * 3 + 2])
        const points = curvedBetween(pa, pb, `${space}:${i}`)
        for (let j = 0; j < points.length - 1; j += 1) {
          linePositions.push(points[j].x, points[j].y, points[j].z, points[j + 1].x, points[j + 1].y, points[j + 1].z)
          const dim = .52 + hashUnit(`${space}:${i}:${j}`) * .32
          for (let k = 0; k < 2; k += 1) {
            lineColors.push(color.r * dim, color.g * dim, color.b * dim)
          }
        }
      }
    })
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3))
    this.webLines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: .42,
        blending: THREE.NormalBlending,
        depthWrite: false
      })
    )
    this.webLines.userData = { kind: 'atomspace-webs', source: 'memory/*.metta' }
    this.group.add(this.webLines)
  }

  applyTraces(traces) {
    const signature = traces.map(trace => `${trace.type}:${trace.atom_id || trace.space}:${trace.action}:${trace.strength}`).join('|')
    if (signature === this.traceSignature) return
    this.traceSignature = signature
    const now = performance.now()
    this.traceByAtom.clear()
    this.spaceTraceEnergy.clear()
    traces.forEach(trace => {
      const strength = Number(trace.strength || 0)
      if (trace.atom_id && this.atomIndex.has(trace.atom_id)) {
        this.traceByAtom.set(trace.atom_id, { ...trace, startedAt: now, strength })
      } else if (trace.space) {
        this.spaceTraceEnergy.set(trace.space, Math.max(this.spaceTraceEnergy.get(trace.space) || 0, strength || .32))
      }
    })
    this.rebuildTraceOverlay()
  }

  rebuildTraceOverlay() {
    if (this.tracePoints) {
      this.group.remove(this.tracePoints)
      this.tracePoints.geometry.dispose()
      this.tracePoints = null
    }
    if (!this.basePositions || !this.traceByAtom.size) return
    const positions = new Float32Array(this.traceByAtom.size * 3)
    const colors = new Float32Array(this.traceByAtom.size * 3)
    let cursor = 0
    this.traceByAtom.forEach(trace => {
      const index = this.atomIndex.get(trace.atom_id)
      if (index === undefined) return
      const color = new THREE.Color(ACTION_COLORS[trace.action] || SPACE_COLORS[trace.space] || 0x18d9b4)
      positions[cursor * 3] = this.basePositions[index * 3]
      positions[cursor * 3 + 1] = this.basePositions[index * 3 + 1]
      positions[cursor * 3 + 2] = this.basePositions[index * 3 + 2]
      colors[cursor * 3] = color.r
      colors[cursor * 3 + 1] = color.g
      colors[cursor * 3 + 2] = color.b
      cursor += 1
    })
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, cursor * 3), 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors.slice(0, cursor * 3), 3))
    this.tracePoints = new THREE.Points(geometry, this.traceMaterial)
    this.tracePoints.userData = { kind: 'atom-traces', source: 'history.metta' }
    this.group.add(this.tracePoints)
  }

  pick(event, camera, canvas) {
    if (!this.points || !this.atomData.length) return null
    const rect = canvas.getBoundingClientRect()
    this.pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1
    this.pointer.y = -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1)
    this.raycaster.setFromCamera(this.pointer, camera)
    const hits = this.raycaster.intersectObject(this.points, false)
    if (!hits.length) return null
    const atom = this.atomData[hits[0].index]
    return atom ? { ...atom, distance: hits[0].distance } : null
  }

  update(time, state) {
    const quality = state.quality ?? 1
    const activity = state.activity ?? .25
    this.group.rotation.y += .00045 * (.5 + activity)
    this.group.rotation.x += Math.sin(time * .07) * .00012
    this.material.opacity = (.72 + Math.min(.22, activity * .16) + Math.min(.12, this.stats.added * .008)) * (.82 + quality * .18)
    this.material.size = .11 + quality * .07 + Math.min(.05, this.stats.added * .0018)
    if (this.webLines) {
      this.webLines.material.opacity = (.34 + activity * .16 + Math.min(.12, this.traceByAtom.size * .0026)) * (.78 + quality * .22)
    }
    this.spaceVolumes.forEach(volume => {
      const energy = this.spaceTraceEnergy.get(volume.userData.space) || 0
      const breathe = .78 + Math.sin(time * .6 + volume.userData.index) * .22
      volume.material.opacity = (.26 + activity * .08 + energy * .18) * breathe * (.78 + quality * .22)
    })
    this.updateTraceColors(time)
    if (this.tracePoints) {
      const shimmer = .62 + Math.sin(time * 3.1) * .18
      this.traceMaterial.opacity = (.58 + Math.min(.36, this.traceByAtom.size * .02)) * shimmer * (.74 + quality * .26)
      this.traceMaterial.size = .34 + quality * .28 + Math.sin(time * 4.7) * .045
    }
  }

  updateTraceColors(time) {
    if (!this.points || !this.baseColors) return
    const colors = this.points.geometry.attributes.color.array
    colors.set(this.baseColors)
    const now = performance.now()
    this.traceByAtom.forEach((trace, atomId) => {
      const index = this.atomIndex.get(atomId)
      if (index === undefined) return
      const age = Math.max(0, now - trace.startedAt)
      const fade = Math.max(0, 1 - age / 5200)
      const wave = .65 + .35 * Math.sin(time * 7.5 + index * .17)
      const boost = Math.min(1, (trace.strength || .55) * fade * wave)
      const color = new THREE.Color(ACTION_COLORS[trace.action] || SPACE_COLORS[trace.space] || 0x18d9b4)
      colors[index * 3] = Math.min(1, colors[index * 3] + color.r * boost)
      colors[index * 3 + 1] = Math.min(1, colors[index * 3 + 1] + color.g * boost)
      colors[index * 3 + 2] = Math.min(1, colors[index * 3 + 2] + color.b * boost)
    })
    if (this.spaceTraceEnergy.size) {
      this.atomData.forEach((atom, index) => {
        const energy = this.spaceTraceEnergy.get(atom.space) || this.spaceTraceEnergy.get('spaces') || 0
        if (!energy) return
        const flicker = Math.max(0, Math.sin(time * 2.8 + hashUnit(atom.id) * 9))
        const boost = energy * .12 * flicker
        colors[index * 3] = Math.min(1, colors[index * 3] + boost)
        colors[index * 3 + 1] = Math.min(1, colors[index * 3 + 1] + boost * .82)
        colors[index * 3 + 2] = Math.min(1, colors[index * 3 + 2] + boost * .55)
      })
    }
    this.points.geometry.attributes.color.needsUpdate = true
  }
}
