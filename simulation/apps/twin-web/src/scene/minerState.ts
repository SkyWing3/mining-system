// Estado del minero compartido entre el control de cámara, la manilla y la interfaz.
// Es mutable y se actualiza en cada fotograma (no pasa por React).
import * as THREE from 'three'

export const miner = {
  /** Pies del minero (punto inferior de la cápsula de colisión). */
  position: new THREE.Vector3(),
  /** Orientación del cuerpo (guiñada, rad). */
  bodyYaw: 0,
  /** Velocidad horizontal medida (m/s). */
  speed: 0,
  spawned: false,
  /** Distancia recorrida desde el inicio (m). */
  distance: 0,
  /** Mirada de la cámara: guiñada y cabeceo (rad). */
  look: { yaw: 0, pitch: -0.12 },
}

/** Altura de la manilla sobre los pies con el brazo en reposo (m). */
export const BRACELET_HEIGHT = 1.0
