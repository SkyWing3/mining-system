// Ubicación de la infraestructura a lo largo de los ejes: rieles, durmientes, tuberías,
// ducto, cables, luminarias, cuadros de madera, arcos de acero, pernos, letreros y refugios.
// Solo produce transformaciones y trayectorias; el motor gráfico construye las mallas.
import type { SignSpec, TunnelProfile } from '@twin/shared-types'
import type { MineField } from './field.ts'
import { frameAt, supportAt, type CompiledLayout, type CompiledSegment } from './layout.ts'
import { mulberry32, hashString } from './rng.ts'

export type Vec3Tuple = [number, number, number]
export type QuatTuple = [number, number, number, number]

export interface Placement {
  readonly position: Vec3Tuple
  readonly quaternion: QuatTuple
  readonly scale: Vec3Tuple
}

export interface PathSpec {
  /** Puntos x, y, z intercalados. */
  readonly points: number[]
  readonly radius: number
}

export interface LampSpec {
  readonly position: Vec3Tuple
  readonly color: Vec3Tuple
  /** Intensidad luminosa equivalente (cd). */
  readonly intensity: number
  readonly range: number
  readonly placement: Placement
}

export interface SignPlacement {
  readonly kind: SignSpec['kind']
  readonly placement: Placement
}

export interface ArchSet {
  readonly profile: TunnelProfile
  readonly placements: Placement[]
}

export interface RefugePlacement {
  readonly profile: TunnelProfile
  readonly placement: Placement
}

export interface Infrastructure {
  readonly lamps: LampSpec[]
  readonly sleepers: Placement[]
  readonly rails: PathSpec[]
  readonly airPipes: PathSpec[]
  readonly waterPipes: PathSpec[]
  readonly pipeBrackets: Placement[]
  readonly ducts: PathSpec[]
  readonly cables: PathSpec[]
  readonly timberPosts: Placement[]
  readonly timberCaps: Placement[]
  readonly lagging: Placement[]
  readonly arches: ArchSet[]
  readonly bolts: Placement[]
  readonly signs: SignPlacement[]
  readonly refuges: RefugePlacement[]
}

/** Cuaternión desde un marco ortonormal: X = avance, Y = arriba, Z = derecha. */
export function quaternionFromBasis(x: Vec3Tuple, y: Vec3Tuple, z: Vec3Tuple): QuatTuple {
  const m00 = x[0], m01 = y[0], m02 = z[0]
  const m10 = x[1], m11 = y[1], m12 = z[1]
  const m20 = x[2], m21 = y[2], m22 = z[2]
  const trace = m00 + m11 + m22
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1)
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22)
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22)
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11)
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]
}

function multiplyQuat(a: QuatTuple, b: QuatTuple): QuatTuple {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]
}

function axisAngle(axis: Vec3Tuple, angle: number): QuatTuple {
  const s = Math.sin(angle / 2)
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)]
}

function offsetPoint(frame: ReturnType<typeof frameAt>, lateral: number, height: number, along = 0): Vec3Tuple {
  const { position: p, right: r, up: u, tangent: t } = frame
  return [p[0] + r[0] * lateral + u[0] * height + t[0] * along, p[1] + r[1] * lateral + u[1] * height + t[1] * along, p[2] + r[2] * lateral + u[2] * height + t[2] * along]
}

function framePlacement(frame: ReturnType<typeof frameAt>, position: Vec3Tuple, scale: Vec3Tuple = [1, 1, 1], extra?: QuatTuple): Placement {
  let quaternion = quaternionFromBasis(frame.tangent, frame.up, frame.right)
  if (extra) quaternion = multiplyQuat(quaternion, extra)
  return { position, quaternion, scale }
}

/** Trayectoria paralela al eje con desplazamiento lateral y altura constantes. */
function offsetPath(segment: CompiledSegment, lateral: number, height: number, step: number, from = 0.3, to = segment.length - 0.3, sag?: { spacing: number; depth: number }): number[] {
  const points: number[] = []
  const length = Math.max(to - from, 0)
  const steps = Math.max(2, Math.ceil(length / step))
  for (let index = 0; index <= steps; index++) {
    const s = from + (length * index) / steps
    let h = height
    if (sag) {
      const phase = ((s % sag.spacing) + sag.spacing) % sag.spacing / sag.spacing
      h -= sag.depth * 4 * phase * (1 - phase)
    }
    points.push(...offsetPoint(frameAt(segment, s), lateral, h))
  }
  return points
}

export function buildInfrastructure(compiled: CompiledLayout, field: MineField): Infrastructure {
  const result: Infrastructure = {
    lamps: [], sleepers: [], rails: [], airPipes: [], waterPipes: [], pipeBrackets: [], ducts: [], cables: [],
    timberPosts: [], timberCaps: [], lagging: [], arches: [], bolts: [], signs: [], refuges: [],
  }
  const archSets = new Map<string, ArchSet>()
  for (const [segmentIndex, segment] of compiled.segments.entries()) {
    const { spec, profile, length } = segment
    const random = mulberry32(hashString(spec.id, compiled.layout.seed))
    const halfWidth = profile.width / 2
    const crown = profile.wallHeight + profile.archRise
    const infra = spec.infrastructure
    const toNode = compiled.nodes.find(node => node.id === spec.to)
    const start = trimAt(compiled, segmentIndex, 'start')
    const end = length - trimAt(compiled, segmentIndex, 'end')

    if (infra.rails) {
      // Trocha angosta de 750 mm. Los rieles se apoyan sobre durmientes semienterrados.
      const gauge = 0.75
      result.rails.push({ points: offsetPath(segment, gauge / 2, 0.075, 1, start, end), radius: 0 })
      result.rails.push({ points: offsetPath(segment, -gauge / 2, 0.075, 1, start, end), radius: 0 })
      for (let s = start + 0.3; s < end - 0.2; s += 0.62) {
        const frame = frameAt(segment, s)
        const jitter = (random() - 0.5) * 0.06
        const yaw = axisAngle([0, 1, 0], (random() - 0.5) * 0.06)
        result.sleepers.push(framePlacement(frame, offsetPoint(frame, jitter, -0.02), [1, 1, 1], yaw))
      }
    }
    if (infra.pipes) {
      const lateral = halfWidth - 0.34
      result.airPipes.push({ points: offsetPath(segment, lateral, 2.05, 1, start, end), radius: 0.076 })
      result.waterPipes.push({ points: offsetPath(segment, lateral - 0.02, 1.78, 1, start, end), radius: 0.052 })
      for (let s = start + 1; s < end; s += 3) {
        const frame = frameAt(segment, s)
        result.pipeBrackets.push(framePlacement(frame, offsetPoint(frame, lateral + 0.1, 1.92)))
      }
    }
    if (infra.duct) {
      result.ducts.push({ points: offsetPath(segment, -halfWidth * 0.32, crown - 0.5, 1, start, end), radius: 0.3 })
    }
    if (infra.cables) {
      const lateral = -(halfWidth - 0.16)
      for (const [index, height] of [2.02, 1.94, 1.86].entries()) {
        result.cables.push({ points: offsetPath(segment, lateral + index * 0.025, height, 0.5, start, end, { spacing: 2.5, depth: 0.07 + index * 0.015 }), radius: 0.018 + index * 0.004 })
      }
    }
    if (infra.lampSpacing && infra.lampSpacing > 0) {
      const oldSection = spec.supports.some(span => span.support === 'timber')
      for (let s = start + infra.lampSpacing / 2; s < end; s += infra.lampSpacing) {
        const frame = frameAt(segment, s)
        const support = supportAt(segment, s).support
        // Luminaria colgada bajo la clave; en tramos entibados, bajo el sombrero del cuadro.
        const height = support === 'timber' ? profile.wallHeight + 0.12 : crown - 0.32
        const position = offsetPoint(frame, 0.15, height)
        const color: Vec3Tuple = oldSection && support === 'timber' ? [1, 0.74, 0.5] : [1, 0.9, 0.78]
        result.lamps.push({ position, color, intensity: 75, range: 16, placement: framePlacement(frame, position) })
      }
    }
    for (const span of spec.supports) {
      const from = Math.max(span.from, start)
      const to = Math.min(span.to, end)
      if (span.support === 'timber') {
        for (let s = from + 0.4; s < to; s += 1.25) {
          const frame = frameAt(segment, s)
          const lean = 0.06
          for (const side of [-1, 1]) {
            const tilt = axisAngle([1, 0, 0], -side * lean + (random() - 0.5) * 0.03)
            result.timberPosts.push(framePlacement(frame, offsetPoint(frame, side * (halfWidth - 0.16), 0), [1, profile.wallHeight + 0.32, 1], tilt))
          }
          result.timberCaps.push(framePlacement(frame, offsetPoint(frame, 0, profile.wallHeight + 0.3), [1, 1, profile.width + 0.25]))
          // Encostillado: tablas longitudinales apoyadas sobre los sombreros.
          if (s + 1.25 < to) {
            for (let board = -2; board <= 2; board++) {
              if (random() < 0.12) continue
              result.lagging.push(framePlacement(frame, offsetPoint(frame, board * (profile.width / 5.4), profile.wallHeight + 0.42, 0.625), [1.32, 1, 1]))
            }
          }
        }
      }
      if (span.support === 'steel-arch') {
        const key = JSON.stringify(profile)
        let set = archSets.get(key)
        if (!set) {
          set = { profile, placements: [] }
          archSets.set(key, set)
          result.arches.push(set)
        }
        for (let s = from + 0.5; s < to; s += 1.4) {
          const frame = frameAt(segment, s)
          set.placements.push(framePlacement(frame, frame.position))
        }
      }
      if (span.support === 'bare' || span.support === 'shotcrete') {
        // Pernos de anclaje con placa, en malla de 1,5 m sobre hastiales y bóveda.
        const angles = [-0.95, -0.45, 0, 0.45, 0.95]
        let row = 0
        for (let s = from + 0.75; s < to; s += 1.5, row++) {
          const frame = frameAt(segment, s)
          for (const [index, angle] of angles.entries()) {
            if ((row + index) % 2 === 1 && Math.abs(angle) < 0.2) continue
            const origin = offsetPoint(frame, 0, profile.wallHeight * 0.75)
            const dirLateral = Math.sin(angle)
            const dirUp = Math.cos(angle)
            const direction: Vec3Tuple = [
              frame.right[0] * dirLateral + frame.up[0] * dirUp,
              frame.right[1] * dirLateral + frame.up[1] * dirUp,
              frame.right[2] * dirLateral + frame.up[2] * dirUp,
            ]
            const hit = field.raycast(origin[0], origin[1], origin[2], direction[0], direction[1], direction[2], 4)
            if (hit === null) continue
            const point: Vec3Tuple = [origin[0] + direction[0] * hit, origin[1] + direction[1] * hit, origin[2] + direction[2] * hit]
            const normal: Vec3Tuple = [0, 0, 0]
            field.normal(point[0], point[1], point[2], normal)
            result.bolts.push(surfacePlacement(point, normal, frame.tangent, 0.015))
          }
        }
      }
    }
    for (const sign of compiled.layout.signs.filter(item => item.segment === spec.id)) {
      const frame = frameAt(segment, sign.at)
      const side = sign.side === 'right' ? 1 : -1
      const origin = offsetPoint(frame, 0, 1.75)
      const direction: Vec3Tuple = [frame.right[0] * side, frame.right[1] * side, frame.right[2] * side]
      const hit = field.raycast(origin[0], origin[1], origin[2], direction[0], direction[1], direction[2], halfWidth + 1.5)
      if (hit === null) continue
      const point: Vec3Tuple = [origin[0] + direction[0] * (hit - 0.06), origin[1], origin[2] + direction[2] * (hit - 0.06)]
      // El letrero mira hacia el eje de la galería.
      const facing: Vec3Tuple = [-direction[0], 0, -direction[2]]
      result.signs.push({ kind: sign.kind, placement: surfacePlacement(point, facing, [0, 1, 0], 0, true) })
    }
    if (toNode?.kind === 'refuge') {
      // Tabique en la boca de la cámara del refugio: donde el eje entra en su caja.
      const end = frameAt(segment, length)
      let inside = 0
      if (toNode.size) {
        const half = [toNode.size[0] / 2, toNode.size[1], toNode.size[2] / 2]
        const t = end.tangent
        inside = Math.min(...[0, 2].map(axis => (Math.abs(t[axis]) > 1e-3 ? half[axis] / Math.abs(t[axis]) : Infinity)))
      }
      const frame = frameAt(segment, Math.max(length - inside - 0.35, 0))
      result.refuges.push({ profile, placement: framePlacement(frame, frame.position) })
    }
    void segmentIndex
  }
  // Cámaras: luminarias en rejilla bajo el techo.
  for (const node of compiled.nodes) {
    if (node.kind !== 'chamber' || !node.size) continue
    const [sx, sy, sz] = node.size
    const [x, y, z] = node.position
    const height = y + sy - 0.55
    for (const fx of [-0.25, 0.25]) for (const fz of [-0.25, 0.25]) {
      const position: Vec3Tuple = [x + sx * fx, height, z + sz * fz]
      const frame = { tangent: [1, 0, 0] as Vec3Tuple, up: [0, 1, 0] as Vec3Tuple, right: [0, 0, 1] as Vec3Tuple }
      result.lamps.push({ position, color: [1, 0.92, 0.82], intensity: 120, range: 18, placement: { position, quaternion: quaternionFromBasis(frame.tangent, frame.up, frame.right), scale: [1, 1, 1] } })
    }
  }
  return result
}

/** Dirección del segmento al salir del nodo indicado. */
function leavingDirection(segment: CompiledSegment, atStart: boolean): Vec3Tuple {
  const frame = frameAt(segment, atStart ? 0.5 : segment.length - 0.5)
  return atStart ? frame.tangent : [-frame.tangent[0], -frame.tangent[1], -frame.tangent[2]]
}

/**
 * Distancia libre de infraestructura en un extremo del segmento:
 * - nodo de paso (dos segmentos): continuidad total;
 * - cruce: la línea principal (el par más alineado) continúa; los ramales se recortan;
 * - cámara: hasta cerca de su pared; extremo ciego o refugio: separación corta.
 */
function trimAt(compiled: CompiledLayout, segmentIndex: number, side: 'start' | 'end'): number {
  const segment = compiled.segments[segmentIndex]
  const nodeId = side === 'start' ? segment.spec.from : segment.spec.to
  const node = compiled.nodes.find(item => item.id === nodeId)
  if (!node) return 0.4
  if (node.kind === 'end' || node.kind === 'face') return side === 'start' ? 0.4 : 1.2
  if (node.kind === 'refuge') return 1.2
  if (node.kind === 'chamber' && node.size) return Math.max(Math.min(node.size[0], node.size[2]) / 2 - 0.3, 0)
  const connected = compiled.segments
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.spec.from === nodeId || item.spec.to === nodeId)
  if (connected.length <= 2) return 0
  const directions = connected.map(({ item }) => leavingDirection(item, item.spec.from === nodeId))
  let best: [number, number] = [0, 1]
  let bestDot = Infinity
  for (let a = 0; a < directions.length; a++)
    for (let b = a + 1; b < directions.length; b++) {
      const dot = directions[a][0] * directions[b][0] + directions[a][1] * directions[b][1] + directions[a][2] * directions[b][2]
      if (dot < bestDot) { bestDot = dot; best = [a, b] }
    }
  const mainLine = new Set([connected[best[0]].index, connected[best[1]].index])
  if (mainLine.has(segmentIndex)) return 0
  const widest = Math.max(...connected.map(({ item }) => item.profile.width))
  return widest / 2 + 0.4
}

/** Coloca un objeto plano sobre la superficie: Z local = normal (o "frente" del letrero). */
function surfacePlacement(point: Vec3Tuple, normal: Vec3Tuple, hint: Vec3Tuple, lift: number, keepUpright = false): Placement {
  const z = normalize(normal)
  let x = cross(keepUpright ? [0, 1, 0] : hint, z)
  if (Math.hypot(...x) < 1e-3) x = cross([1, 0, 0], z)
  x = normalize(x)
  const y = cross(z, x)
  const position: Vec3Tuple = [point[0] + z[0] * lift, point[1] + z[1] * lift, point[2] + z[2] * lift]
  return { position, quaternion: quaternionFromBasis(x, y, z), scale: [1, 1, 1] }
}

function cross(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function normalize(v: Vec3Tuple): Vec3Tuple {
  const length = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / length, v[1] / length, v[2] / length]
}
