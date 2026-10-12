import { defineConfig } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataDirectory = mkdtempSync(join(tmpdir(), 'mining-browser-tests-'))
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5174', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [
    { command: 'dotnet run --project ../backend/backend.csproj --no-launch-profile --urls http://127.0.0.1:5082', url: 'http://127.0.0.1:5082/health', timeout: 60000, env: { Mining__DataDirectory: dataDirectory, Mining__AllowedOrigins__0: 'http://127.0.0.1:5174', Logging__LogLevel__Default: 'Warning' } },
    { command: 'npm run dev -- --host 127.0.0.1 --port 5174', url: 'http://127.0.0.1:5174', env: { MINING_API_TARGET: 'http://127.0.0.1:5082' } },
  ],
})
