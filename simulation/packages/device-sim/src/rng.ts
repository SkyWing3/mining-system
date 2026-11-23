// Aleatoriedad determinista por semilla: la manilla virtual nunca usa Math.random,
// así la misma semilla reproduce las mismas lecturas, identificadores y tramas.
// mulberry32 es un generador de dominio público (Tommy Ettinger).

export interface Random {
  /** Uniforme en [0, 1). */
  next(): number
  /** Entero sin signo de 32 bits (identificadores de mensajes). */
  uint32(): number
  /** Normal de media 0 y desviación `sigma` (Box-Muller). */
  gaussian(sigma: number): number
}

export function createRandom(seed: number): Random {
  let state = seed >>> 0
  const nextUint = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }
  let spare: number | null = null
  return {
    next: () => nextUint() / 4294967296,
    uint32: nextUint,
    gaussian(sigma: number) {
      if (spare !== null) {
        const value = spare
        spare = null
        return value * sigma
      }
      let u = 0
      while (u <= Number.EPSILON) u = nextUint() / 4294967296
      const v = nextUint() / 4294967296
      const radius = Math.sqrt(-2 * Math.log(u))
      spare = radius * Math.sin(2 * Math.PI * v)
      return radius * Math.cos(2 * Math.PI * v) * sigma
    },
  }
}

/** Redondeo a `decimals` decimales, como `rounded()` del firmware. */
export function rounded(value: number, decimals: number): number {
  const scale = 10 ** decimals
  return Math.round(value * scale) / scale
}
