import { usePolling } from '../usePolling.js'
import { api } from '../api.js'

function fmtMicros(us) {
  if (!us) return ''
  try {
    return new Date(us / 1000).toLocaleString()
  } catch {
    return ''
  }
}

export function Errors() {
  const { data, loading } = usePolling(api.jaegerErrors, 5000)
  if (loading) return <div className="empty">Loading…</div>
  if (data?.error) return <div className="unavailable">Jaeger unavailable: {data.error}</div>

  const traces = data?.data?.data || []

  return (
    <div className="panel">
      <h3>Recent error traces — homebanking-app</h3>
      {traces.length === 0 && <div className="empty">No error traces in the last 30 minutes</div>}
      {traces.length > 0 && (
        <div className="list">
          {traces.slice(0, 20).map((tr) => {
            const root = tr.spans?.[0] || {}
            return (
              <a key={tr.traceID}
                 className="row"
                 href={`/jaeger/ui/trace/${tr.traceID}`}
                 target="_blank"
                 rel="noreferrer"
                 style={{ textDecoration: 'none' }}>
                <div>
                  <div className="primary">{root.operationName || tr.traceID.slice(0, 12)}</div>
                  <div className="secondary">
                    {tr.traceID.slice(0, 12)} · {fmtMicros(root.startTime)} · {tr.spans?.length || 0} spans
                  </div>
                </div>
                <span className="pill err">error</span>
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}
