import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { store } from '../lib/store.js'
import { PAYPAL_CARRIERS } from '../services/paypalClient.js'
import {
  addTracking,
  markDelivered,
  addCommunication,
  addAttachment,
  removeAttachment,
  refreshOrder,
  orderSummary,
  ensureBuyerToken,
  MAX_UPLOAD_BYTES
} from '../services/orderService.js'
import { createSimulatedDispute, disputeView } from '../services/disputeService.js'
import { DISPUTE_REASONS } from '../services/aiService.js'
import { ATTACHMENT_KINDS } from '../services/evidenceService.js'

export const ordersRouter = Router()

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } })

function loadOrder(req) {
  const order = store.get('orders', req.params.orderId)
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 })
  return order
}

const trackingSchema = z.object({
  carrier: z.enum(PAYPAL_CARRIERS.map((carrier) => carrier.code)),
  carrierOther: z.string().trim().max(60).optional(),
  trackingNumber: z.string().trim().min(5).max(40).regex(/^[A-Za-z0-9-]+$/, 'Tracking numbers contain only letters, digits and dashes'),
  notifyPayer: z.boolean().optional().default(true)
}).refine((value) => value.carrier !== 'OTHER' || value.carrierOther, { message: 'Name the carrier', path: ['carrierOther'] })

const deliverySchema = z.object({
  deliveredAt: z.iso.datetime().optional(),
  signedBy: z.string().trim().max(80).optional(),
  note: z.string().trim().max(300).optional()
})

const messageSchema = z.object({
  direction: z.enum(['buyer', 'merchant']),
  channel: z.enum(['store', 'email', 'paypal_message', 'chat', 'phone', 'marketplace']),
  body: z.string().trim().min(2).max(2000),
  at: z.iso.datetime().optional()
})

const disputeSchema = z.object({
  reason: z.enum(Object.keys(DISPUTE_REASONS)),
  buyerMessage: z.string().trim().max(1000).optional()
})

ordersRouter.get('/', (_req, res) => {
  const orders = store.all('orders').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(orderSummary)
  res.json({ orders })
})

ordersRouter.get('/meta', (_req, res) => {
  res.json({
    carriers: PAYPAL_CARRIERS,
    disputeReasons: Object.entries(DISPUTE_REASONS).map(([code, info]) => ({ code, label: info.label, required: info.required })),
    attachmentKinds: Object.keys(ATTACHMENT_KINDS)
  })
})

ordersRouter.get('/:orderId', async (req, res) => {
  const order = loadOrder(req)
  await ensureBuyerToken(order)
  const disputes = store.all('disputes').filter((dispute) => dispute.orderId === order.id).map(disputeView)
  res.json({ order, disputes })
})

ordersRouter.post('/:orderId/tracking', async (req, res) => {
  const order = await addTracking(loadOrder(req), trackingSchema.parse(req.body))
  res.json({ order })
})

ordersRouter.post('/:orderId/delivery', async (req, res) => {
  const order = await markDelivered(loadOrder(req), deliverySchema.parse(req.body))
  res.json({ order })
})

ordersRouter.post('/:orderId/messages', async (req, res) => {
  const order = await addCommunication(loadOrder(req), messageSchema.parse(req.body))
  res.json({ order })
})

ordersRouter.post('/:orderId/attachments', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a file to upload' })
  const { kind, note } = z.object({ kind: z.enum(Object.keys(ATTACHMENT_KINDS)), note: z.string().trim().max(200).optional() }).parse(req.body)
  const order = await addAttachment(loadOrder(req), req.file, { kind, note })
  res.status(201).json({ order })
})

ordersRouter.get('/:orderId/attachments/:fileId', async (req, res) => {
  const order = loadOrder(req)
  const file = order.attachments.find((entry) => entry.id === req.params.fileId)
  if (!file) return res.status(404).json({ error: 'Attachment not found' })
  const buffer = await store.readFile(file.id)
  if (!buffer) return res.status(410).json({ error: 'File content is no longer available' })
  res.setHeader('Content-Type', file.mime)
  res.setHeader('Content-Disposition', `inline; filename="${file.name.replace(/"/g, '')}"`)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.send(buffer)
})

ordersRouter.delete('/:orderId/attachments/:fileId', async (req, res) => {
  const order = await removeAttachment(loadOrder(req), req.params.fileId)
  res.json({ order })
})

ordersRouter.post('/:orderId/rescore', async (req, res) => {
  const order = loadOrder(req)
  order.risk.explainedBy = 'rules'
  res.json({ order: await refreshOrder(order) })
})

ordersRouter.post('/:orderId/disputes/simulate', async (req, res) => {
  const dispute = await createSimulatedDispute(loadOrder(req), disputeSchema.parse(req.body))
  res.status(201).json({ dispute: disputeView(dispute) })
})
