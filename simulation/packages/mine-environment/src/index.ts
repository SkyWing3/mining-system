// Modelo ambiental simulado de la galería: CO y temperatura en cualquier punto.
//
// Es un escenario didáctico, no un modelo de ventilación: cada fuente decae con
// la distancia medida por las galerías (el gas y el aire no atraviesan la roca) y,
// si es transitoria, con el tiempo. El aire entra por la bocamina y se acerca a la
// temperatura de la roca a medida que recorre la mina. Todos los valores que
// produce son simulados y así se rotulan en la interfaz.
import type { EnvironmentSourceSpec, EnvironmentSpec, NodeSpec } from '@twin/shared-types'
import type { CompiledLayout } from '@twin/mine-generator'

export interface Point3 { readonly x: number; readonly y: number; readonly z: number }

export interface Location {
  /** Índice del segmento más cercano y distancia a lo largo de su eje. */
  readonly segment: number
  readonly segmentId: string
  readonly s: number
  /** Distancia horizontal al eje (m). */
  readonly offset: number
  /** Zona administrativa del lugar (nodo especial cercano o segmento). */
  readonly zone: string
}

export interface SourceContribution {
  readonly id: string
  readonly label: string
  /** CO que aporta en el punto (ppm). */
  readonly coPpm: number
  /** CO actual en la fuente (ppm). */
  readonly strengthPpm: number
  /** Distancia por las galerías hasta la fuente (m). */
  readonly distance: number
}

export interface EnvironmentReading {
  readonly coPpm: number
  readonly ambientC: number
  /** Temperatura de las superficies cercanas (lo que mide el termómetro infrarrojo). */
  readonly objectC: number
  /** Humo o polvo visible en el lugar (0..1); el CO por sí solo es invisible. */
  readonly smoke: number
  /** Vapor de agua visible (afloramientos termales), 0..1. */
  readonly steam: number
  readonly location: Location
  readonly sources: readonly SourceContribution[]
}

export { RadioCoverage, type AccessPointSignal, type RadioReading } from './radio.ts'

interface Edge { readonly to: number; readonly length: number }

const LN2 = Math.log(2)

/** Escenario ambiental sobre una galería compilada. */
export class MineEnvironment {
  readonly spec: EnvironmentSpec
  private readonly compiled: CompiledLayout
  private readonly nodeIndex = new Map<string, number>()
  /** Distancia por las galerías desde cada nodo de interés a todos los nodos. */
  private readonly nodeDistances = new Map<string, Float64Array>()
  /** Tiempo de simulación (s) en que empezó cada fuente transitoria. */
  private readonly sourceStart = new Map<string, number>()

  constructor(compiled: CompiledLayout, spec: EnvironmentSpec) {
    this.compiled = compiled
    this.spec = spec
    compiled.nodes.forEach((node, index) => this.nodeIndex.set(node.id, index))
    const adjacency: Edge[][] = compiled.nodes.map(() => [])
    for (const segment of compiled.segments) {
      const from = this.requireNode(segment.spec.from)
      const to = this.requireNode(segment.spec.to)
      adjacency[from].push({ to, length: segment.length })
      adjacency[to].push({ to: from, length: segment.length })
    }
    const anchors = new Set([spec.intake.node, ...spec.sources.map(source => source.node), ...spec.shelters.map(shelter => shelter.node)])
    for (const id of anchors) this.nodeDistances.set(id, dijkstra(adjacency, this.requireNode(id)))
    for (const source of spec.sources) this.sourceStart.set(source.id, -(source.startedMinutesAgo ?? 0) * 60)
  }

  /** Reinicia una fuente transitoria (por ejemplo, una nueva voladura) en el instante dado. */
  restartSource(id: string, timeSeconds: number): void {
    if (!this.sourceStart.has(id)) throw new Error(`Fuente desconocida: ${id}`)
    this.sourceStart.set(id, timeSeconds)
  }

  /** Concentración actual en la fuente misma (ppm). */
  sourceStrength(source: EnvironmentSourceSpec, timeSeconds: number): number {
    return source.coPpm * this.temporalFactor(source, timeSeconds, 1)
  }

  /** Punto del eje más cercano a una posición y su zona. */
  locate(point: Point3): Location {
    let best = Infinity
    let segmentIndex = 0
    let bestS = 0
    let bestOffset = 0
    this.compiled.segments.forEach((segment, index) => {
      const p = segment.points
      for (let i = 0; i < p.length / 3 - 1; i++) {
        const o = i * 3
        const ax = p[o], ay = p[o + 1], az = p[o + 2]
        const dx = p[o + 3] - ax, dz = p[o + 5] - az
        const lengthSq = dx * dx + dz * dz || 1
        const t = Math.max(0, Math.min(1, ((point.x - ax) * dx + (point.z - az) * dz) / lengthSq))
        const cx = ax + dx * t, cz = az + dz * t
        const cy = ay + (p[o + 4] - ay) * t
        const horizontal = Math.hypot(point.x - cx, point.z - cz)
        // La diferencia de cota pesa más: separa galerías de niveles distintos.
        const score = horizontal + Math.abs(point.y - cy) * 2
        if (score < best) {
          best = score
          segmentIndex = index
          bestS = segment.distances[i] + (segment.distances[i + 1] - segment.distances[i]) * t
          bestOffset = horizontal
        }
      }
    })
    const segment = this.compiled.segments[segmentIndex]
    return { segment: segmentIndex, segmentId: segment.spec.id, s: bestS, offset: bestOffset, zone: this.zoneAt(point, segment.spec.zone) }
  }

  sample(point: Point3, timeSeconds: number): EnvironmentReading {
    const location = this.locate(point)
    const spec = this.spec
    const intakeDistance = this.distanceTo(spec.intake.node, location)
    let ambient = spec.rockTemperatureC - (spec.rockTemperatureC - spec.intake.temperatureC) * Math.exp(-intakeDistance / spec.warmingLength)
    let surface = spec.surfaceOffsetC
    let co = spec.backgroundCoPpm
    let smoke = 0
    let steam = 0
    const sources: SourceContribution[] = []
    for (const source of spec.sources) {
      const distance = this.distanceTo(source.node, location)
      // En un recinto confinado el aire está igual de contaminado hasta `plateau`.
      const beyond = Math.max(0, distance - (source.plateau ?? 0))
      const falloff = Math.exp(-beyond / source.length)
      const gas = this.temporalFactor(source, timeSeconds, 1)
      // El calor de la roca recién volada se disipa más despacio que los humos.
      const heat = this.temporalFactor(source, timeSeconds, 3)
      const contribution = source.coPpm * gas * falloff
      co += contribution
      ambient += (source.heatC ?? 0) * heat * falloff
      surface += (source.surfaceHeatC ?? 0) * heat * Math.exp(-beyond / (source.length * 0.5))
      // En una fuente de calor lo visible es vapor de agua; en las demás, humo o polvo.
      if (source.smoke && source.category === 'heat') steam = Math.max(steam, source.smoke * falloff)
      else if (source.smoke) smoke = Math.max(smoke, source.smoke * gas * falloff)
      sources.push({ id: source.id, label: source.label, coPpm: contribution, strengthPpm: source.coPpm * gas, distance })
    }
    for (const shelter of spec.shelters) {
      // Recinto con aire comprimido: temperatura y CO controlados dentro del radio.
      const distance = this.distanceTo(shelter.node, location)
      const weight = Math.exp(-((distance / shelter.radius) ** 2))
      ambient += (shelter.temperatureC - ambient) * weight
      co *= 1 - weight * 0.95
      smoke *= 1 - weight
      steam *= 1 - weight
    }
    return { coPpm: co, ambientC: ambient, objectC: ambient + surface, smoke, steam, location, sources }
  }

  /** Distancia por las galerías desde un punto ubicado hasta un nodo. */
  distanceTo(nodeId: string, location: Location): number {
    const distances = this.nodeDistances.get(nodeId)
    if (!distances) throw new Error(`Nodo sin distancias precalculadas: ${nodeId}`)
    const segment = this.compiled.segments[location.segment]
    const from = distances[this.requireNode(segment.spec.from)]
    const to = distances[this.requireNode(segment.spec.to)]
    return Math.min(location.s + from, segment.length - location.s + to)
  }

  private temporalFactor(source: EnvironmentSourceSpec, timeSeconds: number, halfLifeScale: number): number {
    const variation = source.fluctuation
      ? 1 + source.fluctuation * (0.6 * Math.sin((2 * Math.PI * timeSeconds) / 37) + 0.4 * Math.sin((2 * Math.PI * timeSeconds) / 11.3 + 1.7))
      : 1
    if (!source.halfLifeMinutes) return variation
    const elapsed = Math.max(0, timeSeconds - (this.sourceStart.get(source.id) ?? 0))
    return variation * Math.exp((-LN2 * elapsed) / (source.halfLifeMinutes * 60 * halfLifeScale))
  }

  private zoneAt(point: Point3, segmentZone: string): string {
    // Cámaras, refugios y frentes tienen su propia zona dentro de su recinto.
    let zone = segmentZone
    let best = Infinity
    for (const node of this.compiled.nodes) {
      const radius = nodeRadius(node)
      if (radius === 0) continue
      // Otro nivel: una cámara bajo la galería no es la zona del minero.
      if (Math.abs(point.y - node.position[1]) > (node.size?.[1] ?? 4) + 3) continue
      const distance = Math.hypot(point.x - node.position[0], point.z - node.position[2])
      if (distance < radius && distance < best) {
        best = distance
        zone = node.zone
      }
    }
    return zone
  }

  private requireNode(id: string): number {
    const index = this.nodeIndex.get(id)
    if (index === undefined) throw new Error(`Nodo desconocido en el escenario ambiental: ${id}`)
    return index
  }
}

function nodeRadius(node: NodeSpec): number {
  if (node.size) return Math.max(node.size[0], node.size[2]) * 0.6
  return node.kind === 'face' ? 12 : 0
}

function dijkstra(adjacency: readonly Edge[][], start: number): Float64Array {
  const distances = new Float64Array(adjacency.length).fill(Infinity)
  const done = new Uint8Array(adjacency.length)
  distances[start] = 0
  for (let iteration = 0; iteration < adjacency.length; iteration++) {
    let current = -1
    for (let index = 0; index < adjacency.length; index++) {
      if (!done[index] && (current < 0 || distances[index] < distances[current])) current = index
    }
    if (current < 0 || distances[current] === Infinity) break
    done[current] = 1
    for (const edge of adjacency[current]) {
      const candidate = distances[current] + edge.length
      if (candidate < distances[edge.to]) distances[edge.to] = candidate
    }
  }
  return distances
}
