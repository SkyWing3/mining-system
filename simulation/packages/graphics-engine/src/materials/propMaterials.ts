// Materiales PBR de la infraestructura (con coordenadas UV) e iluminación de luminarias.
import * as THREE from 'three'
import type { PbrSet } from '../textures.ts'
import { withLampLighting } from './lampLighting.ts'

export interface PropTextureSets {
  readonly timber: PbrSet
  readonly painted: PbrSet
  readonly steel: PbrSet
  readonly concrete: PbrSet
}

export interface PropMaterials {
  readonly timber: THREE.MeshStandardMaterial
  readonly steel: THREE.MeshStandardMaterial
  readonly railSteel: THREE.MeshStandardMaterial
  readonly painted: THREE.MeshStandardMaterial
  readonly waterPipe: THREE.MeshStandardMaterial
  readonly duct: THREE.MeshStandardMaterial
  readonly cable: THREE.MeshStandardMaterial
  readonly housing: THREE.MeshStandardMaterial
  readonly lens: THREE.MeshBasicMaterial
  readonly concrete: THREE.MeshStandardMaterial
  readonly door: THREE.MeshStandardMaterial
  readonly signBack: THREE.MeshStandardMaterial
  readonly sign: (texture: THREE.Texture) => THREE.MeshStandardMaterial
  dispose(): void
}

function repeated(texture: THREE.Texture, repeat: number): THREE.Texture {
  const copy = texture.clone()
  copy.repeat.set(repeat, repeat)
  copy.needsUpdate = true
  return copy
}

function pbr(set: PbrSet, repeat: number, parameters: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const arm = repeated(set.arm, repeat)
  return new THREE.MeshStandardMaterial({
    map: repeated(set.albedo, repeat),
    normalMap: repeated(set.normal, repeat),
    roughnessMap: arm,
    metalnessMap: arm,
    aoMap: arm,
    aoMapIntensity: 0.8,
    roughness: 1,
    metalness: 1,
    ...parameters,
  })
}

/** Relieve de anillos del ducto flexible de ventilación. */
function ribTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 8
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D no disponible.')
  const gradient = ctx.createLinearGradient(0, 0, 64, 0)
  gradient.addColorStop(0, '#000')
  gradient.addColorStop(0.15, '#fff')
  gradient.addColorStop(0.5, '#777')
  gradient.addColorStop(1, '#000')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 64, 8)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  return texture
}

export function createPropMaterials(sets: PropTextureSets, lampPool: number): PropMaterials {
  const created: THREE.Material[] = []
  const lit = <T extends THREE.MeshStandardMaterial>(material: T, instanced = true): T => {
    created.push(material)
    return withLampLighting(material, lampPool, instanced)
  }
  const timber = lit(pbr(sets.timber, 1, { color: new THREE.Color(0.78, 0.68, 0.56), metalness: 0 }))
  // Acero oxidado: la textura se atenúa para no parecer cobre bajo la luz cálida.
  const steel = lit(pbr(sets.steel, 1, { color: new THREE.Color(0.46, 0.4, 0.36), metalness: 0.45 }))
  const railSteel = lit(pbr(sets.steel, sets.steel.scale, { color: new THREE.Color(0.36, 0.34, 0.33), metalness: 0.7, roughness: 0.7 }), false)
  const painted = lit(pbr(sets.painted, 1.5), false)
  const waterPipe = lit(pbr(sets.steel, 1, { color: new THREE.Color(0.48, 0.45, 0.43), metalness: 0.5 }), false)
  const rib = ribTexture()
  const duct = lit(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.42, 0.33, 0.1), roughness: 0.78, metalness: 0, bumpMap: rib, bumpScale: 2.5 }), false)
  const cable = lit(new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.5, metalness: 0 }), false)
  const housing = lit(pbr(sets.painted, 4, { color: new THREE.Color(0.45, 0.45, 0.42) }))
  const lens = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 8.2, 7.2), toneMapped: true })
  created.push(lens)
  const concrete = lit(pbr(sets.concrete, 0.5, { color: new THREE.Color(0.66, 0.65, 0.62), metalness: 0 }), false)
  const door = lit(pbr(sets.painted, 1, { color: new THREE.Color(0.55, 0.9, 0.6) }), false)
  const signBack = lit(pbr(sets.steel, 2, { metalness: 0.6 }), false)
  const sign = (texture: THREE.Texture) => lit(new THREE.MeshStandardMaterial({ map: texture, roughness: 0.62, metalness: 0.1 }), false)
  return {
    timber, steel, railSteel, painted, waterPipe, duct, cable, housing, lens, concrete, door, signBack, sign,
    dispose() {
      rib.dispose()
      for (const material of created) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose()
        material.dispose()
      }
    },
  }
}
