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

  useEffect(() => {
    fetchAccounts()
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

  const formatCurrency = (amount, currency) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
    }).format(amount)
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Home Banking</h1>
        <nav className="nav">
          <button
            className={`nav-btn ${view === 'accounts' ? 'active' : ''}`}
            onClick={() => { setView('accounts'); setSelectedAccount(null) }}
          >
            Accounts
          </button>
          <button
            className={`nav-btn ${view === 'transfer' ? 'active' : ''}`}
            onClick={() => { setView('transfer'); setTransferResult(null) }}
          >
            Transfer
          </button>
        </nav>
      </header>

      {loading && <p className="loading">Loading...</p>}

      {view === 'accounts' && !loading && (
        <div className="accounts-list">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="account-card"
              onClick={() => fetchTransactions(account)}
            >
              <div className="account-info">
                <span className="account-name">{account.name}</span>
                <span className="account-type">{account.type}</span>
              </div>
              <div className={`account-balance ${account.balance < 0 ? 'negative' : ''}`}>
                {formatCurrency(account.balance, account.currency)}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'transactions' && !loading && selectedAccount && (
        <div className="transactions-view">
          <button className="back-btn" onClick={() => { setView('accounts'); setSelectedAccount(null) }}>
            Back to Accounts
          </button>
          <div className="transactions-header">
            <h2>{selectedAccount.name}</h2>
            <span className={`account-balance ${selectedAccount.balance < 0 ? 'negative' : ''}`}>
              {formatCurrency(selectedAccount.balance, selectedAccount.currency)}
            </span>
          </div>
          <div className="transactions-list">
            {transactions.map((tx) => (
              <div key={tx.id} className="transaction-row">
                <div className="transaction-left">
                  <span className="transaction-desc">{tx.description}</span>
                  <span className="transaction-meta">{tx.date} &middot; {tx.category}</span>
                </div>
                <div className={`transaction-amount ${tx.amount < 0 ? 'negative' : 'positive'}`}>
                  {tx.amount > 0 ? '+' : ''}{formatCurrency(tx.amount, tx.currency)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === 'transfer' && (
        <div className="transfer-view">
          <h2>New Transfer</h2>
          <form className="transfer-form" onSubmit={handleTransfer}>
            <div className="form-group">
              <label>From Account</label>
              <select
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
              <label>To Account / IBAN</label>
              <input
                type="text"
                placeholder="e.g. US64SVBKUS6S3300958879"
                value={transferForm.toAccount}
                onChange={(e) => setTransferForm({ ...transferForm, toAccount: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>Amount (USD)</label>
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
              <label>Description</label>
              <input
                type="text"
                placeholder="Payment reference"
                value={transferForm.description}
                onChange={(e) => setTransferForm({ ...transferForm, description: e.target.value })}
                required
              />
            </div>
            <button type="submit" className="submit-btn" disabled={transferLoading}>
              {transferLoading ? 'Processing...' : 'Send Transfer'}
            </button>
          </form>

          {transferResult && (
            <div className={`result ${transferResult.status === 200 ? 'result-success' : 'result-error'}`}>
              <div className="result-status">HTTP {transferResult.status}</div>
              <p>{transferResult.data.message}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default App
