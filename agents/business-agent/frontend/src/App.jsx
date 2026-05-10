import { useState, useEffect, useRef } from 'react'
import './App.css'

const STATUS_LABELS = {
  pending: 'Pending',
  browsing: 'Browsing',
  creating_issue: 'Creating Issue',
  issue_created: 'Issue Created',
  evaluated: 'Evaluated',
  no_issues: 'No Issues Found',
  completed: 'Completed',
  error: 'Error',
}

const STATUS_COLORS = {
  pending: 'status-pending',
  browsing: 'status-active',
  creating_issue: 'status-active',
  issue_created: 'status-warning',
  evaluated: 'status-success',
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

function EvaluationDetail({ id, onBack }) {
  const [evaluation, setEvaluation] = useState(null)
  const timelineEndRef = useRef(null)

  useEffect(() => {
    const fetchDetail = async () => {
      try {
        const res = await fetch(`/business/api/evaluations/${id}`)
        if (res.ok) {
          setEvaluation(await res.json())
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
  }, [evaluation?.steps?.length])

  if (!evaluation) return <div className="app"><p className="empty">Loading...</p></div>

  const isActive = ACTIVE_STATUSES.includes(evaluation.status)

  return (
    <div className="app">
      <button className="detail-back" onClick={onBack}>&larr; All evaluations</button>

      <div className="detail-header">
        <span className="detail-url">{evaluation.url}</span>
        <span className={`eval-status ${STATUS_COLORS[evaluation.status]}`}>
          {STATUS_LABELS[evaluation.status] || evaluation.status}
        </span>
      </div>

      {evaluation.description && <p className="eval-description">{evaluation.description}</p>}

      <div className="detail-meta">
        <p>Started: {new Date(evaluation.createdAt).toLocaleString()}</p>
        {evaluation.completedAt && <p>Completed: {new Date(evaluation.completedAt).toLocaleString()}</p>}
        <p>ID: {evaluation.id}</p>
      </div>

      {evaluation.issue_url && (
        <a href={evaluation.issue_url} target="_blank" rel="noopener noreferrer" className="eval-issue-link">
          View GitHub Issue
        </a>
      )}

      {evaluation.error && (
        <div className="detail-error">
          <h3>Error</h3>
          <pre>{evaluation.error}</pre>
        </div>
      )}

      <div className="timeline-section">
        <h2 className="timeline-title">Agent Activity</h2>
        {(!evaluation.steps || evaluation.steps.length === 0) && (
          <p className="empty">Waiting for agent to start...</p>
        )}
        <div className="timeline">
          {evaluation.steps?.map((step, i) => (
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

function NewEvaluationForm({ onSubmit }) {
  const [url, setUrl] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!url.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch('/business/evaluate', {
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
    <form className="new-evaluation-form" onSubmit={handleSubmit}>
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
        {submitting ? 'Submitting...' : 'Evaluate'}
      </button>
    </form>
  )
}

function App() {
  const [evaluations, setEvaluations] = useState([])
  const [selectedId, setSelectedId] = useState(null)

  const fetchEvaluations = async () => {
    try {
      const res = await fetch('/business/api/evaluations')
      const data = await res.json()
      setEvaluations(data || [])
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    fetchEvaluations()
    const interval = setInterval(fetchEvaluations, 3000)
    return () => clearInterval(interval)
  }, [])

  if (selectedId) {
    return <EvaluationDetail id={selectedId} onBack={() => setSelectedId(null)} />
  }

  const active = evaluations.filter(e => ACTIVE_STATUSES.includes(e.status))
  const completed = evaluations.filter(e => !ACTIVE_STATUSES.includes(e.status))

  return (
    <div className="app">
      <h1>Business Agent</h1>
      <p className="subtitle">
        AI-powered website evaluation
        <span className="badge">{evaluations.length}</span>
      </p>

      <NewEvaluationForm onSubmit={fetchEvaluations} />

      {evaluations.length === 0 && (
        <p className="empty">No evaluations yet. Submit a URL above to get started.</p>
      )}

      {active.length > 0 && (
        <div className="eval-group">
          <h2 className="group-title active-title">Active ({active.length})</h2>
          {active.map((evaluation) => (
            <div key={evaluation.id} className="eval-card eval-active">
              <div className="eval-header">
                <span className="eval-url-label">{evaluation.url}</span>
                <span className={`eval-status ${STATUS_COLORS[evaluation.status]}`}>
                  {STATUS_LABELS[evaluation.status] || evaluation.status}
                </span>
              </div>
              {evaluation.description && <p className="eval-description">{evaluation.description}</p>}
              <div className="eval-meta">
                <span>Started: {new Date(evaluation.createdAt).toLocaleString()}</span>
                <span>ID: {evaluation.id}</span>
              </div>
              <button className="eval-details-btn" onClick={() => setSelectedId(evaluation.id)}>
                Details
              </button>
            </div>
          ))}
        </div>
      )}

      {completed.length > 0 && (
        <div className="eval-group">
          <h2 className="group-title completed-title">Completed ({completed.length})</h2>
          {completed.map((evaluation) => (
            <div
              key={evaluation.id}
              className={`eval-card ${
                evaluation.status === 'error' ? 'eval-error'
                : evaluation.status === 'issue_created' ? 'eval-issue'
                : 'eval-completed'
              }`}
            >
              <div className="eval-header">
                <span className="eval-url-label">{evaluation.url}</span>
                <span className={`eval-status ${STATUS_COLORS[evaluation.status]}`}>
                  {STATUS_LABELS[evaluation.status] || evaluation.status}
                </span>
              </div>
              {evaluation.description && <p className="eval-description">{evaluation.description}</p>}
              {evaluation.issue_url && (
                <a
                  href={evaluation.issue_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="eval-issue-link"
                >
                  View GitHub Issue
                </a>
              )}
              <div className="eval-meta">
                <span>Started: {new Date(evaluation.createdAt).toLocaleString()}</span>
                {evaluation.completedAt && (
                  <span>Completed: {new Date(evaluation.completedAt).toLocaleString()}</span>
                )}
              </div>
              <button className="eval-details-btn" onClick={() => setSelectedId(evaluation.id)}>
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
