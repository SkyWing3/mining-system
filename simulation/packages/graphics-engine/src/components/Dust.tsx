// Polvo en suspensión: partículas en un volumen que acompaña a la cámara (envolvente),
// visibles sobre todo en el cono de la linterna. Es ambientación, no representa datos.
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mulberry32 } from '@twin/mine-generator'

const BOX = new THREE.Vector3(18, 8, 18)

export function Dust({ count, headlamp, visible = true }: { count: number; headlamp: boolean; visible?: boolean }) {
  const { geometry, material } = useMemo(() => {
    const random = mulberry32(4242)
    const positions = new Float32Array(count * 3)
    const seeds = new Float32Array(count)
    for (let index = 0; index < count; index++) {
      positions[index * 3] = random() * BOX.x
      positions[index * 3 + 1] = random() * BOX.y
      positions[index * 3 + 2] = random() * BOX.z
      seeds[index] = random()
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uBox: { value: BOX },
        uCamera: { value: new THREE.Vector3() },
        uForward: { value: new THREE.Vector3(0, 0, -1) },
        uHeadlamp: { value: 1 },
        uPixelRatio: { value: 1 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uBox; uniform vec3 uCamera; uniform vec3 uForward; uniform float uHeadlamp; uniform float uPixelRatio;
        attribute float aSeed;
        varying float vAlpha;
        void main() {
          vec3 drift = vec3(sin(uTime * 0.11 + aSeed * 40.0) * 0.35, uTime * (0.015 + aSeed * 0.02), cos(uTime * 0.09 + aSeed * 23.0) * 0.35);
          vec3 p = mod(position + drift - uCamera + uBox * 0.5, uBox) + uCamera - uBox * 0.5;
          vec4 view = viewMatrix * vec4(p, 1.0);
          vec3 toParticle = normalize(p - uCamera);
          float dist = length(p - uCamera);
          float cone = smoothstep(0.82, 0.97, dot(toParticle, uForward)) * uHeadlamp;
          float fade = smoothstep(0.3, 1.2, dist) * (1.0 - smoothstep(6.0, 9.0, dist));
          vAlpha = (0.025 + cone * 0.35) * fade * (0.4 + aSeed * 0.6);
          gl_PointSize = (5.0 + aSeed * 7.0) * uPixelRatio / max(-view.z, 0.1);
          gl_Position = projectionMatrix * view;
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = 1.0 - smoothstep(0.1, 0.5, length(c));
          gl_FragColor = vec4(vec3(0.82, 0.76, 0.66) * d * vAlpha, 1.0);
        }`,
    })
    return { geometry, material }
  }, [count])

  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])

  useFrame(({ camera, clock, gl }) => {
    material.uniforms.uTime.value = clock.elapsedTime
    material.uniforms.uCamera.value.copy(camera.position)
    camera.getWorldDirection(material.uniforms.uForward.value)
    material.uniforms.uHeadlamp.value = headlamp ? 1 : 0.15
    material.uniforms.uPixelRatio.value = gl.getPixelRatio()
  })

  return <points geometry={geometry} material={material} frustumCulled={false} visible={visible} name="polvo" />
}
