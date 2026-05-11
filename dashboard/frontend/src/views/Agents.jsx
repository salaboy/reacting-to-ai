import { useState } from 'react'
import { usePolling } from '../usePolling.js'
import { api } from '../api.js'

const STATUS_TONE = {
  pending: 'muted',
  browsing: 'info',
  evaluated: 'ok',
  passed: 'ok',
  failed: 'err',
  creating_issue: 'info',
  issue_created: 'ok',
  error: 'err',
  cloning: 'info',
  investigating: 'info',
  no_fix_needed: 'muted',
  existing_pr_found: 'warn',
  creating_pr: 'info',
  pr_created: 'ok',
  sending: 'info',
  accepted: 'ok',
  firing: 'err',
  resolved: 'ok',
}

function fmtTime(ts) {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleTimeString()
  } catch {
    return ts
  }
}

function Panel({ title, source, items, render, onClick, error }) {
  return (
    <div className="panel">
      <h3>
        {title}
        {items != null && <span style={{ float: 'right', color: 'var(--muted)' }}>{items.length}</span>}
      </h3>
      {error && <div className="unavailable">unavailable: {error}</div>}
      {!error && items != null && items.length === 0 && <div className="empty">No {source} yet</div>}
      {!error && items != null && items.length > 0 && (
        <div className="list">
          {items.slice(0, 20).map((item) => (
            <div key={item.id || item.fingerprint || JSON.stringify(item).slice(0, 40)}
                 className="row"
                 onClick={() => onClick(item)}>
              {render(item)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function Agents() {
  const [drawer, setDrawer] = useState(null)
  const businessRes = usePolling(api.businessEvaluations, 3000).data
  const fixerRes = usePolling(api.fixerInvestigations, 3000).data
  const monitorAlertsRes = usePolling(api.monitorAlerts, 3000).data
  const monitorInvRes = usePolling(api.monitorInvestigations, 3000).data

  const evaluations = unwrap(businessRes)
  const investigations = unwrap(fixerRes)
  const alerts = unwrap(monitorAlertsRes)
  const monitorInvs = unwrap(monitorInvRes)

  return (
    <>
      <div className="columns">
        <Panel
          title="Business — evaluations"
          source="evaluations"
          items={evaluations.data}
          error={evaluations.error}
          onClick={(e) => setDrawer({ kind: 'evaluation', id: e.id, summary: e })}
          render={(e) => (
            <>
              <div>
                <div className="primary">{e.url || e.id}</div>
                <div className="secondary">{e.id} · {fmtTime(e.createdAt)}</div>
              </div>
              <span className={`pill ${STATUS_TONE[e.status] || 'muted'}`}>{e.status}</span>
            </>
          )}
        />
        <Panel
          title="Fixer — investigations"
          source="investigations"
          items={investigations.data}
          error={investigations.error}
          onClick={(e) => setDrawer({ kind: 'investigation', id: e.id, summary: e })}
          render={(e) => (
            <>
              <div>
                <div className="primary">{e.alert_name || e.id}</div>
                <div className="secondary">
                  {e.id} · {fmtTime(e.createdAt)}
                  {e.pr_url && <> · <a href={e.pr_url} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}>PR</a></>}
                </div>
              </div>
              <span className={`pill ${STATUS_TONE[e.status] || 'muted'}`}>{e.status}</span>
            </>
          )}
        />
        <Panel
          title="Monitor — alerts"
          source="alerts"
          items={alerts.data}
          error={alerts.error}
          onClick={(a) => setDrawer({ kind: 'alert', summary: a })}
          render={(a) => (
            <>
              <div>
                <div className="primary">{a.labels?.alertname || 'alert'}</div>
                <div className="secondary">
                  {a.labels?.service_name || ''} · {fmtTime(a.startsAt)}
                  {a.relatedTraces?.length > 0 && <> · {a.relatedTraces.length} traces</>}
                </div>
              </div>
              <span className={`pill ${STATUS_TONE[a.status] || 'muted'}`}>{a.status}</span>
            </>
          )}
        />
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <h3>Monitor → Fixer handoffs</h3>
        {monitorInvs.error && <div className="unavailable">unavailable: {monitorInvs.error}</div>}
        {!monitorInvs.error && (monitorInvs.data?.length ?? 0) === 0 && <div className="empty">No handoffs yet</div>}
        {!monitorInvs.error && monitorInvs.data?.length > 0 && (
          <div className="list">
            {monitorInvs.data.slice(0, 10).map((h, i) => (
              <div key={i} className="row" onClick={() => setDrawer({ kind: 'handoff', summary: h })}>
                <div>
                  <div className="primary">{h.alert_name}</div>
                  <div className="secondary">{h.alert_fingerprint?.slice(0, 12)} · {fmtTime(h.createdAt)}</div>
                </div>
                <span className={`pill ${STATUS_TONE[h.status] || 'muted'}`}>{h.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {drawer && <Drawer drawer={drawer} onClose={() => setDrawer(null)} />}
    </>
  )
}

function Drawer({ drawer, onClose }) {
  const detail = useDrawerDetail(drawer)
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer">
        <button className="close" onClick={onClose}>Close</button>
        <h2>{drawerTitle(drawer)}</h2>
        <pre>{JSON.stringify(detail || drawer.summary, null, 2)}</pre>
      </div>
    </>
  )
}

function drawerTitle(drawer) {
  switch (drawer.kind) {
    case 'evaluation': return `Evaluation ${drawer.id}`
    case 'investigation': return `Investigation ${drawer.id}`
    case 'alert': return `Alert ${drawer.summary?.labels?.alertname || ''}`
    case 'handoff': return `Handoff ${drawer.summary?.alert_name || ''}`
    default: return 'Detail'
  }
}

function useDrawerDetail(drawer) {
  const fn =
    drawer.kind === 'evaluation' && drawer.id ? () => api.businessEvaluation(drawer.id) :
    drawer.kind === 'investigation' && drawer.id ? () => api.fixerInvestigation(drawer.id) :
    null
  const { data } = usePolling(
    fn || (async () => null),
    5000,
    [drawer.kind, drawer.id],
  )
  if (!fn) return null
  return unwrap(data).data
}

// unwrap normalises the { source, data, error } envelope so views can read .data / .error.
function unwrap(res) {
  if (!res) return { data: null, error: null }
  if (res.error) return { data: null, error: res.error }
  return { data: res.data, error: null }
}
