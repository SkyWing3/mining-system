// Worker de generación: construye su propio generador (mismo resultado por semilla) y
// genera, de a uno, los fragmentos que le pide el hilo principal. Los pedidos llegan
// ordenados por cercanía al minero, así la zona donde está se genera primero. Los
// arreglos se transfieren sin copia.
import type { GalleryLayout } from '@twin/shared-types'
import { GalleryGenerator, type BakedChunk } from '@twin/mine-generator'

export type GenerateRequest =
  | { readonly type: 'init'; readonly layout: GalleryLayout; readonly voxel: number; readonly chunkSize: number; readonly bakeShadows: boolean }
  | { readonly type: 'chunk'; readonly key: readonly [number, number, number] }

export type GenerateMessage =
  | { readonly type: 'chunk'; readonly key: string; readonly chunk: BakedChunk | null }
  | { readonly type: 'error'; readonly message: string }

let generator: GalleryGenerator | null = null
let options: { voxel: number; chunkSize: number; bakeShadows: boolean } | null = null

self.onmessage = (event: MessageEvent<GenerateRequest>) => {
  const request = event.data
  try {
    if (request.type === 'init') {
      generator = new GalleryGenerator(request.layout)
      options = { voxel: request.voxel, chunkSize: request.chunkSize, bakeShadows: request.bakeShadows }
      return
    }
    if (!generator || !options) throw new Error('El worker recibió un fragmento antes de inicializarse.')
    const key: [number, number, number] = [request.key[0], request.key[1], request.key[2]]
    const chunk = generator.generateChunk(key, options)
    const transfer = chunk ? [chunk.positions.buffer, chunk.indices.buffer, chunk.normals.buffer, chunk.maskA.buffer, chunk.maskB.buffer, chunk.baked.buffer, chunk.bakedDir.buffer] : []
    self.postMessage({ type: 'chunk', key: key.join(','), chunk } satisfies GenerateMessage, { transfer: transfer as ArrayBuffer[] })
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) } satisfies GenerateMessage)
  }
}
