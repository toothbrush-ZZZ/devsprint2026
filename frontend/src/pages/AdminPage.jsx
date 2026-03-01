import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api, WS_BASE } from '../utils/api'
import './AdminPage.css'

const SERVICES = [
  { key: 'identity', label: 'Identity Provider', port: 8001, color: '#3b82f6' },
  { key: 'stock',    label: 'Stock Service',     port: 8002, color: '#22c55e' },
  { key: 'order',    label: 'Order Gateway',     port: 8003, color: '#f59e0b' },
  { key: 'kitchen',  label: 'Kitchen Queue',     port: 8004, color: '#ff6b2b' },
  { key: 'notify',   label: 'Notification Hub',  port: 8005, color: '#a855f7' },
]

const healthApi = {
  identity: api.auth.health,
  stock: api.stock.health,
  order: api.orders.health,
  kitchen: api.kitchen.health,
  notify: api.notify.health,
}
const metricsApi = {
  identity: api.auth.metrics,
  stock: api.stock.metrics,
  order: api.orders.metrics,
  kitchen: api.kitchen.metrics,
  notify: api.notify.metrics,
}
const chaosApi = {
  identity: api.auth.chaos,
  stock: api.stock.chaos,
  order: api.orders.chaos,
  kitchen: api.kitchen.chaos,
  notify: api.notify.chaos,
}

export default function AdminPage({ toast }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState('dashboard') // dashboard | orders | menu
  const [health, setHealth] = useState({})
  const [metrics, setMetrics] = useState({})
  const [latency, setLatency] = useState({})
  const [chaosMode, setChaosMode] = useState({})
  const [orders, setOrders] = useState([])
  const [items, setItems] = useState([])
  const [polling, setPolling] = useState(true)
  const [latencyHistory, setLatencyHistory] = useState({})
  const [alerting, setAlerting] = useState(false)
  // Menu management
  const [newItem, setNewItem] = useState({ name: '', price: '', quantity: '' })
  const [addingItem, setAddingItem] = useState(false)
  const wsRef = useRef(null)
  const pollRef = useRef(null)

  useEffect(() => {
    if (!user?.is_admin) { navigate('/student'); return }
    fetchAll()
    connectWS()
    return () => { clearInterval(pollRef.current); wsRef.current?.close() }
  }, [])

  useEffect(() => {
    if (polling) {
      pollRef.current = setInterval(fetchAll, 5000)
    } else {
      clearInterval(pollRef.current)
    }
    return () => clearInterval(pollRef.current)
  }, [polling])

  // Check for alert: order gateway avg latency > 1000ms over last 30s (6 polls)
  useEffect(() => {
    const hist = latencyHistory['order'] || []
    if (hist.length >= 6) {
      const recent = hist.slice(-6)
      const avg = recent.reduce((a,b) => a+b, 0) / recent.length
      setAlerting(avg > 1000)
    }
  }, [latencyHistory])

  async function fetchAll() {
    await Promise.all([fetchHealth(), fetchMetrics()])
    if (tab === 'orders' || tab === 'dashboard') fetchOrders()
    if (tab === 'menu') fetchItems()
  }

  async function fetchHealth() {
    const results = {}
    const lat = {}
    await Promise.all(
      SERVICES.map(async (s) => {
        const start = Date.now()
        try {
          const data = await healthApi[s.key]()
          lat[s.key] = Date.now() - start
          results[s.key] = data.status === 'ok' ? 'ok' : 'degraded'
        } catch {
          lat[s.key] = null
          results[s.key] = 'down'
        }
      })
    )
    setHealth(results)
    setLatency(lat)
    setLatencyHistory(prev => {
      const next = { ...prev }
      SERVICES.forEach(s => {
        if (lat[s.key] !== null) {
          next[s.key] = [...(prev[s.key] || []).slice(-29), lat[s.key]]
        }
      })
      return next
    })
  }

  async function fetchMetrics() {
    const results = {}
    await Promise.all(
      SERVICES.map(async (s) => {
        try {
          results[s.key] = await metricsApi[s.key]()
        } catch { results[s.key] = null }
      })
    )
    setMetrics(results)
  }

  async function fetchOrders() {
    try {
      const data = await api.orders.all()
      setOrders(data.data || data || [])
    } catch {}
  }

  async function fetchItems() {
    try {
      const data = await api.stock.items()
      setItems(data.data || data || [])
    } catch {}
  }

  function connectWS() {
    try {
      const ws = new WebSocket(`${WS_BASE}/ws/kitchen/`)
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.order_id) {
            setOrders(prev => {
              const exists = prev.find(o => o.order_id === msg.order_id)
              if (exists) return prev.map(o => o.order_id === msg.order_id ? { ...o, ...msg } : o)
              return [msg, ...prev]
            })
          }
        } catch {}
      }
      wsRef.current = ws
    } catch {}
  }

  async function toggleChaos(serviceKey) {
    try {
      await chaosApi[serviceKey]()
      const next = !chaosMode[serviceKey]
      setChaosMode(prev => ({ ...prev, [serviceKey]: next }))
      toast(`Chaos ${next ? 'ENABLED' : 'disabled'} for ${serviceKey}`, next ? 'error' : 'success')
    } catch (err) { toast(err.message || 'Chaos toggle failed', 'error') }
  }

  async function createItem() {
    if (!newItem.name || !newItem.price || !newItem.quantity) { toast('Fill all fields', 'warn'); return }
    setAddingItem(true)
    try {
      await api.stock.createItem({ name: newItem.name, price: newItem.price, quantity: parseInt(newItem.quantity) })
      toast('Item created!', 'success')
      setNewItem({ name: '', price: '', quantity: '' })
      fetchItems()
    } catch (err) { toast(err.message, 'error') }
    setAddingItem(false)
  }

  async function deleteItem(id) {
    try { await api.stock.deleteItem(id); fetchItems(); toast('Item deleted', 'warn') }
    catch (err) { toast(err.message, 'error') }
  }

  async function togglePause(item) {
    try {
      if (item.is_paused) await api.stock.unpause(item.id)
      else await api.stock.pause(item.id)
      fetchItems()
    } catch (err) { toast(err.message, 'error') }
  }

  async function markReady(orderId) {
    try {
      await api.kitchen.markReady(orderId)
      setOrders(prev => prev.map(o => o.order_id === orderId ? { ...o, status: 'ready' } : o))
      toast(`Order #${orderId} marked ready`, 'success')
    } catch (err) { toast(err.message, 'error') }
  }

  function handleLogout() { logout(); navigate('/') }

  const healthyCount = Object.values(health).filter(v => v === 'ok').length

  return (
    <div className="admin-page">
      {alerting && (
        <div className="alert-banner">
          ⚠ HIGH LATENCY ALERT — Order Gateway avg response &gt; 1s over last 30s
        </div>
      )}

      <header className="admin-header">
        <div className="admin-header-left">
          <span className="admin-logo">⚡ DevSprint Admin</span>
          <span className="badge badge-orange text-mono" style={{ fontSize: '10px' }}>{user?.student_id}</span>
        </div>
        <nav className="admin-nav">
          {['dashboard', 'orders', 'menu'].map(t => (
            <button
              key={t}
              className={`admin-nav-btn ${tab === t ? 'active' : ''}`}
              onClick={() => { setTab(t); if (t === 'orders') fetchOrders(); if (t === 'menu') fetchItems() }}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>
        <div className="admin-header-right">
          <button
            className={`btn btn-sm ${polling ? 'btn-ghost' : ''}`}
            onClick={() => setPolling(p => !p)}
          >
            <span className={`dot ${polling ? 'live' : ''}`} style={{ color: polling ? 'var(--green)' : 'var(--text3)' }} />
            {polling ? 'Live' : 'Paused'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <div className="admin-body">
        {/* DASHBOARD TAB */}
        {tab === 'dashboard' && (
          <div className="dashboard-grid">
            {/* Health Summary */}
            <div className="dash-summary fade-up">
              <div className="dash-summary-stat">
                <span className="dash-stat-value" style={{ color: healthyCount === 5 ? 'var(--green)' : 'var(--red)' }}>
                  {healthyCount}/5
                </span>
                <span className="dash-stat-label">Services Online</span>
              </div>
              <div className="dash-summary-stat">
                <span className="dash-stat-value">{orders.length}</span>
                <span className="dash-stat-label">Total Orders</span>
              </div>
              <div className="dash-summary-stat">
                <span className="dash-stat-value" style={{ color: Object.values(chaosMode).some(Boolean) ? 'var(--red)' : 'var(--text2)' }}>
                  {Object.values(chaosMode).filter(Boolean).length}
                </span>
                <span className="dash-stat-label">Chaos Active</span>
              </div>
            </div>

            {/* Service Health Grid */}
            <div className="section-label fade-up-1">Service Health</div>
            <div className="health-grid fade-up-1">
              {SERVICES.map(s => (
                <ServiceCard
                  key={s.key}
                  service={s}
                  status={health[s.key]}
                  latency={latency[s.key]}
                  metrics={metrics[s.key]}
                  chaos={chaosMode[s.key]}
                  onChaos={() => toggleChaos(s.key)}
                />
              ))}
            </div>

            {/* Recent Orders */}
            <div className="section-label fade-up-2">Recent Orders</div>
            <div className="fade-up-2">
              <OrderTable orders={orders.slice(0, 10)} onMarkReady={markReady} compact />
            </div>
          </div>
        )}

        {/* ORDERS TAB */}
        {tab === 'orders' && (
          <div className="fade-up">
            <div className="section-header-row">
              <h2 className="section-title">All Orders</h2>
              <button className="btn btn-ghost btn-sm" onClick={fetchOrders}>↻ Refresh</button>
            </div>
            <OrderTable orders={orders} onMarkReady={markReady} />
          </div>
        )}

        {/* MENU TAB */}
        {tab === 'menu' && (
          <div className="fade-up">
            <div className="section-header-row">
              <h2 className="section-title">Menu Management</h2>
              <button className="btn btn-ghost btn-sm" onClick={fetchItems}>↻ Refresh</button>
            </div>

            <div className="add-item-form">
              <input className="input" placeholder="Item name" value={newItem.name} onChange={e => setNewItem(p => ({ ...p, name: e.target.value }))} />
              <input className="input" placeholder="Price (৳)" value={newItem.price} onChange={e => setNewItem(p => ({ ...p, price: e.target.value }))} />
              <input className="input" placeholder="Qty" value={newItem.quantity} onChange={e => setNewItem(p => ({ ...p, quantity: e.target.value }))} />
              <button className="btn btn-primary" onClick={createItem} disabled={addingItem}>
                {addingItem ? <span className="spinner" /> : '+ Add Item'}
              </button>
            </div>

            <div className="menu-admin-list">
              {items.map(item => (
                <div key={item.id} className="menu-admin-item">
                  <div className="menu-admin-info">
                    <span className="menu-admin-name">{item.name}</span>
                    <span className="text-mono" style={{ fontSize: 13, color: 'var(--accent)' }}>৳{item.price}</span>
                    <span className="text-mono" style={{ fontSize: 12, color: 'var(--text2)' }}>qty: {item.quantity}</span>
                    {item.is_paused && <span className="badge badge-gray">Paused</span>}
                  </div>
                  <div className="menu-admin-actions">
                    <button className="btn btn-sm btn-ghost" onClick={() => togglePause(item)}>
                      {item.is_paused ? 'Unpause' : 'Pause'}
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => deleteItem(item.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ServiceCard({ service, status, latency, metrics, chaos, onChaos }) {
  const statusColor = status === 'ok' ? 'var(--green)' : status === 'down' ? 'var(--red)' : 'var(--yellow)'
  const statusLabel = status === 'ok' ? 'Online' : status === 'down' ? 'Down' : status || 'Unknown'

  return (
    <div className={`service-card ${status === 'down' ? 'service-down' : ''} ${chaos ? 'service-chaos' : ''}`}>
      <div className="service-card-header">
        <div className="service-indicator" style={{ background: service.color }} />
        <span className="service-name">{service.label}</span>
        <span className="service-port text-mono">:{service.port}</span>
      </div>

      <div className="service-status-row">
        <div className="flex items-center gap-2">
          <span className="dot live" style={{ color: statusColor }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: statusColor }}>{statusLabel}</span>
        </div>
        <span className="text-mono" style={{ fontSize: 12, color: 'var(--text3)' }}>
          {latency !== null && latency !== undefined ? `${latency}ms` : '—'}
        </span>
      </div>

      {metrics && (
        <div className="service-metrics">
          {Object.entries(metrics)
            .filter(([k]) => !['service', 'status'].includes(k))
            .slice(0, 3)
            .map(([k, v]) => (
              <div key={k} className="service-metric">
                <span className="service-metric-key">{k.replace(/_/g, ' ')}</span>
                <span className="service-metric-val text-mono">{String(v)}</span>
              </div>
            ))}
        </div>
      )}

      <button
        className={`btn btn-sm w-full chaos-btn ${chaos ? 'chaos-active' : ''}`}
        onClick={onChaos}
      >
        {chaos ? '💀 Chaos ON' : '☠ Toggle Chaos'}
      </button>
    </div>
  )
}

const STATUS_COLORS = {
  pending: 'badge-yellow',
  stock_verified: 'badge-blue',
  in_kitchen: 'badge-orange',
  ready: 'badge-green',
  cancelled: 'badge-red',
}
const STATUS_LABELS = {
  pending: 'Pending', stock_verified: 'Stock OK', in_kitchen: 'In Kitchen', ready: 'Ready', cancelled: 'Cancelled',
}

function OrderTable({ orders, onMarkReady, compact }) {
  if (!orders.length) return <p style={{ color: 'var(--text3)', fontSize: 14, padding: '24px 0' }}>No orders yet.</p>
  return (
    <div className="order-table-wrap">
      <table className="order-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Student</th>
            <th>Item</th>
            {!compact && <th>Qty</th>}
            <th>Status</th>
            {!compact && <th>Action</th>}
          </tr>
        </thead>
        <tbody>
          {orders.map(o => (
            <tr key={o.order_id}>
              <td className="text-mono" style={{ color: 'var(--text2)' }}>{o.order_id}</td>
              <td className="text-mono">{o.student_id}</td>
              <td>{o.item_name || `#${o.item_id}`}</td>
              {!compact && <td className="text-mono">{o.quantity || 1}</td>}
              <td><span className={`badge ${STATUS_COLORS[o.status] || 'badge-gray'}`}>{STATUS_LABELS[o.status] || o.status}</span></td>
              {!compact && (
                <td>
                  {o.status === 'in_kitchen' && (
                    <button className="btn btn-sm" onClick={() => onMarkReady(o.order_id)}>Mark Ready</button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}