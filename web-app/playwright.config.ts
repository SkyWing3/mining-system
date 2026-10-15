import { defineConfig } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const dataDirectory = mkdtempSync(join(tmpdir(), 'mining-browser-tests-'))
const testDatabaseJson = process.env.MINING_E2E_DATABASE_CONFIG ?? execFileSync('python3', ['../scripts/mysql_test_db.py', 'create', 'browser'], { encoding: 'utf8' })
process.env.MINING_E2E_DATABASE_CONFIG = testDatabaseJson
const testDatabase = JSON.parse(testDatabaseJson) as {name: string, connectionString: string}
process.env.MINING_E2E_DATABASE = testDatabase.name
export default defineConfig({
  globalTeardown: './tests/cleanup.ts',
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5174', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [
    { command: 'dotnet run --project ../backend/backend.csproj --no-launch-profile --urls http://127.0.0.1:5082', url: 'http://127.0.0.1:5082/health', timeout: 60000, env: { Mining__DataDirectory: dataDirectory, Mining__ConnectionString: testDatabase.connectionString, Mining__AllowedOrigins__0: 'http://127.0.0.1:5174', Mining__LoginAttemptsPerMinute: '100', Logging__LogLevel__Default: 'Warning' } },
    { command: 'npm run dev -- --host 127.0.0.1 --port 5174', url: 'http://127.0.0.1:5174', env: { MINING_API_TARGET: 'http://127.0.0.1:5082' } },
  ],
})
