import { usePolling } from '../usePolling.js'
import { api } from '../api.js'

export function Overview({ onNavigate }) {
  const { data, loading } = usePolling(api.overview, 3000)

  if (loading) return <div className="empty">Loading…</div>
  if (data?.error) return <div className="unavailable">Dashboard backend unavailable: {data.error}</div>

  const ev = data?.evaluations ?? {}
  const inv = data?.investigations ?? {}
  const al = data?.alerts ?? {}
  const gh = data?.github ?? {}
  const errs = data?.errors ?? {}

  return (
    <>
      <div className="cards">
        <Card
          label="Evaluations"
          value={ev.total ?? 0}
          sub={`${ev.passed ?? 0} passed · ${ev.failed ?? 0} failed · ${ev.pending ?? 0} pending`}
          onClick={() => onNavigate('agents')}
          unavailable={errs.business}
        />
        <Card
          label="Investigations"
          value={inv.total ?? 0}
          sub={`${inv.pr_created ?? 0} PRs · ${inv.investigating ?? 0} running · ${inv.error ?? 0} error`}
          onClick={() => onNavigate('agents')}
          unavailable={errs.fixer}
        />
        <Card
          label="Alerts firing"
          value={al.firing ?? 0}
          tone={al.firing > 0 ? 'alert' : 'ok'}
          sub={`${al.resolved ?? 0} resolved`}
          onClick={() => onNavigate('agents')}
          unavailable={errs.monitor}
        />
        <Card
          label="PRs open"
          value={gh.prs_open ?? 0}
          sub="GitHub"
          onClick={() => onNavigate('github')}
          unavailable={errs.github_prs}
        />
        <Card
          label="Issues open"
          value={gh.issues_open ?? 0}
          sub="GitHub"
          onClick={() => onNavigate('github')}
          unavailable={errs.github_issues}
        />
        <Card
          label="System"
          value={Object.keys(errs).length === 0 ? 'OK' : 'Degraded'}
          tone={Object.keys(errs).length === 0 ? 'ok' : 'alert'}
          sub={`${Object.keys(errs).length} source(s) unavailable`}
          onClick={() => onNavigate('stability')}
        />
      </div>
      {Object.entries(errs).length > 0 && (
        <div className="panel">
          <h3>Unavailable sources</h3>
          {Object.entries(errs).map(([k, v]) => (
            <div key={k} className="unavailable" style={{ marginBottom: 4 }}>
              <strong>{k}:</strong> {v}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function Card({ label, value, sub, tone, onClick, unavailable }) {
  return (
    <div className={`card ${tone || ''}`} onClick={onClick} style={onClick ? { cursor: 'pointer' } : null}>
      <div className="label">{label}</div>
      <div className="value">{unavailable ? '—' : value}</div>
      <div className="sub">{unavailable ? 'source unavailable' : sub}</div>
    </div>
  )
}
