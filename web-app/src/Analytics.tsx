import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, PointerEvent, ReactNode } from 'react'
import { Activity, CircleHelp, FilterX, Gauge, MessageSquare, RefreshCw, TrendingUp, TriangleAlert } from 'lucide-react'
import { api, ApiError, loadWithRecovery } from './api'
import { Empty } from './components'
import { ApplicationForm, Select, TextField, Tooltip } from './controls'
import type { AnalyticsOptions, Bucket, MessageAnalytics, Metric, ReadingAnalytics } from './types'
import './analytics.css'

const HOUR = 3600000
const DAY = 24 * HOUR
// Bolivia keeps UTC−4 all year; the API counts days in the same local time.
const LOCAL_OFFSET = -4 * HOUR
const zone = 'America/La_Paz'
const metrics: Record<Metric, { label: string; noun: string; digits: number }> = {
  temperature: { label: 'Temperatura', noun: 'temperatura', digits: 1 },
  gas: { label: 'Gas', noun: 'gas', digits: 0 },
  battery: { label: 'Batería', noun: 'batería', digits: 0 },
}
const presets = { '24h': { label: '24 h', span: DAY }, '7d': { label: '7 días', span: 7 * DAY }, '30d': { label: '30 días', span: 30 * DAY } } as const
type Preset = keyof typeof presets
type Range = { preset: Preset } | { preset: 'custom'; from: string; to: string }
const severities = [
  { key: 'critical', label: 'Críticos', color: 'var(--wine)' },
  { key: 'warning', label: 'Atención', color: 'var(--earth)' },
  { key: 'info', label: 'Informativos', color: 'var(--plum)' },
] as const
type SeverityKey = typeof severities[number]['key']

const formatters = {
  hour: new Intl.DateTimeFormat('es-BO', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zone }),
  day: new Intl.DateTimeFormat('es-BO', { day: 'numeric', month: 'short', timeZone: zone }),
  full: new Intl.DateTimeFormat('es-BO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: zone }),
  moment: new Intl.DateTimeFormat('es-BO', { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }),
}
const localDate = (time: number) => new Date(time + LOCAL_OFFSET).toISOString().slice(0, 10)
const localMidnight = (day: string) => Date.parse(`${day}T00:00:00Z`) - LOCAL_OFFSET
const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(localMidnight(day)) && new Date(`${day}T00:00:00Z`).toISOString().startsWith(day)
const value = (number: number | null, unit: string, digits: number) => number === null ? '—' : `${number.toFixed(digits)} ${unit}`
const minerLabel = (name: string) => name || 'Sin asignar'

function windowOf(range: Range) {
  if (range.preset === 'custom') return { from: new Date(localMidnight(range.from)).toISOString(), to: new Date(localMidnight(range.to) + DAY).toISOString() }
  const now = Date.now()
  return { from: new Date(now - presets[range.preset].span).toISOString(), to: new Date(now).toISOString() }
}

function intervalLabel(start: string, bucket: Bucket) {
  const time = Date.parse(start)
  return bucket === 'day' ? formatters.full.format(time) : `${formatters.full.format(time)}, ${formatters.hour.format(time)}–${formatters.hour.format(time + HOUR)}`
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

// Round axis limits to 1, 2 or 5 × 10ⁿ so gridlines land on readable values.
function ticks(min: number, max: number, count = 4) {
  if (min === max) { min -= 1; max += 1 }
  const rough = (max - min) / count
  const power = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 5, 10].map(x => x * power).find(x => x >= rough) ?? rough
  const low = Math.floor(min / step) * step
  const high = Math.ceil(max / step) * step
  const values: number[] = []
  for (let tick = low; tick <= high + step / 2; tick += step) values.push(Number(tick.toFixed(6)))
  return values
}

export function AnalyticsPage({ tick, onError }: { tick: number; onError: (error: unknown) => void }) {
  const [range, setRange] = useState<Range>({ preset: '7d' })
  const [miner, setMiner] = useState('')
  const [area, setArea] = useState('')
  const [metric, setMetric] = useState<Metric>('temperature')
  const [bucket, setBucket] = useState<'auto' | Bucket>('auto')
  const [options, setOptions] = useState<AnalyticsOptions | null>(null)
  const [data, setData] = useState<{ readings: ReadingAnalytics; messages: MessageAnalytics; at: Date; key: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [customError, setCustomError] = useState('')
  const [draft, setDraft] = useState(() => ({ from: localDate(Date.now() - 6 * DAY), to: localDate(Date.now()) }))

  function failed(error: unknown) {
    // An expired session is handled by the central; any other failure stays inside this page.
    if (error instanceof ApiError && error.status === 401) onError(error)
    else setError((error as Error).message)
    setLoading(false)
  }
  const fail = useRef(failed)
  useEffect(() => { fail.current = failed })

  // Filter choices are optional: without them the page still works with "todos".
  useEffect(() => loadWithRecovery(signal => api<AnalyticsOptions>('/analytics/options', { signal }), setOptions, error => { if (error instanceof ApiError && error.status === 401) onError(error) }, 200), [tick, onError])
  useEffect(() => loadWithRecovery(signal => {
    setLoading(true)
    const { from, to } = windowOf(range)
    const shared = new URLSearchParams({ from, to })
    if (miner) shared.set('miner', miner)
    if (area) shared.set('zone', area)
    const readings = new URLSearchParams(shared)
    readings.set('metric', metric)
    readings.set('bucket', bucket)
    return Promise.all([api<ReadingAnalytics>(`/analytics/readings?${readings}`, { signal }), api<MessageAnalytics>(`/analytics/messages?${shared}`, { signal })])
  }, ([readings, messages]) => { setData({ readings, messages, at: new Date(), key: JSON.stringify([range, miner, area, metric, bucket]) }); setError(''); setLoading(false) },
  error => {
    // Invalid filters make the previous result misleading; a transient failure keeps it visible while retrying.
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) setData(null)
    fail.current(error)
  }, 250), [range, miner, area, metric, bucket, tick])

  function applyCustom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const from = String(form.get('from')).trim(), to = String(form.get('to')).trim()
    if (!validDay(from) || !validDay(to)) { setCustomError('Escribe las fechas con el formato AAAA-MM-DD, por ejemplo 2026-10-01.'); return }
    setCustomError(''); setDraft({ from, to }); setRange({ preset: 'custom', from, to })
  }
  const minerOptions = [...new Set([...(options?.miners ?? []), ...(miner ? [miner] : [])])]
  const zoneOptions = [...new Set([...(options?.zones ?? []), ...(area ? [area] : [])])]
  const readings = data?.readings
  const messages = data?.messages
  const definition = metrics[metric]
  const unit = readings?.unit ?? ''
  const filtered = miner || area || range.preset !== '7d' || bucket !== 'auto'
  // Results for previous filters stay visible (dimmed) until the new ones arrive.
  const stale = !!data && data.key !== JSON.stringify([range, miner, area, metric, bucket])
  const pending = loading || stale

  return <div className={`analytics ${stale ? 'stale' : ''}`} aria-busy={pending}>
    <section className="panel analytics-filters" aria-label="Filtros del análisis">
      <div className="analytics-toolbar">
        <div className="analytics-field"><span className="analytics-label">Periodo</span><div className="tabs" role="group" aria-label="Periodo: últimos días u horas">
          {(Object.keys(presets) as Preset[]).map(key => <button key={key} type="button" aria-pressed={range.preset === key} className={range.preset === key ? 'selected' : ''} onClick={() => setRange({ preset: key })}>{presets[key].label}</button>)}
          <button type="button" aria-pressed={range.preset === 'custom'} className={range.preset === 'custom' ? 'selected' : ''} onClick={() => setRange({ preset: 'custom', ...draft })}>Personalizado</button>
        </div></div>
        <div className="analytics-field"><span className="analytics-label">Métrica de lecturas</span><div className="tabs" role="group" aria-label="Métrica">
          {(Object.keys(metrics) as Metric[]).map(key => <button key={key} type="button" aria-pressed={metric === key} className={metric === key ? 'selected' : ''} onClick={() => setMetric(key)}>{metrics[key].label}</button>)}
        </div></div>
        <Select label="Minero" value={miner} onChange={setMiner} options={[{ value: '', label: 'Todos los mineros' }, ...minerOptions.map(name => ({ value: name, label: name }))]} />
        <Select label="Zona" value={area} onChange={setArea} options={[{ value: '', label: 'Todas las zonas' }, ...zoneOptions.map(name => ({ value: name, label: name }))]} />
        <Select label="Intervalo" value={bucket} onChange={value => setBucket(value as 'auto' | Bucket)} options={[{ value: 'auto', label: 'Automático' }, { value: 'hour', label: 'Por hora' }, { value: 'day', label: 'Por día' }]} />
        <button type="button" className="button secondary analytics-clear" disabled={!filtered} onClick={() => { setMiner(''); setArea(''); setBucket('auto'); setRange({ preset: '7d' }) }}><FilterX size={16} />Limpiar filtros</button>
      </div>
      {range.preset === 'custom' && <ApplicationForm key={`${draft.from}-${draft.to}`} className="analytics-custom" onSubmit={applyCustom}>
        <TextField label="Desde" name="from" defaultValue={draft.from} placeholder="AAAA-MM-DD" inputMode="numeric" maxLength={10} required />
        <TextField label="Hasta (incluido)" name="to" defaultValue={draft.to} placeholder="AAAA-MM-DD" inputMode="numeric" maxLength={10} required />
        <button className="button primary">Aplicar fechas</button>
        {customError && <p className="field-error" role="alert">{customError}</p>}
      </ApplicationForm>}
      <div className="analytics-scope">
        <span>{readings ? <>{formatters.moment.format(Date.parse(readings.from))} – {formatters.moment.format(Date.parse(readings.to))}<span className="dot-separator">·</span>{readings.bucket === 'hour' ? 'Por hora' : 'Por día'}<span className="dot-separator">·</span>Hora de Bolivia</> : 'Rango máximo de 90 días; por hora, hasta 14 días.'}</span>
        <span role="status" className="analytics-refresh"><RefreshCw size={13} className={pending ? 'spinning' : ''} />{pending ? 'Actualizando…' : data ? `Actualizado ${formatters.hour.format(data.at)}` : ''}</span>
      </div>
    </section>

    {error && data && <div className="error-banner" role="alert"><TriangleAlert size={18} /><span>{error} Se muestran los últimos datos obtenidos; la consulta se reintentará.</span></div>}
    {error && !data ? <section className="panel"><Empty title="No se pudo obtener el análisis" text={error} /><div className="panel-bottom-note"><CircleHelp size={15} />Ajusta los filtros o espera: los errores de conexión se reintentan automáticamente.</div></section>
      : !readings || !messages ? <section className="panel"><div className="loading-panel"><span className="spinner" />Calculando el análisis…</div></section>
      : <>
        <div className="stats-grid analytics-stats">
          <Kpi label="LECTURAS" value={readings.summary.readings.toLocaleString('es-BO')} icon={<Activity size={21} />} note={`Con dato de ${definition.noun} en el rango`} />
          <Kpi label="PROMEDIO" value={value(readings.summary.average, unit, definition.digits)} icon={<Gauge size={21} />} note={readings.summary.minimum === null ? 'Sin lecturas en el rango' : `Mínimo: ${value(readings.summary.minimum, unit, definition.digits)}`} />
          <Kpi label="MÁXIMO" value={value(readings.summary.maximum, unit, definition.digits)} icon={<TrendingUp size={21} />} note={`Mayor ${definition.noun} registrada`} />
          <Kpi label="MENSAJES CRÍTICOS" value={messages.summary.critical.toLocaleString('es-BO')} icon={<TriangleAlert size={21} />} note={`${messages.summary.pendingCritical} sin revisar · ${messages.summary.total} mensajes en total`} alert />
        </div>
        <section className="panel analytics-series">
          <div className="panel-heading"><div><h2>Evolución de {definition.noun}</h2><p>Promedio y máximo {readings.bucket === 'hour' ? 'por hora' : 'por día'}. Los intervalos sin lecturas quedan como huecos.</p></div>
            <div className="chart-legend" aria-hidden="true"><span><i className="legend-line" />Promedio</span><span><i className="legend-line dashed" />Máximo</span></div></div>
          {readings.summary.readings ? <SeriesChart data={readings} digits={definition.digits} /> : <Empty title="Sin lecturas en este rango" text={`No hay datos de ${definition.noun} para los filtros elegidos. Amplía el periodo o quita el filtro de minero o zona.`} />}
          <div className="panel-bottom-note"><CircleHelp size={15} />El gas en ppm requiere un sensor calibrado. Las lecturas se muestran sin clasificación automática de riesgo; un dato ausente no se cuenta como cero.</div>
        </section>
        <div className="analytics-grid">
          <section className="panel">
            <div className="panel-heading"><div><h2>Comparación por minero</h2><p>{definition.label} promedio y máxima en el rango. Haz clic en un minero para filtrar.</p></div>
              <div className="chart-legend" aria-hidden="true"><span><i className="legend-swatch average" />Promedio</span><span><i className="legend-swatch maximum" />Máximo</span></div></div>
            {readings.miners.length ? <MinerBars rows={readings.miners} unit={unit} digits={definition.digits} selected={miner} select={setMiner} /> : <Empty title="Sin mineros con lecturas" text="Ningún minero registró esta métrica en el rango y la zona elegidos." />}
          </section>
          <section className="panel">
            <div className="panel-heading"><div><h2>Mensajes por día</h2><p>Reportes recibidos por prioridad, en días de Bolivia.</p></div></div>
            {messages.summary.total ? <MessageColumns days={messages.days} /> : <Empty title="Sin mensajes en este rango" text="Las manillas no enviaron reportes con los filtros elegidos." />}
            <div className="panel-bottom-note"><MessageSquare size={15} />Se cuenta la fecha de recepción en la central.</div>
          </section>
        </div>
      </>}
  </div>
}

function Kpi({ label, value, icon, note, alert = false }: { label: string; value: ReactNode; icon: ReactNode; note: string; alert?: boolean }) {
  return <article className={`stat-card ${alert ? 'alert' : ''}`}><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><div className="stat-number">{value}</div><p>{alert && <span className="tiny-dot" />}{note}</p></article>
}

function ChartTip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const tip = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(180)
  useLayoutEffect(() => { if (tip.current) setSize(tip.current.offsetWidth) }, [children])
  return <div ref={tip} role="tooltip" className="chart-tooltip" style={{ left: Math.max(0, Math.min(x - size / 2, width - size)) }}>{children}</div>
}

function useActiveIndex(count: number) {
  const [active, setActive] = useState<number | null>(null)
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key]
    if (event.key === 'Escape') { setActive(null); return }
    if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); setActive(event.key === 'Home' ? 0 : count - 1); return }
    if (!step) return
    event.preventDefault()
    setActive(current => current === null ? (step > 0 ? 0 : count - 1) : Math.max(0, Math.min(count - 1, current + step)))
  }
  return { active: active !== null && active < count ? active : null, setActive, keyboard }
}

function SeriesChart({ data, digits }: { data: ReadingAnalytics; digits: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const series = data.series
  const { active, setActive, keyboard } = useActiveIndex(series.length)
  const height = width < 520 ? 220 : 270
  const margin = { top: 16, right: 14, bottom: 30, left: 46 }
  const plot = { width: Math.max(1, width - margin.left - margin.right), height: height - margin.top - margin.bottom }
  const values = series.flatMap(point => [point.average, point.maximum]).filter((x): x is number => x !== null)
  const scale = ticks(Math.min(...values), Math.max(...values))
  const low = scale[0], high = scale.at(-1)!
  const band = plot.width / series.length
  const x = (index: number) => margin.left + band * (index + .5)
  const y = (number: number) => margin.top + plot.height - (number - low) / (high - low || 1) * plot.height
  // Consecutive buckets with data form a segment; an empty bucket breaks the line.
  const segments = (key: 'average' | 'maximum') => series.reduce<[number, number][][]>((all, point, index) => {
    const number = point[key]
    if (number === null) { if (all.at(-1)?.length) all.push([]); return all }
    if (!all.length) all.push([])
    all.at(-1)!.push([x(index), y(number)])
    return all
  }, []).filter(segment => segment.length)
  const labelEvery = Math.max(1, Math.ceil(series.length / Math.max(2, Math.floor(plot.width / 86))))
  const label = (start: string, index: number) => {
    const time = Date.parse(start)
    if (data.bucket === 'day') return formatters.day.format(time)
    const previous = index >= labelEvery ? localDate(Date.parse(series[index - labelEvery].start)) : ''
    return previous && previous === localDate(time) ? formatters.hour.format(time) : `${formatters.day.format(time)} ${formatters.hour.format(time)}`
  }
  function pointer(event: PointerEvent<SVGRectElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    setActive(Math.max(0, Math.min(series.length - 1, Math.floor((event.clientX - bounds.left) / band))))
  }
  const point = active === null ? null : series[active]
  const withData = series.filter(item => item.count > 0).length
  return <div ref={ref} className="chart-frame" tabIndex={0} role="group" onKeyDown={keyboard} onBlur={() => setActive(null)}
    aria-label={`Evolución de ${metrics[data.metric].noun}: ${withData} de ${series.length} intervalos con lecturas. Usa las flechas para recorrer los valores.`}>
    {width > 0 && <svg className="analytics-chart" width={width} height={height} role="img" aria-label={`Promedio y máximo de ${metrics[data.metric].noun} ${data.bucket === 'hour' ? 'por hora' : 'por día'}`}>
      {scale.map(tick => <g key={tick}><line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} className="chart-grid" /><text x={margin.left - 8} y={y(tick) + 4} textAnchor="end">{tick}</text></g>)}
      {series.map((item, index) => index % labelEvery === 0 && <text key={item.start} x={x(index)} y={height - 8} textAnchor="middle">{label(item.start, index)}</text>)}
      {active !== null && <line x1={x(active)} x2={x(active)} y1={margin.top} y2={margin.top + plot.height} className="chart-crosshair" />}
      {segments('maximum').map((segment, index) => segment.length > 1 && <polyline key={index} className="series-maximum" points={segment.join(' ')} />)}
      {segments('average').map((segment, index) => segment.length > 1 && <polyline key={index} className="series-average" points={segment.join(' ')} />)}
      {/* Isolated buckets have no neighbour to join, so a marker keeps them visible. */}
      {series.map((item, index) => {
        const isolated = (series[index - 1]?.count ?? 0) === 0 && (series[index + 1]?.count ?? 0) === 0
        return item.average !== null && (isolated || active === index || series.length <= 40) && <g key={item.start}>
          {item.maximum !== null && <circle cx={x(index)} cy={y(item.maximum)} r={active === index ? 5 : 3.5} className="point-maximum" />}
          <circle cx={x(index)} cy={y(item.average)} r={active === index ? 5 : 3.5} className="point-average" />
        </g>
      })}
      <rect x={margin.left} y={margin.top} width={plot.width} height={plot.height} fill="transparent" onPointerMove={pointer} onPointerDown={pointer} onPointerLeave={() => setActive(null)} />
    </svg>}
    {point && active !== null && <ChartTip x={x(active)} width={width}><strong>{intervalLabel(point.start, data.bucket)}</strong>{point.count ? <>
      <span><i className="legend-line" />Promedio: {value(point.average, data.unit, digits)}</span>
      <span><i className="legend-line dashed" />Máximo: {value(point.maximum, data.unit, digits)}</span>
      <small>{point.count} {point.count === 1 ? 'lectura' : 'lecturas'}</small></> : <small>Sin lecturas en este intervalo</small>}</ChartTip>}
    <table className="sr-only"><caption>Valores por intervalo</caption><thead><tr><th>Intervalo</th><th>Promedio</th><th>Máximo</th><th>Lecturas</th></tr></thead>
      <tbody>{series.filter(item => item.count).map(item => <tr key={item.start}><td>{intervalLabel(item.start, data.bucket)}</td><td>{value(item.average, data.unit, digits)}</td><td>{value(item.maximum, data.unit, digits)}</td><td>{item.count}</td></tr>)}</tbody></table>
  </div>
}

function MinerBars({ rows, unit, digits, selected, select }: { rows: ReadingAnalytics['miners']; unit: string; digits: number; selected: string; select: (miner: string) => void }) {
  const sorted = [...rows].sort((a, b) => (b.average ?? -Infinity) - (a.average ?? -Infinity))
  const low = Math.min(0, ...sorted.map(row => row.average ?? 0))
  const high = Math.max(...sorted.map(row => row.maximum ?? 0), low + 1)
  const width = (number: number | null) => number === null ? 0 : Math.max(1.5, (number - low) / (high - low) * 100)
  return <div className="miner-bars">{sorted.map(row => {
    const chosen = selected === row.miner
    const summary = `Promedio ${value(row.average, unit, digits)} · Máximo ${value(row.maximum, unit, digits)} · ${row.count} ${row.count === 1 ? 'lectura' : 'lecturas'}`
    return <Tooltip key={row.miner} text={row.miner ? `${summary}. ${chosen ? 'Clic para quitar el filtro.' : 'Clic para filtrar.'}` : `${summary}. Lecturas de manillas sin minero asignado.`}>
      <button type="button" className={`miner-bar ${chosen ? 'selected' : ''} ${selected && !chosen ? 'dimmed' : ''}`} aria-pressed={chosen} disabled={!row.miner}
        aria-label={`${minerLabel(row.miner)}: ${summary}`} onClick={() => select(chosen ? '' : row.miner)}>
        <span className="miner-bar-label"><strong>{minerLabel(row.miner)}</strong><span>{value(row.average, unit, digits)} <small>/ máx. {value(row.maximum, unit, digits)}</small></span></span>
        <span className="miner-bar-track"><span className="average" style={{ width: `${width(row.average)}%` }} /></span>
        <span className="miner-bar-track"><span className="maximum" style={{ width: `${width(row.maximum)}%` }} /></span>
      </button>
    </Tooltip>
  })}</div>
}

function MessageColumns({ days }: { days: MessageAnalytics['days'] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hidden, setHidden] = useState<SeverityKey[]>([])
  const { active, setActive, keyboard } = useActiveIndex(days.length)
  const visible = severities.filter(item => !hidden.includes(item.key))
  const height = width < 520 ? 210 : 240
  const margin = { top: 14, right: 10, bottom: 30, left: 36 }
  const plot = { width: Math.max(1, width - margin.left - margin.right), height: height - margin.top - margin.bottom }
  const totals = days.map(day => visible.reduce((sum, item) => sum + day[item.key], 0))
  const scale = ticks(0, Math.max(4, ...totals)).filter(tick => Number.isInteger(tick))
  const high = scale.at(-1)!
  const band = plot.width / days.length
  const bar = Math.max(2, Math.min(34, band * .64))
  const y = (count: number) => margin.top + plot.height - count / high * plot.height
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(plot.width / 62))))
  const stacks = days.map(day => {
    let base = 0
    return visible.map(item => { const segment = { ...item, from: base, to: base + day[item.key] }; base = segment.to; return segment }).filter(segment => segment.to > segment.from)
  })
  const day = active === null ? null : days[active]
  return <div className="messages-chart">
    <div className="chart-legend interactive" role="group" aria-label="Prioridades visibles">{severities.map(item => <button key={item.key} type="button" aria-pressed={!hidden.includes(item.key)}
      onClick={() => setHidden(current => current.includes(item.key) ? current.filter(key => key !== item.key) : [...current, item.key])}><i className="legend-swatch" style={{ background: item.color }} />{item.label}</button>)}</div>
    <div ref={ref} className="chart-frame" tabIndex={0} role="group" onKeyDown={keyboard} onBlur={() => setActive(null)} aria-label="Mensajes por día y prioridad. Usa las flechas para recorrer los días.">
      {width > 0 && <svg className="analytics-chart" width={width} height={height} role="img" aria-label={`Mensajes por día: ${totals.reduce((a, b) => a + b, 0)} en ${days.length} días`}>
        {scale.map(tick => <g key={tick}><line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} className="chart-grid" /><text x={margin.left - 8} y={y(tick) + 4} textAnchor="end">{tick}</text></g>)}
        {days.map((item, index) => <g key={item.day} className={active !== null && active !== index ? 'faded' : ''}>
          {stacks[index].map(segment => <rect key={segment.key} className="message-segment" x={margin.left + band * index + (band - bar) / 2} width={bar}
            y={y(segment.to)} height={Math.max(0, y(segment.from) - y(segment.to))} rx={2} fill={segment.color} />)}
          {index % labelEvery === 0 && <text x={margin.left + band * (index + .5)} y={height - 8} textAnchor="middle">{formatters.day.format(Date.parse(item.start))}</text>}
        </g>)}
        <rect x={margin.left} y={margin.top} width={plot.width} height={plot.height} fill="transparent" onPointerLeave={() => setActive(null)}
          onPointerMove={event => setActive(Math.max(0, Math.min(days.length - 1, Math.floor((event.clientX - event.currentTarget.getBoundingClientRect().left) / band))))} />
      </svg>}
      {day && active !== null && <ChartTip x={margin.left + band * (active + .5)} width={width}><strong>{formatters.full.format(Date.parse(day.start))}</strong>
        {severities.map(item => <span key={item.key}><i className="legend-swatch" style={{ background: item.color }} />{item.label}: {day[item.key]}</span>)}</ChartTip>}
      <table className="sr-only"><caption>Mensajes por día</caption><thead><tr><th>Día</th>{severities.map(item => <th key={item.key}>{item.label}</th>)}</tr></thead>
        <tbody>{days.map(item => <tr key={item.day}><td>{item.day}</td>{severities.map(severity => <td key={severity.key}>{item[severity.key]}</td>)}</tr>)}</tbody></table>
    </div>
  </div>
}
