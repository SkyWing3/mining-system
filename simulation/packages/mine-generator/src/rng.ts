// Números pseudoaleatorios y hashes deterministas.
// mulberry32 es un generador de dominio público (Tommy Ettinger); el mismo algoritmo
// que usa threejs-procedural-dungeon (MIT) para reproducir mapas por semilla.

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a de 32 bits sobre texto, para derivar subsemillas estables. */
export function hashString(text: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** Hash FNV-1a de los bytes de varios arreglos tipados; sirve para probar el determinismo. */
export function hashBuffers(views: readonly ArrayBufferView[]): string {
  let hash = 0x811c9dc5
  for (const view of views) {
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
    for (let index = 0; index < bytes.length; index++) {
      hash ^= bytes[index]
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
