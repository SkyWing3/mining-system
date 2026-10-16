import { useCallback, useEffect, useState } from 'react'
import { loadWithRecovery } from '../api/client'
import { devicesApi, monitoringApi } from '../api/endpoints'
import type { Device, Message, Overview, TelemetryEvent, User } from '../types/domain'

// Each scope is reloaded when its version changes; live events bump only what they affect.
export type Scope = 'summary' | 'devices' | 'users' | 'messages' | 'voice' | 'notices' | 'activity' | 'analytics'
export type Versions = Record<Scope, number>

const SCOPES: Scope[] = ['summary', 'devices', 'users', 'messages', 'voice', 'notices', 'activity', 'analytics']

export function useVersions() {
  const [versions, setVersions] = useState<Versions>(() => Object.fromEntries(SCOPES.map(scope => [scope, 0])) as Versions)
  const bump = useCallback((...scopes: Scope[]) => {
    setVersions(current => {
      const next = { ...current }
      for (const scope of scopes.length ? scopes : SCOPES) next[scope] += 1
      return next
    })
  }, [])
  return [versions, bump] as const
}

export function useCentralData(versions: Versions, onError: (error: unknown) => void, onLoaded: () => void) {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [miners, setMiners] = useState<User[]>([])
  const [devicesLoaded, setDevicesLoaded] = useState(false)

  useEffect(() => loadWithRecovery(
    signal => monitoringApi.overview(signal),
    data => {
      setOverview(data)
      onLoaded()
    },
    onError,
    120,
  ), [versions.summary, onError, onLoaded])

  useEffect(() => loadWithRecovery(
    signal => Promise.all([devicesApi.list(signal), devicesApi.miners(signal)]),
    ([items, personnel]) => {
      setDevices(items)
      setMiners(personnel)
      setDevicesLoaded(true)
      onLoaded()
    },
    onError,
    120,
  ), [versions.devices, onError, onLoaded])

  // A live reading updates its device in place: no request is needed.
  const applyTelemetry = useCallback((event: TelemetryEvent) => {
    setDevices(current => current.map(device => device.id === event.deviceId
      ? { ...device, reading: event.reading, lastSeenAt: event.reading.receivedAt, online: device.active }
      : device))
  }, [])

  const applyMessage = useCallback((message: Message) => {
    setOverview(current => current && !current.recentMessages.some(item => item.id === message.id)
      ? { ...current, recentMessages: [message, ...current.recentMessages].slice(0, 8) }
      : current)
  }, [])

  return { overview, devices, miners, loading: overview === null || !devicesLoaded, applyTelemetry, applyMessage }
}
