// Códigos compartidos con backend/Domain/Catalogs.cs; textos cortos para la OLED (catalog.cpp).

export interface MessageOption {
  readonly code: string
  readonly label: string
}

/** Reportes que el minero elige en el menú Mensajes. */
export const MESSAGES: readonly MessageOption[] = [
  { code: 'HELP', label: 'Ayuda' },
  { code: 'OK', label: 'Todo bien' },
  { code: 'COLLAPSE', label: 'Hay derrumbe' },
  { code: 'GAS', label: 'Presencia de gas' },
  { code: 'INJURY', label: 'Compañero herido' },
  { code: 'EVACUATE', label: 'Necesito evacuar' },
  { code: 'SUPPLIES', label: 'Suministros' },
  { code: 'EXIT', label: 'Saliendo de mina' },
]

/** Alarmas que la manilla envía sola al alcanzar el umbral de peligro. */
export const CO_ALARM = 'CO_ALARM'
export const HEAT_ALARM = 'HEAT_ALARM'

export function isAutomaticMessage(code: string): boolean {
  return code === CO_ALARM || code === HEAT_ALARM
}

export function isMessageCode(code: string): boolean {
  return MESSAGES.some(option => option.code === code) || isAutomaticMessage(code)
}

export type Severity = 'critical' | 'warning' | 'info'

export type NoticeCode = 'EVACUATE' | 'SURFACE' | 'SHELTER' | 'HELP_COMING' | 'RECEIVED' | 'REPORT'

export interface NoticeKind {
  readonly code: NoticeCode
  readonly text: string
  readonly severity: Severity
}

/** Avisos de la central a la manilla (NoticeCatalog de backend/Domain/Catalogs.cs). */
export const NOTICES: readonly NoticeKind[] = [
  { code: 'EVACUATE', text: 'Evacuar ahora', severity: 'critical' },
  { code: 'SURFACE', text: 'Volver a superficie', severity: 'warning' },
  { code: 'SHELTER', text: 'Ir al refugio', severity: 'warning' },
  { code: 'HELP_COMING', text: 'Ayuda en camino', severity: 'info' },
  { code: 'RECEIVED', text: 'Mensaje recibido', severity: 'info' },
  { code: 'REPORT', text: 'Reporta tu estado', severity: 'info' },
]
