import { useCallback, useReducer } from 'react'
import type { Reading } from '../types/domain'
import { parseDate } from '../utils/format'

// Live charts keep the last ten minutes of each device (at most 600 points, one per second).
export const LIVE_WINDOW_MS = 10 * 60 * 1000
const MAX_POINTS = 600

export type LiveSeries = Record<string, Reading[]>

type Action =
  | { type: 'merge'; deviceId: string; readings: Reading[] }
  | { type: 'reset' }

const time = (reading: Reading) => parseDate(reading.receivedAt).getTime()

// Merge in time order, without duplicates, trimmed to a window ending at the newest reading.
export function mergeReadings(existing: Reading[], incoming: Reading[], windowMs = LIVE_WINDOW_MS, maxPoints = MAX_POINTS) {
  const byTime = new Map<string, Reading>()
  for (const reading of [...existing, ...incoming]) byTime.set(reading.receivedAt, reading)
  const merged = [...byTime.values()].sort((a, b) => time(a) - time(b))
  const newest = merged.length ? time(merged[merged.length - 1]) : 0
  return merged.filter(reading => newest - time(reading) <= windowMs).slice(-maxPoints)
}

function reducer(state: LiveSeries, action: Action): LiveSeries {
  if (action.type === 'reset') return {}
  return { ...state, [action.deviceId]: mergeReadings(state[action.deviceId] ?? [], action.readings) }
}

export function useLiveTelemetry() {
  const [series, dispatch] = useReducer(reducer, {})
  const append = useCallback((deviceId: string, reading: Reading) => dispatch({ type: 'merge', deviceId, readings: [reading] }), [])
  const seed = useCallback((deviceId: string, readings: Reading[]) => dispatch({ type: 'merge', deviceId, readings }), [])
  const reset = useCallback(() => dispatch({ type: 'reset' }), [])
  return { series, append, seed, reset }
}
