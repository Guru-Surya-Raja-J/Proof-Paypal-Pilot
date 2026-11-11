/**
 * Dispute lifecycle.
 *
 * Sources:
 *  - 'paypal'    real sandbox disputes, ingested via webhook or Disputes API sync
 *  - 'simulated' demo disputes created from the console (clearly labelled; the
 *                sandbox has no API to open a dispute on the buyer's behalf)
 *
 * When a dispute arrives the agent immediately runs gap analysis and drafts a
 * cited response (no click needed); the merchant reviews, edits and submits.
 */
import { config } from '../config.js'
import { store } from '../lib/store.js'
import { emit, logActivity } from '../lib/events.js'
import { analyzeDispute, reasonInfo, validateDraft } from './aiService.js'
import { refreshOrder, refreshBuyerOrders, shortId } from './orderService.js'
import * as paypal from './paypalClient.js'

const nowIso = () => new Date().toISOString()
const SIMULATED_RESPONSE_DAYS = 10
const MAX_EVIDENCE_BYTES = 50 * 1024 * 1024

const pushTimeline = (dispute, event, note, kind = 'info') => {
  dispute.timeline.push({ at: nowIso(), event, note, kind })
}

async function save(dispute) {
  dispute.updatedAt = nowIso()
  await store.put('disputes', dispute)
  emit('dispute', { id: dispute.id })
  return dispute
}

const findByPayPalId = (paypalDisputeId) => store.all('disputes').find((dispute) => dispute.paypalDisputeId === paypalDisputeId)
const findOrderByCapture = (captureId) => captureId && store.all('orders').find((order) => order.paypal?.captureId === captureId)

/* ------------------------------------------------------------------ create */

export async function createSimulatedDispute(order, { reason, buyerMessage }) {
  const openedAt = nowIso()
  const dispute = {
    id: shortId('dsp'),
    source: 'simulated',
    paypalDisputeId: `SIM-${order.number}-${Date.now().toString(36).toUpperCase()}`,
    orderId: order.id,
    reason,
    status: 'WAITING_FOR_SELLER_RESPONSE',
    stage: 'INQUIRY',
    amount: order.total,
    currency: order.currency,
    openedAt,
    responseDueAt: new Date(Date.now() + SIMULATED_RESPONSE_DAYS * 86400_000).toISOString(),
    buyerMessage: buyerMessage || null,
    allowedActions: ['provide_evidence'],
    workflow: 'new',
    analysis: null,
    draft: null,
    submission: null,
    outcome: null,
    metrics: { ingestedAt: openedAt },
    timeline: [],
    createdAt: openedAt,
    updatedAt: openedAt
  }
  pushTimeline(dispute, 'Dispute opened (simulation)', `${reasonInfo(reason).label} on order #${order.number}. Simulated because the PayPal sandbox cannot open disputes through the API.`, 'warning')
  pushTimeline(dispute, 'Evidence pack retrieved', `Pre-built pack at ${order.evidence.percent}% completeness.`)
  await save(dispute)
  await logActivity({
    action: 'Ingested dispute (simulated)',
    target: `Order #${order.number}`,
    detail: `${reasonInfo(reason).label} · ${order.currency} ${order.total.toFixed(2)}`,
    kind: 'warning',
    ref: { type: 'dispute', id: dispute.id }
  })
  await refreshBuyerOrders(order)
  runAgent(dispute.id)
  return dispute
}

function mapPayPalDispute(raw) {
  const transaction = raw.disputed_transactions?.[0] || {}
  return {
    paypalDisputeId: raw.dispute_id,
    reason: raw.reason || 'OTHER',
    status: raw.status,
    stage: raw.dispute_life_cycle_stage || null,
    channel: raw.dispute_channel || null,
    amount: Number(raw.dispute_amount?.value ?? transaction.gross_amount?.value ?? 0),
    currency: raw.dispute_amount?.currency_code || 'USD',
    openedAt: raw.create_time,
    responseDueAt: raw.seller_response_due_date || null,
    captureId: transaction.seller_transaction_id || null,
    buyerMessage: (raw.messages || []).find((message) => message.posted_by === 'BUYER')?.content || null,
    messages: (raw.messages || []).map((message) => ({ by: message.posted_by, at: message.time_posted, content: message.content })),
    allowedActions: (raw.links || []).map((link) => link.rel).filter((rel) => rel !== 'self'),
    outcome: raw.dispute_outcome?.outcome_code || null,
    paypalUpdatedAt: raw.update_time
  }
}

/** Creates or updates a dispute record from a PayPal dispute object. */
export async function upsertPayPalDispute(raw, via) {
  const mapped = mapPayPalDispute(raw)
  const existing = findByPayPalId(mapped.paypalDisputeId)
  const order = findOrderByCapture(mapped.captureId)

  if (existing) {
    const statusChanged = existing.status !== mapped.status
    const outcomeChanged = mapped.outcome && existing.outcome !== mapped.outcome
    Object.assign(existing, mapped, { orderId: existing.orderId || order?.id || null })
    if (statusChanged) pushTimeline(existing, 'PayPal status changed', `Status is now ${mapped.status}${mapped.stage ? ` (${mapped.stage})` : ''}.`, 'paypal')
    if (outcomeChanged) {
      existing.workflow = 'resolved'
      pushTimeline(existing, 'Dispute resolved by PayPal', `Outcome: ${mapped.outcome}.`, mapped.outcome === 'RESOLVED_SELLER_FAVOUR' ? 'success' : 'warning')
      await logActivity({
        action: 'Dispute resolved',
        target: existing.orderId ? `Order #${store.get('orders', existing.orderId)?.number}` : mapped.paypalDisputeId,
        detail: mapped.outcome,
        kind: mapped.outcome === 'RESOLVED_SELLER_FAVOUR' ? 'success' : 'warning',
        ref: { type: 'dispute', id: existing.id }
      })
    }
    if (statusChanged || outcomeChanged) await save(existing)
    return { dispute: existing, created: false }
  }

  const at = nowIso()
  const dispute = {
    id: shortId('dsp'),
    source: 'paypal',
    orderId: order?.id || null,
    ...mapped,
    workflow: mapped.outcome ? 'resolved' : 'new',
    analysis: null,
    draft: null,
    submission: null,
    metrics: { ingestedAt: at },
    timeline: [],
    createdAt: at,
    updatedAt: at
  }
  pushTimeline(dispute, 'Dispute received from PayPal', `${reasonInfo(dispute.reason).label} · ${dispute.paypalDisputeId} · via ${via}.`, 'paypal')
  if (order) pushTimeline(dispute, 'Matched to order', `Capture ${mapped.captureId} → order #${order.number}; evidence pack at ${order.evidence.percent}%.`)
  else pushTimeline(dispute, 'No matching order', `Capture ${mapped.captureId || 'unknown'} was not processed through ProofPilot, so there is no pre-built evidence pack.`, 'warning')
  await save(dispute)
  await logActivity({
    action: 'Ingested PayPal dispute',
    target: order ? `Order #${order.number}` : dispute.paypalDisputeId,
    detail: `${reasonInfo(dispute.reason).label} · ${dispute.currency} ${dispute.amount.toFixed(2)} · via ${via}`,
    kind: 'paypal',
    ref: { type: 'dispute', id: dispute.id }
  })
  if (order) {
    await refreshBuyerOrders(order)
    if (dispute.workflow === 'new') runAgent(dispute.id)
  }
  return { dispute, created: true }
}

/* ------------------------------------------------------------------- agent */

const running = new Set()

/** Autonomous step: analyse the gap and draft the response as soon as a dispute lands. */
export function runAgent(disputeId) {
  if (running.has(disputeId)) return
  running.add(disputeId)
  analyze(disputeId, { auto: true })
    .catch((error) => console.error(`[agent] Analysis failed for ${disputeId}:`, error))
    .finally(() => running.delete(disputeId))
}

export const isAnalyzing = (disputeId) => running.has(disputeId)

export async function analyze(disputeId, { auto = false } = {}) {
  const dispute = store.get('disputes', disputeId)
  if (!dispute) throw Object.assign(new Error('Dispute not found'), { status: 404 })
  const order = store.get('orders', dispute.orderId)
  if (!order) throw Object.assign(new Error('This dispute is not linked to a ProofPilot order'), { status: 409 })

  dispute.workflow = 'analyzing'
  await save(dispute)

  await refreshOrder(order, { explain: false })
  const startedAt = Date.now()
  const result = await analyzeDispute(dispute, order, order.evidence, config.merchant.name)
  const ms = Date.now() - startedAt

  dispute.analysis = { ...result.analysis, evidencePercent: order.evidence.percent, analyzedAt: nowIso(), ms }
  dispute.draft = { ...result.draft, generatedAt: nowIso(), editedAt: null }
  dispute.workflow = dispute.submission?.ok ? 'submitted' : 'draft_ready'
  if (!dispute.metrics.draftReadyAt) {
    dispute.metrics.draftReadyAt = nowIso()
    dispute.metrics.buildMs = Date.now() - new Date(dispute.metrics.ingestedAt).getTime()
  }
  if (result.aiError) dispute.analysis.aiError = result.aiError

  const by = result.analysis.generatedBy === 'rules' ? 'rules engine' : `${result.analysis.generatedBy === 'gemini' ? 'Gemini' : 'Claude'} (${result.analysis.model})`
  pushTimeline(dispute, 'Gap analysis complete', `${result.analysis.haveEvidence.length}/${result.analysis.requiredEvidence.length} required evidence types on file · win likelihood ${result.analysis.winLikelihood} · ${by}${result.aiError ? ` (AI unavailable: ${result.aiError})` : ''}.`, 'ai')
  pushTimeline(dispute, 'Response drafted', `${result.draft.citedEvidenceIds.length} evidence citations, all verified against the pack.`, 'ai')
  await save(dispute)

  await logActivity({
    action: auto ? 'Drafted dispute response automatically' : 'Re-drafted dispute response',
    target: `Order #${order.number}`,
    detail: `Win likelihood ${result.analysis.winLikelihood} · ${result.draft.citedEvidenceIds.length} citations · ${(ms / 1000).toFixed(1)}s · ${by}`,
    kind: 'ai',
    ref: { type: 'dispute', id: dispute.id }
  })
  return dispute
}

export async function updateDraft(disputeId, text) {
  const dispute = store.get('disputes', disputeId)
  if (!dispute?.draft) throw Object.assign(new Error('No draft to edit yet'), { status: 409 })
  if (dispute.submission?.ok) throw Object.assign(new Error('This response was already submitted'), { status: 409 })
  const order = store.get('orders', dispute.orderId)
  const citedEvidenceIds = [...new Set([...text.matchAll(/\[(EV-[A-Z0-9-]+)\]/g)].map((match) => match[1]))]
  const problems = validateDraft({ text, citedEvidenceIds }, order.evidence)
  if (problems.length) throw Object.assign(new Error(problems.join('; ')), { status: 422 })
  dispute.draft = { ...dispute.draft, text, citedEvidenceIds, editedAt: nowIso() }
  pushTimeline(dispute, 'Draft edited by merchant', `${text.length} characters, ${citedEvidenceIds.length} citations re-verified.`)
  return save(dispute)
}

/* ------------------------------------------------------------------ submit */

function buildPayPalEvidence(dispute, order) {
  const cited = new Set(dispute.draft.citedEvidenceIds)
  const items = order.evidence.items.filter((item) => item.present && cited.has(item.id))
  const fileIds = [...new Set(items.flatMap((item) => item.files))]
  const files = order.attachments.filter((file) => fileIds.includes(file.id))
  const fileNames = (item) => order.attachments.filter((file) => item.files.includes(file.id)).map((file) => ({ name: file.name }))

  const evidences = []
  const tracking = items.find((item) => item.type === 'tracking')
  if (tracking) {
    const code = tracking.data.carrierCode
    evidences.push({
      evidence_type: 'PROOF_OF_FULFILLMENT',
      evidence_info: {
        tracking_info: [{
          carrier_name: code,
          ...(code === 'OTHER' ? { carrier_name_other: tracking.data.carrier } : {}),
          tracking_number: tracking.data.trackingNumber
        }]
      },
      documents: fileNames(tracking)
    })
  }
  const delivery = items.find((item) => item.type === 'delivery_confirmation')
  if (delivery?.data.signedBy && delivery.files.length) {
    evidences.push({ evidence_type: 'PROOF_OF_DELIVERY_SIGNATURE', documents: fileNames(delivery) })
  }
  const covered = new Set(evidences.flatMap((evidence) => evidence.documents.map((doc) => doc.name)))
  const remaining = files.filter((file) => !covered.has(file.name))
  if (!evidences.length || remaining.length) {
    evidences.push({ evidence_type: 'OTHER', documents: remaining.map((file) => ({ name: file.name })) })
  }
  evidences[0].notes = dispute.draft.text
  for (const evidence of evidences) if (!evidence.documents.length) delete evidence.documents
  return { evidences, files }
}

export async function submit(disputeId) {
  const dispute = store.get('disputes', disputeId)
  if (!dispute?.draft) throw Object.assign(new Error('Generate a draft before submitting'), { status: 409 })
  if (dispute.submission?.ok) throw Object.assign(new Error('This response was already submitted'), { status: 409 })
  const order = store.get('orders', dispute.orderId)
  const problems = validateDraft(dispute.draft, order.evidence)
  if (problems.length) throw Object.assign(new Error(`Draft failed the citation check: ${problems.join('; ')}`), { status: 422 })

  const { evidences, files } = buildPayPalEvidence(dispute, order)
  const attempt = {
    at: nowIso(),
    evidenceTypes: evidences.map((evidence) => evidence.evidence_type),
    files: files.map((file) => file.name),
    characters: dispute.draft.text.length
  }

  if (dispute.source === 'paypal') {
    const buffers = []
    let total = 0
    for (const file of files) {
      const buffer = await store.readFile(file.id)
      if (!buffer) continue
      total += buffer.length
      buffers.push({ name: file.name, mime: file.mime, buffer })
    }
    if (total > MAX_EVIDENCE_BYTES) throw Object.assign(new Error('Evidence files exceed PayPal\'s 50 MB limit'), { status: 413 })
    try {
      const { data, debugId } = await paypal.provideEvidence(dispute.paypalDisputeId, { evidences, files: buffers })
      dispute.submission = { ...attempt, ok: true, mode: 'paypal_sandbox', debugId, response: data?.links ? 'ACCEPTED' : data }
      dispute.workflow = 'submitted'
      pushTimeline(dispute, 'Evidence submitted to PayPal', `provide-evidence accepted · ${attempt.evidenceTypes.join(', ')} · ${buffers.length} ${buffers.length === 1 ? 'file' : 'files'} · debug id ${debugId}.`, 'success')
      await save(dispute)
      await logActivity({
        action: 'Submitted evidence to PayPal',
        target: `Order #${order.number}`,
        detail: `${dispute.paypalDisputeId} · ${attempt.evidenceTypes.join(', ')}`,
        kind: 'paypal',
        ref: { type: 'dispute', id: dispute.id }
      })
      refreshFromPayPal(dispute.id).catch(() => {})
      return dispute
    } catch (error) {
      dispute.submission = { ...attempt, ok: false, mode: 'paypal_sandbox', error: error.message, issue: error.issue, debugId: error.debugId }
      pushTimeline(dispute, 'PayPal rejected the submission', `${error.message}${error.issue ? ` (${error.issue})` : ''}${error.debugId ? ` · debug id ${error.debugId}` : ''}`, 'danger')
      await save(dispute)
      throw Object.assign(new Error(`PayPal rejected the evidence: ${error.message}`), { status: 502 })
    }
  }

  dispute.submission = { ...attempt, ok: true, mode: 'simulated', response: 'Recorded locally. Simulated disputes do not exist in PayPal, so nothing was sent.' }
  dispute.workflow = 'submitted'
  pushTimeline(dispute, 'Response filed (simulation)', `Payload prepared exactly as it would be sent to provide-evidence: ${attempt.evidenceTypes.join(', ')}, ${files.length} ${files.length === 1 ? 'file' : 'files'}. Not sent, because this dispute is simulated.`, 'warning')
  await save(dispute)
  await logActivity({
    action: 'Filed dispute response (simulation)',
    target: `Order #${order.number}`,
    detail: `${attempt.evidenceTypes.map((t) => t.toLowerCase().replace(/_/g, ' ')).join(', ')} · ${dispute.draft.citedEvidenceIds.length} citations`,
    kind: 'success',
    ref: { type: 'dispute', id: dispute.id }
  })
  return dispute
}

/** Shows the exact payload that submit() would send, for the review screen. */
export function previewSubmission(disputeId) {
  const dispute = store.get('disputes', disputeId)
  if (!dispute?.draft) return null
  const order = store.get('orders', dispute.orderId)
  const { evidences, files } = buildPayPalEvidence(dispute, order)
  return { endpoint: `POST /v1/customer/disputes/${dispute.paypalDisputeId}/provide-evidence`, input: { evidences }, files: files.map(({ name, mime, size }) => ({ name, mime, size })) }
}

/* ------------------------------------------------------------- PayPal sync */

export async function refreshFromPayPal(disputeId) {
  const dispute = store.get('disputes', disputeId)
  if (!dispute || dispute.source !== 'paypal') return dispute
  const raw = await paypal.getDispute(dispute.paypalDisputeId)
  return (await upsertPayPalDispute(raw, 'refresh')).dispute
}

export async function sandboxRequireEvidence(disputeId) {
  const dispute = store.get('disputes', disputeId)
  if (!dispute || dispute.source !== 'paypal') throw Object.assign(new Error('Only PayPal sandbox disputes can be escalated'), { status: 400 })
  await paypal.sandboxRequireEvidence(dispute.paypalDisputeId)
  pushTimeline(dispute, 'Sandbox: evidence requested', 'Moved the sandbox dispute into the seller-evidence stage (sandbox-only API).', 'paypal')
  await save(dispute)
  return refreshFromPayPal(disputeId)
}

let lastSync = null

export async function syncDisputes() {
  if (!paypal.paypalEnabled()) throw Object.assign(new Error('PayPal sandbox is not configured'), { status: 503 })
  const startTime = new Date(Date.now() - 180 * 86400_000).toISOString()
  const items = await paypal.listDisputes({ startTime })
  let created = 0
  let updated = 0
  for (const item of items) {
    const existing = findByPayPalId(item.dispute_id)
    if (existing && existing.paypalUpdatedAt === item.update_time) continue
    const raw = await paypal.getDispute(item.dispute_id)
    const result = await upsertPayPalDispute(raw, 'Disputes API sync')
    if (result.created) created += 1
    else updated += 1
  }
  lastSync = { at: nowIso(), found: items.length, created, updated }
  emit('sync', lastSync)
  return lastSync
}

export const disputeSyncStatus = () => lastSync

export function startDisputeWatcher() {
  if (!paypal.paypalEnabled() || config.paypal.disputePollSeconds <= 0) return
  const tick = () => syncDisputes().catch((error) => {
    lastSync = { at: nowIso(), error: error.message }
    console.warn('[watcher] Dispute sync failed:', error.message)
  })
  setTimeout(tick, 5_000)
  setInterval(tick, config.paypal.disputePollSeconds * 1000).unref()
  console.log(`[watcher] Polling PayPal disputes every ${config.paypal.disputePollSeconds}s`)
}

/* -------------------------------------------------------------- webhooks */

export async function handleWebhook(event) {
  const type = event.event_type || ''
  if (type.startsWith('CUSTOMER.DISPUTE.')) {
    const id = event.resource?.dispute_id
    if (!id) return { handled: false }
    const raw = await paypal.getDispute(id).catch(() => event.resource)
    await upsertPayPalDispute(raw, `webhook ${type}`)
    return { handled: true }
  }
  if (type === 'PAYMENT.CAPTURE.REFUNDED' || type === 'PAYMENT.CAPTURE.REVERSED') {
    const captureId = type === 'PAYMENT.CAPTURE.REVERSED'
      ? event.resource?.id
      : event.resource?.links?.find((link) => link.rel === 'up')?.href?.split('/').pop()
    const order = findOrderByCapture(captureId)
    if (order) {
      order.flags[type === 'PAYMENT.CAPTURE.REFUNDED' ? 'refunded' : 'reversed'] = nowIso()
      await refreshOrder(order, { explain: false })
      await logActivity({
        action: type === 'PAYMENT.CAPTURE.REFUNDED' ? 'Payment refunded' : 'Payment reversed',
        target: `Order #${order.number}`,
        detail: `PayPal webhook ${type}`,
        kind: 'warning',
        ref: { type: 'order', id: order.id }
      })
    }
    return { handled: Boolean(order) }
  }
  return { handled: false }
}

export function disputeView(dispute) {
  const order = dispute.orderId ? store.get('orders', dispute.orderId) : null
  return {
    ...dispute,
    reasonLabel: reasonInfo(dispute.reason).label,
    analyzing: isAnalyzing(dispute.id) || dispute.workflow === 'analyzing',
    order: order ? { id: order.id, number: order.number, buyer: order.buyer, total: order.total, currency: order.currency, evidencePercent: order.evidence.percent } : null
  }
}
