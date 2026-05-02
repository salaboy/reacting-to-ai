import { useState } from 'react'
import './App.css'

function App() {
  const [response, setResponse] = useState(null)
  const [loading, setLoading] = useState(false)

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
          Call /api/error (400)
        </button>
      </div>

      {loading && <p className="loading">Loading...</p>}

      {response && (
        <div className={`response ${response.status === 200 ? 'response-success' : 'response-error'}`}>
          <div className="response-status">HTTP {response.status}</div>
          <pre>{JSON.stringify(response.data, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

export default App
