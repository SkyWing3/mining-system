// Cobertura Wi-Fi de una configuración: mejor señal a lo largo de cada segmento.
// Uso: node scripts/coverage-report.mjs [config/mina-simulada.json] [paso en m]
import { readFileSync } from 'node:fs'
import { compileLayout } from '../packages/mine-generator/src/index.ts'
import { RadioCoverage } from '../packages/mine-environment/src/radio.ts'

const [configPath = 'config/mina-simulada.json', stepArg = '10'] = process.argv.slice(2)
const layout = JSON.parse(readFileSync(configPath, 'utf8'))
const compiled = compileLayout(layout)
const radio = new RadioCoverage(compiled, layout.network, layout.barriers ?? [])
const step = Number(stepArg)
const band = rssi => (rssi >= -70 ? '█' : rssi >= -80 ? '▓' : rssi >= -85 ? '▒' : rssi >= -90 ? '░' : '·')
for (const [index, segment] of compiled.segments.entries()) {
  let line = ''
  let worst = Infinity
  const values = []
  for (let s = 0; s <= segment.length + 0.01; s += step) {
    const reading = radio.sample({ segment: index, s })
    const best = reading.signals[0]?.rssi ?? -100
    worst = Math.min(worst, best)
    line += band(best)
    values.push(`${Math.round(best)}`)
  }
  console.log(`${segment.spec.id.padEnd(4)} ${segment.spec.from}→${segment.spec.to.padEnd(3)} ${line.padEnd(28)} mín ${Math.round(worst)} dBm · ${values.join(' ')}`)
}
console.log('█ ≥ −70 · ▓ −70…−80 · ▒ −80…−85 · ░ −85…−90 · sin señal < −90 dBm')
