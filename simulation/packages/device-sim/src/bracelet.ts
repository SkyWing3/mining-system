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

export interface FrameLogEntry {
  readonly seq: number
  readonly atMs: number
  /** tx: manilla → central; rx: central → manilla. */
  readonly direction: 'tx' | 'rx'
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
}

export interface CentralView {
  readonly online: boolean
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

type LinkState = 'idle' | 'connecting' | 'open'

interface Delivery {
  readonly at: number
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
  private connectDeadline = 0
  private connection = 0
  private deliveries: Delivery[] = []
  // Subida de voz.
  private nextUpload = 0
  private uploadBackoff = 2000
  private uploadInFlight: { readonly id: string; readonly at: number } | null = null
  // Registro de tramas.
  private readonly log: FrameLogEntry[] = []
  private logSeq = 0

  constructor(options: VirtualBraceletOptions) {
    this.settings = options.settings ?? DEFAULT_SETTINGS
    const seed = options.seed ?? 1
    const ids = createRandom(seed ^ 0x5bd1e995)
    this.latencyMs = options.latencyMs ?? 40
    this.centralOnline = options.centralOnline ?? true
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

  /** Lo que registró la central simulada (no es la base de datos real). */
  centralView(): CentralView {
    return {
      online: this.centralOnline,
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

  private record(direction: 'tx' | 'rx', kind: string, text: string): void {
    this.logSeq += 1
    this.log.push({ seq: this.logSeq, atMs: this.now, direction, kind, text })
    if (this.log.length > FRAME_LOG_SIZE) this.log.splice(0, this.log.length - FRAME_LOG_SIZE)
  }

  private schedule(to: 'central' | 'bracelet', text: string, extraDelay = 0): void {
    this.deliveries.push({ at: this.now + this.latencyMs + extraDelay, to, text, connection: this.connection })
  }

  private deliver(): void {
    if (this.deliveries.length === 0) return
    const due = this.deliveries.filter(item => item.at <= this.now)
    if (due.length === 0) return
    this.deliveries = this.deliveries.filter(item => item.at > this.now)
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
          this.linkState = 'connecting'
          // Apertura TCP y handshake del WebSocket: dos viajes de ida y vuelta.
          this.connectAt = this.now + 4 * this.latencyMs
          this.connectDeadline = this.now + CONNECT_TIMEOUT_MS
        }
        break
      case 'connecting':
        if (this.now >= this.connectAt) {
          if (!this.centralOnline) {
            this.finish('La central cerró el enlace')
            break
          }
          this.linkState = 'open'
          this.connection += 1
          this.central.socketOpened()
          session.opened(this.now, frame => {
            this.record('tx', frameType(frame), frame)
            this.schedule('central', frame)
            return true
          })
        } else if (this.now >= this.connectDeadline) {
          this.finish('Tiempo de conexión agotado')
        }
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
      if (this.now < flight.at) return
      this.uploadInFlight = null
      this.completeUpload(flight.id)
      return
    }
    if (this.now < this.nextUpload) return
    // La fecha de la grabación necesita la hora de la central, tomada de los acks.
    if (!this.wall.synced()) {
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
    this.uploadInFlight = { id: voice.id, at: this.now + 2 * this.latencyMs + Math.round(voice.durationMs * 0.02) }
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
