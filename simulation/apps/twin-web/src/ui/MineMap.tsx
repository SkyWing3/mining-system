// Mapa de la mina visto desde arriba: galerías coloreadas por la cobertura Wi-Fi del
// modelo, cuartos de gas y de calor, refugios, puntos de acceso (con clic se simula su
// falla) y el minero. Todo lo que muestra sale del gemelo, no de la manilla: la manilla
// real no conoce su posición ni la cobertura.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Map as MapIcon, Wifi } from 'lucide-react'
import { frameAt } from '@twin/mine-generator'
import type { SourceCategory } from '@twin/shared-types'
import { mineCompiled, radio, sourceStrengths, useDevice } from '../device/runtime.ts'
import { layout } from '../layout.ts'
import { miner } from '../scene/minerState.ts'
import { signalBand, type Band } from './signal.ts'

const WIDTH = 332
const PADDING = 10
/** Cota que separa el nivel 0 del nivel −1 (m). */
const LEVEL_SPLIT = -12

type LevelFilter = 'auto' | 0 | -1 | 'all'

const BAND_STROKE: Record<Band, string> = {
  good: 'var(--color-state-ok)',
  fair: 'var(--color-state-warn)',
  poor: 'var(--color-state-alarm)',
  none: 'var(--color-ink-600)',
}
const CATEGORY_LABEL: Record<SourceCategory, string> = {
  diesel: 'Escape diésel',
  blast: 'Humos de voladura',
  'old-workings': 'Labor abandonada',
  'no-ventilation': 'Sin ventilación',
  fire: 'Incendio latente',
  heat: 'Calor',
}

const levelOf = (y: number) => (y > LEVEL_SPLIT ? 0 : -1)

interface Run {
  readonly points: string
  readonly band: Band
  readonly level: 0 | -1
}

function useProjection() {
  return useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (const segment of mineCompiled.segments) {
      for (let index = 0; index < segment.points.length; index += 3) {
        minX = Math.min(minX, segment.points[index]); maxX = Math.max(maxX, segment.points[index])
        minZ = Math.min(minZ, segment.points[index + 2]); maxZ = Math.max(maxZ, segment.points[index + 2])
      }
    }
    for (const node of mineCompiled.nodes) {
      const half = node.size ? Math.max(node.size[0], node.size[2]) / 2 : 0
      minX = Math.min(minX, node.position[0] - half); maxX = Math.max(maxX, node.position[0] + half)
      minZ = Math.min(minZ, node.position[2] - half); maxZ = Math.max(maxZ, node.position[2] + half)
    }
    const scale = (WIDTH - PADDING * 2) / Math.max(maxX - minX, 1)
    const height = Math.round((maxZ - minZ) * scale + PADDING * 2)
    const x = (value: number) => PADDING + (value - minX) * scale
    const y = (value: number) => PADDING + (value - minZ) * scale
    return { x, y, scale, height }
  }, [])
}

/** Tramos de cada galería agrupados por nivel y por calidad de la señal. */
function useRuns(project: ReturnType<typeof useProjection>, disabled: ReadonlySet<string>): Run[] {
  return useMemo(() => {
    void disabled
    const runs: Run[] = []
    for (const [index, segment] of mineCompiled.segments.entries()) {
      let points: string[] = []
      let band: Band | null = null
      let level: 0 | -1 = 0
      const count = segment.points.length / 3
      for (let i = 0; i < count; i += 2) {
        const o = i * 3
        const nextBand: Band = radio ? signalBand(radio.bestRssi({ segment: index, s: segment.distances[i] })) : 'good'
        const nextLevel = levelOf(segment.points[o + 1])
        const point = `${project.x(segment.points[o]).toFixed(1)},${project.y(segment.points[o + 2]).toFixed(1)}`
        if (band !== null && (band !== nextBand || level !== nextLevel)) {
          // Cada tramo empieza donde terminó el anterior para que la línea sea continua.
          runs.push({ points: points.join(' '), band, level })
          points = [points[points.length - 1]]
        }
        points.push(point)
        band = nextBand
        level = nextLevel
      }
      if (band !== null) runs.push({ points: points.join(' '), band, level })
    }
    return runs
  }, [project, disabled])
}

function useSecondTick(): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick(value => value + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  return tick
}

function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex overflow-hidden rounded border border-ink-700">
      {options.map(option => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={event => { onChange(option.value); event.currentTarget.blur() }}
          className={`h-6 px-1.5 text-[10px] ${value === option.value ? 'bg-ink-700 text-ink-100' : 'bg-ink-850 text-ink-400 hover:text-ink-100'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function Legend({ color, children, dashed }: { color: string; children: ReactNode; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1">
      <svg width="14" height="6" aria-hidden><line x1="1" y1="3" x2="13" y2="3" stroke={color} strokeWidth="3" strokeDasharray={dashed ? '2 2' : undefined} /></svg>
      {children}
    </span>
  )
}

export function MineMap() {
  const project = useProjection()
  const disabled = useDevice(state => state.disabledAccessPoints)
  const toggleAccessPoint = useDevice(state => state.toggleAccessPoint)
  const associated = useDevice(state => state.wifi?.state === 'connected' ? state.wifi.accessPoint : null)
  const runs = useRuns(project, disabled)
  const [filter, setFilter] = useState<LevelFilter>('auto')
  const [coverage, setCoverage] = useState(true)
  const tick = useSecondTick()
  const arrow = useRef<SVGGElement>(null)
  const twoLevels = useMemo(() => mineCompiled.nodes.some(node => levelOf(node.position[1]) === -1), [])
  const [minerLevel, setMinerLevel] = useState<0 | -1>(0)

  // Flecha del minero: se mueve sin pasar por React en cada fotograma.
  useEffect(() => {
    let frame = 0
    const update = () => {
      const element = arrow.current
      if (element) {
        const yaw = miner.bodyYaw
        const angle = (Math.atan2(-Math.cos(yaw), -Math.sin(yaw)) * 180) / Math.PI
        element.setAttribute('transform', `translate(${project.x(miner.position.x).toFixed(1)} ${project.y(miner.position.z).toFixed(1)}) rotate(${angle.toFixed(1)})`)
        element.style.display = miner.spawned ? '' : 'none'
      }
      const level = levelOf(miner.position.y)
      setMinerLevel(current => (current === level ? current : level))
      frame = requestAnimationFrame(update)
    }
    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [project])

  const shown = filter === 'auto' ? minerLevel : filter
  const visible = (level: 0 | -1) => shown === 'all' || level === shown
  const strengths = useMemo(() => { void tick; return sourceStrengths() }, [tick])

  const sources = layout.environment?.sources ?? []
  const nodeById = (id: string) => mineCompiled.nodes.find(node => node.id === id)

  return (
    <section data-testid="mine-map" className="pointer-events-auto rounded-lg border border-ink-700 bg-ink-900/90 p-3 text-xs backdrop-blur">
      <h2 className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-wider text-ink-300 uppercase">
        <MapIcon size={14} />
        <span className="flex-1">Mapa</span>
        {twoLevels ? (
          <Segmented<LevelFilter> label="Nivel del mapa" value={filter} onChange={setFilter} options={[{ value: 'auto', label: 'Minero' }, { value: 0, label: 'N0' }, { value: -1, label: 'N−1' }, { value: 'all', label: 'Ambos' }]} />
        ) : null}
        {radio ? (
          <button type="button" aria-pressed={coverage} title="Colorear las galerías según la cobertura Wi-Fi del modelo" onClick={event => { setCoverage(!coverage); event.currentTarget.blur() }} className={`flex h-6 items-center gap-1 rounded border px-1.5 text-[10px] normal-case ${coverage ? 'border-sand-300/60 bg-ink-700 text-ink-100' : 'border-ink-700 bg-ink-850 text-ink-400'}`}>
            <Wifi size={11} />Cobertura
          </button>
        ) : null}
      </h2>
      <svg width={WIDTH} height={project.height} viewBox={`0 0 ${WIDTH} ${project.height}`} className="block rounded bg-ink-950/70" role="img" aria-label="Mapa de galerías, cuartos de gas, puntos de acceso y posición del minero">
        {/* Galerías: el otro nivel queda atenuado al mostrar ambos. */}
        {runs.map((run, index) => (visible(run.level) ? (
          <polyline
            key={index}
            points={run.points}
            fill="none"
            stroke={coverage ? BAND_STROKE[run.band] : 'var(--color-ink-300)'}
            strokeOpacity={shown === 'all' && run.level !== minerLevel ? 0.35 : 0.95}
            strokeWidth={3}
            strokeDasharray={coverage && run.band === 'none' ? '3 2' : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null))}
        {/* Cámaras, refugios y bocamina. */}
        {mineCompiled.nodes.map(node => {
          if (!visible(levelOf(node.position[1]))) return null
          const cx = project.x(node.position[0]), cy = project.y(node.position[2])
          if (node.kind === 'refuge') return <g key={node.id}><title>{node.zone}</title><rect x={cx - 4} y={cy - 4} width={8} height={8} rx={1.5} fill="var(--color-state-ok)" /><text x={cx} y={cy + 2.6} textAnchor="middle" fontSize={7} fontWeight={700} fill="var(--color-ink-950)">R</text></g>
          if (node.kind === 'chamber' && node.size) {
            const w = node.size[0] * project.scale, h = node.size[2] * project.scale
            return <g key={node.id}><title>{node.zone}</title><rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={1.5} fill="none" stroke="var(--color-ink-400)" strokeWidth={1} /></g>
          }
          if (node.id === mineCompiled.nodes[0]?.id) return <g key={node.id}><title>Bocamina</title><text x={cx + 5} y={cy + 3} fontSize={8} fill="var(--color-ink-300)">Bocamina</text></g>
          return null
        })}
        {/* Cuartos de gas y de calor: el color indica el nivel actual en la fuente. */}
        {sources.map(source => {
          const node = nodeById(source.node)
          if (!node || !visible(levelOf(node.position[1]))) return null
          const strength = strengths[source.id] ?? 0
          const heat = source.category === 'heat'
          const severity = heat ? 'alarm' : strength >= 200 ? 'alarm' : strength >= 35 ? 'warn' : 'idle'
          const fill = severity === 'alarm' ? 'var(--color-state-alarm)' : severity === 'warn' ? 'var(--color-state-warn)' : 'var(--color-ink-600)'
          const cx = project.x(node.position[0]), cy = project.y(node.position[2])
          return (
            <g key={source.id} data-testid={`map-source-${source.id}`}>
              <title>{`${source.label} · ${heat ? 'calor' : `${Math.round(strength)} ppm de CO en la fuente`}`}</title>
              <circle cx={cx} cy={cy} r={6.5} fill={fill} fillOpacity={0.28} stroke={fill} strokeWidth={1.2} />
              <text x={cx} y={cy + 2.5} textAnchor="middle" fontSize={7} fontWeight={700} fill="var(--color-ink-100)">{heat ? '°C' : 'CO'}</text>
            </g>
          )
        })}
        {/* Puntos de acceso Wi-Fi: clic para simular una falla. */}
        {radio?.accessPoints.map(ap => {
          const segment = mineCompiled.segments.find(item => item.spec.id === ap.segment)
          if (!segment) return null
          const frame = frameAt(segment, ap.at)
          if (!visible(levelOf(frame.position[1]))) return null
          const off = disabled.has(ap.id)
          const cx = project.x(frame.position[0]), cy = project.y(frame.position[2])
          return (
            <g key={ap.id} data-testid={`map-ap-${ap.id}`} className="cursor-pointer" onClick={() => toggleAccessPoint(ap.id)}>
              <title>{`${ap.id} · ${off ? 'fuera de servicio' : 'en servicio'} — clic para ${off ? 'restablecerlo' : 'simular una falla'}`}</title>
              {associated === ap.id ? <circle cx={cx} cy={cy} r={7} fill="none" stroke="var(--color-sand-300)" strokeWidth={1.3} /> : null}
              <rect x={cx - 3.2} y={cy - 3.2} width={6.4} height={6.4} transform={`rotate(45 ${cx} ${cy})`} fill={off ? 'var(--color-ink-700)' : 'var(--color-ink-100)'} stroke={off ? 'var(--color-state-alarm)' : 'var(--color-ink-950)'} strokeWidth={1} />
              <circle cx={cx} cy={cy} r={9} fill="transparent" />
            </g>
          )
        })}
        <g ref={arrow} data-testid="map-miner">
          <circle r={6} fill="var(--color-sand-300)" fillOpacity={0.25} />
          <path d="M 6 0 L -4 -4 L -2 0 L -4 4 Z" fill="var(--color-sand-300)" stroke="var(--color-ink-950)" strokeWidth={0.8} />
        </g>
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ink-400">
        {radio && coverage ? (
          <>
            <Legend color={BAND_STROKE.good}>Señal buena</Legend>
            <Legend color={BAND_STROKE.fair}>Aceptable</Legend>
            <Legend color={BAND_STROKE.poor}>Débil</Legend>
            <Legend color={BAND_STROKE.none} dashed>Sin señal</Legend>
          </>
        ) : null}
        <span className="flex items-center gap-1"><svg width="9" height="9" aria-hidden><rect x="1.5" y="1.5" width="6" height="6" transform="rotate(45 4.5 4.5)" fill="var(--color-ink-100)" /></svg>Antena (clic: falla)</span>
        <span className="flex items-center gap-1"><svg width="10" height="10" aria-hidden><circle cx="5" cy="5" r="4" fill="var(--color-state-alarm)" fillOpacity={0.3} stroke="var(--color-state-alarm)" /></svg>Gas o calor</span>
      </div>
      {sources.length > 0 ? (
        <ul className="mt-2 space-y-0.5 border-t border-ink-700 pt-2 text-[10px] text-ink-300">
          {sources.filter(source => source.category && source.category !== 'diesel').map(source => (
            <li key={source.id} className="flex justify-between gap-2">
              <span className="truncate">{nodeById(source.node)?.zone ?? source.label}</span>
              <span className="whitespace-nowrap text-ink-400">{source.category ? CATEGORY_LABEL[source.category] : ''} · {levelOf(nodeById(source.node)?.position[1] ?? 0) === 0 ? 'N0' : 'N−1'}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
