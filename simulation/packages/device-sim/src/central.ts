// Central simulada: responde al protocolo de dispositivo de docs/api.md.
//
// No es la central real (ASP.NET + MySQL): reproduce sus respuestas para que la
// manilla virtual recorra los mismos caminos que con la central (handshake con
// identidad, ack de telemetría, ack de mensajes con identificador, avisos y sus
// confirmaciones, subida de voz). Nada de esto llega a la base de datos real.
import { isAutomaticMessage, isMessageCode, NOTICES, type NoticeCode, type NoticeKind } from './catalog.ts'
import type { Identity } from './events.ts'
import { MAX_DETAIL } from './settings.ts'
import { utf8Length } from './text.ts'
import { LEVEL_ORDER, type MonotonicClock } from './types.ts'
import { formatIso, parseIso } from './wallclock.ts'

export type NoticeStatus = 'pending' | 'delivered' | 'read' | 'expired'

export interface CentralNotice extends NoticeKind {
  readonly noticeId: number
  readonly createdAt: number
  readonly expiresAt: number
  status: NoticeStatus
}

export interface CentralMessage {
  readonly messageId: number
  readonly clientMessageId: string
  readonly code: string
  readonly detail: string | null
  readonly sentAt: string
  readonly receivedAt: number
}

export interface CentralVoice {
  readonly voiceId: number
  readonly clientMessageId: string
  readonly durationMs: number
  readonly recordedAt: string
  readonly receivedAt: number
}

type Json = Record<string, unknown>

/** Avisos sin entregar caducan a los 30 minutos (Mining:Notices:ExpirationMinutes). */
const NOTICE_EXPIRATION_MS = 30 * 60_000
const MAX_FUTURE_MS = 5 * 60_000
const VOICE_MIN_MS = 300
const VOICE_MAX_MS = 60_000

export class SimulatedCentral {
  readonly identity: Identity
  readonly messages: CentralMessage[] = []
  readonly notices: CentralNotice[] = []
  readonly voices: CentralVoice[] = []
  readonly counters = { heartbeats: 0, telemetry: 0, rejected: 0 }
  lastTelemetry: Json | null = null
  private readonly clock: MonotonicClock
  private readonly startEpochMs: number
  private nextMessageId = 1
  private nextNoticeId = 1
  private nextVoiceId = 1
  private sessionOpen = false
  private sessionAcked = false

  constructor(identity: Identity, clock: MonotonicClock, startEpochMs: number) {
    this.identity = identity
    this.clock = clock
    this.startEpochMs = startEpochMs
  }

  /** Hora de la central en milisegundos de época. */
  serverTime(): number {
    return this.startEpochMs + this.clock()
  }

  socketOpened(): void {
    this.sessionOpen = true
    this.sessionAcked = false
  }

  socketClosed(): void {
    this.sessionOpen = false
    this.sessionAcked = false
  }

  /** Lista para empujar avisos: socket abierto y primer ack enviado. */
  canPush(): boolean {
    return this.sessionOpen && this.sessionAcked
  }

  /**
   * Procesa una trama de la manilla y devuelve las tramas de respuesta en orden:
   * el ack o error y, tras el primer ack de la conexión, los avisos pendientes.
   */
  handle(raw: string): string[] {
    let frame: Json
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [this.error('invalid', 'Trama inválida.')]
      frame = parsed as Json
    } catch {
      return [this.error('invalid', 'Trama inválida.')]
    }
    const now = this.serverTime()
    switch (frame.type) {
      case 'heartbeat': {
        this.counters.heartbeats += 1
        const responses = [this.ack({ device: { name: this.identity.name, minerName: this.identity.minerName, zone: this.identity.zone } })]
        if (!this.sessionAcked) {
          this.sessionAcked = true
          responses.push(...this.deliverable(now).map(notice => this.noticeFrame(notice)))
        }
        return responses
      }
      case 'telemetry':
        return [this.telemetry(frame)]
      case 'message':
        return [this.message(frame, now)]
      case 'notice-ack':
        return [this.noticeAck(frame)]
      default:
        return [this.error('invalid', 'Tipo de trama desconocido.')]
    }
  }

  /** Crea un aviso como lo hace la web (POST /api/notices) y devuelve la trama si se puede entregar ya. */
  createNotice(code: NoticeCode): { notice: CentralNotice; frame: string | null } {
    const kind = NOTICES.find(item => item.code === code) as NoticeKind
    const createdAt = this.serverTime()
    const notice: CentralNotice = { ...kind, noticeId: this.nextNoticeId++, createdAt, expiresAt: createdAt + NOTICE_EXPIRATION_MS, status: 'pending' }
    this.notices.push(notice)
    return { notice, frame: this.canPush() ? this.noticeFrame(notice) : null }
  }

  /** POST /api/device/voice. El gemelo no envía audio: se valida la duración declarada. */
  uploadVoice(clientMessageId: string, durationMs: number, recordedAt: string): { status: number; body: string } {
    const duplicate = this.voices.find(voice => voice.clientMessageId === clientMessageId)
    if (duplicate) return { status: 200, body: JSON.stringify({ voice: { id: duplicate.voiceId }, duplicate: true }) }
    if (durationMs < VOICE_MIN_MS || durationMs > VOICE_MAX_MS) return { status: 400, body: JSON.stringify({ message: 'Duración fuera de rango.' }) }
    const voice: CentralVoice = { voiceId: this.nextVoiceId++, clientMessageId, durationMs, recordedAt, receivedAt: this.serverTime() }
    this.voices.push(voice)
    return { status: 201, body: JSON.stringify({ voice: { id: voice.voiceId }, duplicate: false }) }
  }

  private deliverable(now: number): CentralNotice[] {
    for (const notice of this.notices) {
      if (notice.status === 'pending' && now > notice.expiresAt) notice.status = 'expired'
    }
    // Pendientes y entregados sin leer se reenvían en cada reconexión.
    return this.notices.filter(notice => notice.status === 'pending' || notice.status === 'delivered')
  }

  private noticeFrame(notice: CentralNotice): string {
    return JSON.stringify({
      type: 'notice',
      noticeId: notice.noticeId,
      code: notice.code,
      text: notice.text,
      severity: notice.severity,
      createdAt: formatIso(notice.createdAt),
      expiresAt: formatIso(notice.expiresAt),
    })
  }

  private telemetry(frame: Json): string {
    const fields = ['temperatureC', 'objectTemperatureC', 'gasPpm', 'gasVoltage', 'batteryPercent']
    if (!fields.some(field => typeof frame[field] === 'number')) return this.reject('La lectura no tiene valores.')
    if (typeof frame.level !== 'string' || !LEVEL_ORDER.includes(frame.level as never)) return this.reject('Nivel inválido.')
    this.counters.telemetry += 1
    this.lastTelemetry = frame
    return this.ack()
  }

  private message(frame: Json, now: number): string {
    const code = typeof frame.code === 'string' ? frame.code : ''
    const clientMessageId = typeof frame.clientMessageId === 'string' ? frame.clientMessageId : ''
    if (!clientMessageId) return this.reject('Falta clientMessageId.')
    if (!isMessageCode(code)) return this.reject('Mensaje fuera del catálogo.')
    const detail = typeof frame.detail === 'string' ? frame.detail : null
    if (detail !== null && (!isAutomaticMessage(code) || utf8Length(detail) > MAX_DETAIL)) return this.reject('Detalle inválido.')
    const sentAt = typeof frame.sentAt === 'string' ? parseIso(frame.sentAt) : null
    if (sentAt === null) return this.reject('Fecha obligatoria.')
    if (sentAt > now + MAX_FUTURE_MS) return this.reject('Fecha en el futuro.')
    const existing = this.messages.find(message => message.clientMessageId === clientMessageId)
    if (existing) {
      if (existing.code !== code) return this.reject('El identificador ya se usó con otro código.')
      return this.ack({ clientMessageId, messageId: existing.messageId, duplicate: true })
    }
    const message: CentralMessage = { messageId: this.nextMessageId++, clientMessageId, code, detail, sentAt: frame.sentAt as string, receivedAt: now }
    this.messages.push(message)
    return this.ack({ clientMessageId, messageId: message.messageId })
  }

  private noticeAck(frame: Json): string {
    const notice = this.notices.find(item => item.noticeId === frame.noticeId)
    if (!notice || (frame.stage !== 'delivered' && frame.stage !== 'read')) return this.reject('Aviso desconocido.')
    if (frame.stage === 'read') notice.status = 'read'
    else if (notice.status === 'pending') notice.status = 'delivered'
    return this.ack({ noticeId: notice.noticeId })
  }

  private ack(extra: Json = {}): string {
    const frame: Json = { type: 'ack' }
    if ('clientMessageId' in extra) frame.clientMessageId = extra.clientMessageId
    if ('messageId' in extra) frame.messageId = extra.messageId
    frame.duplicate = extra.duplicate === true
    frame.serverTime = formatIso(this.serverTime())
    if ('device' in extra) frame.device = extra.device
    if ('noticeId' in extra) frame.noticeId = extra.noticeId
    return JSON.stringify(frame)
  }

  private reject(message: string): string {
    this.counters.rejected += 1
    return this.error('invalid', message)
  }

  private error(code: string, message: string): string {
    return JSON.stringify({ type: 'error', code, message })
  }
}
