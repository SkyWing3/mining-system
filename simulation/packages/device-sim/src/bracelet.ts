// Manilla virtual: une los módulos portados del firmware como lo hace main.cpp.
//
// El reloj es simulado y avanza con `advance()`; dentro de cada avance se respeta
// el orden de la placa: sensores cada `sampleSeconds`, enlace con la central
// (tarea mining-link), subida de voz, cola de eventos de la tarea principal y
// `tick()` una vez por segundo. Con la misma semilla y los mismos avances, las
// lecturas, los identificadores y las tramas son idénticos.
import { PatternOutputs, type LedColor, type OutputLevels } from './alerts.ts'
import { Application } from './app.ts'
import type { Canvas } from './canvas.ts'
import { SimulatedCentral, type CentralMessage, type CentralNotice, type CentralVoice } from './central.ts'
import type { NoticeCode } from './catalog.ts'
import { EventQueue, type Identity } from './events.ts'
import type { Assessment } from './levels.ts'
import { DEFAULT_LINK_TIMING, LinkSession } from './link.ts'
import { Outbox } from './outbox.ts'
import type { SensorSnapshot } from './readings.ts'
import { createRandom } from './rng.ts'
import { DEFAULT_SETTINGS, type DeviceSettings } from './settings.ts'
import { EnvironmentSensors, SensorHub, type EnvironmentSample } from './sensors.ts'
import type { Action } from './types.ts'
import { SimulatedRecorder, VoiceQueue } from './voice.ts'
import { formatIso, WallClock } from './wallclock.ts'
import { WifiStation, type RadioScan, type WifiStatus, type WifiTiming } from './wifi.ts'

export interface FrameLogEntry {
  readonly seq: number
  readonly atMs: number
  /** tx: manilla → central; rx: central → manilla; event: Wi-Fi y enlace (registro del firmware). */
  readonly direction: 'tx' | 'rx' | 'event'
  readonly kind: string
  readonly text: string
}

export interface VirtualBraceletOptions {
  readonly environment: () => EnvironmentSample
  /** Lo que la central simulada devuelve en el primer ack. */
  readonly identity: Identity
  readonly settings?: DeviceSettings
  readonly seed?: number
  readonly centralOnline?: boolean
  /** Hora de la central simulada al arrancar la manilla (época en ms). */
  readonly startEpochMs?: number
  /** Latencia de la red en un sentido (ms). */
  readonly latencyMs?: number
  /**
   * Puntos de acceso que alcanzan a la manilla en cada instante. Sin esta función la
   * cobertura es total (Wi-Fi siempre asociado y sin pérdidas), como en las pruebas del firmware.
   */
  readonly radio?: RadioScan
  readonly wifiTiming?: WifiTiming
}

export interface CentralView {
  /** La central acepta conexiones (no se cortó el enlace desde el panel). */
  readonly online: boolean
  /** Última trama o subida recibida de la manilla (hora de la central, ms de época). */
  readonly lastSeenAt: number | null
  /** Hora actual de la central (ms de época). */
  readonly serverTime: number
  /** Manilla en línea según la central: última señal dentro de la ventana de presencia. */
  readonly deviceOnline: boolean
  readonly heartbeats: number
  readonly telemetry: number
  readonly rejected: number
  readonly messages: readonly CentralMessage[]
  readonly notices: readonly CentralNotice[]
  readonly voices: readonly CentralVoice[]
}

const STEP_MS = 5
const FRAME_LOG_SIZE = 200
const MAX_RETRY_MS = 20000
const CONNECT_TIMEOUT_MS = 12000
const UPLOAD_IDLE_MS = 30000
const UPLOAD_MAX_BACKOFF_MS = 60000
const PERMANENT_UPLOAD_FAILURES = [400, 413, 415]
/** HTTPClient del firmware: `setTimeout(30000)`. */
const UPLOAD_TIMEOUT_MS = 30000
/** Retransmisión TCP: espera inicial y máxima entre intentos. */
const INITIAL_RTO_MS = 300
const MAX_RTO_MS = 8000
/** Mining:PresenceWindowSeconds de la central (90 s por defecto). */
export const PRESENCE_WINDOW_MS = 90_000
const RADIO_UPDATE_MS = 100

type LinkState = 'idle' | 'connecting' | 'open'

interface Delivery {
  /** Próximo intento de entrega (las retransmisiones TCP lo postergan). */
  at: number
  /** Espera hasta la siguiente retransmisión si este intento se pierde. */
  rto: number
  readonly to: 'central' | 'bracelet'
  readonly text: string
  /** Conexión en la que viajaba la trama; al cerrarse se pierde. */
  readonly connection: number
}

export class VirtualBracelet {
  readonly settings: DeviceSettings
  private now = 0
  private readonly clock = () => this.now
  private readonly events = new EventQueue(48)
  private readonly outputsImpl: PatternOutputs
  private readonly wall: WallClock
  private readonly sensors: EnvironmentSensors
  private readonly hub: SensorHub
  private readonly outbox: Outbox | null
  private readonly voices: VoiceQueue | null
  private readonly recorder: SimulatedRecorder | null
  private readonly app: Application
  private readonly session: LinkSession | null
  private readonly central: SimulatedCentral
  private readonly latencyMs: number
  private centralOnline: boolean
  private nextSample = 0
  private nextTick = 0
  // Tarea del enlace (network.cpp).
  private linkState: LinkState = 'idle'
  private nextAttempt = 0
  private retryMs = 1000
  private connectAt = 0
  private connectRto = INITIAL_RTO_MS
  private connectDeadline = 0
  private connection = 0
  private deliveries: Delivery[] = []
  // Subida de voz.
  private nextUpload = 0
  private uploadBackoff = 2000
  private uploadInFlight: { readonly id: string; readonly startedAt: number; remainingMs: number; lastAt: number } | null = null
  // Radio: estación Wi-Fi y pérdidas (con su propia semilla, para no alterar las lecturas).
  private readonly wifi: WifiStation | null
  private readonly radioRandom: () => number
  private nextRadioUpdate = 0
  // Registro de tramas.
  private readonly log: FrameLogEntry[] = []
  private logSeq = 0

  constructor(options: VirtualBraceletOptions) {
    this.settings = options.settings ?? DEFAULT_SETTINGS
    const seed = options.seed ?? 1
    const ids = createRandom(seed ^ 0x5bd1e995)
    this.latencyMs = options.latencyMs ?? 40
    this.centralOnline = options.centralOnline ?? true
    const radioRandom = createRandom(seed ^ 0x2545f491)
    this.radioRandom = radioRandom.next
    this.wifi = options.radio ? new WifiStation(options.radio, text => this.record('event', 'wifi', text), options.wifiTiming) : null
    this.outputsImpl = new PatternOutputs(this.clock)
    this.wall = new WallClock(1, this.clock)
    this.sensors = new EnvironmentSensors({
      clock: this.clock,
      environment: options.environment,
      warmupSeconds: this.settings.sensors.co.warmupSeconds,
      calibration: this.settings.sensors.co.calibration,
      seed: Math.imul(seed, 2654435761) >>> 0,
    })
    this.hub = new SensorHub(this.sensors, this.settings.alerts, this.settings.sensors.sampleSeconds * 1000, update => this.events.push({ type: 'monitor', update }), this.clock)
    const connection = this.settings.connection
    this.outbox = connection ? new Outbox(ids.uint32) : null
    this.voices = connection && this.settings.voice.enabled ? new VoiceQueue(this.settings.voice.maxPending, ids.uint32) : null
    this.recorder = this.settings.voice.enabled ? new SimulatedRecorder(this.clock, this.wall) : null
    this.central = new SimulatedCentral(options.identity, this.clock, options.startEpochMs ?? Date.UTC(2026, 10, 23, 12))
    this.session = connection && this.outbox
      ? new LinkSession(
        { ...DEFAULT_LINK_TIMING, telemetryMs: connection.telemetrySeconds * 1000, heartbeatMs: connection.heartbeatSeconds * 1000 },
        this.outbox, this.wall, this.events, () => this.hub.telemetry())
      : null
    this.app = new Application({
      settings: this.settings,
      outputs: this.outputsImpl,
      clock: this.wall,
      monotonic: this.clock,
      outbox: this.outbox,
      voices: this.voices,
      recorder: this.recorder,
      wakeUploader: () => { this.nextUpload = Math.min(this.nextUpload, this.now) },
    })
  }

  get nowMs(): number {
    return this.now
  }

  /** Avanza el reloj simulado y ejecuta todo lo que vence en ese intervalo. */
  advance(deltaMs: number): void {
    const target = this.now + Math.max(0, deltaMs)
    this.runDue()
    while (this.now < target) {
      this.now = Math.min(target, this.now + STEP_MS)
      this.runDue()
    }
  }

  press(action: Action): void {
    this.events.push({ type: 'action', action })
    this.processEvents()
  }

  render(canvas: Canvas): void {
    this.app.render(canvas)
  }

  outputs(): OutputLevels {
    return this.outputsImpl.levels(this.now)
  }

  ledColor(): LedColor {
    return this.outputsImpl.ledColor()
  }

  ledBlink(): boolean {
    return this.outputsImpl.ledBlink()
  }

  /** Última muestra de los sensores. */
  snapshot(): SensorSnapshot | null {
    return this.hub.latest()?.snapshot ?? null
  }

  assessment(): Assessment {
    return this.app.menu.assessment
  }

  link(): { configured: boolean; connected: boolean; identity: Identity | null; blocked: string } {
    const link = this.app.menu.link
    return { configured: link.configured, connected: link.connected, identity: link.identity ? { ...link.identity } : null, blocked: link.blocked }
  }

  pending(): { messages: number; voices: number } {
    return { messages: this.outbox?.pendingMessages() ?? 0, voices: this.voices?.pending() ?? 0 }
  }

  frames(): readonly FrameLogEntry[] {
    return this.log
  }

  framesVersion(): number {
    return this.logSeq
  }

  /** Estado de la radio Wi-Fi; null si la manilla tiene cobertura total (sin modelo de radio). */
  wifiStatus(): WifiStatus | null {
    return this.wifi?.status() ?? null
  }

  /** Lo que registró la central simulada (no es la base de datos real). */
  centralView(): CentralView {
    const serverTime = this.central.serverTime()
    const lastSeenAt = this.central.lastSeenAt
    return {
      online: this.centralOnline,
      lastSeenAt,
      serverTime,
      deviceOnline: lastSeenAt !== null && serverTime - lastSeenAt <= PRESENCE_WINDOW_MS,
      heartbeats: this.central.counters.heartbeats,
      telemetry: this.central.counters.telemetry,
      rejected: this.central.counters.rejected,
      messages: this.central.messages,
      notices: this.central.notices,
      voices: this.central.voices,
    }
  }

  /** Estado del menú de la OLED (lectura). */
  menuState(): Readonly<Application['menu']> {
    return this.app.menu
  }

  /** Avisos y errores del registro del firmware (LOG_W/LOG_E). */
  warnings(): readonly string[] {
    return [...(this.session?.warnings ?? []), ...this.app.errors]
  }

  setCentralOnline(online: boolean): void {
    if (online === this.centralOnline) return
    this.centralOnline = online
    if (!online && this.linkState !== 'idle') this.finish('La central cerró el enlace')
  }

  centralIsOnline(): boolean {
    return this.centralOnline
  }

  sendNotice(code: NoticeCode): void {
    const { frame } = this.central.createNotice(code)
    if (frame && this.linkState === 'open') this.schedule('bracelet', frame)
  }

  spikeGas(durationMs = 25000): void {
    this.sensors.spikeGas(durationMs)
  }

  spikeHeat(durationMs = 25000): void {
    this.sensors.spikeHeat(durationMs)
  }

  setCalibrated(calibrated: boolean): void {
    this.sensors.setCalibration(calibrated ? (this.settings.sensors.co.calibration ?? DEFAULT_SETTINGS.sensors.co.calibration) : null)
  }

  isCalibrated(): boolean {
    return this.sensors.hasCalibration()
  }

  // --- ciclo ---

  private runDue(): void {
    if (this.wifi && this.now >= this.nextRadioUpdate) {
      this.wifi.update(this.now)
      this.nextRadioUpdate = this.now + RADIO_UPDATE_MS
    }
    this.deliver()
    if (this.now >= this.nextSample) {
      this.hub.sampleOnce()
      this.nextSample += this.hub.intervalMs
      if (this.nextSample <= this.now) this.nextSample = this.now + this.hub.intervalMs
    }
    this.linkTask()
    this.uploaderTask()
    this.processEvents()
    if (this.now >= this.nextTick) {
      this.app.tick()
      this.nextTick = Math.max(this.nextTick + 1000, this.now)
      this.processEvents()
    }
  }

  private processEvents(): void {
    for (let event = this.events.pop(); event; event = this.events.pop()) this.app.process(event)
  }

  private record(direction: FrameLogEntry['direction'], kind: string, text: string): void {
    this.logSeq += 1
    this.log.push({ seq: this.logSeq, atMs: this.now, direction, kind, text })
    if (this.log.length > FRAME_LOG_SIZE) this.log.splice(0, this.log.length - FRAME_LOG_SIZE)
  }

  private schedule(to: 'central' | 'bracelet', text: string, extraDelay = 0): void {
    this.deliveries.push({ at: this.now + this.latencyMs + extraDelay, rto: INITIAL_RTO_MS, to, text, connection: this.connection })
  }

  /** Probabilidad de que la radio pierda este intento de entrega (0 con cobertura total). */
  private radioLoses(): boolean {
    return this.wifi !== null && this.radioRandom() < this.wifi.loss()
  }

  private deliver(): void {
    if (this.deliveries.length === 0) return
    // TCP entrega en orden: si una trama espera su retransmisión, las siguientes del
    // mismo sentido esperan detrás de ella.
    const blocked = { central: false, bracelet: false }
    const due: Delivery[] = []
    const remaining: Delivery[] = []
    for (const item of this.deliveries) {
      if (blocked[item.to] || item.at > this.now) {
        blocked[item.to] = true
        remaining.push(item)
      } else if (item.connection === this.connection && this.radioLoses()) {
        item.at = this.now + item.rto
        item.rto = Math.min(item.rto * 2, MAX_RTO_MS)
        blocked[item.to] = true
        remaining.push(item)
      } else {
        due.push(item)
      }
    }
    if (due.length === 0) return
    this.deliveries = remaining
    for (const item of due) {
      if (item.connection !== this.connection || this.linkState !== 'open' || !this.session) continue
      if (item.to === 'central') {
        if (!this.centralOnline) continue
        for (const response of this.central.handle(item.text)) this.schedule('bracelet', response)
      } else {
        this.record('rx', frameType(item.text), item.text)
        this.session.received(item.text, this.now)
      }
    }
  }

  // --- tarea del enlace (LinkTask de network.cpp) ---

  private linkTask(): void {
    const session = this.session
    if (!session) return
    switch (this.linkState) {
      case 'idle':
        if (this.now >= this.nextAttempt) {
          if (this.wifi && !this.wifi.connected()) {
            // LinkTask::attempt: el Wi-Fi se reconecta solo; se vuelve a mirar en 1 s.
            this.nextAttempt = this.now + 1000
            break
          }
          this.linkState = 'connecting'
          // Apertura TCP y handshake del WebSocket: dos viajes de ida y vuelta.
          this.connectAt = this.now + 4 * this.latencyMs
          this.connectRto = INITIAL_RTO_MS
          this.connectDeadline = this.now + CONNECT_TIMEOUT_MS
        }
        break
      case 'connecting':
        if (this.now >= this.connectDeadline) {
          this.finish('Tiempo de conexión agotado')
          break
        }
        if (this.now < this.connectAt) break
        if (this.wifi && (!this.wifi.connected() || this.radioLoses())) {
          // SYN o handshake perdido: TCP lo reintenta con espera creciente.
          this.connectAt = this.now + this.connectRto
          this.connectRto = Math.min(this.connectRto * 2, MAX_RTO_MS)
          break
        }
        if (!this.centralOnline) {
          this.finish('La central cerró el enlace')
          break
        }
        this.linkState = 'open'
        this.connection += 1
        this.central.socketOpened()
        if (this.wifi) this.record('event', 'link', 'WebSocket abierto con la central')
        session.opened(this.now, frame => {
          this.record('tx', frameType(frame), frame)
          this.schedule('central', frame)
          return true
        })
        break
      case 'open':
        session.poll(this.now)
        if (session.failed()) this.finish(session.failure())
        break
    }
  }

  private finish(detail: string): void {
    const session = this.session
    if (!session) return
    const wasConnected = session.connected()
    if (this.wifi) this.record('event', 'link', `Enlace cerrado: ${detail}`)
    this.linkState = 'idle'
    this.connection += 1
    this.deliveries = []
    this.central.socketClosed()
    session.closed(detail)
    if (wasConnected) this.retryMs = 1000
    this.nextAttempt = this.now + this.retryMs
    this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS)
  }

  // --- subida de voz (Uploader de network.cpp) ---

  private uploaderTask(): void {
    const voices = this.voices
    if (!voices) return
    const flight = this.uploadInFlight
    if (flight) {
      // La subida avanza solo con Wi-Fi y más despacio cuanto más segmentos se pierden.
      const progress = this.wifi ? (this.wifi.connected() ? 1 - this.wifi.loss() : 0) : 1
      flight.remainingMs -= (this.now - flight.lastAt) * progress
      flight.lastAt = this.now
      if (flight.remainingMs > 0) {
        if (this.now - flight.startedAt >= UPLOAD_TIMEOUT_MS) {
          this.uploadInFlight = null
          this.failUpload('read Timeout')
        }
        return
      }
      this.uploadInFlight = null
      this.completeUpload(flight.id)
      return
    }
    if (this.now < this.nextUpload) return
    // La fecha de la grabación necesita la hora de la central, tomada de los acks.
    if ((this.wifi && !this.wifi.connected()) || !this.wall.synced()) {
      this.nextUpload = this.now + 2000
      return
    }
    const voice = voices.first()
    if (!voice) {
      this.nextUpload = this.now + UPLOAD_IDLE_MS
      return
    }
    const recordedAt = formatIso(this.wall.resolve(voice.stamp) ?? this.wall.now() ?? 0)
    this.record('tx', 'voice', `POST /api/device/voice · X-Client-Message-Id: ${voice.id} · X-Recorded-At: ${recordedAt} · audio/wav ${(voice.durationMs / 1000).toFixed(1)} s (simulado, sin audio)`)
    // Una grabación pesa ~32 kB/s a 16 kHz: la subida tarda más que una trama.
    this.uploadInFlight = { id: voice.id, startedAt: this.now, lastAt: this.now, remainingMs: 2 * this.latencyMs + Math.round(voice.durationMs * 0.02) }
  }

  /** Falla de red durante la subida (status 0 en el firmware): se reintenta con espera creciente. */
  private failUpload(detail: string): void {
    this.record('event', 'voice', `Subida de voz pendiente (0): ${detail}`)
    this.nextUpload = this.now + this.uploadBackoff
    this.uploadBackoff = Math.min(this.uploadBackoff * 2, UPLOAD_MAX_BACKOFF_MS)
  }

  private completeUpload(id: string): void {
    const voices = this.voices
    const voice = voices?.first()
    if (!voices || !voice || voice.id !== id) return
    if (!this.centralOnline) {
      this.nextUpload = this.now + this.uploadBackoff
      this.uploadBackoff = Math.min(this.uploadBackoff * 2, UPLOAD_MAX_BACKOFF_MS)
      return
    }
    const recordedAt = formatIso(this.wall.resolve(voice.stamp) ?? this.wall.now() ?? 0)
    const response = this.central.uploadVoice(voice.id, voice.durationMs, recordedAt)
    this.record('rx', 'voice-response', `${response.status} ${response.body}`)
    if (response.status === 200 || response.status === 201) {
      voices.remove(voice)
      this.events.push({ type: 'voice', event: { uploaded: true, voiceId: voice.id, detail: '' } })
      this.uploadBackoff = 2000
      this.nextUpload = this.now
    } else if (PERMANENT_UPLOAD_FAILURES.includes(response.status)) {
      voices.reject(voice, response.body)
      this.events.push({ type: 'voice', event: { uploaded: false, voiceId: voice.id, detail: response.body } })
      this.uploadBackoff = 2000
      this.nextUpload = this.now
    } else {
      this.nextUpload = this.now + this.uploadBackoff
      this.uploadBackoff = Math.min(this.uploadBackoff * 2, UPLOAD_MAX_BACKOFF_MS)
    }
  }
}

function frameType(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null && typeof (parsed as { type?: unknown }).type === 'string') return (parsed as { type: string }).type
  } catch { /* trama no JSON */ }
  return 'raw'
}
