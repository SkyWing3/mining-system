// Perfiles gráficos. Cada valor tiene un costo medible en GPU o en tiempo de generación;
// el benchmark de F1.12 registra el resultado real de cada perfil.

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra'
export type TextureResolution = '1k' | '2k' | '4k'

export interface QualityProfile {
  readonly level: QualityLevel
  readonly label: string
  /** Límite de densidad de píxeles del lienzo. */
  readonly maxDpr: number
  /** Tamaño de vóxel de la roca (m). Menor = más triángulos y más tiempo de generación. */
  readonly voxel: number
  /** Sombras suaves en la luz horneada de las luminarias. */
  readonly bakeShadows: boolean
  readonly textureResolution: TextureResolution
  readonly anisotropy: number
  /** Luminarias cercanas con brillo especular dinámico. */
  readonly lampPool: number
  /** Resolución del mapa de sombras de la linterna (0 = sin sombras). */
  readonly headlampShadow: number
  /** Segunda capa de roca (oxidada) en el sombreador. */
  readonly oxidizedLayer: boolean
  readonly postprocessing: false | {
    readonly ao: 'performance' | 'low' | 'medium' | 'high' | 'ultra' | false
    readonly bloom: boolean
    readonly smaa: boolean
  }
  readonly dustParticles: number
}

export const QUALITY_PROFILES: Readonly<Record<QualityLevel, QualityProfile>> = {
  low: {
    level: 'low', label: 'Bajo', maxDpr: 1, voxel: 0.35, bakeShadows: false, textureResolution: '1k', anisotropy: 2,
    lampPool: 4, headlampShadow: 0, oxidizedLayer: false, postprocessing: false, dustParticles: 600,
  },
  medium: {
    level: 'medium', label: 'Medio', maxDpr: 1.25, voxel: 0.25, bakeShadows: true, textureResolution: '2k', anisotropy: 4,
    lampPool: 8, headlampShadow: 1024, oxidizedLayer: true, postprocessing: { ao: 'performance', bloom: true, smaa: true }, dustParticles: 1800,
  },
  high: {
    level: 'high', label: 'Alto', maxDpr: 1.5, voxel: 0.2, bakeShadows: true, textureResolution: '2k', anisotropy: 8,
    lampPool: 12, headlampShadow: 2048, oxidizedLayer: true, postprocessing: { ao: 'medium', bloom: true, smaa: true }, dustParticles: 3500,
  },
  ultra: {
    level: 'ultra', label: 'Ultra', maxDpr: 2, voxel: 0.16, bakeShadows: true, textureResolution: '4k', anisotropy: 16,
    lampPool: 16, headlampShadow: 4096, oxidizedLayer: true, postprocessing: { ao: 'high', bloom: true, smaa: true }, dustParticles: 7000,
  },
}

/** Fragmentos de 8 m aproximados al múltiplo exacto del vóxel (la rejilla debe estar alineada). */
export function chunkSizeFor(voxel: number): number {
  return voxel * Math.round(8 / voxel)
}

/** Sugerencia inicial según el equipo; el usuario puede cambiarla en todo momento. */
export function suggestQuality(): QualityLevel {
  if (typeof navigator === 'undefined') return 'high'
  const cores = navigator.hardwareConcurrency ?? 4
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
  if (cores <= 4 || memory <= 4) return 'low'
  if (cores <= 8) return 'medium'
  return 'high'
}
