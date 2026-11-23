import { Canvas } from '@react-three/fiber'
import type { GalleryLayout } from '@twin/shared-types'
import { QUALITY_PROFILES } from '@twin/graphics-engine'
import layoutJson from '../../../config/galeria-validacion.json'
import { GalleryScene } from './scene/GalleryScene.tsx'
import { useTwin } from './state/store.ts'
import { Hud } from './ui/Hud.tsx'

const layout = layoutJson as unknown as GalleryLayout

export default function App() {
  const quality = useTwin(state => state.quality)
  const profile = QUALITY_PROFILES[quality]
  return (
    <div className="relative h-full w-full select-none">
      <Canvas
        className="absolute inset-0"
        dpr={[1, profile.maxDpr]}
        shadows
        gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
        camera={{ fov: 68, near: 0.05, far: 900, position: [40, 80, 120] }}
        data-testid="twin-canvas"
      >
        <GalleryScene layout={layout} profile={profile} />
      </Canvas>
      <Hud layoutName="Galería de validación" />
    </div>
  )
}
