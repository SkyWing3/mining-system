import type { GalleryLayout } from '@twin/shared-types'
import { describe, expect, it } from 'vitest'
import layoutJson from '../../../config/galeria-validacion.json'
import { GalleryGenerator, horseshoeDistance } from '../src/index.ts'

const layout = layoutJson as unknown as GalleryLayout
const options = { voxel: 0.3, chunkSize: 9, bakeShadows: false }

describe('horseshoeDistance', () => {
  const profile = { width: 4, wallHeight: 2, archRise: 1 }
  it('es negativa dentro de la sección y positiva fuera', () => {
    expect(horseshoeDistance(0, 1, profile)).toBeLessThan(0)
    expect(horseshoeDistance(0, 2.9, profile)).toBeLessThan(0)
    expect(horseshoeDistance(2.5, 1, profile)).toBeGreaterThan(0)
    expect(horseshoeDistance(0, -0.2, profile)).toBeGreaterThan(0)
    expect(horseshoeDistance(0, 3.2, profile)).toBeGreaterThan(0)
  })
  it('bajo el arranque reconoce la clave cercana (no sobreestima la distancia)', () => {
    // Justo bajo el arranque, en el eje: la superficie más cercana es la clave, a 1,01 m.
    const d = horseshoeDistance(0, 1.99, profile)
    expect(d).toBeLessThan(-0.9)
    expect(d).toBeGreaterThan(-1.05)
  })
  it('es continua en el arranque de la bóveda', () => {
    const below = horseshoeDistance(1.5, 2 - 1e-6, profile)
    const above = horseshoeDistance(1.5, 2 + 1e-6, profile)
    expect(Math.abs(below - above)).toBeLessThan(1e-3)
  })
})

describe('GalleryGenerator', () => {
  it('produce exactamente la misma geometría con la misma semilla', () => {
    const first = new GalleryGenerator(layout).generateAll(options)
    const second = new GalleryGenerator(layout).generateAll(options)
    expect(first.stats.hash).toBe(second.stats.hash)
    expect(first.stats.triangles).toBeGreaterThan(10_000)
  })

  it('cambia la geometría al cambiar la semilla', () => {
    const base = new GalleryGenerator(layout).generateAll(options)
    const other = new GalleryGenerator({ ...layout, seed: layout.seed + 1 }).generateAll(options)
    expect(other.stats.hash).not.toBe(base.stats.hash)
  })

  it('genera mallas válidas, sin NaN y con normales unitarias', () => {
    const { chunks } = new GalleryGenerator(layout).generateAll(options)
    for (const chunk of chunks) {
      const vertexCount = chunk.positions.length / 3
      for (const value of chunk.positions) expect(Number.isFinite(value)).toBe(true)
      for (const index of chunk.indices) expect(index).toBeLessThan(vertexCount)
      for (let v = 0; v < vertexCount; v++) {
        const length = Math.hypot(chunk.normals[v * 3], chunk.normals[v * 3 + 1], chunk.normals[v * 3 + 2])
        expect(length).toBeGreaterThan(0.99)
        expect(length).toBeLessThan(1.01)
      }
    }
  })

  it('deja un gálibo transitable a lo largo de cada eje', () => {
    const generator = new GalleryGenerator(layout)
    const { field, compiled } = generator
    for (const segment of compiled.segments) {
      for (let s = 2; s < segment.length - 2; s += 1) {
        const index = Math.min(Math.floor((s / segment.length) * (segment.distances.length - 1)), segment.distances.length - 2)
        const o = index * 3
        // Aire libre a 1,0 m y 2,0 m sobre el eje (persona de pie con casco).
        for (const height of [1.0, 2.0]) {
          const d = field.distance(segment.points[o], segment.points[o + 1] + height, segment.points[o + 2])
          expect(d, `${segment.spec.id} s=${s} h=${height}`).toBeLessThan(-0.3)
        }
      }
    }
  })

  it('mantiene el piso del eje caminable (a menos de 6 cm de la cota)', () => {
    const generator = new GalleryGenerator(layout)
    const { field, compiled } = generator
    for (const segment of compiled.segments) {
      for (let index = 1; index < segment.distances.length - 1; index++) {
        const o = index * 3
        const x = segment.points[o], y = segment.points[o + 1], z = segment.points[o + 2]
        const hit = field.raycast(x, y + 1, z, 0, -1, 0, 3)
        expect(hit).not.toBeNull()
        expect(Math.abs((hit ?? 0) - 1)).toBeLessThan(0.06)
      }
    }
  })

  it('cierra la superficie entre fragmentos sin costuras (soldadura exacta en float32)', () => {
    for (const voxel of [0.2, 0.35]) {
      const chunkSize = voxel * Math.round(8 / voxel)
      const { chunks } = new GalleryGenerator(layout).generateAll({ voxel, chunkSize, bakeShadows: false })
      const ids = new Map<string, number>()
      const edges = new Map<string, number>()
      for (const chunk of chunks) {
        const global = new Int32Array(chunk.positions.length / 3)
        for (let v = 0; v < global.length; v++) {
          const key = `${chunk.positions[v * 3]},${chunk.positions[v * 3 + 1]},${chunk.positions[v * 3 + 2]}`
          let id = ids.get(key)
          if (id === undefined) { id = ids.size; ids.set(key, id) }
          global[v] = id
        }
        for (let t = 0; t < chunk.indices.length; t += 3) {
          for (let e = 0; e < 3; e++) {
            const a = global[chunk.indices[t + e]], b = global[chunk.indices[t + ((e + 1) % 3)]]
            const key = a < b ? `${a}-${b}` : `${b}-${a}`
            edges.set(key, (edges.get(key) ?? 0) + 1)
          }
        }
      }
      const boundary = [...edges.values()].filter(count => count === 1).length
      expect(boundary, `vóxel ${voxel}: aristas de borde`).toBe(0)
    }
  })

  it('respeta el frente ciego en el campo de distancia', () => {
    const generator = new GalleryGenerator(layout)
    const segment = generator.compiled.segments.find(item => item.spec.id === 'S5')!
    const o = (segment.distances.length - 1) * 3
    // 5 cm antes del frente, a 1,2 m de altura: muy cerca de la roca, no a 1,4 m.
    const tx = segment.points[o] - segment.points[o - 3], tz = segment.points[o + 2] - segment.points[o - 1]
    const tl = Math.hypot(tx, tz)
    const d = generator.field.distance(segment.points[o] - (tx / tl) * 0.05, segment.points[o + 1] + 1.2, segment.points[o + 2] - (tz / tl) * 0.05)
    expect(d).toBeGreaterThan(-0.6)
  })

  it('ubica infraestructura y luminarias según la configuración', () => {
    const { infrastructure, compiled } = new GalleryGenerator(layout)
    expect(infrastructure.lamps.length).toBeGreaterThan(12)
    expect(infrastructure.rails.length).toBe(8)
    expect(infrastructure.sleepers.length).toBeGreaterThan(150)
    expect(infrastructure.timberPosts.length).toBeGreaterThan(40)
    expect(infrastructure.arches[0]?.placements.length).toBeGreaterThan(20)
    expect(infrastructure.bolts.length).toBeGreaterThan(50)
    expect(infrastructure.signs.length).toBe(compiled.layout.signs.length)
    expect(infrastructure.refuges.length).toBe(1)
  })
})
