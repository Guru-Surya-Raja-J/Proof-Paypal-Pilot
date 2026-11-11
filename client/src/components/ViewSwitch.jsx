import { Link } from 'react-router-dom'

const VIEWS = [
  { id: 'shop', to: '/store', label: 'Shop', title: 'Switch to the buyer storefront' },
  { id: 'seller', to: '/', label: 'Seller', title: 'Switch to the seller console' }
]

/**
 * The one control for moving between the buyer storefront and the seller
 * console. Same tab, client-side navigation, identical on both sides.
 */
export function ViewSwitch({ current }) {
  return (
    <nav className="view-switch" aria-label="Switch view">
      {VIEWS.map((view) => (
        <Link
          key={view.id}
          to={view.to}
          title={view.title}
          className={view.id === current ? 'active' : undefined}
          aria-current={view.id === current ? 'page' : undefined}
        >
          {view.label}
        </Link>
      ))}
    </nav>
  )
}
