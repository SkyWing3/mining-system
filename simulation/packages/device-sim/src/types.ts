// Tipos compartidos por todos los módulos de la manilla (types.h).

/** Milisegundos de un reloj monótono (desde el arranque). */
export type MonotonicClock = () => number

/** Botones de navegación: subir, bajar y enter. */
export type Action = 'up' | 'down' | 'enter'

/** Nivel de alerta calculado por la manilla, con el nombre del protocolo de la central. */
export type Level = 'normal' | 'caution' | 'danger'

export const LEVEL_ORDER: readonly Level[] = ['normal', 'caution', 'danger']

/** Orden numérico del nivel: normal 0, precaución 1, peligro 2. */
export function levelRank(level: Level): number {
  return level === 'danger' ? 2 : level === 'caution' ? 1 : 0
}

/** Positivo si `a` es más grave que `b`. */
export function compareLevels(a: Level, b: Level): number {
  return levelRank(a) - levelRank(b)
}

/** Nombre en el protocolo de la central (normal, caution o danger). */
export function levelName(level: Level): string {
  return level
}

/** Texto corto para la OLED. */
export function levelLabel(level: Level): string {
  return level === 'caution' ? 'Precaución' : level === 'danger' ? 'PELIGRO' : 'Normal'
}
