export function money(value, currency = 'USD') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
}

export function compactMoney(value, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: value >= 10_000 ? 1 : 0 }).format(value || 0)
}

export function dateTime(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function date(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function timeAgo(iso, now = Date.now()) {
  if (!iso) return ''
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000)
  if (seconds < 45) return 'just now'
  const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]]
  for (const [unit, size] of units) {
    const value = Math.floor(Math.abs(seconds) / size)
    if (value >= 1) return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(seconds > 0 ? -value : value, unit)
  }
  return 'just now'
}

export function duration(ms) {
  if (ms === null || ms === undefined) return '-'
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`
}

export function remaining(iso, now = Date.now()) {
  if (!iso) return { label: 'No deadline', urgent: false, overdue: false }
  const ms = new Date(iso).getTime() - now
  if (ms <= 0) return { label: 'Deadline passed', urgent: true, overdue: true }
  const days = Math.floor(ms / 86400_000)
  const hours = Math.floor((ms % 86400_000) / 3600_000)
  const minutes = Math.floor((ms % 3600_000) / 60_000)
  const label = days > 0 ? `${days}d ${hours}h left` : `${hours}h ${minutes}m left`
  return { label, urgent: ms < 3 * 86400_000, overdue: false }
}

export const address = (a = {}) =>
  [a.line1, a.line2, [a.city, a.state, a.postalCode].filter(Boolean).join(' '), a.country].filter(Boolean).join(', ')

export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || '?'

export const titleCase = (value = '') => value.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export const EVIDENCE_LABELS = {
  order_receipt: 'PayPal payment receipt',
  tracking: 'Shipment tracking',
  delivery_confirmation: 'Proof of delivery',
  product_description: 'Product listing',
  refund_policy: 'Return policy',
  ip_device_match: 'Checkout device & IP',
  buyer_history: 'Buyer history',
  buyer_communication: 'Buyer communication'
}

export const SOURCE_LABELS = {
  paypal: { label: 'PayPal sandbox', tone: 'info' },
  demo: { label: 'Demo', tone: 'outline' },
  simulated: { label: 'Simulated', tone: 'warning' }
}

export const FULFILLMENT_LABELS = {
  unfulfilled: { label: 'Not shipped', tone: 'warning' },
  shipped: { label: 'Shipped', tone: 'info' },
  delivered: { label: 'Delivered', tone: 'success' }
}

export const WORKFLOW_LABELS = {
  new: { label: 'New', tone: 'warning' },
  analyzing: { label: 'Agent drafting', tone: 'ai' },
  draft_ready: { label: 'Draft ready', tone: 'info' },
  submitted: { label: 'Response submitted', tone: 'success' },
  resolved: { label: 'Resolved', tone: 'outline' }
}
