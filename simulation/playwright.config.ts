import { defineConfig } from '@playwright/test'

// Las pruebas visuales y de rendimiento necesitan GPU: Chromium usa ANGLE sobre D3D11
// en Windows y sobre Metal en macOS. Con TWIN_SOFTWARE_GL=1 se fuerza SwiftShader (solo
// pruebas funcionales).
const software = process.env.TWIN_SOFTWARE_GL === '1'
// Por defecto se respeta la sincronía vertical (lo que ve un operador). TWIN_UNCAPPED=1 la
// desactiva para medir el margen máximo; en ese modo la cola de presentación de Chrome
// produce tirones periódicos que no corresponden a la aplicación.
const uncapped = process.env.TWIN_UNCAPPED === '1'
const gpuArgs = software
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : [`--use-angle=${process.platform === 'darwin' ? 'metal' : 'd3d11'}`, '--enable-gpu', '--ignore-gpu-blocklist', ...(uncapped ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])]

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5181',
    viewport: { width: 1600, height: 900 },
    launchOptions: { args: gpuArgs },
  },
  projects: [
    { name: 'e2e', testMatch: /e2e\/.*\.spec\.ts/ },
    { name: 'visual', testMatch: /visual\/.*\.spec\.ts/ },
    { name: 'bench', testMatch: /bench\/.*\.spec\.ts/, use: { viewport: { width: 2560, height: 1440 } } },
  ],
  webServer: {
    // Build de producción servido por vite preview: mide lo que se desplegaría.
    command: 'npm run build && npm run preview',
    env: { VITE_TWIN_AUTOMATION: '1' },
    url: 'http://127.0.0.1:5181',
    timeout: 180_000,
    reuseExistingServer: true,
  },
})
