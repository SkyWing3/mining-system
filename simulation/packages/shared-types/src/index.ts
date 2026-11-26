// Tipos compartidos entre el generador de la mina, el motor gráfico y la simulación.
// Unidades: metros. Ejes: +Y arriba (mismo convenio que three.js y glTF).

export type Vec3 = readonly [number, number, number]

/** Sostenimiento de una galería. Determina el material y la irregularidad de la roca. */
export type SupportType = 'bare' | 'timber' | 'steel-arch' | 'shotcrete'

/**
 * Sección en herradura: piso plano de ancho `width`, hastiales verticales hasta
 * `wallHeight` y bóveda semielíptica de flecha `archRise`.
 */
export interface TunnelProfile {
  readonly width: number
  readonly wallHeight: number
  readonly archRise: number
}

export type NodeKind = 'junction' | 'chamber' | 'end' | 'portal' | 'refuge' | 'face'

export interface NodeSpec {
  readonly id: string
  /** Punto del piso en el eje de la galería. */
  readonly position: Vec3
  readonly kind: NodeKind
  /** Cámaras: dimensiones interiores (ancho X, alto, largo Z) en metros. */
  readonly size?: Vec3
  readonly zone: string
  /** Cámaras: luminarias bajo el techo (falso en labores abandonadas, que quedan a oscuras). */
  readonly lit?: boolean
}

/** Tramo de una galería con su sostenimiento, entre dos distancias a lo largo del eje. */
export interface SupportSpan {
  readonly from: number
  readonly to: number
  readonly support: SupportType
}

export interface InfrastructureSpec {
  readonly rails?: boolean
  readonly pipes?: boolean
  readonly duct?: boolean
  readonly cables?: boolean
  /** Separación entre luminarias en metros; 0 o ausente: sin luminarias. */
  readonly lampSpacing?: number
}

export interface SegmentSpec {
  readonly id: string
  readonly from: string
  readonly to: string
  /** Puntos intermedios del eje (a nivel de piso). */
  readonly via?: readonly Vec3[]
  readonly profile: string
  readonly supports: readonly SupportSpan[]
  readonly infrastructure: InfrastructureSpec
  readonly zone: string
}

export type SignKind =
  | 'refuge' | 'exit' | 'caution-rail' | 'ppe' | 'no-smoking' | 'monitoring'
  | 'gas' | 'no-entry' | 'heat' | 'direction'

export interface SignSpec {
  readonly id: string
  readonly segment: string
  /** Distancia a lo largo del eje. */
  readonly at: number
  readonly side: 'left' | 'right'
  readonly kind: SignKind
  /** Letreros de dirección: título, hasta dos líneas y flecha. */
  readonly label?: { readonly title: string; readonly lines?: readonly string[]; readonly arrow?: 'left' | 'right' }
}

/** Cadena con letrero de prohibición atravesada en la galería (no bloquea el paso). */
export interface BarrierSpec {
  readonly id: string
  readonly segment: string
  readonly at: number
  /** Atenuación adicional de la señal Wi-Fi al atravesarla (tapón, derrumbe parcial), dB. */
  readonly radioLossDb?: number
}

/** Punto de acceso Wi-Fi montado en un hastial. */
export interface AccessPointSpec {
  readonly id: string
  readonly segment: string
  readonly at: number
  readonly side: 'left' | 'right'
  /** Potencia radiada (dBm), incluida la ganancia de la antena. */
  readonly txPowerDbm: number
}

/**
 * Propagación a 2,4 GHz por las galerías (didáctica): pérdida logarítmica con la
 * distancia recorrida por la galería, atenuación por metro, pérdida por curvatura y
 * por esquinas en los cruces. La roca no deja pasar la señal.
 */
export interface RadioModelSpec {
  /** Pérdida a 1 m (dB). */
  readonly referenceLossDb: number
  readonly pathLossExponent: number
  readonly attenuationDbPerM: number
  /** Pérdida por radián de curvatura del eje. */
  readonly bendLossDbPerRad: number
  /** Pérdida al doblar 90° en un cruce. */
  readonly cornerLossDb: number
}

export interface NetworkSpec {
  readonly ssid: string
  readonly accessPoints: readonly AccessPointSpec[]
  readonly model: RadioModelSpec
}

export interface GalleryLayout {
  readonly name: string
  readonly seed: number
  readonly profiles: Readonly<Record<string, TunnelProfile>>
  readonly nodes: readonly NodeSpec[]
  readonly segments: readonly SegmentSpec[]
  readonly signs: readonly SignSpec[]
  readonly barriers?: readonly BarrierSpec[]
  /** Escenario ambiental simulado (opcional). */
  readonly environment?: EnvironmentSpec
  /** Red Wi-Fi subterránea que enlaza las manillas con la central (opcional: sin ella, cobertura total). */
  readonly network?: NetworkSpec
}

export type SourceCategory = 'diesel' | 'blast' | 'old-workings' | 'no-ventilation' | 'fire' | 'heat'

/**
 * Fuente simulada de contaminante o calor ubicada en un nodo. La concentración
 * cae con la distancia medida por las galerías (el gas no atraviesa la roca).
 */
export interface EnvironmentSourceSpec {
  readonly id: string
  readonly label: string
  readonly node: string
  /** CO en el nodo (ppm) al iniciar la fuente. */
  readonly coPpm: number
  /** Calentamiento del aire en el nodo (°C). */
  readonly heatC?: number
  /** Calentamiento adicional de las superficies cercanas (termómetro infrarrojo). */
  readonly surfaceHeatC?: number
  /** Distancia característica de dilución a lo largo de la galería (m). */
  readonly length: number
  /**
   * Recinto confinado: hasta esta distancia de la fuente el aire está igual de
   * contaminado (cámara sin ventilación) y recién después se diluye.
   */
  readonly plateau?: number
  /** Humo visible en la fuente (0..1); en fuentes de calor, vapor de agua. El CO por sí solo no se ve ni se huele. */
  readonly smoke?: number
  /** Tipo de fuente, para la leyenda del mapa. */
  readonly category?: SourceCategory
  /** Fuente transitoria (humos de voladura): vida media de la concentración. */
  readonly halfLifeMinutes?: number
  /** Minutos transcurridos desde que empezó la fuente al iniciar la simulación. */
  readonly startedMinutesAgo?: number
  /** Variación relativa lenta (equipo en operación), 0..1. */
  readonly fluctuation?: number
}

/** Aire fresco o comprimido que mantiene un recinto (refugio) a una temperatura dada. */
export interface EnvironmentShelterSpec {
  readonly node: string
  readonly temperatureC: number
  readonly radius: number
}

/** Escenario ambiental didáctico de una galería. No es un modelo de ventilación. */
export interface EnvironmentSpec {
  /** Entrada de aire fresco (bocamina) y su temperatura. */
  readonly intake: { readonly node: string; readonly temperatureC: number }
  /** Temperatura de la roca virgen a la que tiende el aire al recorrer la mina. */
  readonly rockTemperatureC: number
  /** Distancia en que el aire se acerca a la temperatura de la roca (m). */
  readonly warmingLength: number
  /** CO de fondo (ppm). */
  readonly backgroundCoPpm: number
  /** Las superficies cercanas están algo más calientes que el aire. */
  readonly surfaceOffsetC: number
  readonly sources: readonly EnvironmentSourceSpec[]
  readonly shelters: readonly EnvironmentShelterSpec[]
}
