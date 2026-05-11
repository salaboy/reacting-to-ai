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

async function submitEvaluation(url, description) {
  const res = await fetch('/business/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, description }),
  })
  return res.ok
}

function TargetSelector({ targets, targetsError, selectedId, onChange }) {
  if (!targets) return <p className="targets-loading">Loading targets...</p>

  const selected = targets.find(t => t.id === selectedId) || targets[0]

  return (
    <div className="target-selector">
      <label className="target-label">Target environment</label>
      <select
        className="form-input"
        value={selected?.id || ''}
        onChange={(e) => onChange(e.target.value)}
      >
        {targets.map(t => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>
      {selected && <p className="target-url">{selected.url}</p>}
      {targetsError && (
        <p className="targets-error">
          Could not fetch open pull requests: {targetsError}
        </p>
      )}
    </div>
  )
}

function ValidationCatalog({ catalog, targetUrl, onLaunched }) {
  const [runningId, setRunningId] = useState(null)

  if (!catalog || catalog.length === 0) {
    return <p className="empty">No predefined validations available.</p>
  }

  const run = async (item) => {
    if (!targetUrl) return
    setRunningId(item.id)
    try {
      const ok = await submitEvaluation(targetUrl, item.description)
      if (ok) onLaunched()
    } finally {
      setRunningId(null)
    }
  }

  return (
    <div className="catalog-grid">
      {catalog.map(item => (
        <div key={item.id} className="catalog-card">
          <div className="catalog-card-header">
            <span className="catalog-name">{item.name}</span>
          </div>
          <p className="catalog-description">{item.description}</p>
          <button
            className="catalog-run-btn"
            onClick={() => run(item)}
            disabled={!targetUrl || runningId === item.id}
          >
            {runningId === item.id ? 'Launching...' : 'Run'}
          </button>
        </div>
      ))}
    </div>
  )
}

function CustomEvaluationForm({ targetUrl, onSubmit }) {
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!targetUrl) return
    setSubmitting(true)
    try {
      const ok = await submitEvaluation(targetUrl, description.trim())
      if (ok) {
        setDescription('')
        onSubmit()
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="new-evaluation-form" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="Describe the actions to check (leave empty to fully explore)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="form-input"
      />
      <button type="submit" disabled={submitting || !targetUrl} className="form-submit">
        {submitting ? 'Submitting...' : 'Run custom evaluation'}
      </button>
    </form>
  )
}

function App() {
  const [evaluations, setEvaluations] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [targets, setTargets] = useState(null)
  const [targetsError, setTargetsError] = useState('')
  const [selectedTargetId, setSelectedTargetId] = useState('default')
  const [catalog, setCatalog] = useState([])

  const fetchEvaluations = async () => {
    try {
      const res = await fetch('/business/api/evaluations')
      const data = await res.json()
      setEvaluations(data || [])
    } catch {
      // ignore
    }
  }

  const fetchTargets = async () => {
    try {
      const res = await fetch('/business/api/targets')
      const data = await res.json()
      setTargets(data.targets || [])
      setTargetsError(data.error || '')
    } catch (e) {
      setTargets([])
      setTargetsError(String(e))
    }
  }

  const fetchCatalog = async () => {
    try {
      const res = await fetch('/business/api/catalog')
      const data = await res.json()
      setCatalog(data || [])
    } catch {
      setCatalog([])
    }
  }

  useEffect(() => {
    fetchEvaluations()
    fetchTargets()
    fetchCatalog()
    const interval = setInterval(fetchEvaluations, 3000)
    const targetsInterval = setInterval(fetchTargets, 30000)
    return () => {
      clearInterval(interval)
      clearInterval(targetsInterval)
    }
  }, [])

  if (selectedId) {
    return <EvaluationDetail id={selectedId} onBack={() => setSelectedId(null)} />
  }

  const active = evaluations.filter(e => ACTIVE_STATUSES.includes(e.status))
  const completed = evaluations.filter(e => !ACTIVE_STATUSES.includes(e.status))
  const selectedTarget = (targets || []).find(t => t.id === selectedTargetId) || (targets || [])[0]
  const targetUrl = selectedTarget?.url || ''

  return (
    <div className="app">
      <h1>Business Agent</h1>
      <p className="subtitle">
        AI-powered website evaluation
        <span className="badge">{evaluations.length}</span>
      </p>

      <TargetSelector
        targets={targets}
        targetsError={targetsError}
        selectedId={selectedTargetId}
        onChange={setSelectedTargetId}
      />

      <h2 className="section-title">Predefined validations</h2>
      <ValidationCatalog
        catalog={catalog}
        targetUrl={targetUrl}
        onLaunched={fetchEvaluations}
      />

      <h2 className="section-title">Custom evaluation</h2>
      <CustomEvaluationForm targetUrl={targetUrl} onSubmit={fetchEvaluations} />

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
