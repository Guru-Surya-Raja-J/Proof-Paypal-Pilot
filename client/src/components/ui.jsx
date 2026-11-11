import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon.jsx'
import { SOURCE_LABELS } from '../lib/format.js'

export function Button({ variant = 'primary', size, block, loading, icon, children, className = '', ...props }) {
  const classes = ['btn', `btn-${variant}`, size && `btn-${size}`, block && 'btn-block', className].filter(Boolean).join(' ')
  return (
    <button type="button" className={classes} disabled={loading || props.disabled} aria-busy={loading || undefined} {...props}>
      {loading ? <span className="spinner" /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} /> : null}
      {children}
    </button>
  )
}

export function Badge({ tone, dot, icon, children, title }) {
  return (
    <span className={`badge ${tone || ''}`} title={title}>
      {dot && <span className="dot" />}
      {icon && <Icon name={icon} size={13} strokeWidth={2.2} />}
      {children}
    </span>
  )
}

export function SourceBadge({ source }) {
  const info = SOURCE_LABELS[source] || { label: source, tone: 'outline' }
  return <Badge tone={info.tone} title={source === 'paypal' ? 'Paid through PayPal sandbox checkout' : 'Not a real PayPal transaction'}>{info.label}</Badge>
}

export function AiBadge({ by, model }) {
  if (by === 'gemini') return <Badge tone="ai" icon="sparkles" title={model || 'Gemini'}>Gemini</Badge>
  if (by === 'claude') return <Badge tone="ai" icon="sparkles" title={model || 'Claude'}>Claude</Badge>
  return <Badge tone="outline" icon="zap" title="Deterministic rules engine (no AI key configured or AI unavailable)">Rules engine</Badge>
}

export function RiskBadge({ level, score, showLabel = true }) {
  return (
    <span className={`risk-chip ${level}`} title={`Risk score ${score} of 100`}>
      <span className="risk-chip-dot" />
      {showLabel && <span className="risk-chip-label">{level}</span>}
      <span className="risk-chip-score">{score}</span>
    </span>
  )
}

export function Meter({ value, size, showLabel = true }) {
  const tone = value >= 85 ? 'ok' : value >= 60 ? 'mid' : 'low'
  return (
    <div className={`meter ${tone} ${size || ''}`} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label="Evidence completeness">
      <div className="meter-track"><div className="meter-fill" style={{ width: `${value}%` }} /></div>
      {showLabel && <span className="meter-label">{value}%</span>}
    </div>
  )
}

export function Gauge({ score, level }) {
  const radius = 44
  const circumference = 2 * Math.PI * radius
  const color = level === 'high' ? 'var(--danger-600)' : level === 'medium' ? 'var(--warning-600)' : 'var(--success-600)'
  return (
    <div className="gauge" role="img" aria-label={`Risk score ${score} of 100`}>
      <svg width="104" height="104" viewBox="0 0 104 104">
        <circle cx="52" cy="52" r={radius} fill="none" stroke="var(--line-soft)" strokeWidth="10" />
        <circle cx="52" cy="52" r={radius} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - score / 100)} style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
      </svg>
      <div className="gauge-value"><div><strong>{score}</strong><span>/ 100</span></div></div>
    </div>
  )
}

export function Card({ title, subtitle, action, children, className = '', bodyClass = '', footer, id }) {
  return (
    <section className={`card ${className}`} id={id}>
      {(title || action) && (
        <div className="card-head">
          <div className="grow">
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={`card-body ${bodyClass}`}>{children}</div>
      {footer && <div className="card-foot">{footer}</div>}
    </section>
  )
}

export function Kpi({ label, value, detail, tone = '' }) {
  return (
    <div className={`card kpi ${tone}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {detail && <div className="kpi-detail">{detail}</div>}
    </div>
  )
}

export function Alert({ tone = 'info', icon, title, children, action }) {
  return (
    <div className={`alert ${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <span className="alert-icon"><Icon name={icon || (tone === 'success' ? 'check-circle' : tone === 'info' ? 'info' : tone === 'ai' ? 'sparkles' : 'alert')} size={18} /></span>
      <div className="grow">
        {title && <strong style={{ display: 'block', marginBottom: children ? 2 : 0 }}>{title}</strong>}
        {children}
      </div>
      {action}
    </div>
  )
}

export function Empty({ icon = 'box', title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={26} /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

export function Loading({ label = 'Loading' }) {
  return (
    <div className="center-page" aria-live="polite">
      <div className="stack-sm" style={{ alignItems: 'center' }}>
        <span className="spinner lg" />
        <span className="muted small">{label}…</span>
      </div>
    </div>
  )
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="center-page">
      <Empty icon="alert" title="Something went wrong" action={onRetry && <Button variant="secondary" icon="refresh" onClick={onRetry}>Try again</Button>}>
        {error?.message || 'The request failed.'}
      </Empty>
    </div>
  )
}

export function Modal({ open, onClose, title, subtitle, children, footer, wide, className = '' }) {
  const titleId = useId()
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => event.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', onKey)
    const previous = document.activeElement
    ref.current?.querySelector('input, select, textarea, button:not([data-close])')?.focus()
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      previous?.focus?.()
    }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" data-close onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

export function Field({ label, hint, error, children, className = '' }) {
  const id = useId()
  const child = typeof children === 'function' ? children(id) : children
  return (
    <div className={`field ${className}`}>
      {label && <label htmlFor={id}>{label}</label>}
      {child}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="form-error"><Icon name="alert" size={14} />{error}</span>}
    </div>
  )
}

export function KeyValues({ data }) {
  const entries = Object.entries(data || {}).filter(([, value]) => value !== null && value !== undefined && value !== '')
  if (!entries.length) return null
  const render = (value) => {
    if (Array.isArray(value)) return value.length ? value.map((v) => (typeof v === 'object' ? Object.values(v).filter(Boolean).join(' · ') : String(v))).join('\n') : '-'
    if (typeof value === 'object') return Object.entries(value).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n')
    if (typeof value === 'boolean') return value ? 'Yes' : 'No'
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toLocaleString()
    return String(value)
  }
  const label = (key) => key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
  return (
    <dl className="kv">
      {entries.map(([key, value]) => (
        <div key={key} style={{ display: 'contents' }}>
          <dt>{label(key)}</dt>
          <dd style={{ whiteSpace: 'pre-line' }}>{render(value)}</dd>
        </div>
      ))}
    </dl>
  )
}
