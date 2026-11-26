// Manilla simulada del minero: lógica portada del firmware (`@twin/device-sim`)
// alimentada por el modelo ambiental de la galería según la posición del minero.
//
// Todo lo que produce es simulado: las tramas llevan `"simulated": true` y la
// central que responde es local (no hay conexión con la central real). La cobertura
// Wi-Fi también es simulada: depende de dónde esté el minero respecto de las antenas.
import * as THREE from 'three'
import { create } from 'zustand'
import {
  MonoFramebuffer, U8G2_RASTERIZER, VirtualBracelet,
  type AccessPointSignal, type Action, type CentralMessage, type FrameLogEntry, type Identity, type LedColor, type Level, type OutputLevels, type SensorSnapshot,
  type WifiStatus,
} from '@twin/device-sim'
import { compileLayout } from '@twin/mine-generator'
import { MineEnvironment, RadioCoverage, type EnvironmentReading, type Location } from '@twin/mine-environment'
import { layout } from '../layout.ts'
import { BRACELET_HEIGHT, miner } from '../scene/minerState.ts'

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
export const IDENTITY: Identity = { name: 'Manilla 07 (simulada)', minerName: 'Minero simulado', zone: 'Galería principal N0' }

// --- OLED: framebuffer 1 bit → lienzo 128×64 compartido por la escena 3D y la interfaz ----
// El texto usa las mismas fuentes bitmap de U8g2 que la placa (helvR08 y helvR10):
// la pantalla del gemelo coincide píxel por píxel con la de la manilla real.

export const oledCanvas = document.createElement('canvas')
oledCanvas.width = 128
oledCanvas.height = 64
export const oledTexture = new THREE.CanvasTexture(oledCanvas)
oledTexture.magFilter = THREE.NearestFilter
oledTexture.minFilter = THREE.LinearFilter
oledTexture.generateMipmaps = false
oledTexture.colorSpace = THREE.SRGBColorSpace

const framebuffer = new MonoFramebuffer(U8G2_RASTERIZER)
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

/** Galería compilada que usan el ambiente, la cobertura y el mapa. */
export const mineCompiled = compileLayout(layout)
const environment = layout.environment ? new MineEnvironment(mineCompiled, layout.environment) : null
/** Cobertura de la red Wi-Fi subterránea; null si la mina no la define (cobertura total). */
export const radio = layout.network && environment ? new RadioCoverage(mineCompiled, layout.network, layout.barriers ?? []) : null
/** Fuentes transitorias (frentes de voladura) que se pueden reiniciar desde el panel. */
export const BLAST_SOURCES = (layout.environment?.sources ?? []).filter(source => source.halfLifeMinutes).map(source => ({ id: source.id, node: source.node, label: source.label }))

let simSeconds = 0
let reading: EnvironmentReading | null = null

/** Concentración actual de CO en cada fuente (ppm), para el mapa. */
export function sourceStrengths(): Record<string, number> {
  if (!environment) return {}
  return Object.fromEntries(environment.spec.sources.map(source => [source.id, environment.sourceStrength(source, simSeconds)]))
}

/** Ubicación de la manilla sobre la red de galerías (se recalcula solo si el minero se movió). */
let located: { x: number; y: number; z: number; location: Location } | null = null
function braceletLocation(): Location | null {
  if (!environment) return null
  const x = miner.position.x, y = miner.position.y + BRACELET_HEIGHT, z = miner.position.z
  if (!located || Math.abs(located.x - x) + Math.abs(located.y - y) + Math.abs(located.z - z) > 0.05) located = { x, y, z, location: environment.locate({ x, y, z }) }
  return located.location
}

function sampleEnvironment() {
  if (!environment) return { coPpm: 0, ambientC: 20, objectC: 22 }
  reading = environment.sample({ x: miner.position.x, y: miner.position.y + BRACELET_HEIGHT, z: miner.position.z }, simSeconds)
  return { coPpm: reading.coPpm, ambientC: reading.ambientC, objectC: reading.objectC }
}

/** Lo que la antena de la manilla recibe de cada punto de acceso en su posición actual. */
function scanRadio(): readonly AccessPointSignal[] {
  const location = braceletLocation()
  return radio && location ? radio.sample(location).signals : []
}

const bracelet = new VirtualBracelet({ environment: sampleEnvironment, identity: IDENTITY, seed: 20261123, radio: radio ? scanRadio : undefined })

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
  /** Radio Wi-Fi de la manilla; null con cobertura total. */
  readonly wifi: WifiStatus | null
  /** Lo que sabe la central simulada de la manilla (presencia como `PresenceWindowSeconds`). */
  readonly central: { readonly lastSeenAt: number | null; readonly serverTime: number; readonly deviceOnline: boolean }
  /** Últimos mensajes registrados por la central, con su hora de envío y de recepción. */
  readonly recentMessages: readonly CentralMessage[]
  /** Puntos de acceso puestos fuera de servicio desde el panel. */
  readonly disabledAccessPoints: ReadonlySet<string>
  /** Valores del modelo ambiental en la posición del minero (lo que «hay», no lo que mide la manilla). */
  readonly reading: EnvironmentReading | null
  readonly framesVersion: number
  readonly oledVersion: number
  readonly centralOnline: boolean
  readonly calibrated: boolean
  /** Último pulsador presionado (por un instante), para resaltar el botón del panel. */
  readonly pressedAction: Action | null
  press: (action: Action) => void
  setCentralOnline: (online: boolean) => void
  sendNotice: (code: NoticeCode) => void
  spikeGas: () => void
  spikeHeat: () => void
  /** Nueva voladura en un frente (reinicia los humos de esa fuente). */
  blast: (sourceId: string) => void
  setCalibrated: (calibrated: boolean) => void
  /** Falla o restablecimiento de un punto de acceso Wi-Fi. */
  toggleAccessPoint: (id: string) => void
}

let pressedTimer: ReturnType<typeof setTimeout> | undefined

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
  wifi: null,
  central: { lastSeenAt: null, serverTime: 0, deviceOnline: false },
  recentMessages: [],
  disabledAccessPoints: new Set<string>(),
  reading: null,
  framesVersion: 0,
  oledVersion: 0,
  centralOnline: true,
  calibrated: true,
  pressedAction: null,
  press: action => {
    bracelet.press(action)
    renderOled()
    publish(true)
    set({ pressedAction: action })
    clearTimeout(pressedTimer)
    pressedTimer = setTimeout(() => set({ pressedAction: null }), 160)
  },
  setCentralOnline: online => { bracelet.setCentralOnline(online); set({ centralOnline: online }) },
  sendNotice: code => bracelet.sendNotice(code),
  spikeGas: () => bracelet.spikeGas(),
  spikeHeat: () => bracelet.spikeHeat(),
  blast: sourceId => environment?.restartSource(sourceId, simSeconds),
  setCalibrated: calibrated => { bracelet.setCalibrated(calibrated); set({ calibrated }) },
  toggleAccessPoint: id => {
    if (!radio) return
    radio.setEnabled(id, !radio.isEnabled(id))
    set({ disabledAccessPoints: new Set(radio.accessPoints.filter(ap => !radio.isEnabled(ap.id)).map(ap => ap.id)) })
  },
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
  const central = bracelet.centralView()
  useDevice.setState({
    wifi: bracelet.wifiStatus(),
    central: { lastSeenAt: central.lastSeenAt, serverTime: central.serverTime, deviceOnline: central.deviceOnline },
    recentMessages: central.messages.slice(-4),
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
