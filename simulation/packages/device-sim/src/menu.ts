// Estado de navegación de la OLED; no accede a sensores, red ni salidas (menu.cpp).
//
// `Menu.handle()` devuelve intenciones (enviar, grabar, confirmar un aviso...)
// que ejecuta la aplicación; el resultado vuelve al menú mediante sus métodos.
import { MESSAGES } from './catalog.ts'
import type { Identity, NoticeReceived, TransportEvent } from './events.ts'
import { Assessment } from './levels.ts'
import { emptySnapshot, type SensorSnapshot } from './readings.ts'
import type { Action } from './types.ts'

export const PAGES = ['Estado', 'Gases', 'Temperatura', 'Mensajes', 'Voz', 'Ajustes'] as const
export const PAGE_COUNT = PAGES.length
export const MESSAGES_PAGE = 3
export const VOICE_PAGE = 4
/** Avisos de la central que se conservan en memoria. */
const MAX_NOTICES = 10

export type IntentType = 'send-message' | 'start-recording' | 'stop-recording' | 'send-voice' | 'discard-voice' | 'acknowledge-notice' | 'silence-alarm'

export interface Intent {
  readonly type: IntentType
  readonly code: string
  readonly noticeId: number
}

function intent(type: IntentType, code = '', noticeId = 0): Intent {
  return { type, code, noticeId }
}

export type MessageMode = 'none' | 'choose' | 'confirm' | 'result'
export type VoiceMode = 'idle' | 'recording' | 'confirm' | 'result'

export interface LinkState {
  configured: boolean
  connected: boolean
  identity: Identity | null
  blocked: string
}

export class Menu {
  static readonly VISIBLE_ROWS = 3

  selected = 0
  offset = 0
  page: number | null = null
  // Página de mensajes.
  messageMode: MessageMode = 'none'
  messageSelected = 0
  messageOffset = 0
  confirmSelected = 0
  pendingId = ''
  deliveryStatus = ''
  // Página de voz.
  voiceMode: VoiceMode = 'idle'
  voiceStatus = ''
  voiceConfirmSelected = 0
  voiceDurationMs = 0
  recordingSeconds = 0
  pendingVoiceId = ''
  // Datos en vivo.
  link: LinkState = { configured: false, connected: false, identity: null, blocked: '' }
  snapshot: SensorSnapshot = emptySnapshot()
  assessment: Assessment = new Assessment()
  pendingMessages = 0
  pendingVoices = 0
  // Superposiciones: primero los avisos de la central, después la alarma de peligro.
  notices: NoticeReceived[] = []
  alarmVisible = false

  // --- actualizaciones en vivo ---

  connected(): boolean {
    return this.link.connected
  }

  notice(): NoticeReceived | null {
    return this.notices[0] ?? null
  }

  transport(event: TransportEvent): void {
    switch (event.kind) {
      case 'connected': this.link.connected = true; break
      case 'disconnected': this.link.connected = false; break
      case 'identity':
        this.link.identity = event.identity ? { ...event.identity } : null
        this.link.blocked = ''
        break
      case 'blocked': this.link.blocked = event.detail; break
      case 'delivered':
        this.link.blocked = ''
        if (this.pendingId && event.messageId === this.pendingId) this.deliveryStatus = 'Enviado a central'
        break
      case 'rejected':
        if (this.pendingId && event.messageId === this.pendingId) this.deliveryStatus = 'Rechazado'
        break
    }
  }

  monitor(snapshot: SensorSnapshot, assessment: Assessment): void {
    if (assessment.level === 'danger' && this.assessment.level !== 'danger') this.alarmVisible = true
    else if (assessment.level !== 'danger') this.alarmVisible = false
    this.snapshot = snapshot
    this.assessment = assessment
  }

  /** Encola un aviso para mostrarlo; false si ya se muestra o está en cola. */
  receiveNotice(notice: NoticeReceived): boolean {
    if (this.notices.some(current => current.noticeId === notice.noticeId)) return false
    if (this.notices.length >= MAX_NOTICES) return false
    this.notices.push(notice)
    return true
  }

  // --- resultados de las intenciones ---

  messageQueued(messageId: string): void {
    this.pendingId = messageId
    this.deliveryStatus = 'Guardado en cola'
  }

  messageFailed(status: string): void {
    this.pendingId = ''
    this.deliveryStatus = status
  }

  recordingStarted(): void {
    this.voiceMode = 'recording'
    this.recordingSeconds = 0
  }

  recordingProgress(seconds: number): void {
    this.recordingSeconds = seconds
  }

  recordingFinished(durationMs: number): void {
    this.voiceMode = 'confirm'
    this.voiceDurationMs = durationMs
    this.voiceConfirmSelected = 0
  }

  recordingFailed(status: string): void {
    this.voiceMode = 'result'
    this.voiceStatus = status
    this.voiceConfirmSelected = 0
  }

  voiceResult(status: string, voiceId = ''): void {
    this.voiceMode = 'result'
    this.voiceStatus = status
    this.pendingVoiceId = voiceId
  }

  voiceUploaded(voiceId: string): void {
    if (this.pendingVoiceId && voiceId === this.pendingVoiceId) this.voiceStatus = 'Enviado a central'
  }

  voiceRejected(voiceId: string): void {
    if (this.pendingVoiceId && voiceId === this.pendingVoiceId) this.voiceStatus = 'Rechazado'
  }

  // --- navegación ---

  handle(action: Action): Intent[] {
    if (this.notices.length > 0) {
      if (action !== 'enter') return []
      const first = this.notices.shift() as NoticeReceived
      return [intent('acknowledge-notice', '', first.noticeId)]
    }
    if (this.alarmVisible) {
      if (action !== 'enter') return []
      this.alarmVisible = false
      return [intent('silence-alarm')]
    }
    if (this.page === MESSAGES_PAGE) return this.messages(action)
    if (this.page === VOICE_PAGE) return this.voice(action)
    if (this.page !== null) {
      if (action === 'enter') this.page = null
      return []
    }
    if (action === 'enter') {
      this.page = this.selected
      if (this.page === MESSAGES_PAGE) {
        this.messageMode = 'choose'
      } else if (this.page === VOICE_PAGE) {
        this.voiceMode = 'idle'
        this.voiceConfirmSelected = 0
      }
      return []
    }
    const scrolled = scroll(this.selected, this.offset, PAGE_COUNT, action, Menu.VISIBLE_ROWS)
    this.selected = scrolled.selected
    this.offset = scrolled.offset
    return []
  }

  private messages(action: Action): Intent[] {
    if (this.messageMode === 'result') {
      if (action === 'enter') this.messageMode = 'choose'
      return []
    }
    if (this.messageMode === 'confirm') {
      if (action !== 'enter') {
        this.confirmSelected = 1 - this.confirmSelected
        return []
      }
      if (this.confirmSelected === 1) {
        this.messageMode = 'choose'
        return []
      }
      this.messageMode = 'result'
      return [intent('send-message', MESSAGES[this.messageSelected].code)]
    }
    if (action === 'enter') {
      if (this.messageSelected === MESSAGES.length) {
        this.page = null
        this.messageMode = 'none'
      } else {
        this.confirmSelected = 0
        this.messageMode = 'confirm'
      }
      return []
    }
    const scrolled = scroll(this.messageSelected, this.messageOffset, MESSAGES.length + 1, action, Menu.VISIBLE_ROWS)
    this.messageSelected = scrolled.selected
    this.messageOffset = scrolled.offset
    return []
  }

  private voice(action: Action): Intent[] {
    switch (this.voiceMode) {
      case 'recording':
        return action === 'enter' ? [intent('stop-recording')] : []
      case 'confirm':
        if (action !== 'enter') {
          this.voiceConfirmSelected = 1 - this.voiceConfirmSelected
          return []
        }
        if (this.voiceConfirmSelected === 1) {
          this.voiceMode = 'idle'
          this.voiceConfirmSelected = 0
          return [intent('discard-voice')]
        }
        return [intent('send-voice')]
      case 'result':
        if (action === 'enter') {
          this.voiceMode = 'idle'
          this.voiceConfirmSelected = 0
        }
        return []
      case 'idle':
        break
    }
    // En reposo hay dos opciones: Grabar y Volver.
    if (action !== 'enter') {
      this.voiceConfirmSelected = 1 - this.voiceConfirmSelected
      return []
    }
    if (this.voiceConfirmSelected === 1) {
      this.page = null
      this.voiceConfirmSelected = 0
      return []
    }
    return [intent('start-recording')]
  }
}

/** Mueve la selección con vuelta al inicio y la mantiene dentro de la ventana visible. */
export function scroll(selected: number, offset: number, count: number, action: Action, rows: number): { selected: number; offset: number } {
  const next = (((selected + (action === 'up' ? -1 : 1)) % count) + count) % count
  let window = offset
  if (next < window) window = next
  else if (next >= window + rows) window = next - rows + 1
  return { selected: next, offset: window }
}
