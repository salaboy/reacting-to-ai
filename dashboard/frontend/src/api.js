// All endpoints return { data, error } where data is null if the call failed.
// The backend already shapes per-source errors so each panel can render
// "unavailable" without crashing the whole page.

async function getJSON(path) {
  try {
    const res = await fetch(path, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`)
    return await res.json()
  } catch (err) {
    return { error: err.message || String(err) }
  }
}

export const api = {
  overview: () => getJSON('api/overview'),
  businessEvaluations: () => getJSON('api/business/evaluations'),
  businessEvaluation: (id) => getJSON(`api/business/evaluations/${encodeURIComponent(id)}`),
  fixerInvestigations: () => getJSON('api/fixer/investigations'),
  fixerInvestigation: (id) => getJSON(`api/fixer/investigations/${encodeURIComponent(id)}`),
  monitorAlerts: () => getJSON('api/monitor/alerts'),
  monitorInvestigations: () => getJSON('api/monitor/investigations'),
  stability: () => getJSON('api/stability'),
  githubPRs: () => getJSON('api/github/prs?state=all'),
  githubIssues: () => getJSON('api/github/issues?state=all'),
  jaegerErrors: () => getJSON('api/jaeger/errors'),
}
