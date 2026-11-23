import { expect, test } from '@playwright/test'
import { getState, openTwin, setState, showViewpoint, trackExternalRequests, type DiagnosticsSample } from '../support/twin.ts'

test('genera la galería, renderiza y no solicita recursos externos', async ({ page, baseURL }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  const external = trackExternalRequests(page, baseURL ?? 'http://127.0.0.1:5181')

  await openTwin(page, 'medium')
  const generation = await getState<{ status: string; total: number; triangles: number }>(page, 'generation')
  expect(generation.status).toBe('done')
  expect(generation.triangles).toBeGreaterThan(50_000)

  const diagnostics = await getState<DiagnosticsSample>(page, 'diagnostics')
  expect(diagnostics.drawCalls).toBeGreaterThan(10)
  expect(diagnostics.fps).toBeGreaterThan(0)

  // Primera persona en un punto programado y regreso inmediato a supervisión.
  await showViewpoint(page, { segment: 'S2', s: 10 })
  expect(await getState<string>(page, 'cameraMode')).toBe('first-person')
  await setState(page, { cameraMode: 'orbit', viewpoint: null, panelsVisible: true })
  await expect(page.getByTestId('mode-orbit')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('diagnostics')).toContainText('Draw calls')

  expect(external, `solicitudes externas: ${external.join(', ')}`).toEqual([])
  expect(errors, errors.join('\n')).toEqual([])
})

test('cambiar el perfil gráfico regenera la galería', async ({ page }) => {
  await openTwin(page, 'low')
  const low = await getState<{ triangles: number }>(page, 'generation')
  await page.getByTestId('quality-high').click()
  await page.waitForFunction(() => (window as unknown as { __twin: { getState: () => { generation: { status: string } } } }).__twin.getState().generation.status === 'running')
  await page.waitForFunction(() => {
    const state = (window as unknown as { __twin: { getState: () => { generation: { status: string; triangles?: number } } } }).__twin.getState()
    return state.generation.status === 'done' && (state.generation.triangles ?? 0) > 0
  }, undefined, { timeout: 150_000 })
  const high = await getState<{ triangles: number }>(page, 'generation')
  // Vóxel de 0,35 m (Bajo) frente a 0,2 m (Alto): bastante más detalle.
  expect(high.triangles).toBeGreaterThan(low.triangles * 2)
})
