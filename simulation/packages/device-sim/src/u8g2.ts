// Texto de la OLED con las fuentes reales de U8g2, píxel por píxel como en la placa.
//
// Reproduce, a partir del formato documentado de U8g2 (u8g2_font.c, licencia BSD de
// dos cláusulas, © olikraus):
// - la decodificación de glifos comprimidos (u8g2_font_decode_glyph);
// - el dibujo de texto UTF-8 (u8g2_DrawUTF8) con referencia superior (setFontPosTop) y
//   modo transparente (setFontMode(1));
// - el ancho de texto (u8g2_GetUTF8Width) con el cálculo «balanceado» que U8g2 activa
//   por defecto (U8G2_BALANCED_STR_WIDTH_CALCULATION);
// - el desplazamiento vertical que agrega U8g2Canvas::text en display.cpp.
import type { Font } from './canvas.ts'
import { helvR08_tf, helvR10_tf } from './fonts/helvetica.ts'
import type { MonoFramebuffer, TextRasterizer } from './framebuffer.ts'

export interface U8g2Glyph {
  readonly width: number
  readonly height: number
  /** Desplazamiento del mapa de bits respecto del origen del glifo. */
  readonly x: number
  readonly y: number
  /** Avance horizontal hasta el glifo siguiente. */
  readonly advance: number
  /** 1 por píxel encendido, por filas (width × height). */
  readonly bits: Uint8Array
}

/** Encabezado de 23 bytes de una fuente U8g2 (u8g2_read_font_info). */
const HEADER = 23

function decodeBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** Lector de bits como u8g2_font_decode_get_unsigned_bits: LSB primero dentro de cada byte. */
class BitReader {
  private position: number
  private bit = 0
  private readonly data: Uint8Array

  constructor(data: Uint8Array, position: number) {
    this.data = data
    this.position = position
  }

  unsigned(count: number): number {
    let value = this.data[this.position] >> this.bit
    const end = this.bit + count
    if (end >= 8) {
      this.position++
      value |= (this.data[this.position] ?? 0) << (8 - this.bit)
      this.bit = end - 8
    } else {
      this.bit = end
    }
    return value & ((1 << count) - 1)
  }

  signed(count: number): number {
    return this.unsigned(count) - (1 << (count - 1))
  }
}

export class U8g2Font {
  /** Altura de la «A» sobre la línea base: referencia de setFontPosTop. */
  readonly ascentA: number
  private readonly glyphs = new Map<number, U8g2Glyph>()

  constructor(data: Uint8Array) {
    const int8 = (value: number) => (value > 127 ? value - 256 : value)
    const bitsPer0 = data[2], bitsPer1 = data[3]
    const bitsWidth = data[4], bitsHeight = data[5], bitsX = data[6], bitsY = data[7], bitsAdvance = data[8]
    this.ascentA = int8(data[13])
    // Glifos de 0 a 255: código, salto al siguiente y datos comprimidos.
    let offset = HEADER
    while (offset + 1 < data.length && data[offset + 1] !== 0) {
      const encoding = data[offset]
      const reader = new BitReader(data, offset + 2)
      const width = reader.unsigned(bitsWidth)
      const height = reader.unsigned(bitsHeight)
      const x = reader.signed(bitsX)
      const y = reader.signed(bitsY)
      const advance = reader.signed(bitsAdvance)
      const bits = new Uint8Array(width * height)
      if (width > 0) {
        // Corridas alternadas de fondo (a) y tinta (b); un bit 1 repite el mismo par.
        let pixel = 0
        const fill = (count: number, on: boolean) => {
          for (let index = 0; index < count && pixel < bits.length; index++) bits[pixel++] = on ? 1 : 0
        }
        while (pixel < bits.length) {
          const a = reader.unsigned(bitsPer0)
          const b = reader.unsigned(bitsPer1)
          do {
            fill(a, false)
            fill(b, true)
          } while (reader.unsigned(1) !== 0)
        }
      }
      this.glyphs.set(encoding, { width, height, x, y, advance, bits })
      offset += data[offset + 1]
    }
  }

  static fromBase64(text: string): U8g2Font {
    return new U8g2Font(decodeBase64(text))
  }

  glyph(codepoint: number): U8g2Glyph | null {
    return this.glyphs.get(codepoint) ?? null
  }

  /** u8g2_GetUTF8Width: suma de avances, ajustada al ancho real del último glifo. */
  width(text: string): number {
    let width = 0
    let advance = 0
    let lastWidth = 0
    let lastOffset = 0
    let initialOffset: number | null = null
    for (const char of text) {
      const glyph = this.glyph(char.codePointAt(0)!)
      if (!glyph) {
        // u8g2_GetGlyphWidth devuelve 0 y no toca el último glifo decodificado.
        advance = 0
        continue
      }
      advance = glyph.advance
      lastWidth = glyph.width
      lastOffset = glyph.x
      initialOffset ??= glyph.x
      width += advance
    }
    if (lastWidth !== 0) {
      width += lastWidth + lastOffset - advance
      if (initialOffset !== null && initialOffset > 0) width += initialOffset
    }
    return width
  }

  /** u8g2_DrawUTF8 con referencia superior: `top` es la fila de la referencia de la fuente. */
  draw(setPixel: (x: number, y: number) => void, x: number, top: number, text: string): void {
    const baseline = top + this.ascentA + 1
    let cursor = x
    for (const char of text) {
      const glyph = this.glyph(char.codePointAt(0)!)
      if (!glyph) continue
      const left = cursor + glyph.x
      const upper = baseline - (glyph.height + glyph.y)
      for (let row = 0; row < glyph.height; row++) {
        for (let column = 0; column < glyph.width; column++) {
          if (glyph.bits[row * glyph.width + column]) setPixel(left + column, upper + row)
        }
      }
      cursor += glyph.advance
    }
  }
}

/** Fuentes de display.cpp: helvR08 (pequeña) y helvR10 (grande). */
export const OLED_FONTS: Readonly<Record<Font, U8g2Font>> = {
  small: U8g2Font.fromBase64(helvR08_tf),
  large: U8g2Font.fromBase64(helvR10_tf),
}

/**
 * U8g2Canvas::text suma 2 px (pequeña) o 1 px (grande) a la fila pedida: el renderizador
 * conserva la disposición de la versión en Python, que ubicaba el texto por su caja.
 */
const TEXT_OFFSET: Readonly<Record<Font, number>> = { small: 2, large: 1 }

/** Rasterizador de texto idéntico al de la manilla real (fuentes y posición de U8g2). */
export const U8G2_RASTERIZER: TextRasterizer = {
  width: (text: string, font: Font) => OLED_FONTS[font].width(text),
  draw(buffer: MonoFramebuffer, x: number, y: number, text: string, font: Font, on: boolean) {
    OLED_FONTS[font].draw((px, py) => buffer.setPixel(px, py, on), x, y + TEXT_OFFSET[font], text)
  },
}
