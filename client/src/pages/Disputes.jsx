import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api.js'
import { useNow, useResource, useToast } from '../lib/providers.jsx'
import { dateTime, money, remaining, timeAgo, WORKFLOW_LABELS } from '../lib/format.js'
import { Badge, Card, Empty, ErrorState, Loading, Meter } from '../components/ui.jsx'
import { Icon } from '../components/Icon.jsx'

const DONE = ['submitted', 'resolved']
const FILTERS = [
  { id: 'open', label: 'Needs action', test: (d) => !DONE.includes(d.workflow) },
  { id: 'done', label: 'Submitted', test: (d) => DONE.includes(d.workflow) },
  { id: 'all', label: 'All', test: () => true }
]

/** One honest line about the PayPal connection, derived from the last real check. */
function connectionStatus(paypalLive, sync, now, checking) {
  if (checking) return { tone: 'neutral', title: 'Checking PayPal', text: 'Reading the latest connection status.' }
  if (!paypalLive) return { tone: 'neutral', title: 'Simulation mode', text: 'No PayPal sandbox keys. Disputes come from Simulate buyer dispute on an order.' }
  if (sync?.error) {
    const auth = /oauth|authentication/i.test(sync.error)
    return {
      tone: 'danger',
      title: auth ? 'PayPal rejected the sandbox keys' : 'Could not reach PayPal',
      text: auth ? 'Check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in server/.env, then restart the server.' : sync.error
    }
  }
  if (sync?.at) return { tone: 'success', title: 'Connected to PayPal sandbox', text: `Last checked ${timeAgo(sync.at, now)} · ${sync.found} ${sync.found === 1 ? 'dispute' : 'disputes'} found` }
  return { tone: 'neutral', title: 'PayPal sandbox configured', text: 'Waiting for the first dispute check.' }
}

export default function Disputes() {
  const { data, error, reload } = useResource('/disputes', { liveTypes: ['dispute', 'sync'] })
  const integrations = useResource('/integrations')
  const notify = useToast()
  const [params, setParams] = useSearchParams()
  const [syncing, setSyncing] = useState(false)
  const now = useNow(30_000)

  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return <Loading label="Loading disputes" />

  const paypalLive = integrations.data?.paypal.mode === 'sandbox'
  const disputes = data.disputes
  const filter = FILTERS.find((f) => f.id === params.get('filter')) || FILTERS[0]
  const shown = disputes.filter(filter.test)
  const open = disputes.filter(FILTERS[0].test)
  const onHold = open.reduce((sum, d) => sum + d.amount, 0)
  const nextDue = open.map((d) => d.responseDueAt).filter(Boolean).sort((a, b) => new Date(a) - new Date(b))[0]
  const soonest = nextDue ? remaining(nextDue, now) : null
  const status = connectionStatus(paypalLive, data.sync, now, !integrations.data)

  async function sync() {
    setSyncing(true)
    try {
      const { sync: result } = await api('/disputes/sync', { method: 'POST' })
      notify(`Checked PayPal: ${result.found} ${result.found === 1 ? 'dispute' : 'disputes'}, ${result.created} new, ${result.updated} updated`, 'success')
    } catch (err) {
      notify(err.message.replace(/^PayPal:\s*(?=PayPal)/, ''), 'error')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Disputes</h1>
          <p>Every case arrives with its evidence checked and a cited response drafted.</p>
        </div>
        {paypalLive && (
          <div className="sync-control">
            {status.tone === 'danger' ? (
              <Link className="btn btn-secondary" to="/settings#paypal"><Icon name="settings" size={17} /> Fix PayPal keys</Link>
            ) : (
              <button type="button" className={`btn btn-dark sync-btn ${syncing ? 'is-syncing' : ''}`} onClick={sync} disabled={syncing} aria-busy={syncing || undefined}>
                <Icon name="refresh" size={17} className="sync-icon" />
                {syncing ? 'Syncing with PayPal…' : 'Sync from PayPal'}
              </button>
            )}
            <span className="sync-caption">
              {status.tone === 'danger' ? 'Sync paused until PayPal accepts the keys' : data.sync?.at ? `Synced ${timeAgo(data.sync.at, now)} · auto every ${integrations.data.pollSeconds}s` : `Auto-sync every ${integrations.data?.pollSeconds || 120}s`}
            </span>
          </div>
        )}
      </div>

      <div className={`status-line ${status.tone}`} role={status.tone === 'danger' ? 'alert' : 'status'}>
        <span className="status-dot" />
        <span className="strong">{status.title}</span>
        <span className="status-text">{status.text}</span>
        {status.tone === 'danger' && <Link to="/settings" className="status-link">Open settings</Link>}
      </div>

      <div className="summary-strip">
        <div><span>Open cases</span><strong>{open.length}</strong></div>
        <div><span>On hold</span><strong>{money(onHold)}</strong></div>
        <div><span>Next deadline</span><strong className={soonest?.urgent ? 'is-urgent' : ''}>{soonest ? soonest.label : 'None'}</strong></div>
        <div><span>Submitted</span><strong>{disputes.length - open.length}</strong></div>
      </div>

      <div className="chips" role="tablist" aria-label="Filter disputes" style={{ marginBottom: 16 }}>
        {FILTERS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={f.id === filter.id} className={`chip ${f.id === filter.id ? 'active' : ''}`}
            onClick={() => setParams(f.id === 'open' ? {} : { filter: f.id })}>
            {f.label}<span className="count">{disputes.filter(f.test).length}</span>
          </button>
        ))}
      </div>

      <Card bodyClass="flush" className="flush">
        {disputes.length === 0 ? (
          <Empty icon="scale" title="No disputes" action={<Link className="btn btn-secondary" to="/orders">Go to orders</Link>}>
            Nothing is on hold. If a buyer opens a dispute, the case is assembled here automatically.
          </Empty>
        ) : shown.length === 0 ? (
          <Empty icon="check-circle" title={filter.id === 'open' ? 'Nothing needs action' : 'No cases here'}>
            {filter.id === 'open' ? 'Every dispute has a response submitted.' : 'Try another filter.'}
          </Empty>
        ) : (
          <ul className="case-list">
            {shown.map((dispute) => {
              const left = remaining(dispute.responseDueAt, now)
              const workflow = WORKFLOW_LABELS[dispute.workflow] || { label: dispute.workflow, tone: 'outline' }
              const done = DONE.includes(dispute.workflow)
              const tone = done ? 'success' : dispute.analyzing ? 'ai' : left.urgent ? 'danger' : 'info'
              return (
                <li key={dispute.id}>
                  <Link to={`/disputes/${dispute.id}`} className="case-row">
                    <span className={`case-icon ${tone}`}><Icon name={done ? 'check-circle' : dispute.analyzing ? 'sparkles' : 'scale'} size={20} /></span>
                    <span className="case-main">
                      <span className="case-title">
                        {dispute.reasonLabel}
                        <span className="case-order">{dispute.order ? `Order #${dispute.order.number}` : 'Unmatched case'}</span>
                      </span>
                      <span className="case-meta">
                        {dispute.source === 'paypal' ? 'PayPal sandbox' : 'Simulation'} · opened {dateTime(dispute.openedAt)} · <span className="mono">{dispute.paypalDisputeId}</span>
                      </span>
                      <span className="case-tags">
                        <Badge tone={workflow.tone} icon={dispute.analyzing ? 'sparkles' : undefined}>{workflow.label}</Badge>
                        {dispute.analysis && !done && <Badge tone={dispute.analysis.winLikelihood === 'high' ? 'success' : dispute.analysis.winLikelihood === 'medium' ? 'warning' : 'danger'}>Win likelihood {dispute.analysis.winLikelihood}</Badge>}
                        {dispute.outcome && <Badge tone={dispute.outcome === 'RESOLVED_SELLER_FAVOUR' ? 'success' : 'danger'}>{dispute.outcome.replace(/_/g, ' ').toLowerCase()}</Badge>}
                      </span>
                    </span>
                    <span className="case-evidence">
                      <span className="tiny muted">Evidence</span>
                      {dispute.order ? <Meter value={dispute.order.evidencePercent} /> : <span className="muted small">No pack</span>}
                    </span>
                    <span className="case-end">
                      <span className="case-amount">{money(dispute.amount, dispute.currency)}</span>
                      <span className={`case-due ${!done && left.urgent ? 'is-urgent' : ''}`}>{done ? 'Response sent' : left.label}</span>
                    </span>
                    <Icon name="chevron-right" size={18} className="case-chevron" />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
      <p className="footnote"><Icon name="info" size={14} /> Simulated disputes exist only in ProofPilot. The PayPal sandbox has no API for opening a dispute on a buyer's behalf.</p>
    </>
  )
}
