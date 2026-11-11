import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { date, money } from '../lib/format.js'
import { cartCount, readRecentOrders, useStoreConfig } from '../lib/storeConfig.js'
import { Button, Loading, ErrorState } from '../components/ui.jsx'
import { Icon } from '../components/Icon.jsx'
import { StoreChrome } from '../components/StoreChrome.jsx'

export default function StoreTrack() {
  const { config, error: configError } = useStoreConfig()
  const navigate = useNavigate()
  const [number, setNumber] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [recent] = useState(readRecentOrders)

  useEffect(() => {
    if (config) document.title = `Your orders · ${config.merchant.name}`
  }, [config])

  if (configError) return <ErrorState error={configError} onRetry={() => window.location.reload()} />
  if (!config) return <Loading label="Opening the store" />

  async function lookup(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { token } = await api('/store/orders/lookup', { method: 'POST', body: { number: number.replace(/\D/g, ''), email } })
      navigate(`/store/orders/${token}`)
    } catch (err) {
      setError(err.status === 429 ? 'Too many attempts. Wait a minute and try again.' : err.message)
      setBusy(false)
    }
  }

  return (
    <StoreChrome config={config} cart={{ count: cartCount() }} active="orders">
      <main className="store-main track-page">
        <h1 className="track-title">Your orders</h1>
        <p className="track-sub">Follow your parcel, confirm it arrived, or message the studio about an order.</p>

        <div className="track-layout">
          <section className="order-card">
            <h3>Find an order</h3>
            <form className="order-form" onSubmit={lookup}>
              <div className="field">
                <label htmlFor="track-number">Order number</label>
                <input id="track-number" className="input" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. 1048" required autoComplete="off" />
              </div>
              <div className="field">
                <label htmlFor="track-email">Email used at checkout</label>
                <input id="track-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
                <span className="hint">For PayPal orders, this is the email on your PayPal account.</span>
              </div>
              {error && <p className="form-error" role="alert"><Icon name="alert" size={14} />{error}</p>}
              <Button type="submit" className="btn-store" loading={busy} disabled={!number.trim() || !email.trim()}>Find my order</Button>
            </form>
          </section>

          <section className="order-card">
            <h3>On this device</h3>
            {recent.length ? (
              <ul className="track-recent">
                {recent.map((entry) => (
                  <li key={entry.token}>
                    <Link to={`/store/orders/${entry.token}`}>
                      <span className="grow">
                        <span className="strong">Order #{entry.number}</span>
                        <span className="order-meta">{entry.placedAt ? `Placed ${date(entry.placedAt)}` : 'Recently placed'}</span>
                      </span>
                      {entry.total != null && <span className="track-amount">{money(entry.total, entry.currency || config.currency)}</span>}
                      <Icon name="chevron-right" size={16} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="order-text">Orders you place in this browser show up here. On another device, use the order number and email instead.</p>
            )}
          </section>
        </div>
      </main>
    </StoreChrome>
  )
}
