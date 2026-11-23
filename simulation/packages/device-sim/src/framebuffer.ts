// Memoria de imagen monocroma de 128x64 con las primitivas de U8g2 (display.cpp).
//
// Las figuras se trazan en TypeScript puro (Bresenham y punto medio), así la
// misma imagen se obtiene en el navegador y en las pruebas. El texto se delega a
// un rasterizador intercambiable: el navegador usa Canvas 2D y las pruebas una
// fuente de bloques determinista.
import type { Canvas, Font } from './canvas.ts'

export interface TextRasterizer {
  width(text: string, font: Font): number
  draw(buffer: MonoFramebuffer, x: number, y: number, text: string, font: Font, on: boolean): void
}

export const OLED_WIDTH = 128
export const OLED_HEIGHT = 64

export class MonoFramebuffer implements Canvas {
  readonly width = OLED_WIDTH
  readonly height = OLED_HEIGHT
  /** 0/1 por píxel, por filas. */
  readonly pixels = new Uint8Array(OLED_WIDTH * OLED_HEIGHT)
  private readonly rasterizer: TextRasterizer
  private font: Font = 'small'
  private readonly committed = new Uint8Array(OLED_WIDTH * OLED_HEIGHT)
  private dirty = false
  private currentVersion = 0

  constructor(rasterizer: TextRasterizer) {
    this.rasterizer = rasterizer
  }

  /**
   * Aumenta cuando el contenido cambió desde la última consulta, como el envío
   * a la OLED del firmware, que solo transmite si el fotograma es distinto.
   */
  get version(): number {
    if (this.dirty) {
      this.dirty = false
      let changed = false
      for (let index = 0; index < this.pixels.length; index++) {
        if (this.pixels[index] !== this.committed[index]) {
          changed = true
          break
        }
      }
      if (changed) {
        this.committed.set(this.pixels)
        this.currentVersion += 1
      }
    }
    return this.currentVersion
  }

  setPixel(x: number, y: number, on: boolean): void {
    if (x < 0 || y < 0 || x >= OLED_WIDTH || y >= OLED_HEIGHT) return
    this.pixels[y * OLED_WIDTH + x] = on ? 1 : 0
    this.dirty = true
  }

  getPixel(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= OLED_WIDTH || y >= OLED_HEIGHT) return false
    return this.pixels[y * OLED_WIDTH + x] === 1
  }

  /** Cantidad de píxeles encendidos (pruebas y diagnóstico). */
  litCount(): number {
    let count = 0
    for (const value of this.pixels) count += value
    return count
  }

  clear(): void {
    this.pixels.fill(0)
    this.dirty = true
  }

  setFont(font: Font): void {
    this.font = font
  }

  textWidth(text: string): number {
    return this.rasterizer.width(text, this.font)
  }

  text(x: number, y: number, text: string, on: boolean): void {
    this.rasterizer.draw(this, x, y, text, this.font, on)
    this.dirty = true
  }

  box(x0: number, y0: number, x1: number, y1: number, on: boolean): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.setPixel(x, y, on)
  }

  frame(x0: number, y0: number, x1: number, y1: number, on: boolean): void {
    this.hLine(x0, x1, y0, on)
    this.hLine(x0, x1, y1, on)
    this.vLine(x0, y0, y1, on)
    this.vLine(x1, y0, y1, on)
  }

  roundedFrame(x0: number, y0: number, x1: number, y1: number, radius: number, on: boolean): void {
    const width = x1 - x0 + 1, height = y1 - y0 + 1
    // U8g2 exige que el radio quepa dentro del marco.
    const limit = Math.trunc((Math.min(width, height) - 2) / 2)
    const r = Math.max(0, Math.min(radius, limit))
    if (r === 0) {
      this.frame(x0, y0, x1, y1, on)
      return
    }
    const left = x0 + r, top = y0 + r, right = x1 - r, bottom = y1 - r
    this.circleQuadrants(left, top, r, 0b0010, on)
    this.circleQuadrants(right, top, r, 0b0001, on)
    this.circleQuadrants(left, bottom, r, 0b0100, on)
    this.circleQuadrants(right, bottom, r, 0b1000, on)
    this.hLine(left + 1, right - 1, y0, on)
    this.hLine(left + 1, right - 1, y1, on)
    this.vLine(x0, top + 1, bottom - 1, on)
    this.vLine(x1, top + 1, bottom - 1, on)
  }

  line(x0: number, y0: number, x1: number, y1: number, on: boolean): void {
    // Bresenham, extremos incluidos.
    let x = x0, y = y0
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
    let error = dx + dy
    for (;;) {
      this.setPixel(x, y, on)
      if (x === x1 && y === y1) break
      const twice = 2 * error
      if (twice >= dy) {
        error += dy
        x += sx
      }
      if (twice <= dx) {
        error += dx
        y += sy
      }
    }
  }

  ellipse(x0: number, y0: number, x1: number, y1: number, filled: boolean, on: boolean): void {
    const rx = Math.trunc((x1 - x0) / 2), ry = Math.trunc((y1 - y0) / 2)
    const cx = x0 + rx, cy = y0 + ry
    if (rx === ry) this.circle(cx, cy, rx, filled, on)
    else this.drawEllipse(cx, cy, rx, ry, filled, on)
  }

  private hLine(xa: number, xb: number, y: number, on: boolean): void {
    for (let x = Math.min(xa, xb); x <= Math.max(xa, xb); x++) this.setPixel(x, y, on)
  }

  private vLine(x: number, ya: number, yb: number, on: boolean): void {
    for (let y = Math.min(ya, yb); y <= Math.max(ya, yb); y++) this.setPixel(x, y, on)
  }

  /** Circunferencia o disco por punto medio, como drawCircle/drawDisc de U8g2. */
  private circle(cx: number, cy: number, radius: number, filled: boolean, on: boolean): void {
    let x = 0, y = radius, f = 1 - radius, ddx = 1, ddy = -2 * radius
    const plot = (px: number, py: number) => {
      if (filled) {
        this.vLine(cx + px, cy - py, cy + py, on)
        this.vLine(cx - px, cy - py, cy + py, on)
        this.vLine(cx + py, cy - px, cy + px, on)
        this.vLine(cx - py, cy - px, cy + px, on)
      } else {
        this.setPixel(cx + px, cy + py, on); this.setPixel(cx - px, cy + py, on)
        this.setPixel(cx + px, cy - py, on); this.setPixel(cx - px, cy - py, on)
        this.setPixel(cx + py, cy + px, on); this.setPixel(cx - py, cy + px, on)
        this.setPixel(cx + py, cy - px, on); this.setPixel(cx - py, cy - px, on)
      }
    }
    plot(x, y)
    while (x < y) {
      if (f >= 0) {
        y -= 1
        ddy += 2
        f += ddy
      }
      x += 1
      ddx += 2
      f += ddx
      plot(x, y)
    }
  }

  /** Cuartos de circunferencia: bit 0 arriba-derecha, 1 arriba-izquierda, 2 abajo-izquierda, 3 abajo-derecha. */
  private circleQuadrants(cx: number, cy: number, radius: number, mask: number, on: boolean): void {
    let x = 0, y = radius, f = 1 - radius, ddx = 1, ddy = -2 * radius
    const plot = (px: number, py: number) => {
      if (mask & 0b0001) { this.setPixel(cx + px, cy - py, on); this.setPixel(cx + py, cy - px, on) }
      if (mask & 0b0010) { this.setPixel(cx - px, cy - py, on); this.setPixel(cx - py, cy - px, on) }
      if (mask & 0b0100) { this.setPixel(cx - px, cy + py, on); this.setPixel(cx - py, cy + px, on) }
      if (mask & 0b1000) { this.setPixel(cx + px, cy + py, on); this.setPixel(cx + py, cy + px, on) }
    }
    plot(x, y)
    while (x < y) {
      if (f >= 0) {
        y -= 1
        ddy += 2
        f += ddy
      }
      x += 1
      ddx += 2
      f += ddx
      plot(x, y)
    }
  }

  /** Elipse por punto medio (dos regiones), contorno o rellena. */
  private drawEllipse(cx: number, cy: number, rx: number, ry: number, filled: boolean, on: boolean): void {
    const plot = (px: number, py: number) => {
      if (filled) {
        this.hLine(cx - px, cx + px, cy + py, on)
        this.hLine(cx - px, cx + px, cy - py, on)
      } else {
        this.setPixel(cx + px, cy + py, on); this.setPixel(cx - px, cy + py, on)
        this.setPixel(cx + px, cy - py, on); this.setPixel(cx - px, cy - py, on)
      }
    }
    const rx2 = rx * rx, ry2 = ry * ry
    let x = 0, y = ry
    let px = 0, py = 2 * rx2 * y
    let p = ry2 - rx2 * ry + 0.25 * rx2
    while (px < py) {
      plot(x, y)
      x += 1
      px += 2 * ry2
      if (p < 0) p += ry2 + px
      else {
        y -= 1
        py -= 2 * rx2
        p += ry2 + px - py
      }
    }
    p = ry2 * (x + 0.5) * (x + 0.5) + rx2 * (y - 1) * (y - 1) - rx2 * ry2
    while (y >= 0) {
      plot(x, y)
      y -= 1
      py -= 2 * rx2
      if (p > 0) p += rx2 - py
      else {
        x += 1
        px += 2 * ry2
        p += rx2 - py + px
      }
    }
  }
}

/**
 * Fuente de bloques determinista para pruebas y Node: 5 px por carácter en la
 * fuente chica y 7 en la grande, como el FakeCanvas del firmware. Cada glifo es un
 * patrón derivado del código del carácter; no pretende ser legible.
 */
export const FIXED_WIDTH_RASTERIZER: TextRasterizer = {
  width: (text, font) => [...text].length * (font === 'large' ? 7 : 5),
  draw(buffer, x, y, text, font, on) {
    const advance = font === 'large' ? 7 : 5
    const columns = advance - 1
    const rows = font === 'large' ? 9 : 7
    const top = y + (font === 'large' ? 1 : 2)
    let cursor = x
    for (const char of text) {
      const code = char.codePointAt(0) ?? 0
      if (char !== ' ') {
        let bits = Math.imul(code ^ 0x9e37, 0x85ebca6b) >>> 0
        for (let row = 0; row < rows; row++) {
          for (let column = 0; column < columns; column++) {
            const bit = (bits >>> ((row * columns + column) % 31)) & 1
            if (bit || row === 0 || column === 0) buffer.setPixel(cursor + column, top + row, on)
          }
          bits = Math.imul(bits ^ (bits >>> 13), 0x5bd1e995) >>> 0
        }
      }
      cursor += advance
    }
  },
}
