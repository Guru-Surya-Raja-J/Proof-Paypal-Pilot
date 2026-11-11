import { useState } from 'react'
import { Icon } from './Icon.jsx'
import { Badge, KeyValues } from './ui.jsx'
import { attachmentUrl } from '../lib/api.js'

/**
 * Evidence pack list. `cited` highlights items referenced by a dispute draft;
 * `focusId` expands and flashes one item (clicked from a citation).
 */
export function EvidencePack({ order, items, cited, focusId, onlyIds }) {
  const [open, setOpen] = useState(() => new Set())
  const list = (items || order.evidence.items).filter((item) => !onlyIds || onlyIds.includes(item.id))
  const toggle = (id) => setOpen((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return (
    <div className="evidence-list">
      {list.map((item) => {
        const expanded = open.has(item.id) || focusId === item.id
        const files = order.attachments.filter((file) => item.files.includes(file.id))
        return (
          <div key={item.id} id={`evidence-${item.id}`} className={`evidence-item ${cited?.has(item.id) ? 'cited' : ''} ${focusId === item.id ? 'flash' : ''}`}>
            <button type="button" className="evidence-row" onClick={() => toggle(item.id)} aria-expanded={expanded}>
              <span className={`evidence-status ${item.present ? 'present' : 'missing'}`}>
                {item.present && <Icon name="check" size={14} strokeWidth={2.6} />}
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="evidence-title">
                  {item.label}
                  <span className="evidence-id">{item.id}</span>
                  {item.present && item.verified && <Badge tone="success" icon="shield-check">Verified</Badge>}
                  {cited?.has(item.id) && <Badge tone="info">Cited</Badge>}
                </span>
                <span className="evidence-summary" style={{ display: 'block' }}>{item.summary}</span>
                <span className="evidence-source" style={{ display: 'block' }}>Source: {item.source}{files.length ? ` · ${files.length} ${files.length === 1 ? 'file' : 'files'}` : ''}</span>
              </span>
              <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={18} className="muted" />
            </button>
            {expanded && (
              <div className="evidence-detail stack-sm">
                {item.present && item.data ? <KeyValues data={item.data} /> : <p className="muted small">Nothing collected yet for this evidence type.</p>}
                {files.length > 0 && (
                  <div className="files">
                    {files.map((file) => (
                      <div key={file.id} className="file">
                        <Icon name="file" size={16} />
                        <a href={attachmentUrl(order.id, file.id)} target="_blank" rel="noreferrer">{file.name}</a>
                        <span className="muted tiny">{Math.max(1, Math.round(file.size / 1024))} KB</span>
                      </div>
                    ))}
                  </div>
                )}
                {item.present && <p className="tiny muted">Collected {item.collectedAt ? new Date(item.collectedAt).toLocaleString() : '-'}</p>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
