// Caminante en primera persona: cápsula con gravedad que colisiona contra la BVH de la roca.
// El paso de colisión (shapecast + empuje de la cápsula fuera de cada triángulo cercano y
// detección de piso) está adaptado del ejemplo "characterMovement" de three-mesh-bvh:
// https://github.com/gkjohnson/three-mesh-bvh/blob/master/example/characterMovement.js
//
// MIT License
// Copyright (c) 2018 Garrett Johnson
// Permission is hereby granted, free of charge, to any person obtaining a copy of this
// software and associated documentation files (the "Software"), to deal in the Software
// without restriction, including without limitation the rights to use, copy, modify, merge,
// publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
// to whom the Software is furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all copies or
// substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
// INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
// PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
// FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
// DEALINGS IN THE SOFTWARE.
import * as THREE from 'three'
import type { MeshBVH } from 'three-mesh-bvh'

export interface WalkInput {
  forward: number
  right: number
  run: boolean
}

export interface WalkerOptions {
  /** Radio de la cápsula (hombros). */
  readonly radius: number
  /** Altura total de la persona con casco. */
  readonly height: number
  /** Altura de los ojos sobre los pies. */
  readonly eyeHeight: number
}

export const DEFAULT_WALKER: WalkerOptions = { radius: 0.3, height: 1.8, eyeHeight: 1.65 }

const GRAVITY = -9.8
const SUBSTEPS = 4

export class Walker {
  readonly position = new THREE.Vector3()
  readonly velocity = new THREE.Vector3()
  onGround = false
  private readonly options: WalkerOptions
  private readonly bvh: MeshBVH
  private readonly segment = new THREE.Line3()
  private readonly box = new THREE.Box3()
  private readonly triPoint = new THREE.Vector3()
  private readonly capsulePoint = new THREE.Vector3()
  private readonly delta = new THREE.Vector3()
  private readonly move = new THREE.Vector3()
  private readonly spawn = new THREE.Vector3()

  constructor(bvh: MeshBVH, options: WalkerOptions = DEFAULT_WALKER) {
    this.bvh = bvh
    this.options = options
  }

  reset(feet: THREE.Vector3): void {
    this.position.copy(feet)
    this.spawn.copy(feet)
    this.velocity.set(0, 0, 0)
    this.onGround = false
  }

  eye(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.position).setY(this.position.y + this.options.eyeHeight)
  }

  update(delta: number, input: WalkInput, yaw: number, speed: number): void {
    const dt = Math.min(delta, 0.05) / SUBSTEPS
    const sin = Math.sin(yaw), cos = Math.cos(yaw)
    // Adelante = −Z de la cámara girada en guiñada.
    this.move.set(-sin * input.forward + cos * input.right, 0, -cos * input.forward - sin * input.right)
    if (this.move.lengthSq() > 1) this.move.normalize()
    this.move.multiplyScalar(speed * (input.run ? 2.2 : 1))
    for (let step = 0; step < SUBSTEPS; step++) this.step(dt)
    if (this.position.y < this.spawn.y - 30) this.reset(this.spawn)
  }

  private step(dt: number): void {
    const { radius, height } = this.options
    if (this.onGround) this.velocity.y = Math.max(this.velocity.y, -1)
    this.velocity.y += GRAVITY * dt
    this.position.addScaledVector(this.velocity, dt)
    this.position.addScaledVector(this.move, dt)

    const segment = this.segment
    segment.start.copy(this.position).setY(this.position.y + radius)
    segment.end.copy(this.position).setY(this.position.y + height - radius)
    this.box.makeEmpty()
    this.box.expandByPoint(segment.start)
    this.box.expandByPoint(segment.end)
    this.box.min.addScalar(-radius)
    this.box.max.addScalar(radius)

    this.bvh.shapecast({
      intersectsBounds: bounds => bounds.intersectsBox(this.box),
      intersectsTriangle: triangle => {
        const distance = triangle.closestPointToSegment(segment, this.triPoint, this.capsulePoint)
        if (distance < radius) {
          const depth = radius - distance
          const direction = this.capsulePoint.sub(this.triPoint).normalize()
          segment.start.addScaledVector(direction, depth)
          segment.end.addScaledVector(direction, depth)
        }
      },
    })

    const corrected = this.delta.copy(segment.start).setY(segment.start.y - radius).sub(this.position)
    this.onGround = corrected.y > Math.abs(dt * this.velocity.y * 0.25)
    const offset = Math.max(0, corrected.length() - 1e-5)
    corrected.normalize().multiplyScalar(offset)
    this.position.add(corrected)
    if (this.onGround) this.velocity.set(0, 0, 0)
    else {
      corrected.normalize()
      this.velocity.addScaledVector(corrected, -corrected.dot(this.velocity))
    }
  }
}
