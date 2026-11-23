// Hora real de la manilla (wallclock.cpp).
//
// El ESP32 no tiene reloj de tiempo real y en la mina no suele haber NTP: la hora
// se toma del campo `serverTime` de cada ack de la central. Lo que se guarda antes
// de la primera sincronización lleva el número de arranque y el tiempo desde el
// arranque; al enviarlo se convierte a fecha si sigue siendo el mismo arranque.
import type { MonotonicClock } from './types.ts'

export interface Stamp {
  /** Época en milisegundos, o −1 si el reloj no estaba sincronizado. */
  readonly epochMs: number
  readonly boot: number
  readonly uptimeMs: number
}

export function isAbsolute(stamp: Stamp): boolean {
  return stamp.epochMs >= 0
}

const RESYNC_THRESHOLD_MS = 1000

export class WallClock {
  readonly bootId: number
  private readonly uptime: MonotonicClock
  private isSynced = false
  private offset = 0

  constructor(bootId: number, uptime: MonotonicClock) {
    this.bootId = bootId
    this.uptime = uptime
  }

  synced(): boolean {
    return this.isSynced
  }

  now(): number | null {
    return this.isSynced ? this.uptime() + this.offset : null
  }

  stamp(): Stamp {
    const uptime = this.uptime()
    return { epochMs: this.isSynced ? uptime + this.offset : -1, boot: this.bootId, uptimeMs: uptime }
  }

  resolve(stamp: Stamp): number | null {
    if (isAbsolute(stamp)) return stamp.epochMs
    if (!this.isSynced || stamp.boot !== this.bootId) return null
    return stamp.uptimeMs + this.offset
  }

  /** Adopta la hora de la central; se ignoran diferencias pequeñas (latencia). */
  sync(serverEpochMs: number): void {
    const offset = serverEpochMs - this.uptime()
    if (!this.isSynced || Math.abs(offset - this.offset) > RESYNC_THRESHOLD_MS) {
      this.offset = offset
      this.isSynced = true
    }
  }
}

const pad = (value: number, width: number) => String(value).padStart(width, '0')

/** 2026-11-16T19:04:05.123Z */
export function formatIso(epochMs: number): string {
  const date = new Date(Math.trunc(epochMs))
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}T${pad(date.getUTCHours(), 2)}:${pad(date.getUTCMinutes(), 2)}:${pad(date.getUTCSeconds(), 2)}.${pad(date.getUTCMilliseconds(), 3)}Z`
}

/** Acepta fracciones de cualquier longitud y zona Z, ±hh:mm o ninguna (UTC). */
export function parseIso(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?$/.exec(text)
  if (!match) return null
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number)
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) return null
  // Como el firmware: se conservan los milisegundos y se truncan las fracciones menores.
  const millis = match[7] ? Number(`${match[7]}00`.slice(0, 3)) : 0
  let offsetMinutes = 0
  const zone = match[8]
  if (zone && zone !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1
    offsetMinutes = sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)))
  }
  return Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60000 + millis
}
