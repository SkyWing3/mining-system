// Fotograma de la OLED SSD1306 de 128x64 (renderer.cpp).
import type { Canvas } from './canvas.ts'
import { MESSAGES } from './catalog.ts'
import { MESSAGES_PAGE, Menu, PAGE_COUNT, PAGES, VOICE_PAGE } from './menu.ts'
import { oledText, splitWords, utf8Prefix } from './text.ts'
import { levelLabel } from './types.ts'

const LINES = [15, 27, 39]
const FOOTER_LINE = 54
const FOOTER_TEXT = 53

/** Mayúsculas solo en ASCII, como el firmware. */
function upper(value: string): string {
  return value.replace(/[a-z]/g, char => char.toUpperCase())
}

function celsius(value: number | null): string {
  return value !== null ? `${value.toFixed(1)} °C` : '--'
}

export function clockText(seconds: number): string {
  const whole = Math.trunc(seconds)
  return `${Math.trunc(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export function linkText(menu: Menu): string {
  if (!menu.link.configured) return 'Central: sin configurar'
  return menu.connected() ? 'Central: conectada' : 'Central: sin enlace'
}

export class Renderer {
  private canvas: Canvas | null = null

  render(menu: Menu, canvas: Canvas): void {
    this.canvas = canvas
    canvas.clear()
    canvas.setFont('small')
    if (menu.notice() !== null) {
      this.noticeOverlay(menu)
    } else if (menu.alarmVisible) {
      this.alarmOverlay(menu)
    } else {
      this.header(menu)
      if (menu.page === null) this.main(menu)
      else if (menu.page === MESSAGES_PAGE) this.messages(menu)
      else if (menu.page === VOICE_PAGE) this.voice(menu)
      else this.lines(this.detail(menu))
      this.footerText(this.footer(menu))
    }
    this.canvas = null
  }

  private get c(): Canvas {
    return this.canvas as Canvas
  }

  // --- partes de la composición ---

  private header(menu: Menu): void {
    this.text(3, 0, menu.page !== null ? upper(PAGES[menu.page]) : 'MINING SYSTEM')
    let x = 124
    if (menu.link.configured) {
      // Punto relleno: enlazada con la central; hueco: sin enlace.
      this.c.ellipse(x - 4, 3, x + 2, 9, menu.connected(), true)
      x -= 10
    }
    const level = menu.assessment.level
    if (level === 'caution' || level === 'danger') {
      const mark = level === 'danger' ? '!!' : '!'
      x -= this.c.textWidth(mark)
      this.text(x, 0, mark)
      x -= 4
    }
    if (menu.snapshot.simulated) {
      x -= this.c.textWidth('SIM')
      this.text(x, 0, 'SIM')
    }
    this.c.line(0, 12, 127, 12, true)
  }

  private main(menu: Menu): void {
    const last = Math.min(menu.offset + Menu.VISIBLE_ROWS, PAGE_COUNT)
    for (let index = menu.offset, row = 0; index < last; index++, row++) {
      const y = 15 + row * 13
      const selected = index === menu.selected
      if (selected) this.c.box(2, y, 119, y + 11, true)
      this.icon(index, 5, y + 2, !selected)
      this.text(18, y, PAGES[index], !selected)
    }
    this.scrollbar(menu.selected, PAGE_COUNT)
  }

  private messages(menu: Menu): void {
    if (menu.messageMode === 'choose') {
      const items = [...MESSAGES.map(option => option.label), '< Volver']
      this.options(items, menu.messageSelected, menu.messageOffset, Menu.VISIBLE_ROWS)
      this.scrollbar(menu.messageSelected, items.length)
    } else if (menu.messageMode === 'confirm') {
      this.text(3, 15, MESSAGES[menu.messageSelected].label)
      this.options(['Enviar', 'Cancelar'], menu.confirmSelected, 0, 2, 29)
    } else {
      this.lines([menu.deliveryStatus, linkText(menu), '< Volver'])
    }
  }

  private voice(menu: Menu): void {
    switch (menu.voiceMode) {
      case 'recording':
        this.text(3, 15, 'Grabando')
        if (menu.recordingSeconds % 2 === 0) this.c.ellipse(112, 17, 118, 23, true, true)
        this.c.setFont('large')
        this.text(3, 30, clockText(menu.recordingSeconds))
        this.c.setFont('small')
        break
      case 'confirm':
        this.text(3, 15, `Duración ${clockText(Math.trunc(menu.voiceDurationMs / 1000))}`)
        this.options(['Enviar', 'Descartar'], menu.voiceConfirmSelected, 0, 2, 29)
        break
      case 'result':
        this.lines([menu.voiceStatus, linkText(menu), '< Volver'])
        break
      case 'idle':
        this.text(3, 15, 'Mensaje de voz')
        this.options(['Grabar', '< Volver'], menu.voiceConfirmSelected, 0, 2, 29)
        break
    }
  }

  private noticeOverlay(menu: Menu): void {
    const notice = menu.notice()
    if (!notice) return
    this.banner(notice.severity !== 'critical' ? 'AVISO CENTRAL' : 'AVISO URGENTE')
    this.wrapped(notice.text, 18)
    if (menu.notices.length > 1) this.text(3, 43, `+${menu.notices.length - 1} aviso(s)`)
    this.footerText('ENTER: enterado')
  }

  private alarmOverlay(menu: Menu): void {
    this.banner('PELIGRO')
    this.c.setFont('large')
    let row = 0
    for (const condition of menu.assessment.conditions) {
      if (condition.level !== 'danger' || row >= 3) continue
      this.text(3, 16 + row * 13, condition.text())
      row += 1
    }
    this.c.setFont('small')
    this.footerText('ENTER: silenciar')
  }

  private footer(menu: Menu): string {
    if (menu.page === null) return `${menu.selected + 1}/${PAGE_COUNT}   ENTER: abrir`
    if (menu.page === MESSAGES_PAGE) {
      if (menu.messageMode === 'choose') return 'ENTER: seleccionar'
      if (menu.messageMode === 'confirm') return 'ENTER: confirmar'
      return 'ENTER: volver'
    }
    if (menu.page === VOICE_PAGE) {
      if (menu.voiceMode === 'recording') return 'ENTER: detener'
      if (menu.voiceMode === 'result') return 'ENTER: volver'
      return 'ENTER: seleccionar'
    }
    return 'ENTER: volver'
  }

  // --- contenido de las páginas ---

  private detail(menu: Menu): string[] {
    const title = PAGES[menu.page ?? 0]
    const snapshot = menu.snapshot
    const level = `Nivel: ${levelLabel(menu.assessment.level)}`
    if (title === 'Estado') {
      const status = menu.link.blocked ? `Bloqueo: ${utf8Prefix(menu.link.blocked, 14)}` : level
      return [linkText(menu), status, `Cola: ${menu.pendingMessages} msg, ${menu.pendingVoices} voz`]
    }
    if (title === 'Gases') {
      const value = snapshot.coPpm !== null ? `CO: ${snapshot.coPpm.toFixed(0)} ppm`
        : snapshot.coVolts !== null ? `CO: ${snapshot.coVolts.toFixed(3)} V`
          : 'CO: sin lectura'
      let state: string
      switch (snapshot.coState) {
        case 'warming': state = `Calentando ${clockText(snapshot.warmupRemaining)}`; break
        case 'uncalibrated': state = 'Sin calibrar (V)'; break
        case 'error': state = 'Sensor con error'; break
        case 'disabled': state = 'Sensor desactivado'; break
        case 'ok': state = `${(snapshot.coVolts ?? 0).toFixed(3)} V calibrado`; break
      }
      return [value, state, level]
    }
    if (title === 'Temperatura') {
      if (snapshot.thermometerState === 'error') return ['Sensor MLX90614', 'Sensor con error', level]
      if (snapshot.thermometerState === 'disabled') return ['Sensor MLX90614', 'Sensor desactivado', '']
      return [`Ambiente: ${celsius(snapshot.ambientC)}`, `Objeto: ${celsius(snapshot.objectC)}`, level]
    }
    const identity = menu.link.identity
    if (!identity) return ['Manilla sin identificar', 'Conecta con la central', '']
    return [identity.name, identity.minerName ?? 'Sin minero asignado', identity.zone]
  }

  // --- ayudas de dibujo ---

  private text(x: number, y: number, value: string, on = true): void {
    this.c.text(x, y, oledText(value), on)
  }

  private footerText(value: string): void {
    this.c.line(0, FOOTER_LINE, 127, FOOTER_LINE, true)
    this.text(3, FOOTER_TEXT, value)
  }

  private lines(values: readonly string[]): void {
    for (let index = 0; index < values.length && index < 3; index++) this.text(3, LINES[index], values[index])
  }

  private options(items: readonly string[], selected: number, offset: number, rows: number, top = 15): void {
    const last = Math.min(offset + rows, items.length)
    for (let index = offset, row = 0; index < last; index++, row++) {
      const y = top + row * 13
      if (index === selected) this.c.box(2, y, 119, y + 11, true)
      this.text(5, y, items[index], index !== selected)
    }
  }

  private banner(value: string): void {
    this.c.box(0, 0, 127, 12, true)
    this.text(3, 0, value, false)
  }

  private wrapped(value: string, top: number): void {
    this.c.setFont('large')
    const result: string[] = []
    let current = ''
    for (const word of splitWords(oledText(value))) {
      const candidate = current ? `${current} ${word}` : word
      if (!current || this.c.textWidth(candidate) <= 122) {
        current = candidate
      } else {
        result.push(current)
        current = word
      }
    }
    result.push(current)
    for (let index = 0; index < result.length && index < 2; index++) this.text(3, top + index * 13, result[index])
    this.c.setFont('small')
  }

  private scrollbar(selected: number, count: number): void {
    this.c.line(124, 16, 124, 51, true)
    // lround del firmware: redondeo lejos de cero (los valores son positivos).
    const top = 16 + Math.round((selected * 28) / Math.max(1, count - 1))
    this.c.box(123, top, 125, top + 7, true)
  }

  private icon(index: number, x: number, y: number, on: boolean): void {
    const c = this.c
    switch (index) {
      case 0: // Estado: monitor
        c.frame(x, y, x + 8, y + 6, on)
        c.line(x + 2, y + 8, x + 6, y + 8, on)
        break
      case 1: // Gases: burbujas
        c.ellipse(x, y + 3, x + 5, y + 8, false, on)
        c.ellipse(x + 3, y, x + 8, y + 5, false, on)
        break
      case 2: // Temperatura: termómetro
        c.frame(x + 3, y, x + 5, y + 5, on)
        c.ellipse(x + 2, y + 4, x + 6, y + 8, false, on)
        break
      case 3: // Mensajes: globo de diálogo
        c.frame(x, y, x + 8, y + 6, on)
        c.line(x + 2, y + 6, x + 2, y + 8, on)
        break
      case 4: // Voz: micrófono
        c.roundedFrame(x + 2, y, x + 6, y + 5, 2, on)
        c.line(x, y + 3, x, y + 4, on)
        c.line(x + 8, y + 3, x + 8, y + 4, on)
        c.line(x + 1, y + 5, x + 1, y + 5, on)
        c.line(x + 7, y + 5, x + 7, y + 5, on)
        c.line(x + 2, y + 6, x + 6, y + 6, on)
        c.line(x + 4, y + 7, x + 4, y + 8, on)
        break
      default: // Ajustes
        c.ellipse(x, y, x + 8, y + 8, false, on)
        c.box(x + 3, y + 3, x + 5, y + 5, on)
        break
    }
  }
}
