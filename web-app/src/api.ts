export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...options, credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Mining-Client': 'web', ...options.headers },
    })
  } catch { throw new ApiError('No se puede conectar con la central. Comprueba tu conexión.', 0) }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const validation = body.errors ? Object.values(body.errors).flat().join(' ') : null
    throw new ApiError(body.message || validation || ({ 401: 'Tu sesión ha terminado. Inicia sesión nuevamente.', 403: 'No tienes permisos para esta operación.', 429: 'Demasiados intentos. Espera un minuto e intenta nuevamente.' }[response.status] ?? 'No se pudo completar la operación.'), response.status)
  }
  return response.status === 204 ? undefined as T : response.json()
}

export const post = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined })
export const put = <T,>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body: JSON.stringify(body) })

// Reads run on mount or a live event; retry only transient failures, never mutations.
export function loadWithRecovery<T>(
  load: (signal: AbortSignal) => Promise<T>,
  loaded: (data: T) => void,
  failed: (error: unknown) => void,
  delay = 0,
) {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout>
  let running = false
  let completed = false
  let attempts = 0

  async function run() {
    if (controller.signal.aborted || running || completed) return
    running = true
    try {
      const data = await load(controller.signal)
      if (!controller.signal.aborted) { completed = true; loaded(data) }
    } catch (error) {
      if (controller.signal.aborted) return
      failed(error)
      if (error instanceof ApiError && (error.status === 0 || error.status === 429 || error.status >= 500)) {
        const wait = error.status === 429 ? 60000 : Math.min(1000 * 2 ** Math.min(attempts++, 4), 10000)
        timer = setTimeout(() => void run(), wait)
      } else completed = true
    } finally {
      running = false
      if (completed) window.removeEventListener('online', online)
    }
  }

  function online() {
    if (running || completed || controller.signal.aborted) return
    clearTimeout(timer)
    timer = setTimeout(() => void run(), 0)
  }

  window.addEventListener('online', online)
  timer = setTimeout(() => void run(), delay)
  return () => { controller.abort(); clearTimeout(timer); window.removeEventListener('online', online) }
}

export function date(value: string | null, full = false) {
  if (!value) return 'Sin conexión registrada'
  // The API stores UTC; the operator sees the mine's local time consistently.
  const options: Intl.DateTimeFormatOptions = full
    ? { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/La_Paz' }
    : { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/La_Paz' }
  return new Intl.DateTimeFormat('es-BO', options).format(new Date(value.endsWith('Z') || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`))
}
export const roleName = { Admin: 'Administrador', Supervisor: 'Supervisor', Miner: 'Minero' }
export const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase()
