// Precalentamiento: compila todos los programas de sombreado y sube todas las texturas a la
// GPU antes del recorrido. Sin esto, cada objeto que entra por primera vez en pantalla
// (letreros, arcos, refugio) provoca un tirón de compilación medido en el benchmark.
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import * as THREE from 'three'
import { useTwin } from '../state/store.ts'

export function Warmup({ ready }: { ready: boolean }) {
  const { gl, scene, camera } = useThree()
  const setWarmedUp = useTwin(state => state.setWarmedUp)
  useEffect(() => {
    if (!ready) { setWarmedUp(false); return }
    let cancelled = false
    const textures = new Set<THREE.Texture>()
    scene.traverse(object => {
      const materials = (object as THREE.Mesh).material
      for (const material of Array.isArray(materials) ? materials : materials ? [materials] : []) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value)
        for (const value of (material.userData.textures as THREE.Texture[] | undefined) ?? []) textures.add(value)
      }
    })
    for (const texture of textures) gl.initTexture(texture)
    void gl.compileAsync(scene, camera).then(() => { if (!cancelled) setWarmedUp(true) })
    return () => { cancelled = true }
  }, [ready, gl, scene, camera, setWarmedUp])
  return null
}
