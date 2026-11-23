import { expect, type Page } from '@playwright/test'

export type Quality = 'low' | 'medium' | 'high' | 'ultra'

export interface Viewpoint { segment: string; s: number; yawOffset?: number; pitch?: number; lateral?: number }

export interface DiagnosticsSample {
  fps: number
  frameMs: number
  frameMsP99: number
  gpuMs: number | null
  drawCalls: number
  triangles: number
  visibleObjects: number
  geometries: number
  textures: number
  estimatedGpuMemoryMb: number
}

/** Registra solicitudes a otros orígenes: la aplicación no debe depender de CDN externos. */
export function trackExternalRequests(page: Page, origin: string): string[] {
  const external: string[] = []
  page.on('request', request => {
    const url = request.url()
    if (url.startsWith('data:') || url.startsWith('blob:')) return
    if (!url.startsWith(origin)) external.push(url)
  })
  return external
}

export async function openTwin(page: Page, quality: Quality): Promise<void> {
  await page.goto(`/?automation=1&quality=${quality}`)
  await page.waitForFunction(() => {
    const store = (window as unknown as { __twin?: { getState: () => { generation: { status: string }; assetError: string | null } } }).__twin
    return store?.getState().generation.status === 'done'
  }, undefined, { timeout: 150_000 })
  const assetError = await page.evaluate(() => (window as unknown as { __twin: { getState: () => { assetError: string | null } } }).__twin.getState().assetError)
  expect(assetError).toBeNull()
  // Esperar el precalentamiento (sombreadores compilados y texturas en GPU).
  await page.waitForFunction(() => {
    const state = (window as unknown as { __twin: { getState: () => { warmedUp: boolean; diagnostics: { triangles: number } | null } } }).__twin.getState()
    return state.warmedUp && (state.diagnostics?.triangles ?? 0) > 1000
  }, undefined, { timeout: 60_000 })
  await page.waitForTimeout(1500)
}

export async function setState(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(value => (window as unknown as { __twin: { setState: (v: unknown) => void } }).__twin.setState(value), patch)
}

export async function getState<T>(page: Page, selector: string): Promise<T> {
  return page.evaluate(key => {
    const state = (window as unknown as { __twin: { getState: () => Record<string, unknown> } }).__twin.getState()
    return state[key] as T
  }, selector)
}

export async function showViewpoint(page: Page, viewpoint: Viewpoint): Promise<void> {
  await setState(page, { cameraMode: 'first-person', viewpoint, panelsVisible: false })
  await page.waitForTimeout(900)
}

export async function showOverview(page: Page): Promise<void> {
  await setState(page, { cameraMode: 'orbit', viewpoint: null, panelsVisible: true, roofCut: true })
  await page.waitForTimeout(1800)
}
