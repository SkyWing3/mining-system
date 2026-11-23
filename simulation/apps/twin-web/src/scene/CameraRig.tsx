// Cámaras y minero controlable.
//
// - Supervisión: cámara orbital (camera-controls); el minero queda visible donde está.
// - Tercera persona: WASD relativo a la cámara, el minero gira hacia donde camina, la
//   cámara orbita con el ratón detrás del hombro y no atraviesa la roca.
// - Primera persona: la misma cápsula de colisión, vista desde los ojos del minero.
// Las transiciones interpolan posición y orientación para no perder la referencia.
import { CameraControls, Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { MeshBVH } from 'three-mesh-bvh'
import { frameAt, type CompiledLayout } from '@twin/mine-generator'
import { MinerAvatar, Walker, type QualityProfile, type WalkInput } from '@twin/graphics-engine'
import { deviceOutputs, oledTexture, useDevice } from '../device/runtime.ts'
import { isMinerMode, useTwin, type CameraMode } from '../state/store.ts'
import { mainRoute, overviewPose, routeFrame, yawFromTangent } from './cameraMath.ts'
import { miner } from './minerState.ts'

const SENSITIVITY = 0.0022
const TRANSITION_SECONDS = 0.9
const AUTOPILOT_SPEED = 1.6
/** Altura del pivote de la cámara en tercera persona y desplazamiento al hombro derecho. */
const PIVOT_HEIGHT = 1.58
const SHOULDER_OFFSET = 0.42
const CAMERA_MARGIN = 0.22
const LEVEL_LABEL: Record<string, string> = { normal: 'Normal', caution: 'Precaución', danger: 'Peligro' }

/** Ángulo equivalente en (−π, π]. */
function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

export function CameraRig({ compiled, collider, profile }: { compiled: CompiledLayout; collider: MeshBVH | null; profile: QualityProfile }) {
  const mode = useTwin(state => state.cameraMode)
  const headlampOn = useTwin(state => state.headlamp)
  const { camera, gl } = useThree()
  const controls = useRef<CameraControls>(null)
  const walker = useMemo(() => (collider ? new Walker(collider) : null), [collider])
  const avatar = useMemo(() => new MinerAvatar({ lampPool: profile.lampPool, oledTexture }), [profile.lampPool])
  useEffect(() => () => avatar.dispose(), [avatar])
  const look = useRef(miner.look)
  const boom = useRef({ target: 2.7, current: 2.7 })
  const input = useRef<WalkInput>({ forward: 0, right: 0, run: false })
  const keys = useRef(new Set<string>())
  const transition = useRef<{ t: number; seconds: number; fromPosition: THREE.Vector3; fromQuaternion: THREE.Quaternion } | null>(null)
  const spot = useRef<THREE.SpotLight>(null)
  const spotTarget = useMemo(() => new THREE.Object3D(), [])
  const scratch = useMemo(() => ({
    eye: new THREE.Vector3(), forward: new THREE.Vector3(), euler: new THREE.Euler(0, 0, 0, 'YXZ'), quat: new THREE.Quaternion(),
    previous: new THREE.Vector3(), head: new THREE.Vector3(), pivot: new THREE.Vector3(), desired: new THREE.Vector3(),
    ray: new THREE.Ray(), offset: new THREE.Vector3(), lamp: new THREE.Vector3(), lampDirection: new THREE.Vector3(), target: new THREE.Vector3(),
    local: new THREE.Matrix4(), world: new THREE.Matrix4(), localPosition: new THREE.Vector3(), localQuaternion: new THREE.Quaternion(), unit: new THREE.Vector3(1, 1, 1), localEuler: new THREE.Euler(),
  }), [])
  const overview = useMemo(() => overviewPose(compiled), [compiled])

  // Aparición del minero en la bocamina (primer segmento) mirando hacia adentro; al
  // regenerar la galería (otro perfil) conserva su posición.
  useEffect(() => {
    if (!walker) return
    if (!miner.spawned) {
      const segment = compiled.segments[0]
      const frame = frameAt(segment, 2.5)
      miner.position.set(frame.position[0], frame.position[1] + 0.1, frame.position[2])
      miner.bodyYaw = yawFromTangent(frame.tangent[0], frame.tangent[2])
      Object.assign(look.current, { yaw: miner.bodyYaw, pitch: -0.12 })
      miner.spawned = true
    }
    walker.reset(miner.position.clone().setY(miner.position.y + 0.05))
  }, [walker, compiled])

  // Entrada a los modos del minero y cambio entre primera y tercera persona.
  const previousMode = useRef<CameraMode | null>(null)
  useEffect(() => {
    const previous = previousMode.current
    previousMode.current = mode
    if (!isMinerMode(mode)) return
    if (previous === 'orbit' || previous === null) Object.assign(look.current, { yaw: miner.bodyYaw, pitch: mode === 'third-person' ? -0.16 : -0.05 })
    const seconds = previous === 'orbit' || previous === null ? TRANSITION_SECONDS : 0.35
    transition.current = { t: 0, seconds, fromPosition: camera.position.clone(), fromQuaternion: camera.quaternion.clone() }
    avatar.setFirstPerson(mode === 'first-person')
  }, [mode, avatar, camera])

  // Punto de vista programado (capturas): ubicación exacta en primera persona, sin transición.
  const viewpoint = useTwin(state => state.viewpoint)
  useEffect(() => {
    if (!viewpoint || mode !== 'first-person' || !walker) return
    const segment = compiled.segments.find(item => item.spec.id === viewpoint.segment)
    if (!segment) return
    const frame = frameAt(segment, viewpoint.s)
    const lateral = viewpoint.lateral ?? 0
    const feet = new THREE.Vector3(frame.position[0] + frame.right[0] * lateral, frame.position[1] + 0.1, frame.position[2] + frame.right[2] * lateral)
    walker.reset(feet)
    Object.assign(look.current, { yaw: yawFromTangent(frame.tangent[0], frame.tangent[2]) + (viewpoint.yawOffset ?? 0), pitch: viewpoint.pitch ?? -0.05 })
    miner.bodyYaw = look.current.yaw
    transition.current = null
  }, [viewpoint, mode, walker, compiled])

  const route = useMemo(() => mainRoute(compiled), [compiled])
  const autopilotDistance = useRef(0)
  const autopilotActive = useTwin(state => state.autopilot.active)
  useEffect(() => { autopilotDistance.current = 0 }, [autopilotActive])

  // Salida a supervisión: retroceder y elevar la cámara manteniendo la orientación.
  const previousOrbitMode = useRef<CameraMode | null>(null)
  useLayoutEffect(() => {
    const fromMiner = previousOrbitMode.current !== null && isMinerMode(previousOrbitMode.current)
    previousOrbitMode.current = mode
    if (mode !== 'orbit' || !controls.current) return
    const instance = controls.current
    if (fromMiner) {
      const forward = camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize()
      const focus = miner.position.clone().setY(miner.position.y + 1)
      void instance.setLookAt(camera.position.x, camera.position.y, camera.position.z, focus.x, focus.y, focus.z, false)
      const back = focus.clone().addScaledVector(forward, -14).add(new THREE.Vector3(0, 20, 0))
      void instance.setLookAt(back.x, back.y, back.z, focus.x, focus.y, focus.z, true)
    } else {
      void instance.setLookAt(overview.position.x, overview.position.y, overview.position.z, overview.target.x, overview.target.y, overview.target.z, false)
    }
  }, [mode, camera, overview])

  // Mapa de sombra de la linterna: solo se recalcula con la linterna encendida bajo tierra.
  useEffect(() => {
    const light = spot.current
    if (!light) return
    light.shadow.autoUpdate = isMinerMode(mode) && headlampOn
    light.shadow.needsUpdate = true
  }, [mode, headlampOn])

  // Teclado y ratón.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest?.('input, select, textarea, button')) return
      keys.current.add(event.code)
      const state = useTwin.getState()
      const minerMode = isMinerMode(state.cameraMode)
      if (event.code === 'KeyF' && minerMode) state.toggleHeadlamp()
      if (event.code === 'KeyV' && minerMode && !event.repeat) state.setCameraMode(state.cameraMode === 'first-person' ? 'third-person' : 'first-person')
      if (event.code === 'KeyQ' && !event.repeat) state.setCheckingBracelet(true)
      // Pulsadores de la manilla: subir, bajar y enter.
      if (!event.repeat && (event.code === 'ArrowUp' || event.code === 'ArrowDown' || event.code === 'Enter' || event.code === 'NumpadEnter')) {
        event.preventDefault()
        useDevice.getState().press(event.code === 'ArrowUp' ? 'up' : event.code === 'ArrowDown' ? 'down' : 'enter')
      }
    }
    const up = (event: KeyboardEvent) => {
      keys.current.delete(event.code)
      if (event.code === 'KeyQ') useTwin.getState().setCheckingBracelet(false)
    }
    const blur = () => {
      keys.current.clear()
      useTwin.getState().setCheckingBracelet(false)
    }
    const move = (event: MouseEvent) => {
      if (document.pointerLockElement !== gl.domElement) return
      look.current.yaw -= event.movementX * SENSITIVITY
      look.current.pitch = THREE.MathUtils.clamp(look.current.pitch - event.movementY * SENSITIVITY, -1.35, 1.2)
    }
    const wheel = (event: WheelEvent) => {
      if (document.pointerLockElement !== gl.domElement) return
      boom.current.target = THREE.MathUtils.clamp(boom.current.target + Math.sign(event.deltaY) * 0.3, 1.3, 4.8)
    }
    const lockChange = () => useTwin.getState().setPointerLocked(document.pointerLockElement === gl.domElement)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    document.addEventListener('mousemove', move)
    document.addEventListener('wheel', wheel, { passive: true })
    document.addEventListener('pointerlockchange', lockChange)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      document.removeEventListener('mousemove', move)
      document.removeEventListener('wheel', wheel)
      document.removeEventListener('pointerlockchange', lockChange)
    }
  }, [gl])

  /** Intensidad de la lámpara del casco (cd); 0 si está apagada o en supervisión. */
  const LAMP_INTENSITY = 70
  const placeSpot = (position: THREE.Vector3, direction: THREE.Vector3, intensity = LAMP_INTENSITY) => {
    if (!spot.current) return
    spot.current.intensity = headlampOn ? intensity : 0
    spot.current.position.copy(position)
    spotTarget.position.copy(position).addScaledVector(direction, 8)
    spotTarget.updateMatrixWorld()
  }

  /** Distancia libre desde `from` hacia `to` contra la roca (con margen). */
  const clearDistance = (from: THREE.Vector3, to: THREE.Vector3): number => {
    const length = from.distanceTo(to)
    if (!collider || length < 1e-4) return length
    scratch.ray.origin.copy(from)
    scratch.ray.direction.copy(to).sub(from).divideScalar(length)
    const hit = collider.raycastFirst(scratch.ray, THREE.DoubleSide, 0, length + CAMERA_MARGIN)
    return hit ? Math.max(0, hit.distance - CAMERA_MARGIN) : length
  }

  /** Sin antebrazo en primera plano y con el campo visual normal. */
  const restoreView = () => {
    avatar.viewmodel.visible = false
    avatar.setLeftArmVisible(true)
    const perspective = camera as THREE.PerspectiveCamera
    if (perspective.fov !== 68) {
      perspective.fov = 68
      perspective.updateProjectionMatrix()
    }
  }

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1)
    const state = useTwin.getState()
    avatar.setLamp(isMinerMode(mode) && headlampOn)
    const outputs = deviceOutputs()
    avatar.setLed(outputs.red, outputs.green, outputs.blue)

    if (mode === 'orbit') {
      if (spot.current) spot.current.intensity = 0
      restoreView()
      avatar.root.visible = miner.spawned
      avatar.root.position.copy(miner.position)
      avatar.root.rotation.y = miner.bodyYaw
      avatar.update(delta, { speed: 0, running: false, lookYaw: 0, lookPitch: 0, checkBracelet: state.checkingBracelet ? 1 : 0 })
      return
    }
    if (!walker) return

    if (autopilotActive) {
      // Recorrido de benchmark: velocidad constante por el eje, sin entrada del usuario.
      avatar.root.visible = false
      restoreView()
      autopilotDistance.current += AUTOPILOT_SPEED * delta
      const frame = routeFrame(route, autopilotDistance.current)
      camera.position.copy(frame.position).setY(frame.position.y + 1.65)
      const current = state.autopilot
      const total = route.reduce((sum, segment) => sum + segment.length, 0)
      if (frame.done && !current.finished) state.setAutopilot({ active: false, progress: 1, finished: true })
      else if (!frame.done && Math.abs(current.progress - autopilotDistance.current / total) > 0.01) state.setAutopilot({ active: true, progress: autopilotDistance.current / total, finished: false })
      scratch.euler.set(-0.06, frame.yaw, 0, 'YXZ')
      camera.quaternion.setFromEuler(scratch.euler)
      camera.getWorldDirection(scratch.forward)
      placeSpot(scratch.eye.copy(camera.position).setY(camera.position.y + 0.08), scratch.forward)
      return
    }

    // --- movimiento -------------------------------------------------------------
    const pressed = keys.current
    input.current.forward = (pressed.has('KeyW') ? 1 : 0) - (pressed.has('KeyS') ? 1 : 0)
    input.current.right = (pressed.has('KeyD') ? 1 : 0) - (pressed.has('KeyA') ? 1 : 0)
    input.current.run = pressed.has('ShiftLeft') || pressed.has('ShiftRight')
    const active = transition.current
    const moving = input.current.forward !== 0 || input.current.right !== 0
    scratch.previous.copy(walker.position)
    if (!active || active.t >= 1 || active.seconds < 0.5) walker.update(delta, input.current, look.current.yaw, state.walkSpeed)
    const dx = walker.position.x - scratch.previous.x, dz = walker.position.z - scratch.previous.z
    const step = Math.hypot(dx, dz)
    const measured = delta > 0 ? step / delta : 0
    miner.speed += (measured - miner.speed) * (1 - Math.exp(-delta * 12))
    miner.distance += step
    miner.position.copy(walker.position)

    // El cuerpo mira hacia donde camina (tercera persona) o hacia donde mira (primera).
    if (mode === 'first-person') {
      miner.bodyYaw = look.current.yaw
    } else if (moving && step > 1e-4) {
      const targetYaw = Math.atan2(-dx, -dz)
      miner.bodyYaw = wrapAngle(miner.bodyYaw + wrapAngle(targetYaw - miner.bodyYaw) * (1 - Math.exp(-delta * 10)))
    }
    avatar.root.visible = true
    avatar.root.position.copy(walker.position)
    avatar.root.rotation.y = miner.bodyYaw
    avatar.update(delta, {
      speed: miner.speed,
      running: input.current.run,
      lookYaw: wrapAngle(look.current.yaw - miner.bodyYaw),
      lookPitch: look.current.pitch,
      checkBracelet: state.checkingBracelet ? 1 : 0,
    })
    avatar.root.updateMatrixWorld(true)

    // --- cámara ---------------------------------------------------------------------
    const pitch = look.current.pitch
    if (mode === 'first-person') {
      // Ojos del modelo: incluyen el vaivén de la marcha y quedan por delante del cuello.
      avatar.eyeAnchor.getWorldPosition(scratch.target)
      scratch.euler.set(pitch, look.current.yaw, 0, 'YXZ')
      scratch.quat.setFromEuler(scratch.euler)
    } else {
      const yaw = look.current.yaw
      const right = scratch.offset.set(Math.cos(yaw), 0, -Math.sin(yaw))
      scratch.head.copy(walker.position).setY(walker.position.y + PIVOT_HEIGHT)
      const shoulder = clearDistance(scratch.head, scratch.pivot.copy(scratch.head).addScaledVector(right, SHOULDER_OFFSET))
      scratch.pivot.copy(scratch.head).addScaledVector(right, shoulder)
      scratch.forward.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
      const wanted = boom.current.target
      scratch.desired.copy(scratch.pivot).addScaledVector(scratch.forward, -wanted)
      const free = clearDistance(scratch.pivot, scratch.desired)
      // Se acerca de inmediato si la roca estorba y se aleja con suavidad.
      boom.current.current = free < boom.current.current ? free : boom.current.current + (Math.min(free, wanted) - boom.current.current) * (1 - Math.exp(-delta * 4))
      scratch.target.copy(scratch.pivot).addScaledVector(scratch.forward, -boom.current.current)
      scratch.euler.set(pitch, yaw, 0, 'YXZ')
      scratch.quat.setFromEuler(scratch.euler)
      // Con la cámara pegada al minero, ocultarlo para no tapar la vista.
      avatar.root.visible = boom.current.current > 0.55
    }
    // Vibración del motor de la manilla: temblor leve de la vista.
    if (outputs.motor && mode === 'first-person') scratch.target.addScaledVector(scratch.offset.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5), 0.004)
    if (active && active.t < 1) {
      active.t = Math.min(1, active.t + delta / active.seconds)
      const k = active.t * active.t * (3 - 2 * active.t)
      camera.position.lerpVectors(active.fromPosition, scratch.target, k)
      camera.quaternion.slerpQuaternions(active.fromQuaternion, scratch.quat, k)
    } else {
      camera.position.copy(scratch.target)
      camera.quaternion.copy(scratch.quat)
    }

    // Primera persona: al consultar la manilla se levanta el antebrazo frente a los ojos y la
    // vista se concentra en la pantalla (campo visual más estrecho), como al enfocar un reloj.
    const check = avatar.checkAmount()
    const firstPerson = mode === 'first-person'
    const raised = firstPerson && check > 0.01
    avatar.viewmodel.visible = raised
    avatar.setLeftArmVisible(!raised)
    if (raised) {
      camera.updateMatrixWorld()
      // La pantalla queda al centro, 24 cm delante de los ojos y casi horizontal.
      scratch.localPosition.set(0.07, -0.004 - 0.3 * (1 - check), -0.24)
      scratch.localQuaternion.setFromEuler(scratch.localEuler.set(0.35 * (1 - check), -0.18, 0.1))
      scratch.local.compose(scratch.localPosition, scratch.localQuaternion, scratch.unit)
      scratch.world.multiplyMatrices(camera.matrixWorld, scratch.local)
      scratch.world.decompose(avatar.viewmodel.position, avatar.viewmodel.quaternion, avatar.viewmodel.scale)
    }
    const perspective = camera as THREE.PerspectiveCamera
    const fov = firstPerson ? 68 - 34 * check : 68
    if (Math.abs(perspective.fov - fov) > 0.01) {
      perspective.fov = fov
      perspective.updateProjectionMatrix()
    }

    // Lámpara del casco: en primera persona sigue a la mirada; en tercera, a la cabeza del minero.
    if (mode === 'first-person') {
      camera.getWorldDirection(scratch.forward)
      // La muñeca queda a 25 cm de la lámpara: se atenúa como lo haría la exposición del ojo.
      placeSpot(scratch.lamp.copy(camera.position).setY(camera.position.y + 0.08), scratch.forward, LAMP_INTENSITY * (1 - 0.85 * check))
    } else {
      avatar.lampAnchor.getWorldPosition(scratch.lamp)
      scratch.lampDirection.set(0, 0, -1).transformDirection(avatar.lampAnchor.matrixWorld)
      placeSpot(scratch.lamp, scratch.lampDirection)
    }
  }, -20)

  const minerMode = isMinerMode(mode)
  return (
    <>
      {minerMode ? null : (
        <CameraControls ref={controls} makeDefault minDistance={2} maxDistance={400} maxPolarAngle={Math.PI * 0.495} smoothTime={0.35} draggingSmoothTime={0.12} />
      )}
      <primitive object={avatar.root} />
      <primitive object={avatar.viewmodel} />
      {mode === 'orbit' ? <MinerLabel avatar={avatar} /> : null}
      <primitive object={spotTarget} />
      <spotLight
        ref={spot}
        // Siempre presente (intensidad 0 si está apagada): cambiar el número de luces
        // obliga a three.js a recompilar todos los sombreadores y produce tirones.
        intensity={0}
        target={spotTarget}
        color={0xf4f6ff}
        distance={45}
        decay={2}
        angle={0.42}
        penumbra={0.65}
        castShadow={profile.headlampShadow > 0}
        shadow-mapSize-width={Math.max(profile.headlampShadow, 256)}
        shadow-mapSize-height={Math.max(profile.headlampShadow, 256)}
        shadow-radius={3}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-near={0.2}
        shadow-camera-far={45}
      />
    </>
  )
}

/** Etiqueta del minero en supervisión: nombre, zona y nivel de su manilla. */
function MinerLabel({ avatar }: { avatar: MinerAvatar }) {
  const level = useDevice(state => state.level)
  const zone = useDevice(state => state.reading?.location.zone ?? '')
  const anchor = useMemo(() => new THREE.Object3D(), [])
  const label = useRef<HTMLDivElement>(null)
  useFrame(() => {
    anchor.position.copy(avatar.root.position).setY(avatar.root.position.y + 2.3)
    // El minero aparece cuando existe el colisionador; hasta entonces no hay etiqueta.
    if (label.current) label.current.style.display = miner.spawned ? '' : 'none'
  })
  const color = level === 'danger' ? 'border-state-alarm text-state-alarm' : level === 'caution' ? 'border-state-warn text-state-warn' : 'border-ink-600 text-ink-300'
  return (
    <primitive object={anchor}>
      <Html center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div ref={label} data-testid="miner-label" className={`rounded border bg-ink-950/85 px-2 py-1 text-[11px] whitespace-nowrap backdrop-blur ${color}`}>
          <span className="font-semibold text-ink-100">Minero simulado</span> · {zone} · {LEVEL_LABEL[level] ?? level}
        </div>
      </Html>
    </primitive>
  )
}
