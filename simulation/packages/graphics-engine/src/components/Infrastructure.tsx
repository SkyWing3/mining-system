// Infraestructura instanciada: un draw call por tipo de pieza.
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Infrastructure as InfrastructureData, PathSpec, Placement } from '@twin/mine-generator'
import {
  boltGeometry, bulkheadGeometry, lampHousingGeometry, lampLensGeometry, laggingGeometry, pipeBracketGeometry,
  refugeDoorGeometry, signBackGeometry, signPlateGeometry, sleeperGeometry, steelArchGeometry, timberCapGeometry, timberPostGeometry,
} from '../geometry/props.ts'
import { RAIL_PROFILE, sweepProfile, toVectors, uprightFrame } from '../geometry/sweep.ts'
import type { PropMaterials } from '../materials/propMaterials.ts'
import { createSignTexture } from '../signs.ts'

const matrix = new THREE.Matrix4()
const position = new THREE.Vector3()
const quaternion = new THREE.Quaternion()
const scale = new THREE.Vector3()

function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, placements: readonly Placement[], name: string, offset?: THREE.Vector3): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(placements.length, 1))
  mesh.count = placements.length
  mesh.name = name
  placements.forEach((placement, index) => {
    position.fromArray(placement.position)
    quaternion.fromArray(placement.quaternion)
    if (offset) position.add(offset.clone().applyQuaternion(quaternion))
    scale.fromArray(placement.scale)
    mesh.setMatrixAt(index, matrix.compose(position, quaternion, scale))
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.computeBoundingSphere()
  return mesh
}

function tubes(paths: readonly PathSpec[], radialSegments: number, uvPerMeter: number, radiusOverride?: number): THREE.BufferGeometry | null {
  const parts = paths.filter(path => path.points.length >= 6).map(path => {
    const curve = new THREE.CatmullRomCurve3(toVectors(path.points), false, 'centripetal')
    const length = curve.getLength()
    const geometry = new THREE.TubeGeometry(curve, Math.max(4, Math.ceil(length / 0.35)), radiusOverride ?? path.radius, radialSegments, false)
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute
    for (let index = 0; index < uv.count; index++) uv.setX(index, uv.getX(index) * length * uvPerMeter)
    return geometry
  })
  if (parts.length === 0) return null
  return mergeGeometries(parts, false)
}

export function Infrastructure({ data, materials }: { data: InfrastructureData; materials: PropMaterials }) {
  const group = useMemo(() => {
    const root = new THREE.Group()
    root.name = 'infraestructura'
    const add = (object: THREE.Object3D | null) => { if (object) root.add(object) }
    const mesh = (geometry: THREE.BufferGeometry | null, material: THREE.Material, name: string) => {
      if (!geometry) return null
      const object = new THREE.Mesh(geometry, material)
      object.name = name
      object.castShadow = true
      object.receiveShadow = true
      return object
    }

    // Vía: rieles barridos y durmientes.
    const rails = data.rails.filter(rail => rail.points.length >= 6).map(rail => sweepProfile(toVectors(rail.points), RAIL_PROFILE, uprightFrame, 1))
    add(mesh(rails.length ? mergeGeometries(rails, false) : null, materials.railSteel, 'rieles'))
    add(instanced(sleeperGeometry(), materials.timber, data.sleepers, 'durmientes'))

    // Servicios: aire comprimido (pintado), agua (acero), ducto flexible y cables.
    add(mesh(tubes(data.airPipes, 12, 1), materials.painted, 'tubería de aire'))
    add(mesh(tubes(data.waterPipes, 10, 1), materials.waterPipe, 'tubería de agua'))
    add(instanced(pipeBracketGeometry(), materials.steel, data.pipeBrackets, 'ménsulas'))
    add(mesh(tubes(data.ducts, 20, 3.2), materials.duct, 'ducto de ventilación'))
    add(mesh(tubes(data.cables, 6, 1), materials.cable, 'cables'))

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
    const lenses = instanced(lampLensGeometry(), materials.lens, fixtures, 'difusores', lift)
    lenses.castShadow = false
    data.lamps.forEach((lamp, index) => lenses.setColorAt(index, new THREE.Color(...lamp.color)))
    if (lenses.instanceColor) lenses.instanceColor.needsUpdate = true
    add(lenses)

    // Letreros.
    for (const [index, sign] of data.signs.entries()) {
      const texture = createSignTexture(sign.kind, 9000 + index)
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
    return root
  }, [data, materials])

  useEffect(() => () => {
    group.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose()
        if (object instanceof THREE.InstancedMesh) object.dispose()
      }
    })
  }, [group])

  return <primitive object={group} />
}
