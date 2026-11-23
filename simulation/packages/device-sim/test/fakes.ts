// Dobles de prueba equivalentes a esp32-device/test/fakes.h.
import type { AlertOutputs, LedColor } from '../src/index.ts'

export class FakeClock {
  now = 0
  readonly fn = () => this.now
}

export class Counter {
  private value = 0
  readonly fn = () => ++this.value
}

export interface Call {
  readonly kind: 'led' | 'buzz' | 'buzz-stop' | 'vibrate' | 'motor-stop'
  readonly color?: LedColor
  readonly blink?: boolean
  readonly on?: number
  readonly off?: number
  readonly count?: number
}

export class RecordingOutputs implements AlertOutputs {
  readonly calls: Call[] = []
  setLed(color: LedColor, blink: boolean): void { this.calls.push({ kind: 'led', color, blink }) }
  buzz(on: number, off: number, count: number): void { this.calls.push({ kind: 'buzz', on, off, count }) }
  stopBuzzer(): void { this.calls.push({ kind: 'buzz-stop' }) }
  vibrate(on: number, off: number, count: number): void { this.calls.push({ kind: 'vibrate', on, off, count }) }
  stopMotor(): void { this.calls.push({ kind: 'motor-stop' }) }

  last(kind: Call['kind']): Call {
    const found = [...this.calls].reverse().find(call => call.kind === kind)
    if (!found) throw new Error(`sin llamadas ${kind}`)
    return found
  }

  count(kind: Call['kind']): number {
    return this.calls.filter(call => call.kind === kind).length
  }
}
