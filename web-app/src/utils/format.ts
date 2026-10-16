import type { AlertLevel, NoticeStatus, Reading, Role, Severity } from '../types/domain'

// The API stores UTC; operators see the mine's local time consistently.
export const TIME_ZONE = 'America/La_Paz'

export function parseDate(value: string) {
  return new Date(value.endsWith('Z') || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`)
}

// A control room reads 24-hour time: no "a. m./p. m." to misread during a shift change.
export function date(value: string | null, full = false) {
  if (!value) return 'Sin conexión registrada'
  const options: Intl.DateTimeFormatOptions = full
    ? { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23', timeZone: TIME_ZONE }
    : { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: TIME_ZONE }
  return new Intl.DateTimeFormat('es-BO', options).format(parseDate(value))
}

export function longDate(value: Date) {
  return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: 'long', year: 'numeric', timeZone: TIME_ZONE }).format(value)
}

export function shortDate(value: Date) {
  return new Intl.DateTimeFormat('es-BO', { weekday: 'short', day: '2-digit', month: 'short', timeZone: TIME_ZONE }).format(value)
}

export function clock(value: Date) {
  return new Intl.DateTimeFormat('es-BO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: TIME_ZONE }).format(value)
}

export function elapsed(value: string, now: number) {
  const seconds = Math.max(0, Math.round((now - parseDate(value).getTime()) / 1000))
  if (seconds < 60) return `hace ${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `hace ${minutes} min`
  return `hace ${Math.round(minutes / 60)} h`
}

export function duration(milliseconds: number) {
  const seconds = Math.round(milliseconds / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

export const roleName: Record<Role, string> = { Admin: 'Administrador', Supervisor: 'Supervisor', Miner: 'Minero' }

export const severityName: Record<Severity, string> = { critical: 'Crítica', warning: 'Atención', info: 'Informativa' }

export const levelName: Record<AlertLevel, string> = { normal: 'Normal', caution: 'Precaución', danger: 'Peligro' }

export const noticeStatusName: Record<NoticeStatus, string> = {
  pending: 'Pendiente',
  delivered: 'Entregado',
  read: 'Leído',
  expired: 'Expirado',
}

export const initials = (name: string) =>
  name.split(' ').filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase()

export function temperature(value: number | null | undefined) {
  return value == null ? '—' : `${value.toFixed(1)} °C`
}

export function percent(value: number | null | undefined) {
  return value == null ? '—' : `${value.toFixed(0)} %`
}

// SEN0564 values are ppm only after calibration; otherwise the raw voltage is shown as such.
export function gas(reading: Pick<Reading, 'gasPpm' | 'gasVoltage'> | null | undefined) {
  if (reading?.gasPpm != null) return `${reading.gasPpm.toFixed(0)} ppm`
  if (reading?.gasVoltage != null) return `${reading.gasVoltage.toFixed(3)} V`
  return '—'
}

export function isUncalibrated(reading: Pick<Reading, 'gasPpm' | 'gasVoltage'> | null | undefined) {
  return reading?.gasPpm == null && reading?.gasVoltage != null
}
