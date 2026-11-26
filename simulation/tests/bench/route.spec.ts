// Benchmark de recorrido fijo (F1.12): la cámara recorre la línea principal a 1,6 m/s en
// primera persona con la linterna encendida. Se registran las muestras del diagnóstico.
import { test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { getState, openTwin, setState, type DiagnosticsSample, type Quality } from '../support/twin.ts'

const qualities = (process.env.TWIN_QUALITIES ?? 'low,medium,high,ultra').split(',') as Quality[]
const results: Record<string, unknown> = {}

for (const quality of qualities) {
  test(`recorrido de benchmark en perfil ${quality}`, async ({ page, browserName }) => {
    await openTwin(page, quality, 'validacion')
    const generation = await getState<{ milliseconds: number; triangles: number; workers: number }>(page, 'generation')
    const viewport = page.viewportSize()
    const gpu = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2')
      const info = gl?.getExtension('WEBGL_debug_renderer_info')
      return info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'desconocida'
    })
    const dpr = await page.evaluate(() => window.devicePixelRatio)
    await setState(page, { cameraMode: 'first-person', viewpoint: null, panelsVisible: false, headlamp: true, autopilot: { active: true, progress: 0, finished: false } })
    const samples: Array<DiagnosticsSample & { progress: number }> = []
    const started = Date.now()
    while (Date.now() - started < 170_000) {
      await page.waitForTimeout(500)
      const sample = await getState<DiagnosticsSample | null>(page, 'diagnostics')
      const autopilot = await getState<{ finished: boolean; progress: number }>(page, 'autopilot')
      if (sample) samples.push({ ...sample, progress: autopilot.progress })
      if (autopilot.finished) break
    }
    // Descartar el primer segundo (compilación y subida de recursos).
    const steady = samples.slice(2)
    const fps = steady.map(sample => sample.fps).sort((a, b) => a - b)
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
    const gpuTimes = steady.map(sample => sample.gpuMs).filter((value): value is number => value !== null)
    results[quality] = {
      browser: browserName, gpu, viewport, devicePixelRatio: dpr,
      generationSeconds: Number((generation.milliseconds / 1000).toFixed(2)), rockTriangles: generation.triangles, workers: generation.workers,
      samples: steady.length,
      fpsMean: Number(mean(fps).toFixed(1)),
      fpsMin: Number((fps[0] ?? 0).toFixed(1)),
      fpsP5: Number((fps[Math.floor(fps.length * 0.05)] ?? 0).toFixed(1)),
      frameMsMean: Number(mean(steady.map(sample => sample.frameMs)).toFixed(2)),
      frameMsP99Max: Number(Math.max(...steady.map(sample => sample.frameMsP99)).toFixed(2)),
      gpuMsMean: gpuTimes.length ? Number(mean(gpuTimes).toFixed(2)) : null,
      drawCallsMax: Math.max(...steady.map(sample => sample.drawCalls)),
      trianglesMax: Math.max(...steady.map(sample => sample.triangles)),
      estimatedGpuMemoryMb: Math.round(Math.max(...steady.map(sample => sample.estimatedGpuMemoryMb))),
      // Ventanas de 0,5 s con algún fotograma de más de 50 ms y su avance en el recorrido.
      hitches: samples.filter(sample => sample.frameMsP99 > 50).map(sample => ({ progress: Number(sample.progress.toFixed(3)), worstFrameMs: Number(sample.frameMsP99.toFixed(1)) })),
    }
    console.log(quality, JSON.stringify(results[quality]))
  })
}

test.afterAll(() => {
  mkdirSync('tests/output', { recursive: true })
  writeFileSync(`tests/output/bench-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.json`, JSON.stringify(results, null, 2))
})
