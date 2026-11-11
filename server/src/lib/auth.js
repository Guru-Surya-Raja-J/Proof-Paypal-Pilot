/**
 * Single-merchant demo auth: opaque random session tokens stored server-side,
 * delivered in an HttpOnly cookie. Failed logins lock a (ip, email) pair for
 * 15 minutes after 5 attempts.
 */
import crypto from 'node:crypto'
import { config } from '../config.js'
import { store } from './store.js'

const loginFailures = new Map()
const COOKIE = 'proofpilot_session'
const sessionMs = config.auth.sessionHours * 3600_000

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex')

function timingSafeEqualString(a, b) {
  const left = crypto.createHash('sha256').update(a).digest()
  const right = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(left, right)
}

function parseCookies(header = '') {
  const out = {}
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const key = part.slice(0, index).trim()
    try {
      out[key] = decodeURIComponent(part.slice(index + 1).trim())
    } catch {
      out[key] = part.slice(index + 1).trim()
    }
  }
  return out
}

function cookieHeader(value, maxAgeSeconds) {
  return `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${config.isProduction ? '; Secure' : ''}`
}

export async function login(req, res, { email, password }) {
  const key = `${req.ip}:${email}`
  const failure = loginFailures.get(key)
  if (failure?.lockedUntil > Date.now()) {
    return { status: 429, error: 'Too many failed attempts. Try again in a few minutes.' }
  }
  const valid = email === config.auth.email && timingSafeEqualString(password, config.auth.password)
  if (!valid) {
    const attempts = (failure?.attempts || 0) + 1
    loginFailures.set(key, { attempts, lockedUntil: attempts >= 5 ? Date.now() + 15 * 60_000 : 0 })
    return { status: 401, error: 'Email or password is incorrect' }
  }
  loginFailures.delete(key)
  const token = crypto.randomBytes(32).toString('hex')
  const user = { email, role: 'merchant', merchantName: config.merchant.name }
  await store.put('sessions', { id: hashToken(token), user, expiresAt: Date.now() + sessionMs })
  res.setHeader('Set-Cookie', cookieHeader(token, sessionMs / 1000))
  return { status: 200, user }
}

export async function logout(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE]
  if (token) await store.remove('sessions', hashToken(token))
  res.setHeader('Set-Cookie', cookieHeader('', 0))
}

export function currentUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE]
  if (!token) return null
  const session = store.get('sessions', hashToken(token))
  if (!session) return null
  if (session.expiresAt < Date.now()) {
    store.remove('sessions', session.id).catch(() => {})
    return null
  }
  // The shop name always comes from config, so renaming it never leaves stale sessions behind.
  return { ...session.user, merchantName: config.merchant.name }
}

export function requireAuth(req, res, next) {
  const user = currentUser(req)
  if (!user) return res.status(401).json({ error: 'Please sign in' })
  req.user = user
  return next()
}

export async function purgeExpiredSessions() {
  for (const session of store.all('sessions')) {
    if (session.expiresAt < Date.now()) await store.remove('sessions', session.id)
  }
}
