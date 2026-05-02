import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [alerts, setAlerts] = useState([])
  const [investigations, setInvestigations] = useState([])

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [alertsRes, invRes] = await Promise.all([
          fetch('/monitor/api/alerts'),
          fetch('/monitor/api/investigations'),
        ])
        const alertsData = await alertsRes.json()
        const invData = await invRes.json()
        setAlerts(alertsData || [])
        setInvestigations(invData || [])
      } catch {
        // ignore fetch errors
      }
    }

    fetchData()
    const interval = setInterval(fetchData, 3000)
    return () => clearInterval(interval)
  }, [])

  const firingAlerts = alerts.filter(a => a.status === 'firing')
  const resolvedAlerts = alerts.filter(a => a.status === 'resolved')

  const formatDuration = (us) => {
    if (us < 1000) return `${us}us`
    if (us < 1_000_000) return `${(us / 1000).toFixed(1)}ms`
    return `${(us / 1_000_000).toFixed(2)}s`
  }

  const getInvestigationForAlert = (fingerprint) => {
    return investigations.find(inv => inv.alert_fingerprint === fingerprint)
  }

  const renderTraces = (traces) => {
    if (!traces || traces.length === 0) return null
    return (
      <div className="traces-section">
        <h4 className="traces-title">Related Traces ({traces.length})</h4>
        {traces.map((trace) => (
          <div key={trace.traceID} className="trace-card">
            <div className="trace-header">
              <span className="trace-operation">{trace.operationName}</span>
              <span className="trace-duration">{formatDuration(trace.duration)}</span>
            </div>
            <div className="trace-meta">
              <span>{trace.spanCount} span{trace.spanCount !== 1 ? 's' : ''}</span>
              <span>{new Date(trace.startTime / 1000).toLocaleString()}</span>
              <a
                href={trace.jaegerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="trace-link"
              >
                View in Jaeger
              </a>
            </div>
            <code className="trace-id">{trace.traceID}</code>
          </div>
        ))}
      </div>
    )
  }

  const renderInvestigation = (inv) => {
    if (!inv) return null
    const statusLabels = {
      sending: 'Sending to Fixer',
      accepted: 'Investigating',
      error: 'Failed',
    }
    const statusColors = {
      sending: 'inv-status-active',
      accepted: 'inv-status-active',
      error: 'inv-status-error',
    }
    return (
      <div className="investigation-section">
        <div className="investigation-header">
          <h4 className="investigation-title">Investigation</h4>
          <span className={`inv-badge ${statusColors[inv.status] || 'inv-status-active'}`}>
            {statusLabels[inv.status] || inv.status}
          </span>
        </div>
        {inv.fixer_response?.investigation_id && (
          <p className="investigation-id">
            ID: {inv.fixer_response.investigation_id}
            {' — '}
            <a href="/fixer/" target="_blank" rel="noopener noreferrer" className="trace-link">
              View in Fixer Agent
            </a>
          </p>
        )}
        {inv.fixer_response?.error && (
          <p className="investigation-error">{inv.fixer_response.error}</p>
        )}
      </div>
    )
  }

  return (
    <div className="app">
      <h1>Monitor Agent</h1>
      <p className="subtitle">
        Alerts received from Alertmanager
        <span className="badge">{alerts.length}</span>
        {investigations.length > 0 && (
          <span className="badge inv-badge-count">{investigations.length} investigation{investigations.length !== 1 ? 's' : ''}</span>
        )}
      </p>

      {alerts.length === 0 && (
        <p className="empty">No alerts received yet. Waiting for Alertmanager webhooks...</p>
      )}

      {firingAlerts.length > 0 && (
        <div className="alerts-group">
          <h2 className="group-title firing">Firing ({firingAlerts.length})</h2>
          {firingAlerts.map((alert) => (
            <div key={alert.fingerprint} className="alert-card alert-firing">
              <div className="alert-header">
                <span className="alert-name">{alert.labels?.alertname || 'Unknown'}</span>
                <span className={`severity ${alert.labels?.severity || ''}`}>
                  {alert.labels?.severity || 'unknown'}
                </span>
              </div>
              {alert.labels?.service_name && (
                <p className="alert-service">Service: {alert.labels.service_name}</p>
              )}
              {alert.annotations?.summary && (
                <p className="alert-summary">{alert.annotations.summary}</p>
              )}
              {alert.annotations?.description && (
                <p className="alert-description">{alert.annotations.description}</p>
              )}
              <div className="alert-meta">
                <span>Started: {new Date(alert.startsAt).toLocaleString()}</span>
                {alert.receivedAt && (
                  <span>Received: {new Date(alert.receivedAt).toLocaleString()}</span>
                )}
              </div>
              {renderTraces(alert.relatedTraces)}
              {renderInvestigation(getInvestigationForAlert(alert.fingerprint))}
            </div>
          ))}
        </div>
      )}

      {resolvedAlerts.length > 0 && (
        <div className="alerts-group">
          <h2 className="group-title resolved">Resolved ({resolvedAlerts.length})</h2>
          {resolvedAlerts.map((alert) => (
            <div key={alert.fingerprint} className="alert-card alert-resolved">
              <div className="alert-header">
                <span className="alert-name">{alert.labels?.alertname || 'Unknown'}</span>
                <span className={`severity ${alert.labels?.severity || ''}`}>
                  {alert.labels?.severity || 'unknown'}
                </span>
              </div>
              {alert.labels?.service_name && (
                <p className="alert-service">Service: {alert.labels.service_name}</p>
              )}
              {alert.annotations?.summary && (
                <p className="alert-summary">{alert.annotations.summary}</p>
              )}
              <div className="alert-meta">
                <span>Resolved: {new Date(alert.endsAt).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default App
