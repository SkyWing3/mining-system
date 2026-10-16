import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { Pause, Play } from 'lucide-react'
import { duration } from '../../utils/format'

// Custom player: the audio element never enters the DOM, so no native controls are shown.
export function VoicePlayer({ src, durationMs, label, onEnded }: { src: string; durationMs: number; label: string; onEnded?: () => void }) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const ended = useRef(onEnded)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [error, setError] = useState('')
  const total = durationMs / 1000

  useEffect(() => {
    ended.current = onEnded
  }, [onEnded])

  useEffect(() => {
    const element = new Audio()
    element.preload = 'none'
    element.src = src
    const update = () => setPosition(element.currentTime)
    const finish = () => {
      setPlaying(false)
      setPosition(0)
      ended.current?.()
    }
    const failed = () => {
      setPlaying(false)
      setError('No se pudo reproducir el audio.')
    }
    element.addEventListener('timeupdate', update)
    element.addEventListener('ended', finish)
    element.addEventListener('error', failed)
    audio.current = element
    return () => {
      element.pause()
      element.removeEventListener('timeupdate', update)
      element.removeEventListener('ended', finish)
      element.removeEventListener('error', failed)
      element.removeAttribute('src')
      audio.current = null
    }
  }, [src])

  async function toggle() {
    const element = audio.current
    if (!element) return
    if (playing) {
      element.pause()
      setPlaying(false)
      return
    }
    setError('')
    try {
      await element.play()
      setPlaying(true)
    } catch {
      setError('No se pudo reproducir el audio.')
    }
  }

  function seek(seconds: number) {
    const element = audio.current
    if (!element) return
    const target = Math.max(0, Math.min(total, seconds))
    element.currentTime = target
    setPosition(target)
  }

  function pointer(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    seek(((event.clientX - bounds.left) / bounds.width) * total)
  }

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    const steps: Record<string, number> = { ArrowLeft: -2, ArrowRight: 2, Home: -total, End: total }
    if (!(event.key in steps)) return
    event.preventDefault()
    seek(event.key === 'Home' ? 0 : event.key === 'End' ? total : position + steps[event.key])
  }

  const progress = total ? Math.min(100, (position / total) * 100) : 0
  return (
    <div className="voice-player">
      <button className="voice-play" aria-label={`${playing ? 'Pausar' : 'Reproducir'} ${label}`} onClick={() => void toggle()}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <div
        className="voice-track"
        role="slider"
        tabIndex={0}
        aria-label={`Posición de ${label}`}
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(position)}
        aria-valuetext={`${duration(position * 1000)} de ${duration(durationMs)}`}
        onPointerDown={pointer}
        onKeyDown={keyboard}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
      <span className="voice-time">{duration(position * 1000)} / {duration(durationMs)}</span>
      {error && <span className="voice-error" role="alert">{error}</span>}
    </div>
  )
}
