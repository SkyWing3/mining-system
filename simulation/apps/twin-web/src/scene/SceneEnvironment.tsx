// Iluminación ambiental, niebla, reflejos y corte de la bóveda según el modo de cámara.
// Bajo tierra domina la luz de las luminarias y de la linterna; en supervisión se agrega
// una luz cenital neutra para que la estructura y los datos sean legibles.
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { QualityProfile } from '@twin/graphics-engine'
import { useTwin } from '../state/store.ts'

const ROOF_CUT_HEIGHT = 2.55

/** Escena simple para el mapa de entorno subterráneo: roca oscura y luminarias lineales. */
function mineEnvironmentScene(): THREE.Scene {
  const scene = new THREE.Scene()
  const room = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.028, 0.022, 0.018), side: THREE.BackSide }))
  room.position.y = 1.6
  scene.add(room)
  const lampMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4.3, 3.4) })
  for (let z = -16; z <= 16; z += 8) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.08, 0.25), lampMaterial)
    lamp.position.set(0.2, 3.4, z)
    scene.add(lamp)
  }
  return scene
}

export function SceneEnvironment({ profile }: { profile: QualityProfile }) {
  const { gl, scene } = useThree()
  const mode = useTwin(state => state.cameraMode)
  const roofCut = useTwin(state => state.roofCut)
  const orbit = mode === 'orbit'

  // Reflejos: en supervisión, un estudio neutro; bajo tierra, un entorno oscuro de roca con
  // franjas cálidas de luminarias (los charcos no deben reflejar un cielo inexistente).
  const environments = useMemo(() => {
    const generator = new THREE.PMREMGenerator(gl)
    const studio = generator.fromScene(new RoomEnvironment(), 0.04).texture
    const mine = generator.fromScene(mineEnvironmentScene(), 0.02).texture
    generator.dispose()
    return { studio, mine }
  }, [gl])
  useEffect(() => () => { environments.studio.dispose(); environments.mine.dispose() }, [environments])
  const environment = orbit ? environments.studio : environments.mine

  // Un plano siempre presente: el número de planos forma parte de la clave del programa, así
  // que alternar entre 0 y 1 plano recompilaría todos los sombreadores. Sin corte, se aleja.
  const clipPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), ROOF_CUT_HEIGHT), [])

  useEffect(() => {
    scene.background = new THREE.Color(orbit ? 0x16181b : 0x050506)
    scene.fog = orbit ? new THREE.FogExp2(0x16181b, 0.0016) : new THREE.FogExp2(0x0a0a0b, 0.024)
    scene.environment = environment
    scene.environmentIntensity = orbit ? 0.45 : 1
    clipPlane.constant = orbit && roofCut ? ROOF_CUT_HEIGHT : 1e6
    gl.clippingPlanes = [clipPlane]
    // Sin posprocesado (perfil Bajo) el mapeo tonal lo hace el renderer.
    gl.toneMapping = profile.postprocessing ? THREE.NoToneMapping : THREE.AgXToneMapping
    gl.toneMappingExposure = 1
    gl.shadowMap.enabled = profile.headlampShadow > 0
    gl.shadowMap.type = THREE.PCFShadowMap
  }, [gl, scene, environment, orbit, roofCut, clipPlane, profile])

  return (
    <>
      <hemisphereLight args={[0x9aa3ad, 0x2a241e, orbit ? 0.9 : 0.06]} />
      <directionalLight position={[40, 120, 60]} intensity={orbit ? 1.6 : 0} color={0xf1ece4} />
    </>
  )
}

/** Renderiza la escena cuando no hay EffectComposer (perfil Bajo). */
export function PlainRenderer() {
  useFrame(({ gl, scene, camera }) => gl.render(scene, camera), 1)
  return null
}
