// Generación de la galería en varios workers y construcción de la BVH de colisión.
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { GalleryLayout } from '@twin/shared-types'
import { GalleryGenerator, type BakedChunk, type Infrastructure } from '@twin/mine-generator'
import { chunkSizeFor, type QualityProfile } from '@twin/graphics-engine'
import { useTwin } from '../state/store.ts'
import type { GenerateMessage, GenerateRequest } from './generator.worker.ts'

export interface GalleryData {
  readonly generator: GalleryGenerator
  readonly infrastructure: Infrastructure
  readonly chunks: readonly BakedChunk[]
  readonly collider: MeshBVH | null
}

function buildCollider(chunks: readonly BakedChunk[]): MeshBVH {
  const vertexCount = chunks.reduce((sum, chunk) => sum + chunk.positions.length / 3, 0)
  const indexCount = chunks.reduce((sum, chunk) => sum + chunk.indices.length, 0)
  const positions = new Float32Array(vertexCount * 3)
  const indices = new Uint32Array(indexCount)
  let vertexOffset = 0
  let indexOffset = 0
  for (const chunk of chunks) {
    positions.set(chunk.positions, vertexOffset * 3)
    for (let index = 0; index < chunk.indices.length; index++) indices[indexOffset + index] = chunk.indices[index] + vertexOffset
    vertexOffset += chunk.positions.length / 3
    indexOffset += chunk.indices.length
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  return new MeshBVH(geometry)
}

export function useGallery(layout: GalleryLayout, profile: QualityProfile): GalleryData {
  const generator = useMemo(() => new GalleryGenerator(layout), [layout])
  const [chunks, setChunks] = useState<readonly BakedChunk[]>([])
  const [collider, setCollider] = useState<MeshBVH | null>(null)
  const setGeneration = useTwin(state => state.setGeneration)
  const { voxel, bakeShadows } = profile

  useEffect(() => {
    const chunkSize = chunkSizeFor(voxel)
    const keys = generator.chunkKeys(chunkSize)
    const workerCount = Math.max(1, Math.min((navigator.hardwareConcurrency ?? 4) - 2, 8, keys.length))
    const started = performance.now()
    const received: BakedChunk[] = []
    let finished = 0
    let processed = 0
    let pending = false
    let cancelled = false
    let failed = false
    // Durante la regeneración no hay colisionador: volver a supervisión.
    if (useTwin.getState().cameraMode !== 'orbit') {
      if (document.pointerLockElement) document.exitPointerLock()
      useTwin.getState().setCameraMode('orbit')
    }
    setChunks([])
    setCollider(null)
    setGeneration({ status: 'running', done: 0, total: keys.length, workers: workerCount })
    const flush = () => {
      pending = false
      if (!cancelled) setChunks([...received])
    }
    const workers = Array.from({ length: workerCount }, (_, workerIndex) => {
      const worker = new Worker(new URL('./generator.worker.ts', import.meta.url), { type: 'module' })
      const fail = (message: string) => {
        if (cancelled || failed) return
        failed = true
        setGeneration({ status: 'error', done: processed, total: keys.length, error: message })
        workers.forEach(item => item.terminate())
      }
      worker.onerror = event => fail(event.message || 'No se pudo iniciar el worker de generación.')
      worker.onmessageerror = () => fail('Mensaje ilegible del worker de generación.')
      worker.onmessage = (event: MessageEvent<GenerateMessage>) => {
        if (cancelled || failed) return
        const message = event.data
        if (message.type === 'chunk') {
          processed++
          if (message.chunk) received.push(message.chunk)
          if (!pending) { pending = true; requestAnimationFrame(flush) }
          setGeneration({ status: 'running', done: processed, total: keys.length, workers: workerCount })
        } else if (message.type === 'error') {
          fail(message.message)
        } else if (++finished === workerCount) {
          const ms = performance.now() - started
          const triangles = received.reduce((sum, chunk) => sum + chunk.indices.length / 3, 0)
          // Orden estable (por clave) para que el colisionador no dependa del orden de llegada.
          received.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
          setChunks([...received])
          setCollider(buildCollider(received))
          setGeneration({ status: 'done', done: processed, total: keys.length, milliseconds: ms, triangles, workers: workerCount })
          workers.forEach(item => item.terminate())
        }
      }
      // Reparto alternado: cada worker recibe fragmentos de todas las zonas, primero los cercanos.
      const request: GenerateRequest = { layout, keys: keys.filter((_, index) => index % workerCount === workerIndex), voxel, chunkSize, bakeShadows }
      worker.postMessage(request)
      return worker
    })
    return () => {
      cancelled = true
      workers.forEach(worker => worker.terminate())
    }
  }, [generator, layout, voxel, bakeShadows, setGeneration])

  return { generator, infrastructure: generator.infrastructure, chunks, collider }
}
