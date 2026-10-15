import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), [tabindex="0"]'

export function Modal({ title, subtitle, children, close, wide = false }: {
  title: string
  subtitle?: string
  children: ReactNode
  close: () => void
  wide?: boolean
}) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(close)
  useEffect(() => {
    closeRef.current = close
  }, [close])

  // Focus trap, Escape to close, body scroll lock and focus restoration.
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
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      if (!items.length) return
      if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault()
        items.at(-1)?.focus()
      } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
        event.preventDefault()
        items[0].focus()
      }
    }
    document.addEventListener('keydown', keyboard)
    return () => {
      document.removeEventListener('keydown', keyboard)
      document.body.style.overflow = oldOverflow
      previous?.focus()
    }
  }, [])

  return (
    <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
      <div ref={ref} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-heading">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" aria-label="Cerrar diálogo" onClick={close}><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function ConfirmModal({ title, subtitle, children, error, busy, confirmLabel, busyLabel, icon, onConfirm, close }: {
  title: string
  subtitle: string
  children: ReactNode
  error: string
  busy: boolean
  confirmLabel: string
  busyLabel: string
  icon: ReactNode
  onConfirm: () => void
  close: () => void
}) {
  return (
    <Modal title={title} subtitle={subtitle} close={close}>
      <div className="confirm-content">
        {children}
        {error && <div className="form-error" role="alert">{error}</div>}
      </div>
      <div className="modal-actions">
        <button className="button secondary" onClick={close}>Cancelar</button>
        <button className="button primary" disabled={busy} onClick={onConfirm}>{icon}{busy ? busyLabel : confirmLabel}</button>
      </div>
    </Modal>
  )
}
