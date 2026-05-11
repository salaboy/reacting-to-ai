import { usePolling } from '../usePolling.js'
import { api } from '../api.js'

function fmtDate(s) {
  if (!s) return ''
  try {
    return new Date(s).toLocaleString()
  } catch {
    return s
  }
}

function tone(state) {
  if (state === 'open') return 'info'
  if (state === 'closed') return 'muted'
  if (state === 'merged') return 'ok'
  return 'muted'
}

export function Github() {
  const prsRes = usePolling(api.githubPRs, 5000).data
  const issRes = usePolling(api.githubIssues, 5000).data

  const prs = unwrap(prsRes)
  const issues = unwrap(issRes)

  return (
    <div className="columns" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <div className="panel">
        <h3>Pull requests</h3>
        {prs.error && <div className="unavailable">unavailable: {prs.error}</div>}
        {!prs.error && (prs.data?.length ?? 0) === 0 && <div className="empty">No PRs</div>}
        {!prs.error && prs.data?.length > 0 && (
          <div className="list">
            {prs.data.slice(0, 30).map((pr) => (
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
                <span className={`pill ${tone(pr.merged_at ? 'merged' : pr.state)}`}>
                  {pr.merged_at ? 'merged' : pr.state}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>
      <div className="panel">
        <h3>Issues</h3>
        {issues.error && <div className="unavailable">unavailable: {issues.error}</div>}
        {!issues.error && (issues.data?.length ?? 0) === 0 && <div className="empty">No issues</div>}
        {!issues.error && issues.data?.length > 0 && (
          <div className="list">
            {issues.data.slice(0, 30).map((iss) => {
              const fromBusiness = (iss.labels || []).some(
                (l) => (l.name || '').toLowerCase().includes('business'),
              )
              return (
                <a key={iss.id}
                   className="row"
                   href={iss.html_url}
                   target="_blank"
                   rel="noreferrer"
                   style={{ textDecoration: 'none' }}>
                  <div>
                    <div className="primary">#{iss.number} {iss.title}</div>
                    <div className="secondary">
                      {iss.user?.login} · {fmtDate(iss.created_at)}
                      {fromBusiness && <> · <span style={{ color: 'var(--purple)' }}>business-agent</span></>}
                    </div>
                  </div>
                  <span className={`pill ${tone(iss.state)}`}>{iss.state}</span>
                </a>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function unwrap(res) {
  if (!res) return { data: null, error: null }
  if (res.error) return { data: null, error: res.error }
  return { data: res.data, error: null }
}
