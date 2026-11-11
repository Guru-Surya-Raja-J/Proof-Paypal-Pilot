import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api.js'
import { address as formatAddress, date, dateTime, money } from '../lib/format.js'
import { cartCount, rememberOrder, useStoreConfig } from '../lib/storeConfig.js'
import { Button, Loading, ErrorState } from '../components/ui.jsx'
import { Icon } from '../components/Icon.jsx'
import { StoreChrome } from '../components/StoreChrome.jsx'

const shortDate = (iso) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

export default function StoreOrder() {
  const { token } = useParams()
  const [params] = useSearchParams()
  const justPlaced = params.get('placed') === '1'
  const { config, error: configError } = useStoreConfig()
  const [order, setOrder] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    api(`/store/orders/${encodeURIComponent(token)}`)
      .then(({ order: next }) => {
        if (!alive) return
        setOrder(next)
        rememberOrder({ token, number: next.number, total: next.total, currency: next.currency, placedAt: next.placedAt })
      })
      .catch((err) => alive && setError(err))
    return () => { alive = false }
  }, [token])

  useEffect(() => {
    if (config && order) document.title = `Order #${order.number} · ${config.merchant.name}`
  }, [config, order])

  if (configError) return <ErrorState error={configError} onRetry={() => window.location.reload()} />
  if (!config) return <Loading label="Opening your order" />

  return (
    <StoreChrome config={config} cart={{ count: cartCount() }} active="orders">
      <main className="store-main order-page">
        {error ? (
          <OrderNotFound message={error.status === 404 || error.status === 400 ? null : error.message} />
        ) : !order ? (
          <div className="order-loading"><span className="spinner" /> Loading your order…</div>
        ) : (
          <OrderView order={order} config={config} token={token} justPlaced={justPlaced} onChange={setOrder} />
        )}
      </main>
    </StoreChrome>
  )
}

function OrderNotFound({ message }) {
  return (
    <section className="order-card order-missing">
      <h1>We could not open this order</h1>
      <p>{message || 'The link may be incomplete. Find your order with its number and the email you used at checkout.'}</p>
      <Link className="btn btn-store" to="/store/track">Find my order</Link>
    </section>
  )
}

function OrderView({ order, config, token, justPlaced, onChange }) {
  const first = order.buyerName.split(' ')[0]
  const status = order.status
  const steps = [
    { id: 'placed', label: 'Order placed', at: order.placedAt, done: true },
    { id: 'shipped', label: 'Shipped', at: order.tracking?.shippedAt, done: Boolean(order.tracking) },
    { id: 'delivered', label: 'Delivered', at: order.deliveredAt, done: Boolean(order.deliveredAt) }
  ]
  const headline = order.refunded ? 'Refunded'
    : status === 'delivered' ? 'Delivered'
    : status === 'shipped' ? (order.estimate ? `Arriving ${shortDate(order.estimate.from)} to ${shortDate(order.estimate.to)}` : 'On its way')
    : 'Being prepared in the studio'

  return (
    <>
      <div className="order-crumbs"><Link to="/store/track">Your orders</Link><Icon name="chevron-right" size={14} /><span>Order #{order.number}</span></div>

      {justPlaced && (
        <section className="order-thanks" aria-live="polite">
          <h1>Thank you, {first}. Your order is confirmed.</h1>
          <p>
            {order.source === 'paypal' ? 'Paid with PayPal. ' : 'Simulated order: no payment was taken. '}
            Keep this page: it shows tracking as soon as your parcel ships, and it is the quickest way to reach us about this order.
          </p>
        </section>
      )}

      <div className="order-head">
        <div>
          <p className="order-eyebrow">Order #{order.number} · placed {date(order.placedAt)}</p>
          <h2 className="order-headline">{headline}</h2>
        </div>
        {order.source !== 'paypal' && <span className="order-tag">{order.source === 'demo' ? 'Demo order' : 'Simulated order'}</span>}
      </div>

      <ol className="order-steps" aria-label="Order progress">
        {steps.map((step, i) => (
          <li key={step.id} className={[step.done && 'done', steps[i + 1]?.done && 'next-done'].filter(Boolean).join(' ')}>
            <span className="order-step-mark">{step.done ? <Icon name="check" size={14} strokeWidth={2.6} /> : null}</span>
            <span className="order-step-label">{step.label}</span>
            <span className="order-step-date">{step.at ? date(step.at) : '-'}</span>
          </li>
        ))}
      </ol>

      {order.caseOpen && (
        <div className="order-note" role="note">
          A PayPal case is open for this order. {config.merchant.name} is responding through PayPal; you can still message the shop below.
        </div>
      )}

      <div className="order-layout">
        <div className="order-main">
          <ShipmentCard order={order} token={token} onChange={onChange} />
          <MessagesCard order={order} config={config} token={token} onChange={onChange} />
        </div>

        <aside className="order-side">
          <section className="order-card">
            <h3>Summary</h3>
            <ul className="order-items">
              {order.items.map((item) => (
                <li key={item.sku}><span>{item.quantity} × {item.name}</span><span>{money(item.price * item.quantity, order.currency)}</span></li>
              ))}
            </ul>
            <dl className="order-totals">
              <dt>Subtotal</dt><dd>{money(order.subtotal, order.currency)}</dd>
              <dt>Shipping</dt><dd>{money(order.shippingCost, order.currency)}</dd>
              <dt className="order-total">Total</dt><dd className="order-total">{money(order.total, order.currency)}</dd>
            </dl>
            <p className="order-meta">{order.payment.method}{order.payment.captureId && <> · transaction {order.payment.captureId}</>}</p>
          </section>

          <section className="order-card">
            <h3>Shipping to</h3>
            <p className="order-address"><strong>{order.shipping.name}</strong><br />{formatAddress(order.shipping.address)}</p>
            <p className="order-meta">{order.shipping.method}</p>
          </section>

          {order.policy.terms.length > 0 && (
            <section className="order-card">
              <details className="order-policy">
                <summary>Returns &amp; shipping{order.policy.version && <span className="store-policy-version">v{order.policy.version}</span>}<Icon name="chevron-down" size={16} className="store-policy-chevron" /></summary>
                <p className="order-meta">The version you accepted at checkout.</p>
                <ul>{order.policy.terms.map((term) => <li key={term}>{term}</li>)}</ul>
              </details>
            </section>
          )}
        </aside>
      </div>
    </>
  )
}

function ShipmentCard({ order, token, onChange }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const t = order.tracking

  async function confirm() {
    setBusy(true)
    setError('')
    try {
      const { order: next } = await api(`/store/orders/${encodeURIComponent(token)}/confirm-receipt`, { method: 'POST' })
      onChange(next)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(t.number)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked; the number is still selectable */
    }
  }

  return (
    <section className="order-card">
      <h3>Shipment</h3>
      {!t ? (
        <p className="order-text">We are making and packing your order. Tracking appears here as soon as it ships, and every order ships with carrier tracking.</p>
      ) : (
        <>
          <dl className="order-tracking">
            <dt>Carrier</dt><dd>{t.carrier}</dd>
            <dt>Tracking number</dt>
            <dd className="order-tracking-num">
              <span className="mono">{t.number}</span>
              <button type="button" className="link-btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
            </dd>
            <dt>Shipped</dt><dd>{dateTime(t.shippedAt)}</dd>
            {order.deliveredAt && <><dt>Delivered</dt><dd>{dateTime(order.deliveredAt)}</dd></>}
          </dl>
          {t.url && (
            <a className="btn btn-secondary btn-sm order-track-btn" href={t.url} target="_blank" rel="noopener noreferrer">
              Track with {t.carrier} <Icon name="external" size={14} />
            </a>
          )}

          <div className="order-receipt">
            {order.buyerConfirmedAt ? (
              <p className="order-confirmed"><Icon name="check-circle" size={18} /> You confirmed this order arrived on {dateTime(order.buyerConfirmedAt)}. Thank you.</p>
            ) : (
              <>
                <div>
                  <p className="strong">Has your parcel arrived?</p>
                  <p className="order-meta">Let the shop know it reached you. The confirmation is saved with your order.</p>
                </div>
                <Button className="btn-store" onClick={confirm} loading={busy}>Yes, I received it</Button>
              </>
            )}
            {error && <p className="form-error" role="alert"><Icon name="alert" size={14} />{error}</p>}
          </div>
        </>
      )}
    </section>
  )
}

function MessagesCard({ order, config, token, onChange }) {
  const [topic, setTopic] = useState(order.tracking && !order.deliveredAt ? 'where_is_order' : 'other')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function send(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { order: next } = await api(`/store/orders/${encodeURIComponent(token)}/messages`, { method: 'POST', body: { topic, body } })
      onChange(next)
      setBody('')
      setSent(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const topicLabel = (id) => config.messageTopics.find((t) => t.id === id)?.label
  const showTrackingHint = topic === 'where_is_order' && order.tracking && !order.deliveredAt

  return (
    <section className="order-card" id="messages">
      <h3>Messages with {config.merchant.name}</h3>
      {order.messages.length > 0 ? (
        <ol className="order-thread">
          {order.messages.map((message) => (
            <li key={message.id} className={message.from}>
              <div className="order-bubble">
                {message.topic && <span className="order-bubble-topic">{topicLabel(message.topic)}</span>}
                <p>{message.body}</p>
              </div>
              <span className="order-bubble-meta">{message.from === 'you' ? 'You' : config.merchant.name} · {dateTime(message.at)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="order-text">Questions about delivery, a damaged piece or a return? Write to the shop here and the reply shows up on this page.</p>
      )}

      <form className="order-form" onSubmit={send}>
        <div className="field">
          <label htmlFor="msg-topic">Topic</label>
          <select id="msg-topic" className="select" value={topic} onChange={(e) => { setTopic(e.target.value); setSent(false) }}>
            {config.messageTopics.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        {showTrackingHint && (
          <p className="order-hint">
            Your parcel is with {order.tracking.carrier}{order.estimate && <>, expected {shortDate(order.estimate.from)} to {shortDate(order.estimate.to)}</>}.
            {order.tracking.url && <> <a href={order.tracking.url} target="_blank" rel="noopener noreferrer">See the latest scan</a>.</>}
          </p>
        )}
        <div className="field">
          <label htmlFor="msg-body">Message</label>
          <textarea id="msg-body" className="textarea" value={body} onChange={(e) => { setBody(e.target.value); setSent(false) }} maxLength={1500} rows={4} placeholder="How can we help?" />
        </div>
        {error && <p className="form-error" role="alert"><Icon name="alert" size={14} />{error}</p>}
        <div className="order-form-foot">
          <span className="order-meta">{sent ? 'Sent. The reply will appear on this page.' : `Or email ${config.merchant.supportEmail}`}</span>
          <Button type="submit" className="btn-store" loading={busy} disabled={body.trim().length < 5}>Send message</Button>
        </div>
      </form>
    </section>
  )
}
