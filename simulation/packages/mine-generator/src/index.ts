// API pública del generador. Es TypeScript puro: se ejecuta en Node (pre-generación),
// en un Web Worker o en pruebas, y siempre produce el mismo resultado para la misma semilla.
import type { GalleryLayout } from '@twin/shared-types'
import { bakeChunk, LampIndex, type BakedChunk } from './bake.ts'
import { MineField } from './field.ts'
import { buildInfrastructure, type Infrastructure } from './infrastructure.ts'
import { compileLayout, type CompiledLayout } from './layout.ts'
import { hashBuffers } from './rng.ts'
import { meshChunk } from './surfaceNets.ts'

export { MineField, FAR } from './field.ts'
export { compileLayout, frameAt, supportAt } from './layout.ts'
export type { CompiledLayout, CompiledSegment } from './layout.ts'
export { horseshoeDistance, profileOutline, profileHeight } from './profile.ts'
export { buildInfrastructure, quaternionFromBasis } from './infrastructure.ts'
export type { Infrastructure, LampSpec, PathSpec, Placement, SignPlacement, ArchSet, RefugePlacement } from './infrastructure.ts'
export type { BakedChunk } from './bake.ts'
export { hashBuffers, hashString, mulberry32 } from './rng.ts'

export interface GenerateOptions {
  /** Tamaño de vóxel en metros (menor = más detalle y más triángulos). */
  readonly voxel: number
  /** Arista del fragmento cúbico; debe ser múltiplo de `voxel`. */
  readonly chunkSize: number
  /** Sombras suaves en la luz horneada. */
  readonly bakeShadows: boolean
}

export interface ChunkList {
  readonly keys: Array<[number, number, number]>
}

export interface GenerationStats {
  readonly chunks: number
  readonly vertices: number
  readonly triangles: number
  readonly lamps: number
  readonly tunnelLength: number
  readonly milliseconds: number
  readonly hash: string
}

export class GalleryGenerator {
  readonly compiled: CompiledLayout
  readonly field: MineField
  readonly infrastructure: Infrastructure
  private readonly lamps: LampIndex

  constructor(layout: GalleryLayout) {
    this.compiled = compileLayout(layout)
    this.field = new MineField(this.compiled)
    this.infrastructure = buildInfrastructure(this.compiled, this.field)
    this.lamps = new LampIndex(this.infrastructure.lamps)
  }

  /** Fragmentos que pueden contener superficie, ordenados por cercanía al primer nodo. */
  chunkKeys(chunkSize: number): Array<[number, number, number]> {
    const { min, max } = this.compiled
    const keys: Array<[number, number, number]> = []
    for (let x = Math.floor(min[0] / chunkSize); x <= Math.floor(max[0] / chunkSize); x++)
      for (let y = Math.floor(min[1] / chunkSize); y <= Math.floor(max[1] / chunkSize); y++)
        for (let z = Math.floor(min[2] / chunkSize); z <= Math.floor(max[2] / chunkSize); z++) {
          const boxMin = [x * chunkSize, y * chunkSize, z * chunkSize]
          const boxMax = [(x + 1) * chunkSize, (y + 1) * chunkSize, (z + 1) * chunkSize]
          if (this.field.touchesBox(boxMin, boxMax)) keys.push([x, y, z])
        }
    const start = this.compiled.nodes[0]?.position ?? [0, 0, 0]
    const distance = (key: [number, number, number]) => Math.hypot((key[0] + 0.5) * chunkSize - start[0], (key[1] + 0.5) * chunkSize - start[1], (key[2] + 0.5) * chunkSize - start[2])
    return keys.sort((a, b) => distance(a) - distance(b))
  }

  generateChunk(key: [number, number, number], options: GenerateOptions): BakedChunk | null {
    const raw = meshChunk(this.field, key[0], key[1], key[2], options.chunkSize, options.voxel)
    if (!raw) return null
    return bakeChunk(this.field, raw, this.lamps, { shadows: options.bakeShadows })
  }

  tunnelLength(): number {
    return this.compiled.segments.reduce((sum, segment) => sum + segment.length, 0)
  }

  /** Genera todo de una vez (pruebas y pre-generación). */
  generateAll(options: GenerateOptions): { chunks: BakedChunk[]; stats: GenerationStats } {
    const started = performance.now()
    const chunks: BakedChunk[] = []
    for (const key of this.chunkKeys(options.chunkSize)) {
      const chunk = this.generateChunk(key, options)
      if (chunk) chunks.push(chunk)
    }
    const vertices = chunks.reduce((sum, chunk) => sum + chunk.positions.length / 3, 0)
    const triangles = chunks.reduce((sum, chunk) => sum + chunk.indices.length / 3, 0)
    const hash = hashBuffers(chunks.flatMap(chunk => [chunk.positions, chunk.indices, chunk.normals, chunk.maskA, chunk.maskB, chunk.baked, chunk.bakedDir]))
    return {
      chunks,
      stats: { chunks: chunks.length, vertices, triangles, lamps: this.infrastructure.lamps.length, tunnelLength: this.tunnelLength(), milliseconds: performance.now() - started, hash },
    }
  }
}
