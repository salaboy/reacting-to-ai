import { usePolling } from '../usePolling.js'
import { api } from '../api.js'

const COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#a371f7', '#79c0ff', '#ff7b72']

export function Stability() {
  const { data, loading } = usePolling(api.stability, 5000)
  if (loading) return <div className="empty">Loading…</div>
  if (data?.error) return <div className="unavailable">Backend unavailable: {data.error}</div>

  const queries = data?.queries || {}
  const errs = data?.errors || {}

  return (
    <div>
      <Chart title="Request rate (req/s)" result={queries.request_rate} error={errs.request_rate} />
      <Chart title="Error rate (err/s)"   result={queries.error_rate}   error={errs.error_rate} />
      <Chart title="p95 latency (ms)"     result={queries.latency_p95}  error={errs.latency_p95} />
    </div>
  )
}

function Chart({ title, result, error }) {
  if (error) {
    return (
      <div className="chart">
        <h4>{title}</h4>
        <div className="unavailable">Prometheus unavailable: {error}</div>
      </div>
    )
  }
  const series = result?.result || []
  if (series.length === 0) {
    return (
      <div className="chart">
        <h4>{title}</h4>
        <div className="empty">No data</div>
      </div>
    )
  }

  // Each series item is { metric: {...}, values: [[ts, "value"], ...] }
  const allValues = series.flatMap((s) => s.values.map((v) => parseFloat(v[1])))
  const finite = allValues.filter((v) => Number.isFinite(v))
  const maxVal = Math.max(...finite, 0.0001)
  const W = 600
  const H = 80

  return (
    <div className="chart">
      <h4>{title}</h4>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {series.map((s, i) => {
          const pts = s.values.map(([ts, v], idx) => {
            const x = (idx / Math.max(s.values.length - 1, 1)) * W
            const val = parseFloat(v)
            const y = H - (Number.isFinite(val) ? (val / maxVal) * (H - 4) : 0) - 2
            return `${x.toFixed(2)},${y.toFixed(2)}`
          })
          return (
            <polyline
              key={i}
              points={pts.join(' ')}
              fill="none"
              stroke={COLORS[i % COLORS.length]}
              strokeWidth="1.5"
            />
          )
        })}
      </svg>
      <div className="legend">
        {series.map((s, i) => (
          <span key={i}>
            <span className="swatch" style={{ background: COLORS[i % COLORS.length] }} />
            {s.metric?.service_name || 'unknown'}
          </span>
        ))}
      </div>
    </div>
  )
}
