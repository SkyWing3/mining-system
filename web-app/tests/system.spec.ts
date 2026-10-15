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

type Frame = Record<string, unknown>

// A device that stays connected, like a real manilla: requests get ack/error, notices arrive at any time.
async function connectDevice() {
  const socket = new WebSocket('ws://127.0.0.1:5082/ws/device', { headers: { 'X-Device-Key': key } })
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
  const frames: Frame[] = []
  const waiters: Array<{ match: (frame: Frame) => boolean; resolve: (frame: Frame) => void }> = []
  socket.on('message', data => {
    const frame = JSON.parse(data.toString()) as Frame
    const waiter = waiters.find(item => item.match(frame))
    if (waiter) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(frame) } else frames.push(frame)
  })
  function next(match: (frame: Frame) => boolean, timeout = 5000) {
    const queued = frames.find(match)
    if (queued) { frames.splice(frames.indexOf(queued), 1); return Promise.resolve(queued) }
    return new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Sin respuesta de la central')), timeout)
      waiters.push({ match, resolve: frame => { clearTimeout(timer); resolve(frame) } })
    })
  }
  return {
    async request(frame: Frame) {
      const response = next(item => item.type === 'ack' || item.type === 'error')
      socket.send(JSON.stringify(frame))
      return response
    },
    notice: () => next(item => item.type === 'notice'),
    close: () => socket.close(),
  }
}

function wav(seconds: number, rate = 16000) {
  const data = Buffer.alloc(seconds * rate * 2)
  for (let index = 0; index < seconds * rate; index++) data.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 440 * index / rate)), index * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8)
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36); header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

async function uploadVoice(request: APIRequestContext, voiceId: string) {
  const response = await request.post('http://127.0.0.1:5082/api/device/voice', {
    data: wav(1),
    headers: { 'Content-Type': 'audio/wav', 'X-Device-Key': key, 'X-Client-Message-Id': voiceId, 'X-Recorded-At': new Date().toISOString() },
  })
  expect(response.status()).toBe(201)
}

async function authorized(request: APIRequestContext) {
  const login = await request.post('/api/auth/login', { data: { email: 'admin@browser.invalid', password }, headers: { 'X-Mining-Client': 'web' } })
  expect(login.ok()).toBeTruthy()
}

async function expectApplicationControls(page: Page) {
  await expect(page.locator('select, option, datalist, dialog, details, summary, progress, meter, [title], input[type="date"], input[type="time"], input[type="number"], input[type="file"], input[type="range"]')).toHaveCount(0)
  expect(await page.locator('form').evaluateAll(forms => forms.every(form => form instanceof HTMLFormElement && form.noValidate))).toBeTruthy()
  expect(await page.locator('button, input:not([type="hidden"])').evaluateAll(controls => controls.every(control => getComputedStyle(control).appearance === 'none'))).toBeTruthy()
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
    let submitted = 0
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/auth/setup')) submitted++ })
    await page.getByRole('button', { name: 'Crear cuenta y comenzar' }).click()
    await expect(page.locator('.field-error')).toHaveCount(3)
    await expect(page.getByLabel('Nombre completo')).toBeFocused()
    await page.getByLabel('Nombre completo').fill('A')
    await page.getByLabel('Correo electrónico').fill('correo-invalido')
    await page.getByLabel('Contraseña', { exact: true }).fill('corta')
    await page.getByRole('button', { name: 'Mostrar contraseña', exact: true }).click()
    await expect(page.getByLabel('Contraseña', { exact: true })).toHaveAttribute('type', 'text')
    await page.getByRole('button', { name: 'Crear cuenta y comenzar' }).click()
    await expect(page.getByText('Usa al menos 2 caracteres.')).toBeVisible()
    await expect(page.getByText('Escribe un correo electrónico válido.')).toBeVisible()
    await expect(page.getByText('Usa al menos 10 caracteres.')).toBeVisible()
    expect(submitted).toBe(0)
    await page.getByRole('button', { name: 'Ocultar contraseña', exact: true }).click()
    await expectApplicationControls(page)
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
    await page.getByRole('combobox', { name: 'Minero asignado' }).click()
    await page.getByRole('option', { name: 'Javier Mamani', exact: true }).click()
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

  test('custom role selectors, checkboxes and modal keyboard navigation', async ({ page }) => {
    await signIn(page)
    await page.getByRole('button', { name: 'Usuarios', exact: true }).click()
    const filter = page.getByRole('combobox', { name: 'Filtrar rol' })
    await filter.focus()
    await filter.press('m')
    await expect(page.getByRole('listbox')).toBeVisible()
    await filter.press('Enter')
    await expect(filter).toContainText('Minero')
    await expect(page.getByRole('row').filter({ hasText: 'Javier Mamani' })).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'Administración Central' })).toHaveCount(0)
    await filter.click()
    await page.getByRole('option', { name: 'Todos los roles' }).click()
    await page.getByRole('button', { name: 'Crear usuario', exact: true }).click()
    await expect(page.getByLabel('Nombre completo')).toBeFocused()
    const role = page.getByRole('combobox', { name: 'Rol', exact: true })
    await role.press('End')
    await expect(role).toBeFocused()
    await expect(role).toHaveAttribute('aria-expanded', 'true')
    await role.press('Escape')
    await expect(role).toContainText('Minero')
    await expect(page.getByRole('dialog')).toBeVisible()
    await role.press('Enter')
    await page.keyboard.type('sup')
    await page.screenshot({ path: 'test-results/custom-select-desktop.png', fullPage: true })
    await role.press('Enter')
    await expect(role).toContainText('Supervisor')
    expect(await page.locator('.dialog-form').evaluate(form => new FormData(form as HTMLFormElement).get('role'))).toBe('Supervisor')
    const active = page.getByRole('checkbox', { name: 'Cuenta activa' })
    await expect(active).toBeChecked()
    await active.focus()
    await active.press('Space')
    await expect(active).not.toBeChecked()
    expect(await page.locator('.dialog-form').evaluate(form => new FormData(form as HTMLFormElement).has('active'))).toBe(false)
    await active.press('Space')
    await expect(active).toBeChecked()
    await page.getByRole('button', { name: 'Cerrar diálogo' }).focus()
    await page.keyboard.press('Shift+Tab')
    await expect(page.getByRole('button', { name: 'Guardar usuario' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Cerrar diálogo' })).toBeFocused()
    await expectApplicationControls(page)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Crear usuario', exact: true })).toBeFocused()
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

  test('custom message filters, search clearing and tooltips', async ({ page }) => {
    await signIn(page)
    await page.getByRole('button', { name: 'Mensajes', exact: true }).click()
    const priority = page.getByRole('combobox', { name: 'Filtrar prioridad' })
    await priority.click()
    await page.getByRole('option', { name: 'Informativas' }).click()
    await expect(page.locator('.message-row')).toHaveCount(1)
    await expect(page.locator('.message-title')).toContainText('Todo bien')
    await priority.click()
    await page.getByRole('option', { name: 'Todas las prioridades' }).click()
    const device = page.getByRole('combobox', { name: 'Filtrar manilla' })
    await device.click()
    await page.getByRole('option', { name: 'Manilla 01', exact: true }).click()
    await expect(device).toContainText('Manilla 01')
    await page.getByLabel('Buscar mensajes').fill('derrumbe')
    await expect(page.locator('.message-row')).toHaveCount(1)
    await page.getByRole('button', { name: 'Limpiar búsqueda de mensajes' }).click()
    await expect(page.getByLabel('Buscar mensajes')).toHaveValue('')
    await expect(page.getByLabel('Buscar mensajes')).toBeFocused()
    await expect(page.locator('.message-row')).toHaveCount(3)
    await page.getByRole('button', { name: 'Manillas', exact: true }).click()
    const inspect = page.getByRole('button', { name: 'Ver lecturas de Manilla 01' })
    await inspect.hover()
    await expect(page.getByRole('tooltip')).toHaveText('Ver lecturas')
    await page.mouse.move(0, 0)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await inspect.focus()
    await expect(page.getByRole('tooltip')).toHaveText('Ver lecturas')
    await inspect.press('Escape')
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await expectApplicationControls(page)
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

  test('audit every screen and use the assignment dropdown by touch', async ({ page, browser }) => {
    await signIn(page)
    for (const section of ['Usuarios', 'Manillas', 'Mensajes', 'Alertas', 'Actividad', 'Mi cuenta y sistema', 'Vista general']) {
      await page.locator('.sidebar').getByRole('button', { name: section, exact: section !== 'Alertas' }).click()
      await expectApplicationControls(page)
    }
    const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 480 }, baseURL: 'http://127.0.0.1:5174' })
    try {
      await context.addCookies(await page.context().cookies())
      const mobile = await context.newPage()
      await mobile.goto('/')
      await expect(mobile.getByRole('heading', { name: 'Vista general', exact: true })).toBeVisible()
      await mobile.getByRole('button', { name: 'Abrir navegación' }).tap()
      await mobile.getByRole('button', { name: 'Manillas', exact: true }).tap()
      expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy()
      await mobile.getByRole('button', { name: 'Editar Manilla 01' }).tap()
      const assignment = mobile.getByRole('combobox', { name: 'Minero asignado' })
      await assignment.tap()
      const bounds = await mobile.getByRole('listbox').boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.y).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(480)
      await mobile.screenshot({ path: 'test-results/custom-select-mobile.png', fullPage: true })
      await mobile.getByRole('option', { name: 'Sin asignar' }).tap()
      await expect(assignment).toContainText('Sin asignar')
      const active = mobile.getByRole('checkbox', { name: 'Manilla habilitada' })
      await active.tap()
      await expect(active).not.toBeChecked()
      await mobile.screenshot({ path: 'test-results/custom-controls-mobile.png', fullPage: true })
      await mobile.getByRole('button', { name: 'Cancelar', exact: true }).tap()
      await expect(mobile.getByRole('dialog')).toHaveCount(0)
      await expectApplicationControls(mobile)
      expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
    } finally { await context.close() }
  })

  test('live readings update in place without reloading the device list', async ({ page }) => {
    await signIn(page)
    const device = await connectDevice()
    try {
      expect((await device.request({ type: 'heartbeat' })).type).toBe('ack')
      await page.locator('.sidebar').getByRole('button', { name: 'En vivo' }).click()
      await expect(page.getByRole('heading', { name: 'Monitoreo en vivo' })).toBeVisible()
      const card = page.getByRole('article', { name: 'Lecturas en vivo de Manilla 01' })
      await expect(card).toBeVisible()
      await page.waitForTimeout(500)
      const reloads: string[] = []
      page.on('request', request => { if (/\/api\/devices$/.test(new URL(request.url()).pathname)) reloads.push(request.url()) })
      for (const [temperature, voltage] of [[30.1, 0.401], [31.2, 0.412]]) {
        expect((await device.request({ type: 'telemetry', temperatureC: temperature, objectTemperatureC: 33.4, gasVoltage: voltage, level: 'normal', simulated: true })).type).toBe('ack')
      }
      await expect(card).toContainText('31.2 °C')
      await expect(card).toContainText('0.412 V')
      await expect(card).toContainText('CO (sin calibrar)')
      await expect(card).toContainText('Simulado')
      await expect(card.locator('.sparkline polyline').first()).toBeVisible()
      expect((await device.request({ type: 'telemetry', temperatureC: 39.5, gasPpm: 250, gasVoltage: 0.5, level: 'danger' })).type).toBe('ack')
      await expect(card.locator('.level-badge')).toHaveText('Peligro')
      await expect(page.locator('.sidebar').getByRole('button', { name: 'En vivo' })).toContainText('1')
      expect(reloads).toEqual([])
      await card.getByRole('button', { name: 'Ver gráfico' }).click()
      await expect(page.getByRole('heading', { name: 'Lecturas · Manilla 01' })).toBeVisible()
      await expect(page.locator('.chart-label')).toContainText('39.5')
      expect((await device.request({ type: 'telemetry', temperatureC: 36.0, gasPpm: 180, level: 'caution' })).type).toBe('ack')
      await expect(page.locator('.chart-label')).toContainText('36.0')
      const chart = page.getByRole('img', { name: /Historial de temperatura/ })
      await chart.hover()
      await expect(page.locator('.chart-tooltip')).toBeVisible()
      await page.screenshot({ path: 'test-results/live-chart.png', fullPage: true })
      await page.getByRole('button', { name: 'Tabla' }).click()
      await expect(page.getByRole('cell', { name: '36.0 °C' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expectApplicationControls(page)
      await page.screenshot({ path: 'test-results/live.png', fullPage: true })
      await page.locator('.sidebar').getByRole('button', { name: 'Vista general' }).click()
      await expect(page.locator('.team-reading')).toContainText('36.0 °C')
    } finally { device.close() }
  })

  test('notices reach the manilla and show its confirmation live', async ({ page }) => {
    await signIn(page)
    await page.getByRole('button', { name: 'Manillas', exact: true }).click()
    await page.getByRole('button', { name: 'Enviar aviso a Manilla 01' }).click()
    const notice = page.getByRole('combobox', { name: 'Aviso' })
    await notice.click()
    await page.getByRole('option', { name: 'Volver a superficie' }).click()
    await expect(page.getByRole('combobox', { name: 'Destino' })).toContainText('Manilla 01')
    await expectApplicationControls(page)
    await page.getByRole('button', { name: 'Enviar aviso', exact: true }).click()
    await expect(page.getByText('Aviso enviado a la manilla.')).toBeVisible()
    await page.locator('.sidebar').getByRole('button', { name: 'Avisos' }).click()
    const row = page.getByRole('row').filter({ hasText: 'Volver a superficie' }).first()
    await expect(row).toContainText('Pendiente')
    const device = await connectDevice()
    try {
      expect((await device.request({ type: 'heartbeat' })).type).toBe('ack')
      const pushed = await device.notice()
      expect(pushed.text).toBe('Volver a superficie')
      expect((await device.request({ type: 'notice-ack', noticeId: pushed.noticeId, stage: 'delivered' })).type).toBe('ack')
      await expect(row).toContainText('Entregado')
      expect((await device.request({ type: 'notice-ack', noticeId: pushed.noticeId, stage: 'read' })).type).toBe('ack')
      await expect(row).toContainText('Leído')
      await page.screenshot({ path: 'test-results/notices.png', fullPage: true })
    } finally { device.close() }
    await page.locator('.sidebar').getByRole('button', { name: 'Actividad' }).click()
    await expect(page.getByText(/Envió el aviso "Volver a superficie"/)).toBeVisible()
  })

  test('voice messages arrive live, play and are marked as listened', async ({ page, request }) => {
    await uploadVoice(request, `browser-voice-${Date.now()}`)
    await signIn(page)
    await page.locator('.sidebar').getByRole('button', { name: 'Voz' }).click()
    await expect(page.getByRole('heading', { name: 'Mensajes de voz' })).toBeVisible()
    await expect(page.locator('.voice-row')).toHaveCount(1)
    await uploadVoice(request, `browser-voice-${Date.now()}-live`)
    await expect(page.getByText(/envió un mensaje de voz/)).toBeVisible()
    await expect(page.locator('.voice-row')).toHaveCount(2)
    const first = page.locator('.voice-row').first()
    await expect(first).toContainText('0:01')
    const latest = (await (await page.request.get('/api/voice?pageSize=1')).json()).items[0]
    const audio = await page.request.get(`/api/voice/${latest.id}/audio`)
    expect(audio.status()).toBe(200)
    expect(audio.headers()['content-type']).toBe('audio/wav')
    const slider = first.getByRole('slider')
    await expect(slider).toHaveAttribute('aria-valuemax', '1')
    await expectApplicationControls(page)
    await page.screenshot({ path: 'test-results/voice.png', fullPage: true })
    await first.getByRole('button', { name: 'Marcar como escuchado' }).click()
    await expect(page.locator('.voice-row')).toHaveCount(1)
    await page.getByRole('button', { name: 'Todos', exact: true }).click()
    await expect(page.getByText(/Escuchado por Administración Central/)).toBeVisible()
  })

  test('live monitor fits a phone screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page)
    await page.getByRole('button', { name: 'Abrir navegación' }).click()
    await page.locator('.sidebar').getByRole('button', { name: 'En vivo' }).click()
    await expect(page.getByRole('article', { name: 'Lecturas en vivo de Manilla 01' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
    await page.screenshot({ path: 'test-results/live-mobile.png', fullPage: true })
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
    await page.getByLabel('Confirmar nueva contraseña', { exact: true }).fill(password + '-new')
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
