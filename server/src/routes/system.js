import { Router } from 'express'
import { z } from 'zod'
import { config } from '../config.js'
import { store } from '../lib/store.js'
import { eventsHandler, logActivity } from '../lib/events.js'
import { login, logout, currentUser, requireAuth } from '../lib/auth.js'
import { computeMetrics } from '../services/metricsService.js'
import { aiStatus } from '../services/aiService.js'
import * as paypal from '../services/paypalClient.js'
import { handleWebhook, disputeSyncStatus } from '../services/disputeService.js'
import { loadDemoScenario, resetWorkspace } from '../services/checkoutService.js'

export const authRouter = Router()
export const systemRouter = Router()
export const webhookRouter = Router()

/* ------------------------------------------------------------------- auth */

authRouter.post('/login', async (req, res) => {
  const { email, password } = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(200) }).parse(req.body)
  const result = await login(req, res, { email, password })
  if (result.status !== 200) return res.status(result.status).json({ error: result.error })
  res.json({ user: result.user })
})

authRouter.post('/logout', async (req, res) => {
  await logout(req, res)
  res.status(204).end()
})

// "Not signed in" is a normal answer here (buyers on the storefront never are),
// so it is a 200 with user: null rather than an error status in every console.
authRouter.get('/me', (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ user: currentUser(req) })
})

/* --------------------------------------------------------------- webhook */

// PayPal posts here. The signature is verified with PayPal before anything is trusted.
webhookRouter.post('/', async (req, res) => {
  const event = req.body
  if (!paypal.paypalEnabled() || !config.paypal.webhookId) {
    return res.status(503).json({ error: 'Webhook receiver is not configured' })
  }
  let verified = false
  try {
    verified = await paypal.verifyWebhookSignature(req.headers, event)
  } catch (error) {
    console.warn('[webhook] Verification call failed:', error.message)
  }
  if (!verified) return res.status(400).json({ error: 'Signature verification failed' })
  const result = await handleWebhook(event)
  res.json({ received: true, ...result })
})

/* ---------------------------------------------------------------- system */

systemRouter.use(requireAuth)

systemRouter.get('/events', eventsHandler)

systemRouter.get('/metrics', (_req, res) => res.json(computeMetrics()))

systemRouter.get('/activity', (req, res) => {
  const limit = Math.min(100, Number(req.query.limit) || 40)
  const activity = store.all('activity').sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
  res.json({ activity })
})

systemRouter.get('/integrations', async (_req, res) => {
  let webhooks = null
  if (paypal.paypalEnabled()) {
    try {
      webhooks = (await paypal.listWebhooks()).map((hook) => ({ id: hook.id, url: hook.url, events: hook.event_types.map((type) => type.name) }))
    } catch (error) {
      webhooks = { error: error.message }
    }
  }
  res.json({
    paypal: paypal.paypalStatus(),
    webhooks,
    webhookUrl: config.publicUrl ? `${config.publicUrl}/api/paypal/webhook` : null,
    disputeSync: disputeSyncStatus(),
    pollSeconds: config.paypal.disputePollSeconds,
    ai: aiStatus(),
    storage: { backend: store.backend },
    merchant: config.merchant
  })
})

systemRouter.post('/integrations/paypal/test', async (_req, res) => {
  try {
    res.json({ ok: true, connection: await paypal.testConnection() })
  } catch (error) {
    res.status(502).json({ ok: false, error: error.message })
  }
})

systemRouter.post('/integrations/paypal/webhook', async (_req, res) => {
  if (!config.publicUrl) return res.status(400).json({ error: 'Set PUBLIC_URL to the public https address of this server first' })
  if (!config.publicUrl.startsWith('https://')) return res.status(400).json({ error: 'PayPal requires an https webhook URL' })
  const url = `${config.publicUrl}/api/paypal/webhook`
  const existing = (await paypal.listWebhooks()).find((hook) => hook.url === url)
  const webhook = existing || await paypal.createWebhook(url)
  await logActivity({ action: existing ? 'Webhook already registered' : 'Registered PayPal webhook', target: url, detail: `Webhook id ${webhook.id}. Set PAYPAL_WEBHOOK_ID=${webhook.id} so events can be verified.`, kind: 'paypal' })
  res.json({ webhook: { id: webhook.id, url: webhook.url }, existing: Boolean(existing), verificationConfigured: config.paypal.webhookId === webhook.id })
})

systemRouter.post('/workspace/demo', async (_req, res) => {
  if (store.all('orders').some((order) => order.source === 'demo')) {
    return res.status(409).json({ error: 'The demo scenario is already loaded. Reset the workspace first.' })
  }
  await loadDemoScenario()
  res.status(201).json({ ok: true })
})

systemRouter.post('/workspace/reset', async (_req, res) => {
  await resetWorkspace()
  await logActivity({ action: 'Workspace reset', target: 'All orders and disputes cleared', kind: 'info' })
  res.json({ ok: true })
})
