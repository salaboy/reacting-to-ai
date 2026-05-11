import { useState } from 'react'
import { Overview } from './views/Overview.jsx'
import { Dora } from './views/Dora.jsx'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'dora', label: 'DORA' },
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
          <button key={t.id}
                  className={tab === t.id ? 'active' : ''}
                  onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview />}
      {tab === 'dora' && <Dora />}
    </div>
  )
}
