// Sección transversal en herradura: piso plano, hastiales verticales y bóveda semielíptica.
// Coordenadas locales: x lateral (positivo a la derecha), y altura sobre el piso del eje.
import type { TunnelProfile } from '@twin/shared-types'

/**
 * Distancia con signo a la sección (negativa dentro del vacío de la galería).
 * Unión (mínimo) de la caja piso–arranque y de la elipse completa de la bóveda, así que un
 * punto bajo el arranque también "ve" la clave cercana.
 */
export function horseshoeDistance(x: number, y: number, profile: TunnelProfile): number {
  const halfWidth = profile.width / 2
  const ax = Math.abs(x)
  // Caja cerrada [-hw, hw] × [0, wallHeight].
  const dx = ax - halfWidth
  const dy = Math.max(-y, y - profile.wallHeight)
  const box = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0)
  // Elipse de radios (halfWidth, archRise) centrada en el arranque.
  const ex = ax / halfWidth
  const ey = (y - profile.wallHeight) / profile.archRise
  const k = Math.hypot(ex, ey)
  let ellipse: number
  if (k >= 1) {
    // Fuera: (k − 1)·k / |∇k|, continua con el hastial en el arranque.
    ellipse = ((k - 1) * k) / Math.hypot(ex / halfWidth, ey / profile.archRise)
  } else {
    // Dentro: aproximación conservadora con el radio menor.
    ellipse = (k - 1) * Math.min(halfWidth, profile.archRise)
  }
  return Math.min(box, ellipse)
}

/** Altura total libre en el eje. */
export function profileHeight(profile: TunnelProfile): number {
  return profile.wallHeight + profile.archRise
}

/**
 * Contorno cerrado de la sección (antihorario visto desde atrás del avance), reducido
 * hacia adentro en `inset` metros. Lo usan los arcos de acero y los tabiques del refugio.
 */
export function profileOutline(profile: TunnelProfile, inset: number, archSamples: number): Array<[number, number]> {
  const halfWidth = profile.width / 2 - inset
  const rise = profile.archRise - inset
  const wall = profile.wallHeight
  const points: Array<[number, number]> = [[halfWidth, 0], [halfWidth, wall]]
  for (let index = 1; index < archSamples; index++) {
    const angle = (index / archSamples) * Math.PI
    points.push([Math.cos(angle) * halfWidth, wall + Math.sin(angle) * rise])
  }
  points.push([-halfWidth, wall], [-halfWidth, 0])
  return points
}
