import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api.js'
import { money } from '../lib/format.js'
import { readCart, writeCart, rememberOrder, useStoreConfig } from '../lib/storeConfig.js'
import { Button, Field, Loading, ErrorState, Modal } from '../components/ui.jsx'
import { Icon } from '../components/Icon.jsx'
import { ProductArt } from '../components/ProductArt.jsx'
import { StoreChrome } from '../components/StoreChrome.jsx'

const MAX_QTY = 10

/** Loads the official PayPal JS SDK once. */
let sdkPromise = null
function loadPayPalSdk(clientId, currency) {
  if (window.paypal) return Promise.resolve(window.paypal)
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${currency}&intent=capture&components=buttons`
      script.async = true
      script.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error('PayPal SDK did not initialise')))
      script.onerror = () => {
        sdkPromise = null
        reject(new Error('Could not load PayPal checkout. Check your connection or ad blocker.'))
      }
      document.head.appendChild(script)
    })
  }
  return sdkPromise
}

export default function Store() {
  const { config, error: loadError } = useStoreConfig()
  const [cart, setCart] = useState(readCart)
  const [shippingMethod, setShippingMethod] = useState('standard')
  const [policyAccepted, setPolicyAccepted] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const [viewing, setViewing] = useState(null)
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const category = params.get('category') || 'All'

  useEffect(() => {
    document.title = config ? `${config.merchant.name} · Shop` : 'Shop'
  }, [config])
  useEffect(() => writeCart(cart), [cart])

  // Arriving from another store page with a #hash (cart, policy, collection): scroll there once rendered.
  useEffect(() => {
    if (!config || !location.hash) return
    const target = document.getElementById(location.hash.slice(1))
    if (!target) return
    if (location.hash === '#policy') target.querySelector('details')?.setAttribute('open', '')
    requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [config, location.hash, location.key])

  const lines = useMemo(() => {
    if (!config) return []
    return cart.map((line) => ({ ...line, product: config.products.find((p) => p.sku === line.sku) })).filter((line) => line.product)
  }, [cart, config])

  if (loadError) return <ErrorState error={loadError} onRetry={() => window.location.reload()} />
  if (!config) return <Loading label="Opening the store" />

  const shipping = config.shippingMethods.find((m) => m.id === shippingMethod)
  const subtotal = lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0)
  const total = lines.length ? subtotal + shipping.price : 0
  const count = lines.reduce((sum, line) => sum + line.quantity, 0)

  const inCart = (sku) => cart.find((line) => line.sku === sku)?.quantity || 0
  const setQuantity = (sku, quantity) => setCart((current) => {
    const next = Math.max(0, Math.min(MAX_QTY, quantity))
    if (!next) return current.filter((line) => line.sku !== sku)
    return current.some((line) => line.sku === sku)
      ? current.map((line) => (line.sku === sku ? { ...line, quantity: next } : line))
      : [...current, { sku, quantity: next }]
  })
  const add = (sku, quantity = 1) => setQuantity(sku, inCart(sku) + quantity)

  const completed = (receipt) => {
    rememberOrder({ token: receipt.token, number: receipt.orderNumber, total: receipt.total, currency: receipt.currency })
    setCart([])
    writeCart([])
    navigate(`/store/orders/${receipt.token}?placed=1`)
  }

  const categories = ['All', ...new Set(config.products.map((p) => p.category))]
  const visible = category === 'All' ? config.products : config.products.filter((p) => p.category === category)
  const city = config.merchant.shipFrom.split(',')[0]
  const pickCategory = (next, scroll = true) => {
    setParams(next === 'All' ? {} : { category: next }, { replace: true, preventScrollReset: true })
    if (scroll) document.getElementById('collection')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const nav = (
    <nav className="store-nav" aria-label="Shop categories">
      {categories.slice(0, 5).map((c) => (
        <button key={c} type="button" className={c === category ? 'active' : ''} onClick={() => pickCategory(c)}>{c === 'All' ? 'Shop all' : c}</button>
      ))}
    </nav>
  )

  return (
    <StoreChrome config={config} nav={nav} cart={{ href: '#cart', count, total }}>
      <main className="store-main" id="top">
        <section className="store-hero">
          <div className="store-hero-copy">
            <span className="store-eyebrow">The {city} studio collection</span>
            <h1>Small-batch goods for slow mornings</h1>
            <p>Ceramics, linen, walnut and silver, each piece made by hand in our studio and sent to you with tracking.</p>
            <div className="store-hero-cta">
              <a className="btn btn-store" href="#collection">Shop the collection <Icon name="arrow-right" size={17} /></a>
              <span className="store-hero-note">PayPal Buyer Protection on every order</span>
            </div>
          </div>
          <div className="store-hero-art" aria-hidden="true">
            {config.products.slice(0, 3).map((p, i) => (
              <div key={p.sku} className={`store-hero-tile t${i}`}><ProductArt image={p.image} /></div>
            ))}
          </div>
        </section>

        {!config.paypal.enabled && (
          <div className="store-demo-note" role="note">
            <Icon name="info" size={16} />
            <span><strong>Demo store.</strong> Checkout is simulated, so no money moves.</span>
          </div>
        )}

        <div className="store-layout">
          <section id="collection" aria-labelledby="collection-title">
            <div className="collection-head">
              <div>
                <h2 id="collection-title">{category === 'All' ? 'The collection' : category}</h2>
                <p className="muted small">{visible.length} {visible.length === 1 ? 'piece' : 'pieces'} · made to order in small batches</p>
              </div>
            </div>
            <div className="store-filters" role="group" aria-label="Filter by category">
              {categories.map((c) => (
                <button key={c} type="button" aria-pressed={c === category} className={`store-filter ${c === category ? 'active' : ''}`} onClick={() => pickCategory(c, false)}>
                  {c}
                </button>
              ))}
            </div>

            <div className="product-grid">
              {visible.map((product) => {
                const qty = inCart(product.sku)
                return (
                  <article key={product.sku} className="product">
                    <button type="button" className="product-media" onClick={() => setViewing(product)} aria-label={`View details for ${product.name}`}>
                      <ProductArt image={product.image} />
                      {product.category === 'Limited edition' && <span className="product-flag">Limited run</span>}
                    </button>
                    <div className="product-body">
                      <span className="product-cat">{product.category}</span>
                      <h3 className="product-name"><button type="button" onClick={() => setViewing(product)}>{product.name}</button></h3>
                      <p className="product-desc">{product.description}</p>
                      <div className="product-foot">
                        <span className="product-price">{money(product.price, config.currency)}</span>
                        {qty > 0 ? (
                          <Stepper value={qty} name={product.name} onChange={(next) => setQuantity(product.sku, next)} className="qty-inline" />
                        ) : (
                          <button type="button" className="btn btn-store btn-sm" onClick={() => add(product.sku)} aria-label={`Add ${product.name} to cart`}>
                            Add to cart
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>

            <section className="store-promise" aria-label="How we work">
              <div><h3>Made by hand</h3><p>Every piece is thrown, woven, cut or forged in our {city} studio, so no two are identical.</p></div>
              <div><h3>Tracked to your door</h3><p>Each order ships with carrier tracking you can follow from your order page. Orders over $250 need a signature.</p></div>
              <div><h3>Protected by PayPal</h3><p>Pay with PayPal or a card through PayPal. We never see your card details.</p></div>
            </section>

            <section className="store-policy" id="policy">
              <details>
                <summary>
                  <span>Returns &amp; shipping policy</span>
                  <span className="store-policy-version">v{config.policy.version}</span>
                  <Icon name="chevron-down" size={18} className="store-policy-chevron" />
                </summary>
                <ul>{config.policy.terms.map((term) => <li key={term}>{term}</li>)}</ul>
              </details>
            </section>
          </section>

          <aside className="cart" id="cart" aria-label="Your order">
            <div className="cart-head">
              <h2>Your order</h2>
              {count > 0 && <span className="cart-count">{count} {count === 1 ? 'item' : 'items'}</span>}
            </div>
            {lines.length === 0 ? (
              <div className="cart-empty">
                <p className="strong small">Your cart is empty</p>
                <p className="tiny muted">Add a piece from the collection and it shows up here.</p>
                <a className="btn btn-secondary btn-sm" href="#collection" style={{ marginTop: 10 }}>Browse the collection</a>
              </div>
            ) : (
              <>
                <ul className="cart-lines">
                  {lines.map((line) => (
                    <li key={line.sku}>
                      <button type="button" className="cart-thumb" onClick={() => setViewing(line.product)} aria-label={`View ${line.product.name}`}><ProductArt image={line.product.image} /></button>
                      <div className="grow">
                        <div className="cart-line-name">{line.product.name}</div>
                        <div className="cart-line-meta">
                          <Stepper value={line.quantity} name={line.product.name} onChange={(next) => setQuantity(line.sku, next)} className="qty-sm" trashAtOne />
                          <span className="tiny muted">{money(line.product.price, config.currency)} each</span>
                        </div>
                      </div>
                      <span className="cart-line-total">{money(line.product.price * line.quantity, config.currency)}</span>
                    </li>
                  ))}
                </ul>

                <fieldset className="cart-step">
                  <legend><span className="cart-step-num">1</span> Delivery</legend>
                  <div className="ship-options">
                    {config.shippingMethods.map((method) => (
                      <label key={method.id} className={`ship-option ${shippingMethod === method.id ? 'active' : ''}`}>
                        <input type="radio" name="shipping" value={method.id} checked={shippingMethod === method.id} onChange={() => setShippingMethod(method.id)} />
                        <span className="grow small">{method.label}</span>
                        <span className="strong small">{money(method.price, config.currency)}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <dl className="cart-totals">
                  <dt>Subtotal</dt><dd>{money(subtotal, config.currency)}</dd>
                  <dt>Shipping</dt><dd>{money(shipping.price, config.currency)}</dd>
                  <dt className="cart-total-label">Total</dt><dd className="cart-total-value">{money(total, config.currency)}</dd>
                </dl>

                <div className="cart-step">
                  <div className="cart-step-title"><span className="cart-step-num">2</span> Payment</div>
                  <label className="checkbox small cart-policy">
                    <input type="checkbox" checked={policyAccepted} onChange={(e) => setPolicyAccepted(e.target.checked)} />
                    <span>I have read the <a href="#policy" onClick={() => document.querySelector('#policy details')?.setAttribute('open', '')}>returns &amp; shipping policy</a> (v{config.policy.version}).</span>
                  </label>

                  {checkoutError && <div className="form-error" role="alert"><Icon name="alert" size={16} />{checkoutError}</div>}

                  {!policyAccepted ? (
                    <div className="cart-locked"><Icon name="lock" size={15} /> Accept the policy to unlock payment</div>
                  ) : config.paypal.enabled ? (
                    <PayPalCheckout clientId={config.paypal.clientId} currency={config.currency} cart={cart} shippingMethod={shippingMethod} onComplete={completed} onError={setCheckoutError} />
                  ) : (
                    <SimulatedCheckout cart={cart} shippingMethod={shippingMethod} total={total} currency={config.currency} onComplete={completed} onError={setCheckoutError} />
                  )}
                </div>
                <p className="cart-secure"><Icon name="lock" size={14} /> Payments are processed by PayPal. We never see your card.</p>
              </>
            )}
          </aside>
        </div>
      </main>

      {count > 0 && (
        <a className="store-cartbar" href="#cart">
          <span className="row-sm"><Icon name="cart" size={18} /> {count} {count === 1 ? 'item' : 'items'}</span>
          <span className="row-sm strong">Checkout · {money(total, config.currency)} <Icon name="chevron-right" size={16} /></span>
        </a>
      )}

      <ProductDialog
        product={viewing}
        config={config}
        inCart={viewing ? inCart(viewing.sku) : 0}
        onClose={() => setViewing(null)}
        onAdd={(sku, quantity) => {
          add(sku, quantity)
          setViewing(null)
        }}
      />
    </StoreChrome>
  )
}

function Stepper({ value, name, onChange, className = '', trashAtOne = false }) {
  const size = className.includes('qty-sm') ? 13 : 14
  return (
    <div className={`qty ${className}`} role="group" aria-label={`${name} quantity`}>
      <button type="button" onClick={() => onChange(value - 1)} aria-label={value === 1 ? `Remove ${name}` : `Remove one ${name}`}>
        <Icon name={trashAtOne && value === 1 ? 'trash' : 'minus'} size={size} />
      </button>
      <span aria-live="polite">{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} aria-label={`Add one ${name}`} disabled={value >= MAX_QTY}><Icon name="plus" size={size} /></button>
    </div>
  )
}

function ProductDialog({ product, config, inCart, onClose, onAdd }) {
  const [quantity, setQuantity] = useState(1)
  const [shownSku, setShownSku] = useState(null)
  // Reset the quantity whenever a different product opens.
  if (product && product.sku !== shownSku) {
    setShownSku(product.sku)
    setQuantity(1)
  }
  if (!product) return null
  const room = MAX_QTY - inCart
  const variesNote = config.policy.terms.find((term) => /vary/i.test(term))

  return (
    <Modal open onClose={onClose} title={product.name} subtitle={product.category} wide className="store-modal">
      <div className="pd">
        <div className="pd-art"><ProductArt image={product.image} /></div>
        <div className="pd-info">
          <div className="pd-price">{money(product.price, config.currency)}</div>
          <p className="pd-desc">{product.description}</p>
          <dl className="pd-specs">
            <dt>Ships from</dt><dd>{config.merchant.shipFrom}</dd>
            <dt>Delivery</dt><dd>{config.shippingMethods.map((m) => `${m.label.replace(/\s*\(.*\)/, '')} ${money(m.price, config.currency)}`).join(' · ')}</dd>
            {product.weightKg ? <><dt>Shipping weight</dt><dd>{product.weightKg} kg</dd></> : null}
            <dt>Returns</dt><dd>30 days on unused items</dd>
            <dt>Item code</dt><dd className="mono">{product.sku}</dd>
          </dl>
          {variesNote && <p className="pd-note">{variesNote}</p>}
          <div className="pd-actions">
            {room > 0 ? (
              <>
                <Stepper value={quantity} name={product.name} onChange={(next) => setQuantity(Math.max(1, Math.min(room, next)))} />
                <button type="button" className="btn btn-store grow" onClick={() => onAdd(product.sku, quantity)}>
                  Add to cart · {money(product.price * quantity, config.currency)}
                </button>
              </>
            ) : (
              <p className="small muted">You have the maximum of {MAX_QTY} in your cart.</p>
            )}
          </div>
          {inCart > 0 && room > 0 && <p className="tiny muted">{inCart} already in your cart.</p>}
        </div>
      </div>
    </Modal>
  )
}

function PayPalCheckout({ clientId, currency, cart, shippingMethod, onComplete, onError }) {
  const container = useRef(null)
  // Latest cart and callbacks live in a ref so the PayPal buttons render once.
  const state = useRef({ cart, shippingMethod, onComplete, onError })
  const [status, setStatus] = useState('loading')

  useEffect(() => { state.current = { cart, shippingMethod, onComplete, onError } }, [cart, shippingMethod, onComplete, onError])

  useEffect(() => {
    let buttons = null
    let cancelled = false
    loadPayPalSdk(clientId, currency)
      .then((paypal) => {
        if (cancelled || !container.current) return
        buttons = paypal.Buttons({
          style: { layout: 'vertical', color: 'gold', shape: 'pill', label: 'paypal', height: 45 },
          createOrder: async () => {
            state.current.onError('')
            const { cart: lines, shippingMethod: method } = state.current
            const result = await api('/store/checkout', { method: 'POST', body: { cart: lines.map(({ sku, quantity }) => ({ sku, quantity })), shippingMethod: method } })
            return result.paypalOrderId
          },
          onApprove: async (data, actions) => {
            try {
              const result = await api(`/store/checkout/${data.orderID}/capture`, { method: 'POST' })
              state.current.onComplete(result.receipt)
            } catch (error) {
              if (error.body?.issue === 'INSTRUMENT_DECLINED') return actions.restart()
              state.current.onError(error.message)
            }
            return undefined
          },
          onCancel: () => state.current.onError('Payment cancelled. Your cart is still here.'),
          onError: (error) => state.current.onError(error?.message ? `PayPal checkout error: ${error.message}` : 'PayPal checkout could not be completed.')
        })
        if (!buttons.isEligible()) {
          setStatus('ineligible')
          return
        }
        return buttons.render(container.current).then(() => !cancelled && setStatus('ready'))
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus('error')
          state.current.onError(error.message)
        }
      })
    return () => {
      cancelled = true
      buttons?.close?.().catch?.(() => {})
    }
  }, [clientId, currency])

  return (
    <div className="paypal-zone">
      {status === 'loading' && <div className="row-sm small muted" style={{ justifyContent: 'center', padding: 12 }}><span className="spinner" /> Loading PayPal…</div>}
      {status === 'ineligible' && <p className="small muted">PayPal checkout is not available in this browser.</p>}
      <div ref={container} />
    </div>
  )
}

const EMPTY_ADDRESS = { line1: '', line2: '', city: '', state: '', postalCode: '', country: 'US' }

function SimulatedCheckout({ cart, shippingMethod, total, currency, onComplete, onError }) {
  const [buyer, setBuyer] = useState({ name: '', email: '' })
  const [address, setAddress] = useState(EMPTY_ADDRESS)
  const [busy, setBusy] = useState(false)
  const setA = (key) => (event) => setAddress((current) => ({ ...current, [key]: event.target.value }))

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    onError('')
    try {
      const result = await api('/store/checkout/simulated', {
        method: 'POST',
        body: { cart: cart.map(({ sku, quantity }) => ({ sku, quantity })), shippingMethod, buyer, address }
      })
      onComplete(result.receipt)
    } catch (error) {
      onError(error.message)
      setBusy(false)
    }
  }

  return (
    <form className="stack-sm" onSubmit={submit}>
      <div className="sim-banner"><Icon name="info" size={14} /> Simulated checkout: no money moves</div>
      <Field label="Full name">{(id) => <input id={id} className="input" value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} required minLength={2} autoComplete="name" />}</Field>
      <Field label="Email" hint="We send your order link here. You can also find the order with its number and this email.">{(id) => <input id={id} className="input" type="email" value={buyer.email} onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} required autoComplete="email" />}</Field>
      <Field label="Address">{(id) => <input id={id} className="input" value={address.line1} onChange={setA('line1')} required minLength={3} autoComplete="address-line1" placeholder="Street address" />}</Field>
      <input className="input" value={address.line2} onChange={setA('line2')} autoComplete="address-line2" placeholder="Apartment, suite (optional)" aria-label="Address line 2" />
      <div className="form-grid">
        <Field label="City">{(id) => <input id={id} className="input" value={address.city} onChange={setA('city')} required minLength={2} autoComplete="address-level2" />}</Field>
        <Field label="State">{(id) => <input id={id} className="input" value={address.state} onChange={setA('state')} autoComplete="address-level1" />}</Field>
        <Field label="Postal code">{(id) => <input id={id} className="input" value={address.postalCode} onChange={setA('postalCode')} required minLength={3} autoComplete="postal-code" />}</Field>
        <Field label="Country">{(id) => <input id={id} className="input" value={address.country} onChange={setA('country')} required minLength={2} maxLength={2} pattern="[A-Za-z]{2}" title="Two-letter country code, e.g. US" autoComplete="country" placeholder="US" />}</Field>
      </div>
      <Button type="submit" size="lg" block loading={busy}>Place simulated order · {money(total, currency)}</Button>
    </form>
  )
}
