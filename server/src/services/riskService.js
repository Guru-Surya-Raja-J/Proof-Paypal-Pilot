/**
 * Deterministic, explainable risk scoring (0-100).
 *
 * Every signal is computed from data ProofPilot actually holds: the PayPal
 * capture (payer, seller-protection status, shipping address), the storefront
 * checkout context, and this merchant's own order/dispute history.
 * The AI layer explains the score; it never changes it.
 */
import { store } from '../lib/store.js'
import { catalogMedianPrice } from '../data/catalog.js'

export const RISK_RULES = {
  NEW_BUYER: 15,
  ADDRESS_MISMATCH: 20,
  HIGH_ORDER_VALUE: 20,
  HIGH_RISK_CATEGORY: 10,
  PRIOR_DISPUTES: 25,
  VELOCITY_SPIKE: 10,
  RUSH_TO_FORWARDER: 15,
  SELLER_PROTECTION_GAP: 10,
  UNVERIFIED_PAYER: 10
}

const TAX_FREE_FORWARDING_ZIPS = [
  { state: 'DE', prefixes: ['197', '198', '199'] },
  { state: 'OR', prefixes: ['970', '971', '972', '973', '974', '975', '976', '977', '978', '979'] },
  { state: 'NH', prefixes: ['030', '031', '032', '033', '034', '035', '036', '037', '038'] },
  { state: 'MT', prefixes: ['590', '591', '592', '593', '594', '595', '596', '597', '598', '599'] }
]
const FORWARDER_KEYWORDS = /\b(forward(ing|er)?|reship(ping|per)?|shipito|myus|stackry|planet\s*express|parcel\s*hub|package\s*concierge)\b/i
const SUITE_ROUTING_CODE = /\b(suite|ste|unit|#)\s*[a-z]{0,3}[-\s]?\d{3,}\b/i

/** Returns a reason string when the address looks like a package forwarder, otherwise null. */
export function detectFreightForwarder(address = {}) {
  const text = [address.line1, address.line2, address.city].filter(Boolean).join(' ')
  if (FORWARDER_KEYWORDS.test(text)) return 'address names a package-forwarding service'
  const zip = (address.postalCode || '').slice(0, 3)
  const taxFree = address.country === 'US' && TAX_FREE_FORWARDING_ZIPS.some(
    (entry) => entry.state === address.state && entry.prefixes.includes(zip)
  )
  if (taxFree && SUITE_ROUTING_CODE.test(text)) return `suite routing code in a sales-tax-free forwarding hub (${address.state} ${address.postalCode})`
  return null
}

const sameBuyer = (a, b) =>
  (a.buyer?.payerId && a.buyer.payerId === b.buyer?.payerId) ||
  (a.buyer?.email && a.buyer.email.toLowerCase() === b.buyer?.email?.toLowerCase())

/** Buyer history computed from this merchant's own records, excluding the order itself. */
export function buyerHistory(order) {
  const createdAt = new Date(order.createdAt).getTime()
  const priorOrders = store.all('orders').filter(
    (other) => other.id !== order.id && sameBuyer(other, order) && new Date(other.createdAt).getTime() < createdAt
  )
  const priorIds = new Set(priorOrders.map((other) => other.id))
  const priorDisputes = store.all('disputes').filter((dispute) => priorIds.has(dispute.orderId))
  const last24h = priorOrders.filter((other) => createdAt - new Date(other.createdAt).getTime() < 24 * 3600_000)
  return {
    priorOrders: priorOrders.length,
    priorDisputes: priorDisputes.length,
    ordersLast24h: last24h.length + 1,
    lifetimeValue: priorOrders.reduce((sum, other) => sum + other.total, 0),
    firstSeenAt: priorOrders.length ? priorOrders.map((other) => other.createdAt).sort()[0] : order.createdAt
  }
}

/** Average order value from completed history; the catalog median until there are 3+ orders. */
export function storeAverageOrderValue(excludeId) {
  const totals = store.all('orders').filter((order) => order.id !== excludeId).map((order) => order.total)
  if (totals.length < 3) return { value: catalogMedianPrice, basis: 'catalog median (fewer than 3 orders on record)' }
  return { value: Math.round(totals.reduce((a, b) => a + b, 0) / totals.length), basis: `average of ${totals.length} orders` }
}

export function scoreOrder(order) {
  const signals = []
  const add = (code, label, evidence) => signals.push({ code, points: RISK_RULES[code], label, evidence })

  const history = buyerHistory(order)
  const address = order.shipping?.address || {}
  const forwarder = detectFreightForwarder(address)
  const average = storeAverageOrderValue(order.id)

  if (history.priorOrders === 0) {
    add('NEW_BUYER', 'First order from this buyer', 'No earlier orders from this PayPal payer in the store records')
  }

  const payerCountry = order.buyer?.country
  if (forwarder) {
    add('ADDRESS_MISMATCH', 'Ships to a freight-forwarder address', `Shipping address: ${forwarder}`)
  } else if (payerCountry && address.country && payerCountry !== address.country) {
    add('ADDRESS_MISMATCH', 'Payer and shipping countries differ', `PayPal account country ${payerCountry}, shipping to ${address.country}`)
  }

  if (order.total > average.value * 3) {
    add('HIGH_ORDER_VALUE', 'Order value is more than 3× the store average', `$${order.total.toFixed(2)} vs $${average.value} (${average.basis})`)
  }

  const riskyItems = (order.items || []).filter((item) => item.riskCategory)
  if (riskyItems.length) {
    add('HIGH_RISK_CATEGORY', 'Contains a high-chargeback category', riskyItems.map((item) => `${item.name} (${item.category})`).join(', '))
  }

  if (history.priorDisputes > 0) {
    add('PRIOR_DISPUTES', 'Buyer has disputed before', `${history.priorDisputes} ${history.priorDisputes === 1 ? 'dispute' : 'disputes'} on ${history.priorOrders} earlier ${history.priorOrders === 1 ? 'order' : 'orders'}`)
  }

  if (history.ordersLast24h > 1) {
    add('VELOCITY_SPIKE', 'Several orders in 24 hours', `${history.ordersLast24h} orders from this buyer in the last 24 hours`)
  }

  if (forwarder && order.shipping?.method === 'express') {
    add('RUSH_TO_FORWARDER', 'Express shipping to a forwarder', 'Express delivery requested to a reshipping address')
  }

  const protection = order.paypal?.sellerProtection?.status
  if (protection && protection !== 'ELIGIBLE') {
    add('SELLER_PROTECTION_GAP', 'PayPal Seller Protection is not full', `Capture reports seller_protection.status = ${protection}`)
  }

  if (order.paypal?.accountStatus === 'UNVERIFIED') {
    add('UNVERIFIED_PAYER', 'Payer PayPal account is unverified', 'payment_source.paypal.account_status = UNVERIFIED')
  }

  const score = Math.min(100, signals.reduce((sum, signal) => sum + signal.points, 0))
  const level = score > 65 ? 'high' : score >= 35 ? 'medium' : 'low'

  return {
    score,
    level,
    signals,
    history,
    baseline: average,
    computedAt: new Date().toISOString(),
    recommendedAction: ruleBasedAction(level, signals),
    explanation: ruleBasedExplanation(level, score, signals),
    explainedBy: 'rules'
  }
}

/** Deterministic fallback copy, used until (or if) the AI explanation arrives. */
function ruleBasedExplanation(level, score, signals) {
  if (!signals.length) return 'No risk signals fired. The buyer, address and order value all look normal for this store.'
  const top = [...signals].sort((a, b) => b.points - a.points).slice(0, 3).map((signal) => signal.label.toLowerCase())
  const lead = level === 'high' ? 'High risk' : level === 'medium' ? 'Moderate risk' : 'Low risk'
  return `${lead} (${score}/100): ${top.join('; ')}.`
}

function ruleBasedAction(level, signals) {
  const codes = new Set(signals.map((signal) => signal.code))
  if (level === 'high') {
    if (codes.has('ADDRESS_MISMATCH') || codes.has('RUSH_TO_FORWARDER')) {
      return 'Hold shipment and confirm the delivery address with the buyer by email before dispatching; ship with signature confirmation.'
    }
    return 'Ship with signature confirmation and photograph the packed item before handing it to the carrier.'
  }
  if (level === 'medium') {
    if (codes.has('PRIOR_DISPUTES')) return 'Ship with tracking and delivery photo, and keep every buyer message in the order record.'
    return 'Ship with tracking and add the tracking number here as soon as the label is printed.'
  }
  return 'Ship normally with tracking. ProofPilot will keep the evidence pack up to date.'
}
