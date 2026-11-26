// Mina simulada de dos niveles: cuartos de gas para poner a prueba los sensores y
// cobertura Wi-Fi limitada por las galerías.
import { describe, expect, it } from 'vitest'
import { compileLayout, frameAt } from '@twin/mine-generator'
import type { GalleryLayout } from '@twin/shared-types'
import layoutJson from '../../../config/mina-simulada.json'
import { MineEnvironment, RadioCoverage, type Point3 } from '../src/index.ts'

const layout = layoutJson as unknown as GalleryLayout
const compiled = compileLayout(layout)
const environment = () => new MineEnvironment(compiled, layout.environment!)
const coverage = () => new RadioCoverage(compiled, layout.network!, layout.barriers ?? [])

function segmentIndex(id: string): number {
  return compiled.segments.findIndex(segment => segment.spec.id === id)
}

function at(segmentId: string, s: number): Point3 {
  const segment = compiled.segments[segmentIndex(segmentId)]
  const frame = frameAt(segment, s)
  return { x: frame.position[0], y: frame.position[1] + 1.2, z: frame.position[2] }
}

function node(id: string): Point3 {
  const spec = compiled.nodes.find(item => item.id === id)!
  return { x: spec.position[0], y: spec.position[1] + 1.2, z: spec.position[2] }
}

/** Umbrales del firmware: CO 35/200 ppm, aire 32/38 °C, superficie 60/90 °C. */
const level = (value: number, caution: number, danger: number) => (value >= danger ? 'danger' : value >= caution ? 'caution' : 'normal')

describe('cuartos de gas de la mina simulada', () => {
  it('la labor abandonada está llena de CO y se diluye hacia la galería de veta', () => {
    const model = environment()
    expect(level(model.sample(node('G1'), 0).coPpm, 35, 200)).toBe('danger')
    const length = compiled.segments[segmentIndex('S09')].length
    // Recinto confinado: igual de contaminado cerca de la entrada de la cámara.
    expect(model.sample(at('S09', length - 8), 0).coPpm).toBeGreaterThan(380)
    // A mitad del acceso hay precaución; en la galería de veta, aire normal.
    expect(level(model.sample(at('S09', length - 25), 0).coPpm, 35, 200)).toBe('caution')
    expect(level(model.sample(node('V1'), 0).coPpm, 35, 200)).toBe('normal')
    expect(model.sample(node('G1'), 0).smoke).toBeLessThan(0.01)
  })

  it('el frente sin ventilación auxiliar da precaución por CO y por temperatura', () => {
    const reading = environment().sample(node('F2'), 0)
    expect(level(reading.coPpm, 35, 200)).toBe('caution')
    expect(level(reading.ambientC, 32, 38)).toBe('caution')
  })

  it('el incendio latente da peligro por CO y deja humo visible', () => {
    const reading = environment().sample(node('G2'), 0)
    expect(level(reading.coPpm, 35, 200)).toBe('danger')
    expect(reading.smoke).toBeGreaterThan(0.5)
    expect(reading.location.zone).toBe('Labor antigua (incendio latente)')
  })

  it('la labor caliente pone a prueba el termómetro infrarrojo sin CO', () => {
    const reading = environment().sample(node('H1'), 0)
    expect(level(reading.ambientC, 32, 38)).toBe('danger')
    expect(level(reading.objectC, 60, 90)).toBe('danger')
    expect(reading.coPpm).toBeLessThan(5)
  })

  it('la galería principal y los refugios tienen aire normal', () => {
    const model = environment()
    for (const point of [at('S02', 50), at('S20', 50), node('R1'), node('R2')]) {
      const reading = model.sample(point, 0)
      expect(level(reading.coPpm, 35, 200)).toBe('normal')
      expect(level(reading.ambientC, 32, 38)).toBe('normal')
    }
  })

  it('una cámara del nivel −1 no cambia la zona de la galería que pasa encima', () => {
    // H1 está debajo de la galería principal N0, cerca de x = 342.
    const above = environment().sample({ x: 342, y: 2.2, z: 0 }, 0)
    expect(above.location.zone).toBe('Galería principal N0')
    expect(above.ambientC).toBeLessThan(32)
  })
})

describe('cobertura Wi-Fi de la mina simulada', () => {
  const best = (radio: RadioCoverage, segment: string, s: number) => radio.bestRssi({ segment: segmentIndex(segment), s })

  it('las galerías principales, los refugios y las zonas de carguío tienen buena señal', () => {
    const radio = coverage()
    for (const [segment, s] of [['S01', 50], ['S02', 50], ['S04', 30], ['S07', 36], ['S20', 50], ['S21', 50], ['S24', 46], ['S26', 36]] as const) {
      expect(best(radio, segment, s), `${segment} a ${s} m`).toBeGreaterThan(-75)
    }
  })

  it('la labor abandonada queda sin señal pasado el tapón', () => {
    const radio = coverage()
    const length = compiled.segments[segmentIndex('S09')].length
    expect(best(radio, 'S09', 5)).toBeGreaterThan(-75)
    expect(best(radio, 'S09', length)).toBeLessThan(-90)
  })

  it('la señal no atraviesa la roca: un punto de acceso de otro nivel no se oye', () => {
    const radio = coverage()
    // AP-09 está en el nivel −1, unos 25 m bajo la galería principal N0.
    expect(radio.rssiFrom('AP-09', { segment: segmentIndex('S03'), s: 45 })).toBeLessThan(-100)
    expect(radio.rssiFrom('AP-09', { segment: segmentIndex('S21'), s: 50 })).toBeGreaterThan(-30)
  })

  it('doblar una esquina cuesta más que seguir recto la misma distancia', () => {
    const radio = coverage()
    // AP-02 está en S02 a 10 m de J1: 30 m recto por el socavón frente a 30 m por el crucero al taller.
    const straight = radio.rssiFrom('AP-02', { segment: segmentIndex('S01'), s: compiled.segments[segmentIndex('S01')].length - 20 })
    const corner = radio.rssiFrom('AP-02', { segment: segmentIndex('S06'), s: 20 })
    expect(straight - corner).toBeGreaterThan(10)
  })

  it('un punto de acceso fuera de servicio deja un hueco en su zona', () => {
    const radio = coverage()
    const before = best(radio, 'S12', 70)
    radio.setEnabled('AP-06', false)
    expect(best(radio, 'S12', 70)).toBeLessThan(before - 15)
    radio.setEnabled('AP-06', true)
    expect(best(radio, 'S12', 70)).toBeCloseTo(before, 6)
  })
})
