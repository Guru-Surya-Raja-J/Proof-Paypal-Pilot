/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api, eventsUrl } from './api.js'
import { Icon } from '../components/Icon.jsx'

/* ------------------------------------------------------------------ Auth */

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null })

  useEffect(() => {
    let cancelled = false
    api('/auth/me')
      .then(({ user }) => !cancelled && setState({ status: 'ready', user }))
      .catch(() => !cancelled && setState({ status: 'ready', user: null }))
    const onUnauthorized = () => setState({ status: 'ready', user: null })
    window.addEventListener('proofpilot:unauthorized', onUnauthorized)
    return () => {
      cancelled = true
      window.removeEventListener('proofpilot:unauthorized', onUnauthorized)
    }
  }, [])

  const value = useMemo(() => ({
    ...state,
    async login(email, password) {
      const { user } = await api('/auth/login', { method: 'POST', body: { email, password } })
      setState({ status: 'ready', user })
      return user
    },
    async logout() {
      await api('/auth/logout', { method: 'POST' }).catch(() => {})
      setState({ status: 'ready', user: null })
    }
  }), [state])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)

/* ----------------------------------------------------------------- Toasts */

const ToastContext = createContext(() => {})

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const dismiss = useCallback((id) => setToasts((list) => list.filter((toast) => toast.id !== id)), [])
  const notify = useCallback((message, type = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((list) => [...list.slice(-3), { id, message, type }])
    setTimeout(() => dismiss(id), type === 'error' ? 7000 : 4500)
  }, [dismiss])

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.type}`}>
            <span className="toast-icon"><Icon name={toast.type === 'success' ? 'check-circle' : toast.type === 'error' ? 'alert' : 'info'} size={18} /></span>
            <span>{toast.message}</span>
            <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss"><Icon name="x" size={16} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)

/* -------------------------------------------------------------- Live feed */

const LiveContext = createContext({ connected: false, subscribe: () => () => {} })

/** One EventSource per signed-in session; components subscribe to event types. */
export function LiveProvider({ children }) {
  const [connected, setConnected] = useState(false)
  const listeners = useRef(new Set())

  useEffect(() => {
    const source = new EventSource(eventsUrl(), { withCredentials: true })
    const forward = (type) => (event) => {
      let payload = {}
      try {
        payload = JSON.parse(event.data)
      } catch {
        /* ignore malformed frames */
      }
      for (const listener of listeners.current) listener(type, payload)
    }
    const types = ['order', 'dispute', 'activity', 'sync']
    const handlers = types.map((type) => [type, forward(type)])
    handlers.forEach(([type, handler]) => source.addEventListener(type, handler))
    source.onopen = () => setConnected(true)
    source.onerror = () => setConnected(false)
    return () => {
      handlers.forEach(([type, handler]) => source.removeEventListener(type, handler))
      source.close()
    }
  }, [])

  const subscribe = useCallback((listener) => {
    listeners.current.add(listener)
    return () => listeners.current.delete(listener)
  }, [])

  const value = useMemo(() => ({ connected, subscribe }), [connected, subscribe])
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>
}

export const useLive = () => useContext(LiveContext)

/**
 * Fetches `path` and re-fetches (debounced) whenever one of `liveTypes` fires.
 * `match(payload)` can narrow which events trigger a reload.
 */
export function useResource(path, { liveTypes = [], match } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) })
  const { subscribe } = useLive()
  const matchRef = useRef(match)
  useEffect(() => { matchRef.current = match })

  const load = useCallback(async (signal) => {
    if (!path) return
    try {
      const data = await api(path, { signal })
      setState({ data, error: null, loading: false })
    } catch (error) {
      if (error.name !== 'AbortError') setState((previous) => ({ ...previous, error, loading: false }))
    }
  }, [path])

  useEffect(() => {
    const controller = new AbortController()
    setState((previous) => ({ ...previous, loading: true }))
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  const typesKey = liveTypes.join(',')
  useEffect(() => {
    if (!typesKey) return undefined
    const types = new Set(typesKey.split(','))
    let timer = null
    const unsubscribe = subscribe((type, payload) => {
      if (!types.has(type)) return
      if (matchRef.current && !matchRef.current(type, payload)) return
      clearTimeout(timer)
      timer = setTimeout(() => load(), 250)
    })
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [typesKey, subscribe, load])

  const reload = useCallback(() => load(), [load])
  const mutate = useCallback((updater) => setState((previous) => ({ ...previous, data: typeof updater === 'function' ? updater(previous.data) : updater })), [])
  return { ...state, reload, mutate }
}

/** Re-renders every `ms` so relative times and countdowns stay fresh. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [ms])
  return now
}
