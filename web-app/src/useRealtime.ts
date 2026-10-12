import { useEffect, useRef, useState } from 'react'
import { HubConnectionBuilder, HubConnectionState, HttpTransportType, LogLevel } from '@microsoft/signalr'
import type { Message } from './types'

export function useRealtime(userId: string, changed: () => void, received: (message: Message) => void) {
  const [status, setStatus] = useState<'connecting' | 'online' | 'offline'>('connecting')
  const callbacks = useRef({ changed, received })
  useEffect(() => { callbacks.current = { changed, received } }, [changed, received])
  useEffect(() => {
    let disposed = false
    let starting = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const connection = new HubConnectionBuilder()
      .withUrl('/hubs/mining', { transport: HttpTransportType.WebSockets, skipNegotiation: true })
      .withAutomaticReconnect({ nextRetryDelayInMilliseconds: context => Math.min(1000 * 2 ** Math.min(context.previousRetryCount, 5), 20000) })
      .configureLogging(LogLevel.Error).build()
    connection.on('MessageReceived', (message: Message) => { callbacks.current.received(message); callbacks.current.changed() })
    for (const event of ['SystemChanged', 'MessageReviewed', 'TelemetryReceived']) connection.on(event, () => callbacks.current.changed())
    connection.onreconnecting(() => { if (!disposed) { setStatus('connecting'); callbacks.current.changed() } })
    connection.onreconnected(() => { if (!disposed) { setStatus('online'); callbacks.current.changed() } })
    async function start() {
      if (disposed || starting || !navigator.onLine || connection.state !== HubConnectionState.Disconnected) return
      starting = true
      try { await connection.start(); if (!disposed) { setStatus('online'); callbacks.current.changed() } }
      catch { if (!disposed) { setStatus('offline'); timer = setTimeout(start, 5000) } }
      finally { starting = false }
    }
    connection.onclose(() => { if (!disposed) { setStatus('offline'); if (navigator.onLine) { callbacks.current.changed(); timer = setTimeout(start, 1000) } } })
    const offline = () => { clearTimeout(timer); setStatus('offline'); void connection.stop() }
    const online = () => { clearTimeout(timer); void start() }
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    // Defer opening the socket until after React's development effect cleanup.
    timer = setTimeout(() => { if (!navigator.onLine) setStatus('offline'); else void start() }, 0)
    return () => { disposed = true; clearTimeout(timer); window.removeEventListener('offline', offline); window.removeEventListener('online', online); void connection.stop() }
  }, [userId])
  return status
}
