import { useState, useEffect } from 'react';
import { api } from '../utils/api';
import IutLogo from '../components/IutLogo';

// ── Service metadata for the Chaos/Health/Metrics panels ────────────────────
const SERVICES = [
    { key: 'identity', label: 'Identity Provider', port: 8001 },
    { key: 'stock',    label: 'Stock Service',      port: 8002 },
    { key: 'order',    label: 'Order Gateway',      port: 8003 },
    { key: 'kitchen',  label: 'Kitchen Queue',      port: 8004 },
    { key: 'notification', label: 'Notification Hub', port: 8005 },
];

const AdminPage = ({ user, onLogout }) => {
    const [activeTab, setActiveTab] = useState('inventory');

    // Inventory state
    const [items, setItems] = useState([]);
    const [newItem, setNewItem] = useState({ name: '', price: '', quantity: '' });
    const [editingStockId, setEditingStockId] = useState(null);
    const [stockEditValue, setStockEditValue] = useState('');
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);

    // Kitchen / Orders state
    const [orders, setOrders] = useState([]);
    const [cancelConfirmOrderId, setCancelConfirmOrderId] = useState(null);

    // Chaos state: { identity: true/false, stock: false, ... }
    const [chaosState, setChaosState] = useState({});
    const [chaosLoading, setChaosLoading] = useState({});

    // Health state: { identity: {...}, stock: {...}, ... }
    const [healthData, setHealthData] = useState({});
    const [healthLoading, setHealthLoading] = useState(false);

    // Metrics state
    const [metricsData, setMetricsData] = useState({});
    const [metricsLoading, setMetricsLoading] = useState(false);

    // Reset Password (admin)
    const [rpStudentId, setRpStudentId] = useState('');
    const [rpNew, setRpNew] = useState('');
    const [rpMsg, setRpMsg] = useState('');
    const [showRpNew, setShowRpNew] = useState(false);

    // Notification
    const [notification, setNotification] = useState(null);

    useEffect(() => {
        fetchInventory();
        fetchOrders();
        fetchAllHealth();
        fetchAllMetrics();

        const ws = new WebSocket('ws://localhost:8005/ws/kitchen/');
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                // Skip the initial handshake message
                if (data.type === 'connected') return;
                if (data.order_id) {
                    showNotification(`New order #${data.order_id} received!`);
                    fetchOrders();
                }
            } catch (e) {
                console.error('WS parse error', e);
            }
        };
        return () => ws.close();
    }, []);

    const showNotification = (msg) => {
        setNotification(msg);
        setTimeout(() => setNotification(null), 5000);
    };

    // ── Inventory ────────────────────────────────────────────────────────────

    const fetchInventory = async () => {
        try {
            const data = await api.get('stock', '/items/', user.access_token);
            setItems(Array.isArray(data) ? data : []);
        } catch (err) { console.error('fetchInventory', err); }
    };

    const handleCreateItem = async (e) => {
        e.preventDefault();
        try {
            await api.post('stock', '/items/create/', {
                name: newItem.name,
                price: parseFloat(newItem.price),
                quantity: parseInt(newItem.quantity),
            }, user.access_token);
            showNotification(`Item "${newItem.name}" created!`);
            setNewItem({ name: '', price: '', quantity: '' });
            fetchInventory();
        } catch (err) {
            showNotification(err.message || 'Failed to create item.');
        }
    };

    const handleDeleteItem = async (id) => {
        try {
            await api.delete('stock', `/items/${id}/delete/`, user.access_token);
            showNotification('Item deleted.');
            setConfirmDeleteId(null);
            fetchInventory();
        } catch (err) {
            showNotification(err.message || 'Failed to delete item.');
            setConfirmDeleteId(null);
        }
    };

    const handleStockAction = async (id, action, quantity = null) => {
        let body = {};
        if (action === 'add') {
            if (quantity === null) {
                setEditingStockId(id);
                setStockEditValue('10');
                return;
            }
            const qty = parseInt(quantity, 10);
            if (!qty || qty <= 0) {
                showNotification('Please enter a positive number.');
                return;
            }
            body = { quantity: qty };
        }
        try {
            await api.post('stock', `/stock/${id}/${action}/`, body, user.access_token);
            showNotification(`Stock ${action} successful.`);
            setEditingStockId(null);
            fetchInventory();
        } catch (err) {
            showNotification(`Failed to ${action} stock: ${err.message}`);
        }
    };

    // ── Kitchen Queue ─────────────────────────────────────────────────────────

    const fetchOrders = async () => {
        try {
            const data = await api.get('kitchen', '/kitchen/orders/all/', user.access_token);
            setOrders(Array.isArray(data) ? data : []);
        } catch (err) { console.error('fetchOrders', err); }
    };

    const handleMarkReady = async (orderId) => {
        try {
            await api.patch('kitchen', `/kitchen/orders/${orderId}/ready/`, {}, user.access_token);
            showNotification(`Order #${orderId} marked as ready!`);
            fetchOrders();
        } catch (err) {
            showNotification(err.message || 'Failed to update order.');
        }
    };

    const handleCancelOrder = async (orderId) => {
        setCancelConfirmOrderId(null);
        try {
            await api.delete('order', `/order/${orderId}/cancel/`, user.access_token);
            showNotification(`Order #${orderId} cancelled.`);
            fetchOrders();
        } catch (err) {
            showNotification(err.message || 'Failed to cancel order.');
        }
    };

    // ── Chaos Toggle ──────────────────────────────────────────────────────────

    const handleChaosToggle = async (serviceKey) => {
        setChaosLoading(prev => ({ ...prev, [serviceKey]: true }));
        try {
            const data = await api.post(serviceKey, '/chaos/', {}, user.access_token);
            const isEnabled = data.status?.toLowerCase().includes('enabled');
            setChaosState(prev => ({ ...prev, [serviceKey]: isEnabled }));
            showNotification(data.status);
        } catch (err) {
            showNotification(`Chaos toggle failed for ${serviceKey}: ${err.message}`);
        } finally {
            setChaosLoading(prev => ({ ...prev, [serviceKey]: false }));
        }
    };

    // ── Health Checks ─────────────────────────────────────────────────────────

    const fetchAllHealth = async () => {
        setHealthLoading(true);
        const results = {};
        await Promise.allSettled(
            SERVICES.map(async (svc) => {
                try {
                    const data = await api.get(svc.key, '/health/', user.access_token);
                    results[svc.key] = { ok: true, data };
                } catch (err) {
                    results[svc.key] = { ok: false, data: err.data || { status: 'unreachable' } };
                }
            })
        );
        setHealthData(results);
        setHealthLoading(false);
    };

    // ── Metrics ───────────────────────────────────────────────────────────────

    const fetchAllMetrics = async () => {
        setMetricsLoading(true);
        const results = {};
        await Promise.allSettled(
            SERVICES.map(async (svc) => {
                try {
                    const data = await api.get(svc.key, '/metrics/', user.access_token);
                    results[svc.key] = data;
                } catch (err) {
                    results[svc.key] = null;
                }
            })
        );
        setMetricsData(results);
        setMetricsLoading(false);
    };

    // ── Admin Reset Password ──────────────────────────────────────────────────

    const handleAdminResetPassword = async (e) => {
        e.preventDefault();
        setRpMsg('');
        try {
            const res = await api.post('identity', '/reset-password/', {
                student_id: rpStudentId,
                new_password: rpNew,
            }, user.access_token);
            setRpMsg('success:' + (res.message || 'Password reset successfully!'));
            setRpStudentId('');
            setRpNew('');
        } catch (err) {
            setRpMsg('error:' + (err.message || 'Failed to reset password.'));
        }
    };

    // ── Helpers ───────────────────────────────────────────────────────────────

    const TABS = [
        { id: 'inventory', label: 'Inventory' },
        { id: 'kitchen',   label: 'Kitchen' },
        { id: 'chaos',     label: 'Chaos' },
        { id: 'health',    label: 'Health' },
        { id: 'metrics',   label: 'Metrics' },
        { id: 'admin',     label: 'Admin Tools' },
    ];

    const activeKitchenOrders = orders.filter(o => o.status !== 'ready' && o.status !== 'cancelled' && o.status !== 'failed');

    return (
        <div style={styles.page}>
            {/* ── Header ── */}
            <header style={styles.header}>
                <div style={styles.headerInner}>
                    <div style={styles.headerLeft}>
                        <IutLogo size={40} />
                        <div>
                            <h1 style={styles.headerTitle}>Admin Dashboard</h1>
                            <p style={styles.headerSub}>IUT Cafeteria · {user.student_id}</p>
                        </div>
                    </div>
                    <button style={styles.logoutBtn} onClick={onLogout}>Sign Out</button>
                </div>
            </header>

            <div style={styles.contentWrap}>
                {/* ── Tab Bar ── */}
                <div style={styles.tabBar}>
                    {TABS.map(t => (
                        <button
                            key={t.id}
                            onClick={() => setActiveTab(t.id)}
                            style={{
                                ...styles.tabBtn,
                                ...(activeTab === t.id ? styles.tabBtnActive : {})
                            }}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                {/* ── Content ── */}
                <main style={styles.main}>

                    {/* ── INVENTORY ── */}
                    {activeTab === 'inventory' && (
                        <div style={styles.inventoryGrid}>
                            <section className="card" style={styles.panel}>
                                <h3 style={styles.panelTitle}>Add New Item</h3>
                                <form onSubmit={handleCreateItem} style={styles.form}>
                                    <input style={styles.input} placeholder="Name" value={newItem.name} onChange={e => setNewItem({ ...newItem, name: e.target.value })} required />
                                    <input style={styles.input} placeholder="Price (৳)" type="number" step="0.01" value={newItem.price} onChange={e => setNewItem({ ...newItem, price: e.target.value })} required />
                                    <input style={styles.input} placeholder="Initial Stock" type="number" value={newItem.quantity} onChange={e => setNewItem({ ...newItem, quantity: e.target.value })} required />
                                    <button type="submit" className="btn-primary">Create Item</button>
                                </form>
                            </section>

                            <section>
                                <h3 style={styles.panelTitle}>Menu & Stock</h3>
                                <div style={styles.tableWrapper}>
                                    <table style={styles.table}>
                                        <thead>
                                            <tr>
                                                <th style={styles.th}>Name</th>
                                                <th style={styles.th}>Price</th>
                                                <th style={styles.th}>Stock</th>
                                                <th style={styles.th}>Status</th>
                                                <th style={styles.th}>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {items.map(item => (
                                                <tr key={item.id} style={styles.tr}>
                                                    <td style={styles.td}>{item.name}</td>
                                                    <td style={styles.td}>৳{item.price}</td>
                                                    <td style={styles.td}>{item.quantity}</td>
                                                    <td style={styles.td}>
                                                        <span style={{
                                                            ...styles.badge,
                                                            background: item.available ? 'rgba(34,197,94,0.22)' : 'rgba(248,113,113,0.22)',
                                                            color: item.available ? '#bbf7d0' : '#fecaca',
                                                            border: `1px solid ${item.available ? 'rgba(34,197,94,0.6)' : 'rgba(248,113,113,0.65)'}`
                                                        }}>
                                                            {item.available ? 'Active' : 'Paused'}
                                                        </span>
                                                    </td>
                                                    <td style={styles.td}>
                                                        {editingStockId === item.id ? (
                                                            <div style={styles.inlineEdit}>
                                                                <input
                                                                    type="number"
                                                                    style={styles.inlineInput}
                                                                    value={stockEditValue}
                                                                    onChange={e => setStockEditValue(e.target.value)}
                                                                    autoFocus
                                                                />
                                                                <button onClick={() => handleStockAction(item.id, 'add', stockEditValue)} style={styles.actionBtn} title="Confirm">✓</button>
                                                                <button onClick={() => setEditingStockId(null)} style={{ ...styles.actionBtn, color: '#dc2626' }} title="Cancel">✕</button>
                                                            </div>
                                                        ) : confirmDeleteId === item.id ? (
                                                            <div style={styles.actionGroup}>
                                                                <span style={{ fontSize: '0.8rem', color: '#dc2626', fontWeight: '600', marginRight: '4px' }}>Delete?</span>
                                                                <button onClick={() => handleDeleteItem(item.id)} style={{ ...styles.actionBtn, background: '#dc2626', color: 'white', border: '1px solid #dc2626' }} title="Confirm delete">Yes</button>
                                                                <button onClick={() => setConfirmDeleteId(null)} style={styles.actionBtn} title="Cancel">No</button>
                                                            </div>
                                                        ) : (
                                                            <div style={styles.actionGroup}>
                                                                <button onClick={() => handleStockAction(item.id, 'add')} style={styles.actionBtn} title="Add stock">+</button>
                                                                <button onClick={() => handleStockAction(item.id, item.available ? 'pause' : 'unpause')} style={styles.actionBtn} title={item.available ? 'Pause' : 'Unpause'}>
                                                                    {item.available ? '⏸' : '▶'}
                                                                </button>
                                                                <button onClick={() => setConfirmDeleteId(item.id)} style={{ ...styles.actionBtn, color: '#dc2626' }} title="Delete">✕</button>
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                            {items.length === 0 && (
                                                <tr><td colSpan={5} style={{ ...styles.td, color: '#94a3b8', textAlign: 'center', padding: '2rem' }}>No items yet</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </section>
                        </div>
                    )}

                    {/* ── KITCHEN ── */}
                    {activeTab === 'kitchen' && (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                                <h3 style={styles.panelTitle}>Live Kitchen Queue ({activeKitchenOrders.length} active)</h3>
                                <button className="btn-primary" onClick={fetchOrders}>Refresh</button>
                            </div>
                            <div style={styles.orderGrid}>
                                {activeKitchenOrders.map(order => (
                                    <div key={order.order_id} className="card" style={styles.orderCard}>
                                        <div style={styles.orderCardHeader}>
                                            <span style={{ fontWeight: '700', color: '#1a6137' }}>#{order.order_id}</span>
                                            <span style={{ color: '#4b5563', fontSize: '0.8rem' }}>{order.student_id}</span>
                                        </div>
                                        <h4 style={{ fontSize: '1.05rem', margin: '0.5rem 0', color: '#020617' }}>{order.item_name || 'Meal'}</h4>
                                        <span style={{ ...styles.badge, background: '#fffbeb', color: '#92400e', border: '1px solid #fbbf24', fontSize: '0.72rem', marginBottom: '1rem', display: 'inline-block' }}>
                                            {(order.status || '').replace('_', ' ').toUpperCase()}
                                        </span>
                                        <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'column' }}>
                                            <button className="btn-primary" style={styles.fullBtn} onClick={() => handleMarkReady(order.order_id)}>Mark Ready</button>
                                            {cancelConfirmOrderId === order.order_id ? (
                                                <div style={styles.cancelConfirmBox}>
                                                    <span style={styles.cancelConfirmText}>Cancel this order?</span>
                                                    <div style={styles.cancelConfirmBtns}>
                                                        <button style={styles.cancelConfirmYes} onClick={() => handleCancelOrder(order.order_id)}>Yes, Cancel</button>
                                                        <button style={styles.cancelConfirmNo} onClick={() => setCancelConfirmOrderId(null)}>Keep Order</button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <button
                                                    style={{ ...styles.fullBtn, background: '#fef2f2', color: '#991b1b', borderRadius: '6px', padding: '8px', fontWeight: '600', border: '1px solid #fecaca', cursor: 'pointer' }}
                                                    onClick={() => setCancelConfirmOrderId(order.order_id)}
                                                >
                                                    Cancel Order
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                {activeKitchenOrders.length === 0 && (
                                    <p style={{ color: '#5a6474', fontStyle: 'italic' }}>No active orders in kitchen.</p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ── CHAOS TOGGLE ── */}
                    {activeTab === 'chaos' && (
                        <div>
                            <h3 style={{ ...styles.panelTitle, marginBottom: '0.5rem' }}>Chaos Mode Control</h3>
                            <p style={{ color: '#5a6474', marginBottom: '1.5rem', fontSize: '0.88rem' }}>
                                Toggle chaos mode per service to simulate failures for fault-tolerance testing.
                                Each toggle lasts <strong>60 seconds</strong>.
                            </p>
                            <div style={styles.serviceGrid}>
                                {SERVICES.map(svc => {
                                    const isOn = !!chaosState[svc.key];
                                    const isLoading = !!chaosLoading[svc.key];
                                    return (
                                        <div key={svc.key} className="card" style={styles.serviceCard}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                                                <div>
                                                    <h4 style={{ fontSize: '0.95rem', color: '#020617', fontWeight: '600' }}>{svc.label}</h4>
                                                    <p style={{ fontSize: '0.78rem', color: '#4b5563' }}>Port {svc.port}</p>
                                                </div>
                                                <span style={{
                                                    padding: '3px 10px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: '700',
                                                    background: isOn ? '#fef2f2' : '#f0fdf4',
                                                    color: isOn ? '#991b1b' : '#166534',
                                                    border: `1px solid ${isOn ? '#fecaca' : '#bbf7d0'}`,
                                                }}>
                                                    {isOn ? 'CHAOS ON' : 'STABLE'}
                                                </span>
                                            </div>
                                            <button
                                                onClick={() => handleChaosToggle(svc.key)}
                                                disabled={isLoading}
                                                style={{
                                                    width: '100%', padding: '9px', borderRadius: '6px', fontWeight: '600',
                                                    fontSize: '0.85rem',
                                                    background: isOn ? '#f0fdf4' : '#fef2f2',
                                                    color: isOn ? '#166534' : '#991b1b',
                                                    border: `1.5px solid ${isOn ? '#bbf7d0' : '#fecaca'}`,
                                                    opacity: isLoading ? 0.6 : 1,
                                                    cursor: isLoading ? 'not-allowed' : 'pointer',
                                                }}
                                            >
                                                {isLoading ? 'Toggling...' : isOn ? 'Disable Chaos' : 'Enable Chaos'}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* ── HEALTH ── */}
                    {activeTab === 'health' && (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                                <h3 style={styles.panelTitle}>Service Health</h3>
                                <button className="btn-primary" onClick={fetchAllHealth} disabled={healthLoading}>
                                    {healthLoading ? 'Checking...' : 'Refresh'}
                                </button>
                            </div>
                            <div style={styles.serviceGrid}>
                                {SERVICES.map(svc => {
                                    const h = healthData[svc.key];
                                    return (
                                        <div key={svc.key} className="card" style={styles.serviceCard}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                                <h4 style={{ fontSize: '0.95rem', color: '#020617', fontWeight: '600' }}>{svc.label}</h4>
                                                <span style={{
                                                    padding: '3px 10px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: '700',
                                                    background: !h ? '#f3f4f6' : h.ok ? '#f0fdf4' : '#fef2f2',
                                                    color: !h ? '#6b7280' : h.ok ? '#166534' : '#991b1b',
                                                    border: `1px solid ${!h ? '#e5e7eb' : h.ok ? '#bbf7d0' : '#fecaca'}`,
                                                }}>
                                                    {!h ? 'UNKNOWN' : h.ok ? 'HEALTHY' : 'DOWN'}
                                                </span>
                                            </div>
                                            {h?.data && (
                                                <pre style={styles.jsonPre}>{JSON.stringify(h.data, null, 2)}</pre>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* ── METRICS ── */}
                    {activeTab === 'metrics' && (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                                <h3 style={styles.panelTitle}>Live Metrics</h3>
                                <button className="btn-primary" onClick={fetchAllMetrics} disabled={metricsLoading}>
                                    {metricsLoading ? 'Fetching...' : 'Refresh'}
                                </button>
                            </div>
                            <div style={styles.serviceGrid}>
                                {SERVICES.map(svc => {
                                    const m = metricsData[svc.key];
                                    const latency = m?.avg_response_time_seconds;
                                    const throughput = m?.total_orders_processed ?? m?.total_orders ?? m?.total_notifications_sent ?? m?.total_students ?? null;
                                    const failures   = m?.failed_orders ?? m?.failed_count ?? m?.failed_notifications ?? null;
                                    return (
                                        <div key={svc.key} className="card" style={styles.serviceCard}>
                                            <h4 style={{ fontSize: '0.95rem', color: '#020617', marginBottom: '1rem', fontWeight: '700' }}>{svc.label}</h4>
                                            {m ? (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                                                    {latency !== undefined && latency !== null && (
                                                        <div style={styles.metricRow}>
                                                            <span style={styles.metricLabel}>⏱ Avg Latency</span>
                                                            <span style={{ ...styles.metricValue, color: latency > 1 ? '#dc2626' : '#16a34a' }}>
                                                                {latency < 0.001 ? '<1ms' : `${(latency * 1000).toFixed(1)}ms`}
                                                            </span>
                                                        </div>
                                                    )}
                                                    {throughput !== null && (
                                                        <div style={styles.metricRow}>
                                                            <span style={styles.metricLabel}>📊 Throughput</span>
                                                            <span style={styles.metricValue}>{throughput.toLocaleString()}</span>
                                                        </div>
                                                    )}
                                                    {failures !== null && (
                                                        <div style={styles.metricRow}>
                                                            <span style={styles.metricLabel}>❌ Failures</span>
                                                            <span style={{ ...styles.metricValue, color: failures > 0 ? '#dc2626' : '#16a34a' }}>{failures}</span>
                                                        </div>
                                                    )}
                                                    {/* Status breakdown if present */}
                                                    {m.orders_by_status && (
                                                        <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid #f1f5f9' }}>
                                                            <p style={{ fontSize: '0.72rem', color: '#6b7280', fontWeight: 600, marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Orders by Status</p>
                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                                                                {Object.entries(m.orders_by_status).map(([k, v]) => (
                                                                    <span key={k} style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '999px', background: '#f1f5f9', color: '#374151', fontWeight: 600 }}>
                                                                        {k}: {v}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <p style={{ color: '#9ca3af', fontSize: '0.85rem' }}>
                                                    {metricsLoading ? 'Loading...' : '— Unavailable —'}
                                                </p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* ── ADMIN TOOLS ── */}
                    {activeTab === 'admin' && (
                        <div style={{ maxWidth: '520px' }}>
                            <h3 style={{ ...styles.panelTitle, marginBottom: '1.5rem' }}>Admin Tools</h3>

                            {/* Reset any student's password */}
                            <div className="card" style={{ padding: '1.75rem', background: '#ffffff', border: '1px solid #e5e7eb', boxShadow: '0 18px 40px rgba(15,23,42,0.16)', color: '#020617' }}>
                                <h4 style={{ color: '#020617', marginBottom: '0.5rem', fontWeight: '600' }}>Reset Student Password</h4>
                                <p style={{ color: '#4b5563', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                                    Reset any student's password without needing their old password.
                                </p>
                                <form onSubmit={handleAdminResetPassword} style={styles.form}>
                                    <input
                                        style={styles.input}
                                        placeholder="Student ID (e.g. 210041001)"
                                        value={rpStudentId}
                                        onChange={e => setRpStudentId(e.target.value)}
                                        required
                                    />
                                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                        <input
                                            type={showRpNew ? 'text' : 'password'}
                                            style={{ ...styles.input, paddingRight: '42px', flex: 1 }}
                                            placeholder="New password (min 4 chars)"
                                            value={rpNew}
                                            onChange={e => setRpNew(e.target.value)}
                                            required
                                            minLength={4}
                                        />
                                        <button type="button" onClick={() => setShowRpNew(!showRpNew)} style={{ position: 'absolute', right: '10px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem' }}>
                                            {showRpNew ? '🙈' : '👁️'}
                                        </button>
                                    </div>
                                    {rpMsg && (
                                        <p style={{
                                            fontSize: '0.85rem',
                                            color: rpMsg.startsWith('success:') ? '#16a34a' : '#dc2626',
                                            padding: '6px 10px',
                                            borderRadius: '6px',
                                            background: rpMsg.startsWith('success:') ? '#f0fdf4' : '#fef2f2',
                                        }}>
                                            {rpMsg.replace(/^(success:|error:)/, '')}
                                        </p>
                                    )}
                                    <button type="submit" className="btn-primary" style={{ alignSelf: 'flex-start' }}>
                                        Reset Password
                                    </button>
                                </form>
                            </div>
                        </div>
                    )}
                </main>
            </div>

            {/* ── Notification Toast ── */}
            {notification && (
                <div className="card" style={styles.toast}>
                    {notification}
                </div>
            )}
        </div>
    );
};

const styles = {
    page: { minHeight: '100vh', background: 'transparent' },
    header: {
        background: 'linear-gradient(90deg, #14532d, #16a34a)',
        borderBottom: '3px solid #052e16',
        boxShadow: '0 12px 30px rgba(0,0,0,0.35)',
    },
    headerInner: {
        maxWidth: '1300px',
        margin: '0 auto',
        padding: '10px 1.5rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '1rem',
    },
    headerLeft: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
    },
    logoMark: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '40px',
        height: '40px',
        background: 'rgba(255,255,255,0.2)',
        color: 'white',
        borderRadius: '8px',
        fontSize: '0.85rem',
        fontWeight: '800',
        letterSpacing: '0.05em',
    },
    headerTitle: {
        fontSize: '1.25rem',
        color: 'white',
        margin: 0,
        fontWeight: '700',
    },
    headerSub: {
        color: 'rgba(255,255,255,0.7)',
        fontSize: '0.8rem',
        margin: 0,
    },
    logoutBtn: {
        padding: '7px 16px',
        borderRadius: '6px',
        fontWeight: '600',
        background: 'white',
        color: '#1a6137',
        border: 'none',
        cursor: 'pointer',
        fontSize: '0.82rem',
    },
    contentWrap: {
        maxWidth: '1300px',
        margin: '0 auto',
        padding: '1.25rem 1.5rem',
    },
    tabBar: {
        display: 'flex', gap: '6px', marginBottom: '1.75rem', flexWrap: 'wrap',
        borderBottom: '1px solid #e0e4e8', paddingBottom: '1rem',
    },
    tabBtn: {
        padding: '7px 18px', borderRadius: '6px', fontWeight: '600',
        border: '1.5px solid #dce0e5', background: 'transparent', color: '#5a6474',
        transition: 'all 0.2s', fontSize: '0.85rem',
    },
    tabBtnActive: {
        background: '#1a6137', color: 'white', border: '1.5px solid #1a6137',
    },
    main: {},
    panelTitle: { fontSize: '1.15rem', color: '#020617', margin: 0, fontWeight: '700' },
    inventoryGrid: { display: 'grid', gridTemplateColumns: '280px 1fr', gap: '1.75rem' },
    panel: {
        padding: '1.3rem',
        height: 'fit-content',
        background: '#ffffff',
        border: '1px solid #e5e7eb',
        boxShadow: '0 18px 40px rgba(15,23,42,0.16)',
    },
    form: { display: 'flex', flexDirection: 'column', gap: '0.85rem', marginTop: '1rem' },
    input: {
        padding: '9px 12px', borderRadius: '6px', border: '1.5px solid #dce0e5',
        fontSize: '0.9rem', outline: 'none', width: '100%', boxSizing: 'border-box',
        background: '#fafbfc',
    },
    tableWrapper: { marginTop: '1rem', overflowX: 'auto', borderRadius: '8px', border: '1px solid rgba(148,163,184,0.35)' },
    table: { width: '100%', borderCollapse: 'collapse', textAlign: 'left', color: '#e5e7eb' },
    th: { padding: '10px 16px', color: '#9ca3af', fontWeight: '600', fontSize: '0.82rem', borderBottom: '1px solid rgba(148,163,184,0.35)', background: 'rgba(15,23,42,0.85)', textTransform: 'uppercase', letterSpacing: '0.04em' },
    tr: { borderBottom: '1px solid rgba(148,163,184,0.25)' },
    td: { padding: '10px 16px', fontSize: '0.9rem', color: '#e5e7eb' },
    badge: { padding: '3px 10px', borderRadius: '999px', fontSize: '0.75rem', fontWeight: '600' },
    actionGroup: { display: 'flex', gap: '4px' },
    actionBtn: {
        background: 'rgba(15,23,42,0.9)', fontSize: '0.9rem', padding: '4px 10px', borderRadius: '4px',
        border: '1px solid rgba(148,163,184,0.7)', color: '#e5e7eb', cursor: 'pointer', fontWeight: '600',
        transition: 'background 0.15s, border-color 0.15s',
    },
    orderGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1.25rem' },
    orderCard: {
        padding: '1.25rem',
        background: '#ffffff',
        border: '1px solid #e5e7eb',
        boxShadow: '0 18px 40px rgba(15,23,42,0.16)',
        color: '#020617',
    },
    orderCardHeader: { display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' },
    fullBtn: { width: '100%' },
    serviceGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.25rem' },
    serviceCard: {
        padding: '1.25rem',
        background: '#ffffff',
        border: '1px solid #e5e7eb',
        boxShadow: '0 18px 40px rgba(15,23,42,0.16)',
        color: '#020617',
    },
    jsonPre: {
        background: 'rgba(15,23,42,0.96)', border: '1px solid rgba(148,163,184,0.5)', borderRadius: '6px',
        padding: '10px', fontSize: '0.75rem', overflowX: 'auto', color: '#e5e7eb',
        whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0,
        fontFamily: 'monospace',
    },
    metricRow: {
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '0.4rem 0.6rem', borderRadius: '6px', background: '#f8fafc',
    },
    metricLabel: { fontSize: '0.82rem', color: '#4b5563', fontWeight: 500 },
    metricValue: { fontSize: '0.9rem', fontWeight: 700, color: '#020617' },
    toast: {
        position: 'fixed', bottom: '1.5rem', right: '1.5rem',
        padding: '12px 20px', borderLeft: '4px solid #1a6137',
        zIndex: 100, fontWeight: '600', maxWidth: '350px', fontSize: '0.9rem',
    },
    inlineEdit: { display: 'flex', gap: '4px', alignItems: 'center' },
    inlineInput: {
        width: '60px', padding: '4px 6px', borderRadius: '4px',
        border: '1.5px solid #dce0e5', fontSize: '0.85rem', outline: 'none',
    },

    // Inline cancel confirmation (kitchen)
    cancelConfirmBox: {
        padding: '0.65rem 0.8rem',
        borderRadius: '8px',
        background: '#fef2f2',
        border: '1px solid #fecaca',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
    },
    cancelConfirmText: {
        fontSize: '0.82rem', fontWeight: 700, color: '#991b1b',
    },
    cancelConfirmBtns: {
        display: 'flex', gap: '0.5rem',
    },
    cancelConfirmYes: {
        flex: 1, padding: '6px 0', borderRadius: '6px', fontWeight: 700,
        fontSize: '0.78rem', cursor: 'pointer',
        background: '#dc2626', color: 'white', border: 'none',
        boxShadow: '0 2px 8px rgba(220,38,38,0.3)',
    },
    cancelConfirmNo: {
        flex: 1, padding: '6px 0', borderRadius: '6px', fontWeight: 700,
        fontSize: '0.78rem', cursor: 'pointer',
        background: 'white', color: '#374151',
        border: '1px solid #d1d5db',
    },
};

export default AdminPage;
