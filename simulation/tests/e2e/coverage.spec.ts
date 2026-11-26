import { expect, test, type Page } from '@playwright/test'
import { openTwin, setState } from '../support/twin.ts'

interface DeviceSample {
  wifi: { state: string; accessPoint: string | null } | null
  link: { connected: boolean }
  level: string
  pending: { messages: number }
  central: { deviceOnline: boolean }
  recentMessages: Array<{ code: string; sentAt: string; receivedAt: number }>
  disabledAccessPoints: Set<string>
}

function device(page: Page): Promise<DeviceSample> {
  return page.evaluate(() => {
    const state = (window as unknown as { __twinDevice: { getState: () => DeviceSample } }).__twinDevice.getState()
    return { wifi: state.wifi, link: state.link, level: state.level, pending: state.pending, central: state.central, recentMessages: state.recentMessages, disabledAccessPoints: [...state.disabledAccessPoints] as unknown as Set<string> }
  })
}

async function goTo(page: Page, segment: string, s: number): Promise<void> {
  await setState(page, { cameraMode: 'first-person', viewpoint: { segment, s }, panelsVisible: true })
}

test('sin cobertura Wi-Fi la manilla encola la alarma y la entrega al volver a la señal', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await openTwin(page, 'medium')

  // Galería de veta Norte, cerca de AP-06: buena señal y enlace con la central.
  await goTo(page, 'S10', 100)
  await expect.poll(async () => (await device(page)).link.connected, { timeout: 30_000 }).toBe(true)
  await expect.poll(async () => (await device(page)).wifi?.accessPoint, { timeout: 30_000 }).toBe('AP-06')
  await expect(page.getByTestId('wifi-band')).toHaveAttribute('data-band', 'good')

  // Fondo de la labor abandonada: CO acumulado y sin señal pasado el tapón.
  await goTo(page, 'S09', 78)
  await expect.poll(async () => (await device(page)).level, { timeout: 20_000 }).toBe('danger')
  await expect.poll(async () => (await device(page)).wifi?.state, { timeout: 20_000 }).toBe('disconnected')
  await expect.poll(async () => (await device(page)).link.connected, { timeout: 20_000 }).toBe(false)
  await expect.poll(async () => (await device(page)).pending.messages, { timeout: 10_000 }).toBeGreaterThanOrEqual(1)
  // La central todavía la considera en línea (ventana de presencia de 90 s).
  expect((await device(page)).central.deviceOnline).toBe(true)
  await expect(page.getByTestId('bracelet-queue')).toContainText('1 msg')
  await page.screenshot({ path: 'tests/output/screenshots/coverage/labor-sin-senal.png' })

  // De vuelta en la veta: reconecta, vacía la cola y la central recibe la alarma tardía.
  await goTo(page, 'S10', 100)
  await expect.poll(async () => (await device(page)).pending.messages, { timeout: 40_000 }).toBe(0)
  const alarm = (await device(page)).recentMessages.find(message => message.code === 'CO_ALARM')
  expect(alarm).toBeDefined()
  expect(alarm!.receivedAt - Date.parse(alarm!.sentAt)).toBeGreaterThan(5000)
  await expect(page.getByTestId('central-messages')).toContainText('en cola')
  await page.screenshot({ path: 'tests/output/screenshots/coverage/alarma-entregada.png' })

  // Falla de AP-06 (clic en el mapa): en el frente sin ventilación se pierde la señal.
  await goTo(page, 'S12', 70)
  await page.getByTestId('map-ap-AP-06').click()
  expect((await device(page)).disabledAccessPoints).toContain('AP-06')
  await expect.poll(async () => (await device(page)).wifi?.state, { timeout: 25_000 }).not.toBe('connected')
  await page.getByTestId('map-ap-AP-06').click()
  await expect.poll(async () => (await device(page)).link.connected, { timeout: 40_000 }).toBe(true)

  expect(errors, errors.join('\n')).toEqual([])
})
