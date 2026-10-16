import { useEffect, useRef, useState } from 'react'
import { HttpTransportType, HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr'
import type { ChangeCategory, Message, Notice, TelemetryEvent, VoiceMessage } from '../types/domain'

// 'starting' is the first attempt right after loading, while the data just fetched is still current.
export type LinkStatus = 'starting' | 'connecting' | 'online' | 'offline'

// After this long without opening the link, the first attempt counts as a connection problem.
const STARTUP_GRACE_MS = 5000

// Events sent by backend/Realtime/MiningHub.cs (IMiningClient).
export interface RealtimeHandlers {
  messageReceived: (message: Message) => void
  messageReviewed: (message: Message) => void
  telemetryReceived: (event: TelemetryEvent) => void
  voiceMessageReceived: (voice: VoiceMessage) => void
  voiceMessageReviewed: (voice: VoiceMessage) => void
  noticeUpdated: (notice: Notice) => void
  systemChanged: (category: ChangeCategory) => void
  // Called after (re)connecting so views can recover what happened during the gap.
  resynchronize: () => void
}

export function useRealtime(userId: string, handlers: RealtimeHandlers): LinkStatus {
  const [status, setStatus] = useState<LinkStatus>('starting')
  const current = useRef(handlers)
  useEffect(() => {
    current.current = handlers
  }, [handlers])

  useEffect(() => {
    let disposed = false
    let starting = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const connection = new HubConnectionBuilder()
      .withUrl('/hubs/mining', { transport: HttpTransportType.WebSockets, skipNegotiation: true })
      .withAutomaticReconnect({ nextRetryDelayInMilliseconds: context => Math.min(1000 * 2 ** Math.min(context.previousRetryCount, 5), 20000) })
      .configureLogging(LogLevel.Error)
      .build()

    connection.on('MessageReceived', (message: Message) => current.current.messageReceived(message))
    connection.on('MessageReviewed', (message: Message) => current.current.messageReviewed(message))
    connection.on('TelemetryReceived', (event: TelemetryEvent) => current.current.telemetryReceived(event))
    connection.on('VoiceMessageReceived', (voice: VoiceMessage) => current.current.voiceMessageReceived(voice))
    connection.on('VoiceMessageReviewed', (voice: VoiceMessage) => current.current.voiceMessageReviewed(voice))
    connection.on('NoticeUpdated', (notice: Notice) => current.current.noticeUpdated(notice))
    connection.on('SystemChanged', (category: ChangeCategory) => current.current.systemChanged(category))

    connection.onreconnecting(() => {
      if (disposed) return
      setStatus('connecting')
      current.current.resynchronize()
    })
    connection.onreconnected(() => {
      if (disposed) return
      setStatus('online')
      current.current.resynchronize()
    })

    async function start() {
      if (disposed || starting || !navigator.onLine || connection.state !== HubConnectionState.Disconnected) return
      starting = true
      try {
        await connection.start()
        if (!disposed) {
          setStatus('online')
          current.current.resynchronize()
        }
      } catch {
        if (!disposed) {
          setStatus('offline')
          timer = setTimeout(start, 5000)
        }
      } finally {
        starting = false
      }
    }

    connection.onclose(() => {
      if (disposed) return
      setStatus('offline')
      if (navigator.onLine) {
        current.current.resynchronize()
        timer = setTimeout(start, 1000)
      }
    })
    const offline = () => {
      clearTimeout(timer)
      setStatus('offline')
      void connection.stop()
    }
    const online = () => {
      clearTimeout(timer)
      void start()
    }
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    const grace = setTimeout(() => setStatus(current => current === 'starting' ? 'connecting' : current), STARTUP_GRACE_MS)
    // Defer opening the socket until after React's development effect cleanup.
    timer = setTimeout(() => {
      if (!navigator.onLine) setStatus('offline')
      else void start()
    }, 0)
    return () => {
      disposed = true
      clearTimeout(timer)
      clearTimeout(grace)
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', online)
      void connection.stop()
    }
  }, [userId])

  return status
}
