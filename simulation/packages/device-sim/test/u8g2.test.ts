// Texto de la OLED con las fuentes reales de U8g2 (helvR08 y helvR10 de display.cpp).
import { describe, expect, it } from 'vitest'
import { MESSAGES, MonoFramebuffer, NOTICES, OLED_FONTS, PAGES, RecordingCanvas, U8G2_RASTERIZER, VirtualBracelet } from '../src/index.ts'

function rows(text: string, font: 'small' | 'large' = 'small'): string[] {
  const buffer = new MonoFramebuffer(U8G2_RASTERIZER)
  buffer.setFont(font)
  buffer.text(0, 0, text, true)
  const lines: string[] = []
  for (let y = 0; y < 18; y++) {
    let line = ''
    for (let x = 0; x < U8G2_RASTERIZER.width(text, font) + 2; x++) line += buffer.getPixel(x, y) ? '#' : '.'
    lines.push(line)
  }
  return lines
}

describe('fuentes U8g2 de la OLED', () => {
  it('lee el encabezado de helvR08 y helvR10', () => {
    expect(OLED_FONTS.small.ascentA).toBe(8)
    expect(OLED_FONTS.large.ascentA).toBe(11)
  })

  it('decodifica la E de helvR08 tal como la dibuja la placa', () => {
    const glyph = OLED_FONTS.small.glyph('E'.codePointAt(0)!)!
    const bitmap = Array.from({ length: glyph.height }, (_, y) => Array.from(glyph.bits.slice(y * glyph.width, (y + 1) * glyph.width)).map(bit => (bit ? '#' : '.')).join(''))
    expect(bitmap).toEqual(['#####', '#....', '#....', '#####', '#....', '#....', '#....', '#####'])
    expect(glyph.advance).toBe(7)
  })

  it('mide el texto como u8g2_GetUTF8Width con el cálculo balanceado', () => {
    // Valor documentado en u8g2.h para la «C» de helvR08.
    expect(U8G2_RASTERIZER.width('C', 'small')).toBe(8)
    expect(U8G2_RASTERIZER.width('', 'small')).toBe(0)
    expect(U8G2_RASTERIZER.width('Estado', 'small')).toBeGreaterThan(U8G2_RASTERIZER.width('Esta', 'small'))
  })

  it('ubica el texto como U8g2Canvas::text: 2 px más abajo con la fuente pequeña', () => {
    const lines = rows('E')
    // Referencia superior (y = 0) + 2 px de display.cpp + 1 px de setFontPosTop.
    expect(lines.findIndex(line => line.includes('#'))).toBe(3)
    expect(lines.findLastIndex(line => line.includes('#'))).toBe(10)
  })

  it('distingue «Estado» de «Estaco» (la d tiene su asta)', () => {
    expect(rows('Estado')).not.toEqual(rows('Estaco'))
    const d = OLED_FONTS.small.glyph('d'.codePointAt(0)!)!
    const c = OLED_FONTS.small.glyph('c'.codePointAt(0)!)!
    expect(d.height).toBeGreaterThan(c.height)
  })

  it('tiene todos los caracteres del menú, los mensajes y los avisos', () => {
    const texts = [...PAGES, ...MESSAGES.map(message => message.label), ...NOTICES.map(notice => notice.text), 'Precaución', 'Peligro', 'Objeto 104.5 °C', 'Ajustes ñ ¿? ¡!']
    const missing = new Set<string>()
    for (const text of texts) for (const char of text) {
      for (const font of ['small', 'large'] as const) if (!OLED_FONTS[font].glyph(char.codePointAt(0)!)) missing.add(char)
    }
    expect([...missing]).toEqual([])
  })

  it('la manilla dibuja su menú con las fuentes reales sin salirse de la pantalla', () => {
    const device = new VirtualBracelet({ environment: () => ({ coPpm: 2, ambientC: 18, objectC: 19 }), identity: { name: 'M', minerName: 'm', zone: 'z' }, seed: 5 })
    device.advance(3000)
    const buffer = new MonoFramebuffer(U8G2_RASTERIZER)
    device.render(buffer)
    expect(buffer.litCount()).toBeGreaterThan(300)
    const canvas = new RecordingCanvas()
    device.render(canvas)
    expect(canvas.hasText('Estado')).toBe(true)
  })
})
