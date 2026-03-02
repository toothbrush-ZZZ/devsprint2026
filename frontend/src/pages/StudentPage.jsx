import { useState, useEffect, useRef } from 'react';
import Carousel from '../components/Carousel';
import { api } from '../utils/api';

const LS_KEY = (studentId) => `active_order_${studentId}`;

const StudentPage = ({ user, onLogout }) => {
    const [items, setItems] = useState([]);
    const [activeOrders, setActiveOrders] = useState([]);
    const [notification, setNotification] = useState(null);
    const [orderError, setOrderError] = useState('');
    const [showChangePassword, setShowChangePassword] = useState(false);
    const [cpOld, setCpOld] = useState('');
    const [cpNew, setCpNew] = useState('');
    const [cpMsg, setCpMsg] = useState('');
    const [showCpOld, setShowCpOld] = useState(false);
    const [showCpNew, setShowCpNew] = useState(false);

    // Ref to track which order IDs are already in the list — avoids calling
    // fetchSingleOrder inside a state updater (React StrictMode runs those twice)
    const knownOrderIds = useRef(new Set());

    useEffect(() => {
        fetchItems();
        loadPersistedOrder();
        const cleanup = setupWebSocket();
        return cleanup;
    }, []);

    /** Persist & reload the last active order across page refreshes */
    const persistOrder = (order) => {
        try { localStorage.setItem(LS_KEY(user.student_id), JSON.stringify(order)); } catch {}
    };
    const clearPersistedOrder = () => {
        try { localStorage.removeItem(LS_KEY(user.student_id)); } catch {}
    };
    const loadPersistedOrder = async () => {
        try {
            const raw = localStorage.getItem(LS_KEY(user.student_id));
            if (!raw) return;
            const saved = JSON.parse(raw);
            if (!saved?.order_id) return;
            // Re-fetch from backend to get latest status
            await fetchSingleOrder(saved.order_id);
        } catch {}
    };

    const fetchItems = async () => {
        try {
            const data = await api.get('stock', '/items/', user.access_token);
            if (Array.isArray(data)) setItems(data);
        } catch (err) { console.error('fetchItems', err); }
    };

    /**
     * Fetches a single order from the backend and upserts it in the list.
     * Safe to call multiple times for the same order_id — deduplicates cleanly.
     */
    const fetchSingleOrder = async (orderId) => {
        try {
            const data = await api.get('order', `/order/${orderId}/`, user.access_token);
            if (!data.order_id) return;

            const terminal = ['ready', 'cancelled', 'failed'];
            if (terminal.includes(data.status)) {
                // Remove from list if terminal; clear persistence
                setActiveOrders(prev => prev.filter(o => o.order_id !== data.order_id));
                knownOrderIds.current.delete(data.order_id);
                clearPersistedOrder();
            } else {
                knownOrderIds.current.add(data.order_id);
                persistOrder(data); // keep localStorage fresh on every successful fetch
                setActiveOrders(prev => {
                    const idx = prev.findIndex(o => o.order_id === data.order_id);
                    if (idx > -1) {
                        const updated = [...prev];
                        updated[idx] = data;
                        return updated;
                    }
                    return [data, ...prev];
                });
            }
        } catch (err) { console.error('fetchSingleOrder', err); }
    };

    const setupWebSocket = () => {
        const ws = new WebSocket(`ws://localhost:8005/ws/student/${user.student_id}/`);

        ws.onopen = () => console.log('WS connected for', user.student_id);

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                // Skip the connection handshake — it carries no order data
                if (data.type === 'connected') return;

                if (data.type === 'order_update' && data.order_id) {
                    const label = (data.status || '').replace(/_/g, ' ');
                    showToast(`Your order is now ${label}!`);
                    // Always re-fetch from API — avoids race condition and ensures
                    // item_name is populated (WS message only contains order_id + status)
                    fetchSingleOrder(data.order_id);
                }
            } catch (e) { console.error('WS parse error', e); }
        };

        ws.onerror = () => console.warn('WS error');
        ws.onclose = () => console.log('WS closed');
        return () => ws.close();
    };

    const showToast = (msg) => {
        setNotification(msg);
        setTimeout(() => setNotification(null), 5000);
    };

    const handleOrder = async (itemId) => {
        setOrderError('');
        try {
            const res = await api.post('order', '/order/', { item_id: itemId }, user.access_token);
            showToast('🎉 Order placed! Your food is being prepared.');
            const order = {
                order_id: res.order_id,
                item_name: res.item_name || items.find(i => i.id === itemId)?.name || 'Meal',
                status: res.status || 'in_kitchen',
                student_id: res.student_id,
            };
            knownOrderIds.current.add(res.order_id);
            setActiveOrders(prev => {
                // Deduplicate — replace if already exists, otherwise prepend
                const idx = prev.findIndex(o => o.order_id === res.order_id);
                if (idx > -1) {
                    const updated = [...prev];
                    updated[idx] = order;
                    return updated;
                }
                return [order, ...prev];
            });
            persistOrder(order);
            fetchItems();
        } catch (err) {
            if (err.status === 409) {
                const existingId = err.data?.existing_order_id;
                if (existingId) {
                    setOrderError(
                        `You already have an active order${
                            err.data?.item_name ? ` – ${err.data.item_name}` : ''
                        }. Wait for it to complete first.`
                    );
                    if (!knownOrderIds.current.has(existingId)) {
                        fetchSingleOrder(existingId);
                    }
                } else {
                    setOrderError(err.message || 'Item sold out.');
                }
            } else {
                setOrderError(err.message || 'Failed to place order. Try again.');
            }
            setTimeout(() => setOrderError(''), 8000);
        }
    };

    const handleChangePassword = async (e) => {
        e.preventDefault();
        setCpMsg('');
        try {
            const res = await api.post('identity', '/change-password/', {
                old_password: cpOld,
                new_password: cpNew,
            }, user.access_token);
            setCpMsg('✅ ' + (res.message || 'Password changed!'));
            setCpOld(''); setCpNew('');
        } catch (err) {
            setCpMsg('❌ ' + (err.message || 'Failed to change password.'));
        }
    };

    const statusColor = (s) => ({
        ready: '#22c55e',
        in_kitchen: '#f59e0b',
        pending: '#6366f1',
        stock_verified: '#3b82f6',
        cancelled: '#94a3b8',
        failed: '#ef4444',
    }[s] || '#e63946');

    // Filter out any garbage entries that slipped in (no order_id)
    const validOrders = activeOrders.filter(o => o.order_id);

    return (
        <div style={styles.page}>
            <header style={styles.header}>
                <div>
                    <h1 className="vibrant-text" style={styles.logo}>DevSprint '26</h1>
                    <p style={styles.welcome}>Healthy meals for {user.student_id}</p>
                </div>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <button
                        style={styles.ghostBtn}
                        onClick={() => { setShowChangePassword(!showChangePassword); setCpMsg(''); }}
                    >
                        🔑 Password
                    </button>
                    <button className="btn-primary" onClick={onLogout}>Logout</button>
                </div>
            </header>

            {showChangePassword && (
                <div className="glass-card" style={styles.cpPanel}>
                    <h3 style={{ marginBottom: '1rem', color: '#1d3557', fontSize: '1rem' }}>Change Password</h3>
                    <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <div style={styles.pwRow}>
                            <input type={showCpOld ? 'text' : 'password'} placeholder="Current password"
                                value={cpOld} onChange={e => setCpOld(e.target.value)} style={styles.cpInput} required />
                            <button type="button" onClick={() => setShowCpOld(!showCpOld)} style={styles.eyeInline}>{showCpOld ? '🙈' : '👁️'}</button>
                        </div>
                        <div style={styles.pwRow}>
                            <input type={showCpNew ? 'text' : 'password'} placeholder="New password (min 4 chars)"
                                value={cpNew} onChange={e => setCpNew(e.target.value)} style={styles.cpInput} required minLength={4} />
                            <button type="button" onClick={() => setShowCpNew(!showCpNew)} style={styles.eyeInline}>{showCpNew ? '🙈' : '👁️'}</button>
                        </div>
                        {cpMsg && <p style={{ fontSize: '0.85rem', color: cpMsg.startsWith('✅') ? '#16a34a' : '#ef4444' }}>{cpMsg}</p>}
                        <button type="submit" className="btn-primary" style={{ alignSelf: 'flex-start', fontSize: '0.9rem', padding: '8px 18px' }}>
                            Update Password
                        </button>
                    </form>
                </div>
            )}

            <main style={styles.main}>
                <section style={styles.menuSection}>
                    <h2 style={styles.sectionTitle}>Today's Special</h2>
                    {orderError && <div style={styles.orderErrorBanner}>⚠️ {orderError}</div>}
                    <Carousel items={items} onOrder={handleOrder} />
                </section>

                <section style={styles.orderSection}>
                    <h2 style={styles.sectionTitle}>Active Orders</h2>
                    <div style={styles.orderList}>
                        {validOrders.length === 0 ? (
                            <p style={styles.empty}>No active orders. Place one from the menu!</p>
                        ) : (
                            validOrders.map(order => (
                                <div key={order.order_id} className="glass-card" style={styles.orderCard}>
                                    <div style={styles.orderInfo}>
                                        <span style={styles.itemName}>{order.item_name || 'Meal'}</span>
                                    </div>
                                    <div style={{ ...styles.statusBadge, background: statusColor(order.status) }}>
                                        {(order.status || 'PENDING').replace(/_/g, ' ').toUpperCase()}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </section>
            </main>

            {notification && (
                <div className="glass-card floating" style={styles.notification}>{notification}</div>
            )}
        </div>
    );
};

const styles = {
    page: { maxWidth: '1200px', margin: '0 auto', padding: '2rem' },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' },
    logo: { fontSize: '2rem', margin: 0 },
    welcome: { color: '#64748b', fontSize: '0.9rem' },
    ghostBtn: { padding: '10px 18px', borderRadius: '12px', fontWeight: '600', background: 'transparent', color: '#1d3557', border: '1.5px solid #e2e8f0', cursor: 'pointer', fontSize: '0.9rem' },
    cpPanel: { padding: '1.5rem 2rem', marginBottom: '1.5rem', maxWidth: '480px' },
    pwRow: { position: 'relative', display: 'flex', alignItems: 'center' },
    cpInput: { width: '100%', padding: '10px 44px 10px 14px', borderRadius: '10px', border: '1.5px solid #e2e8f0', fontSize: '0.95rem', outline: 'none', boxSizing: 'border-box' },
    eyeInline: { position: 'absolute', right: '10px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem' },
    main: { display: 'grid', gridTemplateColumns: '1fr 350px', gap: '4rem', marginTop: '1rem' },
    menuSection: { minWidth: 0 },
    orderSection: {},
    sectionTitle: { marginBottom: '1.5rem', fontSize: '1.5rem' },
    orderErrorBanner: { background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '10px 14px', borderRadius: '10px', marginBottom: '1rem', fontSize: '0.88rem' },
    orderList: { display: 'flex', flexDirection: 'column', gap: '1rem' },
    orderCard: { padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    orderInfo: { display: 'flex', flexDirection: 'column' },
    orderId: { fontSize: '0.78rem', color: '#64748b' },
    itemName: { fontWeight: '700', fontSize: '1rem', marginTop: '2px' },
    statusBadge: { padding: '4px 12px', borderRadius: '20px', color: 'white', fontSize: '0.72rem', fontWeight: '700', whiteSpace: 'nowrap' },
    notification: { position: 'fixed', bottom: '2rem', right: '2rem', padding: '1rem 2rem', borderLeft: '4px solid #e63946', zIndex: 100, fontWeight: '600' },
    empty: { color: '#64748b', fontStyle: 'italic' },
};

export default StudentPage;
