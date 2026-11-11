import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useNow, useResource } from '../lib/providers.jsx'
import { Card, Empty, ErrorState, Loading } from '../components/ui.jsx'
import { Icon } from '../components/Icon.jsx'
import { OrderTable } from './Home.jsx'

const FILTERS = [
  { id: 'all', label: 'All orders', test: () => true },
  { id: 'high', label: 'High risk', test: (o) => o.risk.level === 'high' },
  { id: 'unshipped', label: 'Needs tracking', test: (o) => o.fulfillment === 'unfulfilled' },
  { id: 'incomplete', label: 'Evidence gaps', test: (o) => o.evidence.percent < 85 },
  { id: 'disputed', label: 'Disputed', test: (o) => o.disputeIds.length > 0 }
]

export default function Orders() {
  const { data, error, reload } = useResource('/orders', { liveTypes: ['order', 'dispute'] })
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const now = useNow(60_000)
  const filter = FILTERS.find((f) => f.id === params.get('filter')) || FILTERS[0]

  const orders = useMemo(() => data?.orders || [], [data])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return orders.filter(filter.test).filter((o) =>
      !q || `${o.number} ${o.buyer.name} ${o.buyer.email} ${o.itemsLabel}`.toLowerCase().includes(q))
  }, [orders, filter, query])

  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return <Loading label="Loading orders" />

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Orders</h1>
          <p>Every paid order gets an evidence pack and a risk score at checkout. Open one to strengthen its evidence before anything goes wrong.</p>
        </div>
      </div>
      <div className="row-between wrap" style={{ marginBottom: 16 }}>
        <div className="chips" role="tablist" aria-label="Filter orders">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={f.id === filter.id} className={`chip ${f.id === filter.id ? 'active' : ''}`}
              onClick={() => setParams(f.id === 'all' ? {} : { filter: f.id })}>
              {f.label}<span className="count">{orders.filter(f.test).length}</span>
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', width: 'min(300px, 100%)' }}>
          <span style={{ position: 'absolute', left: 14, top: 12, color: 'var(--ink-500)' }}><Icon name="search" size={18} /></span>
          <input className="input" style={{ paddingLeft: 42 }} placeholder="Search order, buyer or item" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search orders" />
        </div>
      </div>
      <Card bodyClass="flush" className="flush">
        {orders.length === 0 ? (
          <Empty icon="box" title="No orders yet" action={<Link className="btn btn-primary" to="/store">Go to storefront</Link>}>
            Orders paid through your storefront appear here with their evidence pack already built.
          </Empty>
        ) : filtered.length === 0 ? (
          <Empty icon="search" title="No orders match">Try another filter or search term.</Empty>
        ) : (
          <OrderTable orders={filtered} now={now} />
        )}
      </Card>
    </>
  )
}
