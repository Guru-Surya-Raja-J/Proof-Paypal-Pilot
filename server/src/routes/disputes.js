import { Router } from 'express'
import { z } from 'zod'
import { store } from '../lib/store.js'
import {
  analyze,
  updateDraft,
  submit,
  previewSubmission,
  syncDisputes,
  refreshFromPayPal,
  sandboxRequireEvidence,
  disputeView,
  disputeSyncStatus
} from '../services/disputeService.js'

export const disputesRouter = Router()

function loadDispute(req) {
  const dispute = store.get('disputes', req.params.disputeId)
  if (!dispute) throw Object.assign(new Error('Dispute not found'), { status: 404 })
  return dispute
}

disputesRouter.get('/', (_req, res) => {
  const disputes = store.all('disputes').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(disputeView)
  res.json({ disputes, sync: disputeSyncStatus() })
})

disputesRouter.post('/sync', async (_req, res) => {
  res.json({ sync: await syncDisputes() })
})

disputesRouter.get('/:disputeId', (req, res) => {
  const dispute = loadDispute(req)
  const order = dispute.orderId ? store.get('orders', dispute.orderId) : null
  res.json({ dispute: disputeView(dispute), order, preview: previewSubmission(dispute.id) })
})

disputesRouter.post('/:disputeId/analyze', async (req, res) => {
  const dispute = await analyze(loadDispute(req).id)
  res.json({ dispute: disputeView(dispute) })
})

disputesRouter.put('/:disputeId/draft', async (req, res) => {
  const { text } = z.object({ text: z.string().trim().min(40, 'The response is too short').max(2000, 'PayPal accepts at most 2000 characters') }).parse(req.body)
  const dispute = await updateDraft(loadDispute(req).id, text)
  res.json({ dispute: disputeView(dispute) })
})

disputesRouter.post('/:disputeId/submit', async (req, res) => {
  const dispute = await submit(loadDispute(req).id)
  res.json({ dispute: disputeView(dispute) })
})

disputesRouter.post('/:disputeId/refresh', async (req, res) => {
  const dispute = await refreshFromPayPal(loadDispute(req).id)
  res.json({ dispute: disputeView(dispute) })
})

disputesRouter.post('/:disputeId/sandbox/require-evidence', async (req, res) => {
  const dispute = await sandboxRequireEvidence(loadDispute(req).id)
  res.json({ dispute: disputeView(dispute) })
})
