import { useState, useEffect, useRef } from 'react'
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

const ACTIVE_STATUSES = ['pending', 'cloning', 'investigating', 'creating_pr']

function formatInput(input) {
  if (!input || typeof input !== 'object') return String(input || '')
  return Object.entries(input)
    .map(([k, v]) => {
      const val = typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '...' : v
      return `${k}: ${val}`
    })
    .join('\n')
}

function StepItem({ step }) {
  const time = new Date(step.timestamp).toLocaleTimeString()

  if (step.type === 'status_change') {
    return (
      <div className="step-item">
        <div className="step-dot dot-status" />
        <div className="step-content">
          <div className="step-header">
            <span className="step-label">
              {STATUS_LABELS[step.data.status] || step.data.status}
            </span>
            <span className="step-time">{time}</span>
          </div>
        </div>
      </div>
    )
  }

  if (step.type === 'tool_call') {
    return (
      <div className="step-item">
        <div className="step-dot dot-tool" />
        <div className="step-content">
          <div className="step-header">
            <span className="step-label step-label-tool">{step.data.tool}</span>
            <span className="step-time">{time}</span>
          </div>
          <div className="step-body">
            <details>
              <summary>Arguments</summary>
              <pre>{formatInput(step.data.input)}</pre>
            </details>
          </div>
        </div>
      </div>
    )
  }

  if (step.type === 'tool_result') {
    return (
      <div className="step-item">
        <div className="step-dot dot-result" />
        <div className="step-content">
          <div className="step-header">
            <span className="step-label step-label-result">{step.data.tool} result</span>
            <span className="step-time">{time}</span>
          </div>
          <div className="step-body">
            <details>
              <summary>Output</summary>
              <pre>{step.data.output}</pre>
            </details>
          </div>
        </div>
      </div>
    )
  }

  if (step.type === 'agent_response') {
    return (
      <div className="step-item">
        <div className="step-dot dot-response" />
        <div className="step-content">
          <div className="step-header">
            <span className="step-label step-label-response">Agent Response</span>
            <span className="step-time">{time}</span>
          </div>
          <div className="step-body">
            <pre className="step-response-text">{step.data.content}</pre>
          </div>
        </div>
      </div>
    )
  }

  return null
}

function InvestigationDetail({ id, onBack }) {
  const [inv, setInv] = useState(null)
  const timelineEndRef = useRef(null)

  useEffect(() => {
    const fetchDetail = async () => {
      try {
        const res = await fetch(`/fixer/api/investigations/${id}`)
        if (res.ok) {
          setInv(await res.json())
        }
      } catch {
        // ignore
      }
    }
    fetchDetail()
    const interval = setInterval(fetchDetail, 2000)
    return () => clearInterval(interval)
  }, [id])

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [inv?.steps?.length])

  if (!inv) return <div className="app"><p className="empty">Loading...</p></div>

  const isActive = ACTIVE_STATUSES.includes(inv.status)

  return (
    <div className="app">
      <button className="detail-back" onClick={onBack}>&larr; All investigations</button>

      <div className="detail-header">
        <span className="detail-alert-name">{inv.alert_name}</span>
        <span className={`inv-status ${STATUS_COLORS[inv.status]}`}>
          {STATUS_LABELS[inv.status] || inv.status}
        </span>
      </div>

      <p className="inv-description">{inv.description}</p>

      <div className="detail-meta">
        {inv.labels?.service_name && <p>Service: {inv.labels.service_name}</p>}
        <p>Started: {new Date(inv.createdAt).toLocaleString()}</p>
        {inv.completedAt && <p>Completed: {new Date(inv.completedAt).toLocaleString()}</p>}
        <p>ID: {inv.id}</p>
      </div>

      {inv.related_traces?.length > 0 && (
        <div className="detail-traces">
          <h3>{inv.related_traces.length} Related Trace(s)</h3>
          {inv.related_traces.map((t, i) => (
            <div key={i} className="trace-item">
              <span className="trace-op">{t.operationName}</span>
              <span className="trace-service">{t.serviceName}</span>
              <span className="trace-duration">{(t.duration / 1000).toFixed(1)}ms</span>
            </div>
          ))}
        </div>
      )}

      {inv.pr_url && (
        <a href={inv.pr_url} target="_blank" rel="noopener noreferrer" className="inv-pr-link">
          View Pull Request
        </a>
      )}

      {inv.error && (
        <div className="detail-error">
          <h3>Error</h3>
          <pre>{inv.error}</pre>
        </div>
      )}

      <div className="timeline-section">
        <h2 className="timeline-title">Agent Activity</h2>
        {(!inv.steps || inv.steps.length === 0) && (
          <p className="empty">Waiting for agent to start...</p>
        )}
        <div className="timeline">
          {inv.steps?.map((step, i) => (
            <StepItem key={i} step={step} />
          ))}
          {isActive && (
            <div className="step-item">
              <div className="step-dot working-dot" />
              <div className="step-content">
                <span className="working-text">Agent is working...</span>
              </div>
            </div>
          )}
          <div ref={timelineEndRef} />
        </div>
      </div>
    </div>
  )
}

function App() {
  const [investigations, setInvestigations] = useState([])
  const [selectedId, setSelectedId] = useState(null)

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

  if (selectedId) {
    return <InvestigationDetail id={selectedId} onBack={() => setSelectedId(null)} />
  }

  const active = investigations.filter(i => ACTIVE_STATUSES.includes(i.status))
  const completed = investigations.filter(i => !ACTIVE_STATUSES.includes(i.status))

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
              {inv.pr_url && (
                <a href={inv.pr_url} target="_blank" rel="noopener noreferrer" className="inv-pr-link">
                  View Pull Request
                </a>
              )}
              {inv.related_traces?.length > 0 && (
                <p className="inv-traces">{inv.related_traces.length} related trace(s)</p>
              )}
              <button className="inv-details-btn" onClick={() => setSelectedId(inv.id)}>
                Details
              </button>
            </div>
          ))}
        </div>
      )}

      {completed.length > 0 && (
        <div className="inv-group">
          <h2 className="group-title completed-title">Completed ({completed.length})</h2>
          {completed.map((inv) => (
            <div
              key={inv.id}
              className={`inv-card ${inv.status === 'error' ? 'inv-error' : 'inv-completed'}`}
            >
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
                <a
                  href={inv.pr_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inv-pr-link"
                >
                  View Pull Request
                </a>
              )}
              <div className="inv-meta">
                <span>Started: {new Date(inv.createdAt).toLocaleString()}</span>
                {inv.completedAt && (
                  <span>Completed: {new Date(inv.completedAt).toLocaleString()}</span>
                )}
              </div>
              <button className="inv-details-btn" onClick={() => setSelectedId(inv.id)}>
                Details
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default App
