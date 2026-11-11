import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, attachmentUrl } from '../lib/api.js'
import { useResource, useToast } from '../lib/providers.jsx'
import { address, dateTime, money, titleCase, FULFILLMENT_LABELS, WORKFLOW_LABELS, EVIDENCE_LABELS } from '../lib/format.js'
import { AiBadge, Alert, Badge, Button, Card, ErrorState, Field, Gauge, Loading, Meter, Modal, RiskBadge, SourceBadge } from '../components/ui.jsx'
import { EvidencePack } from '../components/EvidencePack.jsx'
import { Icon } from '../components/Icon.jsx'

export default function OrderDetail() {
  const { orderId } = useParams()
  const resource = useResource(`/orders/${orderId}`, {
    liveTypes: ['order', 'dispute'],
    match: (type, payload) => type === 'dispute' || payload.id === orderId
  })
  const meta = useResource('/orders/meta')
  const [disputeOpen, setDisputeOpen] = useState(false)

  if (resource.error) return <ErrorState error={resource.error} onRetry={resource.reload} />
  if (!resource.data || !meta.data) return <Loading label="Loading order" />

  const { order, disputes } = resource.data
  const setOrder = (next) => resource.mutate((data) => ({ ...data, order: next }))
  const fulfillment = FULFILLMENT_LABELS[order.fulfillment.status]

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/orders" className="back-link"><Icon name="arrow-left" size={16} /> Orders</Link>
          <div className="row wrap">
            <h1>Order #{order.number}</h1>
            <RiskBadge level={order.risk.level} score={order.risk.score} />
            <Badge tone={fulfillment.tone}>{fulfillment.label}</Badge>
            <SourceBadge source={order.source} />
          </div>
          <p>{order.buyer.name} · {money(order.total, order.currency)} · placed {dateTime(order.createdAt)}</p>
        </div>
        <div className="row wrap">
          {order.buyerToken && <Link className="btn btn-secondary" to={`/store/orders/${order.buyerToken}`} title="The page the buyer sees for this order">Buyer's order page</Link>}
          <Button variant="secondary" icon="scale" onClick={() => setDisputeOpen(true)}>Simulate buyer dispute</Button>
        </div>
      </div>

      {order.source !== 'paypal' && (
        <div style={{ marginBottom: 20 }}>
          <Alert tone="warning" title={order.source === 'demo' ? 'Demo order' : 'Simulated checkout'}>
            This order was not paid through PayPal, so PayPal-side actions (tracking registration, evidence submission) are recorded locally and labelled as such.
          </Alert>
        </div>
      )}

      {disputes.length > 0 && (
        <div className="stack-sm" style={{ marginBottom: 20 }}>
          {disputes.map((dispute) => (
            <Alert key={dispute.id} tone={dispute.workflow === 'submitted' || dispute.workflow === 'resolved' ? 'info' : 'danger'} icon="scale"
              title={`${dispute.reasonLabel} dispute · ${WORKFLOW_LABELS[dispute.workflow]?.label || dispute.workflow}`}
              action={<Link className="btn btn-secondary btn-sm" to={`/disputes/${dispute.id}`}>Open case</Link>}>
              {dispute.source === 'paypal' ? `PayPal case ${dispute.paypalDisputeId}` : 'Simulated dispute'} · opened {dateTime(dispute.openedAt)}
            </Alert>
          ))}
        </div>
      )}

      <div className="grid-2">
        <div className="stack">
          <RiskCard order={order} />
          <Card title="Evidence pack" subtitle="Collected automatically at checkout and kept up to date. Click an item to see the raw record."
            action={<div style={{ width: 160 }}><Meter value={order.evidence.percent} size="lg" /></div>} bodyClass="flush" className="flush">
            {order.evidence.missing.length > 0 && (
              <div style={{ padding: '14px 20px 0' }}>
                <Alert tone="warning" title={`Missing: ${order.evidence.missing.map((type) => EVIDENCE_LABELS[type].toLowerCase()).join(', ')}`}>
                  Close these gaps now, while the details are fresh, and the case is ready if a dispute ever arrives.
                </Alert>
              </div>
            )}
            <div style={{ paddingTop: 8 }}><EvidencePack order={order} /></div>
          </Card>
          <FulfillmentCard order={order} carriers={meta.data.carriers} onChange={setOrder} />
          <CommunicationsCard order={order} onChange={setOrder} />
          <DocumentsCard order={order} onChange={setOrder} />
        </div>

        <div className="stack">
          <Card title="Payment">
            <dl className="dl">
              <dt>Total</dt><dd>{money(order.total, order.currency)}</dd>
              <dt>Items</dt><dd>{money(order.subtotal, order.currency)}</dd>
              <dt>Shipping</dt><dd>{money(order.shippingCost, order.currency)}</dd>
              {order.paypal?.fee != null && <><dt>PayPal fee</dt><dd>{money(order.paypal.fee, order.currency)}</dd></>}
              {order.paypal?.net != null && <><dt>Net</dt><dd>{money(order.paypal.net, order.currency)}</dd></>}
              <dt>PayPal order</dt><dd className="mono">{order.paypal?.orderId || '-'}</dd>
              <dt>Capture</dt><dd className="mono">{order.paypal?.captureId || '-'}</dd>
              <dt>Seller Protection</dt>
              <dd>{order.paypal?.sellerProtection ? <Badge tone={order.paypal.sellerProtection.status === 'ELIGIBLE' ? 'success' : 'warning'}>{titleCase(order.paypal.sellerProtection.status)}</Badge> : <span className="muted">Not reported</span>}</dd>
              <dt>Payer account</dt><dd>{order.paypal?.accountStatus ? titleCase(order.paypal.accountStatus) : <span className="muted">Not reported</span>}</dd>
            </dl>
          </Card>
          <Card title="Items">
            <div className="stack-sm">
              {order.items.map((item) => (
                <div key={item.sku} className="row-between" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <div className="strong">{item.quantity} × {item.name}</div>
                    <div className="tiny muted">{item.sku} · {item.category}{item.riskCategory ? ' · high-chargeback category' : ''}</div>
                  </div>
                  <span className="strong nowrap">{money(item.price * item.quantity, order.currency)}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Buyer">
            <dl className="dl">
              <dt>Name</dt><dd>{order.buyer.name}</dd>
              <dt>Email</dt><dd>{order.buyer.email || '-'}</dd>
              <dt>PayPal country</dt><dd>{order.buyer.country || '-'}</dd>
              <dt>Payer ID</dt><dd className="mono">{order.buyer.payerId || '-'}</dd>
              <dt>Earlier orders</dt><dd>{order.risk.history.priorOrders}</dd>
              <dt>Earlier disputes</dt><dd>{order.risk.history.priorDisputes}</dd>
            </dl>
          </Card>
          <Card title="Shipping">
            <div className="stack-sm">
              <div className="row-sm"><Icon name="map" size={16} /><span className="strong">{order.shipping.name}</span></div>
              <div className="small">{address(order.shipping.address)}</div>
              <div className="small muted">{order.shipping.methodLabel}</div>
            </div>
          </Card>
        </div>
      </div>

      <SimulateDisputeModal open={disputeOpen} onClose={() => setDisputeOpen(false)} order={order} reasons={meta.data.disputeReasons} />
    </>
  )
}

function RiskCard({ order }) {
  const { risk } = order
  const notify = useToast()
  const [busy, setBusy] = useState(false)
  async function rescore() {
    setBusy(true)
    try {
      await api(`/orders/${order.id}/rescore`, { method: 'POST' })
      notify('Risk re-scored from the latest store history', 'success')
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card title="Risk assessment" subtitle={`Computed ${dateTime(risk.computedAt)} · rules score it, AI only explains it`}
      action={<Button variant="ghost" size="sm" icon="refresh" loading={busy} onClick={rescore}>Re-score</Button>}>
      <div className="stack">
        <div className="risk-hero">
          <Gauge score={risk.score} level={risk.level} />
          <div className="stack-sm grow">
            <div className="row-sm wrap">
              <span className={`risk ${risk.level}`} style={{ fontSize: 17, textTransform: 'capitalize' }}>{risk.level} risk</span>
              <AiBadge by={risk.explainedBy} model={risk.model} />
            </div>
            <p style={{ color: 'var(--ink-900)' }}>{risk.explanation}</p>
          </div>
        </div>
        <div className="recommend">
          <Icon name="shield-check" size={22} />
          <div><span className="label">Recommended action</span><p>{risk.recommendedAction}</p></div>
        </div>
        {risk.signals.length > 0 ? (
          <div>
            <div className="section-title">Signals that fired</div>
            <ul className="signals">
              {risk.signals.map((signal) => (
                <li key={signal.code} className="signal">
                  <span className="signal-label">{signal.label}</span>
                  <span className="signal-points">+{signal.points}</span>
                  <span className="signal-evidence">{signal.evidence}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : <p className="small muted">No risk signals fired for this order.</p>}
        <p className="tiny muted">Order value baseline: ${risk.baseline.value} ({risk.baseline.basis}).</p>
      </div>
    </Card>
  )
}

function FulfillmentCard({ order, carriers, onChange }) {
  const notify = useToast()
  const f = order.fulfillment
  const [carrier, setCarrier] = useState(f.carrier || 'USPS')
  const [carrierOther, setCarrierOther] = useState('')
  const [trackingNumber, setTrackingNumber] = useState('')
  const [notifyPayer, setNotifyPayer] = useState(true)
  const [signedBy, setSignedBy] = useState('')
  const [deliveredAt, setDeliveredAt] = useState('')
  const [busy, setBusy] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [error, setError] = useState('')
  const editing = !f.trackingNumber || editMode

  async function saveTracking(event) {
    event.preventDefault()
    setBusy('tracking')
    setError('')
    try {
      const { order: next } = await api(`/orders/${order.id}/tracking`, {
        method: 'POST',
        body: { carrier, carrierOther: carrier === 'OTHER' ? carrierOther : undefined, trackingNumber: trackingNumber.replace(/\s+/g, ''), notifyPayer }
      })
      onChange(next)
      setTrackingNumber('')
      setEditMode(false)
      const sync = next.fulfillment.paypalSync
      notify(sync.status === 'synced' ? 'Tracking registered with PayPal' : sync.status === 'failed' ? `Saved, but PayPal rejected it: ${sync.error}` : 'Tracking saved to the evidence pack', sync.status === 'failed' ? 'error' : 'success')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  async function confirmDelivery(event) {
    event.preventDefault()
    setBusy('delivery')
    setError('')
    try {
      const { order: next } = await api(`/orders/${order.id}/delivery`, {
        method: 'POST',
        body: { signedBy: signedBy || undefined, deliveredAt: deliveredAt ? new Date(deliveredAt).toISOString() : undefined }
      })
      onChange(next)
      notify('Proof of delivery recorded', 'success')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  const sync = f.paypalSync
  return (
    <Card title="Fulfilment" subtitle="Tracking and delivery are the evidence PayPal weighs most for item-not-received claims.">
      <div className="stack">
        {f.trackingNumber && !editMode && (
          <div className="row-between wrap" style={{ alignItems: 'flex-start' }}>
            <div className="stack-sm">
              <div className="row-sm"><Icon name="truck" size={18} /><span className="strong">{carriers.find((c) => c.code === f.carrier)?.label || f.carrierOther} · <span className="mono">{f.trackingNumber}</span></span></div>
              <div className="small muted">Shipped {dateTime(f.shippedAt)}</div>
              {sync?.status === 'synced' && <Badge tone="success" icon="link">Registered with PayPal {dateTime(sync.at)}</Badge>}
              {sync?.status === 'failed' && <Alert tone="danger" title="PayPal did not accept this tracking number">{sync.error}{sync.debugId ? ` (debug id ${sync.debugId})` : ''}</Alert>}
              {sync?.status === 'not_applicable' && <span className="tiny muted">{sync.note}</span>}
            </div>
            {!f.deliveredAt && <Button variant="ghost" size="sm" icon="edit" onClick={() => { setEditMode(true); setCarrier(f.carrier) }}>Change</Button>}
          </div>
        )}

        {editing && (
          <form onSubmit={saveTracking} className="form-grid">
            <Field label="Carrier">
              {(id) => (
                <select id={id} className="select" value={carrier} onChange={(e) => setCarrier(e.target.value)}>
                  {carriers.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              )}
            </Field>
            {carrier === 'OTHER' ? (
              <Field label="Carrier name">{(id) => <input id={id} className="input" value={carrierOther} onChange={(e) => setCarrierOther(e.target.value)} required />}</Field>
            ) : <div className="hide-mobile" />}
            <Field label="Tracking number" className="span-2" hint={order.source === 'paypal' ? 'Registered with PayPal on the original transaction (Orders v2 /track).' : 'Saved to the evidence pack.'}>
              {(id) => <input id={id} className="input mono" value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} placeholder="e.g. 9400111899561234567890" required minLength={5} />}
            </Field>
            {order.source === 'paypal' && (
              <label className="checkbox span-2"><input type="checkbox" checked={notifyPayer} onChange={(e) => setNotifyPayer(e.target.checked)} /> Let PayPal email the buyer the tracking details</label>
            )}
            <div className="row span-2">
              <Button type="submit" icon="truck" loading={busy === 'tracking'} disabled={trackingNumber.trim().length < 5}>{f.trackingNumber ? 'Update tracking' : 'Add tracking'}</Button>
              {editMode && <Button variant="ghost" onClick={() => setEditMode(false)}>Cancel</Button>}
            </div>
          </form>
        )}

        {f.trackingNumber && !f.deliveredAt && !editMode && (
          <form onSubmit={confirmDelivery} className="form-grid" style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 16 }}>
            <div className="span-2"><h3>Confirm delivery</h3><p className="small muted">Use the carrier's delivery scan. Upload the proof-of-delivery PDF below to mark it verified.</p></div>
            <Field label="Delivered at" hint="Leave empty for now">{(id) => <input id={id} className="input" type="datetime-local" value={deliveredAt} onChange={(e) => setDeliveredAt(e.target.value)} max={new Date().toISOString().slice(0, 16)} />}</Field>
            <Field label="Signed by (optional)">{(id) => <input id={id} className="input" value={signedBy} onChange={(e) => setSignedBy(e.target.value)} placeholder="Name on the delivery scan" />}</Field>
            <div className="span-2"><Button type="submit" variant="secondary" icon="check" loading={busy === 'delivery'}>Mark delivered</Button></div>
          </form>
        )}

        {f.deliveredAt && (
          <div className="row-sm" style={{ color: 'var(--success-700)' }}><Icon name="check-circle" size={18} /><span><span className="strong">Delivered {dateTime(f.deliveredAt)}</span>{f.signedBy && <span className="muted">, signed by {f.signedBy}</span>}{f.buyerConfirmed && <span className="muted"> · buyer confirmed receipt on the order page {dateTime(f.buyerConfirmed.at)}</span>}</span></div>
        )}
        {error && <div className="form-error" role="alert"><Icon name="alert" size={16} />{error}</div>}
      </div>
    </Card>
  )
}

const CHANNEL_LABELS = { store: 'order page', email: 'email', paypal_message: 'PayPal message', chat: 'chat', phone: 'phone', marketplace: 'marketplace' }
const TOPIC_LABELS = { where_is_order: 'Where is my order?', damaged: 'Item arrived damaged', not_as_described: 'Not what I expected', return: 'Return or exchange', other: 'Something else' }

function CommunicationsCard({ order, onChange }) {
  const notify = useToast()
  const last = order.communications.at(-1)
  const awaiting = last?.direction === 'buyer' && last.channel === 'store'
  const [direction, setDirection] = useState(awaiting ? 'merchant' : 'buyer')
  const [channel, setChannel] = useState(awaiting ? 'store' : 'email')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    try {
      const { order: next } = await api(`/orders/${order.id}/messages`, { method: 'POST', body: { direction, channel, body } })
      onChange(next)
      setBody('')
      notify(direction === 'merchant' && channel === 'store' ? "Reply posted to the buyer's order page" : 'Message added to the evidence pack', 'success')
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Buyer communication" subtitle="A dated log of what was said. Messages from the buyer's order page arrive here with a server timestamp.">
      <div className="stack">
        {order.communications.length > 0 && (
          <ul className="timeline">
            {order.communications.map((message) => (
              <li key={message.id}>
                <span className={`tl-dot ${message.direction === 'buyer' ? 'paypal' : 'success'}`} />
                <div className="tl-event">{message.direction === 'buyer' ? `From ${order.buyer.name}` : 'From you'} <span className="muted small">via {CHANNEL_LABELS[message.channel] || titleCase(message.channel)}{message.topic && ` · ${TOPIC_LABELS[message.topic] || message.topic}`}</span></div>
                <div className="tl-note" style={{ whiteSpace: 'pre-wrap' }}>{message.body}</div>
                <div className="tl-time">{dateTime(message.at)}</div>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={submit} className="form-grid">
          <Field label="From">
            {(id) => (
              <select id={id} className="select" value={direction} onChange={(e) => setDirection(e.target.value)}>
                <option value="buyer">Buyer</option>
                <option value="merchant">You</option>
              </select>
            )}
          </Field>
          <Field label="Channel">
            {(id) => (
              <select id={id} className="select" value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="store">Order page (buyer sees it)</option>
                <option value="email">Email</option>
                <option value="paypal_message">PayPal message</option>
                <option value="chat">Chat</option>
                <option value="phone">Phone (summary)</option>
                <option value="marketplace">Marketplace</option>
              </select>
            )}
          </Field>
          <Field label="Message" className="span-2">
            {(id) => <textarea id={id} className="textarea" style={{ minHeight: 80 }} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Paste the message exactly as it was sent" maxLength={2000} />}
          </Field>
          <div className="span-2"><Button type="submit" variant="secondary" icon="message" loading={busy} disabled={body.trim().length < 2}>Log message</Button></div>
        </form>
      </div>
    </Card>
  )
}

const KIND_LABELS = {
  proof_of_delivery: 'Proof of delivery (carrier POD)',
  shipping_label: 'Shipping label / receipt',
  product_photo: 'Product photo before shipping',
  communication: 'Screenshot of buyer conversation',
  other: 'Other document'
}

function DocumentsCard({ order, onChange }) {
  const notify = useToast()
  const input = useRef(null)
  const [kind, setKind] = useState('proof_of_delivery')
  const [busy, setBusy] = useState(false)

  async function upload(file) {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) return notify('Files must be 10 MB or smaller', 'error')
    const form = new FormData()
    form.append('kind', kind)
    form.append('file', file)
    setBusy(true)
    try {
      const { order: next } = await api(`/orders/${order.id}/attachments`, { method: 'POST', form })
      onChange(next)
      notify(`${file.name} filed as evidence`, 'success')
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  async function remove(fileId) {
    try {
      const { order: next } = await api(`/orders/${order.id}/attachments/${fileId}`, { method: 'DELETE' })
      onChange(next)
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  return (
    <Card title="Evidence documents" subtitle="PDF, PNG, JPG or GIF up to 10 MB. These files are attached when evidence is sent to PayPal.">
      <div className="stack">
        {order.attachments.length > 0 && (
          <div className="files">
            {order.attachments.map((file) => (
              <div key={file.id} className="file">
                <Icon name="file" size={16} />
                <div className="grow">
                  <a href={attachmentUrl(order.id, file.id)} target="_blank" rel="noreferrer">{file.name}</a>
                  <div className="tiny muted">{KIND_LABELS[file.kind]} · {Math.max(1, Math.round(file.size / 1024))} KB · {dateTime(file.uploadedAt)}</div>
                </div>
                <button type="button" className="icon-btn" onClick={() => remove(file.id)} aria-label={`Remove ${file.name}`}><Icon name="trash" size={16} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="row wrap">
          <select className="select" style={{ width: 'auto', flex: '1 1 240px' }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Document type">
            {Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg,image/gif" className="sr-only" id={`upload-${order.id}`} onChange={(e) => upload(e.target.files?.[0])} />
          <Button variant="secondary" icon="upload" loading={busy} onClick={() => input.current?.click()}>Upload file</Button>
        </div>
      </div>
    </Card>
  )
}

function SimulateDisputeModal({ open, onClose, order, reasons }) {
  const notify = useToast()
  const navigate = useNavigate()
  const [reason, setReason] = useState('MERCHANDISE_OR_SERVICE_NOT_RECEIVED')
  const [buyerMessage, setBuyerMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const selected = reasons.find((r) => r.code === reason)

  async function submit() {
    setBusy(true)
    try {
      const { dispute } = await api(`/orders/${order.id}/disputes/simulate`, { method: 'POST', body: { reason, buyerMessage: buyerMessage || undefined } })
      notify('Dispute opened. The agent is drafting the response now.', 'success')
      onClose()
      navigate(`/disputes/${dispute.id}`)
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Simulate a buyer dispute" subtitle={`Order #${order.number} · ${money(order.total, order.currency)}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon="scale" loading={busy} onClick={submit}>Open dispute</Button></>}>
      <div className="stack">
        <Alert tone="warning" title="Labelled simulation">
          The PayPal sandbox only lets a buyer open a dispute from their own account. Real sandbox disputes are pulled in automatically by webhook or sync; this creates a clearly marked simulated one so you can run the full flow.
        </Alert>
        <Field label="Dispute reason (PayPal reason code)">
          {(id) => (
            <select id={id} className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
              {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
          )}
        </Field>
        {selected && <p className="small muted">PayPal typically needs: {selected.required.map((type) => EVIDENCE_LABELS[type].toLowerCase()).join(', ')}.</p>}
        <Field label="Buyer's statement (optional)">
          {(id) => <textarea id={id} className="textarea" style={{ minHeight: 80 }} value={buyerMessage} onChange={(e) => setBuyerMessage(e.target.value)} placeholder="e.g. My package never arrived." maxLength={1000} />}
        </Field>
      </div>
    </Modal>
  )
}
