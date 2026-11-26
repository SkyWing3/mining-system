// Recorte por distancia para una mina grande. Bajo tierra la niebla oculta todo lo que
// está a más de ~80 m y la roca tapa los otros niveles, pero three.js solo descarta lo
// que queda fuera del frustum: sin este recorte se dibujarían cientos de fragmentos y
// miles de piezas de infraestructura que están detrás de la roca.
import * as THREE from 'three'

export interface CullLimits {
  /** Distancia máxima desde la cámara hasta el borde de la esfera envolvente (m). */
  readonly distance: number
  /** Diferencia de cota máxima: más arriba o más abajo hay roca entre niveles (m). */
  readonly rise: number
}

/** Límites bajo tierra: alcance de la niebla y separación entre niveles. */
export const UNDERGROUND_CULL: CullLimits = { distance: 90, rise: 11 }

interface Entry {
  readonly object: THREE.Object3D
  readonly center: THREE.Vector3
  readonly radius: number
}

/** ¿La esfera (centro, radio) está a la vista desde `eye` con estos límites? */
export function withinCull(eye: THREE.Vector3, center: THREE.Vector3, radius: number, limits: CullLimits): boolean {
  if (center.distanceTo(eye) - radius > limits.distance) return false
  // Por cota: la esfera puede abarcar varios metros (rampas); se usa su extremo más cercano.
  return Math.abs(center.y - eye.y) - radius <= limits.rise
}

/** Recorta las mallas estáticas de un grupo (infraestructura) según su esfera envolvente en el mundo. */
export class DistanceCuller {
  private readonly entries: Entry[] = []

  constructor(root: THREE.Object3D) {
    root.updateMatrixWorld(true)
    const sphere = new THREE.Sphere()
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      if (object instanceof THREE.InstancedMesh) {
        if (!object.boundingSphere) object.computeBoundingSphere()
        sphere.copy(object.boundingSphere!)
      } else {
        if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere()
        sphere.copy(object.geometry.boundingSphere!)
      }
      sphere.applyMatrix4(object.matrixWorld)
      this.entries.push({ object, center: sphere.center.clone(), radius: sphere.radius })
    })
  }

  update(eye: THREE.Vector3, limits: CullLimits | null): void {
    for (const entry of this.entries) entry.object.visible = limits === null || withinCull(eye, entry.center, entry.radius, limits)
  }
}
