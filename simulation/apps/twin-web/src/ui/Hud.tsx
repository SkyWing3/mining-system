// Interfaz sobre la vista 3D: identidad, controles de cámara y calidad, minero
// controlable con su manilla simulada, diagnóstico de rendimiento y ayudas de navegación.
import { useEffect, useState, type ReactNode } from 'react'
import { Activity, Eye, Gauge, HardHat, Layers, Lightbulb, LightbulbOff, Maximize2, Minimize2, Mountain, Scissors, ScanEye, Volume2, VolumeX, Watch } from 'lucide-react'
import { QUALITY_PROFILES, type QualityLevel } from '@twin/graphics-engine'
import { isMinerMode, useTwin } from '../state/store.ts'
import { BraceletPanel, CentralPanel } from './DevicePanels.tsx'

function useClock(): string {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  return new Intl.DateTimeFormat('es-BO', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'America/La_Paz' }).format(now)
}

function Button({ active, onClick, children, label, testId, disabled }: { active?: boolean; onClick: () => void; children: ReactNode; label: string; testId?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      data-testid={testId}
      disabled={disabled}
      onClick={event => { onClick(); event.currentTarget.blur() }}
      className={`flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'border-sand-300/60 bg-ink-700 text-ink-100' : 'border-ink-700 bg-ink-850/90 text-ink-300 hover:bg-ink-800 hover:text-ink-100'}`}
    >
      {children}
    </button>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-6">
      <span className="text-ink-400">{label}</span>
      <span className="font-mono text-ink-100 tabular-nums">{value}</span>
    </div>
  )
}

function Diagnostics() {
  const diagnostics = useTwin(state => state.diagnostics)
  const generation = useTwin(state => state.generation)
  const quality = useTwin(state => state.quality)
  const format = (value: number, digits = 1) => value.toLocaleString('es-BO', { maximumFractionDigits: digits, minimumFractionDigits: digits })
  return (
    <section data-testid="diagnostics" className="w-64 rounded-lg border border-ink-700 bg-ink-900/90 p-3 text-xs backdrop-blur">
      <h2 className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-wider text-ink-300 uppercase"><Gauge size={14} />Diagnóstico de render</h2>
      <div className="space-y-1">
        <Metric label="Perfil" value={QUALITY_PROFILES[quality].label} />
        <Metric label="FPS" value={diagnostics ? format(diagnostics.fps, 0) : '—'} />
        <Metric label="Fotograma (media / p99)" value={diagnostics ? `${format(diagnostics.frameMs)} / ${format(diagnostics.frameMsP99)} ms` : '—'} />
        <Metric label="GPU" value={diagnostics?.gpuMs != null ? `${format(diagnostics.gpuMs, 2)} ms` : 'no disponible'} />
        <Metric label="Draw calls" value={diagnostics ? String(diagnostics.drawCalls) : '—'} />
        <Metric label="Triángulos" value={diagnostics ? diagnostics.triangles.toLocaleString('es-BO') : '—'} />
        <Metric label="Objetos visibles" value={diagnostics ? String(diagnostics.visibleObjects) : '—'} />
        <Metric label="Geometrías / texturas" value={diagnostics ? `${diagnostics.geometries} / ${diagnostics.textures}` : '—'} />
        <Metric label="Memoria GPU (estim. parcial)" value={diagnostics ? `${format(diagnostics.estimatedGpuMemoryMb, 0)} MB` : '—'} />
      </div>
      <div className="mt-3 border-t border-ink-700 pt-2 space-y-1">
        <Metric label="Generación" value={generation.status === 'done' ? `${format((generation.milliseconds ?? 0) / 1000, 2)} s` : generation.status === 'running' ? `${generation.done}/${generation.total}` : generation.status} />
        <Metric label="Triángulos de roca" value={generation.triangles ? generation.triangles.toLocaleString('es-BO') : '—'} />
        <Metric label="Workers" value={generation.workers ? String(generation.workers) : '—'} />
      </div>
    </section>
  )
}

function requestLock() {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="twin-canvas"] canvas')
  void canvas?.requestPointerLock()?.catch?.(() => undefined)
}

export function Hud({ layoutName }: { layoutName: string }) {
  const state = useTwin()
  const clock = useClock()
  const minerMode = isMinerMode(state.cameraMode)
  const generating = state.generation.status === 'running'

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest?.('input, select, textarea')) return
      if (event.code === 'KeyH') useTwin.getState().togglePanels()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  const enterMiner = () => {
    if (!minerMode) state.setCameraMode('third-person')
    requestLock()
  }

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
      {state.panelsVisible ? (
        <header className="pointer-events-auto flex items-center justify-between gap-4 border-b border-ink-800 bg-ink-950/85 px-4 py-2 backdrop-blur">
          <div className="flex items-center gap-3">
            <Mountain size={20} className="text-sand-300" />
            <div>
              <div className="text-sm font-semibold">Mining System · Gemelo digital</div>
              <div className="text-xs text-ink-400">{layoutName} — escenario ficticio · minero y manilla simulados</div>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="rounded border border-sand-300/50 px-2 py-1 text-sand-300" title="La manilla, la central y el ambiente son simulados; no hay conexión con la central real.">Datos simulados · sin conexión a la central real</span>
            <span className="font-mono text-ink-300 tabular-nums">{clock}</span>
          </div>
        </header>
      ) : <div />}

      <div className="flex min-h-0 flex-1 items-start justify-between gap-3 p-3">
        {state.panelsVisible ? <div className="max-h-full w-[21rem] overflow-y-auto"><BraceletPanel /></div> : <div />}
        {state.panelsVisible ? (
          <div className="flex max-h-full w-[22rem] flex-col items-end gap-3 overflow-y-auto">
            {state.showDiagnostics ? <div className="pointer-events-auto"><Diagnostics /></div> : null}
            <div className="w-full"><CentralPanel /></div>
          </div>
        ) : null}
      </div>

      {state.assetError ? (
        <div role="alert" className="pointer-events-auto mx-auto mb-3 rounded-md border border-state-alarm/60 bg-ink-900/95 px-4 py-2 text-sm">{state.assetError}</div>
      ) : null}
      {generating ? (
        <div data-testid="generation-progress" className="mx-auto mb-3 w-80 rounded-md border border-ink-700 bg-ink-900/90 px-4 py-2 text-xs text-ink-300">
          Generando galería… {state.generation.done}/{state.generation.total} fragmentos
          <div className="mt-2 h-1 overflow-hidden rounded bg-ink-700"><div className="h-full bg-sand-300" style={{ width: `${(state.generation.done / Math.max(state.generation.total, 1)) * 100}%` }} /></div>
        </div>
      ) : null}

      {minerMode && state.pointerLocked ? (
        <>
          {state.cameraMode === 'first-person' ? <div className="absolute top-1/2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-100/70" /> : null}
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 rounded bg-ink-950/70 px-3 py-1 text-xs whitespace-nowrap text-ink-300">
            WASD caminar · Shift correr · Ratón mirar · Rueda distancia · V vista · Q mirar la manilla · ↑ ↓ Enter pulsadores · F linterna · Esc pausa
          </div>
        </>
      ) : null}
      {minerMode && !state.pointerLocked && !state.viewpoint && !state.autopilot.active ? (
        <button type="button" data-testid="resume-miner" onClick={requestLock} className="pointer-events-auto absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border border-ink-600 bg-ink-900/90 px-5 py-3 text-sm">
          Haz clic para controlar al minero
          <span className="mt-1 block text-[11px] text-ink-400">El teclado funciona aunque el ratón esté libre</span>
        </button>
      ) : null}

      {state.panelsVisible ? (
        <footer className="pointer-events-auto flex flex-wrap items-center justify-between gap-3 border-t border-ink-800 bg-ink-950/85 px-4 py-2 backdrop-blur">
          <div className="flex items-center gap-2">
            <Button label="Vista de supervisión (orbital)" testId="mode-orbit" active={!minerMode} onClick={() => state.setCameraMode('orbit')}><Eye size={16} />Supervisión</Button>
            <Button label="Controlar al minero (WASD)" testId="mode-miner" active={minerMode} disabled={state.generation.status !== 'done'} onClick={enterMiner}><HardHat size={16} />Minero</Button>
            {!minerMode ? (
              <Button label="Cortar la bóveda para ver el interior" active={state.roofCut} onClick={() => state.setRoofCut(!state.roofCut)}><Scissors size={16} />Corte de bóveda</Button>
            ) : (
              <>
                <Button label="Primera o tercera persona (V)" testId="toggle-view" onClick={() => state.setCameraMode(state.cameraMode === 'first-person' ? 'third-person' : 'first-person')}><ScanEye size={16} />{state.cameraMode === 'first-person' ? '1.ª persona' : '3.ª persona'}</Button>
                <Button label="Linterna del casco (F)" active={state.headlamp} onClick={state.toggleHeadlamp}>{state.headlamp ? <Lightbulb size={16} /> : <LightbulbOff size={16} />}Linterna</Button>
              </>
            )}
            <Button label="Levantar la muñeca para mirar la manilla (mantener Q)" testId="check-bracelet" active={state.checkingBracelet} onClick={() => state.setCheckingBracelet(!state.checkingBracelet)}><Watch size={16} />Manilla</Button>
            <Button label="Sonido del buzzer de la manilla" active={state.sound} onClick={state.toggleSound}>{state.sound ? <Volume2 size={16} /> : <VolumeX size={16} />}</Button>
            <label className="ml-2 flex items-center gap-2 text-xs text-ink-400">
              Velocidad
              <input type="range" min={0.6} max={4} step={0.1} value={state.walkSpeed} onChange={event => state.setWalkSpeed(Number(event.target.value))} className="w-24 accent-sand-300" />
              <span className="w-12 font-mono text-ink-300 tabular-nums">{state.walkSpeed.toFixed(1)} m/s</span>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-ink-400" />
            <div role="radiogroup" aria-label="Perfil gráfico" className="flex overflow-hidden rounded-md border border-ink-700">
              {(Object.keys(QUALITY_PROFILES) as QualityLevel[]).map(level => (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={state.quality === level}
                  data-testid={`quality-${level}`}
                  onClick={event => { state.setQuality(level); event.currentTarget.blur() }}
                  className={`h-9 px-3 text-sm ${state.quality === level ? 'bg-ink-700 text-ink-100' : 'bg-ink-850/90 text-ink-400 hover:text-ink-100'}`}
                >
                  {QUALITY_PROFILES[level].label}
                </button>
              ))}
            </div>
            <Button label="Mostrar u ocultar el diagnóstico" active={state.showDiagnostics} onClick={state.toggleDiagnostics}><Activity size={16} /></Button>
            <Button label="Ocultar paneles (H)" onClick={state.togglePanels}><Maximize2 size={16} /></Button>
          </div>
        </footer>
      ) : (
        <div className="pointer-events-auto absolute right-3 bottom-3">
          <Button label="Mostrar paneles (H)" onClick={state.togglePanels}><Minimize2 size={16} /></Button>
        </div>
      )}
      <p className="pointer-events-none absolute bottom-14 left-4 max-w-md text-[10px] leading-tight text-ink-400/80">
        Escenario ficticio. Prototipo de apoyo visual: no sustituye equipos certificados, protocolos de seguridad minera ni sistemas oficiales de emergencia.
      </p>
    </div>
  )
}
