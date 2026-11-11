/**
 * Public storefront API used by the buyer-facing shop page and the buyer's
 * order page. Buyers have no accounts: each order carries an unguessable
 * `buyerToken`, handed out on the receipt or after an order-number + email
 * lookup.
 */
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { config } from '../config.js'
import { store } from '../lib/store.js'
import { CATALOG, SHIPPING_METHODS, STORE_POLICY } from '../data/catalog.js'
import { paypalEnabled, paypalStatus, carrierLabel } from '../services/paypalClient.js'
import { createCheckout, captureCheckout, simulatedCheckout } from '../services/checkoutService.js'
import { addCommunication, buyerConfirmReceipt, ensureBuyerToken, findOrderByBuyerToken, MESSAGE_TOPICS } from '../services/orderService.js'

export const storefrontRouter = Router()

const limiter = (limit) => rateLimit({ windowMs: 60_000, limit, standardHeaders: 'draft-8', legacyHeaders: false })
const checkoutLimiter = limiter(20)
const lookupLimiter = limiter(10)
const buyerWriteLimiter = limiter(10)

const cartSchema = z.object({
  cart: z.array(z.object({ sku: z.string().min(1).max(40), quantity: z.number().int().min(1).max(10) })).min(1).max(20),
  shippingMethod: z.enum(Object.keys(SHIPPING_METHODS))
})

const simulatedSchema = cartSchema.extend({
  buyer: z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email().max(254) }),
  address: z.object({
    line1: z.string().trim().min(3).max(120),
    line2: z.string().trim().max(120).optional().default(''),
    city: z.string().trim().min(2).max(80),
    state: z.string().trim().max(40).optional().default(''),
    postalCode: z.string().trim().min(3).max(20),
    country: z.string().trim().length(2).transform((value) => value.toUpperCase())
  })
})

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/, 'This order link is not valid')

const requestCapture = (req) => ({
  ip: req.ip,
  userAgent: (req.get('user-agent') || '').slice(0, 300)
})

/* ---------------------------------------------------------------- receipts */

async function receiptFor(order, extra = {}) {
  return {
    orderNumber: order.number,
    token: await ensureBuyerToken(order),
    total: order.total,
    currency: order.currency,
    captureId: order.paypal.captureId,
    buyerName: order.buyer.name,
    buyerEmail: order.buyer.email,
    shipTo: order.shipping.address,
    items: order.items.map(({ name, quantity, price }) => ({ name, quantity, price })),
    ...extra
  }
}

/* ------------------------------------------------------- buyer order view */

const CARRIER_TRACKING_URLS = {
  USPS: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=',
  UPS: 'https://www.ups.com/track?tracknum=',
  FEDEX: 'https://www.fedex.com/fedextrack/?trknbr=',
  DHL: 'https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=',
  CANADA_POST: 'https://www.canadapost-postescanada.ca/track-reperez/en#/search?searchFor=',
  ROYAL_MAIL: 'https://www.royalmail.com/track-your-item#/tracking-results/'
}

function addBusinessDays(iso, days) {
  const date = new Date(iso)
  let added = 0
  while (added < days) {
    date.setUTCDate(date.getUTCDate() + 1)
    const day = date.getUTCDay()
    if (day !== 0 && day !== 6) added += 1
  }
  return date.toISOString()
}

/** What the buyer may see about their own order. No risk score, IPs or internal notes. */
function buyerOrderView(order) {
  const f = order.fulfillment || {}
  const method = SHIPPING_METHODS[order.shipping.method]
  const estimate = f.shippedAt && !f.deliveredAt && method?.businessDays
    ? { from: addBusinessDays(f.shippedAt, method.businessDays[0]), to: addBusinessDays(f.shippedAt, method.businessDays[1]) }
    : null
  const trackingBase = CARRIER_TRACKING_URLS[f.carrier]
  const caseOpen = store.all('disputes').some((dispute) => dispute.orderId === order.id && !dispute.outcome)
  return {
    number: order.number,
    placedAt: order.createdAt,
    source: order.source,
    buyerName: order.buyer.name,
    items: order.items.map(({ sku, name, quantity, price }) => ({ sku, name, quantity, price })),
    subtotal: order.subtotal,
    shippingCost: order.shippingCost,
    total: order.total,
    currency: order.currency,
    payment: {
      method: order.source === 'paypal' ? 'PayPal' : order.source === 'demo' ? 'Demo order (no payment)' : 'Simulated checkout (no payment)',
      captureId: order.source === 'paypal' ? order.paypal?.captureId || null : null
    },
    shipping: { name: order.shipping.name, address: order.shipping.address, method: order.shipping.methodLabel },
    status: f.status || 'unfulfilled',
    tracking: f.trackingNumber
      ? {
          carrier: carrierLabel(f.carrier, f.carrierOther),
          number: f.trackingNumber,
          url: trackingBase ? `${trackingBase}${encodeURIComponent(f.trackingNumber)}` : null,
          shippedAt: f.shippedAt
        }
      : null,
    estimate,
    deliveredAt: f.deliveredAt || null,
    buyerConfirmedAt: f.buyerConfirmed?.at || null,
    refunded: Boolean(order.flags?.refunded),
    caseOpen,
    messages: (order.communications || []).map(({ id, at, direction, body, topic }) => ({ id, at, from: direction === 'buyer' ? 'you' : 'shop', body, topic: topic || null })),
    policy: { version: order.checkout?.policyVersion || null, terms: order.checkout?.policyTerms || [] },
    merchant: { name: config.merchant.name, supportEmail: config.merchant.supportEmail }
  }
}

function loadBuyerOrder(req) {
  const order = findOrderByBuyerToken(tokenSchema.parse(req.params.token))
  if (!order) throw Object.assign(new Error('This order link is not valid. Look the order up with its number and email.'), { status: 404 })
  return order
}

/* ------------------------------------------------------------------ routes */

storefrontRouter.get('/config', (_req, res) => {
  const status = paypalStatus()
  res.json({
    merchant: { name: config.merchant.name, supportEmail: config.merchant.supportEmail, shipFrom: config.merchant.shipFrom },
    currency: config.merchant.currency,
    paypal: { enabled: paypalEnabled(), clientId: status.clientId, environment: status.environment },
    products: CATALOG.map(({ sku, name, price, category, description, image, weightKg }) => ({ sku, name, price, category, description, image, weightKg })),
    shippingMethods: Object.values(SHIPPING_METHODS),
    policy: STORE_POLICY,
    messageTopics: Object.entries(MESSAGE_TOPICS).map(([id, { label }]) => ({ id, label }))
  })
})

storefrontRouter.post('/checkout', checkoutLimiter, async (req, res) => {
  if (!paypalEnabled()) return res.status(503).json({ error: 'PayPal checkout is not configured on this server' })
  const body = cartSchema.parse(req.body)
  res.status(201).json(await createCheckout(body, req))
})

storefrontRouter.post('/checkout/:paypalOrderId/capture', checkoutLimiter, async (req, res) => {
  const paypalOrderId = z.string().regex(/^[A-Z0-9]{8,32}$/).parse(req.params.paypalOrderId)
  const { order, alreadyCaptured } = await captureCheckout(paypalOrderId)
  res.json({ alreadyCaptured, receipt: await receiptFor(order) })
})

storefrontRouter.post('/checkout/simulated', checkoutLimiter, async (req, res) => {
  if (paypalEnabled()) return res.status(409).json({ error: 'Live PayPal checkout is enabled; use the PayPal button' })
  const body = simulatedSchema.parse(req.body)
  const order = await simulatedCheckout(body, req)
  res.status(201).json({ receipt: await receiptFor(order, { simulated: true }) })
})

// Order number + email → the buyer's private order link. One generic error for
// both "no such order" and "wrong email" so the endpoint cannot confirm emails.
storefrontRouter.post('/orders/lookup', lookupLimiter, async (req, res) => {
  const { number, email } = z.object({
    number: z.coerce.number().int().min(1).max(10_000_000),
    email: z.string().trim().toLowerCase().email().max(254)
  }).parse(req.body)
  const order = store.all('orders').find((entry) => entry.number === number && (entry.buyer.email || '').toLowerCase() === email)
  if (!order) return res.status(404).json({ error: 'We could not find an order with that number and email.' })
  res.json({ token: await ensureBuyerToken(order), number: order.number })
})

storefrontRouter.get('/orders/:token', (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ order: buyerOrderView(loadBuyerOrder(req)) })
})

storefrontRouter.post('/orders/:token/messages', buyerWriteLimiter, async (req, res) => {
  const order = loadBuyerOrder(req)
  const { topic, body } = z.object({
    topic: z.enum(Object.keys(MESSAGE_TOPICS)),
    body: z.string().trim().min(5, 'Write a few words so the shop can help').max(1500)
  }).parse(req.body)
  if ((order.communications || []).filter((message) => message.channel === 'store').length >= 30) {
    return res.status(429).json({ error: `This order has reached its message limit. Email ${config.merchant.supportEmail} instead.` })
  }
  const next = await addCommunication(order, { direction: 'buyer', channel: 'store', body, topic, capture: requestCapture(req) })
  res.status(201).json({ order: buyerOrderView(next) })
})

storefrontRouter.post('/orders/:token/confirm-receipt', buyerWriteLimiter, async (req, res) => {
  const next = await buyerConfirmReceipt(loadBuyerOrder(req), requestCapture(req))
  res.json({ order: buyerOrderView(next) })
})
