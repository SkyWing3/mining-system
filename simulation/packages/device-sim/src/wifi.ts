// Estación Wi-Fi del ESP32-S3 simulada: `WiFi.mode(WIFI_STA)` con `setAutoReconnect(true)`
// (network.cpp). El gemelo le entrega, en cada instante, la intensidad de los puntos de
// acceso que alcanzan la manilla; la estación decide si está asociada y cuánto sufre el
// tráfico TCP con la señal actual.
//
// Comportamiento reproducido de la pila Wi-Fi del ESP32 con la configuración del firmware:
// - se asocia al punto de acceso más fuerte que supere el mínimo, y tarda en hacerlo
//   (escaneo, autenticación, asociación y DHCP);
// - se queda con ese punto de acceso aunque aparezca otro mejor: el firmware no pide
//   itinerancia, así que solo cambia de antena después de perder la señal;
// - si deja de recibir balizas durante `beaconTimeoutMs`, se desasocia y vuelve a buscar;
// - con señal débil se pierden segmentos TCP: el tráfico llega tarde por las
//   retransmisiones, o no llega y vence el tiempo de respuesta de la sesión.

export interface AccessPointSignal {
  readonly id: string
  /** Intensidad recibida (dBm). */
  readonly rssi: number
}

/** Puntos de acceso que la manilla recibe en este instante, del más fuerte al más débil. */
export type RadioScan = () => readonly AccessPointSignal[]

export interface WifiTiming {
  /** RSSI mínimo para asociarse (dBm). */
  readonly associateDbm: number
  /** Por debajo de este nivel no llegan las balizas del punto de acceso (dBm). */
  readonly beaconLossDbm: number
  /** Sin balizas durante este tiempo la estación se desasocia (ESP-IDF: 6 s). */
  readonly beaconTimeoutMs: number
  /** Escaneo, autenticación, asociación y DHCP. */
  readonly connectMs: number
  /** Espera entre búsquedas cuando no hay red utilizable. */
  readonly retryMs: number
}

export const DEFAULT_WIFI_TIMING: WifiTiming = { associateDbm: -85, beaconLossDbm: -90, beaconTimeoutMs: 6000, connectMs: 2200, retryMs: 1500 }

export type WifiState = 'disconnected' | 'connecting' | 'connected'

export interface WifiStatus {
  readonly state: WifiState
  /** Punto de acceso asociado (o al que se está asociando). */
  readonly accessPoint: string | null
  /** RSSI del punto de acceso asociado, o null si no se recibe. */
  readonly rssi: number | null
  /** Mejor punto de acceso disponible en este instante. */
  readonly best: AccessPointSignal | null
  /** Probabilidad de perder un segmento TCP con la señal actual (0..1). */
  readonly segmentLoss: number
}

/**
 * Pérdida efectiva de segmentos TCP después de los reintentos de la capa MAC:
 * despreciable con buena señal, ~3 % a −80 dBm, la mitad a −87 dBm y casi todo a −90 dBm.
 */
export function segmentLoss(rssi: number | null): number {
  if (rssi === null) return 1
  return 1 / (1 + Math.exp((rssi + 87) / 2))
}

export class WifiStation {
  readonly timing: WifiTiming
  private readonly scan: RadioScan
  private readonly onEvent: (text: string) => void
  private state: WifiState = 'disconnected'
  private ap: string | null = null
  private rssi: number | null = null
  private signals: readonly AccessPointSignal[] = []
  private lowSince: number | null = null
  private readyAt = 0
  private nextScan = 0

  constructor(scan: RadioScan, onEvent: (text: string) => void = () => undefined, timing: WifiTiming = DEFAULT_WIFI_TIMING) {
    this.scan = scan
    this.onEvent = onEvent
    this.timing = timing
  }

  connected(): boolean {
    return this.state === 'connected'
  }

  status(): WifiStatus {
    return { state: this.state, accessPoint: this.ap, rssi: this.rssi, best: this.signals[0] ?? null, segmentLoss: this.state === 'connected' ? segmentLoss(this.lowSince === null ? this.rssi : null) : 1 }
  }

  /** Probabilidad de perder un segmento TCP ahora (1 sin asociación o sin balizas). */
  loss(): number {
    return this.status().segmentLoss
  }

  update(now: number): void {
    this.signals = this.scan()
    const current = this.ap === null ? null : (this.signals.find(signal => signal.id === this.ap)?.rssi ?? null)
    this.rssi = current
    const { associateDbm, beaconLossDbm } = this.timing
    switch (this.state) {
      case 'disconnected': {
        if (now < this.nextScan) break
        const best = this.signals[0]
        if (best && best.rssi >= associateDbm) {
          this.state = 'connecting'
          this.ap = best.id
          this.rssi = best.rssi
          this.readyAt = now + this.timing.connectMs
          this.onEvent(`Wi-Fi: asociándose a ${best.id} (${Math.round(best.rssi)} dBm)`)
        } else {
          this.nextScan = now + this.timing.retryMs
        }
        break
      }
      case 'connecting':
        if (current === null || current < beaconLossDbm) {
          this.onEvent(`Wi-Fi: no se pudo asociar a ${this.ap}`)
          this.drop(now)
        } else if (now >= this.readyAt) {
          this.state = 'connected'
          this.lowSince = null
          this.onEvent(`Wi-Fi conectado a ${this.ap} (${Math.round(current)} dBm)`)
        }
        break
      case 'connected':
        if (current === null || current < beaconLossDbm) {
          this.lowSince ??= now
          if (now - this.lowSince >= this.timing.beaconTimeoutMs) {
            this.onEvent(`Wi-Fi desconectado de ${this.ap}: sin balizas del punto de acceso`)
            this.drop(now)
          }
        } else {
          this.lowSince = null
        }
        break
    }
  }

  private drop(now: number): void {
    this.state = 'disconnected'
    this.ap = null
    this.rssi = null
    this.lowSince = null
    // La reconexión automática vuelve a buscar enseguida.
    this.nextScan = now + 300
  }
}
