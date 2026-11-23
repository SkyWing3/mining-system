import { describe, expect, it } from 'vitest'
import { compileLayout, frameAt } from '@twin/mine-generator'
import type { GalleryLayout } from '@twin/shared-types'
import layoutJson from '../../../config/galeria-validacion.json'
import { MineEnvironment, type Point3 } from '../src/index.ts'

const layout = layoutJson as unknown as GalleryLayout
const compiled = compileLayout(layout)

function at(segmentId: string, s: number, lateral = 0): Point3 {
  const segment = compiled.segments.find(item => item.spec.id === segmentId)!
  const frame = frameAt(segment, s)
  return { x: frame.position[0] + frame.right[0] * lateral, y: frame.position[1] + 1.2, z: frame.position[2] + frame.right[2] * lateral }
}

function node(id: string): Point3 {
  const spec = compiled.nodes.find(item => item.id === id)!
  return { x: spec.position[0], y: spec.position[1] + 1.2, z: spec.position[2] }
}

describe('MineEnvironment', () => {
  const environment = () => new MineEnvironment(compiled, layout.environment!)

  it('la bocamina tiene aire limpio y frío', () => {
    const reading = environment().sample(at('S1', 1), 0)
    expect(reading.coPpm).toBeLessThan(2)
    expect(reading.ambientC).toBeGreaterThan(10)
    expect(reading.ambientC).toBeLessThan(14)
    expect(reading.location.zone).toBe('Socavón principal')
  })

  it('el aire se calienta al recorrer la galería', () => {
    const model = environment()
    const portal = model.sample(at('S1', 1), 3600).ambientC
    const deep = model.sample(at('S4', 20), 3600).ambientC
    expect(deep).toBeGreaterThan(portal + 4)
  })

  it('los humos de voladura ponen el frente en peligro al inicio y se disipan con el tiempo', () => {
    const model = environment()
    const face = node('F1')
    expect(model.sample(face, 0).coPpm).toBeGreaterThan(200)
    expect(model.sample(face, 120).coPpm).toBeGreaterThan(200)
    // 40 minutos después solo queda el aporte lejano del escape diésel.
    expect(model.sample(face, 40 * 60).coPpm).toBeLessThan(35)
    expect(model.sample(face, 0).location.zone).toBe('Frente de avance')
  })

  it('una nueva voladura vuelve a contaminar el frente', () => {
    const model = environment()
    const face = node('F1')
    const before = model.sample(face, 3600).coPpm
    model.restartSource('voladura-f1', 3600)
    expect(model.sample(face, 3601).coPpm).toBeGreaterThan(before + 500)
  })

  it('el gas se propaga por las galerías, no a través de la roca', () => {
    const model = environment()
    // El refugio C1 está a ~45 m en línea recta de A2 pero el frente queda a >100 m por galería.
    const refuge = model.sample(node('C1'), 0)
    expect(refuge.sources.find(source => source.id === 'voladura-f1')!.distance).toBeGreaterThan(100)
    expect(refuge.coPpm).toBeLessThan(5)
    expect(refuge.ambientC).toBeCloseTo(18, 0)
    expect(refuge.location.zone).toBe('Refugio N1')
  })

  it('el termómetro infrarrojo ve superficies más calientes que el aire', () => {
    const reading = environment().sample(node('F1'), 0)
    expect(reading.objectC).toBeGreaterThan(reading.ambientC + 5)
  })

  it('es determinista', () => {
    const a = environment().sample(at('S5', 8, 0.5), 123.4)
    const b = environment().sample(at('S5', 8, 0.5), 123.4)
    expect(a).toEqual(b)
  })
})
