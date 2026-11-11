/**
 * PayPal REST client (sandbox by default).
 *
 * Every function here makes a real HTTP call to PayPal. There is no silent mock:
 * callers check `paypalEnabled()` first, and when PayPal is not configured the
 * rest of the app labels the affected data as simulated.
 */
import crypto from 'node:crypto'
import { config } from '../config.js'

const { baseUrl, clientId, clientSecret } = config.paypal

let cachedToken = null
let tokenExpiresAt = 0
let lastConnection = null

export class PayPalError extends Error {
  constructor(message, { status, debugId, details, name } = {}) {
    super(message)
    this.name = 'PayPalError'
    this.status = status
    this.debugId = debugId
    this.details = details
    this.issue = name
  }
}

export const paypalEnabled = () => config.paypal.live

export function paypalStatus() {
  return {
    mode: paypalEnabled() ? 'sandbox' : 'not_configured',
    environment: baseUrl.includes('sandbox') ? 'sandbox' : 'live',
    baseUrl,
    clientId: paypalEnabled() ? clientId : null,
    webhookConfigured: Boolean(config.paypal.webhookId),
    lastConnection
  }
}

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken
  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15_000)
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    lastConnection = { ok: false, at: new Date().toISOString(), error: data.error_description || `HTTP ${response.status}` }
    throw new PayPalError(`PayPal OAuth failed: ${data.error_description || response.status}`, { status: response.status })
  }
  cachedToken = data.access_token
  tokenExpiresAt = Date.now() + data.expires_in * 1000
  lastConnection = { ok: true, at: new Date().toISOString(), appId: data.app_id, scopes: (data.scope || '').split(' ').length }
  return cachedToken
}

/** Low-level request helper: JSON in, JSON out, PayPal error bodies surfaced. */
async function request(path, { method = 'GET', body, form, headers = {}, idempotent = false } = {}) {
  if (!paypalEnabled()) throw new PayPalError('PayPal sandbox credentials are not configured', { status: 503 })
  const token = await getAccessToken()
  const init = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(idempotent ? { 'PayPal-Request-Id': crypto.randomUUID() } : {}),
      ...headers
    },
    signal: AbortSignal.timeout(30_000)
  }
  if (form) {
    init.body = form
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  const response = await fetch(`${baseUrl}${path}`, init)
  const debugId = response.headers.get('paypal-debug-id')
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }
  if (!response.ok) {
    const detail = data?.details?.[0]
    const message = detail?.description || data?.message || data?.error_description || `PayPal API error ${response.status}`
    throw new PayPalError(message, { status: response.status, debugId, details: data?.details, name: detail?.issue || data?.name })
  }
  return { data, debugId }
}

/* ------------------------------------------------------------------ Orders v2 */

export async function createOrder({ referenceId, items, shippingCost, currency, brandName, customId }) {
  const money = (value) => ({ currency_code: currency, value: Number(value).toFixed(2) })
  const itemTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const { data } = await request('/v2/checkout/orders', {
    method: 'POST',
    idempotent: true,
    body: {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: referenceId,
        custom_id: customId,
        description: `${brandName} order`,
        amount: {
          ...money(itemTotal + shippingCost),
          breakdown: { item_total: money(itemTotal), shipping: money(shippingCost) }
        },
        items: items.map((item) => ({
          name: item.name.slice(0, 127),
          sku: item.sku,
          quantity: String(item.quantity),
          unit_amount: money(item.price),
          category: 'PHYSICAL_GOODS'
        }))
      }],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: brandName.slice(0, 127),
            shipping_preference: 'GET_FROM_FILE',
            user_action: 'PAY_NOW'
          }
        }
      }
    }
  })
  return data
}

export async function captureOrder(orderId) {
  const { data, debugId } = await request(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    idempotent: true,
    body: {},
    headers: { Prefer: 'return=representation' }
  })
  return { ...data, debugId }
}

export async function getOrder(orderId) {
  const { data } = await request(`/v2/checkout/orders/${encodeURIComponent(orderId)}`)
  return data
}

/** Orders v2 "add tracking information for an order". */
export async function addTracking(orderId, { captureId, trackingNumber, carrier, carrierNameOther, notifyPayer = true }) {
  const { data } = await request(`/v2/checkout/orders/${encodeURIComponent(orderId)}/track`, {
    method: 'POST',
    idempotent: true,
    body: {
      capture_id: captureId,
      tracking_number: trackingNumber,
      carrier,
      ...(carrier === 'OTHER' ? { carrier_name_other: carrierNameOther || 'Other' } : {}),
      notify_payer: notifyPayer
    }
  })
  return data
}

/* ------------------------------------------------------------------ Disputes v1 */

export async function listDisputes({ startTime } = {}) {
  const params = new URLSearchParams({ page_size: '50' })
  if (startTime) params.set('start_time', startTime)
  const { data } = await request(`/v1/customer/disputes?${params}`)
  return data?.items || []
}

export async function getDispute(disputeId) {
  const { data } = await request(`/v1/customer/disputes/${encodeURIComponent(disputeId)}`)
  return data
}

/**
 * Provide evidence (multipart/form-data): an `input` JSON part plus optional
 * `evidence_file` parts (PDF/JPG/PNG/GIF).
 */
export async function provideEvidence(disputeId, { evidences, files = [] }) {
  const form = new FormData()
  form.append('input', new Blob([JSON.stringify({ evidences })], { type: 'application/json' }), 'input.json')
  for (const file of files) {
    form.append('evidence_file', new Blob([file.buffer], { type: file.mime }), file.name)
  }
  const { data, debugId } = await request(`/v1/customer/disputes/${encodeURIComponent(disputeId)}/provide-evidence`, {
    method: 'POST',
    form
  })
  return { data, debugId }
}

export async function sendDisputeMessage(disputeId, message) {
  const form = new FormData()
  form.append('input', new Blob([JSON.stringify({ message })], { type: 'application/json' }), 'input.json')
  const { data, debugId } = await request(`/v1/customer/disputes/${encodeURIComponent(disputeId)}/send-message`, {
    method: 'POST',
    form
  })
  return { data, debugId }
}

/** Sandbox-only: moves a dispute into the seller-evidence-required state. */
export async function sandboxRequireEvidence(disputeId) {
  const { data } = await request(`/v1/customer/disputes/${encodeURIComponent(disputeId)}/require-evidence`, {
    method: 'POST',
    body: { action: 'SELLER_EVIDENCE' }
  })
  return data
}

/* ------------------------------------------------------------------ Webhooks */

export const WEBHOOK_EVENTS = [
  'CUSTOMER.DISPUTE.CREATED',
  'CUSTOMER.DISPUTE.UPDATED',
  'CUSTOMER.DISPUTE.RESOLVED',
  'PAYMENT.CAPTURE.REFUNDED',
  'PAYMENT.CAPTURE.REVERSED'
]

export async function verifyWebhookSignature(headers, event) {
  if (!config.paypal.webhookId) return false
  const { data } = await request('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: {
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: config.paypal.webhookId,
      webhook_event: event
    }
  })
  return data?.verification_status === 'SUCCESS'
}

export async function listWebhooks() {
  const { data } = await request('/v1/notifications/webhooks')
  return data?.webhooks || []
}

export async function createWebhook(url) {
  const { data } = await request('/v1/notifications/webhooks', {
    method: 'POST',
    body: { url, event_types: WEBHOOK_EVENTS.map((name) => ({ name })) }
  })
  return data
}

export async function testConnection() {
  cachedToken = null
  await getAccessToken()
  return lastConnection
}

/* ------------------------------------------------------------------ Mappings */

export const PAYPAL_CARRIERS = [
  { code: 'USPS', label: 'USPS' },
  { code: 'UPS', label: 'UPS' },
  { code: 'FEDEX', label: 'FedEx' },
  { code: 'DHL', label: 'DHL Express' },
  { code: 'CANADA_POST', label: 'Canada Post' },
  { code: 'ROYAL_MAIL', label: 'Royal Mail' },
  { code: 'OTHER', label: 'Other carrier' }
]

export const carrierLabel = (code, other) =>
  code === 'OTHER' ? other || 'Other carrier' : PAYPAL_CARRIERS.find((carrier) => carrier.code === code)?.label || code
