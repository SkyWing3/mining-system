// Ruido coherente determinista en espacio mundial. Al evaluarse con coordenadas
// globales, fragmentos vecinos producen exactamente la misma superficie.
import { createNoise3D } from 'simplex-noise'
import { mulberry32 } from './rng.ts'

export interface Noise {
  /** Simplex 3D en [-1, 1]. */
  readonly n3: (x: number, y: number, z: number) => number
  /** Suma fractal normalizada a [-1, 1] aproximadamente. */
  readonly fbm: (x: number, y: number, z: number, octaves: number) => number
  /** Ruido acanalado en [0, 1]: crestas finas que imitan fracturas. */
  readonly ridged: (x: number, y: number, z: number, octaves: number) => number
  /**
   * Ruido celular (Worley): F2 − F1 en [0, ~1]. Vale 0 en los bordes entre celdas, así
   * que produce facetas planas con aristas vivas, como bloques de roca volada.
   */
  readonly facets: (x: number, y: number, z: number) => number
}

export function createNoise(seed: number): Noise {
  const n3 = createNoise3D(mulberry32(seed))
  const fbm = (x: number, y: number, z: number, octaves: number) => {
    let sum = 0
    let amplitude = 1
    let frequency = 1
    let norm = 0
    for (let octave = 0; octave < octaves; octave++) {
      sum += amplitude * n3(x * frequency, y * frequency, z * frequency)
      norm += amplitude
      amplitude *= 0.5
      frequency *= 2.03
    }
    return sum / norm
  }
  const ridged = (x: number, y: number, z: number, octaves: number) => {
    let sum = 0
    let amplitude = 1
    let frequency = 1
    let norm = 0
    for (let octave = 0; octave < octaves; octave++) {
      const ridge = 1 - Math.abs(n3(x * frequency + 31.7 * octave, y * frequency, z * frequency))
      sum += amplitude * ridge * ridge
      norm += amplitude
      amplitude *= 0.5
      frequency *= 2.11
    }
    return sum / norm
  }
  const salt = Math.floor(mulberry32(seed ^ 0x5bd1e995)() * 0x7fffffff)
  const facets = (x: number, y: number, z: number) => {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
    let f1 = Infinity
    let f2 = Infinity
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy, cz = iz + dz
      // Punto característico de la celda: hash entero determinista.
      let h = Math.imul(cx, 0x27d4eb2d) ^ Math.imul(cy, 0x165667b1) ^ Math.imul(cz, 0x1b873593) ^ salt
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
      const px = cx + ((h >>> 0) & 1023) / 1024
      h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
      const py = cy + ((h >>> 0) & 1023) / 1024
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
      const pz = cz + ((h >>> 0) & 1023) / 1024
      const d = (px - x) * (px - x) + (py - y) * (py - y) + (pz - z) * (pz - z)
      if (d < f1) { f2 = f1; f1 = d } else if (d < f2) f2 = d
    }
    return Math.sqrt(f2) - Math.sqrt(f1)
  }
  return { n3, fbm, ridged, facets }
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}
