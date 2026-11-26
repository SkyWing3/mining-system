import { Canvas } from '@react-three/fiber'
import { QUALITY_PROFILES } from '@twin/graphics-engine'
import { layout, layoutTitle } from './layout.ts'
import { GalleryScene } from './scene/GalleryScene.tsx'
import { useTwin } from './state/store.ts'
import { Hud } from './ui/Hud.tsx'

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
        camera={{ fov: 68, near: 0.05, far: 1400, position: [40, 80, 120] }}
        data-testid="twin-canvas"
      >
        <GalleryScene layout={layout} profile={profile} />
      </Canvas>
      <Hud layoutName={layoutTitle} />
    </div>
  )
}
