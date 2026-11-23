// Grabación y cola de voz (recorder.h y voice_queue.cpp).
//
// La manilla real graba con el INMP441 por I2S. El gemelo NO captura audio:
// `SimulatedRecorder` solo mide la duración para reproducir el flujo del menú
// (Grabando, Duración, Enviar/Descartar) y la subida queda marcada como simulada.
import { randomHexId } from './text.ts'
import type { MonotonicClock } from './types.ts'
import type { Stamp, WallClock } from './wallclock.ts'

export const MIN_RECORDING_SECONDS = 0.5

export interface RecordingResult {
  readonly ok: boolean
  readonly durationMs: number
  readonly peak: number
  readonly stamp: Stamp
  readonly error: string
}

export interface Recorder {
  recording(): boolean
  elapsedSeconds(): number
  /** Vacío si comenzó; si no, el motivo para la OLED. */
  start(): string
  stop(): RecordingResult
  /** Detiene una grabación en curso y la borra. */
  cancel(): void
  /** Borra la grabación terminada que no se encoló. */
  discard(): void
}

export class SimulatedRecorder implements Recorder {
  private readonly clock: MonotonicClock
  private readonly wall: WallClock
  private startedAt: number | null = null
  private stamp: Stamp | null = null
  /** Grabación terminada que todavía no se encoló ni descartó. */
  hasRecording = false

  constructor(clock: MonotonicClock, wall: WallClock) {
    this.clock = clock
    this.wall = wall
  }

  recording(): boolean {
    return this.startedAt !== null
  }

  elapsedSeconds(): number {
    return this.startedAt === null ? 0 : (this.clock() - this.startedAt) / 1000
  }

  start(): string {
    this.startedAt = this.clock()
    this.stamp = this.wall.stamp()
    this.hasRecording = false
    return ''
  }

  stop(): RecordingResult {
    const stamp = this.stamp ?? this.wall.stamp()
    if (this.startedAt === null) return { ok: false, durationMs: 0, peak: 0, stamp, error: 'Sin grabación' }
    const durationMs = Math.round(this.clock() - this.startedAt)
    this.startedAt = null
    if (durationMs < MIN_RECORDING_SECONDS * 1000) return { ok: false, durationMs, peak: 0, stamp, error: 'Grabación muy corta' }
    this.hasRecording = true
    return { ok: true, durationMs, peak: 0, stamp, error: '' }
  }

  cancel(): void {
    this.startedAt = null
    this.hasRecording = false
  }

  discard(): void {
    this.hasRecording = false
  }
}

export interface QueuedVoice {
  readonly id: string
  readonly stamp: Stamp
  readonly durationMs: number
  readonly peak: number
}

export type VoiceEnqueueResult = { readonly status: 'ok'; readonly id: string } | { readonly status: 'full' }

export class VoiceQueue {
  readonly maxPending: number
  private readonly random: () => number
  private readonly items: QueuedVoice[] = []
  readonly rejected: string[] = []

  constructor(maxPending: number, random: () => number) {
    this.maxPending = maxPending
    this.random = random
  }

  enqueue(durationMs: number, peak: number, stamp: Stamp): VoiceEnqueueResult {
    if (this.items.length >= this.maxPending) return { status: 'full' }
    const id = randomHexId(this.random)
    this.items.push({ id, stamp, durationMs, peak })
    return { status: 'ok', id }
  }

  first(): QueuedVoice | null {
    return this.items[0] ?? null
  }

  remove(voice: QueuedVoice): void {
    const index = this.items.findIndex(item => item.id === voice.id)
    if (index >= 0) this.items.splice(index, 1)
  }

  reject(voice: QueuedVoice, reason: string): void {
    this.rejected.push(`voice ${voice.id}: ${reason}`)
    this.remove(voice)
  }

  pending(): number {
    return this.items.length
  }
}
