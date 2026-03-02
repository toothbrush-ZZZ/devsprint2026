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
            showToast('Order placed! Your food is being prepared.');
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
            setCpMsg('success:' + (res.message || 'Password changed!'));
            setCpOld(''); setCpNew('');
        } catch (err) {
            setCpMsg('error:' + (err.message || 'Failed to change password.'));
        }
    };

    const statusColor = (s) => ({
        ready: '#16a34a',
        in_kitchen: '#d97706',
        pending: '#2563eb',
        stock_verified: '#0891b2',
        cancelled: '#6b7280',
        failed: '#dc2626',
    }[s] || '#1a6137');

    const statusBg = (s) => ({
        ready: '#f0fdf4',
        in_kitchen: '#fffbeb',
        pending: '#eff6ff',
        stock_verified: '#ecfeff',
        cancelled: '#f3f4f6',
        failed: '#fef2f2',
    }[s] || '#f0fdf4');

    // Filter out any garbage entries that slipped in (no order_id)
    const validOrders = activeOrders.filter(o => o.order_id);

    return (
        <div style={styles.page}>
            {/* Green top bar */}
            <header style={styles.header}>
                <div style={styles.headerInner}>
                    <div style={styles.headerLeft}>
                        <div style={styles.logoMark}>IUT</div>
                        <div>
                            <h1 style={styles.headerTitle}>IUT Cafeteria</h1>
                            <p style={styles.headerSub}>{user.student_id}</p>
                        </div>
                    </div>
                    <div style={styles.headerActions}>
                        <button
                            style={styles.headerBtn}
                            onClick={() => { setShowChangePassword(!showChangePassword); setCpMsg(''); }}
                        >
                            Change Password
                        </button>
                        <button style={styles.logoutBtn} onClick={onLogout}>Sign Out</button>
                    </div>
                </div>
            </header>

            <div style={styles.content}>
                {showChangePassword && (
                    <div className="card" style={styles.cpPanel}>
                        <h3 style={styles.cpTitle}>Change Password</h3>
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
                            {cpMsg && (
                                <p style={{
                                    fontSize: '0.85rem',
                                    color: cpMsg.startsWith('success:') ? '#16a34a' : '#dc2626',
                                    padding: '6px 10px',
                                    borderRadius: '6px',
                                    background: cpMsg.startsWith('success:') ? '#f0fdf4' : '#fef2f2',
                                }}>
                                    {cpMsg.replace(/^(success:|error:)/, '')}
                                </p>
                            )}
                            <button type="submit" className="btn-primary" style={{ alignSelf: 'flex-start', fontSize: '0.85rem', padding: '8px 18px' }}>
                                Update Password
                            </button>
                        </form>
                    </div>
                )}

                <main style={styles.main}>
                    <section style={styles.menuSection}>
                        <h2 style={styles.sectionTitle}>Today's Menu</h2>
                        {orderError && <div style={styles.orderErrorBanner}>{orderError}</div>}
                        <Carousel items={items} onOrder={handleOrder} />
                    </section>

                    <section style={styles.orderSection}>
                        <h2 style={styles.sectionTitle}>Active Orders</h2>
                        <div style={styles.orderList}>
                            {validOrders.length === 0 ? (
                                <div className="card" style={styles.emptyCard}>
                                    <p style={styles.empty}>No active orders. Place one from the menu!</p>
                                </div>
                            ) : (
                                validOrders.map(order => (
                                    <div key={order.order_id} className="card" style={styles.orderCard}>
                                        <div style={styles.orderInfo}>
                                            <span style={styles.itemName}>{order.item_name || 'Meal'}</span>
                                        </div>
                                        <div style={{
                                            ...styles.statusBadge,
                                            background: statusBg(order.status),
                                            color: statusColor(order.status),
                                            border: `1px solid ${statusColor(order.status)}22`,
                                        }}>
                                            {(order.status || 'PENDING').replace(/_/g, ' ').toUpperCase()}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </section>
                </main>
            </div>

            {notification && (
                <div className="card" style={styles.notification}>{notification}</div>
            )}
        </div>
    );
};

const styles = {
    page: { minHeight: '100vh', background: '#f5f6f8' },
    header: {
        background: '#1a6137',
        borderBottom: '3px solid #0e4528',
    },
    headerInner: {
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '14px 2rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
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
    headerActions: {
        display: 'flex',
        gap: '0.75rem',
        alignItems: 'center',
    },
    headerBtn: {
        padding: '7px 16px',
        borderRadius: '6px',
        fontWeight: '600',
        background: 'rgba(255,255,255,0.15)',
        color: 'white',
        border: '1px solid rgba(255,255,255,0.25)',
        cursor: 'pointer',
        fontSize: '0.82rem',
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
    content: {
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '1.5rem 2rem',
    },
    cpPanel: { padding: '1.25rem 1.5rem', marginBottom: '1.5rem', maxWidth: '480px' },
    cpTitle: { marginBottom: '0.75rem', color: '#1a1a2e', fontSize: '0.95rem', fontWeight: '600' },
    pwRow: { position: 'relative', display: 'flex', alignItems: 'center' },
    cpInput: { width: '100%', padding: '9px 40px 9px 12px', borderRadius: '6px', border: '1.5px solid #dce0e5', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box', background: '#fafbfc' },
    eyeInline: { position: 'absolute', right: '10px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem' },
    main: { display: 'grid', gridTemplateColumns: '1fr 350px', gap: '3rem', marginTop: '0.5rem' },
    menuSection: { minWidth: 0 },
    orderSection: {},
    sectionTitle: { marginBottom: '1.25rem', fontSize: '1.25rem', fontWeight: '700', color: '#1a1a2e' },
    orderErrorBanner: { background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '10px 14px', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.85rem' },
    orderList: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
    orderCard: { padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    emptyCard: { padding: '2rem', textAlign: 'center' },
    orderInfo: { display: 'flex', flexDirection: 'column' },
    itemName: { fontWeight: '600', fontSize: '0.95rem' },
    statusBadge: { padding: '4px 12px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: '700', whiteSpace: 'nowrap', letterSpacing: '0.03em' },
    notification: {
        position: 'fixed', bottom: '1.5rem', right: '1.5rem',
        padding: '12px 20px', borderLeft: '4px solid #1a6137',
        zIndex: 100, fontWeight: '600', fontSize: '0.9rem',
        maxWidth: '360px',
    },
    empty: { color: '#5a6474', fontStyle: 'italic', fontSize: '0.9rem' },
};

export default StudentPage;
