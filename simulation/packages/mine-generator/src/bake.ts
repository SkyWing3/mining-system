// Atributos por vértice calculados una sola vez al generar:
// - normales del gradiente del campo (sombreado suave),
// - máscaras de material (piso, concreto lanzado, roca oxidada, humedad, suciedad),
// - oclusión ambiental del campo,
// - iluminación difusa de las luminarias fijas con sombras suaves y su dirección dominante.
import type { MineField } from './field.ts'
import { createSample } from './field.ts'
import type { LampSpec } from './infrastructure.ts'
import { smoothstep } from './noise.ts'
import type { RawChunk } from './surfaceNets.ts'

export interface BakedChunk extends RawChunk {
  readonly normals: Float32Array
  /** floor, shotcrete, oxidized rock, wetness */
  readonly maskA: Float32Array
  /** dirt, ambient occlusion */
  readonly maskB: Float32Array
  /** Irradiancia difusa de luminarias (RGB, lineal). */
  readonly baked: Float32Array
  /** Dirección dominante de esa luz (para recuperar detalle con el mapa de normales). */
  readonly bakedDir: Float32Array
}

export interface BakeOptions {
  readonly shadows: boolean
}

/** Rejilla de luminarias para consultar solo las cercanas. */
export class LampIndex {
  private readonly cells = new Map<string, number[]>()
  readonly lamps: readonly LampSpec[]
  private readonly cell: number
  constructor(lamps: readonly LampSpec[], cell = 12) {
    this.lamps = lamps
    this.cell = cell
    for (const [index, lamp] of lamps.entries()) {
      const r = lamp.range
      for (let x = Math.floor((lamp.position[0] - r) / cell); x <= Math.floor((lamp.position[0] + r) / cell); x++)
        for (let y = Math.floor((lamp.position[1] - r) / cell); y <= Math.floor((lamp.position[1] + r) / cell); y++)
          for (let z = Math.floor((lamp.position[2] - r) / cell); z <= Math.floor((lamp.position[2] + r) / cell); z++) {
            const key = `${x},${y},${z}`
            const list = this.cells.get(key)
            if (list) list.push(index)
            else this.cells.set(key, [index])
          }
    }
  }
  near(x: number, y: number, z: number): readonly number[] {
    return this.cells.get(`${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`) ?? []
  }
}

export function bakeChunk(field: MineField, chunk: RawChunk, lamps: LampIndex, options: BakeOptions): BakedChunk {
  const { positions } = chunk
  const count = positions.length / 3
  const normals = new Float32Array(count * 3)
  const maskA = new Float32Array(count * 4)
  const maskB = new Float32Array(count * 2)
  const baked = new Float32Array(count * 3)
  const bakedDir = new Float32Array(count * 3)
  const noise = field.noise
  const sample = createSample()
  const normal: [number, number, number] = [0, 1, 0]
  for (let v = 0; v < count; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2]
    field.normal(x, y, z, normal)
    const [nx, ny, nz] = normal
    normals[v * 3] = nx; normals[v * 3 + 1] = ny; normals[v * 3 + 2] = nz
    field.sampleBase(x, y, z, sample)

    // Piso: cerca de la cota del eje y mirando hacia arriba.
    const floor = (1 - smoothstep(0.08, 0.45, sample.localY)) * smoothstep(0.35, 0.8, ny)
    const oxidized = smoothstep(-0.45, 0.75, noise.fbm(x * 0.04 + 7.3, y * 0.07, z * 0.04, 2))
    // Humedad: charcos en el piso y filtraciones verticales en hastiales y bóveda.
    const puddles = floor * smoothstep(0.05, 0.55, noise.fbm(x * 0.21 + 3.1, 1.7, z * 0.21, 3))
    const seepage = (1 - floor) * 0.75 * smoothstep(0.2, 0.95, noise.fbm(x * 0.5, y * 0.06 + 9.2, z * 0.5, 2)) * (0.55 + 0.45 * smoothstep(0, 2.5, sample.localY))
    const damp = 0.12 + 0.08 * noise.n3(x * 0.1, y * 0.1, z * 0.1)
    const wet = Math.min(1, Math.max(puddles, seepage, damp * (0.6 + floor)))
    // Suciedad: salpicaduras de barro en la parte baja de los hastiales.
    const dirt = (1 - floor) * (1 - smoothstep(0.1, 1.1, sample.localY)) * (0.6 + 0.4 * noise.n3(x * 0.7, y * 1.3, z * 0.7))
    const ao = field.ambientOcclusion(x, y, z, nx, ny, nz)

    maskA[v * 4] = floor
    maskA[v * 4 + 1] = sample.shotcrete
    maskA[v * 4 + 2] = oxidized
    maskA[v * 4 + 3] = wet
    maskB[v * 2] = Math.max(0, Math.min(1, dirt))
    maskB[v * 2 + 1] = ao

    let r = 0, g = 0, b = 0, dx = 0, dy = 0, dz = 0
    for (const lampIndex of lamps.near(x, y, z)) {
      const lamp = lamps.lamps[lampIndex]
      let lx = lamp.position[0] - x, ly = lamp.position[1] - y, lz = lamp.position[2] - z
      const distance = Math.hypot(lx, ly, lz)
      if (distance > lamp.range || distance < 1e-4) continue
      lx /= distance; ly /= distance; lz /= distance
      const ndl = nx * lx + ny * ly + nz * lz
      if (ndl <= 0) continue
      const window = Math.max(0, 1 - (distance / lamp.range) ** 4) ** 2
      let intensity = (lamp.intensity / (distance * distance + 0.6)) * window
      if (options.shadows) {
        intensity *= field.softShadow(x + nx * 0.04, y + ny * 0.04, z + nz * 0.04, lx, ly, lz, distance - 0.25, 10)
        if (intensity <= 0) continue
      }
      const irradiance = intensity * ndl
      r += irradiance * lamp.color[0]
      g += irradiance * lamp.color[1]
      b += irradiance * lamp.color[2]
      const weight = intensity
      dx += lx * weight; dy += ly * weight; dz += lz * weight
    }
    baked[v * 3] = r; baked[v * 3 + 1] = g; baked[v * 3 + 2] = b
    const dl = Math.hypot(dx, dy, dz)
    if (dl > 0) { bakedDir[v * 3] = dx / dl; bakedDir[v * 3 + 1] = dy / dl; bakedDir[v * 3 + 2] = dz / dl }
    else { bakedDir[v * 3] = nx; bakedDir[v * 3 + 1] = ny; bakedDir[v * 3 + 2] = nz }
  }
  return { ...chunk, normals, maskA, maskB, baked, bakedDir }
}
