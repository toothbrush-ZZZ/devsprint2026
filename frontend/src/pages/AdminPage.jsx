import { useState, useEffect } from 'react';
import { api } from '../utils/api';

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

    // Kitchen / Orders state
    const [orders, setOrders] = useState([]);

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
                    showNotification(`🔔 New order #${data.order_id} received!`);
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
            showNotification(`✅ Item "${newItem.name}" created!`);
            setNewItem({ name: '', price: '', quantity: '' });
            fetchInventory();
        } catch (err) {
            showNotification(`❌ ${err.message || 'Failed to create item.'}`);
        }
    };

    const handleDeleteItem = async (id, name) => {
        if (!window.confirm(`Delete "${name}"?`)) return;
        try {
            await api.delete('stock', `/items/${id}/delete/`, user.access_token);
            showNotification(`🗑️ Item deleted.`);
            fetchInventory();
        } catch (err) {
            showNotification(`❌ ${err.message || 'Failed to delete item.'}`);
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
                showNotification('❌ Please enter a positive number.');
                return;
            }
            body = { quantity: qty };
        }
        try {
            await api.post('stock', `/stock/${id}/${action}/`, body, user.access_token);
            showNotification(`✅ Stock ${action} successful.`);
            setEditingStockId(null);
            fetchInventory();
        } catch (err) {
            showNotification(`❌ Failed to ${action} stock: ${err.message}`);
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
            showNotification(`✅ Order #${orderId} marked as ready!`);
            fetchOrders();
        } catch (err) {
            showNotification(`❌ ${err.message || 'Failed to update order.'}`);
        }
    };

    const handleCancelOrder = async (orderId) => {
        if (!window.confirm(`Cancel order #${orderId}?`)) return;
        try {
            await api.delete('order', `/order/${orderId}/cancel/`, user.access_token);
            showNotification(`🚫 Order #${orderId} cancelled.`);
            fetchOrders();
        } catch (err) {
            showNotification(`❌ ${err.message || 'Failed to cancel order.'}`);
        }
    };

    // ── Chaos Toggle ──────────────────────────────────────────────────────────

    const handleChaosToggle = async (serviceKey) => {
        setChaosLoading(prev => ({ ...prev, [serviceKey]: true }));
        try {
            const data = await api.post(serviceKey, '/chaos/', {}, user.access_token);
            const isEnabled = data.status?.toLowerCase().includes('enabled');
            setChaosState(prev => ({ ...prev, [serviceKey]: isEnabled }));
            showNotification(`⚡ ${data.status}`);
        } catch (err) {
            showNotification(`❌ Chaos toggle failed for ${serviceKey}: ${err.message}`);
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
            setRpMsg('✅ ' + (res.message || 'Password reset successfully!'));
            setRpStudentId('');
            setRpNew('');
        } catch (err) {
            setRpMsg('❌ ' + (err.message || 'Failed to reset password.'));
        }
    };

    // ── Helpers ───────────────────────────────────────────────────────────────

    const TABS = [
        { id: 'inventory', label: '📦 Inventory' },
        { id: 'kitchen',   label: '🍳 Kitchen' },
        { id: 'chaos',     label: '⚡ Chaos' },
        { id: 'health',    label: '❤️ Health' },
        { id: 'metrics',   label: '📊 Metrics' },
        { id: 'admin',     label: '🔑 Admin Tools' },
    ];

    const activeKitchenOrders = orders.filter(o => o.status !== 'ready' && o.status !== 'cancelled' && o.status !== 'failed');

    return (
        <div style={styles.page}>
            {/* ── Header ── */}
            <header style={styles.header}>
                <div>
                    <h1 className="vibrant-text" style={styles.logo}>Admin Hub</h1>
                    <p style={styles.welcome}>Managing DevSprint Cafeteria · {user.student_id}</p>
                </div>
                <button className="btn-primary" onClick={onLogout}>Logout</button>
            </header>

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
                        <section className="glass-card" style={styles.panel}>
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
                                                    <span style={{ ...styles.badge, background: item.available ? '#dcfce7' : '#fee2e2', color: item.available ? '#166534' : '#991b1b' }}>
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
                                                            <button onClick={() => handleStockAction(item.id, 'add', stockEditValue)} style={styles.confirmBtn} title="Confirm">✅</button>
                                                            <button onClick={() => setEditingStockId(null)} style={styles.cancelBtn} title="Cancel">❌</button>
                                                        </div>
                                                    ) : (
                                                        <div style={styles.actionGroup}>
                                                            <button onClick={() => handleStockAction(item.id, 'add')} style={styles.iconBtn} title="Add stock">➕</button>
                                                            <button onClick={() => handleStockAction(item.id, item.available ? 'pause' : 'unpause')} style={styles.iconBtn} title={item.available ? 'Pause' : 'Unpause'}>
                                                                {item.available ? '⏸️' : '▶️'}
                                                            </button>
                                                            <button onClick={() => handleDeleteItem(item.id, item.name)} style={styles.iconBtn} title="Delete">🗑️</button>
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
                            <button className="btn-primary" style={{ background: '#6366f1' }} onClick={fetchOrders}>🔄 Refresh</button>
                        </div>
                        <div style={styles.orderGrid}>
                            {activeKitchenOrders.map(order => (
                                <div key={order.order_id} className="glass-card floating" style={styles.orderCard}>
                                    <div style={styles.orderCardHeader}>
                                        <span style={{ fontWeight: '800', color: '#e63946' }}>#{order.order_id}</span>
                                        <span style={{ color: '#64748b', fontSize: '0.8rem' }}>{order.student_id}</span>
                                    </div>
                                    <h4 style={{ fontSize: '1.1rem', margin: '0.5rem 0' }}>{order.item_name || 'Meal'}</h4>
                                    <span style={{ ...styles.badge, background: '#fef9c3', color: '#854d0e', fontSize: '0.75rem', marginBottom: '1rem', display: 'inline-block' }}>
                                        {(order.status || '').replace('_', ' ').toUpperCase()}
                                    </span>
                                    <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'column' }}>
                                        <button className="btn-primary" style={styles.fullBtn} onClick={() => handleMarkReady(order.order_id)}>✅ Mark Ready</button>
                                        <button style={{ ...styles.fullBtn, background: '#fee2e2', color: '#991b1b', borderRadius: '10px', padding: '8px', fontWeight: '600' }} onClick={() => handleCancelOrder(order.order_id)}>🚫 Cancel Order</button>
                                    </div>
                                </div>
                            ))}
                            {activeKitchenOrders.length === 0 && (
                                <p style={{ color: '#64748b', fontStyle: 'italic' }}>No active orders in kitchen. 🎉</p>
                            )}
                        </div>
                    </div>
                )}

                {/* ── CHAOS TOGGLE ── */}
                {activeTab === 'chaos' && (
                    <div>
                        <h3 style={{ ...styles.panelTitle, marginBottom: '1.5rem' }}>⚡ Chaos Mode Control</h3>
                        <p style={{ color: '#64748b', marginBottom: '2rem', fontSize: '0.95rem' }}>
                            Toggle chaos mode per service to simulate failures for fault-tolerance testing.
                            Each toggle lasts <strong>60 seconds</strong>.
                        </p>
                        <div style={styles.chaosGrid}>
                            {SERVICES.map(svc => {
                                const isOn = !!chaosState[svc.key];
                                const isLoading = !!chaosLoading[svc.key];
                                return (
                                    <div key={svc.key} className="glass-card" style={styles.chaosCard}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                                            <div>
                                                <h4 style={{ fontSize: '1rem', color: '#1d3557' }}>{svc.label}</h4>
                                                <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Port {svc.port}</p>
                                            </div>
                                            <span style={{
                                                padding: '3px 10px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: '700',
                                                background: isOn ? '#fee2e2' : '#dcfce7',
                                                color: isOn ? '#991b1b' : '#166534'
                                            }}>
                                                {isOn ? 'CHAOS ON' : 'STABLE'}
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => handleChaosToggle(svc.key)}
                                            disabled={isLoading}
                                            style={{
                                                width: '100%', padding: '10px', borderRadius: '10px', fontWeight: '700',
                                                background: isOn ? '#dcfce7' : '#fee2e2',
                                                color: isOn ? '#166534' : '#991b1b',
                                                border: `2px solid ${isOn ? '#86efac' : '#fca5a5'}`,
                                                opacity: isLoading ? 0.6 : 1,
                                                cursor: isLoading ? 'not-allowed' : 'pointer',
                                            }}
                                        >
                                            {isLoading ? '⏳ Toggling...' : isOn ? '✅ Disable Chaos' : '☠️ Enable Chaos'}
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
                            <h3 style={styles.panelTitle}>❤️ Service Health</h3>
                            <button className="btn-primary" style={{ background: '#6366f1' }} onClick={fetchAllHealth} disabled={healthLoading}>
                                {healthLoading ? '⏳ Checking...' : '🔄 Refresh'}
                            </button>
                        </div>
                        <div style={styles.chaosGrid}>
                            {SERVICES.map(svc => {
                                const h = healthData[svc.key];
                                return (
                                    <div key={svc.key} className="glass-card" style={styles.chaosCard}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                            <h4 style={{ fontSize: '1rem', color: '#1d3557' }}>{svc.label}</h4>
                                            <span style={{
                                                padding: '3px 10px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: '700',
                                                background: !h ? '#f1f5f9' : h.ok ? '#dcfce7' : '#fee2e2',
                                                color: !h ? '#94a3b8' : h.ok ? '#166534' : '#991b1b',
                                            }}>
                                                {!h ? 'UNKNOWN' : h.ok ? '✅ OK' : '❌ DOWN'}
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
                            <h3 style={styles.panelTitle}>📊 Service Metrics</h3>
                            <button className="btn-primary" style={{ background: '#6366f1' }} onClick={fetchAllMetrics} disabled={metricsLoading}>
                                {metricsLoading ? '⏳ Fetching...' : '🔄 Refresh'}
                            </button>
                        </div>
                        <div style={styles.chaosGrid}>
                            {SERVICES.map(svc => {
                                const m = metricsData[svc.key];
                                return (
                                    <div key={svc.key} className="glass-card" style={styles.chaosCard}>
                                        <h4 style={{ fontSize: '1rem', color: '#1d3557', marginBottom: '0.75rem' }}>{svc.label}</h4>
                                        {m ? (
                                            <pre style={styles.jsonPre}>{JSON.stringify(m, null, 2)}</pre>
                                        ) : (
                                            <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
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
                        <h3 style={{ ...styles.panelTitle, marginBottom: '1.5rem' }}>🔑 Admin Tools</h3>

                        {/* Reset any student's password */}
                        <div className="glass-card" style={{ padding: '2rem', marginBottom: '1.5rem' }}>
                            <h4 style={{ color: '#1d3557', marginBottom: '0.5rem' }}>Reset Student Password</h4>
                            <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
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
                                    <p style={{ fontSize: '0.875rem', color: rpMsg.startsWith('✅') ? '#16a34a' : '#ef4444' }}>
                                        {rpMsg}
                                    </p>
                                )}
                                <button type="submit" className="btn-primary" style={{ alignSelf: 'flex-start' }}>
                                    🔑 Reset Password
                                </button>
                            </form>
                        </div>
                    </div>
                )}
            </main>

            {/* ── Notification Toast ── */}
            {notification && (
                <div className="glass-card floating" style={styles.toast}>
                    {notification}
                </div>
            )}
        </div>
    );
};

const styles = {
    page: { maxWidth: '1300px', margin: '0 auto', padding: '2rem' },
    header: {
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '1.5rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '1.5rem',
    },
    logo: { fontSize: '2rem', margin: 0 },
    welcome: { color: '#64748b', fontSize: '0.9rem' },
    tabBar: {
        display: 'flex', gap: '0.5rem', marginBottom: '2rem', flexWrap: 'wrap',
        borderBottom: '2px solid #f1f5f9', paddingBottom: '1rem',
    },
    tabBtn: {
        padding: '8px 18px', borderRadius: '20px', fontWeight: '600',
        border: '1.5px solid #e2e8f0', background: 'transparent', color: '#64748b',
        transition: 'all 0.2s', fontSize: '0.9rem',
    },
    tabBtnActive: {
        background: '#e63946', color: 'white', border: '1.5px solid #e63946',
        boxShadow: '0 4px 14px rgba(230, 57, 70, 0.3)',
    },
    main: {},
    panelTitle: { fontSize: '1.3rem', color: '#1d3557', margin: 0 },
    inventoryGrid: { display: 'grid', gridTemplateColumns: '320px 1fr', gap: '2rem' },
    panel: { padding: '1.75rem', height: 'fit-content' },
    form: { display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.25rem' },
    input: {
        padding: '11px 14px', borderRadius: '10px', border: '1.5px solid #e2e8f0',
        fontSize: '0.95rem', outline: 'none', width: '100%', boxSizing: 'border-box',
    },
    tableWrapper: { marginTop: '1rem', overflowX: 'auto', borderRadius: '12px', border: '1px solid #f1f5f9' },
    table: { width: '100%', borderCollapse: 'collapse', textAlign: 'left' },
    th: { padding: '12px 16px', color: '#64748b', fontWeight: '600', fontSize: '0.85rem', borderBottom: '2px solid #f1f5f9', background: '#fafafa' },
    tr: { borderBottom: '1px solid #f1f5f9' },
    td: { padding: '12px 16px', fontSize: '0.92rem' },
    badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '0.78rem', fontWeight: '600' },
    actionGroup: { display: 'flex', gap: '0.35rem' },
    iconBtn: { background: 'none', fontSize: '1.1rem', padding: '4px 6px', borderRadius: '6px', transition: 'background 0.2s' },
    orderGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1.5rem' },
    orderCard: { padding: '1.5rem' },
    orderCardHeader: { display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' },
    fullBtn: { width: '100%' },
    chaosGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' },
    chaosCard: { padding: '1.5rem' },
    jsonPre: {
        background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px',
        padding: '10px', fontSize: '0.78rem', overflowX: 'auto', color: '#334155',
        whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0,
    },
    toast: {
        position: 'fixed', bottom: '2rem', right: '2rem',
        padding: '1rem 1.5rem', borderLeft: '4px solid #e63946',
        zIndex: 100, fontWeight: '600', maxWidth: '350px',
    },
    inlineEdit: { display: 'flex', gap: '0.25rem', alignItems: 'center' },
    inlineInput: {
        width: '60px', padding: '4px 6px', borderRadius: '6px',
        border: '1.5px solid #e2e8f0', fontSize: '0.85rem', outline: 'none',
    },
    confirmBtn: { background: 'none', cursor: 'pointer', fontSize: '1rem', padding: '2px' },
    cancelBtn: { background: 'none', cursor: 'pointer', fontSize: '1rem', padding: '2px' },
};

export default AdminPage;
