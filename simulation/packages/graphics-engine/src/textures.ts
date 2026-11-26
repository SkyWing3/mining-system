// Carga de juegos de texturas PBR locales (generados por scripts/fetch-assets.mjs).
// Nunca se solicitan recursos a orígenes externos.
import * as THREE from 'three'
import type { TextureResolution } from './quality.ts'

export interface TextureIndexEntry {
  readonly id: string
  readonly role: string
  readonly title: string
  readonly resolutions: readonly TextureResolution[]
  readonly dimensionsMm: readonly [number, number]
}

export interface TextureIndex {
  readonly version: number
  readonly pathTemplate: string
  readonly textures: readonly TextureIndexEntry[]
}

export interface PbrSet {
  readonly id: string
  readonly albedo: THREE.Texture
  readonly normal: THREE.Texture
  readonly arm: THREE.Texture
  /** Repeticiones por metro según el tamaño real de la muestra fotografiada. */
  readonly scale: number
}

export const CONTENT_BASE = `${import.meta.env.BASE_URL}content/`

export async function loadTextureIndex(): Promise<TextureIndex> {
  const missing = 'No se encontraron las texturas locales. Ejecuta "npm run assets:fetch" en simulation/.'
  const response = await fetch(`${CONTENT_BASE}textures/index.json`)
  // El servidor de Vite responde index.html con 200 a las rutas inexistentes: sin este control
  // el usuario vería un error de JSON en vez del aviso de que faltan las texturas.
  if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) throw new Error(missing)
  try {
    return await response.json() as TextureIndex
  } catch {
    throw new Error(missing)
  }
}

function pickResolution(available: readonly TextureResolution[], wanted: TextureResolution): TextureResolution {
  const order: TextureResolution[] = ['1k', '2k', '4k']
  const target = order.indexOf(wanted)
  for (let index = target; index >= 0; index--) if (available.includes(order[index])) return order[index]
  return available[0]
}

const loader = new THREE.TextureLoader()

function loadTexture(url: string, colorSpace: THREE.ColorSpace, anisotropy: number): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(url, texture => {
      texture.wrapS = THREE.RepeatWrapping
      texture.wrapT = THREE.RepeatWrapping
      texture.colorSpace = colorSpace
      texture.anisotropy = anisotropy
      texture.generateMipmaps = true
      texture.minFilter = THREE.LinearMipmapLinearFilter
      resolve(texture)
    }, undefined, () => reject(new Error(`No se pudo cargar ${url}`)))
  })
}

export async function loadPbrSet(index: TextureIndex, role: string, resolution: TextureResolution, anisotropy: number): Promise<PbrSet> {
  const entry = index.textures.find(item => item.role === role)
  if (!entry) throw new Error(`Falta la textura con rol ${role} en content/textures/index.json.`)
  const chosen = pickResolution(entry.resolutions, resolution)
  const url = (map: string) => `${CONTENT_BASE}textures/${index.pathTemplate.replace('{id}', entry.id).replace('{resolution}', chosen).replace('{map}', map)}`
  const [albedo, normal, arm] = await Promise.all([
    loadTexture(url('albedo'), THREE.SRGBColorSpace, anisotropy),
    loadTexture(url('normal'), THREE.NoColorSpace, anisotropy),
    loadTexture(url('arm'), THREE.NoColorSpace, anisotropy),
  ])
  return { id: entry.id, albedo, normal, arm, scale: 1000 / entry.dimensionsMm[0] }
}

export function disposePbrSet(set: PbrSet): void {
  set.albedo.dispose()
  set.normal.dispose()
  set.arm.dispose()
}
