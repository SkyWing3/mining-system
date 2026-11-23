// Posprocesado: oclusión ambiental (N8AO), bloom limitado a fuentes HDR (difusores),
// mapeo tonal AgX, corrección de color sobria, viñeta y SMAA.
import { Bloom, BrightnessContrast, EffectComposer, HueSaturation, N8AO, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import type { QualityProfile } from '../quality.ts'

export function Effects({ profile }: { profile: QualityProfile }) {
  const post = profile.postprocessing
  if (!post) return null
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      {post.ao ? <N8AO aoRadius={1.1} distanceFalloff={0.6} intensity={2.2} quality={post.ao} halfRes={post.ao === 'performance'} color="#0b0908" /> : <></>}
      {post.bloom ? <Bloom mipmapBlur luminanceThreshold={1.05} luminanceSmoothing={0.2} intensity={0.45} radius={0.55} /> : <></>}
      <HueSaturation saturation={-0.06} />
      <BrightnessContrast contrast={0.06} />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <Vignette offset={0.32} darkness={0.5} />
      {post.smaa ? <SMAA /> : <></>}
    </EffectComposer>
  )
}
