import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../lib/api.js'
import { useNow, useResource, useToast } from '../lib/providers.jsx'
import { timeAgo } from '../lib/format.js'
import { Alert, Badge, Button, Card, ErrorState, Loading, Modal } from '../components/ui.jsx'
import { Icon } from '../components/Icon.jsx'

export default function Settings() {
  const { data, error, reload } = useResource('/integrations', { liveTypes: ['sync'] })
  const notify = useToast()
  const now = useNow(30_000)
  const [busy, setBusy] = useState('')
  const [resetOpen, setResetOpen] = useState(false)
  const { hash } = useLocation()
  const loaded = Boolean(data)
  useEffect(() => {
    if (loaded && hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [loaded, hash])

  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return <Loading label="Checking integrations" />

  const { paypal, ai, storage, webhooks } = data
  const live = paypal.mode === 'sandbox'
  // The real state of the keys comes from the last call PayPal answered, not from whether they are set.
  // The most recent OAuth check wins; older sync/webhook errors only count when there is no check yet.
  const lastError = paypal.lastConnection
    ? (paypal.lastConnection.ok ? '' : paypal.lastConnection.error || '')
    : data.disputeSync?.error || webhooks?.error || ''
  const authFailed = live && /oauth|authentication/i.test(lastError)
  const paypalOk = live && !authFailed && (paypal.lastConnection?.ok || (data.disputeSync?.at && !data.disputeSync.error))
  const paypalState = !live ? { tone: 'warning', label: 'Simulation mode' } : authFailed ? { tone: 'danger', label: 'Keys rejected' } : paypalOk ? { tone: 'success', label: 'Connected' } : { tone: 'outline', label: 'Not checked yet' }
  const webhookSteps = [
    { done: Boolean(data.webhookUrl), title: 'Public URL', text: data.webhookUrl ? <span className="mono">{data.webhookUrl}</span> : <>Set <code>PUBLIC_URL</code> to this server's public https address.</> },
    { done: Array.isArray(webhooks) && webhooks.some((hook) => hook.url === data.webhookUrl), title: 'Webhook registered with PayPal', text: 'Use Register webhook once the public URL is set.' },
    { done: paypal.webhookConfigured, title: 'Signature verification', text: <>Set <code>PAYPAL_WEBHOOK_ID</code> to the webhook id and restart. Until then incoming events are rejected.</> }
  ]

  async function run(kind, fn) {
    setBusy(kind)
    try {
      await fn()
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setBusy('')
    }
  }

  const testPayPal = () => run('test', async () => {
    const { connection } = await api('/integrations/paypal/test', { method: 'POST' })
    notify(`PayPal OAuth succeeded (app ${connection.appId || 'connected'})`, 'success')
    reload()
  })
  const registerWebhook = () => run('webhook', async () => {
    const result = await api('/integrations/paypal/webhook', { method: 'POST' })
    notify(result.existing ? 'Webhook was already registered' : 'Webhook registered with PayPal', 'success')
    reload()
  })
  const loadDemo = () => run('demo', async () => {
    await api('/workspace/demo', { method: 'POST' })
    notify('Demo scenario loaded', 'success')
  })
  const reset = () => run('reset', async () => {
    await api('/workspace/reset', { method: 'POST' })
    setResetOpen(false)
    notify('Workspace cleared', 'success')
  })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>The connections ProofPilot uses. Each status comes from a live check.</p>
        </div>
      </div>

      <div className="status-tiles">
        <a href="#paypal" className={`status-tile ${paypalState.tone}`}>
          <span className="status-tile-icon"><Icon name="link" size={20} /></span>
          <span><span className="status-tile-name">PayPal</span><span className="status-tile-state">{paypalState.label}</span></span>
        </a>
        <a href="#ai" className={`status-tile ${ai.configured ? 'success' : 'warning'}`}>
          <span className="status-tile-icon"><Icon name="sparkles" size={20} /></span>
          <span><span className="status-tile-name">AI agent</span><span className="status-tile-state">{ai.configured ? `${ai.id === 'gemini' ? 'Gemini' : 'Claude'} connected` : 'Rules engine only'}</span></span>
        </a>
        <a href="#storage" className={`status-tile ${storage.backend === 'mongodb' ? 'success' : 'outline'}`}>
          <span className="status-tile-icon"><Icon name="database" size={20} /></span>
          <span><span className="status-tile-name">Storage</span><span className="status-tile-state">{storage.backend === 'mongodb' ? 'MongoDB' : 'Local file'}</span></span>
        </a>
      </div>

      <div className="stack">
        <Card id="paypal" title="PayPal" subtitle={`REST APIs · ${paypal.baseUrl.replace('https://', '')}`}
          action={<Badge tone={paypalState.tone} dot>{paypalState.label}</Badge>}>
          {live ? (
            <div className="stack">
              {authFailed && (
                <Alert tone="danger" title="PayPal rejected these sandbox keys">
                  Copy the Client ID and Secret again from developer.paypal.com → Apps &amp; Credentials (Sandbox), paste them into <code>server/.env</code>, restart the server and press Test connection.
                </Alert>
              )}
              <dl className="dl">
                <dt>Client ID</dt><dd className="mono">{paypal.clientId.slice(0, 12)}…{paypal.clientId.slice(-4)}</dd>
                <dt>Last OAuth check</dt>
                <dd>{paypal.lastConnection ? (paypal.lastConnection.ok ? `Succeeded ${timeAgo(paypal.lastConnection.at, now)}` : `Failed ${timeAgo(paypal.lastConnection.at, now)}`) : 'Not checked since server start'}</dd>
                <dt>APIs in use</dt><dd>Orders v2 (create, capture, track) · Disputes v1 (list, detail, provide-evidence) · Webhooks</dd>
                <dt>Dispute polling</dt>
                <dd>{data.pollSeconds > 0 ? `Every ${data.pollSeconds}s` : 'Off'}{data.disputeSync?.at && ` · last ${timeAgo(data.disputeSync.at, now)}${data.disputeSync.error ? ' (failed)' : ''}`}</dd>
              </dl>
              <div className="row wrap"><Button variant="secondary" icon="zap" loading={busy === 'test'} onClick={testPayPal}>Test connection</Button></div>

              <div className="subsection">
                <div className="row-between wrap">
                  <div>
                    <h3>Dispute webhook</h3>
                    <p className="small muted" style={{ marginTop: 2 }}>PayPal pushes dispute and refund events here, each verified with PayPal before it is trusted.</p>
                  </div>
                  <Button variant="secondary" size="sm" icon="link" loading={busy === 'webhook'} disabled={!data.webhookUrl || authFailed} onClick={registerWebhook}>Register webhook</Button>
                </div>
                <ol className="checklist-steps">
                  {webhookSteps.map((step, index) => (
                    <li key={step.title} className={step.done ? 'done' : ''}>
                      <span className="step-mark">{step.done ? <Icon name="check" size={14} strokeWidth={2.5} /> : index + 1}</span>
                      <div><div className="strong small">{step.title}</div><div className="tiny muted">{step.text}</div></div>
                    </li>
                  ))}
                </ol>
                {Array.isArray(webhooks) && webhooks.length > 0 && (
                  <div className="files">
                    {webhooks.map((hook) => (
                      <div key={hook.id} className="file">
                        <Icon name="link" size={16} />
                        <div className="grow"><div className="mono small">{hook.url}</div><div className="tiny muted">{hook.id} · {hook.events.length} event types</div></div>
                        {hook.url === data.webhookUrl && <Badge tone="info">This server</Badge>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="stack">
              <p className="small">Without sandbox credentials the storefront offers a clearly labelled simulated checkout and PayPal-side actions are recorded locally.</p>
              <SetupSteps steps={[
                <>Create a sandbox app at <a href="https://developer.paypal.com/dashboard/applications/sandbox" target="_blank" rel="noreferrer">developer.paypal.com</a> (Apps &amp; Credentials → Sandbox).</>,
                <>Add <code>PAYPAL_CLIENT_ID</code> and <code>PAYPAL_CLIENT_SECRET</code> to <code>server/.env</code> and restart the server.</>,
                <>Use a sandbox <em>personal</em> account to pay in the storefront, then open a dispute from that buyer account at sandbox.paypal.com to see it arrive here.</>
              ]} />
            </div>
          )}
        </Card>

        <Card id="ai" title="AI agent" subtitle={ai.provider} action={<Badge tone={ai.configured ? 'ai' : 'warning'} dot>{ai.configured ? `${ai.id === 'gemini' ? 'Gemini' : 'Claude'} connected` : 'Rules engine only'}</Badge>}>
          <div className="stack">
            <dl className="dl">
              <dt>Model</dt><dd className="mono">{ai.configured ? ai.model : '-'}</dd>
              <dt>Used for</dt><dd>Risk explanations, dispute gap analysis, cited response drafts</dd>
              <dt>Guardrail</dt><dd>Every cited evidence ID is checked against the pack; invalid drafts are regenerated, then fall back to a rules template</dd>
              <dt>Last call</dt>
              <dd>{ai.lastCall ? (ai.lastCall.ok ? `OK ${timeAgo(ai.lastCall.at, now)} · ${(ai.lastCall.ms / 1000).toFixed(1)}s` : `Failed ${timeAgo(ai.lastCall.at, now)}: ${ai.lastCall.error}`) : 'No calls since server start'}</dd>
            </dl>
            {!ai.configured && <SetupSteps steps={[<>Add <code>GEMINI_API_KEY</code> (or <code>ANTHROPIC_API_KEY</code>) to <code>server/.env</code> and restart.</>, <>Until then the deterministic engine writes explanations and drafts, and they are labelled "Rules engine".</>]} />}
          </div>
        </Card>

        <Card id="storage" title="Storage" action={<Badge tone={storage.backend === 'mongodb' ? 'success' : 'outline'} dot>{storage.backend === 'mongodb' ? 'MongoDB' : 'Local file'}</Badge>}>
          <p className="small">{storage.backend === 'mongodb'
            ? 'Orders, disputes, evidence files and sessions are stored in MongoDB.'
            : 'Data is stored in a JSON snapshot on the server disk. Set MONGODB_URI for durable storage on hosts with ephemeral disks (such as Render).'}</p>
        </Card>

        <Card title="Workspace" subtitle="Demo tools for presentations">
          <div className="row wrap">
            <Button variant="secondary" icon="database" loading={busy === 'demo'} onClick={loadDemo}>Load demo scenario</Button>
            <Button variant="danger" icon="trash" onClick={() => setResetOpen(true)}>Reset workspace</Button>
          </div>
          <p className="tiny muted" style={{ marginTop: 10 }}>Demo orders are labelled "Demo" everywhere and run through the same scoring, evidence and AI pipeline as live orders.</p>
        </Card>
      </div>

      <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="Reset workspace?" subtitle="This permanently deletes every order, dispute, evidence file and activity entry in ProofPilot. Nothing in PayPal is changed."
        footer={<><Button variant="ghost" onClick={() => setResetOpen(false)}>Cancel</Button><Button variant="danger" icon="trash" loading={busy === 'reset'} onClick={reset}>Delete everything</Button></>}>
        <Alert tone="warning">You cannot undo this.</Alert>
      </Modal>
    </>
  )
}

function SetupSteps({ steps }) {
  return (
    <ol className="small" style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {steps.map((step, index) => <li key={index}>{step}</li>)}
    </ol>
  )
}
