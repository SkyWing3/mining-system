// Orquestación de la manilla: sensores, alertas, red, voz y OLED (app.cpp).
//
// Todos los cambios de estado ocurren al procesar la cola de eventos. Los demás
// módulos solo publican eventos.
import { AlertController, type AlertOutputs } from './alerts.ts'
import type { Canvas } from './canvas.ts'
import { CO_ALARM, HEAT_ALARM } from './catalog.ts'
import type { Event } from './events.ts'
import type { AlarmGroup, Assessment } from './levels.ts'
import { Menu, type Intent } from './menu.ts'
import type { Outbox } from './outbox.ts'
import { Renderer } from './renderer.ts'
import { MAX_DETAIL, type DeviceSettings } from './settings.ts'
import { utf8Prefix } from './text.ts'
import type { MonotonicClock } from './types.ts'
import type { Recorder, RecordingResult, VoiceQueue } from './voice.ts'
import type { WallClock } from './wallclock.ts'

export interface AppContext {
  readonly settings: DeviceSettings
  readonly outputs: AlertOutputs
  readonly clock: WallClock
  readonly monotonic: MonotonicClock
  /** Solo con el enlace a la central configurado. */
  readonly outbox: Outbox | null
  readonly wakeLink?: () => void
  /** Enlace configurado y voz habilitada. */
  readonly voices: VoiceQueue | null
  readonly wakeUploader?: () => void
  /** Voz habilitada. */
  readonly recorder: Recorder | null
}

const ALARM_GROUPS: readonly { readonly group: AlarmGroup; readonly code: string }[] = [
  { group: 'co', code: CO_ALARM },
  { group: 'heat', code: HEAT_ALARM },
]

export class Application {
  readonly menu = new Menu()
  readonly alerts: AlertController
  /** Registro de errores (LOG_E del firmware). */
  readonly errors: string[] = []
  private readonly ctx: AppContext
  private readonly renderer = new Renderer()
  private recording: RecordingResult | null = null
  // Una alarma automática por transición a peligro; se rearma cuando el grupo vuelve a normal.
  private readonly alarmArmed = [true, true]

  constructor(context: AppContext) {
    this.ctx = context
    const linkConfigured = context.settings.connection !== null
    this.alerts = new AlertController(context.outputs, context.settings.alerts.silenceSeconds, context.settings.alerts.buttonFeedback, linkConfigured, context.monotonic)
    this.menu.link.configured = linkConfigured
    this.refreshPending()
  }

  close(): void {
    if (this.ctx.recorder?.recording()) this.ctx.recorder.cancel()
    this.alerts.close()
  }

  render(canvas: Canvas): void {
    this.renderer.render(this.menu, canvas)
  }

  // --- eventos ---

  process(event: Event): void {
    switch (event.type) {
      case 'action':
        this.alerts.onButton()
        for (const intent of this.menu.handle(event.action)) this.execute(intent)
        break
      case 'monitor':
        this.menu.monitor(event.update.snapshot, event.update.assessment)
        this.alerts.onLevel(event.update.assessment.level)
        this.sendAlarms(event.update.assessment, event.update.snapshot.simulated)
        break
      case 'transport':
        this.menu.transport(event.event)
        if (event.event.kind === 'connected' || event.event.kind === 'disconnected') this.alerts.onConnection(event.event.kind === 'connected')
        this.refreshPending()
        break
      case 'notice':
        if (this.menu.receiveNotice(event.notice)) this.alerts.onNotice(event.notice.severity)
        break
      case 'voice':
        if (event.event.uploaded) this.menu.voiceUploaded(event.event.voiceId)
        else this.menu.voiceRejected(event.event.voiceId)
        this.refreshPending()
        break
    }
  }

  /** Una vez por segundo. */
  tick(): void {
    this.alerts.tick()
    const recorder = this.ctx.recorder
    if (recorder?.recording()) {
      const elapsed = recorder.elapsedSeconds()
      this.menu.recordingProgress(Math.trunc(elapsed))
      if (elapsed >= this.ctx.settings.voice.maxSeconds) this.finishRecording()
    }
    this.refreshPending()
  }

  // --- intenciones ---

  private execute(intent: Intent): void {
    switch (intent.type) {
      case 'send-message': this.sendMessage(intent.code); break
      case 'acknowledge-notice': this.acknowledge(intent.noticeId); break
      case 'silence-alarm': this.alerts.silence(); break
      case 'start-recording': this.startRecording(); break
      case 'stop-recording': this.finishRecording(); break
      case 'send-voice': this.sendVoice(); break
      case 'discard-voice': this.discardVoice(); break
    }
  }

  private sendMessage(code: string): void {
    const outbox = this.ctx.outbox
    if (!outbox) {
      this.menu.messageFailed('Sin configurar')
      return
    }
    const result = outbox.enqueueMessage(code, null, this.ctx.clock.stamp())
    if ('id' in result) {
      this.menu.messageQueued(result.id)
      this.ctx.wakeLink?.()
    } else {
      this.errors.push(`No se pudo guardar el mensaje: ${result.error}`)
      this.menu.messageFailed(result.error)
    }
    this.refreshPending()
  }

  private acknowledge(noticeId: number): void {
    const outbox = this.ctx.outbox
    if (outbox) {
      const error = outbox.enqueueNoticeAck(noticeId, 'read')
      if (error) this.errors.push(`No se pudo guardar la confirmación del aviso: ${error}`)
      else this.ctx.wakeLink?.()
    }
    if (this.menu.notice() === null) this.alerts.onNoticeCleared()
  }

  private startRecording(): void {
    const { recorder, voices } = this.ctx
    if (!recorder) this.menu.recordingFailed('Voz desactivada')
    else if (!voices) this.menu.recordingFailed('Sin configurar')
    else if (voices.pending() >= voices.maxPending) this.menu.recordingFailed('Cola de voz llena')
    else {
      if (this.recording) this.discardVoice()
      const error = recorder.start()
      if (!error) this.menu.recordingStarted()
      else {
        this.errors.push(`No se pudo grabar: ${error}`)
        this.menu.recordingFailed(error)
      }
    }
  }

  private finishRecording(): void {
    const recorder = this.ctx.recorder
    if (!recorder?.recording()) return
    const result = recorder.stop()
    if (result.ok) {
      this.recording = result
      this.menu.recordingFinished(result.durationMs)
    } else {
      this.errors.push(`Grabación inválida: ${result.error}`)
      this.recording = null
      this.menu.recordingFailed(result.error)
    }
  }

  private sendVoice(): void {
    const { voices, recorder } = this.ctx
    const recording = this.recording
    if (!recording || !voices) {
      this.menu.voiceResult('Sin grabación')
      return
    }
    this.recording = null
    const result = voices.enqueue(recording.durationMs, recording.peak, recording.stamp)
    if (result.status === 'ok') {
      this.menu.voiceResult('Guardado en cola', result.id)
      this.ctx.wakeUploader?.()
    } else {
      recorder?.discard()
      this.menu.voiceResult('Cola de voz llena')
    }
    this.refreshPending()
  }

  private discardVoice(): void {
    this.recording = null
    this.ctx.recorder?.discard()
  }

  private sendAlarms(assessment: Assessment, simulated: boolean): void {
    ALARM_GROUPS.forEach(({ group, code }, index) => {
      const level = assessment.groupLevel(group)
      if (level === 'danger' && this.alarmArmed[index]) {
        this.alarmArmed[index] = false
        const detail = utf8Prefix(assessment.detail(group) + (simulated ? ' (simulado)' : ''), MAX_DETAIL)
        const outbox = this.ctx.outbox
        if (outbox) {
          const result = outbox.enqueueMessage(code, detail, this.ctx.clock.stamp())
          if ('id' in result) this.ctx.wakeLink?.()
          else this.errors.push(`No se pudo guardar la alarma: ${result.error}`)
        }
      } else if (level === 'normal') {
        this.alarmArmed[index] = true
      }
    })
  }

  private refreshPending(): void {
    this.menu.pendingMessages = this.ctx.outbox ? this.ctx.outbox.pendingMessages() : 0
    this.menu.pendingVoices = this.ctx.voices ? this.ctx.voices.pending() : 0
  }
}
