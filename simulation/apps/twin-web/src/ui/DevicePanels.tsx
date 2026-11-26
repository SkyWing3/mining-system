// Paneles de la manilla simulada: la pantalla OLED con sus pulsadores y salidas, las
// lecturas frente al modelo ambiental, la central simulada y el registro de tramas.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Bell, CornerDownLeft, Flame, Radio, RadioTower, Smartphone, Vibrate, Wind, Zap } from 'lucide-react'
import { parseIso, type WifiStatus } from '@twin/device-sim'
import { BLAST_SOURCES, deviceFrames, NOTICE_OPTIONS, oledCanvas, radio, useDevice, type NoticeCode } from '../device/runtime.ts'
import { BAND_LABEL, signalBand } from './signal.ts'

const LEVEL_TEXT = { normal: 'Normal', caution: 'Precaución', danger: 'Peligro' } as const
const LEVEL_CLASS = { normal: 'text-state-ok', caution: 'text-state-warn', danger: 'text-state-alarm' } as const
const LED_CLASS: Record<string, string> = {
  green: 'bg-[#3ddc6f] shadow-[0_0_10px_#3ddc6f]',
  yellow: 'bg-[#f2c53d] shadow-[0_0_10px_#f2c53d]',
  red: 'bg-[#ff3b30] shadow-[0_0_12px_#ff3b30]',
  blue: 'bg-[#3b82ff] shadow-[0_0_10px_#3b82ff]',
  off: 'bg-ink-700',
}

/** Barras de señal como las de un teléfono: 4 con buena señal, ninguna sin señal. */
export function SignalBars({ rssi }: { rssi: number | null }) {
  const bars = rssi === null ? 0 : rssi >= -67 ? 4 : rssi >= -75 ? 3 : rssi >= -82 ? 2 : rssi >= -88 ? 1 : 0
  const band = signalBand(rssi)
  const color = band === 'good' ? 'bg-state-ok' : band === 'fair' ? 'bg-state-warn' : 'bg-state-alarm'
  return (
    <span className="inline-flex items-end gap-px" aria-label={`${bars} de 4 barras`}>
      {[0, 1, 2, 3].map(index => <span key={index} className={`w-[3px] rounded-[1px] ${index < bars ? color : 'bg-ink-700'}`} style={{ height: 4 + index * 3 }} />)}
    </span>
  )
}

/** Estado de la radio Wi-Fi en palabras. */
function wifiText(wifi: WifiStatus | null): string {
  if (!wifi) return 'Cobertura total'
  // Asociada pero sin balizas: la estación todavía no se dio por desconectada.
  if (wifi.state === 'connected') return wifi.rssi === null ? `${wifi.accessPoint} · sin balizas` : `${wifi.accessPoint} · ${Math.round(wifi.rssi)} dBm`
  if (wifi.state === 'connecting') return `Asociándose a ${wifi.accessPoint}`
  return wifi.best ? `Buscando red · ${wifi.best.id} ${Math.round(wifi.best.rssi)} dBm` : 'Sin señal'
}

/** «hace 5 s», «hace 1 min 20 s». */
function ago(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `hace ${seconds} s`
  return `hace ${Math.floor(seconds / 60)} min ${seconds % 60} s`
}

function format(value: number | null | undefined, digits: number, unit: string): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value.toLocaleString('es-BO', { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${unit}`
}

function Panel({ title, icon, children, testId, badge }: { title: string; icon: ReactNode; children: ReactNode; testId?: string; badge?: ReactNode }) {
  return (
    <section data-testid={testId} className="pointer-events-auto rounded-lg border border-ink-700 bg-ink-900/90 p-3 text-xs backdrop-blur">
      <h2 className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-wider text-ink-300 uppercase">
        {icon}
        <span className="flex-1">{title}</span>
        {badge}
      </h2>
      {children}
    </section>
  )
}

function SimBadge() {
  return <span title="Datos generados por el gemelo; no provienen de una manilla real." className="rounded border border-sand-300/50 px-1.5 py-px text-[10px] text-sand-300">SIMULADO</span>
}

function SmallButton({ onClick, children, label, active, testId }: { onClick: () => void; children: ReactNode; label: string; active?: boolean; testId?: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      data-testid={testId}
      onClick={event => { onClick(); event.currentTarget.blur() }}
      className={`flex h-7 items-center justify-center gap-1.5 rounded border px-2 text-[11px] transition-colors ${active ? 'border-sand-300/60 bg-ink-700 text-ink-100' : 'border-ink-700 bg-ink-850 text-ink-300 hover:bg-ink-800 hover:text-ink-100'}`}
    >
      {children}
    </button>
  )
}

/** Copia de la OLED 128×64 ampliada sin suavizado. */
function OledView() {
  const version = useDevice(state => state.oledVersion)
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(oledCanvas, 0, 0)
  }, [version])
  return <canvas ref={canvas} width={128} height={64} data-testid="bracelet-oled" className="block h-[144px] w-[288px] rounded-sm [image-rendering:pixelated]" />
}

export function BraceletPanel() {
  const device = useDevice()
  const snapshot = device.snapshot
  const reading = device.reading
  const co = snapshot?.coPpm != null ? format(snapshot.coPpm, 0, 'ppm') : snapshot?.coVolts != null ? format(snapshot.coVolts, 3, 'V') : '—'
  return (
    <Panel title="Manilla ESP32-S3" icon={<Smartphone size={14} />} testId="bracelet-panel" badge={<SimBadge />}>
      <div className="rounded-xl border border-ink-600 bg-[#101113] p-3 shadow-inner">
        <div className="flex items-center justify-between pb-2 text-[10px] text-ink-400">
          <span className="flex items-center gap-1.5">
            <span data-testid="bracelet-led" data-color={device.led} className={`inline-block h-2.5 w-2.5 rounded-full ${LED_CLASS[(device.outputs.red || device.outputs.green || device.outputs.blue) ? device.led : 'off']}`} />
            LED
          </span>
          <span className={`flex items-center gap-1 ${device.outputs.buzzer ? 'text-state-alarm' : ''}`} title="Buzzer"><Bell size={12} />Buzzer</span>
          <span className={`flex items-center gap-1 ${device.outputs.motor ? 'text-state-warn' : ''}`} title="Motor vibrador"><Vibrate size={12} />Motor</span>
        </div>
        <div className="flex justify-center rounded-md bg-black p-1.5"><OledView /></div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <SmallButton label="Pulsador subir (↑)" testId="bracelet-up" onClick={() => device.press('up')}><ArrowUp size={13} />Subir</SmallButton>
          <SmallButton label="Pulsador bajar (↓)" testId="bracelet-down" onClick={() => device.press('down')}><ArrowDown size={13} />Bajar</SmallButton>
          <SmallButton label="Pulsador enter (Enter)" testId="bracelet-enter" onClick={() => device.press('enter')}><CornerDownLeft size={13} />Enter</SmallButton>
        </div>
      </div>

      <table className="mt-3 w-full border-collapse text-[11px]">
        <thead>
          <tr className="text-ink-400">
            <th className="py-0.5 text-left font-normal">Variable</th>
            <th className="py-0.5 text-right font-normal" title="Lo que mide la manilla (con la dinámica y el ruido de los sensores)">Manilla</th>
            <th className="py-0.5 text-right font-normal" title="Valor del modelo ambiental en la posición del minero">Modelo</th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          <tr><td className="py-0.5 font-sans text-ink-300">CO (SEN0564)</td><td className="text-right text-ink-100" data-testid="reading-co">{co}</td><td className="text-right text-ink-400">{format(reading?.coPpm, 0, 'ppm')}</td></tr>
          <tr><td className="py-0.5 font-sans text-ink-300">Aire (MLX90614)</td><td className="text-right text-ink-100">{format(snapshot?.ambientC, 1, '°C')}</td><td className="text-right text-ink-400">{format(reading?.ambientC, 1, '°C')}</td></tr>
          <tr><td className="py-0.5 font-sans text-ink-300">Superficie (IR)</td><td className="text-right text-ink-100">{format(snapshot?.objectC, 1, '°C')}</td><td className="text-right text-ink-400">{format(reading?.objectC, 1, '°C')}</td></tr>
        </tbody>
      </table>
      <div className="mt-2 flex items-center justify-between border-t border-ink-700 pt-2">
        <span className="text-ink-400">Nivel de la manilla</span>
        <span data-testid="bracelet-level" data-level={device.level} className={`font-semibold ${LEVEL_CLASS[device.level]}`}>{LEVEL_TEXT[device.level]}</span>
      </div>
      {device.conditions.length > 0 ? <div className="mt-1 text-right text-[11px] text-ink-300">{device.conditions.join(' · ')}</div> : null}
      <div className="mt-1 flex items-center justify-between">
        <span className="text-ink-400" title="Ubicación del minero en el gemelo. La manilla real no conoce su posición: la central le asigna una zona.">Ubicación (gemelo)</span>
        <span data-testid="miner-zone" className="text-ink-100">{reading?.location.zone ?? '—'}</span>
      </div>
      {radio ? (
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="whitespace-nowrap text-ink-400" title="Intensidad Wi-Fi que recibe la manilla según el modelo de cobertura del gemelo. El firmware no la muestra en la OLED.">Wi-Fi (gemelo)</span>
          <span data-testid="wifi-status" data-state={device.wifi?.state ?? 'none'} className="flex items-center gap-1.5 text-ink-100">
            <SignalBars rssi={device.wifi?.state === 'connected' ? device.wifi.rssi : null} />
            {wifiText(device.wifi)}
          </span>
        </div>
      ) : null}
      <p className="mt-2 text-[10px] leading-snug text-ink-400">
        Umbrales del firmware: CO 35/200 ppm, aire 32/38 °C, superficie 60/90 °C, con 3 muestras de confirmación e histéresis. Escenario didáctico, no apto para decisiones de seguridad.
      </p>
    </Panel>
  )
}

function elapsed(ms: number): string {
  const seconds = ms / 1000
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${(seconds % 60).toFixed(1).padStart(4, '0')}`
}

function FrameLog() {
  const version = useDevice(state => state.framesVersion)
  const frames = useMemo(() => {
    void version
    return deviceFrames().slice(-9).reverse()
  }, [version])
  return (
    <ol data-testid="frame-log" className="max-h-44 space-y-0.5 overflow-hidden font-mono text-[10px] leading-snug">
      {frames.map(frame => (
        <li key={frame.seq} title={frame.text} className="truncate">
          <span className="text-ink-400">{elapsed(frame.atMs)}</span>{' '}
          <span className={frame.direction === 'tx' ? 'text-sand-300' : frame.direction === 'rx' ? 'text-state-ok' : 'text-ink-400'}>{frame.direction === 'tx' ? '↑' : frame.direction === 'rx' ? '↓' : '•'}</span>{' '}
          <span className={frame.direction === 'event' ? 'text-ink-100' : 'text-ink-300'}>{frame.text}</span>
        </li>
      ))}
    </ol>
  )
}

/** Mensajes que registró la central: cuánto esperaron en la cola de la manilla. */
function RecentMessages() {
  const messages = useDevice(state => state.recentMessages)
  if (messages.length === 0) return null
  return (
    <>
      <h3 className="mt-3 mb-1 text-[10px] tracking-wider text-ink-400 uppercase">Mensajes recibidos por la central</h3>
      <ol data-testid="central-messages" className="space-y-0.5 font-mono text-[10px]">
        {messages.slice().reverse().map(message => {
          const sentAt = parseIso(message.sentAt)
          const waited = sentAt === null ? 0 : message.receivedAt - sentAt
          return (
            <li key={message.messageId} className="flex justify-between gap-2" title={`Enviado ${message.sentAt}`}>
              <span className="text-ink-100">{message.code}</span>
              <span className={waited > 5000 ? 'text-state-warn' : 'text-ink-400'}>{waited > 5000 ? `${Math.round(waited / 1000)} s en cola` : 'en vivo'}</span>
            </li>
          )
        })}
      </ol>
    </>
  )
}

export function CentralPanel() {
  const device = useDevice()
  const [notice, setNotice] = useState<NoticeCode>('EVACUATE')
  const wifiBand = device.wifi ? signalBand(device.wifi.state === 'connected' ? device.wifi.rssi : null) : 'good'
  const sinceLast = device.central.lastSeenAt === null ? null : device.central.serverTime - device.central.lastSeenAt
  return (
    <Panel title="Central simulada" icon={<RadioTower size={14} />} testId="central-panel" badge={<SimBadge />}>
      {radio ? (
        <div className="flex items-center justify-between">
          <span className="text-ink-400" title="Red Wi-Fi subterránea: la señal recorre las galerías y no atraviesa la roca">Wi-Fi ({radio.network.ssid})</span>
          <span data-testid="wifi-band" data-band={wifiBand} className={`flex items-center gap-1.5 ${wifiBand === 'good' ? 'text-state-ok' : wifiBand === 'fair' || device.wifi?.state === 'connecting' ? 'text-state-warn' : 'text-state-alarm'}`}>
            <SignalBars rssi={device.wifi?.state === 'connected' ? device.wifi.rssi : null} />
            {device.wifi?.state === 'connecting' ? 'Asociando' : BAND_LABEL[wifiBand]}
            {device.wifi?.state === 'connected' && device.wifi.segmentLoss > 0.01 ? <span className="text-ink-400">({Math.round(device.wifi.segmentLoss * 100)} % pérdida)</span> : null}
          </span>
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <span className="text-ink-400">Enlace WebSocket</span>
        <span data-testid="link-status" className={device.link.connected ? 'text-state-ok' : 'text-state-warn'}>{device.link.connected ? 'Conectada' : 'Sin enlace'}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-ink-400" title="Como la central real: la manilla figura en línea si envió algo en los últimos 90 s (PresenceWindowSeconds)">La central ve la manilla</span>
        <span data-testid="central-presence" data-online={device.central.deviceOnline} className={device.central.deviceOnline ? 'text-state-ok' : 'text-state-alarm'}>
          {device.central.deviceOnline ? 'En línea' : 'Fuera de línea'}
          {sinceLast !== null ? <span className="text-ink-400"> · última trama {ago(sinceLast)}</span> : null}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-ink-400">Cola en la manilla</span>
        <span data-testid="bracelet-queue" className={`font-mono tabular-nums ${device.pending.messages > 0 ? 'text-state-warn' : 'text-ink-100'}`}>{device.pending.messages} msg · {device.pending.voices} voz</span>
      </div>
      <RecentMessages />
      <div className="mt-2 flex flex-wrap gap-1.5">
        <SmallButton label="Cortar o restablecer el enlace con la central simulada" active={!device.centralOnline} testId="toggle-central" onClick={() => device.setCentralOnline(!device.centralOnline)}><Radio size={12} />{device.centralOnline ? 'Cortar enlace' : 'Restablecer'}</SmallButton>
        <select aria-label="Aviso de la central" value={notice} onChange={event => setNotice(event.target.value as NoticeCode)} className="h-7 rounded border border-ink-700 bg-ink-850 px-1 text-[11px] text-ink-100">
          {NOTICE_OPTIONS.map(option => <option key={option.code} value={option.code}>{option.label}</option>)}
        </select>
        <SmallButton label="Enviar el aviso a la manilla" testId="send-notice" onClick={() => device.sendNotice(notice)}>Enviar aviso</SmallButton>
      </div>
      <h3 className="mt-3 mb-1 text-[10px] tracking-wider text-ink-400 uppercase">Tramas (↑ manilla → central · ↓ central → manilla)</h3>
      <FrameLog />
      <h3 className="mt-3 mb-1 text-[10px] tracking-wider text-ink-400 uppercase">Escenario</h3>
      <div className="flex flex-wrap gap-1.5">
        {BLAST_SOURCES.map(source => (
          <SmallButton key={source.id} label={`Nueva voladura: ${source.label.toLowerCase()} (CO que se disipa con la ventilación)`} testId={`scenario-blast-${source.node}`} onClick={() => device.blast(source.id)}><Zap size={12} />Voladura en {source.node}</SmallButton>
        ))}
        <SmallButton label="Como «simulate gas» de la consola: CO de 260 ppm durante 25 s" onClick={device.spikeGas}><Wind size={12} />Pico de gas</SmallButton>
        <SmallButton label="Como «simulate heat» de la consola: 41 °C durante 25 s" onClick={device.spikeHeat}><Flame size={12} />Pico de calor</SmallButton>
        <SmallButton label="Con el SEN0564 sin calibrar la manilla solo informa voltios y no evalúa el CO" active={!device.calibrated} onClick={() => device.setCalibrated(!device.calibrated)}>{device.calibrated ? 'CO calibrado' : 'CO sin calibrar'}</SmallButton>
      </div>
    </Panel>
  )
}
