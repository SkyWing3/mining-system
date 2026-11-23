// Menú y pantalla (port de esp32-device/test/test_interface) y memoria de imagen.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS, emptySnapshot, FIXED_WIDTH_RASTERIZER, Assessment, Menu, MESSAGES, MESSAGES_PAGE, MonoFramebuffer, oledText,
  PAGE_COUNT, RecordingCanvas, Renderer, ThresholdEvaluator, transportEvent, utf8Length, utf8Prefix, VOICE_PAGE, type Action,
} from '../src/index.ts'

function press(menu: Menu, action: Action, times = 1): void {
  for (let i = 0; i < times; i++) menu.handle(action)
}

function draw(menu: Menu): RecordingCanvas {
  const canvas = new RecordingCanvas()
  new Renderer().render(menu, canvas)
  return canvas
}

describe('menú', () => {
  it('la vuelta y el desplazamiento mantienen visible la selección', () => {
    const menu = new Menu()
    press(menu, 'up')
    expect(menu.selected).toBe(PAGE_COUNT - 1)
    expect(menu.offset).toBe(PAGE_COUNT - Menu.VISIBLE_ROWS)
    press(menu, 'down')
    expect(menu.selected).toBe(0)
    expect(menu.offset).toBe(0)
    press(menu, 'down', 3)
    expect(menu.selected).toBe(3)
    expect(menu.offset).toBe(1)
  })

  it('cada página vuelve a la misma selección', () => {
    for (let index = 0; index < PAGE_COUNT; index++) {
      if (index === MESSAGES_PAGE || index === VOICE_PAGE) continue
      const menu = new Menu()
      press(menu, 'down', index)
      press(menu, 'enter')
      expect(menu.page).toBe(index)
      // Subir y bajar no hacen nada dentro de una página de detalle.
      press(menu, 'down')
      press(menu, 'enter')
      expect(menu.page).toBeNull()
      expect(menu.selected).toBe(index)
    }
  })

  it('la selección no envía hasta confirmar', () => {
    const menu = new Menu()
    press(menu, 'down', MESSAGES_PAGE)
    press(menu, 'enter')
    expect(menu.messageMode).toBe('choose')
    press(menu, 'down', 2)
    expect(menu.handle('enter')).toHaveLength(0)
    expect(menu.messageMode).toBe('confirm')
    const intents = menu.handle('enter')
    expect(intents).toEqual([{ type: 'send-message', code: 'COLLAPSE', noticeId: 0 }])
    expect(menu.messageMode).toBe('result')
    press(menu, 'enter')
    expect(menu.messageMode).toBe('choose')
  })

  it('cancelar nunca envía', () => {
    const menu = new Menu()
    press(menu, 'down', MESSAGES_PAGE)
    press(menu, 'enter')
    press(menu, 'enter')
    press(menu, 'down')
    expect(menu.handle('enter')).toHaveLength(0)
    expect(menu.messageMode).toBe('choose')
  })

  it('cada código se puede elegir y la última fila vuelve al menú', () => {
    MESSAGES.forEach((option, index) => {
      const menu = new Menu()
      press(menu, 'down', MESSAGES_PAGE)
      press(menu, 'enter')
      press(menu, 'down', index)
      press(menu, 'enter')
      expect(menu.handle('enter')[0].code).toBe(option.code)
    })
    const menu = new Menu()
    press(menu, 'down', MESSAGES_PAGE)
    press(menu, 'enter')
    press(menu, 'up')
    press(menu, 'enter')
    expect(menu.page).toBeNull()
  })

  it('una falla nunca afirma la entrega', () => {
    const menu = new Menu()
    menu.link.configured = true
    menu.messageFailed('Sin configurar')
    menu.transport(transportEvent('delivered', ''))
    expect(menu.deliveryStatus).toBe('Sin configurar')
    menu.messageQueued('abc')
    menu.transport(transportEvent('delivered', 'other'))
    expect(menu.deliveryStatus).toBe('Guardado en cola')
    menu.transport(transportEvent('delivered', 'abc'))
    expect(menu.deliveryStatus).toBe('Enviado a central')
  })

  it('flujo de la página de voz', () => {
    const menu = new Menu()
    press(menu, 'down', VOICE_PAGE)
    press(menu, 'enter')
    expect(menu.voiceMode).toBe('idle')
    expect(menu.handle('enter')[0].type).toBe('start-recording')
    menu.recordingStarted()
    expect(menu.handle('down')).toHaveLength(0)
    expect(menu.handle('enter')[0].type).toBe('stop-recording')
    menu.recordingFinished(4200)
    press(menu, 'down')
    expect(menu.handle('enter')[0].type).toBe('discard-voice')
    expect(menu.voiceMode).toBe('idle')
    press(menu, 'down')
    press(menu, 'enter')
    expect(menu.page).toBeNull()
  })
})

describe('pantalla', () => {
  it('los fotogramas cambian al navegar', () => {
    const menu = new Menu()
    const first = draw(menu)
    expect(first.hasText('MINING SYSTEM')).toBe(true)
    expect(first.hasText('1/6   ENTER: abrir')).toBe(true)
    press(menu, 'down')
    const second = draw(menu)
    expect(second.ops).not.toEqual(first.ops)
    expect(second.hasText('2/6')).toBe(true)
    // La fila elegida se dibuja invertida.
    expect(second.hasText('inv Gases')).toBe(true)
  })

  it('las lecturas en vivo cambian los fotogramas', () => {
    const menu = new Menu()
    press(menu, 'down')
    press(menu, 'enter')
    menu.monitor(emptySnapshot({ coVolts: 0.412, coState: 'uncalibrated' }), new Assessment())
    let canvas = draw(menu)
    expect(canvas.hasText('CO: 0.412 V')).toBe(true)
    expect(canvas.hasText('Sin calibrar (V)')).toBe(true)
    menu.monitor(emptySnapshot({ coVolts: 0.412, coPpm: 42, coState: 'ok' }), new Assessment())
    canvas = draw(menu)
    expect(canvas.hasText('CO: 42 ppm')).toBe(true)
    menu.monitor(emptySnapshot({ coVolts: 0.412, coState: 'warming', warmupRemaining: 95 }), new Assessment())
    expect(draw(menu).hasText('Calentando 1:35')).toBe(true)
  })

  it('el aviso y la alarma tienen prioridad', () => {
    const menu = new Menu()
    const evaluator = new ThresholdEvaluator({ ...DEFAULT_SETTINGS.alerts, confirmSamples: 1 })
    const snapshot = emptySnapshot({ coPpm: 260 })
    menu.monitor(snapshot, evaluator.update(snapshot))
    expect(menu.alarmVisible).toBe(true)
    const notice = { noticeId: 7, code: 'EVACUATE', text: 'Evacuar ahora por la galería norte', severity: 'critical' }
    expect(menu.receiveNotice(notice)).toBe(true)
    expect(menu.receiveNotice(notice)).toBe(false)
    let canvas = draw(menu)
    expect(canvas.hasText('AVISO URGENTE')).toBe(true)
    expect(canvas.hasText('galería')).toBe(true)
    expect(menu.handle('down')).toHaveLength(0)
    expect(menu.handle('enter')[0]).toMatchObject({ type: 'acknowledge-notice', noticeId: 7 })
    canvas = draw(menu)
    expect(canvas.hasText('PELIGRO')).toBe(true)
    expect(canvas.hasText('CO 260 ppm')).toBe(true)
    expect(menu.handle('enter')[0].type).toBe('silence-alarm')
    expect(menu.alarmVisible).toBe(false)
    expect(draw(menu).hasText('MINING SYSTEM')).toBe(true)
  })

  it('identidad y estado del enlace', () => {
    const menu = new Menu()
    menu.link.configured = true
    press(menu, 'up')
    press(menu, 'enter')
    let canvas = draw(menu)
    expect(canvas.hasText('AJUSTES')).toBe(true)
    expect(canvas.hasText('Manilla sin identificar')).toBe(true)
    expect(canvas.ops).toContain('ellipse 120,3,126,9')
    menu.transport(transportEvent('identity', '', '', { name: 'Manilla 01', minerName: 'Javier Mamani', zone: 'Galería norte' }))
    menu.transport(transportEvent('connected'))
    canvas = draw(menu)
    expect(canvas.hasText('Javier Mamani')).toBe(true)
    expect(canvas.hasText('Galería norte')).toBe(true)
    expect(canvas.ops).toContain('disc 120,3,126,9')
    if (menu.link.identity) menu.link.identity.minerName = null
    expect(draw(menu).hasText('Sin minero asignado')).toBe(true)
  })

  it('el texto de la OLED conserva Latin-1 y descarta el resto', () => {
    expect(oledText('Compañero 41.0 °C')).toBe('Compañero 41.0 °C')
    expect(oledText('“hola” — ok…')).toBe('"hola" - ok...')
    expect(oledText('Mina \u{1F600}')).toBe('Mina ')
    expect(utf8Prefix('Galería', 5)).toBe('Galer')
    expect(utf8Prefix('Galería', 6)).toBe('Galerí')
    expect(utf8Length('Galería')).toBe(7)
  })
})

describe('memoria de imagen 128x64', () => {
  it('dibuja con las coordenadas inclusivas del firmware y detecta cambios', () => {
    const buffer = new MonoFramebuffer(FIXED_WIDTH_RASTERIZER)
    const before = buffer.version
    buffer.box(2, 15, 119, 26, true)
    expect(buffer.getPixel(2, 15)).toBe(true)
    expect(buffer.getPixel(119, 26)).toBe(true)
    expect(buffer.getPixel(120, 26)).toBe(false)
    expect(buffer.litCount()).toBe(118 * 12)
    expect(buffer.version).toBe(before + 1)
    // Sin cambios no aumenta la versión.
    buffer.box(2, 15, 119, 26, true)
    expect(buffer.version).toBe(before + 1)
    buffer.clear()
    buffer.line(0, 12, 127, 12, true)
    expect(buffer.litCount()).toBe(128)
    buffer.ellipse(120, 3, 126, 9, true, true)
    expect(buffer.getPixel(123, 6)).toBe(true)
    // Fuera de la pantalla se recorta sin error.
    buffer.box(120, 60, 140, 70, true)
    expect(buffer.getPixel(127, 63)).toBe(true)
  })

  it('el renderizador produce un fotograma distinto en cada página', () => {
    const menu = new Menu()
    const buffer = new MonoFramebuffer(FIXED_WIDTH_RASTERIZER)
    const renderer = new Renderer()
    renderer.render(menu, buffer)
    const first = buffer.version
    expect(buffer.litCount()).toBeGreaterThan(200)
    menu.handle('down')
    renderer.render(menu, buffer)
    expect(buffer.version).toBe(first + 1)
    renderer.render(menu, buffer)
    expect(buffer.version).toBe(first + 1)
  })
})
