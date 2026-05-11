import { useState } from 'react'
import { Overview } from './views/Overview.jsx'
import { Agents } from './views/Agents.jsx'
import { Stability } from './views/Stability.jsx'
import { Github } from './views/Github.jsx'
import { Errors } from './views/Errors.jsx'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'agents', label: 'Agents' },
  { id: 'stability', label: 'Stability' },
  { id: 'github', label: 'GitHub' },
  { id: 'errors', label: 'Errors' },
]

export default function App() {
  const [tab, setTab] = useState('overview')

  return (
    <div className="app">
      <div className="header">
        <div>
          <h1>Reacting to AI — Dashboard</h1>
          <div className="sub">Live view across monitor, fixer, business, reviewer agents</div>
        </div>
        <div className="sub">Polling every 3s</div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? 'active' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview onNavigate={setTab} />}
      {tab === 'agents' && <Agents />}
      {tab === 'stability' && <Stability />}
      {tab === 'github' && <Github />}
      {tab === 'errors' && <Errors />}
    </div>
  )
}
