// Revisión de una configuración de mina antes de generarla: largo de cada segmento,
// pendiente máxima y separación entre galerías que no comparten un nodo (si dos ejes
// quedan demasiado cerca, el campo de distancia las une y aparece un cruce no previsto).
// Uso: node scripts/layout-report.mjs [config/mina-simulada.json]
import { readFileSync } from 'node:fs'
import { compileLayout } from '../packages/mine-generator/src/index.ts'

const [configPath = 'config/mina-simulada.json'] = process.argv.slice(2)
const layout = JSON.parse(readFileSync(configPath, 'utf8'))
const compiled = compileLayout(layout)

function samples(segment) {
  const out = []
  for (let index = 0; index < segment.points.length; index += 3) out.push([segment.points[index], segment.points[index + 1], segment.points[index + 2]])
  return out
}

let total = 0
const rows = []
for (const segment of compiled.segments) {
  const points = samples(segment)
  let maxGrade = 0
  for (let index = 1; index < points.length; index++) {
    const [a, b] = [points[index - 1], points[index]]
    const run = Math.hypot(b[0] - a[0], b[2] - a[2])
    if (run > 0.01) maxGrade = Math.max(maxGrade, Math.abs(b[1] - a[1]) / run)
  }
  total += segment.length
  rows.push({ id: segment.spec.id, from: segment.spec.from, to: segment.spec.to, length: Number(segment.length.toFixed(1)), maxGradePct: Number((maxGrade * 100).toFixed(1)) })
}
console.table(rows)
console.log(`Largo total: ${total.toFixed(0)} m en ${compiled.segments.length} segmentos y ${compiled.nodes.length} nodos.`)

// Separación entre segmentos sin nodo común. Clearance: anchos medios + 4 m de roca;
// con más de 12 m de diferencia de cota se consideran niveles distintos.
const problems = []
for (let i = 0; i < compiled.segments.length; i++) {
  for (let j = i + 1; j < compiled.segments.length; j++) {
    const a = compiled.segments[i], b = compiled.segments[j]
    const shared = [a.spec.from, a.spec.to].some(node => node === b.spec.from || node === b.spec.to)
    if (shared) continue
    const clearance = a.profile.width / 2 + b.profile.width / 2 + 4
    let worst = Infinity
    let where = null
    for (const p of samples(a)) for (const q of samples(b)) {
      if (Math.abs(p[1] - q[1]) > 12) continue
      const d = Math.hypot(p[0] - q[0], p[2] - q[2])
      if (d < worst) { worst = d; where = p }
    }
    if (worst < clearance) problems.push(`${a.spec.id} y ${b.spec.id}: ${worst.toFixed(1)} m (mínimo ${clearance.toFixed(1)} m) cerca de (${where.map(v => v.toFixed(0)).join(', ')})`)
  }
}
// Cámaras contra segmentos que no llegan a ellas.
for (const chamber of compiled.chambers) {
  const node = compiled.nodes[chamber.node]
  for (const segment of compiled.segments) {
    if (segment.spec.from === node.id || segment.spec.to === node.id) continue
    for (const p of samples(segment)) {
      if (Math.abs(p[1] - chamber.floorY) > 12) continue
      const dx = Math.max(Math.abs(p[0] - chamber.cx) - chamber.hx, 0)
      const dz = Math.max(Math.abs(p[2] - chamber.cz) - chamber.hz, 0)
      if (Math.hypot(dx, dz) < segment.profile.width / 2 + 4) { problems.push(`${segment.spec.id} pasa a ${Math.hypot(dx, dz).toFixed(1)} m de la cámara ${node.id}`); break }
    }
  }
}
console.log(problems.length ? `Separaciones insuficientes:\n- ${problems.join('\n- ')}` : 'Sin cruces no previstos entre galerías.')
console.log(`Caja: [${compiled.min.map(v => v.toFixed(0))}] – [${compiled.max.map(v => v.toFixed(0))}]`)
