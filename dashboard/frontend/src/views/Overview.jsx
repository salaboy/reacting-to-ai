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
  open: 'info',
}

function fmtTime(ts) {
  if (!ts) return ''
  try { return new Date(ts).toLocaleTimeString() } catch { return ts }
}

function fmtDate(s) {
  if (!s) return ''
  try { return new Date(s).toLocaleString() } catch { return s }
}

function unwrap(res) {
  if (!res) return { data: null, error: null }
  if (res.error) return { data: null, error: res.error }
  return { data: res.data, error: null }
}

function evalTone(e) {
  if (e.passed === true) return 'ok'
  if (e.passed === false) return 'err'
  return STATUS_TONE[e.status] || 'muted'
}

function evalLabel(e) {
  if (e.passed === true) return 'passed'
  if (e.passed === false) return 'failed'
  return e.status || 'pending'
}

export function Overview() {
  const [drawer, setDrawer] = useState(null)

  const alertsRes = usePolling(api.monitorAlerts, 3000).data
  const investigationsRes = usePolling(api.fixerInvestigations, 3000).data
  const prsRes = usePolling(api.githubPRsOpen, 5000).data
  const evaluationsRes = usePolling(api.businessEvaluations, 3000).data

  const alerts = unwrap(alertsRes)
  const investigations = unwrap(investigationsRes)
  const prs = unwrap(prsRes)
  const evaluations = unwrap(evaluationsRes)

  const evalPassed = (evaluations.data || []).filter((e) => e.passed === true).length
  const evalFailed = (evaluations.data || []).filter((e) => e.passed === false).length
  const evalPending = (evaluations.data || []).length - evalPassed - evalFailed
  const alertsFiring = (alerts.data || []).filter((a) => a.status === 'firing').length

  return (
    <>
      <div className="columns two">
        <Panel
          title="Alerts"
          count={alerts.data?.length}
          subtitle={`${alertsFiring} firing`}
          error={alerts.error}
          emptyLabel="alerts"
          items={alerts.data}
          render={(a) => (
            <div className="row" key={a.fingerprint || JSON.stringify(a).slice(0, 40)}
                 onClick={() => setDrawer({ kind: 'alert', summary: a })}>
              <div>
                <div className="primary">{a.labels?.alertname || 'alert'}</div>
                <div className="secondary">
                  {a.labels?.service_name || ''} · {fmtTime(a.startsAt)}
                  {a.relatedTraces?.length > 0 && <> · {a.relatedTraces.length} traces</>}
                </div>
              </div>
              <span className={`pill ${STATUS_TONE[a.status] || 'muted'}`}>{a.status}</span>
            </div>
          )}
        />

        <Panel
          title="Investigations"
          count={investigations.data?.length}
          error={investigations.error}
          emptyLabel="investigations"
          items={investigations.data}
          render={(e) => (
            <div className="row" key={e.id}
                 onClick={() => setDrawer({ kind: 'investigation', id: e.id, summary: e })}>
              <div>
                <div className="primary">{e.alert_name || e.id}</div>
                <div className="secondary">
                  {e.id} · {fmtTime(e.createdAt)}
                  {e.pr_url && <> · <a href={e.pr_url} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}>PR</a></>}
                </div>
              </div>
              <span className={`pill ${STATUS_TONE[e.status] || 'muted'}`}>{e.status}</span>
            </div>
          )}
        />

        <Panel
          title="Pull requests (open)"
          count={prs.data?.length}
          error={prs.error}
          emptyLabel="open PRs"
          items={prs.data}
          render={(pr) => (
            <a key={pr.id}
               className="row"
               href={pr.html_url}
               target="_blank"
               rel="noreferrer"
               style={{ textDecoration: 'none' }}>
              <div>
                <div className="primary">#{pr.number} {pr.title}</div>
                <div className="secondary">
                  {pr.user?.login} · {fmtDate(pr.created_at)} · {pr.comments ?? 0} comments
                </div>
              </div>
              <span className="pill info">open</span>
            </a>
          )}
        />

        <Panel
          title="Evaluations"
          count={evaluations.data?.length}
          subtitle={
            <>
              <span className="pill ok" style={{ marginRight: 6 }}>{evalPassed} passed</span>
              <span className="pill err" style={{ marginRight: 6 }}>{evalFailed} failed</span>
              {evalPending > 0 && <span className="pill muted">{evalPending} pending</span>}
            </>
          }
          error={evaluations.error}
          emptyLabel="evaluations"
          items={evaluations.data}
          render={(e) => (
            <div key={e.id}
                 className={`row eval ${evalTone(e)}`}
                 onClick={() => setDrawer({ kind: 'evaluation', id: e.id, summary: e })}>
              <div>
                <div className="primary">{e.url || e.id}</div>
                <div className="secondary">{e.id} · {fmtTime(e.createdAt)}</div>
              </div>
              <span className={`pill ${evalTone(e)}`}>{evalLabel(e)}</span>
            </div>
          )}
        />
      </div>

      {drawer && <Drawer drawer={drawer} onClose={() => setDrawer(null)} />}
    </>
  )
}

function Panel({ title, count, subtitle, error, emptyLabel, items, render }) {
  return (
    <div className="panel">
      <h3>
        {title}
        {count != null && <span style={{ float: 'right', color: 'var(--muted)' }}>{count}</span>}
      </h3>
      {subtitle && <div className="panel-sub">{subtitle}</div>}
      {error && <div className="unavailable">unavailable: {error}</div>}
      {!error && items != null && items.length === 0 && <div className="empty">No {emptyLabel} yet</div>}
      {!error && items != null && items.length > 0 && (
        <div className="list">
          {items.slice(0, 30).map((item) => render(item))}
        </div>
      )}
    </div>
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
