import { cloneElement, createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, FormHTMLAttributes, InputEvent, InputHTMLAttributes, KeyboardEvent, ReactElement, SubmitEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Eye, EyeOff, Search, X } from 'lucide-react'
import '../../styles/controls.css'

const FormErrors = createContext<Record<string, string>>({})

function validationMessage(input: HTMLInputElement) {
  const value = input.dataset.inputType === 'password' ? input.value : input.value.trim()
  if (input.required && (input.type === 'checkbox' ? !input.checked : !value)) return 'Completa este campo.'
  if (!value) return ''
  if (input.type === 'email' && input.validity.typeMismatch) return 'Escribe un correo electrónico válido.'
  if (input.minLength > 0 && value.length < input.minLength) return `Usa al menos ${input.minLength} caracteres.`
  if (input.maxLength > 0 && value.length > input.maxLength) return `Usa como máximo ${input.maxLength} caracteres.`
  return ''
}

export function ApplicationForm({ onSubmit, onInput, children, ...props }: FormHTMLAttributes<HTMLFormElement>) {
  const [errors, setErrors] = useState<Record<string, string>>({})
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const inputs = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>('input:not([disabled]):not([type="hidden"])'))
    const invalid = inputs.map(input => ({ input, message: validationMessage(input) })).filter(item => item.message)
    setErrors(Object.fromEntries(invalid.map(({ input, message }) => [input.name, message])))
    if (invalid.length) {
      invalid[0].input.focus()
      return
    }
    onSubmit?.(event)
  }
  function input(event: InputEvent<HTMLFormElement>) {
    const field = event.target
    if (field instanceof HTMLInputElement && errors[field.name]) {
      setErrors(previous => ({ ...previous, [field.name]: validationMessage(field) }))
    }
    onInput?.(event)
  }
  return (
    <form {...props} noValidate autoComplete="off" onSubmit={submit} onInput={input}>
      <FormErrors.Provider value={errors}>{children}</FormErrors.Provider>
    </form>
  )
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  name: string
  hint?: string
}

// Autocomplete stays off unless the field asks for the user's own data (WCAG 1.3.5), such as the login.
export function TextField({ label, hint, name, type = 'text', id: suppliedId, autoComplete = 'off', ...props }: TextFieldProps) {
  const generatedId = useId()
  const id = suppliedId ?? generatedId
  const error = useContext(FormErrors)[name]
  const [visible, setVisible] = useState(false)
  const description = [hint && `${id}-hint`, error && `${id}-error`, props['aria-describedby']].filter(Boolean).join(' ') || undefined
  const input = (
    <input
      {...props}
      id={id}
      name={name}
      data-input-type={type}
      type={type === 'password' && visible ? 'text' : type}
      autoComplete={autoComplete}
      spellCheck={false}
      aria-invalid={error ? true : undefined}
      aria-describedby={description}
    />
  )
  return (
    <div className="app-field">
      <label htmlFor={id}>{label}</label>
      {hint && <small id={`${id}-hint`} className="field-hint">{hint}</small>}
      {type === 'password' ? (
        <div className="password-input">
          {input}
          <button
            type="button"
            className="password-toggle"
            aria-label={`${visible ? 'Ocultar' : 'Mostrar'} ${label.toLowerCase()}`}
            aria-pressed={visible}
            onClick={() => setVisible(!visible)}
          >
            {visible ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      ) : input}
      {error && <p id={`${id}-error`} className="field-error" role="alert">{error}</p>}
    </div>
  )
}

export function Checkbox({ label, name, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) {
  const id = useId()
  const error = useContext(FormErrors)[name]
  return (
    <div>
      <label className="app-checkbox">
        <span className="checkbox-control">
          <input {...props} name={name} type="checkbox" aria-invalid={error ? true : undefined} aria-describedby={error ? id : undefined} />
          <span className="checkbox-box" aria-hidden="true"><Check size={14} strokeWidth={3} /></span>
        </span>
        {label}
      </label>
      {error && <p id={id} className="field-error" role="alert">{error}</p>}
    </div>
  )
}

export function SearchField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  const input = useRef<HTMLInputElement>(null)
  function clear() {
    onChange('')
    input.current?.focus()
  }
  return (
    <label className="search-field">
      <Search size={17} aria-hidden="true" />
      <input
        ref={input}
        type="text"
        autoComplete="off"
        spellCheck={false}
        aria-label={label}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button type="button" className="search-clear" aria-label={`Limpiar búsqueda de ${label.replace(/^Buscar /, '')}`} onClick={clear}>
          <X size={15} />
        </button>
      )}
    </label>
  )
}

interface SelectOption { value: string; label: string }
interface SelectProps {
  options: readonly SelectOption[]
  label?: string
  'aria-label'?: string
  name?: string
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  disabled?: boolean
}

export function Select({ options, label, 'aria-label': ariaLabel, name, value: controlledValue, defaultValue, onChange, disabled }: SelectProps) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [storedValue, setStoredValue] = useState(defaultValue ?? options[0]?.value ?? '')
  const value = controlledValue ?? storedValue
  const selectedIndex = options.findIndex(option => option.value === value)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(Math.max(0, selectedIndex))
  const [position, setPosition] = useState<CSSProperties>({})
  const typed = useRef({ text: '', time: 0 })
  const accessibleLabel = ariaLabel ?? label ?? 'Seleccionar opción'

  function reveal(index = Math.max(0, selectedIndex)) {
    if (disabled || !options.length) return
    setActive(index)
    setOpen(true)
  }
  function choose(index: number) {
    const option = options[index]
    if (!option) return
    setStoredValue(option.value)
    onChange?.(option.value)
    setOpen(false)
    typed.current.text = ''
  }
  useLayoutEffect(() => {
    if (!open) return
    function locate() {
      if (!trigger.current) return
      const rect = trigger.current.getBoundingClientRect()
      const viewport = window.visualViewport
      const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight)
      const top = viewport?.offsetTop ?? 0
      const width = Math.min(Math.max(rect.width, 180), window.innerWidth - 24)
      const below = bottom - rect.bottom - 18
      const above = rect.top - top - 18
      const upward = below < Math.min(240, options.length * 40 + 12) && above > below
      setPosition({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), width,
        maxHeight: Math.max(40, Math.min(280, upward ? above : below)),
        ...(upward ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
      })
    }
    function outside(event: PointerEvent) {
      if (!trigger.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node)) setOpen(false)
    }
    locate()
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', locate)
    window.addEventListener('scroll', locate, true)
    window.visualViewport?.addEventListener('resize', locate)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', locate)
      window.removeEventListener('scroll', locate, true)
      window.visualViewport?.removeEventListener('resize', locate)
    }
  }, [open, options.length])
  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open, id])

  function keyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      typed.current.text = ''
      return
    }
    if (event.key === 'Tab') {
      if (open) choose(active)
      return
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key)) {
      event.preventDefault()
      let index = open ? active : Math.max(0, selectedIndex)
      if (event.key === 'Home') index = 0
      else if (event.key === 'End') index = options.length - 1
      else if (open) index += event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : event.key === 'PageDown' ? 10 : -10
      reveal(Math.max(0, Math.min(options.length - 1, index)))
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) choose(active)
      else reveal()
      return
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      const now = event.timeStamp
      const character = event.key.toLocaleLowerCase('es')
      const previous = now - typed.current.time < 700 ? typed.current.text : ''
      const text = previous && [...previous].every(letter => letter === character) ? character : previous + character
      typed.current = { text, time: now }
      const normalize = (word: string) => word.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es')
      const start = text.length === 1 ? (open ? active : selectedIndex) + 1 : 0
      for (let offset = 0; offset < options.length; offset++) {
        const index = (start + offset + options.length) % options.length
        if (normalize(options[index].label).startsWith(normalize(text))) {
          reveal(index)
          break
        }
      }
    }
  }

  const listbox = (
    <div ref={list} id={`${id}-list`} role="listbox" aria-label={accessibleLabel} className="select-list" style={position}>
      {options.map((option, index) => (
        <div
          id={`${id}-option-${index}`}
          key={option.value}
          role="option"
          aria-selected={option.value === value}
          className={`select-option ${active === index ? 'highlighted' : ''}`}
          onPointerDown={event => event.preventDefault()}
          onPointerMove={event => { if (event.pointerType !== 'touch') setActive(index) }}
          onClick={() => choose(index)}
        >
          <span>{option.label}</span>
          {option.value === value && <Check size={16} aria-hidden="true" />}
        </div>
      ))}
    </div>
  )
  const control = (
    <div className="app-select">
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        className="select-trigger"
        aria-label={accessibleLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open && options[active] ? `${id}-option-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : reveal())}
        onBlur={() => setOpen(false)}
        onKeyDown={keyboard}
      >
        <span>{options[selectedIndex]?.label ?? 'Seleccionar…'}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
      {open && createPortal(listbox, document.body)}
    </div>
  )
  return label ? <div className="app-field"><label htmlFor={id}>{label}</label>{control}</div> : control
}

export function Tooltip({ text, children }: { text: string; children: ReactElement<{ 'aria-describedby'?: string }> }) {
  const id = useId()
  const anchor = useRef<HTMLSpanElement>(null)
  const bubble = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<CSSProperties>({})
  useLayoutEffect(() => {
    if (!open || !anchor.current || !bubble.current) return
    const rect = anchor.current.getBoundingClientRect()
    const bounds = bubble.current.getBoundingClientRect()
    setPosition({
      left: Math.max(12, Math.min(rect.left + (rect.width - bounds.width) / 2, window.innerWidth - bounds.width - 12)),
      ...(rect.top > bounds.height + 16 ? { bottom: window.innerHeight - rect.top + 7 } : { top: rect.bottom + 7 }),
    })
    const hide = () => setOpen(false)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [open, text])
  const describedBy = [children.props['aria-describedby'], open && id].filter(Boolean).join(' ') || undefined
  return (
    <span
      ref={anchor}
      className="tooltip-anchor"
      onPointerEnter={event => { if (event.pointerType !== 'touch') setOpen(true) }}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={() => setOpen(false)}
      onKeyDown={event => {
        if (event.key !== 'Escape' || !open) return
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
      }}
    >
      {cloneElement(children, { 'aria-describedby': describedBy })}
      {open && createPortal(<span ref={bubble} role="tooltip" id={id} className="app-tooltip" style={position}>{text}</span>, document.body)}
    </span>
  )
}
