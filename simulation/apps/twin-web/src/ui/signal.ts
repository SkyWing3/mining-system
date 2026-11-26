// Calidad del enlace Wi-Fi según la intensidad recibida, compartida por el mapa y los paneles.

export type Band = 'good' | 'fair' | 'poor' | 'none'

/** Calidad del enlace según la mejor señal: con −85 dBm la manilla aún se asocia. */
export function signalBand(rssi: number | null): Band {
  if (rssi === null || rssi < -90) return 'none'
  if (rssi < -85) return 'poor'
  if (rssi < -75) return 'fair'
  return 'good'
}

export const BAND_LABEL: Record<Band, string> = { good: 'Buena', fair: 'Aceptable', poor: 'Débil', none: 'Sin señal' }
