import * as THREE from 'three'
import type { BakedChunk } from '@twin/mine-generator'

/** Convierte un fragmento generado en geometría de three.js (sin copiar los arreglos). */
export function chunkGeometry(chunk: BakedChunk): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(chunk.positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(chunk.normals, 3))
  geometry.setAttribute('aMaskA', new THREE.BufferAttribute(chunk.maskA, 4))
  geometry.setAttribute('aMaskB', new THREE.BufferAttribute(chunk.maskB, 2))
  geometry.setAttribute('aBaked', new THREE.BufferAttribute(chunk.baked, 3))
  geometry.setAttribute('aBakedDir', new THREE.BufferAttribute(chunk.bakedDir, 3))
  geometry.setIndex(new THREE.BufferAttribute(chunk.indices, 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  geometry.name = `roca ${chunk.key}`
  return geometry
}
