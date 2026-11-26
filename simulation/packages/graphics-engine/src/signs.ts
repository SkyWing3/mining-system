// Señalización minera en español, dibujada en lienzo con desgaste (polvo, rayones, óxido).
// Colores de seguridad habituales: verde (condición segura), amarillo (advertencia),
// azul (obligación), rojo (prohibición). Son letreros didácticos del escenario ficticio.
import * as THREE from 'three'
import { mulberry32 } from '@twin/mine-generator'
import type { SignKind, SignSpec } from '@twin/shared-types'

export type { SignKind }
type SignLabel = NonNullable<SignSpec['label']>

const W = 768
const H = 512
const FONT = '"IBM Plex Sans Variable", "IBM Plex Sans", Arial, sans-serif'

interface SignDesign {
  readonly background: string
  readonly foreground: string
  readonly title: string
  readonly lines: readonly string[]
  readonly icon: (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) => void
}

/** Triángulo de advertencia (amarillo con borde negro) con un pictograma dentro. */
function warningTriangle(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, inner: () => void) {
  ctx.strokeStyle = color
  ctx.lineWidth = s * 0.09
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(x, y - s * 0.5)
  ctx.lineTo(x + s * 0.55, y + s * 0.44)
  ctx.lineTo(x - s * 0.55, y + s * 0.44)
  ctx.closePath()
  ctx.stroke()
  inner()
}

function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, direction: 1 | -1) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(direction, 1)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(-size * 0.5, -size * 0.14)
  ctx.lineTo(size * 0.1, -size * 0.14)
  ctx.lineTo(size * 0.1, -size * 0.34)
  ctx.lineTo(size * 0.5, 0)
  ctx.lineTo(size * 0.1, size * 0.34)
  ctx.lineTo(size * 0.1, size * 0.14)
  ctx.lineTo(-size * 0.5, size * 0.14)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

const DESIGNS: Record<SignKind, SignDesign> = {
  refuge: {
    background: '#0b7a3e', foreground: '#ffffff', title: 'REFUGIO MINERO', lines: ['Cámara de refugio', 'por el crucero'],
    icon: (ctx, x, y, s, color) => {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(x - s * 0.45, y + s * 0.4)
      ctx.lineTo(x - s * 0.45, y - s * 0.05)
      ctx.lineTo(x, y - s * 0.45)
      ctx.lineTo(x + s * 0.45, y - s * 0.05)
      ctx.lineTo(x + s * 0.45, y + s * 0.4)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#0b7a3e'
      ctx.fillRect(x - s * 0.12, y + s * 0.08, s * 0.24, s * 0.32)
      arrow(ctx, x + s * 1.05, y, s * 0.7, color, 1)
    },
  },
  exit: {
    background: '#0b7a3e', foreground: '#ffffff', title: 'SALIDA', lines: ['Hacia el socavón', 'y la bocamina'],
    icon: (ctx, x, y, s, color) => arrow(ctx, x + s * 0.3, y, s * 1.1, color, -1),
  },
  'caution-rail': {
    background: '#f2c300', foreground: '#111111', title: 'PRECAUCIÓN', lines: ['Tránsito de', 'locomotoras'],
    icon: (ctx, x, y, s, color) => {
      ctx.strokeStyle = color
      ctx.lineWidth = s * 0.09
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(x, y - s * 0.48)
      ctx.lineTo(x + s * 0.52, y + s * 0.42)
      ctx.lineTo(x - s * 0.52, y + s * 0.42)
      ctx.closePath()
      ctx.stroke()
      ctx.fillStyle = color
      ctx.fillRect(x - s * 0.045, y - s * 0.2, s * 0.09, s * 0.36)
      ctx.beginPath()
      ctx.arc(x, y + s * 0.28, s * 0.055, 0, Math.PI * 2)
      ctx.fill()
    },
  },
  ppe: {
    background: '#0a5aa3', foreground: '#ffffff', title: 'USO OBLIGATORIO', lines: ['Casco, lámpara', 'y autorrescatador'],
    icon: (ctx, x, y, s, color) => {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(x, y + s * 0.12, s * 0.42, Math.PI, 0)
      ctx.closePath()
      ctx.fill()
      ctx.fillRect(x - s * 0.55, y + s * 0.1, s * 1.1, s * 0.1)
      ctx.fillStyle = '#0a5aa3'
      ctx.beginPath()
      ctx.arc(x, y - s * 0.05, s * 0.09, 0, Math.PI * 2)
      ctx.fill()
    },
  },
  'no-smoking': {
    background: '#f4f1ea', foreground: '#111111', title: 'PROHIBIDO FUMAR', lines: ['y encender llamas', 'en interior mina'],
    icon: (ctx, x, y, s) => {
      ctx.fillStyle = '#3a3a3a'
      ctx.fillRect(x - s * 0.38, y - s * 0.06, s * 0.6, s * 0.13)
      ctx.fillStyle = '#c0582a'
      ctx.fillRect(x + s * 0.22, y - s * 0.06, s * 0.14, s * 0.13)
      ctx.strokeStyle = '#c8102e'
      ctx.lineWidth = s * 0.1
      ctx.beginPath()
      ctx.arc(x, y, s * 0.46, 0, Math.PI * 2)
      ctx.moveTo(x - s * 0.33, y - s * 0.33)
      ctx.lineTo(x + s * 0.33, y + s * 0.33)
      ctx.stroke()
    },
  },
  gas: {
    background: '#f2c300', foreground: '#111111', title: 'PELIGRO: GASES', lines: ['Ingreso solo con', 'detector de CO'],
    icon: (ctx, x, y, s, color) => warningTriangle(ctx, x, y, s, color, () => {
      // Nube de gas: tres círculos superpuestos.
      ctx.fillStyle = color
      for (const [dx, dy, r] of [[-0.16, 0.18, 0.13], [0.02, 0.1, 0.16], [0.18, 0.2, 0.12]] as const) {
        ctx.beginPath()
        ctx.arc(x + s * dx, y + s * dy, s * r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillRect(x - s * 0.28, y + s * 0.2, s * 0.56, s * 0.12)
    }),
  },
  'no-entry': {
    background: '#f4f1ea', foreground: '#111111', title: 'PROHIBIDO', lines: ['EL INGRESO', 'Labor abandonada'],
    icon: (ctx, x, y, s) => {
      ctx.strokeStyle = '#c8102e'
      ctx.lineWidth = s * 0.12
      ctx.beginPath()
      ctx.arc(x, y, s * 0.44, 0, Math.PI * 2)
      ctx.stroke()
      // Persona caminando.
      ctx.fillStyle = '#111111'
      ctx.beginPath()
      ctx.arc(x + s * 0.02, y - s * 0.24, s * 0.07, 0, Math.PI * 2)
      ctx.fill()
      ctx.lineWidth = s * 0.07
      ctx.strokeStyle = '#111111'
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(x, y - s * 0.12)
      ctx.lineTo(x - s * 0.04, y + s * 0.08)
      ctx.lineTo(x - s * 0.14, y + s * 0.28)
      ctx.moveTo(x - s * 0.04, y + s * 0.08)
      ctx.lineTo(x + s * 0.1, y + s * 0.28)
      ctx.moveTo(x - s * 0.14, y - s * 0.02)
      ctx.lineTo(x + s * 0.14, y - s * 0.06)
      ctx.stroke()
      ctx.strokeStyle = '#c8102e'
      ctx.lineWidth = s * 0.1
      ctx.beginPath()
      ctx.moveTo(x - s * 0.31, y - s * 0.31)
      ctx.lineTo(x + s * 0.31, y + s * 0.31)
      ctx.stroke()
    },
  },
  heat: {
    background: '#f2c300', foreground: '#111111', title: 'ALTA TEMPERATURA', lines: ['Agua termal y', 'roca caliente'],
    icon: (ctx, x, y, s, color) => warningTriangle(ctx, x, y, s, color, () => {
      // Termómetro.
      ctx.fillStyle = color
      ctx.fillRect(x - s * 0.045, y - s * 0.22, s * 0.09, s * 0.36)
      ctx.beginPath()
      ctx.arc(x, y + s * 0.2, s * 0.1, 0, Math.PI * 2)
      ctx.fill()
      for (let index = 0; index < 3; index++) ctx.fillRect(x + s * 0.07, y - s * 0.18 + index * s * 0.1, s * 0.08, s * 0.025)
    }),
  },
  direction: {
    background: '#1f3c2f', foreground: '#ffffff', title: '', lines: [],
    icon: () => undefined,
  },
  monitoring: {
    background: '#22313f', foreground: '#ffffff', title: 'ESTACIÓN DE', lines: ['MONITOREO', 'AMBIENTAL'],
    icon: (ctx, x, y, s, color) => {
      ctx.strokeStyle = color
      ctx.lineWidth = s * 0.08
      ctx.beginPath()
      ctx.arc(x, y + s * 0.15, s * 0.42, Math.PI * 1.1, Math.PI * 1.9)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(x, y + s * 0.15)
      ctx.lineTo(x + s * 0.24, y - s * 0.12)
      ctx.stroke()
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(x, y + s * 0.15, s * 0.07, 0, Math.PI * 2)
      ctx.fill()
    },
  },
}

/** Desgaste determinista por tipo de letrero: polvo, salpicaduras, rayones y bordes oxidados. */
function weather(ctx: CanvasRenderingContext2D, seed: number) {
  const random = mulberry32(seed)
  for (let index = 0; index < 1400; index++) {
    const x = random() * W, y = random() * H
    const r = random() * 2.2 + 0.3
    ctx.fillStyle = `rgba(${70 + random() * 40}, ${55 + random() * 30}, ${40 + random() * 20}, ${random() * 0.18})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  // Polvo acumulado en la parte baja.
  const dust = ctx.createLinearGradient(0, H * 0.55, 0, H)
  dust.addColorStop(0, 'rgba(90, 75, 58, 0)')
  dust.addColorStop(1, 'rgba(90, 75, 58, 0.32)')
  ctx.fillStyle = dust
  ctx.fillRect(0, 0, W, H)
  ctx.lineWidth = 1
  for (let index = 0; index < 28; index++) {
    ctx.strokeStyle = `rgba(230, 225, 215, ${0.08 + random() * 0.12})`
    ctx.beginPath()
    const x = random() * W, y = random() * H
    ctx.moveTo(x, y)
    ctx.lineTo(x + (random() - 0.5) * 120, y + (random() - 0.5) * 30)
    ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(110, 60, 30, 0.55)'
  ctx.lineWidth = 10
  ctx.strokeRect(5, 5, W - 10, H - 10)
}

/** Letrero de dirección: título grande, dos líneas y flecha hacia el lado indicado. */
function drawDirection(ctx: CanvasRenderingContext2D, design: SignDesign, label: SignLabel) {
  const right = label.arrow !== 'left'
  ctx.strokeStyle = design.foreground
  ctx.lineWidth = 10
  ctx.strokeRect(22, 22, W - 44, H - 44)
  if (label.arrow) arrow(ctx, right ? W * 0.8 : W * 0.2, H * 0.5, H * 0.42, design.foreground, right ? 1 : -1)
  const textX = label.arrow && !right ? W * 0.38 : W * 0.08
  const maxWidth = W * 0.6
  ctx.fillStyle = design.foreground
  ctx.textBaseline = 'middle'
  ctx.font = `700 70px ${FONT}`
  ctx.fillText(label.title, textX, H * 0.3, maxWidth)
  ctx.font = `500 46px ${FONT}`
  ;(label.lines ?? []).slice(0, 2).forEach((line, index) => ctx.fillText(line, textX, H * (0.55 + index * 0.17), maxWidth))
}

export function createSignTexture(kind: SignKind, seed: number, label?: SignLabel): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D no disponible.')
  const design = DESIGNS[kind]
  ctx.fillStyle = design.background
  ctx.fillRect(0, 0, W, H)
  if (kind === 'direction') {
    drawDirection(ctx, design, label ?? { title: '' })
    weather(ctx, seed)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    return texture
  }
  if (kind === 'no-smoking' || kind === 'no-entry') {
    ctx.strokeStyle = '#c8102e'
    ctx.lineWidth = 18
    ctx.strokeRect(24, 24, W - 48, H - 48)
  }
  design.icon(ctx, W * 0.23, H * 0.47, H * 0.48, design.foreground)
  ctx.fillStyle = design.foreground
  ctx.textBaseline = 'middle'
  const textX = kind === 'refuge' ? W * 0.56 : W * 0.44
  ctx.font = `700 ${kind === 'refuge' ? 50 : 58}px ${FONT}`
  ctx.fillText(design.title, textX, H * 0.3, W - textX - 30)
  ctx.font = `500 46px ${FONT}`
  design.lines.forEach((line, index) => ctx.fillText(line, textX, H * (0.52 + index * 0.17), W - textX - 30))
  weather(ctx, seed)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}
