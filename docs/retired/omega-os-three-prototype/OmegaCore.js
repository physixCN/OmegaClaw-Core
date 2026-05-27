import * as THREE from 'three'
import { ThoughtGraph } from './ThoughtGraph.js'

export class OmegaCore {
  constructor(scene) {
    this.group = new THREE.Group()
    this.group.position.set(0, 0, -3.2)
    scene.add(this.group)
    this.graph = new ThoughtGraph(this.group, {
      miniature: true,
      radius: 1.16,
      scale: .18,
      position: new THREE.Vector3()
    })
    this.light = new THREE.PointLight(0xffbf58, .72, 8)
    this.light.position.set(0, 0, 0)
    this.group.add(this.light)
    this.recursionPhase = 0
  }

  applyBrain(brain) {
    this.graph.applyBrain(brain)
  }

  setRecursion(phase = 0) {
    this.recursionPhase = phase
    this.graph.setRecursion(phase)
  }

  update(time, state) {
    const activity = state.activity ?? .3
    this.group.rotation.y = time * .045
    this.group.rotation.x = Math.sin(time * .11) * .035
    const growth = Math.pow(2.9, this.recursionPhase)
    this.group.scale.setScalar((.42 + activity * .04) * growth)
    this.light.intensity = .46 + activity * .85
    this.graph.update(time, state)
  }
}
