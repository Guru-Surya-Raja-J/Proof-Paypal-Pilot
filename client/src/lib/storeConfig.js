import { useEffect, useState } from 'react'
import { api } from './api.js'

/* Store config is public and rarely changes: fetch once per page load. */
let configPromise = null
function loadConfig() {
  if (!configPromise) {
    configPromise = api('/store/config').catch((error) => {
      configPromise = null
      throw error
    })
  }
  return configPromise
}

export function useStoreConfig() {
  const [state, setState] = useState({ config: null, error: null })
  useEffect(() => {
    let alive = true
    loadConfig()
      .then((config) => alive && setState({ config, error: null }))
      .catch((error) => alive && setState({ config: null, error }))
    return () => { alive = false }
  }, [])
  return state
}

/* localStorage helpers. Storage can be unavailable (private mode), so every
   read falls back to an empty value and every write is best effort. */
function read(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable; state still works for this visit */
  }
}

const CART_KEY = 'proofpilot.store.cart'
export const readCart = () => read(CART_KEY).filter((line) => line?.sku && line.quantity > 0)
export const writeCart = (cart) => write(CART_KEY, cart)
export const cartCount = (cart = readCart()) => cart.reduce((sum, line) => sum + line.quantity, 0)

/** Orders placed in this browser, so the buyer can find them again without the email. */
const ORDERS_KEY = 'proofpilot.store.orders'
export const readRecentOrders = () => read(ORDERS_KEY).filter((entry) => entry?.token && entry.number)
export function rememberOrder({ token, number, total, currency, placedAt }) {
  const rest = readRecentOrders().filter((entry) => entry.token !== token)
  write(ORDERS_KEY, [{ token, number, total, currency, placedAt: placedAt || new Date().toISOString() }, ...rest].slice(0, 10))
}
