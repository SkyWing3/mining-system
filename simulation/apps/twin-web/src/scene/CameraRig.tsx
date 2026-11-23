// Cámaras: supervisión orbital (camera-controls) y primera persona con colisión.
// Las transiciones interpolan posición y orientación para no perder la referencia.
import { CameraControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { MeshBVH } from 'three-mesh-bvh'
import { frameAt, type CompiledLayout } from '@twin/mine-generator'
import { Walker, type QualityProfile, type WalkInput } from '@twin/graphics-engine'
import { useTwin } from '../state/store.ts'
import { mainRoute, nearestAxisPoint, overviewPose, routeFrame, yawFromTangent } from './cameraMath.ts'

const SENSITIVITY = 0.0022
const TRANSITION_SECONDS = 0.9
const AUTOPILOT_SPEED = 1.6

export function CameraRig({ compiled, collider, profile }: { compiled: CompiledLayout; collider: MeshBVH | null; profile: QualityProfile }) {
  const mode = useTwin(state => state.cameraMode)
  const headlampOn = useTwin(state => state.headlamp)
  const { camera, gl } = useThree()
  const controls = useRef<CameraControls>(null)
  const walker = useMemo(() => (collider ? new Walker(collider) : null), [collider])
  const look = useRef({ yaw: 0, pitch: -0.05 })
  const input = useRef<WalkInput>({ forward: 0, right: 0, run: false })
  const keys = useRef(new Set<string>())
  const transition = useRef<{ t: number; fromPosition: THREE.Vector3; fromQuaternion: THREE.Quaternion } | null>(null)
  const spot = useRef<THREE.SpotLight>(null)
  const spotTarget = useMemo(() => new THREE.Object3D(), [])
  const scratch = useMemo(() => ({ eye: new THREE.Vector3(), forward: new THREE.Vector3(), euler: new THREE.Euler(0, 0, 0, 'YXZ'), quat: new THREE.Quaternion() }), [])
  const overview = useMemo(() => overviewPose(compiled), [compiled])
  const lastOrbitTarget = useRef(overview.target.clone())

  // Entrada a primera persona: ubicar al caminante en el eje más cercano al punto observado.
  useEffect(() => {
    if (mode !== 'first-person' || !walker) return
    const { position, yaw } = nearestAxisPoint(compiled, lastOrbitTarget.current)
    walker.reset(position.clone().setY(position.y + 0.1))
    look.current = { yaw, pitch: -0.05 }
    transition.current = { t: 0, fromPosition: camera.position.clone(), fromQuaternion: camera.quaternion.clone() }
  }, [mode, walker, compiled, camera])

  // Punto de vista programado (capturas): ubicación exacta, sin transición.
  const viewpoint = useTwin(state => state.viewpoint)
  useEffect(() => {
    if (!viewpoint || mode !== 'first-person' || !walker) return
    const segment = compiled.segments.find(item => item.spec.id === viewpoint.segment)
    if (!segment) return
    const frame = frameAt(segment, viewpoint.s)
    const lateral = viewpoint.lateral ?? 0
    const feet = new THREE.Vector3(frame.position[0] + frame.right[0] * lateral, frame.position[1] + 0.1, frame.position[2] + frame.right[2] * lateral)
    walker.reset(feet)
    look.current = { yaw: yawFromTangent(frame.tangent[0], frame.tangent[2]) + (viewpoint.yawOffset ?? 0), pitch: viewpoint.pitch ?? -0.05 }
    transition.current = null
  }, [viewpoint, mode, walker, compiled])

  const route = useMemo(() => mainRoute(compiled), [compiled])
  const autopilotDistance = useRef(0)
  const autopilotActive = useTwin(state => state.autopilot.active)
  useEffect(() => { autopilotDistance.current = 0 }, [autopilotActive])

  // Salida a supervisión: retroceder y elevar la cámara manteniendo la orientación.
  const previousMode = useRef<typeof mode | null>(null)
  useLayoutEffect(() => {
    const fromFirstPerson = previousMode.current === 'first-person'
    previousMode.current = mode
    if (mode !== 'orbit' || !controls.current) return
    const instance = controls.current
    const forward = camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize()
    const ahead = camera.position.clone().addScaledVector(forward, 6)
    if (fromFirstPerson) {
      void instance.setLookAt(camera.position.x, camera.position.y, camera.position.z, ahead.x, ahead.y, ahead.z, false)
      const back = camera.position.clone().addScaledVector(forward, -16).add(new THREE.Vector3(0, 22, 0))
      void instance.setLookAt(back.x, back.y, back.z, ahead.x, camera.position.y - 1.6, ahead.z, true)
    } else {
      void instance.setLookAt(overview.position.x, overview.position.y, overview.position.z, overview.target.x, overview.target.y, overview.target.z, false)
    }
  }, [mode, camera, overview])

  // Mapa de sombra de la linterna: solo se recalcula con la linterna encendida en primera persona.
  useEffect(() => {
    const light = spot.current
    if (!light) return
    light.shadow.autoUpdate = mode === 'first-person' && headlampOn
    light.shadow.needsUpdate = true
  }, [mode, headlampOn])

  // Teclado y ratón (solo en primera persona).
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input, select, textarea')) return
      keys.current.add(event.code)
      if (event.code === 'KeyF' && useTwin.getState().cameraMode === 'first-person') useTwin.getState().toggleHeadlamp()
    }
    const up = (event: KeyboardEvent) => keys.current.delete(event.code)
    const blur = () => keys.current.clear()
    const move = (event: MouseEvent) => {
      if (document.pointerLockElement !== gl.domElement) return
      look.current.yaw -= event.movementX * SENSITIVITY
      look.current.pitch = THREE.MathUtils.clamp(look.current.pitch - event.movementY * SENSITIVITY, -1.45, 1.45)
    }
    const lockChange = () => {
      const locked = document.pointerLockElement === gl.domElement
      useTwin.getState().setPointerLocked(locked)
      // Esc libera el puntero: volver de inmediato a supervisión.
      if (!locked && useTwin.getState().cameraMode === 'first-person') useTwin.getState().setCameraMode('orbit')
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    document.addEventListener('mousemove', move)
    document.addEventListener('pointerlockchange', lockChange)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      document.removeEventListener('mousemove', move)
      document.removeEventListener('pointerlockchange', lockChange)
    }
  }, [gl])

  useFrame((_, delta) => {
    if (mode === 'orbit') {
      controls.current?.getTarget(lastOrbitTarget.current)
      return
    }
    if (!walker) return
    if (autopilotActive) {
      // Recorrido de benchmark: velocidad constante por el eje, sin entrada del usuario.
      autopilotDistance.current += AUTOPILOT_SPEED * Math.min(delta, 0.1)
      const frame = routeFrame(route, autopilotDistance.current)
      camera.position.copy(frame.position).setY(frame.position.y + 1.65)
      const current = useTwin.getState().autopilot
      const total = route.reduce((sum, segment) => sum + segment.length, 0)
      if (frame.done && !current.finished) useTwin.getState().setAutopilot({ active: false, progress: 1, finished: true })
      else if (!frame.done && Math.abs(current.progress - autopilotDistance.current / total) > 0.01) useTwin.getState().setAutopilot({ active: true, progress: autopilotDistance.current / total, finished: false })
      scratch.euler.set(-0.06, frame.yaw, 0, 'YXZ')
      camera.quaternion.setFromEuler(scratch.euler)
      if (spot.current) {
        camera.getWorldDirection(scratch.forward)
        spot.current.position.copy(camera.position).add(new THREE.Vector3(0, 0.08, 0))
        spotTarget.position.copy(camera.position).addScaledVector(scratch.forward, 8)
        spotTarget.updateMatrixWorld()
      }
      return
    }
    const pressed = keys.current
    input.current.forward = (pressed.has('KeyW') || pressed.has('ArrowUp') ? 1 : 0) - (pressed.has('KeyS') || pressed.has('ArrowDown') ? 1 : 0)
    input.current.right = (pressed.has('KeyD') || pressed.has('ArrowRight') ? 1 : 0) - (pressed.has('KeyA') || pressed.has('ArrowLeft') ? 1 : 0)
    input.current.run = pressed.has('ShiftLeft') || pressed.has('ShiftRight')
    const active = transition.current
    if (!active || active.t >= 1) walker.update(delta, input.current, look.current.yaw, useTwin.getState().walkSpeed)
    const eye = walker.eye(scratch.eye)
    scratch.euler.set(look.current.pitch, look.current.yaw, 0, 'YXZ')
    scratch.quat.setFromEuler(scratch.euler)
    if (active && active.t < 1) {
      active.t = Math.min(1, active.t + delta / TRANSITION_SECONDS)
      const k = active.t * active.t * (3 - 2 * active.t)
      camera.position.lerpVectors(active.fromPosition, eye, k)
      camera.quaternion.slerpQuaternions(active.fromQuaternion, scratch.quat, k)
    } else {
      camera.position.copy(eye)
      camera.quaternion.copy(scratch.quat)
    }
    // Linterna del casco: 8 cm sobre los ojos, apuntando hacia la mirada.
    if (spot.current) {
      camera.getWorldDirection(scratch.forward)
      spot.current.position.copy(camera.position).add(new THREE.Vector3(0, 0.08, 0))
      spotTarget.position.copy(camera.position).addScaledVector(scratch.forward, 8)
      spotTarget.updateMatrixWorld()
    }
  })

  const firstPerson = mode === 'first-person'
  return (
    <>
      {firstPerson ? null : (
        <CameraControls ref={controls} makeDefault minDistance={2} maxDistance={400} maxPolarAngle={Math.PI * 0.495} smoothTime={0.35} draggingSmoothTime={0.12} />
      )}
      <primitive object={spotTarget} />
      <spotLight
        ref={spot}
        // Siempre presente (intensidad 0 si está apagada): cambiar el número de luces
        // obliga a three.js a recompilar todos los sombreadores y produce tirones.
        intensity={firstPerson && headlampOn ? 70 : 0}
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
