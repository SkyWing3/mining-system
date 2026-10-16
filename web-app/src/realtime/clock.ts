import { useSyncExternalStore } from 'react'

// One one-second clock for the whole central: each view reads only the time it needs instead of running its own timer.
let now = Date.now()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!timer) {
    now = Date.now()
    timer = setInterval(() => {
      now = Date.now()
      for (const notify of listeners) notify()
    }, 1000)
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

// Current time in milliseconds, refreshed every second.
export function useNow() {
  return useSyncExternalStore(subscribe, () => now)
}

// Re-renders only when the derived value changes, such as the moment a reading becomes stale.
export function useNowCheck<T extends string | number | boolean>(check: (now: number) => T) {
  return useSyncExternalStore(subscribe, () => check(now))
}
