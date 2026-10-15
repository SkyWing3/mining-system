export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const statusMessages: Record<number, string> = {
  401: 'Tu sesión ha terminado. Inicia sesión nuevamente.',
  403: 'No tienes permisos para esta operación.',
  429: 'Demasiados intentos. Espera un minuto e intenta nuevamente.',
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      credentials: 'include',
      // The API rejects cookie-authenticated mutations without this header (CSRF protection).
      headers: { 'Content-Type': 'application/json', 'X-Mining-Client': 'web', ...options.headers },
    })
  } catch {
    throw new ApiError('No se puede conectar con la central. Comprueba tu conexión.', 0)
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const validation = body.errors ? Object.values(body.errors).flat().join(' ') : null
    throw new ApiError(body.message || validation || (statusMessages[response.status] ?? 'No se pudo completar la operación.'), response.status)
  }
  return response.status === 204 ? (undefined as T) : response.json()
}

export const get = <T,>(path: string, signal?: AbortSignal) => request<T>(path, { signal })

export const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

export const put = <T,>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) })

export function isTransient(error: unknown) {
  return error instanceof ApiError && (error.status === 0 || error.status === 429 || error.status >= 500)
}

// Reads run on mount or after a live event; only transient failures are retried, never mutations.
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
      if (!controller.signal.aborted) {
        completed = true
        loaded(data)
      }
    } catch (error) {
      if (controller.signal.aborted) return
      failed(error)
      if (isTransient(error)) {
        const wait = error instanceof ApiError && error.status === 429 ? 60000 : Math.min(1000 * 2 ** Math.min(attempts++, 4), 10000)
        timer = setTimeout(() => void run(), wait)
      } else {
        completed = true
      }
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
  return () => {
    controller.abort()
    clearTimeout(timer)
    window.removeEventListener('online', online)
  }
}
