import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Icon, BrandMark } from './Icon.jsx'
import { ViewSwitch } from './ViewSwitch.jsx'
import { useAuth, useResource } from '../lib/providers.jsx'
import { initials } from '../lib/format.js'

const NAV = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/orders', label: 'Orders', icon: 'box' },
  { to: '/disputes', label: 'Disputes', icon: 'scale' },
  { to: '/settings', label: 'Settings', icon: 'settings' }
]

export function AppShell() {
  const { user, logout } = useAuth()
  const metrics = useResource('/metrics', { liveTypes: ['dispute', 'order'] })
  const openDisputes = metrics.data?.disputes.open || 0
  const location = useLocation()
  // The menu belongs to the page it was opened on, so navigating closes it.
  const [menuPath, setMenuPath] = useState(null)
  const menuOpen = menuPath === location.pathname
  const setMenuOpen = (open) => setMenuPath(open ? location.pathname : null)
  const menuRef = useRef(null)
  useEffect(() => {
    if (!menuOpen) return undefined
    const close = (event) => !menuRef.current?.contains(event.target) && setMenuPath(null)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  useEffect(() => {
    document.title = `${user?.merchantName ? `${user.merchantName} · ` : ''}ProofPilot seller console`
  }, [user?.merchantName])

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand" aria-label="ProofPilot home">
            <BrandMark light size={32} />
            <span>ProofPilot<small>Seller console</small></span>
          </Link>
          <nav className="nav" aria-label="Main">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end}>
                <Icon name={item.icon} size={18} />
                {item.label}
                {item.to === '/disputes' && openDisputes > 0 && <span className="nav-count" aria-label={`${openDisputes} open`}>{openDisputes}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="topbar-right">
            <ViewSwitch current="seller" />
            <div className="account" ref={menuRef}>
              <button type="button" className="account-btn" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-haspopup="menu" aria-label="Account menu">
                <span className="avatar">{initials(user?.merchantName)}</span>
              </button>
              {menuOpen && (
                <div className="menu" role="menu">
                  <div className="menu-head">
                    <div className="strong">{user?.merchantName}</div>
                    <div className="muted small">{user?.email}</div>
                  </div>
                  <Link to="/store" role="menuitem"><Icon name="store" size={17} /> View storefront</Link>
                  <Link to="/settings" role="menuitem"><Icon name="settings" size={17} /> Integrations</Link>
                  <button type="button" role="menuitem" onClick={logout}><Icon name="logout" size={17} /> Log out</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      <main className="main" id="main">
        <Outlet />
      </main>
    </div>
  )
}
