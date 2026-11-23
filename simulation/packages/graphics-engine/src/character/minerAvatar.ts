// Minero controlable: modelo procedural articulado y animación de marcha.
//
// El modelo se arma con primitivas suaves (tornos, cápsulas y cajas redondeadas)
// sobre una jerarquía de articulaciones; no usa recursos externos. Equipo de
// protección: overol de alta visibilidad con cintas reflectivas, casco con lámpara
// minera, lentes, respirador de media cara con filtros, guantes de cuero, botas de
// goma, cinturón con batería de la lámpara y autorrescatador, y la manilla del
// proyecto (ESP32-S3) en la muñeca izquierda.
//
// Convenciones: metros, +Y arriba, el minero mira hacia −Z (como la cámara con
// guiñada 0) y el origen está entre los pies, a nivel del piso.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { withLampLighting } from '../materials/lampLighting.ts'

export interface MinerPose {
  /** Velocidad horizontal medida (m/s). */
  readonly speed: number
  readonly running: boolean
  /** Giro de la cabeza respecto del cuerpo (rad, + a la izquierda) y cabeceo (+ arriba). */
  readonly lookYaw: number
  readonly lookPitch: number
  /** Levantar la muñeca para mirar la manilla (0..1). */
  readonly checkBracelet: number
}

interface Joints {
  readonly hips: THREE.Group
  readonly spine: THREE.Group
  readonly neck: THREE.Group
  readonly head: THREE.Group
  readonly shoulderL: THREE.Group
  readonly elbowL: THREE.Group
  readonly shoulderR: THREE.Group
  readonly elbowR: THREE.Group
  readonly hipL: THREE.Group
  readonly kneeL: THREE.Group
  readonly ankleL: THREE.Group
  readonly hipR: THREE.Group
  readonly kneeR: THREE.Group
  readonly ankleR: THREE.Group
}

const HIP_HEIGHT = 0.95
const THIGH = 0.42
const SHIN = 0.39
const UPPER_ARM = 0.29
const FOREARM = 0.25

/** Perfil de torno con extremos semiesféricos: cápsula cónica que cuelga desde y = 0. */
function limbGeometry(length: number, top: number, bottom: number, radial = 18): THREE.LatheGeometry {
  const points: THREE.Vector2[] = []
  const caps = 6
  for (let i = 0; i <= caps; i++) {
    const a = -Math.PI / 2 + (i / caps) * (Math.PI / 2)
    points.push(new THREE.Vector2(Math.max(bottom * Math.cos(a), 1e-4), -length + bottom * Math.sin(a)))
  }
  for (let i = 1; i <= 4; i++) {
    const t = i / 5
    // Ligero abultamiento muscular en el primer tercio.
    const r = bottom + (top - bottom) * t + Math.sin(t * Math.PI) * (top + bottom) * 0.06
    points.push(new THREE.Vector2(r, -length + length * t))
  }
  for (let i = 0; i <= caps; i++) {
    const a = (i / caps) * (Math.PI / 2)
    points.push(new THREE.Vector2(Math.max(top * Math.cos(a), 1e-4), top * Math.sin(a)))
  }
  return new THREE.LatheGeometry(points, radial)
}

function lathe(profile: readonly [number, number][], radial = 28): THREE.LatheGeometry {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), radial)
}

/** Banda delgada que rodea un miembro (cinta reflectiva, puño, cinturón). */
function band(radius: number, height: number, radial = 24): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(radius, radius, height, radial, 1, true)
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, position?: [number, number, number], rotation?: [number, number, number], scale?: [number, number, number]): THREE.Mesh {
  const object = new THREE.Mesh(geometry, material)
  if (position) object.position.set(...position)
  if (rotation) object.rotation.set(...rotation)
  if (scale) object.scale.set(...scale)
  parent.add(object)
  return object
}

function joint(parent: THREE.Object3D, x: number, y: number, z = 0): THREE.Group {
  const group = new THREE.Group()
  group.position.set(x, y, z)
  parent.add(group)
  return group
}

/**
 * Mapa normal procedural de tela de sarga con arrugas suaves (sin recursos externos).
 * La altura combina el tejido diagonal fino y pliegues de baja frecuencia.
 */
function fabricNormalTexture(): THREE.CanvasTexture {
  const size = 128
  const height = new Float32Array(size * size)
  let seed = 7
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const folds = Array.from({ length: 5 }, () => ({ k: 1 + Math.floor(random() * 3), phase: random() * 6.28, slope: (random() - 0.5) * 2, amp: 0.25 + random() * 0.35 }))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size
      // Sarga: diagonales finas (16 hilos por repetición).
      let h = 0.18 * Math.sin((u + v) * Math.PI * 2 * 16) + 0.08 * Math.sin((u - v) * Math.PI * 2 * 32)
      for (const fold of folds) h += fold.amp * Math.sin((v + fold.slope * u) * Math.PI * 2 * fold.k + fold.phase)
      height[y * size + x] = h + (random() - 0.5) * 0.06
    }
  }
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(size, size)
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 1.2
      const dy = (at(x, y + 1) - at(x, y - 1)) * 1.2
      const length = Math.hypot(dx, dy, 1)
      const o = (y * size + x) * 4
      image.data[o] = ((-dx / length) * 0.5 + 0.5) * 255
      image.data[o + 1] = ((dy / length) * 0.5 + 0.5) * 255
      image.data[o + 2] = ((1 / length) * 0.5 + 0.5) * 255
      image.data[o + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(3, 5)
  texture.colorSpace = THREE.NoColorSpace
  return texture
}

/** Materiales compartidos por el minero y su brazo en primera persona. */
interface AvatarMaterials {
  readonly coverall: THREE.MeshStandardMaterial
  readonly coverallDirty: THREE.MeshStandardMaterial
  readonly tape: THREE.MeshStandardMaterial
  readonly leather: THREE.MeshStandardMaterial
  readonly steel: THREE.MeshStandardMaterial
  readonly caseMaterial: THREE.MeshStandardMaterial
  readonly strap: THREE.MeshStandardMaterial
  readonly oled: THREE.MeshBasicMaterial
  readonly led: THREE.MeshBasicMaterial
}

/**
 * Manilla: carcasa 52 × 42 × 16 mm, OLED de 0,96" (21,7 × 10,9 mm de área activa), LED RGB y
 * tres pulsadores. Ejes: X hacia el codo, Y hacia afuera (cara de la pantalla), Z a través
 * de la muñeca; la pantalla se lee con el antebrazo cruzado frente al pecho.
 */
function buildBracelet(parent: THREE.Object3D, materials: AvatarMaterials): THREE.Group {
  const bracelet = new THREE.Group()
  parent.add(bracelet)
  mesh(new RoundedBoxGeometry(0.052, 0.016, 0.042, 3, 0.005), materials.caseMaterial, bracelet, [0, 0.006, 0])
  const screen = mesh(new THREE.PlaneGeometry(0.0272, 0.0136), materials.oled, bracelet, [0.003, 0.01425, 0])
  screen.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)))
  screen.name = 'manilla-oled'
  mesh(new THREE.SphereGeometry(0.0019, 12, 8), materials.led, bracelet, [-0.02, 0.0137, 0.013], undefined, [1, 0.6, 1])
  // Pulsadores subir, bajar y enter en el canto.
  for (let i = 0; i < 3; i++) mesh(new THREE.CylinderGeometry(0.0032, 0.0032, 0.004, 12), materials.steel, bracelet, [0.012 - i * 0.012, 0.006, 0.0215], [Math.PI / 2, 0, 0])
  return bracelet
}

/** Sombra de contacto: el minero no proyecta sombra de las luminarias (iluminación horneada). */
function contactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(0,0,0,0.85)')
  gradient.addColorStop(0.45, 'rgba(0,0,0,0.45)')
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(canvas)
}

export interface MinerAvatarOptions {
  /** Luminarias que iluminan al minero (perfil gráfico). */
  readonly lampPool: number
  /** Pantalla OLED de la manilla (128×64). */
  readonly oledTexture: THREE.Texture
}

export class MinerAvatar {
  readonly root = new THREE.Group()
  /** Punto y orientación de la lámpara del casco (mira hacia −Z local). */
  readonly lampAnchor = new THREE.Object3D()
  /** Punto entre los ojos (primera persona). */
  readonly eyeAnchor = new THREE.Object3D()
  /** Centro de la pantalla de la manilla. */
  readonly braceletAnchor = new THREE.Object3D()
  private readonly joints: Joints
  private readonly headParts: THREE.Object3D[] = []
  private readonly materials: THREE.Material[] = []
  private readonly geometries = new Set<THREE.BufferGeometry>()
  private readonly lens: THREE.MeshBasicMaterial
  private readonly led: THREE.MeshBasicMaterial
  private readonly shadowTexture: THREE.CanvasTexture
  private readonly fabricTexture: THREE.CanvasTexture
  private readonly shared: AvatarMaterials
  readonly contactShadow: THREE.Mesh
  /** Antebrazo con la manilla frente a la cámara (primera persona). */
  readonly viewmodel = new THREE.Group()
  private phase = 0
  private gait = 0
  private time = 0
  private check = 0

  constructor(options: MinerAvatarOptions) {
    const lit = (parameters: THREE.MeshStandardMaterialParameters) => {
      const material = withLampLighting(new THREE.MeshStandardMaterial(parameters), options.lampPool, false)
      this.materials.push(material)
      return material
    }
    // Colores en sRGB (como se eligen en una paleta); three los convierte a lineal.
    this.fabricTexture = fabricNormalTexture()
    const fabric = { normalMap: this.fabricTexture, normalScale: new THREE.Vector2(0.55, 0.55) }
    const coverall = lit({ color: new THREE.Color('#c25a22'), roughness: 0.9, ...fabric })
    const coverallDirty = lit({ color: new THREE.Color('#7b4a2c'), roughness: 0.94, ...fabric })
    const tape = lit({ color: new THREE.Color('#aeb1b0'), roughness: 0.38, metalness: 0.45 })
    const helmet = lit({ color: new THREE.Color('#d9a21b'), roughness: 0.34 })
    const skin = lit({ color: new THREE.Color('#8a5a40'), roughness: 0.62 })
    const hair = lit({ color: new THREE.Color('#1b1410'), roughness: 0.85 })
    const leather = lit({ color: new THREE.Color('#86643f'), roughness: 0.82 })
    const rubber = lit({ color: new THREE.Color('#151515'), roughness: 0.42 })
    const mud = lit({ color: new THREE.Color('#3d2e21'), roughness: 0.96 })
    const dark = lit({ color: new THREE.Color('#222224'), roughness: 0.55, metalness: 0.2 })
    const steel = lit({ color: new THREE.Color('#8e8e8a'), roughness: 0.35, metalness: 0.85 })
    const filter = lit({ color: new THREE.Color('#9b2b66'), roughness: 0.5 })
    const glasses = lit({ color: new THREE.Color('#121416'), roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.55 })
    const caseMaterial = lit({ color: new THREE.Color('#1c1c1f'), roughness: 0.42 })
    const strap = lit({ color: new THREE.Color('#121212'), roughness: 0.7 })
    this.lens = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0) })
    this.led = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0) })
    const oled = new THREE.MeshBasicMaterial({ map: options.oledTexture, color: new THREE.Color(1.5, 1.6, 1.7) })
    this.materials.push(this.lens, this.led, oled)
    this.shared = { coverall, coverallDirty, tape, leather, steel, caseMaterial, strap, oled, led: this.led }

    const root = this.root
    root.name = 'minero'

    // --- pelvis y piernas ---------------------------------------------------
    const hips = joint(root, 0, HIP_HEIGHT)
    mesh(lathe([[0, -0.13], [0.13, -0.11], [0.165, -0.04], [0.162, 0.04], [0.15, 0.1], [0, 0.1]]), coverall, hips, undefined, undefined, [1, 1, 0.72])
    mesh(band(0.166, 0.05), dark, hips, [0, 0.05, 0], undefined, [1, 1, 0.74])
    mesh(new RoundedBoxGeometry(0.05, 0.04, 0.012, 2, 0.004), steel, hips, [0, 0.05, -0.124])
    // Batería de la lámpara (atrás, a la derecha) y autorrescatador (atrás, a la izquierda).
    mesh(new RoundedBoxGeometry(0.13, 0.095, 0.05, 3, 0.012), dark, hips, [0.07, 0.03, 0.138])
    mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.15, 20), steel, hips, [-0.1, 0.02, 0.118], [0, 0, Math.PI / 2])
    mesh(band(0.048, 0.03), dark, hips, [-0.1, 0.02, 0.118], [0, 0, Math.PI / 2])

    const legs = ([-1, 1] as const).map(side => {
      const hip = joint(hips, side * 0.09, -0.06)
      mesh(limbGeometry(THIGH, 0.078, 0.058), coverall, hip)
      mesh(band(0.07, 0.045), tape, hip, [0, -0.3, 0])
      const knee = joint(hip, 0, -THIGH)
      mesh(limbGeometry(SHIN, 0.056, 0.042), coverallDirty, knee)
      // Bota de goma hasta media pierna.
      mesh(lathe([[0.0, -SHIN - 0.01], [0.058, -SHIN], [0.062, -SHIN + 0.1], [0.066, -0.1], [0.07, -0.06], [0.064, -0.055]]), rubber, knee)
      const ankle = joint(knee, 0, -SHIN)
      mesh(new RoundedBoxGeometry(0.105, 0.085, 0.28, 3, 0.035), rubber, ankle, [0, -0.04, -0.055])
      mesh(new RoundedBoxGeometry(0.11, 0.022, 0.29, 2, 0.01), mud, ankle, [0, -0.072, -0.055])
      return { hip, knee, ankle }
    })

    // --- torso ----------------------------------------------------------------
    const spine = joint(hips, 0, 0.08)
    mesh(lathe([[0, -0.12], [0.15, -0.11], [0.156, 0], [0.163, 0.12], [0.178, 0.25], [0.187, 0.33], [0.182, 0.38], [0.15, 0.425], [0.09, 0.452], [0.05, 0.46], [0, 0.462]]), coverall, spine, undefined, undefined, [1, 1, 0.64])
    // Cintas reflectivas: banda horizontal y tirantes en X sobre la espalda.
    mesh(band(0.168, 0.05, 32), tape, spine, [0, 0.1, 0], undefined, [1, 1, 0.66])
    for (const side of [-1, 1]) {
      mesh(new THREE.BoxGeometry(0.045, 0.36, 0.006), tape, spine, [side * 0.055, 0.27, 0.123], [-0.12, 0, side * 0.42])
      mesh(new THREE.BoxGeometry(0.045, 0.2, 0.006), tape, spine, [side * 0.075, 0.33, -0.118], [0.15, 0, 0])
    }
    // Bolsillo del pecho y cable de la lámpara por la espalda.
    mesh(new RoundedBoxGeometry(0.11, 0.1, 0.02, 2, 0.006), coverallDirty, spine, [-0.075, 0.27, -0.112])
    const cable = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.07, -0.05, 0.15), new THREE.Vector3(0.05, 0.12, 0.135), new THREE.Vector3(0.02, 0.32, 0.125), new THREE.Vector3(0, 0.47, 0.09), new THREE.Vector3(0, 0.6, 0.11),
    ])
    mesh(new THREE.TubeGeometry(cable, 24, 0.007, 6), dark, spine)

    // --- cabeza y casco -----------------------------------------------------------
    const neck = joint(spine, 0, 0.45)
    const neckMesh = mesh(new THREE.CylinderGeometry(0.048, 0.054, 0.12, 16), skin, neck, [0, 0.04, 0])
    const head = joint(neck, 0, 0.09)
    const headGroup = new THREE.Group()
    head.add(headGroup)
    mesh(new THREE.SphereGeometry(0.1, 24, 18), skin, headGroup, [0, 0.07, 0], undefined, [0.86, 1.08, 1])
    // Respirador de media cara con dos filtros.
    mesh(new THREE.SphereGeometry(0.068, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), dark, headGroup, [0, 0.025, -0.06], [-Math.PI / 2 - 0.25, 0, 0], [0.95, 0.8, 0.7])
    for (const side of [-1, 1]) mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.022, 20), filter, headGroup, [side * 0.06, 0.02, -0.085], [Math.PI / 2, 0, side * 0.75])
    // Lentes de seguridad.
    mesh(new THREE.CylinderGeometry(0.094, 0.094, 0.034, 28, 1, true, -Math.PI * 0.42, Math.PI * 0.84), glasses, headGroup, [0, 0.095, -0.012], [0, Math.PI, 0], [1, 1, 1.02])
    // Pelo corto en la nuca, bajo el casco.
    mesh(new THREE.SphereGeometry(0.103, 20, 12, 0, Math.PI, 0, Math.PI * 0.6), hair, headGroup, [0, 0.072, 0.004], undefined, [0.89, 1.08, 1.02])
    // Casco: casquete, ala y nervio.
    mesh(new THREE.SphereGeometry(0.125, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), helmet, headGroup, [0, 0.085, 0], undefined, [0.95, 1, 1.12])
    mesh(lathe([[0.112, 0.004], [0.142, -0.002], [0.147, -0.012], [0.112, -0.008]], 40), helmet, headGroup, [0, 0.09, 0], undefined, [0.93, 1, 1.15])
    mesh(new THREE.BoxGeometry(0.022, 0.012, 0.22), helmet, headGroup, [0, 0.206, 0.005])
    // Lámpara minera en el soporte frontal del casco.
    const lamp = new THREE.Group()
    lamp.position.set(0, 0.125, -0.15)
    headGroup.add(lamp)
    mesh(new THREE.CylinderGeometry(0.031, 0.027, 0.04, 24), dark, lamp, [0, 0, -0.012], [Math.PI / 2, 0, 0])
    mesh(new THREE.CircleGeometry(0.026, 24), this.lens, lamp, [0, 0, -0.0325], [0, Math.PI, 0])
    mesh(new THREE.BoxGeometry(0.03, 0.03, 0.012), dark, lamp, [0, -0.012, 0.006])
    this.lampAnchor.position.set(0, 0, -0.04)
    lamp.add(this.lampAnchor)
    this.eyeAnchor.position.set(0, 0.085, -0.07)
    head.add(this.eyeAnchor)
    this.headParts.push(headGroup, neckMesh)

    // --- brazos -----------------------------------------------------------------
    const arms = ([-1, 1] as const).map(side => {
      const shoulder = joint(spine, side * 0.205, 0.37)
      mesh(new THREE.SphereGeometry(0.062, 18, 12), coverall, shoulder, [0, -0.01, 0])
      mesh(limbGeometry(UPPER_ARM, 0.056, 0.045), coverall, shoulder)
      const elbow = joint(shoulder, 0, -UPPER_ARM)
      mesh(limbGeometry(FOREARM, 0.045, 0.036), coverall, elbow)
      mesh(band(0.047, 0.04), tape, elbow, [0, -0.07, 0])
      // Guante de cuero: palma, dedos y pulgar.
      const hand = joint(elbow, 0, -FOREARM)
      mesh(band(0.042, 0.05), leather, hand, [0, 0.01, 0])
      mesh(new RoundedBoxGeometry(0.036, 0.09, 0.082, 3, 0.014), leather, hand, [0, -0.05, 0])
      mesh(new RoundedBoxGeometry(0.034, 0.06, 0.078, 3, 0.014), leather, hand, [side * -0.006, -0.11, 0], [0, 0, side * -0.25])
      mesh(limbGeometry(0.05, 0.015, 0.013, 10), leather, hand, [side * -0.012, -0.03, -0.035], [0.7, 0, side * -0.3])
      return { shoulder, elbow }
    })

    // --- manilla en la muñeca izquierda (cara dorsal) ----------------------------------
    const leftElbow = arms[0].elbow
    mesh(band(0.041, 0.024, 28), strap, leftElbow, [0, -0.2, 0])
    const bracelet = buildBracelet(leftElbow, this.shared)
    bracelet.position.set(-0.044, -0.2, 0)
    bracelet.rotation.set(0, 0, Math.PI / 2)
    this.braceletAnchor.position.set(0.003, 0.016, 0)
    bracelet.add(this.braceletAnchor)

    // --- sombra de contacto ---------------------------------------------------------
    this.shadowTexture = contactShadowTexture()
    const shadowMaterial = new THREE.MeshBasicMaterial({ map: this.shadowTexture, transparent: true, depthWrite: false, opacity: 0.75, polygonOffset: true, polygonOffsetFactor: -2 })
    this.materials.push(shadowMaterial)
    this.contactShadow = mesh(new THREE.PlaneGeometry(0.95, 0.95), shadowMaterial, root, [0, 0.015, 0], [-Math.PI / 2, 0, 0])
    this.contactShadow.renderOrder = 1
    this.buildViewmodel()

    this.joints = {
      hips, spine, neck, head,
      shoulderL: arms[0].shoulder, elbowL: arms[0].elbow, shoulderR: arms[1].shoulder, elbowR: arms[1].elbow,
      hipL: legs[0].hip, kneeL: legs[0].knee, ankleL: legs[0].ankle, hipR: legs[1].hip, kneeR: legs[1].knee, ankleR: legs[1].ankle,
    }
    root.traverse(object => {
      if (object instanceof THREE.Mesh) {
        this.geometries.add(object.geometry)
        object.castShadow = false
        object.receiveShadow = false
      }
    })
    this.update(0, { speed: 0, running: false, lookYaw: 0, lookPitch: 0, checkBracelet: 0 })
  }

  /** Cuánto está levantada la muñeca para mirar la manilla (0..1, suavizado). */
  checkAmount(): number {
    const c = this.check
    return c * c * (3 - 2 * c)
  }

  /**
   * Antebrazo izquierdo con guante y manilla para la primera persona, en coordenadas de un
   * marco cuyo +X va del codo a la mano y cuyo +Z mira hacia los ojos.
   */
  private buildViewmodel(): void {
    const m = this.shared
    const arm = this.viewmodel
    arm.name = 'antebrazo-primera-persona'
    arm.visible = false
    mesh(limbGeometry(0.3, 0.05, 0.039), m.coverall, arm, [-0.3, 0, 0], [0, 0, Math.PI / 2])
    mesh(band(0.052, 0.045), m.tape, arm, [-0.19, 0, 0], [0, 0, Math.PI / 2])
    mesh(band(0.042, 0.05), m.leather, arm, [-0.005, 0, 0], [0, 0, Math.PI / 2])
    mesh(new RoundedBoxGeometry(0.095, 0.085, 0.036, 3, 0.014), m.leather, arm, [0.05, 0, 0])
    mesh(new RoundedBoxGeometry(0.065, 0.08, 0.034, 3, 0.014), m.leather, arm, [0.115, -0.004, -0.012], [0, 0.35, 0])
    mesh(limbGeometry(0.05, 0.015, 0.013, 10), m.leather, arm, [0.03, 0.038, -0.01], [0, 0, -0.9])
    mesh(band(0.043, 0.024, 28), m.strap, arm, [-0.07, 0, 0], [0, 0, Math.PI / 2])
    const bracelet = buildBracelet(arm, m)
    bracelet.position.set(-0.07, 0, 0.044)
    bracelet.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)))
    arm.traverse(object => { if (object instanceof THREE.Mesh) this.geometries.add(object.geometry) })
  }

  /** Muestra u oculta el brazo izquierdo del cuerpo (en primera persona lo reemplaza el antebrazo). */
  setLeftArmVisible(visible: boolean): void {
    this.joints.shoulderL.visible = visible
  }

  /** Lámpara del casco encendida: el lente brilla (y alimenta el bloom). */
  setLamp(on: boolean): void {
    this.lens.color.setRGB(on ? 8 : 0.04, on ? 8.2 : 0.04, on ? 8.6 : 0.045)
  }

  /** Color instantáneo del LED RGB de la manilla (cada canal encendido o apagado). */
  setLed(red: boolean, green: boolean, blue: boolean): void {
    const k = 5
    this.led.color.setRGB(red ? k : 0.02, green ? k * 0.8 : 0.02, blue ? k : 0.02)
  }

  /** En primera persona se ocultan la cabeza y el casco (la cámara está dentro). */
  setFirstPerson(firstPerson: boolean): void {
    for (const part of this.headParts) part.visible = !firstPerson
    this.contactShadow.visible = !firstPerson
  }

  update(dt: number, pose: MinerPose): void {
    const j = this.joints
    this.time += dt
    const target = THREE.MathUtils.clamp(pose.speed / 1.4, 0, 2)
    this.gait += (target - this.gait) * (1 - Math.exp(-dt * 7))
    this.check += (THREE.MathUtils.clamp(pose.checkBracelet, 0, 1) - this.check) * (1 - Math.exp(-dt * 9))
    const stride = pose.running ? 2.0 : 1.4
    this.phase = (this.phase + ((pose.speed * dt) / stride) * Math.PI * 2) % (Math.PI * 2)
    const walk = Math.min(this.gait, 1)
    const run = THREE.MathUtils.clamp((this.gait - 1) / 0.8, 0, 1)
    const breath = Math.sin(this.time * 1.7) * (1 - walk)

    // Pelvis: subida en el apoyo medio, giro y balanceo acompañando a las piernas.
    const s = Math.sin(this.phase)
    j.hips.position.y = HIP_HEIGHT - 0.012 * walk - 0.03 * run + (0.018 * walk + 0.02 * run) * Math.cos(2 * this.phase)
    j.hips.rotation.set(0, 0.07 * walk * s, 0.035 * walk * s)
    j.spine.rotation.set(-(0.035 * walk + 0.13 * run) + 0.012 * breath, -0.09 * walk * s, -0.02 * walk * s)

    const legAmp = 0.4 * walk + 0.22 * run
    const kneeAmp = 0.72 * walk + 0.55 * run
    const legs = [[j.hipL, j.kneeL, j.ankleL, 0], [j.hipR, j.kneeR, j.ankleR, Math.PI]] as const
    for (const [hip, knee, ankle, offset] of legs) {
      const sp = Math.sin(this.phase + offset), cp = Math.cos(this.phase + offset)
      hip.rotation.x = legAmp * sp
      knee.rotation.x = -(0.05 * walk + kneeAmp * Math.max(0, cp) ** 1.3 + 0.1 * walk * Math.max(0, -sp))
      ankle.rotation.x = -(hip.rotation.x + knee.rotation.x) * 0.85 - 0.12 * walk * Math.max(0, -sp)
    }

    // Brazos en oposición a las piernas; el izquierdo puede levantarse para mirar la manilla.
    const arms = [[j.shoulderL, j.elbowL, 0, -1], [j.shoulderR, j.elbowR, 0, 1]] as const
    for (const [shoulder, elbow, offset, side] of arms) {
      const sp = Math.sin(this.phase + offset + (side < 0 ? 0 : Math.PI))
      shoulder.rotation.set(-(0.34 * walk + 0.25 * run) * sp + 0.02 * breath, 0, side * (0.07 + 0.03 * run))
      elbow.rotation.set(0.16 + 0.22 * walk + 0.75 * run, 0, 0)
    }
    const c = this.check * this.check * (3 - 2 * this.check)
    if (c > 0) {
      const sl = j.shoulderL, el = j.elbowL
      sl.rotation.x += (1.05 - sl.rotation.x) * c
      sl.rotation.z += (0.42 - sl.rotation.z) * c
      sl.rotation.y += (0.25 - sl.rotation.y) * c
      el.rotation.x += (1.95 - el.rotation.x) * c
      el.rotation.y += (-1.25 - el.rotation.y) * c
    }

    // Cabeza: sigue a la mirada con límites; baja la vista hacia la manilla al consultarla.
    const yaw = THREE.MathUtils.clamp(pose.lookYaw, -1.2, 1.2) * (1 - c) + 0.32 * c
    const pitch = THREE.MathUtils.clamp(pose.lookPitch, -0.9, 0.6) * (1 - c) - 0.62 * c
    j.neck.rotation.set(pitch * 0.35, yaw * 0.4, 0)
    j.head.rotation.set(pitch * 0.65, yaw * 0.6, 0)
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose()
    for (const material of this.materials) material.dispose()
    this.shadowTexture.dispose()
    this.fabricTexture.dispose()
  }
}
