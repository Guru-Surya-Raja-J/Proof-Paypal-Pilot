import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rootDir = path.resolve(serverDir, '..')

// server/.env wins over the repo-root .env; real environment variables win over both.
dotenv.config({ path: [path.join(serverDir, '.env'), path.join(rootDir, '.env')], quiet: true })

const env = (key, fallback = '') => (process.env[key] ?? fallback).toString().trim()
const int = (key, fallback) => {
  const value = Number.parseInt(env(key), 10)
  return Number.isFinite(value) ? value : fallback
}

/**
 * PayPal's REST API lives on api-m.* hosts. The website hosts (sandbox.paypal.com,
 * www.paypal.com) are an easy copy-paste mistake that makes every OAuth call fail
 * with "Client Authentication failed", so they are corrected here with a warning.
 */
function paypalApiBase(raw) {
  const value = (raw || 'https://api-m.sandbox.paypal.com').replace(/\/$/, '')
  const fixes = {
    'https://sandbox.paypal.com': 'https://api-m.sandbox.paypal.com',
    'https://www.sandbox.paypal.com': 'https://api-m.sandbox.paypal.com',
    'https://api.sandbox.paypal.com': 'https://api-m.sandbox.paypal.com',
    'https://paypal.com': 'https://api-m.paypal.com',
    'https://www.paypal.com': 'https://api-m.paypal.com',
    'https://api.paypal.com': 'https://api-m.paypal.com'
  }
  if (fixes[value]) {
    console.warn(`[config] PAYPAL_BASE_URL=${value} is not the REST API host; using ${fixes[value]}`)
    return fixes[value]
  }
  return value
}

const paypalClientId = env('PAYPAL_CLIENT_ID')
const paypalSecret = env('PAYPAL_CLIENT_SECRET')
const paypalForcedMock = env('PAYPAL_MODE').toLowerCase() === 'mock'

export const config = {
  rootDir,
  dataDir: env('DATA_DIR') ? path.resolve(env('DATA_DIR')) : path.join(rootDir, '.data'),
  clientDist: path.join(rootDir, 'client', 'dist'),
  port: int('PORT', 4000),
  isProduction: env('NODE_ENV') === 'production',
  clientOrigin: env('CLIENT_ORIGIN', 'http://localhost:5173'),
  publicUrl: env('PUBLIC_URL').replace(/\/$/, ''),
  mongoUri: env('MONGODB_URI'),

  auth: {
    email: env('DEMO_EMAIL', 'merchant@proofpilot.local').toLowerCase(),
    password: env('DEMO_PASSWORD', 'change-me-before-demo'),
    sessionHours: 8
  },

  merchant: {
    name: env('MERCHANT_NAME', 'Shikimori Handmade Goods'),
    supportEmail: env('MERCHANT_SUPPORT_EMAIL', 'support@shikimorihandmade.example'),
    shipFrom: env('MERCHANT_SHIP_FROM', 'Austin, TX, US'),
    currency: 'USD'
  },

  paypal: {
    clientId: paypalClientId,
    clientSecret: paypalSecret,
    baseUrl: paypalApiBase(env('PAYPAL_BASE_URL')),
    webhookId: env('PAYPAL_WEBHOOK_ID'),
    live: Boolean(paypalClientId && paypalSecret) && !paypalForcedMock,
    disputePollSeconds: int('DISPUTE_POLL_SECONDS', 120)
  },

  ai: resolveAi()
}

/**
 * AI provider selection. Gemini is used when GEMINI_API_KEY (or GOOGLE_API_KEY)
 * is set, Claude when ANTHROPIC_API_KEY is set; AI_PROVIDER forces one of them.
 * With neither, the deterministic rules engine runs.
 */
function resolveAi() {
  const geminiKey = env('GEMINI_API_KEY') || env('GOOGLE_API_KEY')
  const anthropicKey = env('ANTHROPIC_API_KEY')
  const forced = env('AI_PROVIDER').toLowerCase()
  const provider = forced === 'gemini' || forced === 'claude'
    ? forced
    : geminiKey ? 'gemini' : anthropicKey ? 'claude' : null
  if (provider === 'gemini') {
    // Free-tier Gemini keys allow ~5 requests/minute; raise AI_REQUESTS_PER_MINUTE on a paid key.
    return { provider, apiKey: geminiKey, model: env('GEMINI_MODEL', 'gemini-2.5-flash'), label: 'Google Gemini', requestsPerMinute: int('AI_REQUESTS_PER_MINUTE', 5) }
  }
  if (provider === 'claude') {
    return { provider, apiKey: anthropicKey, model: env('LLM_MODEL', 'claude-opus-5-5'), label: 'Anthropic Claude', requestsPerMinute: int('AI_REQUESTS_PER_MINUTE', 50) }
  }
  return { provider: null, apiKey: '', model: null, label: 'None', requestsPerMinute: 0 }
}
