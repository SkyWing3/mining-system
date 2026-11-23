// Informe del generador: tiempo, fragmentos, vértices, triángulos y hash para una configuración.
// Uso: node scripts/generator-report.mjs [config/galeria-validacion.json] [vóxel] [sombras:1|0]
import { readFileSync } from 'node:fs'
import { GalleryGenerator } from '../packages/mine-generator/src/index.ts'

const [configPath = 'config/galeria-validacion.json', voxelArg = '0.2', shadowsArg = '1'] = process.argv.slice(2)
const layout = JSON.parse(readFileSync(configPath, 'utf8'))
const voxel = Number(voxelArg)
const chunkSize = voxel * Math.round(8 / voxel)
const started = performance.now()
const generator = new GalleryGenerator(layout)
const setup = performance.now() - started
const { stats } = generator.generateAll({ voxel, chunkSize, bakeShadows: shadowsArg === '1' })
const infra = generator.infrastructure
console.log(JSON.stringify({
  config: configPath, voxel, chunkSize, bakeShadows: shadowsArg === '1',
  setupMs: Math.round(setup), ...stats, milliseconds: Math.round(stats.milliseconds),
  tunnelLength: Number(stats.tunnelLength.toFixed(1)),
  infrastructure: Object.fromEntries(Object.entries(infra).map(([key, value]) => [key, Array.isArray(value) ? value.length : value])),
}, null, 2))
