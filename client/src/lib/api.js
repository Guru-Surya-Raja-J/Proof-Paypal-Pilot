const BASE = import.meta.env.VITE_API_BASE || ''

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message)
    this.status = status
    this.body = body
  }
}

/**
 * Same-origin JSON client. Sends the session cookie, surfaces the server's
 * error message, and broadcasts 401s so the app can return to sign-in.
 */
export async function api(path, { method = 'GET', body, form, signal } = {}) {
  let response
  try {
    response = await fetch(`${BASE}/api${path}`, {
      method,
      credentials: 'include',
      signal,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined)
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new ApiError('Cannot reach the ProofPilot server. Check your connection and try again.', 0)
  }
  if (response.status === 204) return null
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('proofpilot:unauthorized'))
    throw new ApiError(data.error || `Request failed (${response.status})`, response.status, data)
  }
  return data
}

export const eventsUrl = () => `${BASE}/api/events`
export const attachmentUrl = (orderId, fileId) => `${BASE}/api/orders/${orderId}/attachments/${fileId}`
