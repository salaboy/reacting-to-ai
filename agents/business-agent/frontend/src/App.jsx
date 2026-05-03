import { useState, useEffect, useRef } from 'react'
import './App.css'

const STATUS_LABELS = {
  pending: 'Pending',
  browsing: 'Browsing',
  creating_issue: 'Creating Issue',
  issue_created: 'Issue Created',
  no_issues: 'No Issues Found',
  completed: 'Completed',
  error: 'Error',
}

const STATUS_COLORS = {
  pending: 'status-pending',
  browsing: 'status-active',
  creating_issue: 'status-active',
  issue_created: 'status-warning',
  no_issues: 'status-success',
  completed: 'status-neutral',
  error: 'status-error',
}

const ACTIVE_STATUSES = ['pending', 'browsing', 'creating_issue']

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

function ValidationDetail({ id, onBack }) {
  const [val, setVal] = useState(null)
  const timelineEndRef = useRef(null)

  useEffect(() => {
    const fetchDetail = async () => {
      try {
        const res = await fetch(`/business/api/validations/${id}`)
        if (res.ok) {
          setVal(await res.json())
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
  }, [val?.steps?.length])

  if (!val) return <div className="app"><p className="empty">Loading...</p></div>

  const isActive = ACTIVE_STATUSES.includes(val.status)

  return (
    <div className="app">
      <button className="detail-back" onClick={onBack}>&larr; All validations</button>

      <div className="detail-header">
        <span className="detail-url">{val.url}</span>
        <span className={`val-status ${STATUS_COLORS[val.status]}`}>
          {STATUS_LABELS[val.status] || val.status}
        </span>
      </div>

      {val.description && <p className="val-description">{val.description}</p>}

      <div className="detail-meta">
        <p>Started: {new Date(val.createdAt).toLocaleString()}</p>
        {val.completedAt && <p>Completed: {new Date(val.completedAt).toLocaleString()}</p>}
        <p>ID: {val.id}</p>
      </div>

      {val.issue_url && (
        <a href={val.issue_url} target="_blank" rel="noopener noreferrer" className="val-issue-link">
          View GitHub Issue
        </a>
      )}

      {val.error && (
        <div className="detail-error">
          <h3>Error</h3>
          <pre>{val.error}</pre>
        </div>
      )}

      <div className="timeline-section">
        <h2 className="timeline-title">Agent Activity</h2>
        {(!val.steps || val.steps.length === 0) && (
          <p className="empty">Waiting for agent to start...</p>
        )}
        <div className="timeline">
          {val.steps?.map((step, i) => (
            <StepItem key={i} step={step} />
          ))}
          {isActive && (
            <div className="step-item">
              <div className="step-dot working-dot" />
              <div className="step-content">
                <span className="working-text">Agent is browsing...</span>
              </div>
            </div>
          )}
          <div ref={timelineEndRef} />
        </div>
      </div>
    </div>
  )
}

function NewValidationForm({ onSubmit }) {
  const [url, setUrl] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!url.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch('/business/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), description: description.trim() }),
      })
      if (res.ok) {
        setUrl('')
        setDescription('')
        onSubmit()
      }
    } catch {
      // ignore
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="new-validation-form" onSubmit={handleSubmit}>
      <input
        type="url"
        placeholder="https://example.com"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        required
        className="form-input"
      />
      <input
        type="text"
        placeholder="Actions to check (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="form-input"
      />
      <button type="submit" disabled={submitting || !url.trim()} className="form-submit">
        {submitting ? 'Submitting...' : 'Validate'}
      </button>
    </form>
  )
}

function App() {
  const [validations, setValidations] = useState([])
  const [selectedId, setSelectedId] = useState(null)

  const fetchValidations = async () => {
    try {
      const res = await fetch('/business/api/validations')
      const data = await res.json()
      setValidations(data || [])
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    fetchValidations()
    const interval = setInterval(fetchValidations, 3000)
    return () => clearInterval(interval)
  }, [])

  if (selectedId) {
    return <ValidationDetail id={selectedId} onBack={() => setSelectedId(null)} />
  }

  const active = validations.filter(v => ACTIVE_STATUSES.includes(v.status))
  const completed = validations.filter(v => !ACTIVE_STATUSES.includes(v.status))

  return (
    <div className="app">
      <h1>Business Agent</h1>
      <p className="subtitle">
        AI-powered website validation
        <span className="badge">{validations.length}</span>
      </p>

      <NewValidationForm onSubmit={fetchValidations} />

      {validations.length === 0 && (
        <p className="empty">No validations yet. Submit a URL above to get started.</p>
      )}

      {active.length > 0 && (
        <div className="val-group">
          <h2 className="group-title active-title">Active ({active.length})</h2>
          {active.map((val) => (
            <div key={val.id} className="val-card val-active">
              <div className="val-header">
                <span className="val-url-label">{val.url}</span>
                <span className={`val-status ${STATUS_COLORS[val.status]}`}>
                  {STATUS_LABELS[val.status] || val.status}
                </span>
              </div>
              {val.description && <p className="val-description">{val.description}</p>}
              <div className="val-meta">
                <span>Started: {new Date(val.createdAt).toLocaleString()}</span>
                <span>ID: {val.id}</span>
              </div>
              <button className="val-details-btn" onClick={() => setSelectedId(val.id)}>
                Details
              </button>
            </div>
          ))}
        </div>
      )}

      {completed.length > 0 && (
        <div className="val-group">
          <h2 className="group-title completed-title">Completed ({completed.length})</h2>
          {completed.map((val) => (
            <div
              key={val.id}
              className={`val-card ${
                val.status === 'error' ? 'val-error'
                : val.status === 'issue_created' ? 'val-issue'
                : 'val-completed'
              }`}
            >
              <div className="val-header">
                <span className="val-url-label">{val.url}</span>
                <span className={`val-status ${STATUS_COLORS[val.status]}`}>
                  {STATUS_LABELS[val.status] || val.status}
                </span>
              </div>
              {val.description && <p className="val-description">{val.description}</p>}
              {val.issue_url && (
                <a
                  href={val.issue_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="val-issue-link"
                >
                  View GitHub Issue
                </a>
              )}
              <div className="val-meta">
                <span>Started: {new Date(val.createdAt).toLocaleString()}</span>
                {val.completedAt && (
                  <span>Completed: {new Date(val.completedAt).toLocaleString()}</span>
                )}
              </div>
              <button className="val-details-btn" onClick={() => setSelectedId(val.id)}>
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
