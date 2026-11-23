// Iluminación de luminarias fijas sin luces de three.js (ADR-006):
// - la roca recibe la luz difusa horneada por vértice (con sombras suaves) y aquí solo
//   se agrega el brillo especular de las luminarias más cercanas a la cámara;
// - los objetos no horneados (rieles, madera, tuberías, maquinaria) reciben difusa y
//   especular de esas mismas luminarias.
// Todas las variantes comparten los mismos uniformes, actualizados una vez por fotograma.
import * as THREE from 'three'

export const MAX_LAMP_POOL = 16

export interface LampSource {
  readonly position: readonly [number, number, number]
  readonly color: readonly [number, number, number]
  readonly intensity: number
  readonly range: number
}

export const lampUniforms = {
  uLampPosition: { value: Array.from({ length: MAX_LAMP_POOL }, () => new THREE.Vector3()) },
  /** rgb = color × intensidad (cd), a = alcance (m). */
  uLampColor: { value: Array.from({ length: MAX_LAMP_POOL }, () => new THREE.Vector4()) },
}

/** Elige las luminarias más cercanas a la cámara y desvanece las que salen del grupo. */
export class LampPool {
  private readonly lamps: readonly LampSource[]
  private readonly order: number[]
  private readonly scratch = new THREE.Vector3()

  constructor(lamps: readonly LampSource[]) {
    this.lamps = lamps
    this.order = lamps.map((_, index) => index)
  }

  update(camera: THREE.Vector3, size: number): void {
    const lamps = this.lamps
    const distance = (index: number) => {
      const p = lamps[index].position
      return this.scratch.set(p[0], p[1], p[2]).distanceToSquared(camera)
    }
    // Inserción sobre el orden anterior: casi ordenado entre fotogramas.
    const order = this.order
    for (let i = 1; i < order.length; i++) {
      const item = order[i]
      const d = distance(item)
      let j = i - 1
      while (j >= 0 && distance(order[j]) > d) { order[j + 1] = order[j]; j-- }
      order[j + 1] = item
    }
    const count = Math.min(size, MAX_LAMP_POOL)
    const farthest = order.length > count ? Math.sqrt(distance(order[count])) : Infinity
    for (let slot = 0; slot < MAX_LAMP_POOL; slot++) {
      const color = lampUniforms.uLampColor.value[slot]
      if (slot >= count || slot >= order.length) { color.set(0, 0, 0, 1); continue }
      const lamp = lamps[order[slot]]
      const p = lamp.position
      lampUniforms.uLampPosition.value[slot].set(p[0], p[1], p[2])
      // Desvanecimiento al acercarse al límite del grupo para evitar saltos.
      const d = Math.sqrt(distance(order[slot]))
      const fade = Number.isFinite(farthest) ? THREE.MathUtils.clamp((farthest - d) / 6, 0, 1) : 1
      color.set(lamp.color[0] * lamp.intensity * fade, lamp.color[1] * lamp.intensity * fade, lamp.color[2] * lamp.intensity * fade, lamp.range)
    }
  }
}

export const LAMP_PARS = /* glsl */ `
uniform vec3 uLampPosition[${MAX_LAMP_POOL}];
uniform vec4 uLampColor[${MAX_LAMP_POOL}];
varying vec3 vLampWorldPosition;
`

/**
 * Bucle de luminarias. Requiere el ámbito de lights_fragment_end (material, normal,
 * geometryViewDir, reflectedLight). `specularMask` permite apagar el brillo en zonas
 * que la luz horneada marca en sombra.
 */
export function lampLoop(diffuse: boolean, specularMask = '1.0'): string {
  return /* glsl */ `
  for (int i = 0; i < LAMP_COUNT; i++) {
    vec4 lampColor = uLampColor[i];
    if (lampColor.r + lampColor.g + lampColor.b <= 0.0) continue;
    vec3 toLamp = uLampPosition[i] - vLampWorldPosition;
    float lampDistance = length(toLamp);
    float lampWindow = clamp(1.0 - pow(lampDistance / lampColor.a, 4.0), 0.0, 1.0);
    lampWindow *= lampWindow;
    vec3 lampDir = normalize((viewMatrix * vec4(toLamp / max(lampDistance, 1e-4), 0.0)).xyz);
    float lampNdl = saturate(dot(normal, lampDir));
    vec3 lampIrradiance = lampColor.rgb * lampNdl * lampWindow / (lampDistance * lampDistance + 0.6);
    reflectedLight.directSpecular += lampIrradiance * BRDF_GGX(lampDir, geometryViewDir, normal, material) * (${specularMask});
    ${diffuse ? 'reflectedLight.directDiffuse += lampIrradiance * BRDF_Lambert(material.diffuseContribution);' : ''}
  }
`
}

/**
 * Agrega iluminación de luminarias a un material estándar de three (objetos no horneados).
 * Conserva mapas, niebla, sombras de la linterna y el resto del sombreado PBR.
 */
export function withLampLighting<T extends THREE.MeshStandardMaterial>(material: T, poolSize: number, instanced = true): T {
  const count = Math.max(1, Math.min(poolSize, MAX_LAMP_POOL))
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, lampUniforms)
    shader.defines = { ...shader.defines, LAMP_COUNT: count }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vLampWorldPosition;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
  {
    vec4 lampWorld = vec4(transformed, 1.0);
    ${instanced ? '#ifdef USE_INSTANCING\n    lampWorld = instanceMatrix * lampWorld;\n    #endif' : ''}
    vLampWorldPosition = (modelMatrix * lampWorld).xyz;
  }`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${LAMP_PARS}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${lampLoop(true)}`)
  }
  material.customProgramCacheKey = () => `lamps-${count}-${instanced}`
  material.needsUpdate = true
  return material
}
