// Eventos que llegan a la tarea principal desde botones, red, sensores y audio (events.h).
//
// Todos los cambios de estado ocurren al procesar esta cola; los demás módulos
// (sensores, enlace, subida de voz, botones) solo publican eventos.
import type { Assessment } from './levels.ts'
import type { SensorSnapshot } from './readings.ts'
import type { Action } from './types.ts'

export interface MonitorUpdate {
  readonly snapshot: SensorSnapshot
  readonly assessment: Assessment
  readonly sampledAt: number
}

/** Identidad que la central devuelve en el primer ack. */
export interface Identity {
  name: string
  minerName: string | null
  zone: string
}

export type TransportKind = 'connected' | 'disconnected' | 'identity' | 'delivered' | 'rejected' | 'blocked'

export interface TransportEvent {
  readonly kind: TransportKind
  readonly messageId: string
  readonly detail: string
  readonly identity: Identity | null
}

export interface NoticeReceived {
  readonly noticeId: number
  readonly code: string
  readonly text: string
  readonly severity: string
}

export interface VoiceEvent {
  readonly uploaded: boolean
  readonly voiceId: string
  readonly detail: string
}

export type Event =
  | { readonly type: 'action'; readonly action: Action }
  | { readonly type: 'monitor'; readonly update: MonitorUpdate }
  | { readonly type: 'transport'; readonly event: TransportEvent }
  | { readonly type: 'notice'; readonly notice: NoticeReceived }
  | { readonly type: 'voice'; readonly event: VoiceEvent }

export function transportEvent(kind: TransportKind, messageId = '', detail = '', identity: Identity | null = null): TransportEvent {
  return { kind, messageId, detail, identity }
}

/**
 * Cola acotada entre tareas. Si se llena descarta el evento más antiguo: las
 * lecturas siguientes lo reemplazan.
 */
export class EventQueue {
  private readonly capacity: number
  private readonly events: Event[] = []

  constructor(capacity = 48) {
    this.capacity = capacity
  }

  push(event: Event): void {
    if (this.events.length >= this.capacity) this.events.shift()
    this.events.push(event)
  }

  pop(): Event | undefined {
    return this.events.shift()
  }

  size(): number {
    return this.events.length
  }
}
