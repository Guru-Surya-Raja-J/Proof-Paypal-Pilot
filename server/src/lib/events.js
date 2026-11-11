/**
 * Server-Sent Events hub. The dashboard keeps one EventSource open and refreshes
 * the affected resource whenever the agent changes something, so a checkout in
 * the storefront tab shows up on the merchant console without a reload.
 */
import crypto from 'node:crypto'
import { store } from './store.js'

const clients = new Set()

export function eventsHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  res.write('retry: 3000\n\n')
  clients.add(res)
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000)
  req.on('close', () => {
    clearInterval(heartbeat)
    clients.delete(res)
  })
}

export function emit(type, payload = {}) {
  const message = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`
  for (const client of clients) client.write(message)
}

/**
 * Records an agent action in the activity feed and pushes it to open dashboards.
 * kind: info | success | warning | danger | ai | paypal
 */
export async function logActivity({ action, target, detail = '', kind = 'info', ref = null }) {
  const entry = {
    id: `act_${crypto.randomBytes(6).toString('hex')}`,
    at: new Date().toISOString(),
    action,
    target,
    detail,
    kind,
    ref
  }
  await store.put('activity', entry)
  emit('activity', entry)
  return entry
}
