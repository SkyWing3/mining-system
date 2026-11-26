import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type * as THREE from 'three'
import type { BakedChunk } from '@twin/mine-generator'
import { withinCull, type CullLimits } from '../culling.ts'
import { chunkGeometry } from '../geometry/chunkGeometry.ts'

/** Un fragmento por componente: los fragmentos que llegan después no rehacen los anteriores. */
function RockChunk({ chunk, material }: { chunk: BakedChunk; material: THREE.Material }) {
  const geometry = useMemo(() => chunkGeometry(chunk), [chunk])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry} material={material} castShadow receiveShadow name={geometry.name} />
}

/**
 * Roca de la mina. Con `cull` se ocultan los fragmentos más lejanos que la niebla
 * subterránea y los de otros niveles: en una mina de casi 2 km evita dibujar cientos de
 * fragmentos que el frustum no descarta porque están detrás de la roca.
 */
export function RockChunks({ chunks, material, cull }: { chunks: readonly BakedChunk[]; material: THREE.Material; cull?: CullLimits | null }) {
  const group = useRef<THREE.Group>(null)
  const frame = useRef(0)
  useFrame(({ camera }) => {
    const root = group.current
    if (!root) return
    // Cada 4 fotogramas basta: el minero recorre pocos centímetros entre revisiones.
    if (frame.current++ % 4 !== 0 && cull) return
    for (const child of root.children) {
      const mesh = child as THREE.Mesh
      const sphere = mesh.geometry?.boundingSphere
      if (!sphere) continue
      mesh.visible = !cull || withinCull(camera.position, sphere.center, sphere.radius, cull)
    }
  })
  return (
    <group name="roca" ref={group}>
      {chunks.map(chunk => <RockChunk key={chunk.key} chunk={chunk} material={material} />)}
    </group>
  )
}
