// Geometrías de la infraestructura en su marco local (X = avance, Y = arriba, Z = derecha),
// el mismo convenio de las ubicaciones que entrega mine-generator.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { profileOutline } from '@twin/mine-generator'
import type { TunnelProfile } from '@twin/shared-types'
import { I_BEAM_PROFILE, sweepProfile } from './sweep.ts'

function translate(geometry: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  geometry.translate(x, y, z)
  return geometry
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared = parts.map(part => (part.index ? part.toNonIndexed() : part))
  for (const part of prepared) if (!part.getAttribute('uv')) part.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((part.getAttribute('position').count) * 2), 2))
  const merged = mergeGeometries(prepared, false)
  if (!merged) throw new Error('No se pudieron combinar las geometrías.')
  return merged
}

/** Durmiente de madera: 0,2 m a lo largo de la vía, 0,12 m de alto, 1,2 m de ancho. */
export function sleeperGeometry(): THREE.BufferGeometry {
  return new RoundedBoxGeometry(0.2, 0.12, 1.2, 2, 0.015)
}

/** Poste de entibado (rollizo) de altura unitaria con la base en y = 0. */
export function timberPostGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(0.1, 0.115, 1, 14, 1)
  geometry.translate(0, 0.5, 0)
  return geometry
}

/** Sombrero del cuadro: viga transversal de largo unitario (escala Z = ancho). */
export function timberCapGeometry(): THREE.BufferGeometry {
  return new RoundedBoxGeometry(0.2, 0.18, 1, 2, 0.02)
}

/** Tabla del encostillado, de largo unitario a lo largo de la galería. */
export function laggingGeometry(): THREE.BufferGeometry {
  return new RoundedBoxGeometry(1, 0.045, 0.2, 1, 0.01)
}

/** Ménsula de tubería: brazo horizontal y placa de anclaje. */
export function pipeBracketGeometry(): THREE.BufferGeometry {
  return merge([
    translate(new THREE.BoxGeometry(0.05, 0.04, 0.42), 0, 0, -0.1),
    translate(new THREE.BoxGeometry(0.12, 0.16, 0.012), 0, 0, 0.11),
    translate(new THREE.BoxGeometry(0.05, 0.3, 0.035), 0, -0.13, -0.29),
  ])
}

/** Perno con placa; Z local = normal de la superficie. */
export function boltGeometry(): THREE.BufferGeometry {
  const nut = new THREE.CylinderGeometry(0.022, 0.022, 0.03, 6)
  nut.rotateX(Math.PI / 2)
  const thread = new THREE.CylinderGeometry(0.009, 0.009, 0.06, 8)
  thread.rotateX(Math.PI / 2)
  return merge([
    new RoundedBoxGeometry(0.15, 0.15, 0.008, 1, 0.003),
    translate(nut, 0, 0, 0.018),
    translate(thread, 0, 0, 0.035),
  ])
}

/** Carcasa de la luminaria (torneada) con abrazadera; cuelga hacia abajo desde y = 0. */
export function lampHousingGeometry(): THREE.BufferGeometry {
  const profile = [
    new THREE.Vector2(0.001, 0.0), new THREE.Vector2(0.05, 0.0), new THREE.Vector2(0.075, -0.03),
    new THREE.Vector2(0.085, -0.1), new THREE.Vector2(0.09, -0.16), new THREE.Vector2(0.095, -0.17),
    new THREE.Vector2(0.06, -0.17),
  ]
  const shell = new THREE.LatheGeometry(profile, 20)
  const cage: THREE.BufferGeometry[] = []
  for (let index = 0; index < 4; index++) {
    const bar = new THREE.BoxGeometry(0.008, 0.12, 0.008)
    bar.translate(0.088, -0.23, 0)
    bar.rotateY((index / 4) * Math.PI * 2 + Math.PI / 4)
    cage.push(bar)
  }
  const ring = new THREE.TorusGeometry(0.085, 0.005, 6, 20)
  ring.rotateX(Math.PI / 2)
  ring.translate(0, -0.29, 0)
  const hanger = new THREE.CylinderGeometry(0.008, 0.008, 0.35, 6)
  hanger.translate(0, 0.17, 0)
  return merge([shell, ...cage, ring, hanger])
}

/** Difusor emisivo de la luminaria. */
export function lampLensGeometry(): THREE.BufferGeometry {
  const lens = new THREE.SphereGeometry(0.062, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)
  lens.translate(0, -0.165, 0)
  return lens
}

/** Arco de acero (perfil I) que sigue la sección de la galería, retirado 0,12 m de la roca. */
export function steelArchGeometry(profile: TunnelProfile): THREE.BufferGeometry {
  const outline = profileOutline(profile, 0.14, 24)
  // Del pie derecho al pie izquierdo pasando por la clave (sin el tramo del piso).
  const path = outline.slice(0, outline.length).map(([lateral, height]) => new THREE.Vector3(0, height, lateral))
  path.unshift(new THREE.Vector3(0, -0.05, path[0].z))
  path.push(new THREE.Vector3(0, -0.05, path[path.length - 1].z))
  const along = new THREE.Vector3(1, 0, 0)
  const arch = sweepProfile(path, I_BEAM_PROFILE, tangent => ({ u: along.clone(), v: new THREE.Vector3().crossVectors(along, tangent).normalize() }), 1)
  // Placas base de los pies.
  const footRight = new THREE.BoxGeometry(0.22, 0.02, 0.22)
  footRight.translate(0, 0, path[0].z)
  const footLeft = new THREE.BoxGeometry(0.22, 0.02, 0.22)
  footLeft.translate(0, 0, path[path.length - 1].z)
  return merge([arch, footRight, footLeft])
}

/** Tabique del refugio: placa con la forma de la sección, empotrada 0,3 m en la roca. */
export function bulkheadGeometry(profile: TunnelProfile): THREE.BufferGeometry {
  // Contorno agrandado 0,3 m y bajado 0,3 m bajo el piso para quedar empotrado en la roca.
  const outline = profileOutline(profile, -0.3, 28)
  const shape = new THREE.Shape(outline.map(([lateral, height]) => new THREE.Vector2(lateral, height === 0 ? -0.3 : height)))
  // Vano de la puerta: 1,0 m × 2,0 m.
  const hole = new THREE.Path([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0.5, 2.0), new THREE.Vector2(-0.5, 2.0)])
  shape.holes.push(hole)
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false })
  // La forma está en el plano XY (x = lateral); se gira para que el espesor siga el avance.
  geometry.rotateY(-Math.PI / 2)
  geometry.translate(0.15, 0, 0)
  return geometry
}

/** Marco y hoja de la puerta del refugio (cerrada), en el vano del tabique. */
export function refugeDoorGeometry(): THREE.BufferGeometry {
  const leaf = new RoundedBoxGeometry(0.06, 1.96, 0.96, 2, 0.01)
  leaf.translate(-0.02, 0.98, 0)
  const frameParts = [
    translate(new THREE.BoxGeometry(0.36, 0.08, 1.12), 0, 2.04, 0),
    translate(new THREE.BoxGeometry(0.36, 2.08, 0.08), 0, 1.04, 0.54),
    translate(new THREE.BoxGeometry(0.36, 2.08, 0.08), 0, 1.04, -0.54),
  ]
  const handle = new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8)
  handle.translate(-0.08, 1.05, -0.36)
  const wheel = new THREE.TorusGeometry(0.11, 0.012, 6, 18)
  wheel.rotateY(Math.PI / 2)
  wheel.translate(-0.075, 1.25, 0)
  return merge([leaf, ...frameParts, handle, wheel])
}

/** Letrero metálico de 0,6 × 0,4 m con su soporte; la cara impresa mira hacia +Z local. */
export function signPlateGeometry(): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(0.6, 0.4)
}

export function signBackGeometry(): THREE.BufferGeometry {
  return translate(new RoundedBoxGeometry(0.62, 0.42, 0.012, 1, 0.004), 0, 0, -0.008)
}

/**
 * Punto de acceso Wi-Fi industrial con dos antenas, en el marco de una superficie:
 * X a lo largo del hastial, Y arriba, Z hacia la galería.
 */
export function accessPointGeometry(): THREE.BufferGeometry {
  const housing = translate(new RoundedBoxGeometry(0.26, 0.2, 0.07, 2, 0.012), 0, 0, 0.045)
  const bracket = translate(new THREE.BoxGeometry(0.1, 0.24, 0.012), 0, 0, 0.006)
  const antennas = [-0.085, 0.085].map(x => {
    const base = translate(new THREE.CylinderGeometry(0.014, 0.014, 0.025, 10), x, 0.112, 0.045)
    const whip = translate(new THREE.CylinderGeometry(0.0075, 0.0085, 0.2, 8), x, 0.22, 0.045)
    return [base, whip]
  }).flat()
  return merge([housing, bracket, ...antennas])
}

/** LED de estado en la cara frontal del punto de acceso. */
export function accessPointLedGeometry(): THREE.BufferGeometry {
  return translate(new THREE.BoxGeometry(0.018, 0.018, 0.006), 0.085, -0.065, 0.082)
}
