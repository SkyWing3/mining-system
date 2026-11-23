// Carga las texturas locales del perfil gráfico y crea los materiales compartidos.
import { useLayoutEffect, useState } from 'react'
import * as THREE from 'three'
import {
  createPropMaterials, createRockMaterial, disposePbrSet, loadPbrSet, loadTextureIndex,
  type PbrSet, type PropMaterials, type QualityProfile, type RockUniforms,
} from '@twin/graphics-engine'

export interface SceneMaterials {
  readonly rock: THREE.MeshStandardMaterial
  readonly rockUniforms: RockUniforms
  readonly props: PropMaterials
}

export function useMaterials(profile: QualityProfile): { materials: SceneMaterials | null; error: string | null } {
  const [materials, setMaterials] = useState<SceneMaterials | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { textureResolution, anisotropy, oxidizedLayer, lampPool } = profile

  // Efecto de diseño: al cambiar de perfil, los materiales viejos se retiran de la escena en el
  // mismo commit en que se liberan, antes de cualquier fotograma (evita resubirlos a la GPU).
  useLayoutEffect(() => {
    setMaterials(null)
    let cancelled = false
    let created: { sets: PbrSet[]; materials: SceneMaterials } | null = null
    ;(async () => {
      try {
        const index = await loadTextureIndex()
        const load = (role: string, resolution = textureResolution) => loadPbrSet(index, role, resolution, anisotropy)
        const propResolution = textureResolution === '4k' ? '2k' : textureResolution
        // Los letreros se dibujan en lienzo: esperar la tipografía local antes de crearlos.
        await Promise.all([document.fonts.load('700 50px "IBM Plex Sans Variable"'), document.fonts.load('500 46px "IBM Plex Sans Variable"')]).catch(() => undefined)
        const [rock, floor, shotcrete, timber, painted, steel] = await Promise.all([
          load('rock-wall'), load('floor-wet'), load('shotcrete'),
          load('timber', propResolution), load('painted-metal', propResolution), load('rusted-steel', propResolution),
        ])
        // El perfil Bajo no usa la capa oxidada: no se descarga ni ocupa memoria.
        const oxidized = oxidizedLayer ? await load('rock-wall-oxidized') : rock
        const sets = oxidizedLayer ? [rock, oxidized, floor, shotcrete, timber, painted, steel] : [rock, floor, shotcrete, timber, painted, steel]
        if (cancelled) { sets.forEach(disposePbrSet); return }
        const rockMaterial = createRockMaterial({ rock, oxidized, floor, shotcrete }, { oxidizedLayer, lampPool })
        const props = createPropMaterials({ timber, painted, steel, concrete: shotcrete }, lampPool)
        created = { sets, materials: { rock: rockMaterial.material, rockUniforms: rockMaterial.uniforms, props } }
        setError(null)
        setMaterials(created.materials)
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      }
    })()
    return () => {
      cancelled = true
      if (created) {
        created.materials.rock.dispose()
        created.materials.props.dispose()
        created.sets.forEach(disposePbrSet)
      }
    }
  }, [textureResolution, anisotropy, oxidizedLayer, lampPool])

  return { materials, error }
}
