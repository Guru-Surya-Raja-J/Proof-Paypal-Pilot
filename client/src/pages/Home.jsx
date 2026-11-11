import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { useAuth, useNow, useResource, useToast } from '../lib/providers.jsx'
import { duration, initials, money, remaining, timeAgo } from '../lib/format.js'
import { ActivityFeed } from '../components/ActivityFeed.jsx'
import { Badge, Button, Card, Loading, ErrorState, Meter, RiskBadge } from '../components/ui.jsx'
import { Icon } from '../components/Icon.jsx'

function greeting() {
  const hour = new Date().getHours()
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

export default function Home() {
  const { user } = useAuth()
  const metrics = useResource('/metrics', { liveTypes: ['order', 'dispute'] })
  const orders = useResource('/orders', { liveTypes: ['order', 'dispute'] })
  const disputes = useResource('/disputes', { liveTypes: ['dispute'] })
  const now = useNow(60_000)

  if (metrics.error) return <ErrorState error={metrics.error} onRetry={metrics.reload} />
  if (!metrics.data || !orders.data || !disputes.data) return <Loading label="Loading your dashboard" />

  const m = metrics.data
  const orderList = orders.data.orders
  const disputeList = disputes.data.disputes
  const merchant = user?.merchantName?.split(/['\s]/)[0] || 'there'

  if (!orderList.length) return <Welcome name={merchant} />

  const attention = [
    ...disputeList
      .filter((d) => d.order && !['submitted', 'resolved'].includes(d.workflow))
      .map((d) => {
        const left = remaining(d.responseDueAt, now)
        return {
          key: d.id,
          tone: d.analyzing ? 'ai' : 'danger',
          icon: d.analyzing ? 'sparkles' : 'scale',
          title: d.analyzing ? `Agent is drafting a response for order #${d.order.number}` : `${d.reasonLabel} dispute on order #${d.order.number}`,
          detail: d.analyzing ? 'Gap analysis and cited draft in progress' : `${money(d.amount, d.currency)} on hold · ${left.label} · draft ready for review`,
          to: `/disputes/${d.id}`,
          cta: 'Review response'
        }
      }),
    ...orderList
      .filter((o) => o.awaitingReply)
      .map((o) => ({
        key: `${o.id}-msg`,
        tone: 'warning',
        icon: 'message',
        title: `${o.buyer.name} is waiting for a reply on order #${o.number}`,
        detail: `${o.awaitingReply.topicLabel} · ${timeAgo(o.awaitingReply.at, now)} · a quick reply often prevents a PayPal dispute`,
        to: `/orders/${o.id}`,
        cta: 'Reply'
      })),
    ...orderList
      .filter((o) => o.risk.level === 'high' && o.fulfillment === 'unfulfilled')
      .map((o) => ({ key: o.id, tone: 'danger', icon: 'flag', title: `Order #${o.number} flagged high risk before shipping`, detail: `${o.buyer.name} · ${money(o.total, o.currency)} · risk ${o.risk.score}/100`, to: `/orders/${o.id}`, cta: 'Review order' })),
    ...orderList
      .filter((o) => o.risk.level !== 'high' && o.fulfillment === 'unfulfilled')
      .slice(0, 3)
      .map((o) => ({ key: o.id, tone: 'warning', icon: 'truck', title: `Add tracking to order #${o.number}`, detail: `Tracking lifts this evidence pack from ${o.evidence.percent}% and is registered with PayPal`, to: `/orders/${o.id}`, cta: 'Add tracking' }))
  ]

  const build = m.caseBuilding
  const holdTone = m.hold.risk === 'high' ? 'danger' : m.hold.risk === 'medium' ? 'warning' : 'success'
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

  return (
    <>
      <h1 className="dash-greeting">{greeting()}, {merchant}</h1>

      <div className="dash">
        <div className="dash-main">
          <section className="hero-card" aria-labelledby="hero-label">
            <div id="hero-label" className="hero-label">Volume protected by ProofPilot</div>
            <div className="hero-value">{money(m.orders.volume)}</div>
            <div className="hero-sub">
              {plural(m.orders.total, 'order', 'orders')} · {m.orders.averageEvidence}% evidence ready on average
              {m.orders.live > 0 && <> · {m.orders.live} paid with PayPal</>}
            </div>
            <div className="hero-actions">
              <Link className="btn btn-dark" to="/disputes">
                Review disputes{m.disputes.open > 0 && <span className="btn-count">{m.disputes.open}</span>}
              </Link>
              <Link className="btn btn-secondary" to="/orders">View orders</Link>
            </div>
            <dl className="hero-stats">
              <div className={m.disputes.open ? 'is-danger' : ''}>
                <dt>Open disputes</dt>
                <dd>{m.disputes.open}</dd>
                <span>{m.disputes.open ? `${money(m.disputes.amountAtRisk)} on hold` : 'Nothing on hold'}</span>
              </div>
              <div className={m.orders.unshippedHighRisk ? 'is-danger' : ''}>
                <dt>High-risk orders</dt>
                <dd>{m.orders.highRisk}</dd>
                <span>{m.orders.unshippedHighRisk ? `${m.orders.unshippedHighRisk} not shipped yet` : 'None waiting to ship'}</span>
              </div>
              <div className={m.orders.needsTracking ? 'is-warning' : ''}>
                <dt>Needs tracking</dt>
                <dd>{m.orders.needsTracking}</dd>
                <span>{m.orders.needsTracking ? 'Add it to lift evidence' : 'Every order is tracked'}</span>
              </div>
            </dl>
          </section>

          <Card title="Needs your attention" action={attention.length > 0 && <span className="count-pill">{attention.length}</span>} bodyClass="flush" className="flush">
            {attention.length ? (
              <div className="attention">
                {attention.map((item) => (
                  <Link key={item.key} to={item.to} className="attention-item">
                    <span className={`attention-icon ${item.tone}`}><Icon name={item.icon} size={18} /></span>
                    <div className="grow">
                      <div className="strong">{item.title}</div>
                      <div className="muted small">{item.detail}</div>
                    </div>
                    <span className="attention-cta">{item.cta}<Icon name="chevron-right" size={16} /></span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="card-body row"><span className="attention-icon info"><Icon name="check" size={18} /></span><span className="muted">All caught up. Every order is shipped with tracking and no disputes are open.</span></div>
            )}
          </Card>

          <Card title="Recent orders" action={<Link to="/orders" className="link-strong">Show all</Link>} bodyClass="flush" className="flush">
            <ul className="activity-rows">
              {orderList.slice(0, 6).map((order) => (
                <li key={order.id}>
                  <Link to={`/orders/${order.id}`} className="activity-row">
                    <span className="activity-avatar">{initials(order.buyer.name)}</span>
                    <span className="grow">
                      <span className="activity-name">{order.buyer.name}</span>
                      <span className="activity-meta">
                        #{order.number} · {timeAgo(order.createdAt, now)}{order.source !== 'paypal' && <> · {order.source === 'demo' ? 'Demo' : 'Simulated'}</>}
                      </span>
                    </span>
                    <span className="activity-end">
                      <span className="activity-amount">{money(order.total, order.currency)}</span>
                      <RiskBadge level={order.risk.level} score={order.risk.score} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <aside className="dash-side">
          <Card title="Hold early warning">
            <div className="row-between">
              <span className="side-value">{m.hold.disputeRate}%</span>
              <Badge tone={holdTone} dot>Hold risk {m.hold.risk}</Badge>
            </div>
            <div className="meter-track" style={{ marginTop: 12 }}>
              <div className="meter-fill" style={{ width: `${Math.min(100, (m.hold.disputeRate / (m.hold.threshold * 2)) * 100)}%`, background: `var(--${holdTone}-600)` }} />
            </div>
            <p className="tiny muted" style={{ marginTop: 10 }}>
              {m.hold.signals.length ? m.hold.signals[0] : `Dispute rate is under PayPal's ~${m.hold.threshold}% comfort level.`}
            </p>
          </Card>

          <Card title="Case building time">
            <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
              <span className="side-value">{build.measuredCases ? duration(build.averageMs) : '-'}</span>
              <span className="muted small">vs ~{build.manualMinutesEstimate} min by hand</span>
            </div>
            <p className="tiny muted" style={{ marginTop: 10 }}>
              Average from dispute received to cited draft, over {plural(build.measuredCases, 'case', 'cases')}. The manual time is an estimate.
            </p>
          </Card>

          <Card title="Agent activity" bodyClass="flush" className="flush">
            <ActivityFeed limit={30} initial={4} />
          </Card>
        </aside>
      </div>
    </>
  )
}

export function OrderTable({ orders, now, compact = false }) {
  const navigate = useNavigate()
  if (!orders.length) return <div className="card-body muted small">No orders match.</div>
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Order</th>
            <th className="hide-sm">Buyer</th>
            <th className="right">Total</th>
            <th>Risk</th>
            <th className="hide-sm">Evidence</th>
            {!compact && <th className="hide-mobile">Status</th>}
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className="clickable" onClick={() => navigate(`/orders/${order.id}`)}>
              <td>
                <Link to={`/orders/${order.id}`} className="primary" onClick={(e) => e.stopPropagation()}>#{order.number}</Link>
                <div className="sub">{timeAgo(order.createdAt, now)}{order.source !== 'paypal' && <> · {order.source === 'demo' ? 'Demo' : 'Simulated'}</>}</div>
                <div className="sub show-sm">{order.buyer.name}</div>
              </td>
              <td className="hide-sm">
                <div className="primary nowrap">{order.buyer.name}</div>
                <div className="sub" title={order.itemsLabel}>{order.itemsLabel}</div>
              </td>
              <td className="right strong nowrap">{money(order.total, order.currency)}</td>
              <td><RiskBadge level={order.risk.level} score={order.risk.score} /></td>
              <td className="hide-sm" style={{ minWidth: 130 }}><Meter value={order.evidence.percent} /></td>
              {!compact && <td className="hide-mobile">
                <div className="row-sm wrap">
                  {order.disputeIds.length > 0 && <Badge tone="danger">Disputed</Badge>}
                  <Badge tone={order.fulfillment === 'delivered' ? 'success' : order.fulfillment === 'shipped' ? 'info' : 'warning'}>
                    {order.fulfillment === 'unfulfilled' ? 'Not shipped' : order.fulfillment === 'shipped' ? 'Shipped' : 'Delivered'}
                  </Badge>
                </div>
              </td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Welcome({ name }) {
  const notify = useToast()
  const [loading, setLoading] = useState(false)
  const { data } = useResource('/integrations')
  const paypalLive = data?.paypal.mode === 'sandbox'

  async function loadDemo() {
    setLoading(true)
    try {
      await api('/workspace/demo', { method: 'POST' })
      notify('Demo scenario loaded through the live risk and evidence pipeline', 'success')
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Welcome, {name}</h1>
          <p>ProofPilot starts protecting an order the moment it is paid. Make your first sale to see it work.</p>
        </div>
      </div>
      <section className="card welcome">
        <div className="welcome-copy">
          <Badge tone={paypalLive ? 'success' : 'warning'} dot>{paypalLive ? 'PayPal sandbox connected' : 'PayPal sandbox not connected'}</Badge>
          <h2 style={{ marginTop: 14 }}>Your workspace is empty</h2>
          <p>
            {paypalLive
              ? 'Switch to Shop and pay with a PayPal sandbox buyer account. When you switch back to Seller, the order, its evidence pack and its risk score are already here.'
              : 'Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to enable real sandbox checkout. Until then you can place a clearly labelled simulated order, or load the demo scenario.'}
          </p>
          <div className="row wrap">
            <Link className="btn btn-primary" to="/store"><Icon name="store" size={17} /> Go to storefront</Link>
            <Button variant="secondary" icon="database" loading={loading} onClick={loadDemo}>Load demo scenario</Button>
          </div>
          <p className="tiny muted" style={{ marginTop: 14 }}>The demo scenario creates 7 orders from 4 buyers and runs them through the same scoring, evidence and AI pipeline as live orders. Each one is labelled "Demo".</p>
        </div>
        <div className="welcome-steps">
          <h3>How ProofPilot works</h3>
          {[
            ['At checkout', 'The PayPal capture, listing snapshot, policy version and device record become a dated evidence pack.'],
            ['Before you ship', 'Every order gets an explainable risk score and one recommended action.'],
            ['When a dispute lands', 'The agent checks the pack against what PayPal needs and drafts a response that only cites evidence you hold.'],
            ['One click', 'Review, edit and submit the evidence straight to the PayPal Disputes API.']
          ].map(([title, text], index) => (
            <div key={title} className="step">
              <span className="step-num">{index + 1}</span>
              <div><div className="strong" style={{ color: '#fff' }}>{title}</div><p>{text}</p></div>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
