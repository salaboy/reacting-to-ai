import { useState, useEffect } from 'react'
import './App.css'

const STATUS_LABELS = {
  pending: 'Pending',
  cloning: 'Cloning repo',
  investigating: 'Investigating',
  creating_pr: 'Creating PR',
  pr_created: 'PR Created',
  no_fix_needed: 'No Fix Needed',
  error: 'Error',
}

const STATUS_COLORS = {
  pending: 'status-pending',
  cloning: 'status-active',
  investigating: 'status-active',
  creating_pr: 'status-active',
  pr_created: 'status-success',
  no_fix_needed: 'status-neutral',
  error: 'status-error',
}

function App() {
  const [investigations, setInvestigations] = useState([])

  useEffect(() => {
    const fetchInvestigations = async () => {
      try {
        const res = await fetch('/fixer/api/investigations')
        const data = await res.json()
        setInvestigations(data || [])
      } catch {
        // ignore
      }
    }

    fetchInvestigations()
    const interval = setInterval(fetchInvestigations, 3000)
    return () => clearInterval(interval)
  }, [])

  const active = investigations.filter(i =>
    ['pending', 'cloning', 'investigating', 'creating_pr'].includes(i.status)
  )
  const completed = investigations.filter(i =>
    ['pr_created', 'no_fix_needed', 'error'].includes(i.status)
  )

  return (
    <div className="app">
      <h1>Fixer Agent</h1>
      <p className="subtitle">
        AI-powered code investigations
        <span className="badge">{investigations.length}</span>
      </p>

      {investigations.length === 0 && (
        <p className="empty">No investigations yet. Waiting for alerts from the monitor agent...</p>
      )}

      {active.length > 0 && (
        <div className="inv-group">
          <h2 className="group-title active-title">Active ({active.length})</h2>
          {active.map((inv) => (
            <div key={inv.id} className="inv-card inv-active">
              <div className="inv-header">
                <span className="inv-alert">{inv.alert_name}</span>
                <span className={`inv-status ${STATUS_COLORS[inv.status]}`}>
                  {STATUS_LABELS[inv.status] || inv.status}
                </span>
              </div>
              <p className="inv-description">{inv.description}</p>
              {inv.labels?.service_name && (
                <p className="inv-service">Service: {inv.labels.service_name}</p>
              )}
              <div className="inv-meta">
                <span>Started: {new Date(inv.createdAt).toLocaleString()}</span>
                <span>ID: {inv.id}</span>
              </div>
              {inv.related_traces?.length > 0 && (
                <p className="inv-traces">{inv.related_traces.length} related trace(s)</p>
              )}
            </div>
          ))}
        </div>
      )}

      {completed.length > 0 && (
        <div className="inv-group">
          <h2 className="group-title completed-title">Completed ({completed.length})</h2>
          {completed.map((inv) => (
            <div key={inv.id} className={`inv-card ${inv.status === 'error' ? 'inv-error' : 'inv-completed'}`}>
              <div className="inv-header">
                <span className="inv-alert">{inv.alert_name}</span>
                <span className={`inv-status ${STATUS_COLORS[inv.status]}`}>
                  {STATUS_LABELS[inv.status] || inv.status}
                </span>
              </div>
              <p className="inv-description">{inv.description}</p>
              {inv.labels?.service_name && (
                <p className="inv-service">Service: {inv.labels.service_name}</p>
              )}
              {inv.pr_url && (
                <a href={inv.pr_url} target="_blank" rel="noopener noreferrer" className="inv-pr-link">
                  View Pull Request
                </a>
              )}
              {inv.analysis && (
                <details className="inv-analysis">
                  <summary>Analysis</summary>
                  <pre>{inv.analysis}</pre>
                </details>
              )}
              {inv.error && (
                <details className="inv-analysis inv-error-detail">
                  <summary>Error Details</summary>
                  <pre>{inv.error}</pre>
                </details>
              )}
              <div className="inv-meta">
                <span>Started: {new Date(inv.createdAt).toLocaleString()}</span>
                {inv.completedAt && (
                  <span>Completed: {new Date(inv.completedAt).toLocaleString()}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default App
