import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Mountain, X, Inbox, AlertTriangle, CheckCheck, MessageSquare, ArrowUpRight } from 'lucide-react'
import { date, initials } from './api'
import type { Message, Severity } from './types'
import { Tooltip } from './controls'

export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? 'compact' : ''}`}><span className="brand-mark"><Mountain size={25} strokeWidth={1.7} /></span><div><strong>MINING<span>SYSTEM</span></strong><small>SEGURIDAD CONECTADA</small></div></div>
}

export function Badge({ severity }: { severity: Severity }) {
  return <span className={`badge ${severity}`}>{severity === 'critical' ? 'Crítica' : severity === 'warning' ? 'Atención' : 'Informativa'}</span>
}

export function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="empty"><span className="empty-icon"><Inbox size={27} strokeWidth={1.4} /></span><h3>{title}</h3><p>{text}</p>{action}</div>
}

export function Modal({ title, subtitle, children, close }: { title: string; subtitle?: string; children: ReactNode; close: () => void }) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(close)
  useEffect(() => { closeRef.current = close }, [close])
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const first = ref.current?.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), [role="combobox"]')
      ?? ref.current?.querySelector<HTMLElement>('button:not([disabled]), [tabindex="0"]')
    first?.focus()
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') closeRef.current()
      if (event.key !== 'Tab') return
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), [tabindex="0"]') ?? [])
      if (!items.length) return
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus() }
    }
    document.addEventListener('keydown', keyboard)
    return () => { document.removeEventListener('keydown', keyboard); document.body.style.overflow = oldOverflow; previous?.focus() }
  }, [])
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close() }}><div ref={ref} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}><div className="modal-heading"><div><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="Cerrar diálogo" onClick={close}><X size={20} /></button></div>{children}</div></div>
}

export function MessageRows({ messages, review, compact = false, reviewing }: { messages: Message[]; review?: (message: Message) => void; compact?: boolean; reviewing?: number | null }) {
  return <div className={`message-list ${compact ? 'message-list-compact' : ''}`}>{messages.map(message => <article className={`message-row ${message.severity}`} key={message.id}>
    <div className={`message-symbol ${message.severity}`}>{message.severity === 'critical' ? <AlertTriangle size={19} /> : message.code === 'OK' ? <CheckCheck size={19} /> : <MessageSquare size={19} />}</div>
    <div className="message-body"><div className="message-title"><strong>{message.text}</strong><Badge severity={message.severity} /></div><div className="message-source"><span className="mini-avatar">{initials(message.minerName)}</span><span>{message.minerName}</span><span className="dot-separator">·</span><span>{message.zone}</span>{!compact && <><span className="dot-separator">·</span><span>{message.deviceName}</span></>}</div>{!compact && <div className="message-metadata">Enviado: {date(message.sentAt, true)}<span>Recibido: {date(message.receivedAt, true)}</span>{message.reviewedAt && <span>Revisada por {message.reviewedBy} · {date(message.reviewedAt, true)}</span>}</div>}</div>
    <div className="message-end"><Tooltip text={date(message.receivedAt, true)}><time tabIndex={0} dateTime={message.receivedAt}>{date(message.receivedAt)}</time></Tooltip>{message.severity === 'critical' && (message.reviewedAt ? <span className="reviewed"><CheckCheck size={14} /> Revisada</span> : review && <button className="text-button" disabled={reviewing === message.id} onClick={() => review(message)}>{reviewing === message.id ? 'Guardando…' : 'Revisar'}<ArrowUpRight size={14} /></button>)}</div>
  </article>)}</div>
}
