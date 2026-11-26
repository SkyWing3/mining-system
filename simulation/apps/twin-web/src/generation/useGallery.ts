// Generación de la mina en varios workers, por cercanía al minero, con colisión por fragmento.
//
// La mina completa tiene cientos de fragmentos: generarla entera antes de poder caminar
// tomaría decenas de segundos. Los workers piden fragmentos de a uno y siempre reciben
// el pendiente más cercano al minero (o a la bocamina antes de que aparezca), y cada
// fragmento suma su propia BVH al colisionador. El minero puede entrar en cuanto la zona
// inicial está lista; el resto se completa mientras recorre la mina.
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import type { GalleryLayout } from '@twin/shared-types'
import { frameAt, GalleryGenerator, type BakedChunk, type Infrastructure } from '@twin/mine-generator'
import { ChunkedCollider, chunkSizeFor, type QualityProfile } from '@twin/graphics-engine'
import { miner } from '../scene/minerState.ts'
import { useTwin } from '../state/store.ts'
import type { GenerateMessage, GenerateRequest } from './generator.worker.ts'

export interface GalleryData {
  readonly generator: GalleryGenerator
  readonly infrastructure: Infrastructure
  readonly chunks: readonly BakedChunk[]
  /** Colisión de la roca; disponible desde que la zona inicial está generada. */
  readonly collider: ChunkedCollider | null
}

/** Radio alrededor del minero que debe estar generado antes de controlarlo. */
const READY_RADIUS = 26
/** Pedidos en vuelo por worker: el siguiente ya espera mientras se genera el actual. */
const IN_FLIGHT_PER_WORKER = 2
/** La cota pesa más: primero el nivel donde está el minero, después los demás. */
const VERTICAL_WEIGHT = 3

type Key = [number, number, number]

export function useGallery(layout: GalleryLayout, profile: QualityProfile): GalleryData {
  const generator = useMemo(() => new GalleryGenerator(layout), [layout])
  const [chunks, setChunks] = useState<readonly BakedChunk[]>([])
  const [collider, setCollider] = useState<ChunkedCollider | null>(null)
  const setGeneration = useTwin(state => state.setGeneration)
  const { voxel, bakeShadows } = profile

  useEffect(() => {
    const chunkSize = chunkSizeFor(voxel)
    const keys = generator.chunkKeys(chunkSize)
    const total = keys.length
    const workerCount = Math.max(1, Math.min((navigator.hardwareConcurrency ?? 4) - 2, 8, total))
    const started = performance.now()
    const solid = new ChunkedCollider(chunkSize, keys.map(key => key.join(',')))
    const received: BakedChunk[] = []
    const queue = keys.slice()
    let processed = 0
    let pending = false
    let cancelled = false
    let failed = false
    let ready = false

    // Punto de interés: el minero si ya apareció; si no, la bocamina (primer segmento).
    const spawn = frameAt(generator.compiled.segments[0], 2.5).position
    const focus = () => (miner.spawned ? miner.position : new THREE.Vector3(spawn[0], spawn[1], spawn[2]))
    const center = (key: Key, axis: number) => (key[axis] + 0.5) * chunkSize
    const distance = (key: Key, point: THREE.Vector3) => Math.hypot(center(key, 0) - point.x, (center(key, 1) - point.y - 1) * VERTICAL_WEIGHT, center(key, 2) - point.z)
    const start = focus().clone()
    const readyKeys = new Set(keys.filter(key => Math.hypot(center(key, 0) - start.x, center(key, 1) - start.y, center(key, 2) - start.z) < READY_RADIUS + chunkSize).map(key => key.join(',')))

    // Durante la regeneración no hay colisionador: volver a supervisión.
    if (useTwin.getState().cameraMode !== 'orbit') {
      if (document.pointerLockElement) document.exitPointerLock()
      useTwin.getState().setCameraMode('orbit')
    }
    setChunks([])
    setCollider(null)
    setGeneration({ status: 'running', done: 0, total, workers: workerCount, ready: false })

    const flush = () => {
      pending = false
      if (cancelled || failed) return
      setChunks([...received])
      if (processed < total) setGeneration({ status: 'running', done: processed, total, workers: workerCount, ready })
    }
    const nextKey = (): Key | null => {
      if (queue.length === 0) return null
      const point = focus()
      let best = 0
      let bestDistance = Infinity
      for (let index = 0; index < queue.length; index++) {
        const d = distance(queue[index], point)
        if (d < bestDistance) { bestDistance = d; best = index }
      }
      const key = queue[best]
      queue[best] = queue[queue.length - 1]
      queue.pop()
      return key
    }

    const workers = Array.from({ length: workerCount }, () => {
      const worker = new Worker(new URL('./generator.worker.ts', import.meta.url), { type: 'module' })
      const fail = (message: string) => {
        if (cancelled || failed) return
        failed = true
        setGeneration({ status: 'error', done: processed, total, error: message })
        workers.forEach(item => item.terminate())
      }
      const dispatch = () => {
        const key = nextKey()
        if (key) worker.postMessage({ type: 'chunk', key } satisfies GenerateRequest)
      }
      worker.onerror = event => fail(event.message || 'No se pudo iniciar el worker de generación.')
      worker.onmessageerror = () => fail('Mensaje ilegible del worker de generación.')
      worker.onmessage = (event: MessageEvent<GenerateMessage>) => {
        if (cancelled || failed) return
        const message = event.data
        if (message.type === 'error') {
          fail(message.message)
          return
        }
        processed++
        solid.add(message.key, message.chunk?.positions ?? null, message.chunk?.indices ?? null)
        if (message.chunk) received.push(message.chunk)
        if (!ready && [...readyKeys].every(key => solid.isDone(key))) {
          ready = true
          setCollider(solid)
        }
        dispatch()
        if (processed === total) {
          const ms = performance.now() - started
          const triangles = received.reduce((sum, chunk) => sum + chunk.indices.length / 3, 0)
          received.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
          setChunks([...received])
          if (!ready) { ready = true; setCollider(solid) }
          setGeneration({ status: 'done', done: processed, total, milliseconds: ms, triangles, workers: workerCount, ready: true })
          workers.forEach(item => item.terminate())
        } else if (!pending) {
          pending = true
          requestAnimationFrame(flush)
        }
      }
      worker.postMessage({ type: 'init', layout, voxel, chunkSize, bakeShadows } satisfies GenerateRequest)
      for (let index = 0; index < IN_FLIGHT_PER_WORKER; index++) dispatch()
      return worker
    })
    return () => {
      cancelled = true
      workers.forEach(worker => worker.terminate())
    }
  }, [generator, layout, voxel, bakeShadows, setGeneration])

  return { generator, infrastructure: generator.infrastructure, chunks, collider }
}
