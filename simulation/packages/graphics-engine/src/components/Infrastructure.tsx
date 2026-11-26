// Infraestructura instanciada y dividida por zonas.
//
// Cada tipo de pieza se instancia por celdas de ~40 m y los tubos y rieles se parten en
// tramos de hasta ~48 m. En la galería de validación eso cambia poco, pero en la mina
// de casi 2 km permite que el frustum y el recorte por distancia descarten lo que está
// lejos o en el otro nivel, en vez de dibujar siempre la infraestructura de toda la mina.
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { Infrastructure as InfrastructureData, PathSpec, Placement } from '@twin/mine-generator'
import { DistanceCuller, type CullLimits } from '../culling.ts'
import {
  accessPointGeometry, accessPointLedGeometry, boltGeometry, bulkheadGeometry, lampHousingGeometry, lampLensGeometry, laggingGeometry, pipeBracketGeometry,
  refugeDoorGeometry, signBackGeometry, signPlateGeometry, sleeperGeometry, steelArchGeometry, timberCapGeometry, timberPostGeometry,
} from '../geometry/props.ts'
import { RAIL_PROFILE, sweepProfile, toVectors, uprightFrame } from '../geometry/sweep.ts'
import type { PropMaterials } from '../materials/propMaterials.ts'
import { createSignTexture } from '../signs.ts'

const matrix = new THREE.Matrix4()
const position = new THREE.Vector3()
const quaternion = new THREE.Quaternion()
const scale = new THREE.Vector3()

/** Celda horizontal de instanciado (m) y altura de celda (separa los niveles). */
const CELL = 40
const CELL_HEIGHT = 12
/** Largo máximo de un tramo de tubo o riel (m). */
const PIECE = 48

function cellKey(p: readonly number[]): string {
  return `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL_HEIGHT)},${Math.floor(p[2] / CELL)}`
}

/** Instancias de una pieza agrupadas por celda; `colors` (opcional) va por instancia. */
function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, placements: readonly Placement[], name: string, offset?: THREE.Vector3, colors?: readonly THREE.Color[]): THREE.Group {
  const group = new THREE.Group()
  group.name = name
  const cells = new Map<string, number[]>()
  placements.forEach((placement, index) => {
    const key = cellKey(placement.position)
    const list = cells.get(key)
    if (list) list.push(index)
    else cells.set(key, [index])
  })
  for (const indices of cells.values()) {
    const mesh = new THREE.InstancedMesh(geometry, material, indices.length)
    mesh.name = name
    indices.forEach((placementIndex, slot) => {
      const placement = placements[placementIndex]
      position.fromArray(placement.position)
      quaternion.fromArray(placement.quaternion)
      if (offset) position.add(offset.clone().applyQuaternion(quaternion))
      scale.fromArray(placement.scale)
      mesh.setMatrixAt(slot, matrix.compose(position, quaternion, scale))
      if (colors) mesh.setColorAt(slot, colors[placementIndex])
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.computeBoundingSphere()
    group.add(mesh)
  }
  return group
}

/** Parte una trayectoria (x, y, z intercalados) en tramos de hasta PIECE metros que comparten el extremo. */
function splitPath(points: readonly number[]): number[][] {
  const pieces: number[][] = []
  let current: number[] = [points[0], points[1], points[2]]
  let length = 0
  for (let index = 3; index < points.length; index += 3) {
    length += Math.hypot(points[index] - points[index - 3], points[index + 1] - points[index - 2], points[index + 2] - points[index - 1])
    current.push(points[index], points[index + 1], points[index + 2])
    if (length >= PIECE && index < points.length - 6) {
      pieces.push(current)
      current = [points[index], points[index + 1], points[index + 2]]
      length = 0
    }
  }
  if (current.length >= 6) pieces.push(current)
  return pieces
}

function tubes(paths: readonly PathSpec[], radialSegments: number, uvPerMeter: number, radiusOverride?: number): THREE.BufferGeometry[] {
  return paths.filter(path => path.points.length >= 6).flatMap(path => splitPath(path.points).map(points => {
    const curve = new THREE.CatmullRomCurve3(toVectors(points), false, 'centripetal')
    const length = curve.getLength()
    const geometry = new THREE.TubeGeometry(curve, Math.max(4, Math.ceil(length / 0.35)), radiusOverride ?? path.radius, radialSegments, false)
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute
    for (let index = 0; index < uv.count; index++) uv.setX(index, uv.getX(index) * length * uvPerMeter)
    return geometry
  }))
}

const LED_ON = new THREE.Color(0.25, 4, 0.9)
const LED_OFF = new THREE.Color(0.05, 0.05, 0.05)

/** Cadena colgada entre dos puntos con una flecha de catenaria. */
function chainGeometry(span: number, sag: number): THREE.BufferGeometry {
  const points: THREE.Vector3[] = []
  for (let index = 0; index <= 16; index++) {
    const t = index / 16
    points.push(new THREE.Vector3(0, -sag * 4 * t * (1 - t), (t - 0.5) * span))
  }
  const geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 32, 0.012, 6, false)
  // Franjas cada 12 cm a lo largo de la cadena.
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute
  for (let index = 0; index < uv.count; index++) uv.setX(index, uv.getX(index) * span / 0.24)
  return geometry
}

export function Infrastructure({ data, materials, disabledAccessPoints, cull }: { data: InfrastructureData; materials: PropMaterials; disabledAccessPoints?: ReadonlySet<string>; cull?: CullLimits | null }) {
  const group = useMemo(() => {
    const root = new THREE.Group()
    root.name = 'infraestructura'
    const add = (object: THREE.Object3D | null) => { if (object) root.add(object) }
    const meshes = (geometries: THREE.BufferGeometry[], material: THREE.Material, name: string) => {
      const group = new THREE.Group()
      group.name = name
      for (const geometry of geometries) {
        const object = new THREE.Mesh(geometry, material)
        object.name = name
        object.castShadow = true
        object.receiveShadow = true
        group.add(object)
      }
      return group
    }

    // Vía: rieles barridos y durmientes.
    const rails = data.rails.filter(rail => rail.points.length >= 6).flatMap(rail => splitPath(rail.points).map(points => sweepProfile(toVectors(points), RAIL_PROFILE, uprightFrame, 1)))
    add(meshes(rails, materials.railSteel, 'rieles'))
    add(instanced(sleeperGeometry(), materials.timber, data.sleepers, 'durmientes'))

    // Servicios: aire comprimido (pintado), agua (acero), ducto flexible y cables.
    add(meshes(tubes(data.airPipes, 12, 1), materials.painted, 'tubería de aire'))
    add(meshes(tubes(data.waterPipes, 10, 1), materials.waterPipe, 'tubería de agua'))
    add(instanced(pipeBracketGeometry(), materials.steel, data.pipeBrackets, 'ménsulas'))
    add(meshes(tubes(data.ducts, 20, 3.2), materials.duct, 'ducto de ventilación'))
    add(meshes(tubes(data.cables, 6, 1), materials.cable, 'cables'))

    // Sostenimiento.
    add(instanced(timberPostGeometry(), materials.timber, data.timberPosts, 'postes'))
    add(instanced(timberCapGeometry(), materials.timber, data.timberCaps, 'sombreros'))
    add(instanced(laggingGeometry(), materials.timber, data.lagging, 'encostillado'))
    for (const set of data.arches) add(instanced(steelArchGeometry(set.profile), materials.steel, set.placements, 'arcos de acero'))
    add(instanced(boltGeometry(), materials.steel, data.bolts, 'pernos'))

    // Luminarias: carcasa y difusor emisivo (el color de cada lámpara va por instancia).
    const fixtures = data.lamps.map(lamp => lamp.placement)
    const lift = new THREE.Vector3(0, 0.17, 0)
    add(instanced(lampHousingGeometry(), materials.housing, fixtures, 'luminarias', lift))
    const lenses = instanced(lampLensGeometry(), materials.lens, fixtures, 'difusores', lift, data.lamps.map(lamp => new THREE.Color(...lamp.color)))
    lenses.traverse(object => { object.castShadow = false })
    add(lenses)

    // Letreros.
    for (const [index, sign] of data.signs.entries()) {
      const texture = createSignTexture(sign.kind, 9000 + index, sign.label)
      const plate = new THREE.Mesh(signPlateGeometry(), materials.sign(texture))
      const back = new THREE.Mesh(signBackGeometry(), materials.signBack)
      const holder = new THREE.Group()
      holder.name = `letrero ${sign.kind}`
      holder.position.fromArray(sign.placement.position)
      holder.quaternion.fromArray(sign.placement.quaternion)
      holder.add(plate, back)
      plate.receiveShadow = true
      back.castShadow = true
      root.add(holder)
    }

    // Refugio: tabique de concreto con puerta hermética.
    for (const refuge of data.refuges) {
      const holder = new THREE.Group()
      holder.name = 'refugio'
      holder.position.fromArray(refuge.placement.position)
      holder.quaternion.fromArray(refuge.placement.quaternion)
      const wall = new THREE.Mesh(bulkheadGeometry(refuge.profile), materials.concrete)
      const door = new THREE.Mesh(refugeDoorGeometry(), materials.door)
      for (const part of [wall, door]) { part.castShadow = true; part.receiveShadow = true }
      const texture = createSignTexture('refuge', 777)
      const sign = new THREE.Mesh(signPlateGeometry(), materials.sign(texture))
      sign.position.set(-0.17, 2.35, 0)
      sign.rotation.y = -Math.PI / 2
      holder.add(wall, door, sign)
      root.add(holder)
    }
    // Puntos de acceso Wi-Fi: carcasa instanciada y un LED propio por equipo (cambia de estado).
    const apGeometry = accessPointGeometry()
    const ledGeometry = accessPointLedGeometry()
    const leds = new Map<string, THREE.MeshBasicMaterial>()
    for (const ap of data.accessPoints) {
      const holder = new THREE.Group()
      holder.name = `punto de acceso ${ap.id}`
      holder.position.fromArray(ap.placement.position)
      holder.quaternion.fromArray(ap.placement.quaternion)
      const body = new THREE.Mesh(apGeometry, materials.apHousing)
      body.castShadow = true
      const ledMaterial = new THREE.MeshBasicMaterial({ color: LED_ON.clone() })
      leds.set(ap.id, ledMaterial)
      holder.add(body, new THREE.Mesh(ledGeometry, ledMaterial))
      root.add(holder)
    }
    root.userData.accessPointLeds = leds
    root.userData.sharedGeometries = [apGeometry, ledGeometry]

    // Cadenas de prohibición con letrero colgado a ambos lados.
    for (const [index, barrier] of data.barriers.entries()) {
      const holder = new THREE.Group()
      holder.name = `cadena ${barrier.id}`
      holder.position.fromArray(barrier.placement.position)
      holder.quaternion.fromArray(barrier.placement.quaternion)
      const chain = new THREE.Mesh(chainGeometry(barrier.span, 0.14), materials.chain)
      chain.castShadow = true
      holder.add(chain)
      const texture = createSignTexture('no-entry', 9500 + index)
      for (const facing of [-1, 1]) {
        const plate = new THREE.Mesh(signPlateGeometry(), materials.sign(texture))
        plate.rotation.y = facing * Math.PI / 2
        plate.position.set(facing * 0.004, -0.38, 0)
        plate.receiveShadow = true
        holder.add(plate)
      }
      root.add(holder)
    }
    return root
  }, [data, materials])

  // Recorte por distancia y por nivel (bajo tierra); en supervisión se ve todo.
  const culler = useMemo(() => new DistanceCuller(group), [group])
  useFrame(({ camera }) => culler.update(camera.position, cull ?? null))

  useEffect(() => {
    const leds = group.userData.accessPointLeds as Map<string, THREE.MeshBasicMaterial> | undefined
    leds?.forEach((material, id) => material.color.copy(disabledAccessPoints?.has(id) ? LED_OFF : LED_ON))
  }, [group, disabledAccessPoints])

  useEffect(() => () => {
    group.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose()
        if (object instanceof THREE.InstancedMesh) object.dispose()
      }
    })
    const leds = group.userData.accessPointLeds as Map<string, THREE.Material> | undefined
    leds?.forEach(material => material.dispose())
  }, [group])

  return <primitive object={group} />
}
