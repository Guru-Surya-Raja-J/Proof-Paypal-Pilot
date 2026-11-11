/**
 * Order lifecycle: ingestion from a PayPal capture, fulfilment updates that
 * strengthen the evidence pack, and re-scoring. Every mutation goes through
 * `refreshOrder`, which rebuilds risk + evidence from the record.
 */
import crypto from 'node:crypto'
import { config } from '../config.js'
import { store } from '../lib/store.js'
import { emit, logActivity } from '../lib/events.js'
import { scoreOrder } from './riskService.js'
import { buildEvidencePack, formatAddress, formatWhen, ATTACHMENT_KINDS, EVIDENCE_TYPES } from './evidenceService.js'
import { explainRisk } from './aiService.js'
import { addTracking as paypalAddTracking, paypalEnabled, carrierLabel, PayPalError } from './paypalClient.js'

const nowIso = () => new Date().toISOString()
export const shortId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`

/** Unguessable link that lets the buyer see their own order (no account needed). */
const newBuyerToken = () => crypto.randomBytes(18).toString('base64url')

/** Orders created before buyer links existed get one on first use. */
export async function ensureBuyerToken(order) {
  if (order.buyerToken) return order.buyerToken
  order.buyerToken = newBuyerToken()
  await store.put('orders', order)
  return order.buyerToken
}

export const findOrderByBuyerToken = (token) =>
  (token && store.all('orders').find((order) => order.buyerToken === token)) || null

const signalSignature = (risk) => `${risk.score}:${risk.signals.map((signal) => signal.code).sort().join(',')}`

/* ------------------------------------------------------------- refresh / AI */

const explainQueue = new Map()

export async function refreshOrder(order, { explain = true } = {}) {
  const previous = order.risk
  const risk = scoreOrder(order)
  // Keep the AI explanation while the underlying signals are unchanged.
  if (previous?.explainedBy && previous.explainedBy !== 'rules' && previous.signature === signalSignature(risk)) {
    Object.assign(risk, {
      explanation: previous.explanation,
      recommendedAction: previous.recommendedAction,
      explainedBy: previous.explainedBy,
      model: previous.model
    })
  }
  risk.signature = signalSignature(risk)
  order.risk = risk
  order.evidence = buildEvidencePack(order, risk.history)
  order.updatedAt = nowIso()
  await store.put('orders', order)
  emit('order', { id: order.id })

  // AI explanations are spent where they matter: orders that are not low risk.
  if (explain && risk.explainedBy === 'rules' && risk.level !== 'low') queueExplanation(order.id)
  return order
}

export function queueExplanation(orderId) {
  if (explainQueue.has(orderId)) return
  const job = (async () => {
    const order = store.get('orders', orderId)
    if (!order) return
    try {
      const result = await explainRisk(order, order.risk)
      if (!result) return
      const fresh = store.get('orders', orderId)
      if (!fresh || fresh.risk.signature !== order.risk.signature) return
      fresh.risk = { ...fresh.risk, explanation: result.explanation, recommendedAction: result.recommendedAction, explainedBy: result.provider, model: result.model }
      await store.put('orders', fresh)
      emit('order', { id: orderId })
      if (fresh.risk.level !== 'low') {
        await logActivity({
          action: `Explained ${fresh.risk.level}-risk flag`,
          target: `Order #${fresh.number}`,
          detail: fresh.risk.recommendedAction,
          kind: 'ai',
          ref: { type: 'order', id: orderId }
        })
      }
    } catch (error) {
      console.warn(`[ai] Risk explanation failed for order ${orderId}: ${error.message}`)
    } finally {
      explainQueue.delete(orderId)
    }
  })()
  explainQueue.set(orderId, job)
}

/** Re-score this buyer's later orders (their history changed). */
export async function refreshBuyerOrders(order) {
  const related = store.all('orders').filter((other) =>
    other.id !== order.id &&
    ((order.buyer.payerId && other.buyer.payerId === order.buyer.payerId) || other.buyer.email === order.buyer.email))
  for (const other of related) await refreshOrder(other)
}

/* ------------------------------------------------------------------ ingest */

/**
 * Creates the ProofPilot order record from a checkout + PayPal capture.
 * `source`: 'paypal' (real sandbox capture) | 'simulated' | 'demo'.
 */
export async function ingestOrder({ source, checkout, paypal, buyer, shippingAddress, createdAt }) {
  if (paypal?.orderId) {
    const existing = store.all('orders').find((order) => order.paypal?.orderId === paypal.orderId)
    if (existing) return existing
  }

  const number = await store.next('order', 1041)
  const at = createdAt || nowIso()
  const order = {
    id: shortId('ord'),
    number,
    source,
    buyerToken: newBuyerToken(),
    createdAt: at,
    updatedAt: at,
    paypal,
    buyer,
    items: checkout.items,
    subtotal: checkout.subtotal,
    shippingCost: checkout.shippingCost,
    total: checkout.total,
    currency: checkout.currency,
    shipping: {
      name: shippingAddress.name || buyer.name,
      address: shippingAddress.address,
      method: checkout.shippingMethod,
      methodLabel: checkout.shippingLabel
    },
    checkout: {
      ip: checkout.ip,
      userAgent: checkout.userAgent,
      acceptLanguage: checkout.acceptLanguage,
      policyVersion: checkout.policy.version,
      policySummary: checkout.policy.summary,
      policyTerms: checkout.policy.terms,
      at: checkout.createdAt
    },
    fulfillment: { status: 'unfulfilled' },
    communications: [],
    attachments: [],
    flags: {}
  }

  await refreshOrder(order)

  const sourceLabel = source === 'paypal' ? 'PayPal sandbox capture' : source === 'demo' ? 'demo scenario' : 'simulated checkout'
  await logActivity({
    action: 'Built evidence pack at checkout',
    target: `Order #${number} · ${buyer.name}`,
    detail: `${sourceLabel} · ${order.currency} ${order.total.toFixed(2)} · evidence ${order.evidence.percent}% · risk ${order.risk.score}/100`,
    kind: source === 'paypal' ? 'paypal' : 'info',
    ref: { type: 'order', id: order.id }
  })
  if (order.risk.level === 'high') {
    await logActivity({
      action: 'Flagged high-risk order',
      target: `Order #${number}`,
      detail: order.risk.signals.map((signal) => signal.label).join(' · '),
      kind: 'danger',
      ref: { type: 'order', id: order.id }
    })
  }
  return order
}

/** Maps a PayPal Orders v2 capture response into ProofPilot fields. */
export function parseCapture(capture) {
  const unit = capture.purchase_units?.[0] || {}
  const cap = unit.payments?.captures?.[0] || {}
  const source = capture.payment_source?.paypal || {}
  const payer = capture.payer || {}
  const addr = unit.shipping?.address || {}
  const name = source.name || payer.name || {}
  const buyerName = [name.given_name, name.surname].filter(Boolean).join(' ') || unit.shipping?.name?.full_name || 'PayPal buyer'
  const breakdown = cap.seller_receivable_breakdown || {}
  return {
    status: cap.status || capture.status,
    paypal: {
      orderId: capture.id,
      captureId: cap.id,
      captureStatus: cap.status,
      createTime: cap.create_time || capture.create_time,
      sellerProtection: cap.seller_protection
        ? { status: cap.seller_protection.status, categories: cap.seller_protection.dispute_categories || [] }
        : null,
      accountStatus: source.account_status || null,
      fee: breakdown.paypal_fee ? Number(breakdown.paypal_fee.value) : null,
      net: breakdown.net_amount ? Number(breakdown.net_amount.value) : null,
      debugId: capture.debugId || null
    },
    buyer: {
      name: buyerName,
      email: source.email_address || payer.email_address || null,
      payerId: source.account_id || payer.payer_id || null,
      country: source.address?.country_code || payer.address?.country_code || addr.country_code || null
    },
    shippingAddress: {
      name: unit.shipping?.name?.full_name || buyerName,
      address: {
        line1: addr.address_line_1 || '',
        line2: addr.address_line_2 || '',
        city: addr.admin_area_2 || '',
        state: addr.admin_area_1 || '',
        postalCode: addr.postal_code || '',
        country: addr.country_code || ''
      }
    }
  }
}

/* --------------------------------------------------------------- fulfilment */

export async function addTracking(order, { carrier, carrierOther, trackingNumber, notifyPayer = true, shippedAt }) {
  const f = order.fulfillment
  f.carrier = carrier
  f.carrierOther = carrier === 'OTHER' ? carrierOther : undefined
  f.trackingNumber = trackingNumber
  f.shippedAt = shippedAt || f.shippedAt || nowIso()
  if (f.status === 'unfulfilled') f.status = 'shipped'

  if (order.source === 'paypal' && paypalEnabled()) {
    try {
      await paypalAddTracking(order.paypal.orderId, {
        captureId: order.paypal.captureId,
        trackingNumber,
        carrier,
        carrierNameOther: carrierOther,
        notifyPayer
      })
      f.paypalSync = { status: 'synced', at: nowIso() }
    } catch (error) {
      f.paypalSync = {
        status: 'failed',
        at: nowIso(),
        error: error.message,
        debugId: error instanceof PayPalError ? error.debugId : undefined
      }
    }
  } else {
    f.paypalSync = { status: 'not_applicable', at: nowIso(), note: 'Not paid through PayPal, so there is no PayPal transaction to attach tracking to.' }
  }

  await refreshOrder(order)
  const synced = f.paypalSync.status === 'synced'
  await logActivity({
    action: synced ? 'Registered tracking with PayPal' : 'Attached tracking',
    target: `Order #${order.number}`,
    detail: `${carrierLabel(carrier, carrierOther)} ${trackingNumber}${f.paypalSync.status === 'failed' ? ` · PayPal sync failed: ${f.paypalSync.error}` : ''} · evidence ${order.evidence.percent}%`,
    kind: synced ? 'paypal' : f.paypalSync.status === 'failed' ? 'warning' : 'info',
    ref: { type: 'order', id: order.id }
  })
  return order
}

export async function markDelivered(order, { deliveredAt, signedBy, note }) {
  const f = order.fulfillment
  if (!f.trackingNumber) throw Object.assign(new Error('Add tracking before confirming delivery'), { status: 400 })
  f.deliveredAt = deliveredAt || nowIso()
  f.signedBy = signedBy || null
  f.deliveryNote = note || null
  f.status = 'delivered'
  await refreshOrder(order)
  await logActivity({
    action: 'Recorded proof of delivery',
    target: `Order #${order.number}`,
    detail: `Delivered ${formatWhen(f.deliveredAt)}${signedBy ? `, signed by ${signedBy}` : ''} · evidence ${order.evidence.percent}%`,
    kind: 'success',
    ref: { type: 'order', id: order.id }
  })
  return order
}

export const MESSAGE_TOPICS = {
  where_is_order: { label: 'Where is my order?', early: true },
  damaged: { label: 'Item arrived damaged', early: true },
  not_as_described: { label: 'Not what I expected', early: true },
  return: { label: 'Return or exchange', early: false },
  other: { label: 'Something else', early: false }
}

/**
 * Adds a message to the order's communication log. Messages sent by the buyer
 * from the store order page carry `capturedBy: 'store'` with the server
 * timestamp, IP and device, so they count as system-recorded evidence.
 */
export async function addCommunication(order, { direction, channel, body, at, topic, capture }) {
  const message = { id: shortId('msg'), at: at || nowIso(), direction, channel, body }
  if (topic) message.topic = topic
  if (capture) message.capture = capture
  order.communications.push(message)
  order.communications.sort((a, b) => a.at.localeCompare(b.at))
  await refreshOrder(order)

  const fromPortal = channel === 'store' && direction === 'buyer'
  const topicInfo = topic ? MESSAGE_TOPICS[topic] : null
  await logActivity({
    action: fromPortal ? 'Buyer wrote from the order page' : channel === 'store' ? 'Replied on the buyer\'s order page' : 'Logged buyer communication',
    target: `Order #${order.number}`,
    detail: fromPortal
      ? `${topicInfo?.label || 'Message'}${topicInfo?.early ? ' · reply before it turns into a PayPal dispute' : ''} · saved to the evidence pack`
      : `${direction === 'buyer' ? 'From buyer' : 'To buyer'} via ${channel.replace(/_/g, ' ')}`,
    kind: fromPortal && topicInfo?.early ? 'warning' : 'info',
    ref: { type: 'order', id: order.id }
  })
  return order
}

/**
 * The buyer confirms on the order page that the parcel arrived. This is the
 * buyer's own acknowledgement, recorded with server time, IP and device.
 */
export async function buyerConfirmReceipt(order, capture) {
  const f = order.fulfillment
  if (!f.trackingNumber) throw Object.assign(new Error('This order has not shipped yet'), { status: 409 })
  if (f.buyerConfirmed) return order
  f.buyerConfirmed = { at: nowIso(), ...capture }
  if (!f.deliveredAt) {
    f.deliveredAt = f.buyerConfirmed.at
    f.status = 'delivered'
  }
  await refreshOrder(order)
  await logActivity({
    action: 'Buyer confirmed receipt',
    target: `Order #${order.number}`,
    detail: `Confirmed on the order page from ${capture.ip || 'unknown IP'} · evidence ${order.evidence.percent}%`,
    kind: 'success',
    ref: { type: 'order', id: order.id }
  })
  return order
}

export const ALLOWED_UPLOAD_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif'])
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export async function addAttachment(order, { originalname, mimetype, size, buffer }, { kind, note }) {
  if (!ALLOWED_UPLOAD_TYPES.has(mimetype)) {
    throw Object.assign(new Error('PayPal accepts PDF, PNG, JPG or GIF evidence files'), { status: 400 })
  }
  if (!(kind in ATTACHMENT_KINDS)) throw Object.assign(new Error('Unknown attachment kind'), { status: 400 })
  const id = shortId('file')
  await store.saveFile(id, buffer)
  order.attachments.push({
    id,
    name: originalname.replace(/[^\w.\- ()]/g, '_').slice(0, 120),
    mime: mimetype,
    size,
    kind,
    note: note || null,
    uploadedAt: nowIso()
  })
  await refreshOrder(order)
  const target = ATTACHMENT_KINDS[kind]
  await logActivity({
    action: 'Filed evidence document',
    target: `Order #${order.number}`,
    detail: `${originalname} → ${target ? EVIDENCE_TYPES[target].label : 'general evidence'}`,
    kind: 'info',
    ref: { type: 'order', id: order.id }
  })
  return order
}

export async function removeAttachment(order, fileId) {
  const before = order.attachments.length
  order.attachments = order.attachments.filter((file) => file.id !== fileId)
  if (order.attachments.length === before) throw Object.assign(new Error('Attachment not found'), { status: 404 })
  await refreshOrder(order)
  return order
}

/* ------------------------------------------------------------------ views */

/** The buyer wrote from the order page and the shop has not replied since. */
function awaitingReply(order) {
  const last = order.communications?.at(-1)
  if (!last || last.direction !== 'buyer' || last.channel !== 'store') return null
  return { at: last.at, topic: last.topic || null, topicLabel: MESSAGE_TOPICS[last.topic]?.label || 'Message', preview: last.body.slice(0, 140) }
}

export function orderSummary(order) {
  return {
    id: order.id,
    number: order.number,
    source: order.source,
    createdAt: order.createdAt,
    buyer: { name: order.buyer.name, email: order.buyer.email, country: order.buyer.country },
    itemsLabel: order.items.map((item) => `${item.quantity}× ${item.name}`).join(', '),
    total: order.total,
    currency: order.currency,
    shipTo: formatAddress(order.shipping.address),
    fulfillment: order.fulfillment.status,
    risk: { score: order.risk.score, level: order.risk.level, explainedBy: order.risk.explainedBy },
    evidence: { percent: order.evidence.percent, missing: order.evidence.missing },
    sellerProtection: order.paypal?.sellerProtection?.status || null,
    awaitingReply: awaitingReply(order),
    disputeIds: store.all('disputes').filter((dispute) => dispute.orderId === order.id).map((dispute) => dispute.id)
  }
}

export const merchantName = () => config.merchant.name
