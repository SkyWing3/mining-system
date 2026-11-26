// Perfil de CPU (CDP) durante el recorrido de benchmark: lista las funciones con más tiempo
// propio. Solo se ejecuta con TWIN_PROFILE=1 (herramienta de diagnóstico, no prueba).
import { test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { openTwin, setState, type Quality } from '../support/twin.ts'

interface ProfileNode { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }
interface CpuProfile { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[] }

test.skip(process.env.TWIN_PROFILE !== '1', 'Diagnóstico manual: TWIN_PROFILE=1')

test('perfil de CPU del recorrido', async ({ page }) => {
  const quality = (process.env.TWIN_QUALITIES ?? 'high') as Quality
  await openTwin(page, quality, 'validacion')
  await setState(page, { cameraMode: 'first-person', viewpoint: null, panelsVisible: false, headlamp: true, autopilot: { active: true, progress: 0, finished: false } })
  await page.waitForTimeout(3000)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
  await cdp.send('Profiler.start')
  await page.waitForTimeout(6000)
  const { profile } = (await cdp.send('Profiler.stop')) as { profile: CpuProfile }
  const self = new Map<number, number>()
  profile.samples.forEach((id, index) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[index] ?? 0)))
  const byName = new Map<string, number>()
  for (const node of profile.nodes) {
    const key = `${node.callFrame.functionName || '(anónima)'} ${node.callFrame.url.split('/').pop()}:${node.callFrame.lineNumber}`
    byName.set(key, (byName.get(key) ?? 0) + (self.get(node.id) ?? 0) / 1000)
  }
  const top = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
  mkdirSync('tests/output', { recursive: true })
  writeFileSync('tests/output/cpu-profile-top.json', JSON.stringify(top, null, 2))
  console.log(top.map(([name, ms]) => `${ms.toFixed(0).padStart(6)} ms  ${name}`).join('\n'))
})
