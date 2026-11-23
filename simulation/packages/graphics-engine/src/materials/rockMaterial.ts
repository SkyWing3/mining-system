// Material de roca de las galerías: PBR triplanar (sin coordenadas UV) con capas de
// roca volada, roca oxidada, piso de barro y concreto lanzado, mezcladas con máscaras
// por vértice generadas por mine-generator. Agrega humedad, suciedad, oclusión y la luz
// horneada de las luminarias, conservando el sombreado físico de MeshStandardMaterial.
import * as THREE from 'three'
import type { PbrSet } from '../textures.ts'
import { LAMP_PARS, lampLoop, lampUniforms, MAX_LAMP_POOL } from './lampLighting.ts'

export interface RockLayers {
  readonly rock: PbrSet
  readonly oxidized: PbrSet
  readonly floor: PbrSet
  readonly shotcrete: PbrSet
}

export interface RockMaterialOptions {
  readonly oxidizedLayer: boolean
  readonly lampPool: number
}

export interface RockUniforms {
  readonly uWetness: { value: number }
  readonly uBakedIntensity: { value: number }
}

const TRIPLANAR = /* glsl */ `
struct RockSurface { vec3 albedo; vec3 normal; vec3 arm; };

vec3 rockBlendWeights(vec3 n) {
  vec3 w = pow(abs(n), vec3(6.0));
  return w / (w.x + w.y + w.z);
}

// Mapeo triplanar con mezcla "whiteout" de normales, adaptado de Ben Golus,
// "Normal Mapping for a Triplanar Shader" (Unlicense, dominio público):
// https://github.com/bgolus/Normal-Mapping-for-a-Triplanar-Shader
RockSurface sampleTriplanar(sampler2D albedoMap, sampler2D normalMap, sampler2D armMap, vec3 p, vec3 n, vec3 w, float scale) {
  vec2 uvX = p.zy * scale;
  vec2 uvY = p.xz * scale;
  vec2 uvZ = p.xy * scale;
  vec3 axisSign = sign(n);
  uvX.x *= axisSign.x;
  uvY.x *= axisSign.y;
  uvZ.x *= -axisSign.z;
  RockSurface s;
  s.albedo = texture2D(albedoMap, uvX).rgb * w.x + texture2D(albedoMap, uvY).rgb * w.y + texture2D(albedoMap, uvZ).rgb * w.z;
  s.arm = texture2D(armMap, uvX).rgb * w.x + texture2D(armMap, uvY).rgb * w.y + texture2D(armMap, uvZ).rgb * w.z;
  vec3 tnX = texture2D(normalMap, uvX).xyz * 2.0 - 1.0;
  vec3 tnY = texture2D(normalMap, uvY).xyz * 2.0 - 1.0;
  vec3 tnZ = texture2D(normalMap, uvZ).xyz * 2.0 - 1.0;
  tnX.x *= axisSign.x;
  tnY.x *= axisSign.y;
  tnZ.x *= -axisSign.z;
  // Whiteout: el signo de la componente normal lo aporta la superficie (abs(tn.z) * n).
  tnX = vec3(tnX.xy + n.zy, abs(tnX.z) * n.x);
  tnY = vec3(tnY.xy + n.xz, abs(tnY.z) * n.y);
  tnZ = vec3(tnZ.xy + n.xy, abs(tnZ.z) * n.z);
  s.normal = normalize(tnX.zyx * w.x + tnY.xzy * w.y + tnZ.xyz * w.z);
  return s;
}

RockSurface mixSurface(RockSurface a, RockSurface b, float t) {
  RockSurface r;
  r.albedo = mix(a.albedo, b.albedo, t);
  r.arm = mix(a.arm, b.arm, t);
  r.normal = normalize(mix(a.normal, b.normal, t));
  return r;
}
`

export function createRockMaterial(layers: RockLayers, options: RockMaterialOptions): { material: THREE.MeshStandardMaterial; uniforms: RockUniforms } {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 })
  const uniforms: RockUniforms = { uWetness: { value: 1 }, uBakedIntensity: { value: 1 } }
  const count = Math.max(1, Math.min(options.lampPool, MAX_LAMP_POOL))
  // Las texturas viajan en uniformes propios: se registran para precalentar y medir memoria.
  material.userData.textures = [layers.rock, layers.oxidized, layers.floor, layers.shotcrete].flatMap(set => [set.albedo, set.normal, set.arm])
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, lampUniforms, uniforms, {
      uRockAlbedo: { value: layers.rock.albedo }, uRockNormal: { value: layers.rock.normal }, uRockArm: { value: layers.rock.arm }, uRockScale: { value: layers.rock.scale },
      uOxAlbedo: { value: layers.oxidized.albedo }, uOxNormal: { value: layers.oxidized.normal }, uOxArm: { value: layers.oxidized.arm }, uOxScale: { value: layers.oxidized.scale * 0.8 },
      uFloorAlbedo: { value: layers.floor.albedo }, uFloorNormal: { value: layers.floor.normal }, uFloorArm: { value: layers.floor.arm }, uFloorScale: { value: layers.floor.scale },
      uScAlbedo: { value: layers.shotcrete.albedo }, uScNormal: { value: layers.shotcrete.normal }, uScArm: { value: layers.shotcrete.arm }, uScScale: { value: layers.shotcrete.scale },
    })
    shader.defines = { ...shader.defines, LAMP_COUNT: count, ...(options.oxidizedLayer ? { OXIDIZED_LAYER: '' } : {}) }

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */ `#include <common>
attribute vec4 aMaskA;
attribute vec2 aMaskB;
attribute vec3 aBaked;
attribute vec3 aBakedDir;
varying vec3 vRockWorldPosition;
varying vec3 vRockWorldNormal;
varying vec4 vMaskA;
varying vec2 vMaskB;
varying vec3 vBaked;
varying vec3 vBakedDir;
varying vec3 vLampWorldPosition;`)
      .replace('#include <worldpos_vertex>', /* glsl */ `#include <worldpos_vertex>
  vRockWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vLampWorldPosition = vRockWorldPosition;
  vRockWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
  vMaskA = aMaskA;
  vMaskB = aMaskB;
  vBaked = aBaked;
  vBakedDir = aBakedDir;`)

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
${LAMP_PARS}
uniform sampler2D uRockAlbedo; uniform sampler2D uRockNormal; uniform sampler2D uRockArm; uniform float uRockScale;
uniform sampler2D uOxAlbedo; uniform sampler2D uOxNormal; uniform sampler2D uOxArm; uniform float uOxScale;
uniform sampler2D uFloorAlbedo; uniform sampler2D uFloorNormal; uniform sampler2D uFloorArm; uniform float uFloorScale;
uniform sampler2D uScAlbedo; uniform sampler2D uScNormal; uniform sampler2D uScArm; uniform float uScScale;
uniform float uWetness;
uniform float uBakedIntensity;
varying vec3 vRockWorldPosition;
varying vec3 vRockWorldNormal;
varying vec4 vMaskA;
varying vec2 vMaskB;
varying vec3 vBaked;
varying vec3 vBakedDir;
${TRIPLANAR}`)
      .replace('#include <map_fragment>', /* glsl */ `
  vec3 rockGeomNormal = normalize(vRockWorldNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 rockWeights = rockBlendWeights(rockGeomNormal);
  vec3 rockP = vRockWorldPosition;
  RockSurface surface = sampleTriplanar(uRockAlbedo, uRockNormal, uRockArm, rockP, rockGeomNormal, rockWeights, uRockScale);
  // Variación de baja frecuencia: rompe la repetición de la textura.
  float macroVariation = dot(texture2D(uRockAlbedo, rockP.xz * uRockScale * 0.071 + rockP.y * 0.031).rgb, vec3(0.333));
  surface.albedo *= mix(0.78, 1.18, macroVariation);
  // Sin ramas: el muestreo con derivadas implícitas debe ocurrir en flujo uniforme.
  #ifdef OXIDIZED_LAYER
  RockSurface oxidized = sampleTriplanar(uOxAlbedo, uOxNormal, uOxArm, rockP + vec3(17.3, 5.1, 9.7), rockGeomNormal, rockWeights, uOxScale);
  surface = mixSurface(surface, oxidized, vMaskA.z * 0.7);
  #endif
  RockSurface shotcrete = sampleTriplanar(uScAlbedo, uScNormal, uScArm, rockP, rockGeomNormal, rockWeights, uScScale);
  shotcrete.albedo *= vec3(0.86, 0.85, 0.82);
  surface = mixSurface(surface, shotcrete, vMaskA.y);
  // Piso: proyección superior.
  vec2 floorUv = rockP.xz * uFloorScale;
  RockSurface floorSurface;
  floorSurface.albedo = texture2D(uFloorAlbedo, floorUv).rgb * vec3(0.8, 0.72, 0.62);
  floorSurface.arm = texture2D(uFloorArm, floorUv).rgb;
  vec3 floorTangent = texture2D(uFloorNormal, floorUv).xyz * 2.0 - 1.0;
  floorTangent.x *= sign(rockGeomNormal.y);
  vec3 floorBlend = vec3(floorTangent.xy + rockGeomNormal.xz, abs(floorTangent.z) * rockGeomNormal.y);
  floorSurface.normal = normalize(floorBlend.xzy);
  // Transición por altura: las piedras del piso asoman sobre el barro.
  float floorHeight = floorSurface.arm.r;
  float floorWeight = smoothstep(0.15, 0.85, vMaskA.x + (floorHeight - 0.5) * 0.5) * smoothstep(0.5, 0.82, rockGeomNormal.y);
  surface = mixSurface(surface, floorSurface, floorWeight);
  // Salpicaduras de barro en la parte baja de los hastiales.
  surface.albedo = mix(surface.albedo, floorSurface.albedo * 0.72, vMaskB.x * 0.55 * (1.0 - floorWeight));
  // Humedad: oscurece el albedo, reduce la rugosidad y forma charcos en el piso.
  // La textura (cavidades) quiebra el borde interpolado por vértice de la máscara.
  float wet = clamp((vMaskA.w * uWetness) * 1.3 - (1.0 - surface.arm.r) * 0.45, 0.0, 1.0);
  float puddle = smoothstep(0.6, 0.9, wet) * floorWeight;
  surface.albedo *= mix(1.0, 0.68, wet);
  surface.albedo = mix(surface.albedo, surface.albedo * vec3(0.7, 0.68, 0.66), puddle);
  float rockRoughness = mix(surface.arm.g, 0.32, wet * 0.8);
  rockRoughness = mix(rockRoughness, 0.09, puddle);
  vec3 rockShadingNormal = normalize(mix(surface.normal, rockGeomNormal, puddle * 0.92));
  float rockOcclusion = mix(1.0, surface.arm.r, 0.85) * vMaskB.y;
  diffuseColor.rgb *= surface.albedo;
`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = rockRoughness;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(rockShadingNormal, 0.0)).xyz);')
      .replace('#include <lights_fragment_end>', /* glsl */ `#include <lights_fragment_end>
  {
    // Luz horneada de las luminarias, con el detalle del mapa de normales.
    float geomNdl = max(dot(rockGeomNormal, vBakedDir), 0.25);
    float detailNdl = max(dot(rockShadingNormal, vBakedDir), 0.0);
    float detail = clamp(detailNdl / geomNdl, 0.0, 1.8);
    reflectedLight.directDiffuse += vBaked * uBakedIntensity * detail * rockOcclusion * BRDF_Lambert(material.diffuseContribution);
    float bakedVisibility = smoothstep(0.0, 1.5, dot(vBaked, vec3(0.333)));
    ${lampLoop(false, '0.6 * bakedVisibility * rockOcclusion')}
  }`)
      .replace('#include <aomap_fragment>', /* glsl */ `
  reflectedLight.indirectDiffuse *= rockOcclusion;
  reflectedLight.indirectSpecular *= rockOcclusion;`)
  }
  material.customProgramCacheKey = () => `rock-${count}-${options.oxidizedLayer}`
  return { material, uniforms }
}
