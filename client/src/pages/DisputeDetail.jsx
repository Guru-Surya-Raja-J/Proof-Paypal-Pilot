import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api.js'
import { useNow, useResource, useToast } from '../lib/providers.jsx'
import { dateTime, duration, money, remaining, titleCase, EVIDENCE_LABELS, WORKFLOW_LABELS } from '../lib/format.js'
import { AiBadge, Alert, Badge, Button, Card, ErrorState, Loading, Meter, Modal } from '../components/ui.jsx'
import { EvidencePack } from '../components/EvidencePack.jsx'
import { Icon } from '../components/Icon.jsx'

const NOTES_LIMIT = 2000

export default function DisputeDetail() {
  const { disputeId } = useParams()
  const resource = useResource(`/disputes/${disputeId}`, {
    liveTypes: ['dispute', 'order'],
    match: (type, payload) => (type === 'dispute' ? payload.id === disputeId : payload.id === resource.data?.order?.id)
  })
  const now = useNow(30_000)
  const notify = useToast()
  const [focusId, setFocusId] = useState(null)
  const [editing, setEditing] = useState(false)
  const [draftText, setDraftText] = useState('')
  const [draftError, setDraftError] = useState('')
  const [busy, setBusy] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const dispute = resource.data?.dispute
  const order = resource.data?.order
  const cited = useMemo(() => new Set(dispute?.draft?.citedEvidenceIds || []), [dispute])

  useEffect(() => {
    if (!focusId) return undefined
    document.getElementById(`evidence-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const timer = setTimeout(() => setFocusId(null), 1600)
    return () => clearTimeout(timer)
  }, [focusId])

  if (resource.error) return <ErrorState error={resource.error} onRetry={resource.reload} />
  if (!dispute) return <Loading label="Loading case" />

  const setDispute = (next) => resource.mutate((data) => ({ ...data, dispute: next }))
  const submitted = Boolean(dispute.submission?.ok)
  const resolved = dispute.workflow === 'resolved'
  const left = remaining(dispute.responseDueAt, now)
  const workflow = WORKFLOW_LABELS[dispute.workflow] || { label: dispute.workflow, tone: 'outline' }
  const analysis = dispute.analysis
  const draft = dispute.draft

  async function run(kind, fn) {
    setBusy(kind)
    try {
      await fn()
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setBusy('')
    }
  }

  const regenerate = () => run('analyze', async () => {
    const { dispute: next } = await api(`/disputes/${dispute.id}/analyze`, { method: 'POST' })
    setDispute(next)
    notify('Gap analysis re-run and response re-drafted', 'success')
  })

  async function saveDraft() {
    setBusy('save')
    setDraftError('')
    try {
      const { dispute: next } = await api(`/disputes/${dispute.id}/draft`, { method: 'PUT', body: { text: draftText } })
      setDispute(next)
      setEditing(false)
      notify('Draft saved. Every citation was re-checked against the evidence pack.', 'success')
      resource.reload()
    } catch (error) {
      setDraftError(error.message)
    } finally {
      setBusy('')
    }
  }

  const submit = () => run('submit', async () => {
    try {
      const { dispute: next } = await api(`/disputes/${dispute.id}/submit`, { method: 'POST' })
      setDispute(next)
      setConfirmOpen(false)
      notify(next.submission.mode === 'paypal_sandbox' ? 'Evidence accepted by PayPal' : 'Response filed (simulation)', 'success')
    } catch (error) {
      setConfirmOpen(false)
      resource.reload()
      throw error
    }
  })

  const refresh = () => run('refresh', async () => {
    const { dispute: next } = await api(`/disputes/${dispute.id}/refresh`, { method: 'POST' })
    setDispute(next)
    notify('Case refreshed from PayPal', 'success')
  })

  const requireEvidence = () => run('escalate', async () => {
    const { dispute: next } = await api(`/disputes/${dispute.id}/sandbox/require-evidence`, { method: 'POST' })
    setDispute(next)
    notify('Sandbox dispute moved to the evidence stage', 'success')
  })

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/disputes" className="back-link"><Icon name="arrow-left" size={16} /> Disputes</Link>
          <div className="row wrap">
            <h1>{dispute.reasonLabel}</h1>
            <Badge tone={workflow.tone} icon={dispute.analyzing ? 'sparkles' : undefined}>{workflow.label}</Badge>
            <Badge tone={dispute.source === 'paypal' ? 'info' : 'warning'}>{dispute.source === 'paypal' ? 'PayPal sandbox' : 'Simulation'}</Badge>
          </div>
          <p>
            Case <span className="mono">{dispute.paypalDisputeId}</span>
            {order && <> · <Link to={`/orders/${order.id}`}>Order #{order.number}</Link> · {order.buyer.name}</>}
            {dispute.status && <> · PayPal status {titleCase(dispute.status)}{dispute.stage ? ` (${titleCase(dispute.stage)})` : ''}</>}
          </p>
        </div>
        {dispute.source === 'paypal' && (
          <div className="row wrap">
            {!submitted && !resolved && <Button variant="ghost" icon="zap" loading={busy === 'escalate'} onClick={requireEvidence} title="Sandbox-only API">Sandbox: request evidence</Button>}
            <Button variant="secondary" icon="refresh" loading={busy === 'refresh'} onClick={refresh}>Refresh from PayPal</Button>
          </div>
        )}
      </div>

      {!order ? (
        <Alert tone="warning" title="This case is not linked to a ProofPilot order">
          The disputed capture ({dispute.captureId || 'unknown'}) was not paid through your ProofPilot storefront, so there is no pre-built evidence pack. Respond to it from the PayPal Resolution Center.
        </Alert>
      ) : (
        <>
          <section className="card dispute-hero" style={{ marginBottom: 20 }}>
            <div>
              <div className="kpi-label">Amount on hold</div>
              <div className="kpi-value">{money(dispute.amount, dispute.currency)}</div>
              <div className="kpi-detail">Opened {dateTime(dispute.openedAt)}</div>
            </div>
            <div>
              <div className="kpi-label">Respond by</div>
              <div className={`kpi-value countdown ${!submitted && left.urgent ? 'urgent' : ''}`}>{resolved ? 'Resolved' : submitted ? 'Submitted' : left.label.replace(' left', '')}</div>
              <div className="kpi-detail">{dispute.responseDueAt ? dateTime(dispute.responseDueAt) : 'PayPal has not set a deadline'}</div>
            </div>
            <div>
              <div className="kpi-label">Evidence ready</div>
              <div className="kpi-value">{order.evidence.percent}%</div>
              <div style={{ marginTop: 8 }}><Meter value={order.evidence.percent} showLabel={false} /></div>
            </div>
            <div>
              <div className="kpi-label">Win likelihood</div>
              <div className={`kpi-value likelihood ${analysis?.winLikelihood || ''}`}>{analysis ? analysis.winLikelihood : '-'}</div>
              <div className="kpi-detail">{dispute.metrics?.buildMs != null ? `Case built in ${duration(dispute.metrics.buildMs)}` : 'Analysing…'}</div>
            </div>
          </section>

          {dispute.buyerMessage && (
            <div style={{ marginBottom: 20 }}>
              <Alert tone="info" icon="message" title="Buyer's statement">“{dispute.buyerMessage}”</Alert>
            </div>
          )}

          <div className="grid-2">
            <div className="stack">
              {!draft ? (
                <Card>
                  <div className="row" style={{ padding: '12px 0' }}>
                    <span className="spinner lg" />
                    <div>
                      <div className="strong">The agent is building this case</div>
                      <div className="muted small">Checking the evidence pack against what PayPal needs for {dispute.reasonLabel.toLowerCase()} claims and drafting a cited response…</div>
                    </div>
                  </div>
                </Card>
              ) : (
                <Card
                  title="Response to PayPal"
                  subtitle={`Drafted ${dateTime(draft.generatedAt)}${draft.editedAt ? ` · edited ${dateTime(draft.editedAt)}` : ''}`}
                  action={<div className="row-sm wrap"><AiBadge by={draft.generatedBy} model={draft.model} /><Badge tone="success" icon="shield-check" title="Every [EV-…] citation exists in the evidence pack and is present">{draft.citedEvidenceIds.length} citations verified</Badge></div>}
                  className={!submitted && !editing ? 'highlight' : ''}
                >
                  <div className="stack">
                    {analysis?.aiError && (
                      <div className="draft-notice" title={analysis.aiError}>
                        <Icon name="info" size={16} />
                        <span><strong>Written by the rules engine.</strong> {aiFallbackReason(analysis.aiError)}</span>
                      </div>
                    )}
                    {editing ? (
                      <div className="stack-sm">
                        <textarea className="textarea mono" style={{ minHeight: 380, fontSize: 13 }} value={draftText} onChange={(e) => setDraftText(e.target.value)} aria-label="Response text" />
                        <div className="row-between">
                          <span className="tiny muted">Cite evidence as [EV-…]. Citations are re-verified when you save.</span>
                          <span className={`char-count ${draftText.length > NOTES_LIMIT ? 'over' : ''}`}>{draftText.length} / {NOTES_LIMIT}</span>
                        </div>
                        {draftError && <div className="form-error" role="alert"><Icon name="alert" size={16} />{draftError}</div>}
                      </div>
                    ) : (
                      <DraftView text={draft.text} citations={draft.citedEvidenceIds.length} limit={NOTES_LIMIT} onCite={setFocusId} />
                    )}

                    {submitted ? (
                      <Receipt submission={dispute.submission} />
                    ) : dispute.submission && !dispute.submission.ok ? (
                      <Alert tone="danger" title="PayPal rejected the last submission">
                        {dispute.submission.error}{dispute.submission.debugId ? ` · debug id ${dispute.submission.debugId}` : ''}
                      </Alert>
                    ) : null}

                    {!submitted && !resolved && (
                      <div className="draft-actions">
                        {editing ? (
                          <div className="row">
                            <Button icon="check" loading={busy === 'save'} disabled={draftText.length > NOTES_LIMIT || draftText.trim().length < 40} onClick={saveDraft}>Save draft</Button>
                            <Button variant="ghost" onClick={() => { setEditing(false); setDraftError('') }}>Cancel</Button>
                          </div>
                        ) : (
                          <>
                            <div className="draft-tools">
                              <Button variant="secondary" icon="edit" onClick={() => { setDraftText(draft.text); setEditing(true) }}>Edit</Button>
                              <Button variant="ghost" icon="sparkles" loading={busy === 'analyze'} onClick={regenerate}>Re-draft</Button>
                            </div>
                            <Button size="lg" icon="send" onClick={() => setConfirmOpen(true)}>
                              {dispute.source === 'paypal' ? 'Submit to PayPal' : 'Submit response'}
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              )}

              <Card title="Evidence pack" subtitle="Items cited in the response are highlighted. Click a citation in the draft to jump here." bodyClass="flush" className="flush">
                <div style={{ paddingTop: 8 }}><EvidencePack order={order} cited={cited} focusId={focusId} /></div>
              </Card>
            </div>

            <div className="stack">
              {analysis && (
                <Card title="Gap analysis" subtitle={`What PayPal typically needs for ${dispute.reasonLabel.toLowerCase()} claims`} action={<AiBadge by={analysis.generatedBy} model={analysis.model} />}>
                  <div className="stack">
                    <ul className="checklist">
                      {analysis.requiredEvidence.map((type) => {
                        const have = analysis.haveEvidence.includes(type)
                        return (
                          <li key={type}>
                            <span className={`evidence-status ${have ? 'present' : 'missing'}`}>{have && <Icon name="check" size={14} strokeWidth={2.6} />}</span>
                            <span><span className="strong">{EVIDENCE_LABELS[type]}</span>{!have && <span className="badge danger" style={{ marginLeft: 8 }}>Missing</span>}</span>
                          </li>
                        )
                      })}
                    </ul>
                    {analysis.helpfulEvidence.length > 0 && <p className="small muted">Also supporting the case: {analysis.helpfulEvidence.map((type) => EVIDENCE_LABELS[type].toLowerCase()).join(', ')}.</p>}
                    <p className="small" style={{ color: 'var(--ink-900)' }}>{analysis.reasoning}</p>
                    {analysis.gapActions.length > 0 && !submitted && (
                      <div className="stack-sm">
                        <div className="section-title" style={{ marginBottom: 0 }}>Close the gap before you submit</div>
                        {analysis.gapActions.map((gap) => (
                          <Alert key={gap.evidenceType} tone="warning" title={EVIDENCE_LABELS[gap.evidenceType] || gap.evidenceType}
                            action={<Link className="btn btn-secondary btn-sm" to={`/orders/${order.id}`}>Fix</Link>}>
                            {gap.action}
                          </Alert>
                        ))}
                        <p className="tiny muted">After adding evidence, choose Re-draft so the response cites it.</p>
                      </div>
                    )}
                  </div>
                </Card>
              )}

              <Card title="Case timeline">
                <ol className="case-timeline">
                  {[...dispute.timeline].reverse().map((entry, index) => (
                    <li key={`${entry.at}-${index}`}>
                      <span className={`ct-icon ${entry.kind || ''}`}><Icon name={timelineIcon(entry.event)} size={15} strokeWidth={2} /></span>
                      <div className="ct-body">
                        <div className="ct-head"><span className="ct-event">{entry.event}</span><time className="ct-time" dateTime={entry.at}>{dateTime(entry.at)}</time></div>
                        {entry.note && <div className="ct-note" title={entry.note}>{entry.note.replace(/\s*\((gemini|claude)[^)]*\)/gi, '')}</div>}
                      </div>
                    </li>
                  ))}
                </ol>
              </Card>
            </div>
          </div>

          <SubmitModal open={confirmOpen} onClose={() => setConfirmOpen(false)} dispute={dispute} preview={resource.data.preview} busy={busy === 'submit'} onConfirm={submit} />
        </>
      )}
    </>
  )
}

function aiFallbackReason(error = '') {
  if (/quota/i.test(error)) {
    const until = error.match(/until (.+)$/i)?.[1]
    return `Gemini's daily quota is used up${until ? `; AI drafting resumes ${until.replace(/\s*GMT$/, ' GMT')}` : ''}. Re-draft after that for an AI-written version.`
  }
  return 'The AI model did not respond, so a template built from your evidence was used.'
}

function timelineIcon(event = '') {
  const e = event.toLowerCase()
  if (e.includes('drafted')) return 'edit'
  if (e.includes('gap analysis')) return 'file-search'
  if (e.includes('evidence pack')) return 'shield-check'
  if (e.includes('filed') || e.includes('submitted')) return 'send'
  if (e.includes('opened')) return 'scale'
  if (e.includes('refresh') || e.includes('sync')) return 'refresh'
  if (e.includes('resolved')) return 'check-circle'
  return 'activity'
}

function DraftView({ text, citations, limit, onCite }) {
  const [copied, setCopied] = useState(false)
  const parts = text.split(/(\[EV-[A-Z0-9-]+\])/g)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked; the text is still selectable */
    }
  }
  return (
    <div className="draft-doc">
      <div className="draft-doc-bar">
        <span className="draft-doc-title"><Icon name="file" size={16} /> Letter to PayPal Resolution</span>
        <span className="draft-doc-meta">{text.length.toLocaleString()} / {limit.toLocaleString()} characters · {citations} {citations === 1 ? 'citation' : 'citations'}</span>
        <button type="button" className="draft-copy" onClick={copy} aria-live="polite">
          <Icon name={copied ? 'copied' : 'copy'} size={15} /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="draft-view">
        {parts.map((part, index) => {
          const match = part.match(/^\[(EV-[A-Z0-9-]+)\]$/)
          return match
            ? <button key={index} type="button" className="cite" onClick={() => onCite(match[1])} title="Show this evidence in the pack"><Icon name="shield-check" size={12} strokeWidth={2.2} />{match[1]}</button>
            : <span key={index}>{part}</span>
        })}
      </div>
    </div>
  )
}

function Receipt({ submission }) {
  const live = submission.mode === 'paypal_sandbox'
  return (
    <div className={`receipt ${live ? '' : 'simulated'}`}>
      <div className="row-sm" style={{ marginBottom: 8 }}>
        <Icon name="check-circle" size={20} />
        <strong>{live ? 'Evidence accepted by PayPal' : 'Response filed (simulation, not sent to PayPal)'}</strong>
      </div>
      <dl className="dl">
        <dt>Submitted</dt><dd>{dateTime(submission.at)}</dd>
        <dt>Evidence types</dt><dd>{submission.evidenceTypes.map((t) => titleCase(t)).join(', ')}</dd>
        <dt>Files attached</dt><dd>{submission.files.length ? submission.files.join(', ') : 'None'}</dd>
        <dt>Characters</dt><dd>{submission.characters}</dd>
        {submission.debugId && <><dt>PayPal debug id</dt><dd className="mono">{submission.debugId}</dd></>}
        {!live && <><dt>Note</dt><dd>{submission.response}</dd></>}
      </dl>
    </div>
  )
}

function SubmitModal({ open, onClose, dispute, preview, busy, onConfirm }) {
  const [showPayload, setShowPayload] = useState(false)
  const live = dispute.source === 'paypal'
  if (!preview) return null
  return (
    <Modal open={open} onClose={onClose} wide title={live ? 'Submit evidence to PayPal' : 'Submit response (simulation)'}
      subtitle={live ? 'This calls the PayPal Disputes API for this sandbox case.' : 'Simulated disputes do not exist in PayPal. The payload below is recorded locally exactly as it would be sent.'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon="send" loading={busy} onClick={onConfirm}>{live ? 'Submit to PayPal' : 'File response'}</Button></>}>
      <div className="stack">
        <dl className="dl">
          <dt>Endpoint</dt><dd className="mono">{preview.endpoint}</dd>
          <dt>Evidence</dt><dd>{preview.input.evidences.map((e) => e.evidence_type).join(', ')}</dd>
          <dt>Files</dt><dd>{preview.files.length ? preview.files.map((f) => f.name).join(', ') : 'None'}</dd>
          <dt>Response</dt><dd>{dispute.draft.text.length} characters · {dispute.draft.citedEvidenceIds.length} citations</dd>
        </dl>
        <Alert tone="info" title="Before you submit">PayPal usually allows one evidence submission per stage. Make sure the response says everything you want it to say.</Alert>
        <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowPayload((v) => !v)}>
          <Icon name={showPayload ? 'chevron-down' : 'chevron-right'} size={15} /> {showPayload ? 'Hide' : 'Show'} request payload
        </button>
        {showPayload && <pre className="payload">{JSON.stringify(preview.input, null, 2)}</pre>}
      </div>
    </Modal>
  )
}
