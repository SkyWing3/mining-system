// Cobertura Wi-Fi simulada de la red subterránea (2,4 GHz).
//
// Bajo tierra la galería funciona como guía de onda y la roca no deja pasar la señal:
// lo que importa es el camino por las galerías, no la distancia en línea recta. Para
// cada punto de acceso se calcula, por el camino de menor pérdida:
//
//   RSSI = Ptx − L(1 m) − 10·n·log10(d) − α·d − κ·Σ|giro| − Σ esquinas − Σ tapones
//
// donde d es la distancia recorrida por la galería, α la atenuación por metro, κ la
// pérdida por radián de curvatura del eje y cada esquina de un cruce cuesta
// `cornerLossDb` a 90° (proporcional al ángulo). Es un modelo didáctico con órdenes de
// magnitud plausibles, no una predicción de propagación medida en una mina real.
import type { AccessPointSpec, BarrierSpec, NetworkSpec, RadioModelSpec } from '@twin/shared-types'
import type { CompiledLayout, CompiledSegment } from '@twin/mine-generator'

export interface AccessPointSignal {
  readonly id: string
  /** Intensidad recibida (dBm). */
  readonly rssi: number
}

export interface RadioReading {
  /** Puntos de acceso habilitados con señal útil, del más fuerte al más débil. */
  readonly signals: readonly AccessPointSignal[]
}

/** Lugar sobre la red de galerías: índice del segmento y distancia a lo largo de su eje. */
export interface AxisPoint {
  readonly segment: number
  readonly s: number
}

/** Por debajo de este nivel la señal se considera ruido y no se informa. */
export const NOISE_FLOOR_DBM = -100

interface SegmentRadio {
  readonly segment: CompiledSegment
  readonly from: number
  readonly to: number
  /** Giro acumulado (rad) en cada punto de la polilínea. */
  readonly turn: Float64Array
  /** Dirección de avance al salir del nodo inicial y al llegar al nodo final. */
  readonly startTangent: readonly [number, number, number]
  readonly endTangent: readonly [number, number, number]
  readonly barriers: ReadonlyArray<{ readonly s: number; readonly loss: number }>
}

/** Llegada a un nodo por un segmento: costo lineal (dB) y distancia recorrida. */
interface Arrival {
  cost: number
  distance: number
}

interface AccessPointTable {
  readonly spec: AccessPointSpec
  readonly segment: number
  readonly s: number
  /** Índice: estado = segmento × 2 + (0: llegó al nodo inicial, 1: al final). */
  readonly arrivals: Arrival[]
}

export class RadioCoverage {
  readonly network: NetworkSpec
  private readonly model: RadioModelSpec
  private readonly segments: SegmentRadio[]
  private readonly incident: number[][]
  private readonly tables: AccessPointTable[]
  private readonly disabled = new Set<string>()

  constructor(compiled: CompiledLayout, network: NetworkSpec, barriers: readonly BarrierSpec[] = []) {
    this.network = network
    this.model = network.model
    const nodeIndex = new Map(compiled.nodes.map((node, index) => [node.id, index]))
    const segmentIndex = new Map(compiled.segments.map((segment, index) => [segment.spec.id, index]))
    this.incident = compiled.nodes.map(() => [])
    this.segments = compiled.segments.map((segment, index) => {
      const from = nodeIndex.get(segment.spec.from)!
      const to = nodeIndex.get(segment.spec.to)!
      this.incident[from].push(index)
      this.incident[to].push(index)
      return {
        segment, from, to,
        turn: cumulativeTurn(segment.points),
        startTangent: tangent(segment.points, 0),
        endTangent: tangent(segment.points, segment.points.length / 3 - 2),
        barriers: barriers.filter(barrier => barrier.segment === segment.spec.id).map(barrier => ({ s: barrier.at, loss: barrier.radioLossDb ?? 0 })),
      }
    })
    this.tables = network.accessPoints.map(spec => {
      const index = segmentIndex.get(spec.segment)
      if (index === undefined) throw new Error(`El punto de acceso ${spec.id} está en el segmento inexistente ${spec.segment}.`)
      const s = Math.min(Math.max(spec.at, 0), this.segments[index].segment.length)
      return { spec, segment: index, s, arrivals: this.propagate(index, s) }
    })
  }

  get accessPoints(): readonly AccessPointSpec[] {
    return this.network.accessPoints
  }

  /** Pone un punto de acceso fuera de servicio (falla, corte de energía) o lo restablece. */
  setEnabled(id: string, enabled: boolean): void {
    if (!this.tables.some(table => table.spec.id === id)) throw new Error(`Punto de acceso desconocido: ${id}`)
    if (enabled) this.disabled.delete(id)
    else this.disabled.add(id)
  }

  isEnabled(id: string): boolean {
    return !this.disabled.has(id)
  }

  /** Señales recibidas en un punto de la galería. */
  sample(point: AxisPoint): RadioReading {
    const signals: AccessPointSignal[] = []
    for (const table of this.tables) {
      if (this.disabled.has(table.spec.id)) continue
      const rssi = this.rssi(table, point)
      if (rssi > NOISE_FLOOR_DBM) signals.push({ id: table.spec.id, rssi })
    }
    signals.sort((a, b) => b.rssi - a.rssi)
    return { signals }
  }

  /** Mejor señal disponible en un punto (dBm), o el piso de ruido si no hay ninguna. */
  bestRssi(point: AxisPoint): number {
    return this.sample(point).signals[0]?.rssi ?? NOISE_FLOOR_DBM
  }

  /** RSSI de un punto de acceso en particular (sin considerar si está habilitado). */
  rssiFrom(id: string, point: AxisPoint): number {
    const table = this.tables.find(item => item.spec.id === id)
    if (!table) throw new Error(`Punto de acceso desconocido: ${id}`)
    return this.rssi(table, point)
  }

  private rssi(table: AccessPointTable, point: AxisPoint): number {
    const radio = this.segments[point.segment]
    const length = radio.segment.length
    const s = Math.min(Math.max(point.s, 0), length)
    let best = -Infinity
    const consider = (cost: number, distance: number) => {
      const value = table.spec.txPowerDbm - this.model.referenceLossDb - 10 * this.model.pathLossExponent * Math.log10(Math.max(distance, 1)) - cost
      if (value > best) best = value
    }
    // En el mismo segmento que el punto de acceso: camino directo.
    if (table.segment === point.segment) consider(this.span(radio, table.s, s), Math.abs(s - table.s))
    // Llegando por cada extremo desde el resto de la red.
    for (const end of [0, 1] as const) {
      const node = end === 0 ? radio.from : radio.to
      const departure = end === 0 ? radio.startTangent : negate(radio.endTangent)
      const inner = end === 0 ? this.span(radio, 0, s) : this.span(radio, s, length)
      const along = end === 0 ? s : length - s
      for (const other of this.incident[node]) {
        if (other === point.segment) continue
        const state = other * 2 + (this.segments[other].from === node ? 0 : 1)
        const arrival = table.arrivals[state]
        if (!Number.isFinite(arrival.cost)) continue
        consider(arrival.cost + this.corner(this.arrivalDirection(other, node), departure) + inner, arrival.distance + along)
      }
    }
    return best
  }

  /** Pérdida lineal (dB) entre dos distancias del mismo segmento. */
  private span(radio: SegmentRadio, a: number, b: number): number {
    const low = Math.min(a, b), high = Math.max(a, b)
    let loss = this.model.attenuationDbPerM * (high - low) + this.model.bendLossDbPerRad * Math.abs(turnAt(radio, high) - turnAt(radio, low))
    for (const barrier of radio.barriers) if (barrier.s >= low && barrier.s <= high) loss += barrier.loss
    return loss
  }

  private corner(arrival: readonly number[], departure: readonly number[]): number {
    const cos = Math.min(1, Math.max(-1, arrival[0] * departure[0] + arrival[1] * departure[1] + arrival[2] * departure[2]))
    return this.model.cornerLossDb * Math.min(Math.acos(cos) / (Math.PI / 2), 2)
  }

  /** Dirección de avance al llegar a `node` recorriendo el segmento `index`. */
  private arrivalDirection(index: number, node: number): readonly number[] {
    const radio = this.segments[index]
    return radio.to === node ? radio.endTangent : negate(radio.startTangent)
  }

  /** Dijkstra sobre las llegadas a los nodos (estado = nodo + segmento por el que se llegó). */
  private propagate(segment: number, s: number): Arrival[] {
    const states = this.segments.length * 2
    const arrivals: Arrival[] = Array.from({ length: states }, () => ({ cost: Infinity, distance: Infinity }))
    const done = new Uint8Array(states)
    const radio = this.segments[segment]
    arrivals[segment * 2] = { cost: this.span(radio, 0, s), distance: s }
    arrivals[segment * 2 + 1] = { cost: this.span(radio, s, radio.segment.length), distance: radio.segment.length - s }
    for (;;) {
      let current = -1
      for (let index = 0; index < states; index++) {
        if (!done[index] && Number.isFinite(arrivals[index].cost) && (current < 0 || arrivals[index].cost < arrivals[current].cost)) current = index
      }
      if (current < 0) break
      done[current] = 1
      const via = current >> 1
      const node = current & 1 ? this.segments[via].to : this.segments[via].from
      const direction = this.arrivalDirection(via, node)
      for (const next of this.incident[node]) {
        if (next === via) continue
        const nextRadio = this.segments[next]
        const forward = nextRadio.from === node
        const departure = forward ? nextRadio.startTangent : negate(nextRadio.endTangent)
        const length = nextRadio.segment.length
        const cost = arrivals[current].cost + this.corner(direction, departure) + this.span(nextRadio, 0, length)
        const target = next * 2 + (forward ? 1 : 0)
        if (cost < arrivals[target].cost) arrivals[target] = { cost, distance: arrivals[current].distance + length }
      }
    }
    return arrivals
  }
}

function tangent(points: Float64Array, piece: number): [number, number, number] {
  const o = Math.max(0, piece) * 3
  const x = points[o + 3] - points[o], y = points[o + 4] - points[o + 1], z = points[o + 5] - points[o + 2]
  const length = Math.hypot(x, y, z) || 1
  return [x / length, y / length, z / length]
}

function negate(v: readonly number[]): [number, number, number] {
  return [-v[0], -v[1], -v[2]]
}

function cumulativeTurn(points: Float64Array): Float64Array {
  const count = points.length / 3
  const turn = new Float64Array(count)
  let previous = tangent(points, 0)
  for (let index = 1; index < count - 1; index++) {
    const current = tangent(points, index)
    const cos = Math.min(1, Math.max(-1, previous[0] * current[0] + previous[1] * current[1] + previous[2] * current[2]))
    turn[index] = turn[index - 1] + Math.acos(cos)
    previous = current
  }
  if (count > 1) turn[count - 1] = turn[count - 2]
  return turn
}

function turnAt(radio: SegmentRadio, s: number): number {
  const { distances } = radio.segment
  let index = 0
  while (index < distances.length - 2 && distances[index + 1] < s) index++
  const span = distances[index + 1] - distances[index] || 1
  const t = Math.min(Math.max((s - distances[index]) / span, 0), 1)
  return radio.turn[index] + (radio.turn[index + 1] - radio.turn[index]) * t
}
