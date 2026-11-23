import * as THREE from 'three'
import { frameAt, type CompiledLayout, type CompiledSegment } from '@twin/mine-generator'

export interface Pose { readonly position: THREE.Vector3; readonly target: THREE.Vector3 }

/** Guiñada de la cámara que mira en la dirección de una tangente horizontal. */
export function yawFromTangent(tx: number, tz: number): number {
  return Math.atan2(-tx, -tz)
}

/** Punto del eje más cercano a una posición, con la dirección de avance. */
export function nearestAxisPoint(compiled: CompiledLayout, point: THREE.Vector3): { position: THREE.Vector3; yaw: number } {
  let best = Infinity
  const position = new THREE.Vector3()
  let yaw = 0
  for (const segment of compiled.segments) {
    const p = segment.points
    for (let index = 0; index < p.length / 3 - 1; index++) {
      const o = index * 3
      const d = Math.hypot(p[o] - point.x, p[o + 2] - point.z) + Math.abs(p[o + 1] - point.y) * 0.1
      if (d < best) {
        best = d
        position.set(p[o], p[o + 1], p[o + 2])
        yaw = yawFromTangent(p[o + 3] - p[o], p[o + 5] - p[o + 2])
      }
    }
  }
  return { position, yaw }
}

export function overviewPose(compiled: CompiledLayout): Pose {
  const { min, max } = compiled
  const center = new THREE.Vector3((min[0] + max[0]) / 2, 0, (min[2] + max[2]) / 2)
  const span = Math.max(max[0] - min[0], max[2] - min[2])
  return { position: new THREE.Vector3(center.x - span * 0.12, span * 0.3, center.z + span * 0.38), target: center }
}

/** Recorrido de la línea principal: segmentos encadenados desde el primer nodo. */
export function mainRoute(compiled: CompiledLayout): CompiledSegment[] {
  const route: CompiledSegment[] = []
  let node = compiled.nodes[0]?.id
  const used = new Set<string>()
  while (node) {
    const next = compiled.segments.find(segment => segment.spec.from === node && !used.has(segment.spec.id))
    if (!next) break
    used.add(next.spec.id)
    route.push(next)
    node = next.spec.to
  }
  return route
}

/** Posición y guiñada a una distancia del recorrido. */
export function routeFrame(route: readonly CompiledSegment[], distance: number): { position: THREE.Vector3; yaw: number; done: boolean } {
  let remaining = distance
  for (const segment of route) {
    if (remaining <= segment.length) {
      const frame = frameAt(segment, remaining)
      return { position: new THREE.Vector3(...frame.position), yaw: yawFromTangent(frame.tangent[0], frame.tangent[2]), done: false }
    }
    remaining -= segment.length
  }
  const last = route[route.length - 1]
  const frame = frameAt(last, last.length)
  return { position: new THREE.Vector3(...frame.position), yaw: yawFromTangent(frame.tangent[0], frame.tangent[2]), done: true }
}
