/**
 * Dashboard metrics. Everything is computed from stored records; the only
 * assumption (manual case-building time) is labelled as an estimate.
 */
import { store } from '../lib/store.js'

export const MANUAL_CASE_MINUTES_ESTIMATE = 40
const HOLD_THRESHOLD_PERCENT = 1

export function computeMetrics() {
  const orders = store.all('orders')
  const disputes = store.all('disputes')
  const now = Date.now()
  const last30 = orders.filter((order) => now - new Date(order.createdAt).getTime() < 30 * 86400_000)

  const open = disputes.filter((dispute) => !['submitted', 'resolved'].includes(dispute.workflow) && !dispute.outcome)
  const built = disputes.filter((dispute) => typeof dispute.metrics?.buildMs === 'number')
  const avgBuildMs = built.length ? Math.round(built.reduce((sum, dispute) => sum + dispute.metrics.buildMs, 0) / built.length) : null

  const disputedOrderIds = new Set(disputes.map((dispute) => dispute.orderId).filter(Boolean))
  const completeAtDispute = disputes.filter((dispute) => dispute.analysis && dispute.analysis.missingEvidence.length === 0)
  const analysed = disputes.filter((dispute) => dispute.analysis)

  const disputeRate = last30.length ? (disputes.filter((dispute) => last30.some((order) => order.id === dispute.orderId)).length / last30.length) * 100 : 0
  const highRisk = orders.filter((order) => order.risk.level === 'high')
  const unshippedHighRisk = highRisk.filter((order) => order.fulfillment.status === 'unfulfilled')

  // Hold early-warning (F8): dispute ratio vs 1%, plus volume spike in the last 7 days.
  const last7 = orders.filter((order) => now - new Date(order.createdAt).getTime() < 7 * 86400_000).length
  const prior21 = orders.filter((order) => {
    const age = now - new Date(order.createdAt).getTime()
    return age >= 7 * 86400_000 && age < 28 * 86400_000
  }).length
  const weeklyBaseline = prior21 / 3
  const volumeSpike = weeklyBaseline >= 2 && last7 > weeklyBaseline * 2
  const holdSignals = []
  if (disputeRate > HOLD_THRESHOLD_PERCENT) holdSignals.push(`Dispute rate ${disputeRate.toFixed(1)}% is above PayPal's ~${HOLD_THRESHOLD_PERCENT}% comfort level`)
  if (volumeSpike) holdSignals.push(`Order volume this week (${last7}) is more than double the recent weekly average (${weeklyBaseline.toFixed(1)})`)
  if (open.length >= 3) holdSignals.push(`${open.length} disputes are open at the same time`)
  const holdRisk = holdSignals.length >= 2 || disputeRate > HOLD_THRESHOLD_PERCENT * 2 ? 'high' : holdSignals.length === 1 ? 'medium' : 'low'

  return {
    orders: {
      total: orders.length,
      last30: last30.length,
      volume: Math.round(orders.reduce((sum, order) => sum + order.total, 0) * 100) / 100,
      live: orders.filter((order) => order.source === 'paypal').length,
      averageEvidence: orders.length ? Math.round(orders.reduce((sum, order) => sum + order.evidence.percent, 0) / orders.length) : 0,
      highRisk: highRisk.length,
      unshippedHighRisk: unshippedHighRisk.length,
      needsTracking: orders.filter((order) => order.fulfillment.status === 'unfulfilled').length
    },
    disputes: {
      total: disputes.length,
      open: open.length,
      amountAtRisk: Math.round(open.reduce((sum, dispute) => sum + (dispute.amount || 0), 0) * 100) / 100,
      submitted: disputes.filter((dispute) => dispute.submission?.ok).length,
      wonByOutcome: disputes.filter((dispute) => dispute.outcome === 'RESOLVED_SELLER_FAVOUR').length,
      lostByOutcome: disputes.filter((dispute) => dispute.outcome === 'RESOLVED_BUYER_FAVOUR').length,
      completeEvidenceRate: analysed.length ? Math.round((completeAtDispute.length / analysed.length) * 100) : null,
      disputedOrders: disputedOrderIds.size
    },
    caseBuilding: {
      averageMs: avgBuildMs,
      measuredCases: built.length,
      manualMinutesEstimate: MANUAL_CASE_MINUTES_ESTIMATE,
      note: `Manual time is an estimate (~${MANUAL_CASE_MINUTES_ESTIMATE} min to gather receipts, tracking and messages and write a reply). ProofPilot time is measured from dispute ingestion to draft ready.`
    },
    hold: {
      risk: holdRisk,
      disputeRate: Math.round(disputeRate * 10) / 10,
      threshold: HOLD_THRESHOLD_PERCENT,
      signals: holdSignals,
      window: '30 days'
    }
  }
}
