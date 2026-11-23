// Worker de generación: cada worker construye su propio generador (mismo resultado por
// semilla) y procesa los fragmentos que se le asignan, transfiriendo los arreglos sin copia.
import type { GalleryLayout } from '@twin/shared-types'
import { GalleryGenerator, type BakedChunk } from '@twin/mine-generator'

export interface GenerateRequest {
  readonly layout: GalleryLayout
  readonly keys: Array<[number, number, number]>
  readonly voxel: number
  readonly chunkSize: number
  readonly bakeShadows: boolean
}

export type GenerateMessage =
  | { readonly type: 'chunk'; readonly chunk: BakedChunk | null }
  | { readonly type: 'done' }
  | { readonly type: 'error'; readonly message: string }

self.onmessage = (event: MessageEvent<GenerateRequest>) => {
  const { layout, keys, voxel, chunkSize, bakeShadows } = event.data
  try {
    const generator = new GalleryGenerator(layout)
    for (const key of keys) {
      const chunk = generator.generateChunk(key, { voxel, chunkSize, bakeShadows })
      const transfer = chunk ? [chunk.positions.buffer, chunk.indices.buffer, chunk.normals.buffer, chunk.maskA.buffer, chunk.maskB.buffer, chunk.baked.buffer, chunk.bakedDir.buffer] : []
      self.postMessage({ type: 'chunk', chunk } satisfies GenerateMessage, { transfer: transfer as ArrayBuffer[] })
    }
    self.postMessage({ type: 'done' } satisfies GenerateMessage)
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) } satisfies GenerateMessage)
  }
}
