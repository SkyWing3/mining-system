// Colisión contra la roca por fragmentos: una BVH pequeña por fragmento, construida al
// llegar del worker. Así la mina completa (cientos de fragmentos) no exige esperar a
// que termine la generación ni reconstruir una BVH gigante al final: el minero puede
// recorrer lo que ya está generado y la consulta solo visita los fragmentos cercanos.
import * as THREE from 'three'
import { MeshBVH, type ExtendedTriangle } from 'three-mesh-bvh'

/** Lo que el caminante y la cámara necesitan de la colisión (MeshBVH también lo cumple). */
export interface Collider {
  shapecast(callbacks: {
    intersectsBounds: (box: THREE.Box3) => boolean
    intersectsTriangle: (triangle: ExtendedTriangle) => boolean | void
  }): boolean
  raycastFirst(ray: THREE.Ray, side: THREE.Side, near: number, far: number): THREE.Intersection | null
  /** Verdadero si cerca del punto falta generar roca (el caminante espera en vez de caer). */
  pendingNear?(point: THREE.Vector3): boolean
}

interface Entry {
  readonly bvh: MeshBVH
  readonly box: THREE.Box3
}

const ray = new THREE.Ray()
const hitPoint = new THREE.Vector3()

export class ChunkedCollider implements Collider {
  readonly chunkSize: number
  private readonly entries = new Map<string, Entry>()
  /** Fragmentos esperados que todavía no llegaron. */
  private readonly pending: Set<string>

  constructor(chunkSize: number, expected: Iterable<string>) {
    this.chunkSize = chunkSize
    this.pending = new Set(expected)
  }

  get size(): number {
    return this.entries.size
  }

  get remaining(): number {
    return this.pending.size
  }

  /** Registra un fragmento generado (o vacío, sin superficie). */
  add(key: string, positions: Float32Array | null, indices: Uint32Array | Uint16Array | null): void {
    this.pending.delete(key)
    if (!positions || !indices || indices.length === 0) return
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    // La BVH reordena el índice: copia propia para no tocar el de la malla visible.
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1))
    geometry.computeBoundingBox()
    this.entries.set(key, { bvh: new MeshBVH(geometry), box: geometry.boundingBox!.clone().expandByScalar(0.01) })
  }

  isDone(key: string): boolean {
    return !this.pending.has(key)
  }

  pendingNear(point: THREE.Vector3): boolean {
    if (this.pending.size === 0) return false
    const size = this.chunkSize
    // Fragmentos que tocan una caja de ±1,5 m alrededor de la cápsula.
    for (const dx of [-1.5, 1.5]) for (const dy of [-1.5, 2.5]) for (const dz of [-1.5, 1.5]) {
      const key = `${Math.floor((point.x + dx) / size)},${Math.floor((point.y + dy) / size)},${Math.floor((point.z + dz) / size)}`
      if (this.pending.has(key)) return true
    }
    return false
  }

  shapecast(callbacks: { intersectsBounds: (box: THREE.Box3) => boolean; intersectsTriangle: (triangle: ExtendedTriangle) => boolean | void }): boolean {
    for (const entry of this.entries.values()) {
      if (!callbacks.intersectsBounds(entry.box)) continue
      if (entry.bvh.shapecast(callbacks)) return true
    }
    return false
  }

  raycastFirst(source: THREE.Ray, side: THREE.Side, near: number, far: number): THREE.Intersection | null {
    let best: THREE.Intersection | null = null
    let limit = far
    ray.copy(source)
    for (const entry of this.entries.values()) {
      const enter = ray.intersectBox(entry.box, hitPoint)
      if (!enter && !entry.box.containsPoint(ray.origin)) continue
      if (enter && ray.origin.distanceTo(hitPoint) > limit) continue
      const hit = entry.bvh.raycastFirst(ray, side, near, limit)
      if (hit && hit.distance <= limit) {
        best = hit
        limit = hit.distance
      }
    }
    return best
  }
}
