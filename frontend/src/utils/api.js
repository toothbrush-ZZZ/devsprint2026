const PORTS = {
  identity: 'http://localhost:8001',
  stock:    'http://localhost:8002',
  order:    'http://localhost:8003',
  kitchen:  'http://localhost:8004',
  notify:   'http://localhost:8005',
}

function getToken() {
  return localStorage.getItem('access_token')
}

async function request(service, path, options = {}) {
  const base = PORTS[service]
  const token = getToken()
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${base}${path}`, { ...options, headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw { status: res.status, message: data.error || 'Request failed', data }
  return data
}

// ── Auth ─────────────────────────────────────────────────────────────────────
export const api = {
  auth: {
    register: (student_id, password) =>
      request('identity', '/register/', { method: 'POST', body: JSON.stringify({ student_id, password }) }),
    login: (student_id, password) =>
      request('identity', '/login/', { method: 'POST', body: JSON.stringify({ student_id, password }) }),
    health: () => request('identity', '/health/'),
    metrics: () => request('identity', '/metrics/'),
    chaos: () => request('identity', '/chaos/', { method: 'POST' }),
  },

  stock: {
    items: () => request('stock', '/items/'),
    createItem: (data) => request('stock', '/items/create/', { method: 'POST', body: JSON.stringify(data) }),
    deleteItem: (id) => request('stock', `/items/${id}/delete/`, { method: 'DELETE' }),
    check: (id) => request('stock', `/stock/${id}/`),
    decrement: (id) => request('stock', `/stock/${id}/decrement/`, { method: 'POST' }),
    restore: (id) => request('stock', `/stock/${id}/restore/`, { method: 'POST' }),
    add: (id, quantity) => request('stock', `/stock/${id}/add/`, { method: 'POST', body: JSON.stringify({ quantity }) }),
    pause: (id) => request('stock', `/stock/${id}/pause/`, { method: 'POST' }),
    unpause: (id) => request('stock', `/stock/${id}/unpause/`, { method: 'POST' }),
    health: () => request('stock', '/health/'),
    metrics: () => request('stock', '/metrics/'),
    chaos: () => request('stock', '/chaos/', { method: 'POST' }),
  },

  orders: {
    place: (item_id) => request('order', '/order/', { method: 'POST', body: JSON.stringify({ item_id }) }),
    get: (id) => request('order', `/order/${id}/`),
    all: () => request('order', '/orders/'),
    cancel: (id) => request('order', `/order/${id}/cancel/`, { method: 'DELETE' }),
    updateStatus: (id, status) => request('order', `/order/${id}/status/`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    health: () => request('order', '/health/'),
    metrics: () => request('order', '/metrics/'),
    chaos: () => request('order', '/chaos/', { method: 'POST' }),
  },

  kitchen: {
    all: () => request('kitchen', '/kitchen/orders/all/'),
    markReady: (id) => request('kitchen', `/kitchen/orders/${id}/ready/`, { method: 'PATCH' }),
    cancel: (id) => request('kitchen', `/kitchen/orders/${id}/cancel/`, { method: 'DELETE' }),
    health: () => request('kitchen', '/health/'),
    metrics: () => request('kitchen', '/metrics/'),
    chaos: () => request('kitchen', '/chaos/', { method: 'POST' }),
  },

  notify: {
    health: () => request('notify', '/health/'),
    metrics: () => request('notify', '/metrics/'),
    chaos: () => request('notify', '/chaos/', { method: 'POST' }),
  },
}

// ── WebSocket helper ──────────────────────────────────────────────────────────
export function createWS(path, onMessage) {
  const ws = new WebSocket(`ws://localhost:8005${path}`)
  ws.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data)) } catch { onMessage(e.data) }
  }
  return ws
}

export const WS_BASE = 'ws://localhost:8005'