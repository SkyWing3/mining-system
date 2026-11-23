import { useEffect, useMemo } from 'react'
import type * as THREE from 'three'
import type { BakedChunk } from '@twin/mine-generator'
import { chunkGeometry } from '../geometry/chunkGeometry.ts'

/** Un fragmento por componente: los fragmentos que llegan después no rehacen los anteriores. */
function RockChunk({ chunk, material }: { chunk: BakedChunk; material: THREE.Material }) {
  const geometry = useMemo(() => chunkGeometry(chunk), [chunk])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry} material={material} castShadow receiveShadow name={geometry.name} />
}

export function RockChunks({ chunks, material }: { chunks: readonly BakedChunk[]; material: THREE.Material }) {
  return (
    <group name="roca">
      {chunks.map(chunk => <RockChunk key={chunk.key} chunk={chunk} material={material} />)}
    </group>
  )
}
