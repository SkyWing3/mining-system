// Compila la configuración declarativa (nodos y segmentos) en primitivas geométricas:
// tramos rectos con su marco local y cámaras. No depende de ningún motor gráfico.
import type { GalleryLayout, NodeSpec, SegmentSpec, SupportType, TunnelProfile } from '@twin/shared-types'
import { clamp, smoothstep } from './noise.ts'

/** Tramo recto de una galería. Marco local: t (avance), r (derecha), u (arriba). */
export interface Piece {
  readonly segment: number
  readonly profile: TunnelProfile
  readonly ax: number; readonly ay: number; readonly az: number
  readonly tx: number; readonly ty: number; readonly tz: number
  readonly rx: number; readonly ry: number; readonly rz: number
  readonly ux: number; readonly uy: number; readonly uz: number
  readonly length: number
  /** Distancia acumulada del segmento al inicio del tramo. */
  readonly s0: number
  readonly extendStart: number
  readonly extendEnd: number
  readonly min: [number, number, number]
  readonly max: [number, number, number]
}

export interface Chamber {
  readonly node: number
  readonly cx: number; readonly cy: number; readonly cz: number
  readonly hx: number; readonly hy: number; readonly hz: number
  readonly radius: number
  readonly floorY: number
  readonly min: [number, number, number]
  readonly max: [number, number, number]
}

export interface CompiledSegment {
  readonly spec: SegmentSpec
  readonly profile: TunnelProfile
  /** Polilínea del eje a nivel de piso (x, y, z intercalados). */
  readonly points: Float64Array
  /** Distancia acumulada en cada punto de la polilínea. */
  readonly distances: Float64Array
  readonly length: number
}

export interface SupportState {
  /** Amplitud de la irregularidad de la roca (m). */
  readonly amplitude: number
  /** Peso del concreto lanzado (0..1). */
  readonly shotcrete: number
  readonly support: SupportType
}

export interface CompiledLayout {
  readonly layout: GalleryLayout
  readonly nodes: readonly NodeSpec[]
  readonly segments: readonly CompiledSegment[]
  readonly pieces: readonly Piece[]
  readonly chambers: readonly Chamber[]
  readonly min: [number, number, number]
  readonly max: [number, number, number]
}

/** Amplitud de la irregularidad por tipo de sostenimiento. */
export const SUPPORT_AMPLITUDE: Readonly<Record<SupportType, number>> = {
  bare: 0.4,
  timber: 0.2,
  'steel-arch': 0.17,
  shotcrete: 0.035,
}
export const CHAMBER_AMPLITUDE = 0.34
export const MAX_AMPLITUDE = 0.5

const PIECE_LENGTH = 2
const INTERNAL_OVERLAP = 0.45
const CONNECTING_KINDS = new Set(['junction', 'chamber', 'portal', 'refuge'])

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

/** Muestrea el eje del segmento con un spline Catmull-Rom que pasa por todos los puntos. */
function samplePolyline(control: ReadonlyArray<readonly [number, number, number]>): number[] {
  if (control.length === 2) {
    const [a, b] = control as [readonly [number, number, number], readonly [number, number, number]]
    const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    const steps = Math.max(1, Math.ceil(length / PIECE_LENGTH))
    const out: number[] = []
    for (let step = 0; step <= steps; step++) {
      const t = step / steps
      out.push(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)
    }
    return out
  }
  const out: number[] = []
  for (let span = 0; span < control.length - 1; span++) {
    const p0 = control[Math.max(span - 1, 0)]
    const p1 = control[span]
    const p2 = control[span + 1]
    const p3 = control[Math.min(span + 2, control.length - 1)]
    const chord = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2])
    const steps = Math.max(1, Math.ceil(chord / PIECE_LENGTH))
    for (let step = span === 0 ? 0 : 1; step <= steps; step++) {
      const t = step / steps
      out.push(catmullRom(p0[0], p1[0], p2[0], p3[0], t), catmullRom(p0[1], p1[1], p2[1], p3[1], t), catmullRom(p0[2], p1[2], p2[2], p3[2], t))
    }
  }
  return out
}

export function compileLayout(layout: GalleryLayout): CompiledLayout {
  const nodeIndex = new Map(layout.nodes.map((node, index) => [node.id, index]))
  const nodeById = (id: string, segment: string) => {
    const index = nodeIndex.get(id)
    if (index === undefined) throw new Error(`El segmento ${segment} referencia el nodo inexistente ${id}.`)
    return layout.nodes[index]
  }
  const segments: CompiledSegment[] = []
  const pieces: Piece[] = []
  for (const [segmentIndex, spec] of layout.segments.entries()) {
    const profile = layout.profiles[spec.profile]
    if (!profile) throw new Error(`El segmento ${spec.id} usa el perfil inexistente ${spec.profile}.`)
    const from = nodeById(spec.from, spec.id)
    const to = nodeById(spec.to, spec.id)
    const flat = samplePolyline([from.position, ...(spec.via ?? []), to.position])
    const points = new Float64Array(flat)
    const count = points.length / 3
    const distances = new Float64Array(count)
    for (let index = 1; index < count; index++) {
      const o = index * 3
      distances[index] = distances[index - 1] + Math.hypot(points[o] - points[o - 3], points[o + 1] - points[o - 2], points[o + 2] - points[o - 1])
    }
    segments.push({ spec, profile, points, distances, length: distances[count - 1] })
    const halfWidth = profile.width / 2
    const reach = Math.max(halfWidth, profile.wallHeight + profile.archRise) + MAX_AMPLITUDE + 1.2
    for (let index = 0; index < count - 1; index++) {
      const o = index * 3
      const ax = points[o], ay = points[o + 1], az = points[o + 2]
      let tx = points[o + 3] - ax, ty = points[o + 4] - ay, tz = points[o + 5] - az
      const length = Math.hypot(tx, ty, tz)
      if (length < 1e-6) continue
      tx /= length; ty /= length; tz /= length
      // r = t × (0, 1, 0): eje horizontal hacia la derecha del avance.
      let rx = -tz, ry = 0, rz = tx
      const rl = Math.hypot(rx, rz)
      if (rl < 1e-4) throw new Error(`El segmento ${spec.id} es vertical; los piques se generan aparte.`)
      rx /= rl; rz /= rl
      // u = r × t: "arriba" del marco, perpendicular al avance (sigue la pendiente).
      const ux = ry * tz - rz * ty, uy = rz * tx - rx * tz, uz = rx * ty - ry * tx
      const first = index === 0
      const last = index === count - 2
      const extendStart = first ? (CONNECTING_KINDS.has(from.kind) ? halfWidth + 0.6 : 0) : INTERNAL_OVERLAP
      const extendEnd = last ? (CONNECTING_KINDS.has(to.kind) ? halfWidth + 0.6 : 0) : INTERNAL_OVERLAP
      const bx = ax + tx * length, by = ay + ty * length, bz = az + tz * length
      const min: [number, number, number] = [Math.min(ax, bx) - reach - extendStart, Math.min(ay, by) - reach, Math.min(az, bz) - reach - extendStart]
      const max: [number, number, number] = [Math.max(ax, bx) + reach + extendEnd, Math.max(ay, by) + reach, Math.max(az, bz) + reach + extendEnd]
      pieces.push({ segment: segmentIndex, profile, ax, ay, az, tx, ty, tz, rx, ry, rz, ux, uy, uz, length, s0: distances[index], extendStart, extendEnd, min, max })
    }
  }
  const chambers: Chamber[] = []
  for (const [index, node] of layout.nodes.entries()) {
    if (!node.size || (node.kind !== 'chamber' && node.kind !== 'refuge')) continue
    const [sx, sy, sz] = node.size
    const radius = Math.min(1.6, sx * 0.3, sy * 0.35, sz * 0.3)
    const [x, y, z] = node.position
    const reach = CHAMBER_AMPLITUDE + 1.2
    chambers.push({
      node: index, cx: x, cy: y + sy / 2, cz: z, hx: sx / 2, hy: sy / 2, hz: sz / 2, radius, floorY: y,
      min: [x - sx / 2 - reach, y - reach, z - sz / 2 - reach],
      max: [x + sx / 2 + reach, y + sy + reach, z + sz / 2 + reach],
    })
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const item of [...pieces, ...chambers]) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], item.min[axis])
      max[axis] = Math.max(max[axis], item.max[axis])
    }
  }
  return { layout, nodes: layout.nodes, segments, pieces, chambers, min, max }
}

/** Sostenimiento en la distancia `s` del segmento, con transiciones suaves de 1,5 m. */
export function supportAt(segment: CompiledSegment, s: number): SupportState {
  const spans = segment.spec.supports
  let amplitude = SUPPORT_AMPLITUDE.bare
  let shotcrete = 0
  let support: SupportType = 'bare'
  const blend = 0.75
  for (const span of spans) {
    // Peso del tramo: 1 dentro, transición suave en los bordes.
    const weight = smoothstep(span.from - blend, span.from + blend, s) * (1 - smoothstep(span.to - blend, span.to + blend, s))
    if (weight <= 0) continue
    amplitude = amplitude + (SUPPORT_AMPLITUDE[span.support] - amplitude) * weight
    if (span.support === 'shotcrete') shotcrete = Math.max(shotcrete, weight)
    if (weight > 0.5) support = span.support
  }
  return { amplitude, shotcrete: clamp(shotcrete, 0, 1), support }
}

/** Posición y marco del eje del segmento en la distancia `s`. */
export function frameAt(segment: CompiledSegment, s: number): { position: [number, number, number]; tangent: [number, number, number]; right: [number, number, number]; up: [number, number, number] } {
  const { points, distances } = segment
  const count = distances.length
  const target = clamp(s, 0, segment.length)
  let index = 0
  while (index < count - 2 && distances[index + 1] < target) index++
  const o = index * 3
  const span = distances[index + 1] - distances[index] || 1
  const t = (target - distances[index]) / span
  const position: [number, number, number] = [
    points[o] + (points[o + 3] - points[o]) * t,
    points[o + 1] + (points[o + 4] - points[o + 1]) * t,
    points[o + 2] + (points[o + 5] - points[o + 2]) * t,
  ]
  let tx = points[o + 3] - points[o], ty = points[o + 4] - points[o + 1], tz = points[o + 5] - points[o + 2]
  const tl = Math.hypot(tx, ty, tz) || 1
  tx /= tl; ty /= tl; tz /= tl
  let rx = -tz, rz = tx
  const rl = Math.hypot(rx, rz) || 1
  rx /= rl; rz /= rl
  const up: [number, number, number] = [-rz * ty, rz * tx - rx * tz, rx * ty]
  return { position, tangent: [tx, ty, tz], right: [rx, 0, rz], up }
}
