import { expect, test, type Page } from '@playwright/test'
import { getState, openTwin, setState } from '../support/twin.ts'

interface MinerSample { x: number; y: number; z: number; distance: number }
interface FrameSample { direction: string; kind: string; text: string }

function minerPosition(page: Page): Promise<MinerSample> {
  return page.evaluate(() => {
    const miner = (window as unknown as { __twinMiner: { position: { x: number; y: number; z: number }; distance: number } }).__twinMiner
    return { x: miner.position.x, y: miner.position.y, z: miner.position.z, distance: miner.distance }
  })
}

function frames(page: Page): Promise<FrameSample[]> {
  return page.evaluate(() => (window as unknown as { __twinFrames: () => FrameSample[] }).__twinFrames().map(frame => ({ direction: frame.direction, kind: frame.kind, text: frame.text })))
}

function device<T>(page: Page, key: string): Promise<T> {
  return page.evaluate(name => (window as unknown as { __twinDevice: { getState: () => Record<string, unknown> } }).__twinDevice.getState()[name] as T, key)
}

test('el minero camina con WASD sin atravesar la roca y la manilla transmite según su ubicación', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await openTwin(page, 'medium')

  // Minero en tercera persona desde la bocamina.
  await page.getByTestId('mode-miner').click()
  expect(await getState<string>(page, 'cameraMode')).toBe('third-person')
  await page.waitForTimeout(1200)
  const start = await minerPosition(page)
  await page.keyboard.down('w')
  await page.waitForTimeout(3000)
  await page.keyboard.up('w')
  const walked = await minerPosition(page)
  expect(Math.hypot(walked.x - start.x, walked.z - start.z)).toBeGreaterThan(2.5)
  expect(Math.abs(walked.y - start.y)).toBeLessThan(0.5)

  // Caminar contra el hastial durante 3 s no lo atraviesa (galería de 3 m de ancho).
  await page.keyboard.down('a')
  await page.waitForTimeout(3000)
  await page.keyboard.up('a')
  const wall = await minerPosition(page)
  expect(Math.hypot(wall.x - walked.x, wall.z - walked.z)).toBeLessThan(1.8)
  await page.screenshot({ path: 'tests/output/screenshots/miner/tercera-persona.png' })
  // Vista de frente y de costado para revisar el modelo (la cámara gira alrededor del minero).
  for (const [name, turn] of [['frente', 0.85], ['costado', 0.5]] as const) {
    await page.evaluate(value => {
      const miner = (window as unknown as { __twinMiner: { bodyYaw: number; look: { yaw: number; pitch: number } } }).__twinMiner
      miner.look.yaw = miner.bodyYaw + Math.PI * value
      miner.look.pitch = -0.12
    }, turn)
    await page.waitForTimeout(900)
    await page.screenshot({ path: `tests/output/screenshots/miner/tercera-persona-${name}.png` })
  }

  // Enlace con la central simulada y telemetría con "simulated": true cada 2 s.
  await expect.poll(() => device<{ connected: boolean }>(page, 'link').then(link => link.connected), { timeout: 10_000 }).toBe(true)
  await expect.poll(async () => (await frames(page)).filter(frame => frame.direction === 'tx' && frame.text.includes('"type":"telemetry"')).length, { timeout: 10_000 }).toBeGreaterThan(1)
  const telemetry = (await frames(page)).filter(frame => frame.text.includes('"type":"telemetry"')).at(-1)!
  expect(telemetry.text).toContain('"simulated":true')
  expect(await device<string>(page, 'level')).toBe('normal')
  expect(await page.getByTestId('bracelet-level').getAttribute('data-level')).toBe('normal')

  // Los pulsadores cambian la pantalla OLED.
  const before = await device<number>(page, 'oledVersion')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect.poll(() => device<number>(page, 'oledVersion')).toBeGreaterThan(before)
  await page.keyboard.press('Enter')

  // Frente de avance recién volado: la manilla pasa a peligro y envía CO_ALARM.
  await setState(page, { cameraMode: 'first-person', viewpoint: { segment: 'S5', s: 17 } })
  await expect.poll(() => device<string>(page, 'level'), { timeout: 20_000 }).toBe('danger')
  await expect.poll(async () => (await frames(page)).some(frame => frame.direction === 'tx' && frame.text.includes('"code":"CO_ALARM"')), { timeout: 10_000 }).toBe(true)
  const zone = await page.getByTestId('miner-zone').textContent()
  expect(zone).toBe('Frente de avance')
  await setState(page, { viewpoint: null, cameraMode: 'third-person', checkingBracelet: true })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'tests/output/screenshots/miner/frente-peligro.png' })
  await setState(page, { cameraMode: 'first-person' })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'tests/output/screenshots/miner/primera-persona-manilla.png' })

  expect(errors, errors.join('\n')).toEqual([])
})
