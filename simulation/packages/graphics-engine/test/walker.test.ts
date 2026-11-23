import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { describe, expect, it } from 'vitest'
import type { GalleryLayout } from '@twin/shared-types'
import { frameAt, GalleryGenerator } from '@twin/mine-generator'
import layoutJson from '../../../config/galeria-validacion.json'
import { Walker } from '../src/walker.ts'

const layout = layoutJson as unknown as GalleryLayout

function buildWorld() {
  const generator = new GalleryGenerator(layout)
  const { chunks } = generator.generateAll({ voxel: 0.25, chunkSize: 8, bakeShadows: false })
  const positions: number[] = []
  const indices: number[] = []
  for (const chunk of chunks) {
    const offset = positions.length / 3
    positions.push(...chunk.positions)
    for (const index of chunk.indices) indices.push(index + offset)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  return { generator, bvh: new MeshBVH(geometry) }
}

const world = buildWorld()
const yawOf = (tangent: readonly number[]) => Math.atan2(-tangent[0], -tangent[2])

describe('Walker (colisión de cápsula contra la galería generada)', () => {
  it('camina por el eje de cada segmento sin caer ni salir de la galería', () => {
    const { generator, bvh } = world
    for (const segment of generator.compiled.segments) {
      const start = frameAt(segment, 2)
      const walker = new Walker(bvh)
      walker.reset(new THREE.Vector3(start.position[0], start.position[1] + 0.3, start.position[2]))
      // Recorre el segmento en pasos de 1/60 s, girando hacia la tangente local.
      for (let step = 0; step < 60 * 12; step++) {
        const s = Math.min(2 + step * (1.4 / 60), segment.length - 3)
        const frame = frameAt(segment, s)
        walker.update(1 / 60, { forward: 1, right: 0, run: false }, yawOf(frame.tangent), 1.4)
      }
      const { x, y, z } = walker.position
      // Los pies quedan sobre el piso (dentro de ±0,15 m de la cota del eje cercano)...
      const floor = frameAt(segment, Math.min(2 + 12 * 1.4, segment.length - 3)).position[1]
      expect(Math.abs(y - floor), `${segment.spec.id}: altura de los pies`).toBeLessThan(0.25)
      // ...y el pecho está en aire libre.
      expect(generator.field.distance(x, y + 1.2, z), `${segment.spec.id}: dentro de la galería`).toBeLessThan(0)
    }
  })

  it('no atraviesa un hastial al caminar contra él', () => {
    const { generator, bvh } = world
    const segment = generator.compiled.segments.find(item => item.spec.id === 'S2')!
    const frame = frameAt(segment, 10)
    const walker = new Walker(bvh)
    walker.reset(new THREE.Vector3(frame.position[0], frame.position[1] + 0.3, frame.position[2]))
    // Mirar hacia la derecha (hacia el hastial) y caminar 6 s: más que el ancho de la galería.
    const yaw = yawOf(frame.tangent) - Math.PI / 2
    for (let step = 0; step < 60 * 6; step++) walker.update(1 / 60, { forward: 1, right: 0, run: true }, yaw, 1.4)
    const { x, y, z } = walker.position
    expect(generator.field.distance(x, y + 1.0, z)).toBeLessThan(0)
    const lateral = (x - frame.position[0]) * frame.right[0] + (z - frame.position[2]) * frame.right[2]
    expect(lateral).toBeGreaterThan(0.8)
    expect(lateral).toBeLessThan(segment.profile.width / 2 + 0.5)
  })
})
