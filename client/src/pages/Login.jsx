import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/providers.jsx'
import { Button, Field } from '../components/ui.jsx'
import { BrandMark, Icon } from '../components/Icon.jsx'

export default function Login() {
  const { user, status, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('merchant@proofpilot.local')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { document.title = 'Seller login · ProofPilot' }, [])

  if (status === 'ready' && user) return <Navigate to={location.state?.from || '/'} replace />

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(email.trim(), password)
      navigate(location.state?.from || '/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <main className="auth-card">
        <div className="auth-logo"><BrandMark size={40} /><span>ProofPilot</span></div>
        <form className="auth-form" onSubmit={submit} noValidate>
          <div className="auth-intro">
            <h1>Log in to your seller console</h1>
            <p>Orders, evidence and PayPal disputes in one place.</p>
          </div>
          <Field label="Email">
            {(id) => <input id={id} className="input input-lg" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />}
          </Field>
          <Field label="Password" hint="Set by DEMO_PASSWORD on the server.">
            {(id) => <input id={id} className="input input-lg" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />}
          </Field>
          {error && <div className="form-error" role="alert"><Icon name="alert" size={16} />{error}</div>}
          <Button type="submit" size="lg" block loading={busy} disabled={!email || !password}>Log in</Button>
        </form>
        <div className="auth-divider"><span>or</span></div>
        <Link className="btn btn-secondary btn-lg btn-block" to="/store">Shop as a buyer</Link>
      </main>
      <ul className="auth-points">
        <li><Icon name="shield-check" size={18} /> Evidence built at checkout</li>
        <li><Icon name="flag" size={18} /> Risky orders flagged before you ship</li>
        <li><Icon name="sparkles" size={18} /> Dispute responses drafted with cited evidence</li>
      </ul>
      <footer className="auth-foot">PayPal AI Hackathon 2026 · Sandbox environment</footer>
    </div>
  )
}
