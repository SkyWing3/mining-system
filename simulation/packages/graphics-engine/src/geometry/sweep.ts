// Barrido de un perfil 2D a lo largo de una trayectoria 3D, con aristas vivas
// (vértices duplicados por cara del perfil). Se usa para rieles y arcos de acero.
import * as THREE from 'three'

export type Profile2D = ReadonlyArray<readonly [number, number]>

/**
 * `frame(t)` devuelve los ejes (u, v) del plano del perfil para la tangente t;
 * cada punto (a, b) del perfil se coloca en P + u·a + v·b.
 */
export function sweepProfile(path: readonly THREE.Vector3[], profile: Profile2D, frame: (tangent: THREE.Vector3) => { u: THREE.Vector3; v: THREE.Vector3 }, uvScale = 1): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const count = path.length
  const tangent = new THREE.Vector3()
  const frames = path.map((point, index) => {
    const next = path[Math.min(index + 1, count - 1)]
    const prev = path[Math.max(index - 1, 0)]
    tangent.subVectors(next, prev).normalize()
    const { u, v } = frame(tangent)
    return { point, u: u.clone(), v: v.clone() }
  })
  const along: number[] = [0]
  for (let index = 1; index < count; index++) along.push(along[index - 1] + path[index].distanceTo(path[index - 1]))
  const edges = profile.length
  for (let edge = 0; edge < edges; edge++) {
    const a = profile[edge]
    const b = profile[(edge + 1) % edges]
    // Normal del lado del perfil (perfil antihorario → normal hacia afuera).
    const ex = b[0] - a[0], ey = b[1] - a[1]
    const el = Math.hypot(ex, ey) || 1
    const nx = ey / el, ny = -ex / el
    const base = positions.length / 3
    for (let index = 0; index < count; index++) {
      const { point, u, v } = frames[index]
      for (const [px, py] of [a, b]) {
        positions.push(point.x + u.x * px + v.x * py, point.y + u.y * px + v.y * py, point.z + u.z * px + v.z * py)
        normals.push(u.x * nx + v.x * ny, u.y * nx + v.y * ny, u.z * nx + v.z * ny)
      }
      uvs.push(along[index] * uvScale, 0, along[index] * uvScale, el * uvScale * 4)
    }
    for (let index = 0; index < count - 1; index++) {
      const i0 = base + index * 2
      const i1 = i0 + 1
      const i2 = i0 + 2
      const i3 = i0 + 3
      indices.push(i0, i2, i1, i1, i2, i3)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  return geometry
}

/** Marco con "arriba" global: perfil en (derecha, arriba). Para rieles. */
export function uprightFrame(tangent: THREE.Vector3): { u: THREE.Vector3; v: THREE.Vector3 } {
  const up = new THREE.Vector3(0, 1, 0)
  const u = new THREE.Vector3().crossVectors(tangent, up).normalize()
  const v = new THREE.Vector3().crossVectors(u, tangent).normalize()
  return { u, v }
}

/** Puntos de una trayectoria intercalada (x, y, z, ...) como vectores. */
export function toVectors(points: readonly number[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  for (let index = 0; index < points.length; index += 3) out.push(new THREE.Vector3(points[index], points[index + 1], points[index + 2]))
  return out
}

/** Perfil de riel liviano (cabeza, alma y patín), antihorario, en metros. */
export const RAIL_PROFILE: Profile2D = [
  [-0.045, -0.06], [0.045, -0.06], [0.045, -0.052], [0.008, -0.044], [0.007, 0.004], [0.022, 0.01],
  [0.022, 0.032], [-0.022, 0.032], [-0.022, 0.01], [-0.007, 0.004], [-0.008, -0.044], [-0.045, -0.052],
]

/** Perfil I para arcos de acero: ala de 0,1 m (a lo largo de la galería) y peralte de 0,12 m. */
export const I_BEAM_PROFILE: Profile2D = [
  [-0.05, -0.06], [0.05, -0.06], [0.05, -0.048], [0.005, -0.048], [0.005, 0.048], [0.05, 0.048],
  [0.05, 0.06], [-0.05, 0.06], [-0.05, 0.048], [-0.005, 0.048], [-0.005, -0.048], [-0.05, -0.048],
]
