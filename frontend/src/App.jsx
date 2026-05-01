import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [response, setResponse] = useState(null)
  const [loading, setLoading] = useState(false)
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

  const callEndpoint = async (path) => {
    setLoading(true)
    setResponse(null)
    try {
      const res = await fetch(path)
      const data = await res.json()
      setResponse({ status: res.status, data })
    } catch (err) {
      setResponse({ status: 0, data: { message: err.message } })
    } finally {
      setLoading(false)
    }
  }

  const firingAlerts = alerts.filter(a => a.status === 'firing')
  const resolvedAlerts = alerts.filter(a => a.status === 'resolved')

  return (
    <div className="app">
      <h1>API Tester</h1>
      <p className="subtitle">Click a button to call an API endpoint</p>

      <div className="buttons">
        <button
          className="btn success"
          onClick={() => callEndpoint('/api/success')}
          disabled={loading}
        >
          Call /api/success (200)
        </button>
        <button
          className="btn error"
          onClick={() => callEndpoint('/api/error')}
          disabled={loading}
        >
          Call /api/error (500)
        </button>
      </div>

      {loading && <p className="loading">Loading...</p>}

      {response && (
        <div className={`response ${response.status === 200 ? 'response-success' : 'response-error'}`}>
          <div className="response-status">HTTP {response.status}</div>
          <pre>{JSON.stringify(response.data, null, 2)}</pre>
        </div>
      )}

      <div className="alerts-section">
        <h2>Alerts</h2>

        {alerts.length === 0 && (
          <p className="no-alerts">No alerts received yet.</p>
        )}

        {firingAlerts.length > 0 && (
          <div className="alerts-group">
            <h3 className="alerts-group-title firing">Firing ({firingAlerts.length})</h3>
            {firingAlerts.map((alert) => (
              <div key={alert.fingerprint} className="alert-card alert-firing">
                <div className="alert-header">
                  <span className="alert-name">{alert.labels?.alertname}</span>
                  <span className="alert-severity">{alert.labels?.severity}</span>
                </div>
                <p className="alert-summary">{alert.annotations?.summary}</p>
                <p className="alert-description">{alert.annotations?.description}</p>
                <p className="alert-time">Since: {new Date(alert.startsAt).toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}

        {resolvedAlerts.length > 0 && (
          <div className="alerts-group">
            <h3 className="alerts-group-title resolved">Resolved ({resolvedAlerts.length})</h3>
            {resolvedAlerts.map((alert) => (
              <div key={alert.fingerprint} className="alert-card alert-resolved">
                <div className="alert-header">
                  <span className="alert-name">{alert.labels?.alertname}</span>
                  <span className="alert-severity">{alert.labels?.severity}</span>
                </div>
                <p className="alert-summary">{alert.annotations?.summary}</p>
                <p className="alert-time">Resolved: {new Date(alert.endsAt).toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default App
