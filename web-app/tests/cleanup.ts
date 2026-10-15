import { execFileSync } from 'node:child_process'

export default function cleanup() {
  if (process.env.MINING_E2E_DATABASE) {
    execFileSync('python3', ['../scripts/mysql_test_db.py', 'drop', process.env.MINING_E2E_DATABASE], { stdio: 'pipe' })
  }
}
