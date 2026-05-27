import * as THREE from 'three'

const WEB_ANCHORS = [
  new THREE.Vector3(-38, 14, -38),
  new THREE.Vector3(38, 8, -42),
  new THREE.Vector3(-28, -28, -36),
  new THREE.Vector3(26, -30, -40),
  new THREE.Vector3(0, 34, -48),
  new THREE.Vector3(0, -40, -42),
  new THREE.Vector3(0, 0, -70)
]

function hashUnit(seed) {
  let hash = 2166136261
  const value = String(seed)
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967295
}

function webPoint(anchor, seed) {
  const spread = 9 + hashUnit(`${seed}:spread`) * 26
  const lift = 6 + hashUnit(`${seed}:lift`) * 20
  return anchor.clone().add(new THREE.Vector3(
    (hashUnit(`${seed}:x`) - .5) * spread,
    (hashUnit(`${seed}:y`) - .5) * lift,
    (hashUnit(`${seed}:z`) - .5) * spread * .55
  ))
}

export class LiquidWalls {
  constructor(scene) {
    this.pointer = new THREE.Vector2(.5, .5)
    this.group = new THREE.Group()
    this.group.position.set(0, 0, 0)
    scene.add(this.group)
    this.veins = []
    this.webs = []
    this.createVoidVeins()
  }

  createVoidVeins() {
    WEB_ANCHORS.forEach((anchor, index) => {
      const color = index % 3 === 1 ? 0x00a7c8 : 0x18d9b4
      const positions = []
      const segments = 26
      for (let i = 0; i < segments; i += 1) {
        const a = webPoint(anchor, `${index}:web:${i}`)
        const b = webPoint(anchor, `${index}:web:${(i * 7 + 3) % segments}`)
        const mid = a.clone().lerp(b, .5).normalize().multiplyScalar(46 + hashUnit(`${index}:${i}:curve`) * 16)
        positions.push(a.x, a.y, a.z, mid.x, mid.y, mid.z, mid.x, mid.y, mid.z, b.x, b.y, b.z)
      }
      const web = new THREE.LineSegments(
        new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)),
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: .14,
          blending: THREE.NormalBlending,
          depthWrite: false
        })
      )
      web.rotation.set(index * .07, index * .11, index * .05)
      web.userData = { index, baseOpacity: web.material.opacity }
      this.webs.push(web)
      this.group.add(web)
    })

    for (let i = 0; i < 72; i += 1) {
      const cluster = i % WEB_ANCHORS.length
      const center = WEB_ANCHORS[cluster]
      const start = webPoint(center, `${i}:start`)
      const end = webPoint(center, `${i}:end`)
      const mid = start.clone().lerp(end, .5).add(new THREE.Vector3(
        (hashUnit(`${i}:x`) - .5) * 8.2,
        (hashUnit(`${i}:y`) - .5) * 7.2,
        (hashUnit(`${i}:z`) - .5) * 5.2
      ))
      const curve = new THREE.CatmullRomCurve3([start, mid, end])
      const material = new THREE.LineBasicMaterial({
        color: i % 5 === 0 ? 0x00a7c8 : 0x18d9b4,
        transparent: true,
        opacity: .12 + hashUnit(`${i}:o`) * .07,
        blending: THREE.NormalBlending,
        depthWrite: false
      })
      const vein = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(42)), material)
      vein.userData = { baseOpacity: material.opacity, speed: .2 + hashUnit(`${i}:s`) * .7, index: i }
      this.veins.push(vein)
      this.group.add(vein)
    }
  }

  setPointer(pointer) {
    this.pointer.copy(pointer)
  }

  update(time, state) {
    const activity = state.activity ?? .25
    const quality = state.quality ?? 1
    this.group.rotation.y += (((this.pointer.x - .5) * .09) - this.group.rotation.y) * .012
    this.group.rotation.x += (((this.pointer.y - .5) * -.045) - this.group.rotation.x) * .012

    this.webs.forEach(web => {
      web.rotation.y += .00018 + web.userData.index * .000012
      web.rotation.x -= .00012 + web.userData.index * .00001
      web.material.opacity = (web.userData.baseOpacity + activity * .035) * (.65 + quality * .35)
    })

    this.veins.forEach(vein => {
      const phase = Math.sin(time * vein.userData.speed + vein.userData.index * .37)
      vein.material.opacity = (vein.userData.baseOpacity + Math.max(0, phase) * .045 + activity * .035) * (.54 + quality * .46)
    })
  }
}
