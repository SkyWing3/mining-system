import { test, expect } from '@playwright/test'
import type { Page, APIRequestContext } from '@playwright/test'
import { WebSocket } from 'ws'

const password = 'Browser-Test-2026!'
let minerId: string
let key: string
let nextId = 0

async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel('Correo electrónico').fill('admin@browser.invalid')
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Ingresar a la central' }).click()
  await expect(page.getByRole('heading', { name: 'Vista general', exact: true })).toBeVisible()
  await expect(page.locator('.connection-warning')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Últimos mensajes', exact: true })).toBeVisible()
}

async function send(code: string, telemetry = false) {
  const socket = new WebSocket('ws://127.0.0.1:5082/ws/device', { headers: { 'X-Device-Key': key } })
  try {
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
    const response = new Promise<string>((resolve, reject) => { socket.once('message', data => resolve(data.toString())); socket.once('error', reject) })
    socket.send(JSON.stringify(telemetry ? { type: 'telemetry', temperatureC: 28.6, gasPpm: 410, batteryPercent: 86 } : { type: 'message', code, clientMessageId: `browser-${++nextId}`, sentAt: new Date().toISOString() }))
    expect(JSON.parse(await response).type).toBe('ack')
  } finally { socket.close() }
}

async function authorized(request: APIRequestContext) {
  const login = await request.post('/api/auth/login', { data: { email: 'admin@browser.invalid', password }, headers: { 'X-Mining-Client': 'web' } })
  expect(login.ok()).toBeTruthy()
}

test.describe.serial('Mining System', () => {
  test('first administrator, empty dashboard and exact light palette', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    let startupAttempts = 0
    await page.route('**/api/auth/status', route => ++startupAttempts === 1 ? route.abort('failed') : route.continue())
    await page.goto('/')
    await expect(page.getByText('La conexión se restablecerá automáticamente.')).toBeVisible()
    await expect(page.getByRole('button', { name: /Reintentar|Actualizar datos/ })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Prepara tu central' })).toBeVisible()
    await page.unroute('**/api/auth/status')
    await page.screenshot({ path: 'test-results/login.png', fullPage: true })
    await page.getByLabel('Nombre completo').fill('Administración Central')
    await page.getByLabel('Correo electrónico').fill('admin@browser.invalid')
    await page.getByLabel('Contraseña', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Crear cuenta y comenzar' }).click()
    await expect(page.getByRole('heading', { name: 'Vista general', exact: true })).toBeVisible()
    await expect(page.locator('.connection-warning')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Reintentar|Actualizar datos/ })).toHaveCount(0)
    await expect(page.getByText('Conecta tu primera manilla')).toBeVisible()
    expect(await page.locator('.stat-card.alert').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(133, 42, 59)')
    expect(await page.locator('.sidebar').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(55, 57, 70)')
    expect(errors).toEqual([])
  })

  test('create miner and register a manilla from the interface', async ({ page, request }) => {
    await signIn(page)
    await page.getByRole('button', { name: 'Usuarios', exact: true }).click()
    await page.getByRole('button', { name: 'Crear usuario', exact: true }).click()
    await page.getByLabel('Nombre completo').fill('Javier Mamani')
    await page.getByLabel('Correo electrónico').fill('javier@browser.invalid')
    await page.getByLabel('Contraseña', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Guardar usuario' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('cell').filter({ hasText: 'Javier Mamani' })).toBeVisible()
    await page.getByRole('button', { name: 'Manillas', exact: true }).click()
    await page.getByRole('button', { name: 'Registrar manilla', exact: true }).first().click()
    await page.getByLabel('Nombre de la manilla').fill('Manilla 01')
    await page.getByLabel('Zona de trabajo').fill('Galería norte')
    await page.getByLabel('Minero asignado').selectOption({ label: 'Javier Mamani' })
    await page.getByRole('button', { name: 'Guardar manilla' }).click()
    await expect(page.getByRole('heading', { name: 'Credencial de la manilla' })).toBeVisible()
    key = (await page.locator('.api-key').textContent())!
    expect(key).toHaveLength(64)
    await page.getByRole('button', { name: 'Ya la guardé' }).click()
    await expect(page.getByRole('cell').filter({ hasText: 'Manilla 01' })).toBeVisible()
    await authorized(request)
    const devices = await (await request.get('/api/devices')).json()
    minerId = devices[0].userId
    expect(minerId).toBeTruthy()
  })

  test('instant messages, telemetry, alert review and reconnect recovery', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await signIn(page)
    let snapshotAttempts = 0
    await page.route('**/api/overview', route => ++snapshotAttempts === 1
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Corte temporal de prueba.' }) })
      : route.continue())
    await send('HELP')
    await expect(page.locator('.message-title').getByText('Ayuda', { exact: true })).toBeVisible({ timeout: 3000 })
    await page.unroute('**/api/overview')
    await send('', true)
    await expect(page.locator('.team-reading')).toContainText('28.6 °C')
    await page.screenshot({ path: 'test-results/dashboard.png', fullPage: true })
    await page.getByRole('button', { name: /^Alertas/ }).first().click()
    await expect(page.locator('.message-title').getByText('Ayuda', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Revisar', exact: true }).click()
    await page.getByRole('button', { name: 'Marcar como revisada' }).click()
    await expect(page.getByText('Sin alertas en esta vista')).toBeVisible()
    await page.getByRole('button', { name: 'Mensajes', exact: true }).click()
    await send('COLLAPSE')
    await expect(page.locator('.message-title').getByText('Hay derrumbe', { exact: true })).toBeVisible({ timeout: 3000 })
    await page.getByLabel('Buscar mensajes').fill('derrumbe')
    await expect(page.locator('.message-row')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Exportar página' })).toBeEnabled()
    await page.screenshot({ path: 'test-results/messages.png', fullPage: true })
    await page.getByLabel('Buscar mensajes').fill('')
    await page.context().setOffline(true)
    await expect(page.getByText(/El enlace en vivo se está restableciendo/)).toBeVisible({ timeout: 10000 })
    await send('OK')
    await page.context().setOffline(false)
    await expect(page.locator('.connection-warning')).toHaveCount(0, { timeout: 25000 })
    await expect(page.locator('.message-title').getByText('Todo bien', { exact: true })).toBeVisible()
    expect(await page.locator('textarea').count()).toBe(0)
    expect(errors).toEqual([])
  })

  test('mobile navigation and device readings', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page)
    await page.screenshot({ path: 'test-results/mobile.png', fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
    await page.getByRole('button', { name: 'Abrir navegación' }).click()
    await page.getByRole('button', { name: 'Manillas', exact: true }).click()
    await page.getByRole('button', { name: 'Ver lecturas de Manilla 01' }).click()
    await expect(page.getByRole('heading', { name: 'Lecturas · Manilla 01' })).toBeVisible()
    await expect(page.locator('.chart-label')).toContainText('28.6')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('user updates, activity and password change', async ({ page }) => {
    await signIn(page)
    await page.getByRole('button', { name: 'Usuarios', exact: true }).click()
    const row = page.getByRole('row').filter({ hasText: 'Javier Mamani' })
    await row.getByRole('button', { name: 'Editar' }).click()
    await page.getByLabel('Nombre completo').fill('Javier Mamani Quispe')
    await page.getByRole('button', { name: 'Guardar usuario' }).click()
    await expect(page.getByRole('cell').filter({ hasText: 'Javier Mamani Quispe' })).toBeVisible()
    await page.getByRole('button', { name: 'Actividad', exact: true }).click()
    await expect(page.getByText(/Actualizó el usuario Javier Mamani Quispe/)).toBeVisible()
    await page.getByRole('button', { name: 'Mi cuenta y sistema', exact: true }).click()
    await page.getByLabel('Contraseña actual', { exact: true }).fill(password)
    await page.getByLabel('Nueva contraseña', { exact: true }).fill(password + '-new')
    await page.getByLabel('Confirmar nueva contraseña').fill(password + '-new')
    await page.getByRole('button', { name: 'Actualizar contraseña' }).click()
    await expect(page.getByText('Contraseña actualizada', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Bienvenido de nuevo' })).toBeVisible()
    await page.getByLabel('Correo electrónico').fill('admin@browser.invalid')
    await page.getByLabel('Contraseña', { exact: true }).fill(password + '-new')
    await page.getByRole('button', { name: 'Ingresar a la central' }).click()
    await expect(page.getByRole('heading', { name: 'Vista general', exact: true })).toBeVisible()
  })
})
