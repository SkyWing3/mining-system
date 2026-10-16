import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, RefObject } from 'react'
import { date } from '../../utils/format'

export interface ChartPoint {
  time: number
  value: number | null
}

const DEFAULT_WIDTH = 480
const HEIGHT = 200
const LEFT = 46
const RIGHT_PADDING = 14
const TOP = 16
const BOTTOM = 160

// Readings further apart than this are drawn as separate segments (the device was offline).
const DEFAULT_GAP_MS = 45_000

interface Scale {
  x: (time: number) => number
  y: (value: number) => number
  min: number
  max: number
}

function buildScale(points: ChartPoint[], values: number[], width: number): Scale {
  const right = width - RIGHT_PADDING
  const first = points[0]?.time ?? 0
  const last = points.at(-1)?.time ?? first + 1
  let min = values.length ? Math.min(...values) : 0
  let max = values.length ? Math.max(...values) : 1
  if (min === max) {
    min -= 1
    max += 1
  }
  const span = Math.max(1, last - first)
  return {
    x: time => LEFT + ((time - first) / span) * (right - LEFT),
    y: value => BOTTOM - ((value - min) / (max - min)) * (BOTTOM - TOP),
    min,
    max,
  }
}

function segments(points: ChartPoint[], gapMs: number) {
  const result: ChartPoint[][] = []
  let current: ChartPoint[] = []
  let previous: number | null = null
  for (const point of points) {
    const broken = point.value === null || (previous !== null && point.time - previous > gapMs)
    if (broken && current.length) {
      result.push(current)
      current = []
    }
    if (point.value !== null) current.push(point)
    previous = point.time
  }
  if (current.length) result.push(current)
  return result
}

export function LineChart({ points, unit, decimals, label, gapMs = DEFAULT_GAP_MS }: {
  points: ChartPoint[]
  unit: string
  decimals: number
  label: string
  gapMs?: number
}) {
  const container = useRef<HTMLDivElement>(null)
  const width = useWidth(container)
  const valid = useMemo(() => points.filter((point): point is { time: number; value: number } => point.value !== null), [points])
  const scale = useMemo(() => buildScale(points, valid.map(point => point.value), width), [points, valid, width])
  const [active, setActive] = useState<number | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const right = width - RIGHT_PADDING
  const descriptionId = useId()
  const parts = segments(points, gapMs)
  const latest = valid.at(-1)
  const highlighted = active !== null ? valid[active] : null
  const format = (value: number) => `${value.toFixed(decimals)} ${unit}`

  function locate(event: PointerEvent<SVGSVGElement>) {
    const bounds = svg.current?.getBoundingClientRect()
    if (!bounds || !valid.length) return
    const x = ((event.clientX - bounds.left) / bounds.width) * width
    let nearest = 0
    valid.forEach((point, index) => {
      if (Math.abs(scale.x(point.time) - x) < Math.abs(scale.x(valid[nearest].time) - x)) nearest = index
    })
    setActive(nearest)
  }

  function keyboard(event: KeyboardEvent<SVGSVGElement>) {
    if (!valid.length) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const step = event.key === 'ArrowLeft' ? -1 : 1
      setActive(current => Math.max(0, Math.min(valid.length - 1, (current ?? valid.length - 1) + step)))
    } else if (event.key === 'Escape') {
      setActive(null)
    }
  }

  const middle = (scale.min + scale.max) / 2
  const summary = valid.length
    ? `${label}: ${valid.length} lecturas, mínimo ${format(Math.min(...valid.map(point => point.value)))}, máximo ${format(Math.max(...valid.map(point => point.value)))}`
    : `${label}: sin lecturas`
  return (
    <div className="line-chart" ref={container}>
      <svg
        ref={svg}
        className="telemetry-chart"
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        tabIndex={0}
        aria-label={summary}
        aria-describedby={descriptionId}
        onPointerMove={locate}
        onPointerLeave={() => setActive(null)}
        onKeyDown={keyboard}
        onBlur={() => setActive(null)}
      >
        {[scale.max, middle, scale.min].map(value => (
          <g key={value}>
            <line className="chart-grid" x1={LEFT} x2={right} y1={scale.y(value)} y2={scale.y(value)} />
            <text x={LEFT - 8} y={scale.y(value) + 4} textAnchor="end">{value.toFixed(decimals)}</text>
          </g>
        ))}
        {parts.map((part, index) => {
          const path = part.map(point => `${scale.x(point.time).toFixed(1)},${scale.y(point.value!).toFixed(1)}`).join(' ')
          const area = `${scale.x(part[0].time)},${BOTTOM} ${path} ${scale.x(part.at(-1)!.time)},${BOTTOM}`
          return (
            <g key={index}>
              <polygon className="chart-area" points={area} />
              <polyline className="chart-line" points={path} />
            </g>
          )
        })}
        {latest && <circle className="chart-dot" cx={scale.x(latest.time)} cy={scale.y(latest.value)} r={4} />}
        {highlighted && (
          <>
            <line className="chart-crosshair" x1={scale.x(highlighted.time)} x2={scale.x(highlighted.time)} y1={TOP} y2={BOTTOM} />
            <circle className="chart-dot" cx={scale.x(highlighted.time)} cy={scale.y(highlighted.value)} r={5} />
          </>
        )}
        {points.length > 0 && (
          <>
            <text x={LEFT} y={HEIGHT - 16}>{date(new Date(points[0].time).toISOString())}</text>
            <text x={right} y={HEIGHT - 16} textAnchor="end">{date(new Date(points.at(-1)!.time).toISOString())}</text>
          </>
        )}
      </svg>
      <p id={descriptionId} className="sr-only">Usa las flechas izquierda y derecha para recorrer las lecturas.</p>
      {highlighted && (
        <div
          className="chart-tooltip"
          aria-hidden="true"
          style={{ left: `${(scale.x(highlighted.time) / width) * 100}%`, top: `${(scale.y(highlighted.value) / HEIGHT) * 100}%` }}
        >
          <strong>{format(highlighted.value)}</strong>
          <span>{date(new Date(highlighted.time).toISOString())}</span>
        </div>
      )}
      <div className="sr-only" aria-live="polite">{highlighted ? `${format(highlighted.value)} a las ${date(new Date(highlighted.time).toISOString())}` : ''}</div>
    </div>
  )
}

// Draw in real pixels so labels keep their size on every screen.
function useWidth(element: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  useEffect(() => {
    const target = element.current
    if (!target) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(Math.round(entry.contentRect.width))
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [element])
  return width
}

export function Sparkline({ points, label }: { points: ChartPoint[]; label: string }) {
  const valid = points.filter((point): point is { time: number; value: number } => point.value !== null)
  if (valid.length < 2) return <div className="sparkline empty-sparkline" aria-hidden="true" />
  const first = valid[0].time
  const span = Math.max(1, valid.at(-1)!.time - first)
  let min = Math.min(...valid.map(point => point.value))
  let max = Math.max(...valid.map(point => point.value))
  if (min === max) {
    min -= 1
    max += 1
  }
  const x = (time: number) => 4 + ((time - first) / span) * 152
  const y = (value: number) => 30 - ((value - min) / (max - min)) * 24
  const latest = valid.at(-1)!
  return (
    <svg className="sparkline" viewBox="0 0 160 36" role="img" aria-label={label}>
      {segments(points, DEFAULT_GAP_MS).map((part, index) => (
        <polyline key={index} className="chart-line" points={part.map(point => `${x(point.time).toFixed(1)},${y(point.value!).toFixed(1)}`).join(' ')} />
      ))}
      <circle className="chart-dot" cx={x(latest.time)} cy={y(latest.value)} r={4} />
    </svg>
  )
}
