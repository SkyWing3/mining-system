// Campo de distancia con signo (SDF) de la red de galerías.
// Negativo = vacío (aire de la galería); positivo = roca. La superficie es d = 0.
// La unión suave de tramos y cámaras produce cruces y transiciones sin costuras;
// el ruido en espacio mundial da paredes irregulares y continuas entre fragmentos.
import type { CompiledLayout, Chamber, Piece } from './layout.ts'
import { CHAMBER_AMPLITUDE, MAX_AMPLITUDE, supportAt } from './layout.ts'
import { createNoise, smoothstep, type Noise } from './noise.ts'
import { horseshoeDistance } from './profile.ts'
import { hashString } from './rng.ts'

/** Valor devuelto lejos de cualquier galería (roca maciza). */
export const FAR = 6

const CELL = 6
const SMOOTH_K = 0.9

export interface FieldSample {
  /** Distancia base, sin irregularidad. */
  base: number
  /** Segmento más cercano (-1 si domina una cámara). */
  segment: number
  /** Cámara más cercana (-1 si domina un segmento). */
  chamber: number
  /** Distancia a lo largo del segmento. */
  s: number
  /** Altura sobre el piso del eje. */
  localY: number
  /** Desplazamiento lateral respecto del eje (positivo a la derecha). */
  lateral: number
  amplitude: number
  shotcrete: number
}

export function createSample(): FieldSample {
  return { base: FAR, segment: -1, chamber: -1, s: 0, localY: 0, lateral: 0, amplitude: 0, shotcrete: 0 }
}

/** Clave numérica de celda (evita crear cadenas en cada evaluación). Rango ±512 celdas (±3 km). */
function cellKey(x: number, y: number, z: number): number {
  return ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512)
}

function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

export class MineField {
  readonly compiled: CompiledLayout
  readonly noise: Noise
  private readonly grid = new Map<number, number[]>()
  private readonly scratch = createSample()
  private readonly groupIds = new Int32Array(64)
  private readonly groupDistance = new Float64Array(64)

  constructor(compiled: CompiledLayout) {
    this.compiled = compiled
    this.noise = createNoise(hashString(compiled.layout.name, compiled.layout.seed))
    const items: Array<{ min: readonly number[]; max: readonly number[] }> = [...compiled.pieces, ...compiled.chambers]
    for (const [id, item] of items.entries()) {
      const x0 = Math.floor(item.min[0] / CELL), x1 = Math.floor(item.max[0] / CELL)
      const y0 = Math.floor(item.min[1] / CELL), y1 = Math.floor(item.max[1] / CELL)
      const z0 = Math.floor(item.min[2] / CELL), z1 = Math.floor(item.max[2] / CELL)
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
        const key = cellKey(x, y, z)
        const list = this.grid.get(key)
        if (list) list.push(id)
        else this.grid.set(key, [id])
      }
    }
  }

  /** ¿Hay alguna primitiva que influya en la caja dada? Permite omitir fragmentos de roca maciza. */
  touchesBox(min: readonly number[], max: readonly number[]): boolean {
    // Solo las primitivas registradas en las celdas que cubre la caja (la mina completa
    // tiene miles de tramos y se consulta una caja por fragmento candidato).
    const pieces = this.compiled.pieces
    for (let x = Math.floor(min[0] / CELL); x <= Math.floor(max[0] / CELL); x++)
      for (let y = Math.floor(min[1] / CELL); y <= Math.floor(max[1] / CELL); y++)
        for (let z = Math.floor(min[2] / CELL); z <= Math.floor(max[2] / CELL); z++) {
          const list = this.grid.get(cellKey(x, y, z))
          if (!list) continue
          for (const id of list) {
            const item = id < pieces.length ? pieces[id] : this.compiled.chambers[id - pieces.length]
            if (item.max[0] >= min[0] && item.min[0] <= max[0] && item.max[1] >= min[1] && item.min[1] <= max[1] && item.max[2] >= min[2] && item.min[2] <= max[2]) return true
          }
        }
    return false
  }

  /** Distancia base (unión suave de primitivas) y atributos de la primitiva dominante. */
  sampleBase(x: number, y: number, z: number, out: FieldSample): FieldSample {
    const list = this.grid.get(cellKey(Math.floor(x / CELL), Math.floor(y / CELL), Math.floor(z / CELL)))
    out.base = FAR
    out.segment = -1
    out.chamber = -1
    if (!list) return out
    const pieces = this.compiled.pieces
    const pieceCount = pieces.length
    // Primero, unión dura por grupo (todos los tramos de un segmento forman un tubo continuo);
    // después, unión suave entre grupos (cruces, cambios de perfil y entradas a cámaras).
    const groups = this.groupIds
    const groupDistance = this.groupDistance
    let groupCount = 0
    let nearest = Infinity
    for (const id of list) {
      let distance: number
      let group: number
      if (id < pieceCount) {
        const piece = pieces[id]
        distance = this.pieceDistance(piece, x, y, z, out, nearest)
        group = piece.segment
        if (distance < nearest) nearest = distance
      } else {
        const chamber = this.compiled.chambers[id - pieceCount]
        distance = chamberDistance(chamber, x, y, z)
        group = 100000 + chamber.node
        if (distance < nearest) {
          nearest = distance
          out.segment = -1
          out.chamber = id - pieceCount
          out.localY = y - chamber.floorY
          out.lateral = 0
          out.s = 0
        }
      }
      let slot = 0
      while (slot < groupCount && groups[slot] !== group) slot++
      if (slot === groupCount) {
        groups[groupCount] = group
        groupDistance[groupCount] = distance
        groupCount++
      } else if (distance < groupDistance[slot]) {
        groupDistance[slot] = distance
      }
    }
    let hard = groupDistance[0]
    let smooth = groupDistance[0]
    for (let slot = 1; slot < groupCount; slot++) {
      hard = Math.min(hard, groupDistance[slot])
      smooth = smin(smooth, groupDistance[slot], SMOOTH_K)
    }
    // Cerca del piso la unión es dura: dos pisos coplanares no deben hundirse en el cruce.
    const fillet = smoothstep(0.35, 1.3, out.localY)
    out.base = Math.min(hard + (smooth - hard) * fillet, FAR)
    if (out.chamber >= 0) {
      out.amplitude = CHAMBER_AMPLITUDE
      out.shotcrete = 0
    } else if (out.segment >= 0) {
      const support = supportAt(this.compiled.segments[out.segment], out.s)
      out.amplitude = support.amplitude
      out.shotcrete = support.shotcrete
    }
    return out
  }

  private pieceDistance(piece: Piece, x: number, y: number, z: number, out: FieldSample, nearest: number): number {
    const px = x - piece.ax, py = y - piece.ay, pz = z - piece.az
    const s = px * piece.tx + py * piece.ty + pz * piece.tz
    const lo = -piece.extendStart
    const hi = piece.length + piece.extendEnd
    const sc = s < lo ? lo : s > hi ? hi : s
    const qx = px - piece.tx * sc, qy = py - piece.ty * sc, qz = pz - piece.tz * sc
    const lateral = qx * piece.rx + qy * piece.ry + qz * piece.rz
    const vertical = qx * piece.ux + qy * piece.uy + qz * piece.uz
    const section = horseshoeDistance(lateral, vertical, piece.profile)
    const beyond = Math.max(lo - s, s - hi)
    const distance = beyond > 0 ? (section > 0 ? Math.hypot(section, beyond) : beyond) : Math.max(section, beyond)
    if (distance < nearest) {
      out.segment = piece.segment
      out.chamber = -1
      out.s = piece.s0 + Math.min(Math.max(s, 0), piece.length)
      out.localY = vertical
      out.lateral = lateral
    }
    return distance
  }

  /**
   * Desplazamiento de la superficie (positivo = sobreexcavación). Rango aproximado
   * [-0,25·A, A] en hastiales y bóveda; el piso solo baja hasta 4,5 cm para ser transitable.
   */
  displacement(x: number, y: number, z: number, sample: FieldSample, detail: boolean): number {
    const noise = this.noise
    const amplitude = sample.amplitude
    const base = noise.fbm(x * 0.31, y * 0.31, z * 0.31, detail ? 4 : 2)
    const ridge = noise.ridged(x * 0.83 + 13.1, y * 0.83, z * 0.83, detail ? 3 : 1)
    const macro = noise.n3(x * 0.055, y * 0.07, z * 0.055)
    // Facetas de voladura (~0,8 m) solo con detalle: aristas vivas sobre la forma general.
    const facet = detail ? noise.facets(x * 1.25 + 3.7, y * 1.25, z * 1.25) : 0.35
    const wall = amplitude * (0.22 + 0.4 * base + 0.55 * (ridge - 0.45) + 0.25 * macro + 0.3 * (facet - 0.35))
    const floorWeight = 1 - smoothstep(0.12, 0.75, sample.localY)
    if (floorWeight <= 0) return wall
    const floor = 0.045 * (0.5 + 0.5 * noise.fbm(x * 0.9, 0.5, z * 0.9, detail ? 3 : 1))
    return wall + (floor - wall) * floorWeight
  }

  /** Distancia final con irregularidad. `detail = false` usa menos octavas (sombras, oclusión). */
  distance(x: number, y: number, z: number, detail = true): number {
    const sample = this.sampleBase(x, y, z, this.scratch)
    const base = sample.base
    // Banda estrecha: lejos de la superficie el ruido no cambia el signo.
    if (base > MAX_AMPLITUDE + 0.35 || base < -0.3 * MAX_AMPLITUDE - 0.35) return base
    return base - this.displacement(x, y, z, sample, detail)
  }

  /** Normal hacia el aire (−∇d normalizado). */
  normal(x: number, y: number, z: number, out: [number, number, number], eps = 0.05): [number, number, number] {
    const gx = this.distance(x + eps, y, z) - this.distance(x - eps, y, z)
    const gy = this.distance(x, y + eps, z) - this.distance(x, y - eps, z)
    const gz = this.distance(x, y, z + eps) - this.distance(x, y, z - eps)
    const length = Math.hypot(gx, gy, gz) || 1
    out[0] = -gx / length
    out[1] = -gy / length
    out[2] = -gz / length
    return out
  }

  /**
   * Avance por esferas desde el aire hacia la roca. Devuelve la distancia al impacto o
   * `null` si no hay pared dentro de `maxDistance`.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDistance: number): number | null {
    let t = 0
    for (let step = 0; step < 160 && t < maxDistance; step++) {
      const d = this.distance(ox + dx * t, oy + dy * t, oz + dz * t)
      if (d > -0.004) return t
      t += Math.max(-d * 0.6, 0.01)
    }
    return null
  }

  /** Sombra suave hacia una luz (1 = iluminado). Marcha por el campo con menos detalle. */
  softShadow(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDistance: number, hardness: number): number {
    let result = 1
    let t = 0.08
    for (let step = 0; step < 28 && t < maxDistance; step++) {
      // Dentro del aire la distancia es negativa: la holgura hasta la roca es −d.
      const clearance = -this.distance(ox + dx * t, oy + dy * t, oz + dz * t, false)
      if (clearance < 0.002) return 0
      result = Math.min(result, (hardness * clearance) / t)
      t += Math.min(Math.max(clearance * 0.8, 0.06), 1.2)
    }
    return Math.max(Math.min(result, 1), 0)
  }

  /** Oclusión ambiental por muestreo del campo a lo largo de la normal (1 = sin oclusión). */
  ambientOcclusion(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    let occlusion = 0
    let weight = 1
    for (const h of [0.12, 0.3, 0.6, 1.0, 1.6]) {
      const clearance = -this.distance(x + nx * h, y + ny * h, z + nz * h, false)
      occlusion += weight * Math.max(h - clearance, 0)
      weight *= 0.62
    }
    return Math.max(Math.min(1 - 0.38 * occlusion, 1), 0)
  }
}

function chamberDistance(chamber: Chamber, x: number, y: number, z: number): number {
  // Caja redondeada; el piso queda plano en la cota del nodo.
  const r = chamber.radius
  const qx = Math.abs(x - chamber.cx) - chamber.hx + r
  const qy = Math.abs(y - chamber.cy) - chamber.hy + r
  const qz = Math.abs(z - chamber.cz) - chamber.hz + r
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0))
  const inside = Math.min(Math.max(qx, qy, qz), 0)
  const box = outside + inside - r
  // El piso no se redondea: plano a la altura del nodo.
  return Math.max(box, chamber.floorY - y)
}
