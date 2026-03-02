import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api, WS_BASE } from '../utils/api'
import './StudentPage.css'

const STATUS_STEPS = ['pending', 'stock_verified', 'in_kitchen', 'ready']
const STATUS_LABELS = {
  pending: 'Pending',
  stock_verified: 'Stock Verified',
  in_kitchen: 'In Kitchen',
  ready: 'Ready! 🎉',
}
const STATUS_ICONS = { pending: '⏳', stock_verified: '✅', in_kitchen: '👨‍🍳', ready: '🍽️' }

function getStatusIndex(status) {
  const idx = STATUS_STEPS.indexOf(status)
  return idx === -1 ? 0 : idx
}

export default function StudentPage({ toast }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [loadingItems, setLoadingItems] = useState(true)
  const [activeOrder, setActiveOrder] = useState(null)
  const [placing, setPlacing] = useState(null) // item_id being ordered
  const [pastOrders, setPastOrders] = useState([])
  const wsRef = useRef(null)

  useEffect(() => {
    loadItems()
    loadOrders()
    connectWS()
    return () => wsRef.current?.close()
  }, [])

  async function loadItems() {
    setLoadingItems(true)
    try {
      const data = await api.stock.items()
      setItems(data.data || data || [])
    } catch { toast('Failed to load menu', 'error') }
    setLoadingItems(false)
  }

  async function loadOrders() {
    try {
      const data = await api.orders.all()
      const all = data.data || data || []
      const mine = all.filter(o => o.student_id === user.student_id)
      setPastOrders(mine.slice(-10).reverse())
      const active = mine.find(o => o.status !== 'ready' && o.status !== 'cancelled')
      if (active) setActiveOrder(active)
    } catch {}
  }

  function connectWS() {
    try {
      const ws = new WebSocket(`${WS_BASE}/ws/student/${user.student_id}/`)
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.order_id) {
            setActiveOrder(prev => {
              if (prev?.order_id === msg.order_id) return { ...prev, ...msg }
              return prev
            })
            setPastOrders(prev => prev.map(o =>
              o.order_id === msg.order_id ? { ...o, ...msg } : o
            ))
            if (msg.status === 'ready') toast(`Order #${msg.order_id} is READY! 🍽️`, 'success')
            else if (msg.status === 'in_kitchen') toast(`Order #${msg.order_id} is in the kitchen 👨‍🍳`, 'info')
          }
        } catch {}
      }
      ws.onerror = () => {}
      wsRef.current = ws
    } catch {}
  }

  async function placeOrder(item) {
    if (activeOrder && activeOrder.status !== 'ready' && activeOrder.status !== 'cancelled') {
      toast('You already have an active order', 'warn'); return
    }
    setPlacing(item.id)
    try {
      const data = await api.orders.place(item.id)
      const order = data.data || data
      setActiveOrder(order)
      setPastOrders(prev => [order, ...prev])
      toast(`Order placed! #${order.order_id}`, 'success')
    } catch (err) {
      toast(err.message || 'Failed to place order', 'error')
    }
    setPlacing(null)
  }

  async function cancelOrder(orderId) {
    try {
      await api.orders.cancel(orderId)
      setActiveOrder(null)
      setPastOrders(prev => prev.map(o =>
        o.order_id === orderId ? { ...o, status: 'cancelled' } : o
      ))
      toast('Order cancelled', 'warn')
    } catch (err) { toast(err.message, 'error') }
  }

  function handleLogout() { logout(); navigate('/') }

  return (
    <div className="student-page">
      <header className="student-header fade-up">
        <div className="student-header-left">
          <span className="student-logo">⚡ IUT Cafeteria</span>
          <span className="badge badge-orange">Iftar Rush</span>
        </div>
        <div className="student-header-right">
          <span className="student-id text-mono">{user.student_id}</span>
          <button className="btn btn-ghost btn-sm" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <div className="student-body">
        {/* Active Order Tracker */}
        {activeOrder && (
          <section className="tracker-section fade-up-1">
            <div className="tracker-header">
              <div>
                <h2 className="tracker-title">Order #{activeOrder.order_id}</h2>
                <p className="tracker-item">{activeOrder.item_name || `Item #${activeOrder.item_id}`}</p>
              </div>
              {activeOrder.status !== 'ready' && activeOrder.status !== 'cancelled' && (
                <button className="btn btn-sm" onClick={() => cancelOrder(activeOrder.order_id)}>Cancel</button>
              )}
              {activeOrder.status === 'ready' && (
                <button className="btn btn-sm btn-ghost" onClick={() => setActiveOrder(null)}>Dismiss</button>
              )}
            </div>

            <div className="tracker-steps">
              {STATUS_STEPS.map((step, i) => {
                const currentIdx = getStatusIndex(activeOrder.status)
                const state = i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'upcoming'
                return (
                  <div key={step} className={`tracker-step tracker-step-${state}`}>
                    <div className="tracker-step-dot">
                      {state === 'done' ? '✓' : STATUS_ICONS[step]}
                    </div>
                    <div className="tracker-step-label">{STATUS_LABELS[step]}</div>
                    {i < STATUS_STEPS.length - 1 && (
                      <div className={`tracker-step-line ${state === 'done' ? 'filled' : ''}`} />
                    )}
                  </div>
                )
              })}
            </div>

            {activeOrder.status === 'ready' && (
              <div className="tracker-ready">
                <span>🎉 Your order is ready! Pick it up at the counter.</span>
              </div>
            )}
          </section>
        )}

        {/* Menu */}
        <section className="menu-section fade-up-2">
          <div className="section-header">
            <h2 className="section-title">Today's Menu</h2>
            <button className="btn btn-ghost btn-sm" onClick={loadItems}>↻ Refresh</button>
          </div>

          {loadingItems ? (
            <div className="menu-loading"><span className="spinner" /> Loading menu…</div>
          ) : (
            <div className="menu-grid">
              {items.length === 0 && <p className="empty">No items available.</p>}
              {items.map(item => (
                <div key={item.id} className={`menu-item ${!item.available || item.is_paused ? 'unavailable' : ''}`}>
                  <div className="menu-item-header">
                    <span className="menu-item-name">{item.name}</span>
                    {item.is_paused
                      ? <span className="badge badge-gray">Paused</span>
                      : item.available
                        ? <span className="badge badge-green">Available</span>
                        : <span className="badge badge-red">Sold Out</span>
                    }
                  </div>
                  <div className="menu-item-meta">
                    <span className="menu-item-price text-mono">৳{item.price}</span>
                    <span className="menu-item-qty text-mono">{item.quantity} left</span>
                  </div>
                  <button
                    className="btn btn-primary w-full"
                    disabled={!item.available || item.is_paused || placing === item.id}
                    onClick={() => placeOrder(item)}
                  >
                    {placing === item.id ? <span className="spinner" /> : 'Order Now'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Past Orders */}
        {pastOrders.length > 0 && (
          <section className="history-section fade-up-3">
            <h2 className="section-title">Order History</h2>
            <div className="history-list">
              {pastOrders.map(order => (
                <div key={order.order_id} className="history-item">
                  <div className="history-item-left">
                    <span className="history-order-id text-mono">#{order.order_id}</span>
                    <span className="history-item-name">{order.item_name || `Item #${order.item_id}`}</span>
                  </div>
                  <StatusBadge status={order.status} />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status }) {
  const map = {
    pending: 'badge-yellow',
    stock_verified: 'badge-blue',
    in_kitchen: 'badge-orange',
    ready: 'badge-green',
    cancelled: 'badge-red',
  }
  return <span className={`badge ${map[status] || 'badge-gray'}`}>{STATUS_LABELS[status] || status}</span>
}