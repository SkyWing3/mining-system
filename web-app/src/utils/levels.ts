import type { Device } from '../types/domain'

// Severity order used to sort devices: danger first, then caution, then the rest; connected before offline.
export function levelRank(device: Device) {
  return { danger: 2, caution: 1, normal: 0 }[device.reading?.level ?? 'normal'] + (device.online ? 0.5 : 0)
}
