// Orquestación completa sin hardware (port de esp32-device/test/test_app).
import { describe, expect, it } from 'vitest'
import {
  Application, DEFAULT_SETTINGS, emptySnapshot, MESSAGES_PAGE, Outbox, RecordingCanvas, ThresholdEvaluator, transportEvent, VOICE_PAGE, VoiceQueue, WallClock,
  type Action, type DeviceSettings, type Recorder, type RecordingResult,
} from '../src/index.ts'
import { Counter, FakeClock, RecordingOutputs } from './fakes.ts'

class FakeRecorder implements Recorder {
  private readonly clock: FakeClock
  private startedAt: number | null = null
  startError = ''
  discarded = false

  constructor(clock: FakeClock) {
    this.clock = clock
  }

  recording(): boolean { return this.startedAt !== null }
  elapsedSeconds(): number { return this.startedAt === null ? 0 : (this.clock.now - this.startedAt) / 1000 }
  start(): string {
    if (this.startError) return this.startError
    this.startedAt = this.clock.now
    this.discarded = false
    return ''
  }
  stop(): RecordingResult {
    const durationMs = this.startedAt === null ? 0 : this.clock.now - this.startedAt
    this.startedAt = null
    return { ok: true, durationMs, peak: 1000, stamp: { epochMs: -1, boot: 1, uptimeMs: this.clock.now }, error: '' }
  }
  cancel(): void { this.startedAt = null }
  discard(): void { this.discarded = true }
}

class Harness {
  readonly settings: DeviceSettings
  readonly clock = new FakeClock()
  readonly random = new Counter()
  readonly wall = new WallClock(1, this.clock.fn)
  readonly outbox = new Outbox(this.random.fn)
  readonly voices: VoiceQueue
  readonly outputs = new RecordingOutputs()
  readonly recorder = new FakeRecorder(this.clock)
  readonly evaluator: ThresholdEvaluator
  readonly app: Application
  linkWakes = 0
  uploaderWakes = 0

  constructor(configured = true, voice = true) {
    this.settings = {
      ...DEFAULT_SETTINGS,
      connection: configured ? DEFAULT_SETTINGS.connection : null,
      alerts: { ...DEFAULT_SETTINGS.alerts, confirmSamples: 1 },
      voice: { ...DEFAULT_SETTINGS.voice, enabled: voice, maxPending: 2 },
    }
    this.voices = new VoiceQueue(2, this.random.fn)
    this.evaluator = new ThresholdEvaluator(this.settings.alerts)
    this.app = new Application({
      settings: this.settings,
      outputs: this.outputs,
      clock: this.wall,
      monotonic: this.clock.fn,
      outbox: configured ? this.outbox : null,
      wakeLink: () => { this.linkWakes += 1 },
      voices: configured && voice ? this.voices : null,
      wakeUploader: () => { this.uploaderWakes += 1 },
      recorder: voice ? this.recorder : null,
    })
  }

  press(action: Action, times = 1): void {
    for (let i = 0; i < times; i++) this.app.process({ type: 'action', action })
  }

  reading(ppm: number, simulated = false): void {
    const snapshot = emptySnapshot({ coPpm: ppm, coState: 'ok', simulated })
    this.app.process({ type: 'monitor', update: { snapshot, assessment: this.evaluator.update(snapshot), sampledAt: this.clock.now } })
  }

  codes(): string[] {
    const result: string[] = []
    for (let entry = this.outbox.first(false); entry; entry = this.outbox.first(false)) {
      const frame = JSON.parse(entry.frame) as { code?: string; detail?: string }
      result.push(`${frame.code ?? ''}|${frame.detail ?? ''}`)
      this.outbox.acknowledge(entry.id)
    }
    return result
  }
}

describe('aplicación', () => {
  it('el peligro envía una alarma automática por transición', () => {
    const h = new Harness()
    h.reading(250, true)
    h.reading(260, true)
    expect(h.app.menu.alarmVisible).toBe(true)
    expect(h.outputs.last('led').color).toBe('red')
    expect(h.codes()).toEqual(['CO_ALARM|CO 250 ppm (simulado)'])
    // Volver a normal rearma la alarma.
    h.reading(5)
    h.reading(250)
    expect(h.codes()).toEqual(['CO_ALARM|CO 250 ppm'])
  })

  it('un mensaje del menú queda en cola', () => {
    const h = new Harness()
    h.press('down', MESSAGES_PAGE)
    h.press('enter', 3)
    expect(h.app.menu.deliveryStatus).toBe('Guardado en cola')
    expect(h.app.menu.pendingMessages).toBe(1)
    expect(h.linkWakes).toBeGreaterThan(0)
    // Cada pulsación da una vibración corta.
    expect(h.outputs.count('vibrate')).toBe(MESSAGES_PAGE + 3)
    expect(h.codes()[0]).toBe('HELP|')
  })

  it('el aviso se confirma en la cola durable', () => {
    const h = new Harness()
    h.app.process({ type: 'notice', notice: { noticeId: 31, code: 'SHELTER', text: 'Ir al refugio', severity: 'info' } })
    expect(h.outputs.last('led')).toMatchObject({ color: 'blue', blink: true })
    h.press('enter')
    expect(h.outbox.hasNoticeAck(31, 'read')).toBe(true)
    expect(h.outputs.last('led').blink).toBe(false)
  })

  it('flujo de voz: graba, encola y confirma la subida', () => {
    const h = new Harness()
    h.press('down', VOICE_PAGE)
    h.press('enter', 2)
    expect(h.recorder.recording()).toBe(true)
    h.clock.now += 3500
    h.app.tick()
    expect(h.app.menu.recordingSeconds).toBe(3)
    h.press('enter')
    expect(h.app.menu.voiceMode).toBe('confirm')
    expect(h.app.menu.voiceDurationMs).toBe(3500)
    h.press('enter')
    expect(h.app.menu.voiceStatus).toBe('Guardado en cola')
    expect(h.app.menu.pendingVoices).toBe(1)
    expect(h.uploaderWakes).toBe(1)
    h.app.process({ type: 'voice', event: { uploaded: true, voiceId: h.app.menu.pendingVoiceId, detail: '' } })
    expect(h.app.menu.voiceStatus).toBe('Enviado a central')
  })

  it('la grabación se detiene en el límite y se puede descartar', () => {
    const h = new Harness()
    h.press('down', VOICE_PAGE)
    h.press('enter', 2)
    h.clock.now += h.settings.voice.maxSeconds * 1000
    h.app.tick()
    expect(h.recorder.recording()).toBe(false)
    expect(h.app.menu.voiceMode).toBe('confirm')
    h.press('down')
    h.press('enter')
    expect(h.recorder.discarded).toBe(true)
    expect(h.voices.pending()).toBe(0)
    // Un micrófono que falla se informa en la OLED.
    h.recorder.startError = 'Micro no disponible'
    h.press('enter')
    expect(h.app.menu.voiceMode).toBe('result')
    expect(h.app.menu.voiceStatus).toBe('Micro no disponible')
  })

  it('con la cola de voz llena no se graba', () => {
    const h = new Harness()
    for (let i = 0; i < 2; i++) expect(h.voices.enqueue(1000, 1, { epochMs: -1, boot: 1, uptimeMs: 0 }).status).toBe('ok')
    h.press('down', VOICE_PAGE)
    h.press('enter', 2)
    expect(h.recorder.recording()).toBe(false)
    expect(h.app.menu.voiceStatus).toBe('Cola de voz llena')
  })

  it('una manilla sin configurar nunca afirma la entrega', () => {
    const h = new Harness(false)
    expect(h.outputs.last('led').color).toBe('green')
    h.press('down', MESSAGES_PAGE)
    h.press('enter', 3)
    expect(h.app.menu.deliveryStatus).toBe('Sin configurar')
    h.press('enter')
    h.press('up')
    h.press('enter')
    h.press('down', 1)
    h.press('enter', 2)
    expect(h.app.menu.voiceStatus).toBe('Sin configurar')
    const canvas = new RecordingCanvas()
    h.app.render(canvas)
    expect(canvas.hasText('Central: sin configurar')).toBe(true)
    const mute = new Harness(true, false)
    mute.press('down', VOICE_PAGE)
    mute.press('enter', 2)
    expect(mute.app.menu.voiceStatus).toBe('Voz desactivada')
  })

  it('los eventos del enlace mueven el LED', () => {
    const h = new Harness()
    expect(h.outputs.last('led').color).toBe('blue')
    h.app.process({ type: 'transport', event: transportEvent('connected') })
    expect(h.outputs.last('led').color).toBe('green')
    h.app.process({ type: 'transport', event: transportEvent('disconnected', '', 'timeout') })
    expect(h.outputs.last('led').color).toBe('blue')
  })
})
