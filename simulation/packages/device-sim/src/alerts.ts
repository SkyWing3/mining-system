// Reglas de aviso de la manilla (alerts.cpp).
//
// LED: verde normal, amarillo precaución, rojo peligro, azul aviso de la central
// o sin enlace. Motor: vibración larga en peligro, doble al recibir un aviso y
// corta al pulsar un botón. Buzzer: intermitente en peligro; Enter lo silencia
// durante `silenceSeconds`.
import type { Level, MonotonicClock } from './types.ts'

export type LedColor = 'off' | 'green' | 'yellow' | 'red' | 'blue'

export interface Rgb {
  readonly red: boolean
  readonly green: boolean
  readonly blue: boolean
}

export function ledRgb(color: LedColor): Rgb {
  switch (color) {
    case 'green': return { red: false, green: true, blue: false }
    case 'yellow': return { red: true, green: true, blue: false }
    case 'red': return { red: true, green: false, blue: false }
    case 'blue': return { red: false, green: false, blue: true }
    default: return { red: false, green: false, blue: false }
  }
}

export function ledColorName(color: LedColor): string {
  switch (color) {
    case 'green': return 'verde'
    case 'yellow': return 'amarillo'
    case 'red': return 'rojo'
    case 'blue': return 'azul'
    default: return 'apagado'
  }
}

/** Patrón intermitente: `count` < 0 repite hasta detenerlo. */
export interface Pattern {
  readonly onMs: number
  readonly offMs: number
  readonly count: number
  readonly started: number
}

/** Si la salida está energizada en `now`. */
export function patternActive(pattern: Pattern, now: number): boolean {
  const period = pattern.onMs + pattern.offMs
  const elapsed = now - pattern.started
  if (elapsed < 0 || (pattern.count >= 0 && elapsed >= pattern.count * period)) return false
  return period === 0 || elapsed % period < pattern.onMs
}

export interface AlertOutputs {
  setLed(color: LedColor, blink: boolean): void
  buzz(onMs: number, offMs: number, count: number): void
  stopBuzzer(): void
  vibrate(onMs: number, offMs: number, count: number): void
  stopMotor(): void
}

/** Estado instantáneo de las salidas físicas. */
export interface OutputLevels {
  red: boolean
  green: boolean
  blue: boolean
  buzzer: boolean
  motor: boolean
}

const LED_BLINK_MS = 500

/** Guarda los patrones pedidos; quien dibuja consulta `levels(now)`, como la tarea de E/S del firmware. */
export class PatternOutputs implements AlertOutputs {
  private readonly clock: MonotonicClock
  private led: LedColor = 'off'
  private blink = false
  private blinkStarted = 0
  private buzzer: Pattern | null = null
  private motor: Pattern | null = null

  constructor(clock: MonotonicClock) {
    this.clock = clock
  }

  setLed(color: LedColor, blink: boolean): void {
    this.led = color
    this.blink = blink
    this.blinkStarted = this.clock()
  }

  buzz(onMs: number, offMs: number, count: number): void {
    this.buzzer = { onMs, offMs, count, started: this.clock() }
  }

  stopBuzzer(): void {
    this.buzzer = null
  }

  vibrate(onMs: number, offMs: number, count: number): void {
    this.motor = { onMs, offMs, count, started: this.clock() }
  }

  stopMotor(): void {
    this.motor = null
  }

  levels(now: number): OutputLevels {
    const lit = this.led !== 'off' && (!this.blink || patternActive({ onMs: LED_BLINK_MS, offMs: LED_BLINK_MS, count: -1, started: this.blinkStarted }, now))
    const rgb = lit ? ledRgb(this.led) : ledRgb('off')
    return {
      red: rgb.red,
      green: rgb.green,
      blue: rgb.blue,
      buzzer: this.buzzer !== null && patternActive(this.buzzer, now),
      motor: this.motor !== null && patternActive(this.motor, now),
    }
  }

  ledColor(): LedColor {
    return this.led
  }

  ledBlink(): boolean {
    return this.blink
  }

  /** Patrones vigentes (para el sonido del buzzer en el navegador y las pruebas). */
  buzzerPattern(): Pattern | null {
    return this.buzzer
  }

  motorPattern(): Pattern | null {
    return this.motor
  }
}

interface Timing { readonly on: number; readonly off: number; readonly count: number }
const DANGER_BUZZ: Timing = { on: 400, off: 400, count: -1 }
const DANGER_VIBRATION: Timing = { on: 1500, off: 3500, count: -1 }
const CAUTION_BUZZ: Timing = { on: 150, off: 0, count: 1 }
const NOTICE_VIBRATION: Timing = { on: 250, off: 200, count: 2 }
const CRITICAL_NOTICE_BUZZ: Timing = { on: 200, off: 200, count: 3 }
const NOTICE_BUZZ: Timing = { on: 100, off: 0, count: 1 }
const BUTTON_VIBRATION: Timing = { on: 60, off: 0, count: 1 }

export class AlertController {
  private readonly outputs: AlertOutputs
  private readonly silenceMs: number
  private readonly buttonFeedback: boolean
  /** Sin central configurada no hay enlace que informar como perdido. */
  private readonly monitorLink: boolean
  private readonly clock: MonotonicClock
  private currentLevel: Level = 'normal'
  private connected = false
  private notice: string | null = null
  private silencedUntil = 0
  private alarmRunning = false
  private hasLed = false
  private ledColor: LedColor = 'off'
  private ledBlink = false

  constructor(outputs: AlertOutputs, silenceSeconds: number, buttonFeedback: boolean, monitorLink: boolean, clock: MonotonicClock) {
    this.outputs = outputs
    this.silenceMs = silenceSeconds * 1000
    this.buttonFeedback = buttonFeedback
    this.monitorLink = monitorLink
    this.clock = clock
    this.applyLed()
  }

  silenced(): boolean {
    return this.clock() < this.silencedUntil
  }

  level(): Level {
    return this.currentLevel
  }

  onLevel(level: Level): void {
    if (level === this.currentLevel) return
    const previous = this.currentLevel
    this.currentLevel = level
    if (level === 'danger') {
      this.silencedUntil = 0
      this.startAlarm()
    } else {
      this.stopAlarm()
      if (level === 'caution' && previous === 'normal') this.outputs.buzz(CAUTION_BUZZ.on, CAUTION_BUZZ.off, CAUTION_BUZZ.count)
    }
    this.applyLed()
  }

  onConnection(connected: boolean): void {
    this.connected = connected
    this.applyLed()
  }

  onNotice(severity: string): void {
    this.notice = severity
    if (!this.alarmRunning) {
      this.outputs.vibrate(NOTICE_VIBRATION.on, NOTICE_VIBRATION.off, NOTICE_VIBRATION.count)
      const buzz = severity === 'critical' ? CRITICAL_NOTICE_BUZZ : NOTICE_BUZZ
      this.outputs.buzz(buzz.on, buzz.off, buzz.count)
    }
    this.applyLed()
  }

  onNoticeCleared(): void {
    this.notice = null
    this.applyLed()
  }

  silence(): void {
    if (this.currentLevel !== 'danger') return
    this.silencedUntil = this.clock() + this.silenceMs
    this.stopAlarm()
  }

  onButton(): void {
    if (this.buttonFeedback && !this.alarmRunning) this.outputs.vibrate(BUTTON_VIBRATION.on, BUTTON_VIBRATION.off, BUTTON_VIBRATION.count)
  }

  /** Reanuda la alarma al terminar el silencio si el peligro persiste. */
  tick(): void {
    if (this.currentLevel === 'danger' && !this.alarmRunning && !this.silenced()) this.startAlarm()
  }

  close(): void {
    this.stopAlarm()
    this.outputs.setLed('off', false)
  }

  private startAlarm(): void {
    this.outputs.buzz(DANGER_BUZZ.on, DANGER_BUZZ.off, DANGER_BUZZ.count)
    this.outputs.vibrate(DANGER_VIBRATION.on, DANGER_VIBRATION.off, DANGER_VIBRATION.count)
    this.alarmRunning = true
  }

  private stopAlarm(): void {
    if (!this.alarmRunning) return
    this.outputs.stopBuzzer()
    this.outputs.stopMotor()
    this.alarmRunning = false
  }

  private applyLed(): void {
    let color: LedColor
    let blink: boolean
    if (this.currentLevel === 'danger') [color, blink] = ['red', true]
    else if (this.notice !== null) [color, blink] = ['blue', true]
    else if (this.currentLevel === 'caution') [color, blink] = ['yellow', false]
    else if (this.monitorLink && !this.connected) [color, blink] = ['blue', false]
    else [color, blink] = ['green', false]
    // Reenviar el mismo patrón intermitente lo reiniciaría y el LED parpadearía mal.
    if (this.hasLed && color === this.ledColor && blink === this.ledBlink) return
    this.hasLed = true
    this.ledColor = color
    this.ledBlink = blink
    this.outputs.setLed(color, blink)
  }
}
