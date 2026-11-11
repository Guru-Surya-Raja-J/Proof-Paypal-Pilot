/**
 * Storefront checkout. The buyer pays with the real PayPal JS SDK; the server
 * creates and captures the PayPal order and then hands the capture to the
 * ProofPilot agent, which builds the evidence pack at that moment.
 */
import { config } from '../config.js'
import { store } from '../lib/store.js'
import { logActivity } from '../lib/events.js'
import { findProduct, SHIPPING_METHODS, STORE_POLICY } from '../data/catalog.js'
import * as paypal from './paypalClient.js'
import { ingestOrder, parseCapture, shortId, addTracking, markDelivered, addCommunication } from './orderService.js'
import { createSimulatedDispute } from './disputeService.js'

const round2 = (value) => Math.round(value * 100) / 100

/** Prices come from the catalog, never from the client. */
function priceCart(cart, shippingMethod) {
  const items = cart.map(({ sku, quantity }) => {
    const product = findProduct(sku)
    if (!product) throw Object.assign(new Error(`Unknown product ${sku}`), { status: 400 })
    return {
      sku,
      name: product.name,
      quantity,
      price: product.price,
      category: product.category,
      riskCategory: product.riskCategory,
      description: product.description
    }
  })
  const method = SHIPPING_METHODS[shippingMethod]
  if (!method) throw Object.assign(new Error('Unknown shipping method'), { status: 400 })
  const subtotal = round2(items.reduce((sum, item) => sum + item.price * item.quantity, 0))
  return { items, subtotal, shippingCost: method.price, total: round2(subtotal + method.price), shippingMethod: method.id, shippingLabel: method.label }
}

function requestContext(req) {
  return {
    ip: req.ip,
    userAgent: (req.get('user-agent') || '').slice(0, 300),
    acceptLanguage: (req.get('accept-language') || '').slice(0, 100)
  }
}

export async function createCheckout({ cart, shippingMethod }, req) {
  const priced = priceCart(cart, shippingMethod)
  const checkout = {
    id: shortId('chk'),
    ...priced,
    currency: config.merchant.currency,
    policy: STORE_POLICY,
    ...requestContext(req),
    createdAt: new Date().toISOString(),
    status: 'created'
  }
  const ppOrder = await paypal.createOrder({
    referenceId: checkout.id,
    customId: checkout.id,
    items: priced.items,
    shippingCost: priced.shippingCost,
    currency: checkout.currency,
    brandName: config.merchant.name
  })
  checkout.paypalOrderId = ppOrder.id
  await store.put('checkouts', checkout)
  return { checkoutId: checkout.id, paypalOrderId: ppOrder.id }
}

export async function captureCheckout(paypalOrderId) {
  const checkout = store.all('checkouts').find((entry) => entry.paypalOrderId === paypalOrderId)
  if (!checkout) throw Object.assign(new Error('Unknown checkout'), { status: 404 })
  if (checkout.status === 'captured' && checkout.orderId) {
    return { order: store.get('orders', checkout.orderId), alreadyCaptured: true }
  }

  const capture = await paypal.captureOrder(paypalOrderId)
  const parsed = parseCapture(capture)
  if (parsed.status !== 'COMPLETED') {
    checkout.status = `capture_${(parsed.status || 'unknown').toLowerCase()}`
    await store.put('checkouts', checkout)
    throw Object.assign(new Error(`PayPal returned capture status ${parsed.status}`), { status: 402 })
  }

  const order = await ingestOrder({
    source: 'paypal',
    checkout,
    paypal: parsed.paypal,
    buyer: parsed.buyer,
    shippingAddress: parsed.shippingAddress
  })
  checkout.status = 'captured'
  checkout.orderId = order.id
  await store.put('checkouts', checkout)
  return { order, alreadyCaptured: false }
}

/**
 * Used only when PayPal credentials are absent so the product can still be
 * explored. The resulting order is labelled "simulated" everywhere.
 */
export async function simulatedCheckout({ cart, shippingMethod, buyer, address }, req) {
  const priced = priceCart(cart, shippingMethod)
  const now = new Date().toISOString()
  const checkout = { ...priced, currency: config.merchant.currency, policy: STORE_POLICY, ...requestContext(req), createdAt: now }
  const tag = Date.now().toString(36).toUpperCase()
  return ingestOrder({
    source: 'simulated',
    checkout,
    paypal: {
      orderId: `SIM-ORDER-${tag}`,
      captureId: `SIM-CAPTURE-${tag}`,
      captureStatus: 'COMPLETED',
      createTime: now,
      sellerProtection: null,
      accountStatus: null,
      fee: null,
      net: null
    },
    buyer: { name: buyer.name, email: buyer.email.toLowerCase(), payerId: null, country: address.country },
    shippingAddress: { name: buyer.name, address }
  })
}

/* ------------------------------------------------------------- demo scenario */

const daysAgo = (days, hour = 10) => {
  const date = new Date(Date.now() - days * 86400_000)
  date.setUTCHours(hour, 15, 0, 0)
  return date.toISOString()
}

const DEMO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'
const DEMO_UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'

const DEMO_BUYERS = {
  maya: { name: 'Maya Chen', email: 'maya.chen@example.com', payerId: 'DEMOPAYERMAYA01', country: 'US' },
  riley: { name: 'Riley Smith', email: 'r.smith@example.net', payerId: 'DEMOPAYERRILEY1', country: 'US' },
  alex: { name: 'Alex Rivera', email: 'alex.rivera@example.org', payerId: 'DEMOPAYERALEX01', country: 'US' },
  jon: { name: 'Jon Bell', email: 'jb.orders77@example.com', payerId: 'DEMOPAYERJON001', country: 'US' }
}

const DEMO_ADDRESSES = {
  maya: { line1: '742 Alder Street', line2: '', city: 'Eugene', state: 'OR', postalCode: '97401', country: 'US' },
  riley: { line1: '1088 Burrard Street', line2: 'Apt 1204', city: 'Vancouver', state: 'BC', postalCode: 'V6Z 2R9', country: 'CA' },
  alex: { line1: '500 Howard Street', line2: '', city: 'San Francisco', state: 'CA', postalCode: '94105', country: 'US' },
  jon: { line1: '1201 N Orange Street', line2: 'Suite JB-48213', city: 'Wilmington', state: 'DE', postalCode: '19801', country: 'US' }
}

async function demoOrder({ buyer, address, cart, shipping = 'standard', createdAt, protection = 'ELIGIBLE', accountStatus = 'VERIFIED', ip, ua = DEMO_UA }) {
  const priced = priceCart(cart, shipping)
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase()
  return ingestOrder({
    source: 'demo',
    createdAt,
    checkout: { ...priced, currency: 'USD', policy: STORE_POLICY, ip, userAgent: ua, acceptLanguage: 'en-US,en;q=0.9', createdAt },
    paypal: {
      orderId: `DEMO-${tag}`,
      captureId: `DEMO-CAP-${tag}`,
      captureStatus: 'COMPLETED',
      createTime: createdAt,
      sellerProtection: { status: protection, categories: protection === 'ELIGIBLE' ? ['ITEM_NOT_RECEIVED', 'UNAUTHORIZED_TRANSACTION'] : [] },
      accountStatus,
      fee: round2(priced.total * 0.0349 + 0.49),
      net: round2(priced.total - (priced.total * 0.0349 + 0.49))
    },
    buyer,
    shippingAddress: { name: buyer.name, address }
  })
}

/**
 * Loads a small, clearly labelled demo history through the real pipeline
 * (risk scoring, evidence building, AI explanations). Demo IPs use the
 * RFC 5737 documentation ranges.
 */
export async function loadDemoScenario() {
  const { maya, riley, alex, jon } = DEMO_BUYERS

  // Maya: loyal repeat buyer; two delivered orders, a new one shipped.
  const m1 = await demoOrder({ buyer: maya, address: DEMO_ADDRESSES.maya, cart: [{ sku: 'CAN-SOY-07', quantity: 1 }], createdAt: daysAgo(64), ip: '198.51.100.23' })
  await addTracking(m1, { carrier: 'USPS', trackingNumber: '9400111899223344556601', shippedAt: daysAgo(63, 17) })
  await markDelivered(m1, { deliveredAt: daysAgo(60, 16), signedBy: null })
  const m2 = await demoOrder({ buyer: maya, address: DEMO_ADDRESSES.maya, cart: [{ sku: 'LIN-RUN-02', quantity: 2 }], createdAt: daysAgo(30), ip: '198.51.100.23' })
  await addTracking(m2, { carrier: 'USPS', trackingNumber: '9400111899223344556618', shippedAt: daysAgo(29, 17) })
  await markDelivered(m2, { deliveredAt: daysAgo(26, 15), signedBy: null })
  const m3 = await demoOrder({ buyer: maya, address: DEMO_ADDRESSES.maya, cart: [{ sku: 'POT-CER-01', quantity: 1 }], createdAt: daysAgo(3), ip: '198.51.100.23' })
  await addTracking(m3, { carrier: 'USPS', trackingNumber: '9400111899223344556625', shippedAt: daysAgo(2, 17) })

  // Riley: US PayPal account shipping to Canada, disputed an earlier order.
  const r1 = await demoOrder({ buyer: riley, address: DEMO_ADDRESSES.riley, cart: [{ sku: 'WOD-ACC-53', quantity: 1 }], createdAt: daysAgo(45), ip: '203.0.113.88', ua: DEMO_UA_MOBILE })
  await addTracking(r1, { carrier: 'CANADA_POST', trackingNumber: '7023210039414503', shippedAt: daysAgo(44, 17) })
  await createSimulatedDispute(r1, { reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', buyerMessage: 'Tracking says delivered but nothing arrived.' })
  const r2 = await demoOrder({ buyer: riley, address: DEMO_ADDRESSES.riley, cart: [{ sku: 'LIN-RUN-02', quantity: 1 }, { sku: 'CAN-SOY-07', quantity: 1 }], createdAt: daysAgo(2), ip: '203.0.113.88', ua: DEMO_UA_MOBILE })
  await addTracking(r2, { carrier: 'CANADA_POST', trackingNumber: '7023210039414527', shippedAt: daysAgo(1, 17) })
  await addCommunication(r2, { direction: 'buyer', channel: 'email', body: 'Hi, can you confirm the runner is the natural flax colour?', at: daysAgo(2, 12) })
  await addCommunication(r2, { direction: 'merchant', channel: 'email', body: 'Yes, natural flax, exactly as pictured. Shipped today with tracking.', at: daysAgo(2, 14) })

  // Alex: first order, high-value jewellery delivered with signature.
  const a1 = await demoOrder({ buyer: alex, address: DEMO_ADDRESSES.alex, cart: [{ sku: 'SIL-PEN-21', quantity: 1 }], createdAt: daysAgo(9), ip: '192.0.2.140' })
  await addTracking(a1, { carrier: 'UPS', trackingNumber: '1Z999AA10123456784', shippedAt: daysAgo(8, 17) })
  await markDelivered(a1, { deliveredAt: daysAgo(5, 15), signedBy: 'A. Rivera' })

  // Jon: brand-new unverified payer, limited edition set, express to a forwarder.
  await demoOrder({
    buyer: jon,
    address: DEMO_ADDRESSES.jon,
    cart: [{ sku: 'LUX-GLZ-16', quantity: 1 }],
    shipping: 'express',
    createdAt: new Date(Date.now() - 40 * 60_000).toISOString(),
    protection: 'PARTIALLY_ELIGIBLE',
    accountStatus: 'UNVERIFIED',
    ip: '203.0.113.201'
  })

  await logActivity({ action: 'Loaded demo scenario', target: '4 buyers · 7 orders', detail: 'Demo data runs through the same risk and evidence pipeline as live orders', kind: 'info' })
}

export async function resetWorkspace() {
  for (const name of ['orders', 'disputes', 'activity', 'checkouts']) await store.clear(name)
  await store.remove('meta', 'counter:order')
  await store.clearFiles()
}
