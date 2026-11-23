// Mallado por "Surface Nets" (Gibson, 1998) de un fragmento cúbico del campo de distancia.
// La rejilla está alineada globalmente a múltiplos de `voxel`, así que fragmentos vecinos
// calculan vértices idénticos en el borde compartido y la superficie no presenta grietas.
import type { MineField } from './field.ts'

export interface RawChunk {
  readonly key: string
  readonly origin: [number, number, number]
  readonly positions: Float32Array
  readonly indices: Uint32Array
}

/** Genera la malla de un fragmento; devuelve `null` si el fragmento no contiene superficie. */
export function meshChunk(field: MineField, cx: number, cy: number, cz: number, chunkSize: number, voxel: number): RawChunk | null {
  const n = Math.round(chunkSize / voxel)
  // Índices globales enteros: fragmentos vecinos calculan exactamente las mismas coordenadas.
  const gx = cx * n, gy = cy * n, gz = cz * n
  const ox = gx * voxel, oy = gy * voxel, oz = gz * voxel
  // Puntos de -1 a n (las aristas propias van de 0 a n−1); celdas de -1 a n−1.
  const p = n + 2
  const values = new Float32Array(p * p * p)
  let hasAir = false
  let hasRock = false
  for (let k = 0; k < p; k++) {
    const z = (gz + k - 1) * voxel
    for (let j = 0; j < p; j++) {
      const y = (gy + j - 1) * voxel
      let index = (k * p + j) * p
      for (let i = 0; i < p; i++, index++) {
        const value = field.distance((gx + i - 1) * voxel, y, z)
        values[index] = value
        if (value < 0) hasAir = true
        else hasRock = true
      }
    }
  }
  if (!hasAir || !hasRock) return null

  const c = n + 1
  const cellVertex = new Int32Array(c * c * c).fill(-1)
  const positions: number[] = []
  const indices: number[] = []
  const at = (i: number, j: number, k: number) => values[((k + 1) * p + (j + 1)) * p + (i + 1)]

  const vertexOf = (ci: number, cj: number, ck: number): number => {
    const cell = ((ck + 1) * c + (cj + 1)) * c + (ci + 1)
    const existing = cellVertex[cell]
    if (existing >= 0) return existing
    // Promedio de los cruces por cero en las 12 aristas de la celda.
    let sx = 0, sy = 0, sz = 0, count = 0
    for (let corner = 0; corner < 8; corner++) {
      const ai = corner & 1, aj = (corner >> 1) & 1, ak = (corner >> 2) & 1
      const va = at(ci + ai, cj + aj, ck + ak)
      for (let axis = 0; axis < 3; axis++) {
        const bit = 1 << axis
        if (corner & bit) continue
        const bi = ai + (axis === 0 ? 1 : 0), bj = aj + (axis === 1 ? 1 : 0), bk = ak + (axis === 2 ? 1 : 0)
        const vb = at(ci + bi, cj + bj, ck + bk)
        if ((va < 0) === (vb < 0)) continue
        const t = va / (va - vb)
        sx += ai + (bi - ai) * t
        sy += aj + (bj - aj) * t
        sz += ak + (bk - ak) * t
        count++
      }
    }
    const index = positions.length / 3
    positions.push((gx + ci + sx / count) * voxel, (gy + cj + sy / count) * voxel, (gz + ck + sz / count) * voxel)
    cellVertex[cell] = index
    return index
  }

  const quad = (a: number, b: number, cc: number, d: number, flip: boolean) => {
    if (flip) { const swap = b; b = d; d = swap }
    // Diagonal más corta para triángulos mejor formados.
    const ac = dist2(positions, a, cc)
    const bd = dist2(positions, b, d)
    if (ac <= bd) indices.push(a, b, cc, a, cc, d)
    else indices.push(a, b, d, b, cc, d)
  }

  // Cada fragmento emite los cuadriláteros de las aristas cuyo punto base le pertenece (0..n-1).
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const v0 = at(i, j, k)
        const air = v0 < 0
        // Arista en X: celdas que la rodean en el plano (y, z).
        if (air !== (at(i + 1, j, k) < 0)) {
          quad(vertexOf(i, j - 1, k - 1), vertexOf(i, j, k - 1), vertexOf(i, j, k), vertexOf(i, j - 1, k), air)
        }
        // Arista en Y: plano (z, x).
        if (air !== (at(i, j + 1, k) < 0)) {
          quad(vertexOf(i - 1, j, k - 1), vertexOf(i - 1, j, k), vertexOf(i, j, k), vertexOf(i, j, k - 1), air)
        }
        // Arista en Z: plano (x, y).
        if (air !== (at(i, j, k + 1) < 0)) {
          quad(vertexOf(i - 1, j - 1, k), vertexOf(i, j - 1, k), vertexOf(i, j, k), vertexOf(i - 1, j, k), air)
        }
      }
    }
  }
  if (indices.length === 0) return null
  return { key: `${cx},${cy},${cz}`, origin: [ox, oy, oz], positions: new Float32Array(positions), indices: new Uint32Array(indices) }
}

function dist2(positions: number[], a: number, b: number): number {
  const dx = positions[a * 3] - positions[b * 3]
  const dy = positions[a * 3 + 1] - positions[b * 3 + 1]
  const dz = positions[a * 3 + 2] - positions[b * 3 + 2]
  return dx * dx + dy * dy + dz * dz
}
