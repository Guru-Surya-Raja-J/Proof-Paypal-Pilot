import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './Icon.jsx'
import { useNow, useResource } from '../lib/providers.jsx'

const KIND_ICON = { success: 'check-circle', warning: 'alert', danger: 'flag', ai: 'sparkles', paypal: 'link', info: 'activity' }

const refPath = (ref) => (ref?.type === 'order' ? `/orders/${ref.id}` : ref?.type === 'dispute' ? `/disputes/${ref.id}` : null)

/** Picks a specific icon from what the agent did; falls back to the event's kind. */
function iconFor(item) {
  const action = item.action.toLowerCase()
  if (action.includes('draft')) return 'edit'
  if (action.includes('filed') || action.includes('submitted')) return 'send'
  if (action.includes('delivery') || action.includes('confirmed receipt')) return 'check-circle'
  if (action.includes('wrote') || action.includes('replied')) return 'message'
  if (action.includes('tracking')) return 'truck'
  if (action.includes('evidence pack')) return 'shield-check'
  if (action.includes('communication') || action.includes('message')) return 'message'
  if (action.includes('dispute')) return 'scale'
  if (action.includes('explained')) return 'sparkles'
  if (action.includes('demo')) return 'database'
  return KIND_ICON[item.kind] || 'activity'
}

function dayLabel(iso, now) {
  const date = new Date(iso)
  const today = new Date(now)
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  if (date.getTime() >= startOfToday) return 'Today'
  if (date.getTime() >= startOfToday - 86400_000) return 'Yesterday'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** "Win likelihood high · 4 citations · 11.4s · Gemini (gemini-2.5-flash)" keeps the facts, drops the model id. */
function shortAgo(iso, now) {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

const tidyDetail = (detail = '') => detail.replace(/\s*\((gemini|claude)[^)]*\)/gi, '')

export function ActivityFeed({ limit = 12, initial = limit }) {
  const [expanded, setExpanded] = useState(false)
  const { data, loading } = useResource(`/activity?limit=${limit}`, { liveTypes: ['activity'] })
  const now = useNow(30_000)
  const items = data?.activity || []

  if (loading && !data) {
    return (
      <div className="card-body stack-sm">
        {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 44 }} />)}
      </div>
    )
  }
  if (!items.length) {
    return <div className="card-body muted small">Nothing yet. Every step the agent takes shows up here as it happens.</div>
  }

  const hidden = expanded ? 0 : Math.max(0, items.length - initial)
  const shown = hidden ? items.slice(0, initial) : items
  const groups = []
  for (const item of shown) {
    const label = dayLabel(item.at, now)
    if (groups.at(-1)?.label !== label) groups.push({ label, items: [] })
    groups.at(-1).items.push(item)
  }

  return (
    <div className={`timeline-feed ${expanded ? 'is-expanded' : ''}`}>
      <div className="tf-scroll">
      {groups.map((group) => (
        <section key={group.label} className="tf-group" aria-label={group.label}>
          <h3 className="tf-day">{group.label}</h3>
          <ol className="tf-list" aria-live="polite">
            {group.items.map((item) => {
              const path = refPath(item.ref)
              return (
                <li key={item.id} className="tf-item">
                  <span className={`tf-icon ${item.kind}`}><Icon name={iconFor(item)} size={16} strokeWidth={2} /></span>
                  <div className="tf-body">
                    <div className="tf-head">
                      <span className="tf-action">{item.action}</span>
                      <time className="tf-time" dateTime={item.at} title={new Date(item.at).toLocaleString()}>{shortAgo(item.at, now)}</time>
                    </div>
                    <div className="tf-detail">
                      {path ? <Link to={path} className="tf-target">{item.target}</Link> : <span className="tf-target">{item.target}</span>}
                      {item.detail && <> · {tidyDetail(item.detail)}</>}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
      </div>
      {(hidden > 0 || (expanded && items.length > initial)) && (
        <button type="button" className="feed-more" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          {expanded ? 'Show less' : `Show ${hidden} more`}
          <Icon name="chevron-down" size={16} className={expanded ? 'flip' : undefined} />
        </button>
      )}
    </div>
  )
}
