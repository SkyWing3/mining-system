import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { GalleryLayout } from '@twin/shared-types'
import { DiagnosticsProbe, Dust, Effects, Infrastructure, LampPool, RockChunks, UNDERGROUND_CULL, type QualityProfile } from '@twin/graphics-engine'
import { stepDevice, useDevice } from '../device/runtime.ts'
import { useGallery } from '../generation/useGallery.ts'
import { useTwin } from '../state/store.ts'
import { CameraRig } from './CameraRig.tsx'
import { PlainRenderer, SceneEnvironment } from './SceneEnvironment.tsx'
import { useMaterials } from './useMaterials.ts'
import { Warmup } from './Warmup.tsx'

export function GalleryScene({ layout, profile }: { layout: GalleryLayout; profile: QualityProfile }) {
  const gallery = useGallery(layout, profile)
  const { materials, error } = useMaterials(profile)
  const headlamp = useTwin(state => state.headlamp && state.cameraMode !== 'orbit')
  const underground = useTwin(state => state.cameraMode !== 'orbit')
  const disabledAccessPoints = useDevice(state => state.disabledAccessPoints)
  const setDiagnostics = useTwin(state => state.setDiagnostics)
  const setAssetError = useTwin(state => state.setAssetError)
  const pool = useMemo(() => new LampPool(gallery.infrastructure.lamps), [gallery.infrastructure])

  useEffect(() => setAssetError(error), [error, setAssetError])
  useFrame(({ camera }) => pool.update(camera.position, profile.lampPool), -10)
  // Manilla simulada y ambiente: avanzan con el tiempo de la escena.
  useFrame((_, delta) => stepDevice(delta, useTwin.getState().sound), -15)

  return (
    <>
      <SceneEnvironment profile={profile} />
      {/* Bajo tierra la niebla oculta lo lejano y la roca separa los niveles: no se dibujan. */}
      {materials ? <RockChunks chunks={gallery.chunks} material={materials.rock} cull={underground ? UNDERGROUND_CULL : null} /> : null}
      {materials ? <Infrastructure data={gallery.infrastructure} materials={materials.props} disabledAccessPoints={disabledAccessPoints} cull={underground ? UNDERGROUND_CULL : null} /> : null}
      <CameraRig compiled={gallery.generator.compiled} collider={gallery.collider} profile={profile} />
      <Dust count={profile.dustParticles} headlamp={headlamp} visible={underground} />
      {profile.postprocessing ? <Effects profile={profile} /> : <PlainRenderer />}
      <DiagnosticsProbe onSample={setDiagnostics} />
      <Warmup ready={Boolean(materials && gallery.collider)} />
    </>
  )
}
