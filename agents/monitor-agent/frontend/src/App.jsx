import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [alerts, setAlerts] = useState([])

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const res = await fetch('/api/alerts')
        const data = await res.json()
        setAlerts(data || [])
      } catch {
        // ignore fetch errors
      }
    }

    fetchAlerts()
    const interval = setInterval(fetchAlerts, 3000)
    return () => clearInterval(interval)
  }, [])

  const firingAlerts = alerts.filter(a => a.status === 'firing')
  const resolvedAlerts = alerts.filter(a => a.status === 'resolved')

  return (
    <div className="app">
      <h1>Monitor Agent</h1>
      <p className="subtitle">
        Alerts received from Alertmanager
        <span className="badge">{alerts.length}</span>
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
