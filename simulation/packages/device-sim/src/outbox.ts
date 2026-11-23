// Cola de tramas para la central (outbox.cpp).
//
// En la placa cada entrada es un archivo en la flash y sobrevive a un reinicio; en
// el gemelo vive en memoria. Igual que en el firmware, una entrada solo se borra
// al recibir su `ack` y un reintento conserva el mismo identificador, así la
// central no duplica registros.
import { isAutomaticMessage, isMessageCode } from './catalog.ts'
import { MAX_DETAIL } from './settings.ts'
import { randomHexId, utf8Length } from './text.ts'
import { formatIso, isAbsolute, type Stamp, type WallClock } from './wallclock.ts'

export interface OutboxEntry {
  readonly id: string
  readonly type: 'message' | 'notice-ack'
  /** Trama guardada; puede llevar `_boot`/`_uptimeMs` en lugar de `sentAt`. */
  readonly frame: string
}

interface Item extends OutboxEntry {
  readonly seq: number
  readonly noticeId: number
  readonly stage: string
}

export type EnqueueResult = { readonly id: string } | { readonly error: string }

export class Outbox {
  readonly capacity: number
  private readonly random: () => number
  private readonly items: Item[] = []
  private nextSeq = 1
  /** Entradas que la central rechazó (equivale a /rejected.log). */
  readonly rejected: string[] = []

  constructor(random: () => number, capacity = 256) {
    this.random = random
    this.capacity = capacity
  }

  enqueueMessage(code: string, detail: string | null, stamp: Stamp): EnqueueResult {
    if (!isMessageCode(code)) return { error: 'Mensaje fuera del catálogo' }
    if (detail !== null && (!isAutomaticMessage(code) || detail.length === 0 || utf8Length(detail) > MAX_DETAIL)) return { error: 'Detalle inválido' }
    const id = randomHexId(this.random)
    const frame: Record<string, unknown> = { type: 'message', clientMessageId: id, code }
    if (isAbsolute(stamp)) frame.sentAt = formatIso(stamp.epochMs)
    else {
      frame._boot = stamp.boot
      frame._uptimeMs = stamp.uptimeMs
    }
    if (detail !== null) frame.detail = detail
    const error = this.write({ id, type: 'message', frame: JSON.stringify(frame), noticeId: 0, stage: '' })
    return error ? { error } : { id }
  }

  enqueueNoticeAck(noticeId: number, stage: 'delivered' | 'read'): string | null {
    const frame = JSON.stringify({ type: 'notice-ack', noticeId, stage })
    return this.write({ id: randomHexId(this.random), type: 'notice-ack', frame, noticeId, stage })
  }

  /** Entrada más antigua; las confirmaciones de avisos pueden adelantarse mientras los mensajes esperan una asignación. */
  first(skipMessages: boolean): OutboxEntry | null {
    const item = this.items.find(candidate => !(skipMessages && candidate.type === 'message'))
    return item ? { id: item.id, type: item.type, frame: item.frame } : null
  }

  acknowledge(id: string): void {
    const index = this.items.findIndex(item => item.id === id)
    if (index >= 0) this.items.splice(index, 1)
  }

  /** Entradas rechazadas de forma permanente: se anota el motivo y se quitan. */
  reject(id: string, reason: string): void {
    const index = this.items.findIndex(item => item.id === id)
    if (index < 0) return
    this.rejected.push(`outbox ${id}: ${reason} ${this.items[index].frame}`)
    this.items.splice(index, 1)
  }

  hasNoticeAck(noticeId: number, stage: string): boolean {
    return this.items.some(item => item.type === 'notice-ack' && item.noticeId === noticeId && item.stage === stage)
  }

  pending(): number {
    return this.items.length
  }

  pendingMessages(): number {
    return this.items.filter(item => item.type === 'message').length
  }

  private write(item: Omit<Item, 'seq'>): string | null {
    if (this.items.length >= this.capacity) return 'Cola llena'
    this.items.push({ ...item, seq: this.nextSeq })
    this.nextSeq += 1
    return null
  }
}

/**
 * Reemplaza `_boot`/`_uptimeMs` por `sentAt` según el reloj. null si todavía no se
 * puede saber la hora (el reloj no está sincronizado).
 */
export function prepareFrame(stored: string, clock: WallClock): string | null {
  let document: Record<string, unknown>
  try {
    document = JSON.parse(stored) as Record<string, unknown>
  } catch {
    return null
  }
  if (typeof document !== 'object' || document === null || Array.isArray(document)) return null
  if (typeof document._boot === 'number') {
    let epoch = clock.resolve({ epochMs: -1, boot: document._boot, uptimeMs: Number(document._uptimeMs) })
    // Encolado en un arranque anterior que nunca sincronizó: se fecha al enviarlo.
    if (epoch === null) epoch = clock.now()
    if (epoch === null) return null
    delete document._boot
    delete document._uptimeMs
    document.sentAt = formatIso(epoch)
  }
  return JSON.stringify(document)
}
