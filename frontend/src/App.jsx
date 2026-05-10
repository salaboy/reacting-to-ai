import { useState, useEffect } from 'react'
import './App.css'

const icons = {
  accounts: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  ),
  transfer: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  ),
  support: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  back: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  ),
  chevron: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
  checking: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  ),
  savings: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.5 1.7-1 2-2h2v-4h-2c0-1-.5-1.5-1-2" />
      <path d="M2 9.5a.5.5 0 1 0 1 0 .5.5 0 1 0-1 0" />
    </svg>
  ),
  credit: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
      <line x1="6" y1="14" x2="10" y2="14" />
    </svg>
  ),
  alert: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  success: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  phone: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  ),
}

function getAccountIcon(type) {
  if (type === 'savings') return icons.savings
  if (type === 'credit') return icons.credit
  return icons.checking
}

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

  useEffect(() => {
    fetchAccounts()
  }, [])

  const fetchAccounts = async () => {
    setLoading(true)
    try {
      const res = await fetch('api/accounts')
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
      const res = await fetch(`api/accounts/${account.id}/transactions`)
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
      const res = await fetch('api/transfers', {
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
      const res = await fetch('api/support', {
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

  const totalBalance = accounts
    .filter(a => a.type !== 'credit')
    .reduce((sum, a) => sum + a.balance, 0)

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        {view === 'transactions' && selectedAccount ? (
          <>
            <button className="header-back" onClick={() => { setView('accounts'); setSelectedAccount(null) }}>
              {icons.back}
            </button>
            <h1 className="header-title">{selectedAccount.name}</h1>
            <div className="header-spacer" />
          </>
        ) : (
          <>
            <div className="header-logo">HB</div>
            <h1 className="header-title">HomeBanking</h1>
            <div className="header-spacer" />
          </>
        )}
      </header>

      {/* Content */}
      <main className="content">
        {loading && (
          <div className="loading">
            <div className="spinner" />
            <p>Loading...</p>
          </div>
        )}

        {/* Accounts View */}
        {view === 'accounts' && !loading && (
          <div className="view-accounts">
            <div className="balance-hero">
              <span className="balance-label">Total Balance</span>
              <span className="balance-amount">{formatCurrency(totalBalance, 'USD')}</span>
            </div>

            <div className="section">
              <h2 className="section-title">Accounts</h2>
              <div className="account-list">
                {accounts.map((account) => (
                  <button
                    key={account.id}
                    className="account-card"
                    onClick={() => fetchTransactions(account)}
                  >
                    <div className="account-icon-wrap">
                      {getAccountIcon(account.type)}
                    </div>
                    <div className="account-info">
                      <span className="account-name">{account.name}</span>
                      <span className="account-type">{account.type}</span>
                    </div>
                    <div className="account-right">
                      <span className={`account-balance ${account.balance < 0 ? 'negative' : ''}`}>
                        {formatCurrency(account.balance, account.currency)}
                      </span>
                      {icons.chevron}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Transactions View */}
        {view === 'transactions' && !loading && selectedAccount && (
          <div className="view-transactions">
            <div className="txn-header-card">
              <span className="txn-header-label">Current Balance</span>
              <span className={`txn-header-balance ${selectedAccount.balance < 0 ? 'negative' : ''}`}>
                {formatCurrency(selectedAccount.balance, selectedAccount.currency)}
              </span>
            </div>

            <div className="section">
              <h2 className="section-title">Recent Transactions</h2>
              <div className="txn-list">
                {transactions.map((tx) => (
                  <div key={tx.id} className="txn-row">
                    <div className="txn-left">
                      <span className="txn-desc">{tx.description}</span>
                      <span className="txn-meta">{tx.date} &middot; {tx.category}</span>
                    </div>
                    <span className={`txn-amount ${tx.amount < 0 ? 'negative' : 'positive'}`}>
                      {tx.amount > 0 ? '+' : ''}{formatCurrency(tx.amount, tx.currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Transfer View */}
        {view === 'transfer' && (
          <div className="view-transfer">
            <div className="section">
              <h2 className="section-title">Wire Transfer</h2>
              <form className="form" onSubmit={handleTransfer}>
                <div className="form-group">
                  <label className="form-label">From Account</label>
                  <select
                    className="form-input"
                    value={transferForm.fromAccount}
                    onChange={(e) => setTransferForm({ ...transferForm, fromAccount: e.target.value })}
                    required
                  >
                    <option value="">Select account</option>
                    {accounts.filter(a => a.type !== 'credit').map((a) => (
                      <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.balance, a.currency)})</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">To Account / IBAN</label>
                  <input
                    className="form-input"
                    type="text"
                    placeholder="e.g. US64SVBKUS6S..."
                    value={transferForm.toAccount}
                    onChange={(e) => setTransferForm({ ...transferForm, toAccount: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Amount (USD)</label>
                  <input
                    className="form-input"
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
                  <label className="form-label">Description</label>
                  <input
                    className="form-input"
                    type="text"
                    placeholder="Payment reference"
                    value={transferForm.description}
                    onChange={(e) => setTransferForm({ ...transferForm, description: e.target.value })}
                    required
                  />
                </div>
                <div className="form-actions">
                  <button type="submit" className="btn btn-primary" disabled={transferLoading}>
                    {transferLoading ? 'Processing...' : 'Send Transfer'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setTransferForm({ fromAccount: '', toAccount: '', amount: '', description: '' })}
                  >
                    Clear
                  </button>
                </div>
              </form>

              {transferResult && (
                <div className={`alert ${transferResult.status === 200 ? 'alert-success' : 'alert-error'}`}>
                  <div className="alert-icon">
                    {transferResult.status === 200 ? icons.success : icons.alert}
                  </div>
                  <div className="alert-body">
                    <strong>{transferResult.status === 200 ? 'Transfer Successful' : `Error (HTTP ${transferResult.status})`}</strong>
                    <p>{transferResult.data.message}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Support View */}
        {view === 'support' && (
          <div className="view-support">
            <div className="section">
              <h2 className="section-title">Customer Support</h2>
              <div className="support-card">
                <p className="support-text">
                  Need help? Our representatives are available Monday through Friday, 9 AM - 5 PM EST.
                </p>
                <div className="support-phone">
                  {icons.phone}
                  <span>1-800-HOMEBANK</span>
                </div>
                <button
                  className="btn btn-primary btn-full"
                  onClick={handleSupport}
                  disabled={supportLoading}
                >
                  {supportLoading ? 'Connecting...' : 'Contact a Representative'}
                </button>
              </div>

              {supportResult && (
                <div className={`alert ${supportResult.status === 200 ? 'alert-success' : 'alert-error'}`}>
                  <div className="alert-icon">
                    {supportResult.status === 200 ? icons.success : icons.alert}
                  </div>
                  <div className="alert-body">
                    <strong>{supportResult.status === 200 ? 'Connected' : `Error (HTTP ${supportResult.status})`}</strong>
                    <p>{supportResult.data.message}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Bottom Navigation */}
      <nav className="tab-bar">
        <button
          className={`tab ${view === 'accounts' || view === 'transactions' ? 'tab-active' : ''}`}
          onClick={() => { setView('accounts'); setSelectedAccount(null) }}
        >
          {icons.accounts}
          <span>Accounts</span>
        </button>
        <button
          className={`tab ${view === 'transfer' ? 'tab-active' : ''}`}
          onClick={() => { setView('transfer'); setTransferResult(null) }}
        >
          {icons.transfer}
          <span>Transfer</span>
        </button>
        <button
          className={`tab ${view === 'support' ? 'tab-active' : ''}`}
          onClick={() => { setView('support'); setSupportResult(null) }}
        >
          {icons.support}
          <span>Support</span>
        </button>
      </nav>
    </div>
  )
}

export default App
