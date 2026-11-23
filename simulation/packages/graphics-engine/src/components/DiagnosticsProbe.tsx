// Mediciones del renderizado: FPS, tiempo por fotograma, tiempo de GPU (si el navegador
// expone EXT_disjoint_timer_query_webgl2), draw calls, triángulos, objetos visibles,
// geometrías/texturas y memoria de GPU ESTIMADA a partir de los búferes y texturas en uso.
import { addAfterEffect, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export interface RenderDiagnostics {
  readonly fps: number
  readonly frameMs: number
  /** Percentil 99 del tiempo por fotograma en la ventana de muestreo. */
  readonly frameMsP99: number
  readonly gpuMs: number | null
  readonly drawCalls: number
  readonly triangles: number
  readonly visibleObjects: number
  readonly geometries: number
  readonly textures: number
  /**
   * Estimación PARCIAL: búferes de geometría y texturas de materiales visibles. No incluye
   * mapas de sombra, PMREM ni búferes de posprocesado.
   */
  readonly estimatedGpuMemoryMb: number
  readonly programs: number
}

interface TimerExtension {
  readonly TIME_ELAPSED_EXT: number
  readonly GPU_DISJOINT_EXT: number
}

const frustum = new THREE.Frustum()
const projection = new THREE.Matrix4()
const sphere = new THREE.Sphere()

function textureBytes(texture: THREE.Texture): number {
  const image = texture.image as { width?: number; height?: number } | undefined
  if (!image?.width || !image.height) return 0
  const mip = texture.generateMipmaps ? 4 / 3 : 1
  return image.width * image.height * 4 * mip
}

function estimateScene(scene: THREE.Scene, camera: THREE.Camera): { visible: number; memory: number } {
  projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  frustum.setFromProjectionMatrix(projection)
  const geometries = new Set<THREE.BufferGeometry>()
  const textures = new Set<THREE.Texture>()
  let visible = 0
  scene.traverseVisible(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.geometry) return
    geometries.add(mesh.geometry)
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      if (!material) continue
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value)
      for (const value of (material.userData.textures as THREE.Texture[] | undefined) ?? []) textures.add(value)
      const uniforms = (material as THREE.ShaderMaterial).uniforms
      if (uniforms) for (const uniform of Object.values(uniforms)) if (uniform?.value instanceof THREE.Texture) textures.add(uniform.value)
    }
    if (object.frustumCulled === false) { visible++; return }
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere()
    if (!mesh.geometry.boundingSphere) return
    sphere.copy(mesh.geometry.boundingSphere).applyMatrix4(object.matrixWorld)
    if (frustum.intersectsSphere(sphere)) visible++
  })
  let bytes = 0
  for (const geometry of geometries) {
    for (const attribute of Object.values(geometry.attributes)) bytes += (attribute as THREE.BufferAttribute).array.byteLength
    if (geometry.index) bytes += geometry.index.array.byteLength
  }
  const sources = new Set<unknown>()
  for (const texture of textures) {
    if (sources.has(texture.source)) continue
    sources.add(texture.source)
    bytes += textureBytes(texture)
  }
  return { visible, memory: bytes / (1024 * 1024) }
}

export function DiagnosticsProbe({ onSample, interval = 500 }: { onSample: (sample: RenderDiagnostics) => void; interval?: number }) {
  const gl = useThree(state => state.gl)
  const frames = useRef<number[]>([])
  const last = useRef(performance.now())
  const lastReport = useRef(performance.now())
  const gpu = useRef<{ ext: TimerExtension | null; query: WebGLQuery | null; samples: number[] }>({ ext: null, query: null, samples: [] })
  const callback = useRef(onSample)
  useEffect(() => { callback.current = onSample }, [onSample])

  useEffect(() => {
    gl.info.autoReset = false
    const context = gl.getContext() as WebGL2RenderingContext
    gpu.current.ext = context.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null
    return () => { gl.info.autoReset = true }
  }, [gl])

  // Antes de todo el trabajo del fotograma.
  useFrame(() => {
    gl.info.reset()
    const context = gl.getContext() as WebGL2RenderingContext
    const timer = gpu.current
    if (timer.ext && !timer.query) {
      timer.query = context.createQuery()
      if (timer.query) context.beginQuery(timer.ext.TIME_ELAPSED_EXT, timer.query)
    }
  }, -1000)

  const scene = useThree(state => state.scene)
  const camera = useThree(state => state.camera)
  // Después del render (incluido el posprocesado). addAfterEffect no toma el control del bucle
  // de render de R3F, a diferencia de un useFrame con prioridad positiva.
  const afterRender = useRef<() => void>(() => undefined)
  useEffect(() => addAfterEffect(() => afterRender.current()), [])
  useEffect(() => { afterRender.current = () => {
    const context = gl.getContext() as WebGL2RenderingContext
    const timer = gpu.current
    if (timer.ext && timer.query) {
      context.endQuery(timer.ext.TIME_ELAPSED_EXT)
      const query = timer.query
      const ext = timer.ext
      // El resultado llega fotogramas después; se consulta sin bloquear.
      const poll = () => {
        if (!context.getQueryParameter(query, context.QUERY_RESULT_AVAILABLE)) { requestAnimationFrame(poll); return }
        if (!context.getParameter(ext.GPU_DISJOINT_EXT)) timer.samples.push(context.getQueryParameter(query, context.QUERY_RESULT) / 1e6)
        context.deleteQuery(query)
      }
      requestAnimationFrame(poll)
      timer.query = null
    }
    const now = performance.now()
    frames.current.push(now - last.current)
    last.current = now
    if (now - lastReport.current < interval) return
    lastReport.current = now
    const sorted = [...frames.current].sort((a, b) => a - b)
    const mean = sorted.reduce((sum, value) => sum + value, 0) / Math.max(sorted.length, 1)
    const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? mean
    frames.current = []
    const gpuSamples = timer.samples.splice(0)
    const { visible, memory } = estimateScene(scene, camera)
    callback.current({
      fps: mean > 0 ? 1000 / mean : 0,
      frameMs: mean,
      frameMsP99: p99,
      gpuMs: gpuSamples.length ? gpuSamples.reduce((sum, value) => sum + value, 0) / gpuSamples.length : null,
      drawCalls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      visibleObjects: visible,
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      estimatedGpuMemoryMb: memory,
      programs: gl.info.programs?.length ?? 0,
    })
  } })

  return null
}
