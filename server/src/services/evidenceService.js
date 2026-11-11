/**
 * Evidence pack builder.
 *
 * The pack is derived from the order record every time the order changes, so it
 * can never drift from the underlying facts. Each item says where its data came
 * from (`source`) and whether it was confirmed by an API (`verified`) or entered
 * by the merchant.
 */
import { carrierLabel } from './paypalClient.js'

export const EVIDENCE_TYPES = {
  order_receipt: { label: 'PayPal payment receipt', weight: 20, code: 'RCPT' },
  tracking: { label: 'Shipment tracking', weight: 20, code: 'TRK' },
  delivery_confirmation: { label: 'Proof of delivery', weight: 20, code: 'POD' },
  product_description: { label: 'Product listing at time of sale', weight: 10, code: 'LIST' },
  refund_policy: { label: 'Return policy accepted at checkout', weight: 10, code: 'POL' },
  ip_device_match: { label: 'Checkout device & IP record', weight: 10, code: 'DEV' },
  buyer_history: { label: 'Buyer history with this store', weight: 5, code: 'HIST' },
  buyer_communication: { label: 'Buyer communication log', weight: 5, code: 'MSG' }
}

export const ATTACHMENT_KINDS = {
  proof_of_delivery: 'delivery_confirmation',
  shipping_label: 'tracking',
  product_photo: 'product_description',
  communication: 'buyer_communication',
  other: null
}

/** Compact, unambiguous timestamp used in evidence summaries (e.g. "25 Sep 2026, 10:15 UTC"). */
export function formatWhen(iso, withTime = true) {
  const date = new Date(iso)
  const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  return withTime ? `${day}, ${date.toISOString().slice(11, 16)} UTC` : day
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

const evidenceId = (order, type) => `EV-${order.number}-${EVIDENCE_TYPES[type].code}`
const money = (value, currency = 'USD') => `${currency === 'USD' ? '$' : ''}${Number(value).toFixed(2)}${currency === 'USD' ? '' : ` ${currency}`}`

export function formatAddress(address = {}) {
  return [address.line1, address.line2, [address.city, address.state, address.postalCode].filter(Boolean).join(' '), address.country]
    .filter(Boolean)
    .join(', ')
}

export function buildEvidencePack(order, history) {
  const filesFor = (type) => (order.attachments || []).filter((file) => ATTACHMENT_KINDS[file.kind] === type).map((file) => file.id)
  const items = []
  const push = (type, item) => items.push({
    id: evidenceId(order, type),
    type,
    label: EVIDENCE_TYPES[type].label,
    files: filesFor(type),
    ...item
  })

  // 1. Payment receipt: straight from the PayPal capture response.
  const pp = order.paypal
  push('order_receipt', pp?.captureId
    ? {
        present: true,
        verified: order.source === 'paypal',
        source: order.source === 'paypal' ? 'PayPal Orders v2 capture response' : 'Simulated checkout (no PayPal call)',
        summary: `${money(order.total, order.currency)} captured ${formatWhen(pp.createTime || order.createdAt)} · capture ${pp.captureId}`,
        data: {
          paypalOrderId: pp.orderId,
          captureId: pp.captureId,
          captureStatus: pp.captureStatus,
          amount: order.total,
          currency: order.currency,
          paypalFee: pp.fee,
          netAmount: pp.net,
          payerEmail: order.buyer.email,
          payerId: order.buyer.payerId,
          sellerProtection: pp.sellerProtection?.status || 'UNKNOWN',
          capturedAt: pp.createTime || order.createdAt
        },
        collectedAt: order.createdAt
      }
    : { present: false, verified: false, source: 'PayPal capture', summary: 'Payment has not been captured', data: null, collectedAt: null })

  // 2. Tracking: merchant-entered number, confirmed when PayPal accepted the tracker.
  const f = order.fulfillment || {}
  push('tracking', f.trackingNumber
    ? {
        present: true,
        verified: f.paypalSync?.status === 'synced',
        source: f.paypalSync?.status === 'synced' ? 'Registered with PayPal (Orders v2 /track)' : 'Entered by merchant',
        summary: `${carrierLabel(f.carrier, f.carrierOther)} ${f.trackingNumber}, shipped ${formatWhen(f.shippedAt, false)}`,
        data: {
          carrier: carrierLabel(f.carrier, f.carrierOther),
          carrierCode: f.carrier,
          trackingNumber: f.trackingNumber,
          shippedAt: f.shippedAt,
          shippedTo: formatAddress(order.shipping?.address),
          paypalTracker: f.paypalSync || null
        },
        collectedAt: f.shippedAt
      }
    : { present: false, verified: false, source: 'Carrier / PayPal tracking', summary: 'No tracking number yet', data: null, collectedAt: null })

  // 3. Proof of delivery: delivery date + signature, strengthened by uploaded POD
  //    files and by the buyer's own confirmation on the store order page.
  const podFiles = filesFor('delivery_confirmation').length
  const buyerAck = f.buyerConfirmed || null
  const podSources = [
    podFiles && 'carrier proof-of-delivery document (uploaded)',
    buyerAck && 'receipt confirmed by the buyer on the store order page',
    !podFiles && !buyerAck && 'delivery confirmed by merchant'
  ].filter(Boolean)
  push('delivery_confirmation', f.deliveredAt
    ? {
        present: true,
        verified: podFiles > 0 || Boolean(buyerAck),
        source: podSources.join('; ').replace(/^./, (c) => c.toUpperCase()),
        summary: `Delivered ${formatWhen(f.deliveredAt)}${f.signedBy ? `, signed by ${f.signedBy}` : ''}${buyerAck ? `; buyer confirmed receipt ${formatWhen(buyerAck.at)}` : ''}`,
        data: {
          deliveredAt: f.deliveredAt,
          signedBy: f.signedBy || null,
          deliveryNote: f.deliveryNote || null,
          deliveredTo: formatAddress(order.shipping?.address),
          buyerConfirmation: buyerAck
        },
        collectedAt: buyerAck?.at || f.deliveredAt
      }
    : { present: false, verified: false, source: 'Carrier proof of delivery', summary: 'Delivery not confirmed yet', data: null, collectedAt: null })

  // 4. Product listing snapshot captured at checkout.
  push('product_description', {
    present: (order.items || []).length > 0,
    verified: true,
    source: 'Storefront listing snapshot taken at checkout',
    summary: order.items.map((item) => `${item.quantity}× ${item.name}`).join(', '),
    data: { items: order.items.map(({ sku, name, quantity, price, category, description }) => ({ sku, name, quantity, price, category, description })) },
    collectedAt: order.createdAt
  })

  // 5. Return policy version shown and accepted at checkout.
  const checkout = order.checkout || {}
  push('refund_policy', checkout.policyVersion
    ? {
        present: true,
        verified: true,
        source: 'Policy version displayed at checkout',
        summary: `Policy v${checkout.policyVersion}: ${checkout.policySummary}`,
        data: { version: checkout.policyVersion, summary: checkout.policySummary, terms: checkout.policyTerms, acceptedAt: checkout.at },
        collectedAt: checkout.at
      }
    : { present: false, verified: false, source: 'Store policy', summary: 'No policy acceptance recorded', data: null, collectedAt: null })

  // 6. Device / IP fingerprint recorded server-side during checkout.
  push('ip_device_match', checkout.ip
    ? {
        present: true,
        verified: true,
        source: 'Recorded by ProofPilot server at checkout',
        summary: `Checkout from ${checkout.ip} · ${summariseUserAgent(checkout.userAgent)}`,
        data: { ip: checkout.ip, userAgent: checkout.userAgent, acceptLanguage: checkout.acceptLanguage, at: checkout.at },
        collectedAt: checkout.at
      }
    : { present: false, verified: false, source: 'Checkout session', summary: 'No checkout device record', data: null, collectedAt: null })

  // 7. Buyer history computed from store records.
  push('buyer_history', {
    present: true,
    verified: true,
    source: 'ProofPilot store records',
    summary: history.priorOrders
      ? `${plural(history.priorOrders, 'earlier order')}, ${plural(history.priorDisputes, 'dispute')}, lifetime ${money(history.lifetimeValue)}`
      : 'First order from this buyer',
    data: { ...history, payerAccountStatus: order.paypal?.accountStatus || 'UNKNOWN' },
    collectedAt: order.updatedAt || order.createdAt
  })

  // 8. Communication log: merchant-logged messages plus messages the buyer sent
  //    from the store order page (server-timestamped, so verified).
  const messages = order.communications || []
  const portal = messages.filter((message) => message.channel === 'store')
  push('buyer_communication', messages.length || filesFor('buyer_communication').length
    ? {
        present: true,
        verified: portal.length > 0,
        source: portal.length
          ? portal.length === messages.length ? 'Store order page (server-timestamped)' : 'Store order page (server-timestamped) and merchant log'
          : 'Logged by merchant',
        summary: `${plural(messages.length, 'message')} logged${portal.length ? ` (${portal.length} from the store order page)` : ''}${messages.length ? `, latest ${formatWhen(messages.at(-1).at, false)}` : ''}`,
        data: { messages },
        collectedAt: messages.at(-1)?.at || order.updatedAt
      }
    : { present: false, verified: false, source: 'Buyer messages', summary: 'No buyer messages logged', data: null, collectedAt: null })

  const percent = items.reduce((sum, item) => sum + (item.present ? EVIDENCE_TYPES[item.type].weight : 0), 0)
  return {
    items,
    percent,
    missing: items.filter((item) => !item.present).map((item) => item.type),
    builtAt: new Date().toISOString()
  }
}

function summariseUserAgent(ua = '') {
  if (!ua) return 'unknown device'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'unknown OS'
  return `${browser} on ${os}`
}
