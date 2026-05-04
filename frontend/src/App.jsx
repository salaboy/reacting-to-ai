import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [accounts, setAccounts] = useState([])
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [view, setView] = useState('accounts')
  const [loading, setLoading] = useState(false)
  const [transferForm, setTransferForm] = useState({
    fromAccount: '',
    toAccount: '',
    amount: '',
    description: '',
  })
  const [transferResult, setTransferResult] = useState(null)
  const [transferLoading, setTransferLoading] = useState(false)
  const [supportResult, setSupportResult] = useState(null)
  const [supportLoading, setSupportLoading] = useState(false)
  const [clock, setClock] = useState('')
  const [showAbout, setShowAbout] = useState(false)
  const [showStartMenu, setShowStartMenu] = useState(false)

  useEffect(() => {
    fetchAccounts()
    const tick = () => {
      const now = new Date()
      setClock(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }))
    }
    tick()
    const timer = setInterval(tick, 30000)
    return () => clearInterval(timer)
  }, [])

  const fetchAccounts = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/accounts')
      const data = await res.json()
      setAccounts(data)
    } catch (err) {
      console.error('Failed to fetch accounts:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchTransactions = async (account) => {
    setLoading(true)
    setSelectedAccount(account)
    setView('transactions')
    try {
      const res = await fetch(`/api/accounts/${account.id}/transactions`)
      const data = await res.json()
      setTransactions(data)
    } catch (err) {
      console.error('Failed to fetch transactions:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleTransfer = async (e) => {
    e.preventDefault()
    setTransferLoading(true)
    setTransferResult(null)
    try {
      const res = await fetch('/api/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_account: transferForm.fromAccount,
          to_account: transferForm.toAccount,
          amount: parseFloat(transferForm.amount),
          description: transferForm.description,
        }),
      })
      const data = await res.json()
      setTransferResult({ status: res.status, data })
    } catch (err) {
      setTransferResult({ status: 0, data: { message: err.message } })
    } finally {
      setTransferLoading(false)
    }
  }

  const handleSupport = async () => {
    setSupportLoading(true)
    setSupportResult(null)
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Customer requested representative contact' }),
      })
      const data = await res.json()
      setSupportResult({ status: res.status, data })
    } catch (err) {
      setSupportResult({ status: 0, data: { message: err.message } })
    } finally {
      setSupportLoading(false)
    }
  }

  const formatCurrency = (amount, currency) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
    }).format(amount)
  }

  const statusText = loading
    ? 'Connecting...'
    : view === 'accounts'
      ? `${accounts.length} account(s)`
      : view === 'transactions'
        ? `${transactions.length} txn(s)`
        : 'Ready'

  return (
    <div className="desktop" onClick={() => setShowStartMenu(false)}>
      {/* Win95 Window */}
      <div className="win95-window">
        <div className="title-bar">
          <div className="title-bar-text">
            <span className="title-icon">$</span>
            HomeBanking Pro 98
          </div>
          <div className="title-bar-controls">
            <button className="title-btn" aria-label="Minimize">_</button>
            <button className="title-btn" aria-label="Maximize">&#9633;</button>
            <button className="title-btn close" aria-label="Close">X</button>
          </div>
        </div>

        <div className="menu-bar">
          <span className="menu-item"><u>F</u>ile</span>
          <span className="menu-item"><u>E</u>dit</span>
          <span className="menu-item"><u>V</u>iew</span>
          <span className="menu-item" onClick={(e) => { e.stopPropagation(); setShowAbout(true) }}><u>H</u>elp</span>
        </div>

        {/* Toolbar nav */}
        <div className="toolbar">
          <button
            className={`toolbar-btn ${view === 'accounts' ? 'toolbar-active' : ''}`}
            onClick={() => { setView('accounts'); setSelectedAccount(null) }}
          >
            <span className="toolbar-icon">&#128179;</span>
            Accounts
          </button>
          <button
            className={`toolbar-btn ${view === 'transfer' ? 'toolbar-active' : ''}`}
            onClick={() => { setView('transfer'); setTransferResult(null) }}
          >
            <span className="toolbar-icon">&#128176;</span>
            Transfer
          </button>
          <button
            className={`toolbar-btn ${view === 'support' ? 'toolbar-active' : ''}`}
            onClick={() => { setView('support'); setSupportResult(null) }}
          >
            <span className="toolbar-icon">&#128222;</span>
            Support
          </button>
          <div className="toolbar-spacer" />
          <button className="toolbar-btn" onClick={fetchAccounts}>
            <span className="toolbar-icon">&#128260;</span>
            Refresh
          </button>
        </div>

        <div className="window-body">
          {loading && (
            <div className="loading-area">
              <div className="hourglass">&#9203;</div>
              <p>Connecting...</p>
              <div className="progress-bar-track">
                <div className="progress-bar-fill" />
              </div>
            </div>
          )}

          {view === 'accounts' && !loading && (
            <div className="panel">
              <div className="panel-header">
                <span className="panel-icon">&#128179;</span>
                My Accounts
              </div>
              {accounts.map((account, i) => (
                <div
                  key={account.id}
                  className={`account-card ${i % 2 === 0 ? 'row-even' : 'row-odd'}`}
                  onClick={() => fetchTransactions(account)}
                >
                  <div className="account-card-top">
                    <span className="account-card-name">
                      <span className="row-icon">&#128196;</span>
                      {account.name}
                    </span>
                    <span className="account-card-type">{account.type}</span>
                  </div>
                  <div className={`account-card-balance ${account.balance < 0 ? 'negative' : ''}`}>
                    {formatCurrency(account.balance, account.currency)}
                  </div>
                </div>
              ))}
              <div className="hint-text">
                Click an account to view transactions.
              </div>
            </div>
          )}

          {view === 'transactions' && !loading && selectedAccount && (
            <div className="panel">
              <div className="panel-header">
                <span className="panel-icon">&#128196;</span>
                {selectedAccount.name}
              </div>
              <div className="txn-balance-row">
                Balance: {formatCurrency(selectedAccount.balance, selectedAccount.currency)}
              </div>
              <button
                className="win95-btn back-btn"
                onClick={() => { setView('accounts'); setSelectedAccount(null) }}
              >
                &lt;&lt; Back
              </button>
              <div className="txn-list">
                {transactions.map((tx, i) => (
                  <div key={tx.id} className={`txn-row ${i % 2 === 0 ? 'row-even' : 'row-odd'}`}>
                    <div className="txn-row-top">
                      <span className="txn-desc">{tx.description}</span>
                      <span className={`txn-amount ${tx.amount < 0 ? 'negative' : 'positive'}`}>
                        {tx.amount > 0 ? '+' : ''}{formatCurrency(tx.amount, tx.currency)}
                      </span>
                    </div>
                    <div className="txn-row-bottom">
                      <span className="txn-date">{tx.date}</span>
                      <span className="txn-cat">{tx.category}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === 'transfer' && (
            <div className="panel">
              <div className="panel-header">
                <span className="panel-icon">&#128176;</span>
                Wire Transfer
              </div>
              <form className="transfer-form" onSubmit={handleTransfer}>
                <fieldset className="win95-fieldset">
                  <legend>Transfer Details</legend>
                  <div className="form-group">
                    <label>From Account:</label>
                    <select
                      value={transferForm.fromAccount}
                      onChange={(e) => setTransferForm({ ...transferForm, fromAccount: e.target.value })}
                      required
                    >
                      <option value="">-- Select --</option>
                      {accounts.filter(a => a.type !== 'credit').map((a) => (
                        <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.balance, a.currency)})</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>To Account / IBAN:</label>
                    <input
                      type="text"
                      placeholder="e.g. US64SVBKUS6S..."
                      value={transferForm.toAccount}
                      onChange={(e) => setTransferForm({ ...transferForm, toAccount: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Amount (USD):</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="0.00"
                      value={transferForm.amount}
                      onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Description:</label>
                    <input
                      type="text"
                      placeholder="Payment reference"
                      value={transferForm.description}
                      onChange={(e) => setTransferForm({ ...transferForm, description: e.target.value })}
                      required
                    />
                  </div>
                </fieldset>
                <div className="form-actions">
                  <button type="submit" className="win95-btn primary" disabled={transferLoading}>
                    {transferLoading ? 'Processing...' : 'Send Transfer'}
                  </button>
                  <button
                    type="button"
                    className="win95-btn"
                    onClick={() => setTransferForm({ fromAccount: '', toAccount: '', amount: '', description: '' })}
                  >
                    Clear
                  </button>
                </div>
              </form>

              {transferResult && (
                <div className={`result-dialog ${transferResult.status === 200 ? 'result-success' : 'result-error'}`}>
                  <div className="result-dialog-icon">
                    {transferResult.status === 200 ? '\u2713' : '\u2716'}
                  </div>
                  <div className="result-dialog-body">
                    <div className="result-status">
                      {transferResult.status === 200 ? 'Transfer OK' : `Error (HTTP ${transferResult.status})`}
                    </div>
                    <p>{transferResult.data.message}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {view === 'support' && (
            <div className="panel">
              <div className="panel-header">
                <span className="panel-icon">&#128222;</span>
                Contact Support
              </div>
              <div className="support-view">
                <fieldset className="win95-fieldset">
                  <legend>Customer Support</legend>
                  <p className="support-text">
                    Having troubles? Our reps are available Mon-Fri, 9AM-5PM EST.
                  </p>
                  <div className="support-info">
                    <span>Toll-Free:</span> 1-800-HOMEBANK
                  </div>
                </fieldset>
                <div className="form-actions">
                  <button
                    className="win95-btn primary"
                    onClick={handleSupport}
                    disabled={supportLoading}
                  >
                    {supportLoading ? 'Connecting...' : 'Contact Representative'}
                  </button>
                </div>

                {supportResult && (
                  <div className={`result-dialog ${supportResult.status === 200 ? 'result-success' : 'result-error'}`}>
                    <div className="result-dialog-icon">
                      {supportResult.status === 200 ? '\u2713' : '\u2716'}
                    </div>
                    <div className="result-dialog-body">
                      <div className="result-status">
                        {supportResult.status === 200 ? 'Connected' : `Error (HTTP ${supportResult.status})`}
                      </div>
                      <p>{supportResult.data.message}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Taskbar */}
        <div className="taskbar">
          <button
            className="start-btn"
            onClick={(e) => { e.stopPropagation(); setShowStartMenu(!showStartMenu) }}
          >
            <span className="start-flag">&#9632;</span>
            Start
          </button>
          <div className="taskbar-spacer" />
          <div className="system-tray">
            <span className="status-text">{statusText}</span>
            <span className="tray-clock">{clock}</span>
          </div>
        </div>

        {/* Start Menu */}
        {showStartMenu && (
          <div className="start-menu" onClick={(e) => e.stopPropagation()}>
            <div className="start-menu-sidebar">HB98</div>
            <div className="start-menu-items">
              <div className="start-menu-item" onClick={() => { setView('accounts'); setShowStartMenu(false) }}>
                <span className="smi-icon">&#128179;</span> Accounts
              </div>
              <div className="start-menu-item" onClick={() => { setView('transfer'); setShowStartMenu(false) }}>
                <span className="smi-icon">&#128176;</span> Transfer
              </div>
              <div className="start-menu-item" onClick={() => { setView('support'); setSupportResult(null); setShowStartMenu(false) }}>
                <span className="smi-icon">&#128222;</span> Support
              </div>
              <div className="start-menu-divider" />
              <div className="start-menu-item" onClick={() => { setShowAbout(true); setShowStartMenu(false) }}>
                <span className="smi-icon">&#9432;</span> About
              </div>
            </div>
          </div>
        )}
      </div>

      {/* About Dialog */}
      {showAbout && (
        <div className="dialog-overlay" onClick={() => setShowAbout(false)}>
          <div className="win95-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="title-bar dialog-title-bar">
              <div className="title-bar-text">About</div>
              <div className="title-bar-controls">
                <button className="title-btn close" onClick={() => setShowAbout(false)}>X</button>
              </div>
            </div>
            <div className="dialog-body">
              <div className="about-logo">$$$</div>
              <p><strong>HomeBanking Pro 98</strong></p>
              <p>Enterprise Edition v1.0.98</p>
              <p className="about-copy">Copyright &copy; 1998</p>
              <p className="about-copy">HomeBanking Corp.</p>
              <p className="about-mem">RAM: 32,768 KB</p>
              <button className="win95-btn primary" onClick={() => setShowAbout(false)}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
