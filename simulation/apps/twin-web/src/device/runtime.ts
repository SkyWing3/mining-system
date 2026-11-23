// Manilla simulada del minero: lógica portada del firmware (`@twin/device-sim`)
// alimentada por el modelo ambiental de la galería según la posición del minero.
//
// Todo lo que produce es simulado: las tramas llevan `"simulated": true` y la
// central que responde es local (no hay conexión con la central real).
import * as THREE from 'three'
import { create } from 'zustand'
import {
  MonoFramebuffer, VirtualBracelet,
  type Action, type Font, type FrameLogEntry, type Identity, type LedColor, type Level, type OutputLevels, type SensorSnapshot, type TextRasterizer,
} from '@twin/device-sim'
import { compileLayout } from '@twin/mine-generator'
import { MineEnvironment, type EnvironmentReading } from '@twin/mine-environment'
import type { GalleryLayout } from '@twin/shared-types'
import layoutJson from '../../../../config/galeria-validacion.json'
import { BRACELET_HEIGHT, miner } from '../scene/minerState.ts'

const layout = layoutJson as unknown as GalleryLayout

export type NoticeCode = 'EVACUATE' | 'SURFACE' | 'SHELTER' | 'HELP_COMING' | 'RECEIVED' | 'REPORT'
export const NOTICE_OPTIONS: readonly { code: NoticeCode; label: string }[] = [
  { code: 'EVACUATE', label: 'Evacuar ahora' },
  { code: 'SURFACE', label: 'Volver a superficie' },
  { code: 'SHELTER', label: 'Ir al refugio' },
  { code: 'HELP_COMING', label: 'Ayuda en camino' },
  { code: 'RECEIVED', label: 'Mensaje recibido' },
  { code: 'REPORT', label: 'Reporta tu estado' },
]

/** Identidad que devuelve la central simulada (asignación administrativa, no posición). */
export const IDENTITY: Identity = { name: 'Manilla 07 (simulada)', minerName: 'Minero simulado', zone: 'Galería principal N1' }

// --- OLED: framebuffer 1 bit → lienzo 128×64 compartido por la escena 3D y la interfaz ----

const FONTS: Record<Font, string> = {
  small: '9px Arial, "Liberation Sans", Helvetica, sans-serif',
  large: '12px Arial, "Liberation Sans", Helvetica, sans-serif',
}
/**
 * Línea base respecto de `y` (borde superior según el renderizador, como Pillow): U8g2 dibuja
 * la mayúscula 2 px (Helvetica 8) o 1 px (Helvetica 10) más abajo (`display.cpp`).
 */
const BASELINE: Record<Font, number> = { small: 9, large: 10 }
const GLYPH_HEIGHT: Record<Font, number> = { small: 12, large: 14 }
/** Umbral a 1 bit: más alto da trazos finos como los de la fuente de mapa de bits. */
const THRESHOLD = 160

interface Glyphs { readonly width: number; readonly height: number; readonly bits: Uint8Array }

/** Texto de la OLED rasterizado con Canvas 2D y umbral a 1 bit (aproxima las fuentes Helvetica de U8g2). */
class CanvasTextRasterizer implements TextRasterizer {
  private readonly canvas = document.createElement('canvas')
  private readonly ctx = this.canvas.getContext('2d', { willReadFrequently: true })!
  private readonly cache = new Map<string, Glyphs>()

  width(text: string, font: Font): number {
    this.ctx.font = FONTS[font]
    return Math.round(this.ctx.measureText(text).width)
  }

  draw(buffer: MonoFramebuffer, x: number, y: number, text: string, font: Font, on: boolean): void {
    const glyphs = this.glyphs(text, font)
    for (let j = 0; j < glyphs.height; j++) {
      for (let i = 0; i < glyphs.width; i++) if (glyphs.bits[j * glyphs.width + i]) buffer.setPixel(x + i, y + j, on)
    }
  }

  private glyphs(text: string, font: Font): Glyphs {
    const key = `${font}|${text}`
    const cached = this.cache.get(key)
    if (cached) return cached
    const width = Math.max(1, this.width(text, font) + 2)
    const height = GLYPH_HEIGHT[font]
    this.canvas.width = width
    this.canvas.height = height
    const ctx = this.ctx
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, height)
    ctx.font = FONTS[font]
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#fff'
    ctx.fillText(text, 0, BASELINE[font])
    const data = ctx.getImageData(0, 0, width, height).data
    const bits = new Uint8Array(width * height)
    for (let index = 0; index < bits.length; index++) bits[index] = data[index * 4] > THRESHOLD ? 1 : 0
    const glyphs = { width, height, bits }
    if (this.cache.size > 400) this.cache.clear()
    this.cache.set(key, glyphs)
    return glyphs
  }
}

export const oledCanvas = document.createElement('canvas')
oledCanvas.width = 128
oledCanvas.height = 64
export const oledTexture = new THREE.CanvasTexture(oledCanvas)
oledTexture.magFilter = THREE.NearestFilter
oledTexture.minFilter = THREE.LinearFilter
oledTexture.generateMipmaps = false
oledTexture.colorSpace = THREE.SRGBColorSpace

const framebuffer = new MonoFramebuffer(new CanvasTextRasterizer())
const oledContext = oledCanvas.getContext('2d')!
const oledImage = oledContext.createImageData(128, 64)
let lastPixels = new Uint8Array(0)

/** Copia el framebuffer al lienzo solo si cambió (como `Display::send` del firmware). */
function presentOled(): boolean {
  const pixels = framebuffer.pixels
  if (lastPixels.length === pixels.length && lastPixels.every((value, index) => value === pixels[index])) return false
  lastPixels = pixels.slice()
  const data = oledImage.data
  for (let index = 0; index < pixels.length; index++) {
    const o = index * 4
    // SSD1306 blanca: píxel encendido blanco azulado, apagado casi negro.
    if (pixels[index]) { data[o] = 222; data[o + 1] = 240; data[o + 2] = 255 } else { data[o] = 4; data[o + 1] = 7; data[o + 2] = 10 }
    data[o + 3] = 255
  }
  oledContext.putImageData(oledImage, 0, 0)
  oledTexture.needsUpdate = true
  return true
}

// --- simulación -------------------------------------------------------------------------

const environment = layout.environment ? new MineEnvironment(compileLayout(layout), layout.environment) : null
let simSeconds = 0
let reading: EnvironmentReading | null = null

function sampleEnvironment() {
  if (!environment) return { coPpm: 0, ambientC: 20, objectC: 22 }
  reading = environment.sample({ x: miner.position.x, y: miner.position.y + BRACELET_HEIGHT, z: miner.position.z }, simSeconds)
  return { coPpm: reading.coPpm, ambientC: reading.ambientC, objectC: reading.objectC }
}

const bracelet = new VirtualBracelet({ environment: sampleEnvironment, identity: IDENTITY, seed: 20261123 })

const NO_OUTPUTS: OutputLevels = { red: false, green: false, blue: false, buzzer: false, motor: false }

export interface DeviceView {
  readonly simSeconds: number
  readonly outputs: OutputLevels
  readonly led: LedColor
  readonly ledBlink: boolean
  readonly level: Level
  readonly conditions: readonly string[]
  readonly snapshot: SensorSnapshot | null
  readonly link: { configured: boolean; connected: boolean; identity: Identity | null; blocked: string }
  readonly pending: { messages: number; voices: number }
  /** Valores del modelo ambiental en la posición del minero (lo que «hay», no lo que mide la manilla). */
  readonly reading: EnvironmentReading | null
  readonly framesVersion: number
  readonly oledVersion: number
  readonly centralOnline: boolean
  readonly calibrated: boolean
  press: (action: Action) => void
  setCentralOnline: (online: boolean) => void
  sendNotice: (code: NoticeCode) => void
  spikeGas: () => void
  spikeHeat: () => void
  /** Nueva voladura en el frente F1 (reinicia los humos del escenario). */
  blast: () => void
  setCalibrated: (calibrated: boolean) => void
}

export const useDevice = create<DeviceView>(set => ({
  simSeconds: 0,
  outputs: NO_OUTPUTS,
  led: 'off',
  ledBlink: false,
  level: 'normal',
  conditions: [],
  snapshot: null,
  link: { configured: true, connected: false, identity: null, blocked: '' },
  pending: { messages: 0, voices: 0 },
  reading: null,
  framesVersion: 0,
  oledVersion: 0,
  centralOnline: true,
  calibrated: true,
  press: action => { bracelet.press(action); renderOled(); publish(true) },
  setCentralOnline: online => { bracelet.setCentralOnline(online); set({ centralOnline: online }) },
  sendNotice: code => bracelet.sendNotice(code),
  spikeGas: () => bracelet.spikeGas(),
  spikeHeat: () => bracelet.spikeHeat(),
  blast: () => environment?.restartSource('voladura-f1', simSeconds),
  setCalibrated: calibrated => { bracelet.setCalibrated(calibrated); set({ calibrated }) },
}))

/** Salidas físicas instantáneas de la manilla (LED, buzzer y motor) para la escena 3D. */
export function deviceOutputs(): OutputLevels {
  return bracelet.outputs()
}

export function deviceFrames(): readonly FrameLogEntry[] {
  return bracelet.frames()
}

let oledVersion = 0
function renderOled(): void {
  bracelet.render(framebuffer)
  if (presentOled()) oledVersion++
}

let lastPublish = -Infinity
function publish(force = false): void {
  const now = bracelet.nowMs
  if (!force && now - lastPublish < 150) return
  lastPublish = now
  const assessment = bracelet.assessment()
  useDevice.setState({
    simSeconds,
    outputs: bracelet.outputs(),
    led: bracelet.ledColor(),
    ledBlink: bracelet.ledBlink(),
    level: assessment.level,
    conditions: assessment.conditions.map(condition => condition.text()),
    snapshot: bracelet.snapshot(),
    link: bracelet.link(),
    pending: bracelet.pending(),
    reading,
    framesVersion: bracelet.framesVersion(),
    oledVersion,
  })
}

// --- buzzer: tono del buzzer activo (~2,7 kHz) con Web Audio --------------------------------

let audio: { context: AudioContext; gain: GainNode } | null = null
function ensureAudio(): void {
  if (audio || typeof AudioContext === 'undefined') return
  const context = new AudioContext()
  const oscillator = context.createOscillator()
  oscillator.type = 'square'
  oscillator.frequency.value = 2700
  const gain = context.createGain()
  gain.gain.value = 0
  oscillator.connect(gain).connect(context.destination)
  oscillator.start()
  audio = { context, gain }
}
// El navegador solo permite audio después de un gesto del usuario.
if (typeof window !== 'undefined') window.addEventListener('pointerdown', ensureAudio, { once: true })

let buzzing = false
function updateBuzzer(on: boolean): void {
  if (!audio || on === buzzing) return
  buzzing = on
  if (audio.context.state === 'suspended') void audio.context.resume()
  audio.gain.gain.setTargetAtTime(on ? 0.035 : 0, audio.context.currentTime, 0.004)
}

let oledTimer = 0
/** Avanza la manilla y el ambiente; se llama una vez por fotograma. */
export function stepDevice(deltaSeconds: number, sound: boolean): void {
  const delta = Math.min(Math.max(deltaSeconds, 0), 0.25)
  simSeconds += delta
  bracelet.advance(delta * 1000)
  oledTimer += delta
  if (oledTimer >= 0.1) {
    oledTimer = 0
    renderOled()
  }
  updateBuzzer(sound && bracelet.outputs().buzzer)
  publish()
}

// Primer fotograma de la OLED antes del primer muestreo.
renderOled()
