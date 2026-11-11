import { Link } from 'react-router-dom'
import { initials, money } from '../lib/format.js'
import { Icon } from './Icon.jsx'
import { ViewSwitch } from './ViewSwitch.jsx'

/**
 * Announcement bar, header and footer shared by every buyer-facing page
 * (shop, order lookup, order status), so they read as one store.
 */
export function StoreChrome({ config, nav, cart, active, children }) {
  const { merchant } = config
  const categories = [...new Set(config.products.map((p) => p.category))]
  const count = cart?.count || 0

  return (
    <div className="store">
      <div className="store-announce">
        <span>Tracked shipping on every order</span>
        <span className="store-announce-sep" aria-hidden="true" />
        <span>30-day returns</span>
        <span className="store-announce-sep" aria-hidden="true" />
        <span>Pay safely with PayPal</span>
      </div>

      <header className="store-header">
        <div className="store-header-inner">
          <Link className="store-brand" to="/store">
            <span className="store-logo">{initials(merchant.name)}</span>
            <span className="store-brand-text">
              <span className="store-name">{merchant.name}</span>
              <span className="store-tagline">Handmade in {merchant.shipFrom}</span>
            </span>
          </Link>
          {nav}
          <div className="store-actions">
            <ViewSwitch current="shop" />
            <Link className={`store-orders-link ${active === 'orders' ? 'active' : ''}`} to="/store/track" aria-label="Your orders">
              <Icon name="box" size={19} />
              <span className="store-orders-label">Orders</span>
            </Link>
            {cart?.href ? (
              <a className="store-cart-btn" href={cart.href} aria-label={`Cart, ${count} ${count === 1 ? 'item' : 'items'}`}>
                <CartButtonBody count={count} total={cart.total} currency={config.currency} />
              </a>
            ) : (
              <Link className="store-cart-btn" to="/store#cart" aria-label={`Cart, ${count} ${count === 1 ? 'item' : 'items'}`}>
                <CartButtonBody count={count} total={cart?.total} currency={config.currency} />
              </Link>
            )}
          </div>
        </div>
      </header>

      {children}

      <footer className="store-footer">
        <div className="store-footer-inner">
          <div className="store-footer-brand">
            <span className="store-logo">{initials(merchant.name)}</span>
            <div>
              <div className="store-footer-name">{merchant.name}</div>
              <p>Small-batch ceramics, textiles, woodwork and jewellery, made by hand in {merchant.shipFrom}.</p>
            </div>
          </div>
          <div className="store-footer-col">
            <h3>Shop</h3>
            {categories.map((c) => <Link key={c} to={`/store?category=${encodeURIComponent(c)}#collection`}>{c}</Link>)}
          </div>
          <div className="store-footer-col">
            <h3>Help</h3>
            <Link to="/store/track">Track an order</Link>
            <Link to="/store#policy">Shipping &amp; returns</Link>
            <a href={`mailto:${merchant.supportEmail}`}>{merchant.supportEmail}</a>
          </div>
        </div>
        <div className="store-footer-base">
          <span>© {new Date().getFullYear()} {merchant.name}</span>
          <span>Payments processed by PayPal ({config.paypal.environment}) · Orders protected by ProofPilot</span>
        </div>
      </footer>
    </div>
  )
}

function CartButtonBody({ count, total, currency }) {
  return (
    <>
      <Icon name="cart" size={19} />
      <span className="store-cart-btn-label">{count > 0 && total ? money(total, currency) : 'Cart'}</span>
      {count > 0 && <span className="store-cart-count">{count}</span>}
    </>
  )
}
