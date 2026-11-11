import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { config } from './config.js'
import { store } from './lib/store.js'
import { requireAuth, purgeExpiredSessions } from './lib/auth.js'
import { storefrontRouter } from './routes/storefront.js'
import { ordersRouter } from './routes/orders.js'
import { disputesRouter } from './routes/disputes.js'
import { authRouter, systemRouter, webhookRouter } from './routes/system.js'
import { paypalStatus, PayPalError } from './services/paypalClient.js'
import { aiStatus } from './services/aiService.js'
import { startDisputeWatcher, runAgent } from './services/disputeService.js'
import { queueExplanation } from './services/orderService.js'

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 1)

const PAYPAL_HOSTS = ['https://*.paypal.com', 'https://*.paypalobjects.com', 'https://*.venmo.com']
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", ...PAYPAL_HOSTS],
      // Inter + Fraunces come from Google Fonts (client/index.html).
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', ...PAYPAL_HOSTS],
      imgSrc: ["'self'", 'data:', 'blob:', ...PAYPAL_HOSTS],
      connectSrc: ["'self'", ...PAYPAL_HOSTS],
      frameSrc: ["'self'", ...PAYPAL_HOSTS],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com', ...PAYPAL_HOSTS],
      formAction: ["'self'", ...PAYPAL_HOSTS],
      objectSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  // PayPal's checkout popup must be able to talk back to this window.
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }
}))

const devOrigin = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/
app.use(cors({
  origin: (origin, callback) => callback(null, !origin || origin === config.clientOrigin || (!config.isProduction && devOrigin.test(origin))),
  credentials: true
}))
app.use(express.json({ limit: '200kb' }))
app.use('/api', rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (req) => req.path === '/events' || req.path === '/paypal/webhook'
}))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), storage: store.backend, paypal: paypalStatus().mode, ai: aiStatus().id || 'rules' })
})

app.use('/api/auth', authRouter)
app.use('/api/store', storefrontRouter)
app.use('/api/paypal/webhook', webhookRouter)
app.use('/api/orders', requireAuth, ordersRouter)
app.use('/api/disputes', requireAuth, disputesRouter)
app.use('/api', systemRouter)
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }))

// Production: serve the built React app from the same origin.
if (fs.existsSync(path.join(config.clientDist, 'index.html'))) {
  app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }))
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(config.clientDist, 'index.html')))
}

// eslint-disable-next-line no-unused-vars
app.use((error, req, res, _next) => {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0]
    const field = issue?.path?.join('.')
    return res.status(400).json({ error: field ? `${field}: ${issue.message}` : issue?.message || 'Invalid input' })
  }
  if (error?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Files must be 10 MB or smaller' })
  if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' })
  if (error instanceof PayPalError) {
    console.warn(`[paypal] ${req.method} ${req.path}: ${error.message} (debug ${error.debugId || 'n/a'})`)
    return res.status(502).json({ error: `PayPal: ${error.message}`, debugId: error.debugId, issue: error.issue })
  }
  if (error?.status && error.status < 500) return res.status(error.status).json({ error: error.message })
  console.error(error)
  return res.status(error?.status || 500).json({ error: error?.status ? error.message : 'Something went wrong on our side' })
})

await store.init()
await purgeExpiredSessions()

// Analyses interrupted by a restart are picked up again.
for (const dispute of store.all('disputes')) {
  if (dispute.workflow === 'analyzing') {
    dispute.workflow = dispute.draft ? 'draft_ready' : 'new'
    await store.put('disputes', dispute)
  }
  if (dispute.workflow === 'new' && dispute.orderId) runAgent(dispute.id)
}
// Orders explained by the rules engine (no key earlier, or a failed AI call) get another try.
if (aiStatus().configured) {
  for (const order of store.all('orders')) if (order.risk?.explainedBy === 'rules' && order.risk.level !== 'low') queueExplanation(order.id)
}

app.listen(config.port, (error) => {
  // Express 5 passes listen errors (e.g. EADDRINUSE) to this callback.
  if (error) {
    console.error(`Could not start on port ${config.port}: ${error.code === 'EADDRINUSE' ? 'the port is already in use (is another ProofPilot server running?)' : error.message}`)
    process.exit(1)
  }
  const ai = aiStatus()
  console.log(`ProofPilot API on http://localhost:${config.port}`)
  console.log(`[paypal] ${paypalStatus().mode === 'sandbox' ? `sandbox connected (${config.paypal.baseUrl})` : 'not configured: live checkout disabled, simulated checkout available'}`)
  console.log(`[ai] ${ai.configured ? `${ai.provider} · ${ai.model}` : 'no GEMINI_API_KEY or ANTHROPIC_API_KEY: deterministic rules engine'}`)
  startDisputeWatcher()
})
