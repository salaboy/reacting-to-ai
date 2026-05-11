import { useState, useEffect } from 'react'
import { usePolling } from '../usePolling.js'
import { api } from '../api.js'

const WINDOWS = [
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
]

function unwrap(res) {
  if (!res) return { data: null, error: null }
  if (res.error) return { data: null, error: res.error }
  return { data: res.data, error: null }
}

function parse(ts) {
  if (!ts) return null
  const d = new Date(ts)
  return isNaN(d.getTime()) ? null : d
}

function median(nums) {
  if (!nums.length) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function fmtDuration(ms) {
  if (ms == null) return '—'
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(0)}s`
  const m = s / 60
  if (m < 60) return `${m.toFixed(0)}m`
  const h = m / 60
  if (h < 24) return `${h.toFixed(1)}h`
  const d = h / 24
  return `${d.toFixed(1)}d`
}

function fmtRate(count, days) {
  if (count === 0) return '0'
  const perDay = count / days
  if (perDay >= 1) return `${perDay.toFixed(1)} / day`
  const perWeek = perDay * 7
  if (perWeek >= 1) return `${perWeek.toFixed(1)} / week`
  return `${(perDay * 30).toFixed(1)} / month`
}

function fmtPct(n) {
  if (n == null) return '—'
  return `${(n * 100).toFixed(0)}%`
}

// DORA performance bands. Tones map to existing pill/border colors.
function dfTone(perDay) {
  if (perDay >= 1) return 'ok'
  if (perDay >= 1 / 7) return 'info'
  if (perDay >= 1 / 30) return 'warn'
  return 'err'
}
function leadTone(ms) {
  if (ms == null) return 'muted'
  const days = ms / 86400000
  if (days < 1) return 'ok'
  if (days < 7) return 'info'
  if (days < 30) return 'warn'
  return 'err'
}
function cfrTone(rate) {
  if (rate == null) return 'muted'
  if (rate <= 0.15) return 'ok'
  if (rate <= 0.30) return 'warn'
  return 'err'
}
function mttrTone(ms) {
  if (ms == null) return 'muted'
  const h = ms / 3600000
  if (h < 1) return 'ok'
  if (h < 24) return 'info'
  if (h < 24 * 7) return 'warn'
  return 'err'
}

function inWindow(d, since) {
  return d != null && d >= since
}

function isBugIssue(iss) {
  const labels = iss.labels || []
  return labels.some((l) => {
    const n = (l.name || '').toLowerCase()
    return n.includes('bug') || n.includes('incident') || n.includes('defect') || n.includes('regression')
  })
}

export function Dora() {
  const [windowId, setWindowId] = useState('30d')
  const win = WINDOWS.find((w) => w.id === windowId) || WINDOWS[1]

  const prsRes = usePolling(api.githubPRs, 10000).data
  const issuesRes = usePolling(api.githubIssues, 10000).data
  const evalsRes = usePolling(api.businessEvaluations, 5000).data

  const prs = unwrap(prsRes)
  const issues = unwrap(issuesRes)
  const evals = unwrap(evalsRes)
  // `now` ticks every 30s so the rolling window stays current even if data
  // hasn't refreshed. Kept out of useMemo to avoid impure-render warnings.
  const now = useTick(30000)

  const metrics = (() => {
    const since = new Date(now - win.days * 86400000)

    const mergedPRs = (prs.data || []).filter((p) => {
      const m = parse(p.merged_at)
      return inWindow(m, since)
    })
    const leadTimes = mergedPRs
      .map((p) => {
        const c = parse(p.created_at)
        const m = parse(p.merged_at)
        return c && m ? m - c : null
      })
      .filter((v) => v != null)

    const closedIssues = (issues.data || []).filter((i) => {
      const c = parse(i.closed_at)
      return inWindow(c, since)
    })
    const bugClosedIssues = closedIssues.filter(isBugIssue)
    const mttrPool = bugClosedIssues.length > 0 ? bugClosedIssues : closedIssues
    const ttrs = mttrPool
      .map((i) => {
        const c = parse(i.created_at)
        const x = parse(i.closed_at)
        return c && x ? x - c : null
      })
      .filter((v) => v != null)

    const winEvals = (evals.data || []).filter((e) => {
      const c = parse(e.createdAt)
      return inWindow(c, since)
    })
    const passed = winEvals.filter((e) => e.passed === true).length
    const failed = winEvals.filter((e) => e.passed === false).length
    const totalDecided = passed + failed
    const cfr = totalDecided > 0 ? failed / totalDecided : null

    return {
      df: { count: mergedPRs.length, perDay: mergedPRs.length / win.days, items: mergedPRs },
      mltc: { median: median(leadTimes), count: leadTimes.length },
      cfr: { rate: cfr, failed, total: totalDecided, items: winEvals },
      mttr: { median: median(ttrs), count: ttrs.length, items: mttrPool, bugScoped: bugClosedIssues.length > 0 },
      since,
    }
  })()

  const anyError = prs.error || issues.error || evals.error

  return (
    <>
      <div className="dora-toolbar">
        <div className="sub">DORA — last {win.label}</div>
        <div className="window-switch">
          {WINDOWS.map((w) => (
            <button key={w.id}
                    className={w.id === windowId ? 'active' : ''}
                    onClick={() => setWindowId(w.id)}>
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {anyError && (
        <div className="unavailable" style={{ marginBottom: 12 }}>
          Some sources unavailable.
          {prs.error && <> PRs: {prs.error}.</>}
          {issues.error && <> Issues: {issues.error}.</>}
          {evals.error && <> Evaluations: {evals.error}.</>}
        </div>
      )}

      <div className="dora-cards">
        <Metric
          label="Deployment Frequency"
          value={fmtRate(metrics.df.count, win.days)}
          tone={dfTone(metrics.df.perDay)}
          sub={`${metrics.df.count} merged PR${metrics.df.count === 1 ? '' : 's'}`}
          hint="Merged PRs in window"
        />
        <Metric
          label="Lead Time for Changes"
          value={fmtDuration(metrics.mltc.median)}
          tone={leadTone(metrics.mltc.median)}
          sub={`median over ${metrics.mltc.count} PR${metrics.mltc.count === 1 ? '' : 's'}`}
          hint="PR created → merged (median)"
        />
        <Metric
          label="Change Failure Rate"
          value={fmtPct(metrics.cfr.rate)}
          tone={cfrTone(metrics.cfr.rate)}
          sub={metrics.cfr.total
            ? `${metrics.cfr.failed} failed / ${metrics.cfr.total} evaluations`
            : 'no evaluations in window'}
          hint="Failed / total evaluations"
        />
        <Metric
          label="Time to Restore Service"
          value={fmtDuration(metrics.mttr.median)}
          tone={mttrTone(metrics.mttr.median)}
          sub={metrics.mttr.count
            ? `median over ${metrics.mttr.count} ${metrics.mttr.bugScoped ? 'bug ' : ''}issue${metrics.mttr.count === 1 ? '' : 's'}`
            : 'no closed issues in window'}
          hint={metrics.mttr.bugScoped
            ? 'Bug-labeled issues opened → closed (median)'
            : 'Issues opened → closed (median, no bug labels found)'}
        />
      </div>

      <div className="columns two" style={{ marginTop: 14 }}>
        <SubList
          title="Merged PRs in window"
          empty="No merged PRs"
          items={metrics.df.items}
          render={(p) => (
            <a key={p.id} className="row" href={p.html_url} target="_blank" rel="noreferrer"
               style={{ textDecoration: 'none' }}>
              <div>
                <div className="primary">#{p.number} {p.title}</div>
                <div className="secondary">
                  {p.user?.login} · merged {new Date(p.merged_at).toLocaleString()}
                  {' · '}lead {fmtDuration(parse(p.merged_at) - parse(p.created_at))}
                </div>
              </div>
              <span className="pill ok">merged</span>
            </a>
          )}
        />
        <SubList
          title="Evaluations in window"
          empty="No evaluations"
          items={metrics.cfr.items}
          render={(e) => {
            const tone = e.passed === true ? 'ok' : e.passed === false ? 'err' : 'muted'
            const label = e.passed === true ? 'passed' : e.passed === false ? 'failed' : (e.status || 'pending')
            return (
              <div key={e.id} className={`row eval ${tone}`}>
                <div>
                  <div className="primary">{e.url || e.id}</div>
                  <div className="secondary">{e.id} · {new Date(e.createdAt).toLocaleString()}</div>
                </div>
                <span className={`pill ${tone}`}>{label}</span>
              </div>
            )
          }}
        />
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <h3>Closed {metrics.mttr.bugScoped ? 'bug ' : ''}issues in window</h3>
        {metrics.mttr.items.length === 0 && <div className="empty">No closed issues</div>}
        {metrics.mttr.items.length > 0 && (
          <div className="list">
            {metrics.mttr.items.slice(0, 20).map((i) => (
              <a key={i.id} className="row" href={i.html_url} target="_blank" rel="noreferrer"
                 style={{ textDecoration: 'none' }}>
                <div>
                  <div className="primary">#{i.number} {i.title}</div>
                  <div className="secondary">
                    closed {new Date(i.closed_at).toLocaleString()}
                    {' · '}ttr {fmtDuration(parse(i.closed_at) - parse(i.created_at))}
                  </div>
                </div>
                <span className="pill muted">closed</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function Metric({ label, value, tone, sub, hint }) {
  return (
    <div className={`dora-card ${tone}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="sub">{sub}</div>
      <div className="hint">{hint}</div>
    </div>
  )
}

function useTick(intervalMs) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function SubList({ title, empty, items, render }) {
  return (
    <div className="panel">
      <h3>{title} <span style={{ float: 'right', color: 'var(--muted)' }}>{items.length}</span></h3>
      {items.length === 0 && <div className="empty">{empty}</div>}
      {items.length > 0 && (
        <div className="list">{items.slice(0, 20).map((it) => render(it))}</div>
      )}
    </div>
  )
}
