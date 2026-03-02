import { useState, useEffect, useRef } from 'react';
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
    const [showBilling, setShowBilling] = useState(false);

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
                            style={{ ...styles.headerBtn, background: 'rgba(255,255,255,0.2)', borderColor: 'rgba(252, 211, 77, 0.7)' }}
                            onClick={() => setShowBilling(true)}
                        >
                            View Billing
                        </button>
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

                        <div style={styles.menuGrid}>
                            {items.map((item) => {
                                const soldOut = !item.available || item.quantity <= 0;
                                return (
                                    <div key={item.id} className="card" style={styles.menuCard}>
                                        <div style={styles.menuHeader}>
                                            <div style={styles.menuIconCircle}>🍽️</div>
                                            <h3 style={styles.menuName}>{item.name}</h3>
                                            <p style={styles.menuPrice}>৳{item.price}</p>
                                        </div>
                                        <div style={styles.menuMeta}>
                                            <span style={styles.menuStock}>
                                                <span
                                                    style={{
                                                        ...styles.menuStockDot,
                                                        background: soldOut ? '#ef4444' : '#16a34a',
                                                    }}
                                                    className="availability-dot"
                                                />
                                                {item.quantity} available
                                            </span>
                                        </div>
                                        <button
                                            className="btn-primary"
                                            style={{
                                                ...styles.menuOrderBtn,
                                                ...(soldOut ? styles.menuOrderBtnSold : {}),
                                            }}
                                            onClick={() => handleOrder(item.id)}
                                            disabled={soldOut}
                                        >
                                            {soldOut ? 'Sold Out' : 'Order Now'}
                                        </button>
                                    </div>
                                );
                            })}
                            {items.length === 0 && (
                                <div className="card" style={styles.emptyMenuCard}>
                                    <p style={styles.empty}>Menu will appear here once items are available.</p>
                                </div>
                            )}
                        </div>
                    </section>

                    <section style={styles.orderSection}>
                        <h2 style={styles.sectionTitle}>Active Orders</h2>
                        <div style={styles.orderList}>
                            {validOrders.length === 0 ? (
                                <div className="card" style={styles.emptyCard}>
                                    <p style={styles.emptyTitle}>No active orders</p>
                                    <p style={styles.emptySub}>Pick a meal from the menu to see your order timeline here.</p>
                                    <div style={styles.timelineSkeleton}>
                                        <div style={styles.timelineBar} />
                                    </div>
                                </div>
                            ) : (
                                (() => {
                                    const order = validOrders[0]; // show most recent/first order
                                    const status = (order.status || 'pending').toLowerCase();
                                    const step =
                                        status === 'ready' ? 2 :
                                        (status === 'in_kitchen' || status === 'stock_verified') ? 1 : 0;
                                    const activeWidth = ['0%', '50%', '100%'][step];
                                    const steps = ['Placed', 'In kitchen', 'Ready'];
                                    return (
                                        <div className="card" style={styles.orderCard}>
                                            <div style={styles.orderInfo}>
                                                <span style={styles.itemName}>{order.item_name || 'Meal'}</span>
                                            </div>
                                            <div style={styles.timeline}>
                                                <div style={styles.timelineTrack} />
                                                <div style={{ ...styles.timelineTrackActive, width: activeWidth }} />
                                                <div style={styles.timelineStepsRow}>
                                                    {steps.map((label, index) => (
                                                        <div key={label} style={styles.timelineStep}>
                                                            <div
                                                                style={{
                                                                    ...styles.timelineDot,
                                                                    ...(index <= step ? styles.timelineDotActive : {}),
                                                                }}
                                                            />
                                                            <span
                                                                style={{
                                                                    ...styles.timelineLabel,
                                                                    ...(index <= step ? styles.timelineLabelActive : {}),
                                                                }}
                                                            >
                                                                {label}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })()
                            )}
                        </div>
                    </section>
                </main>
            </div>

            {showBilling && (
                <div style={styles.billingOverlay}>
                    <div className="card" style={styles.billingPanel}>
                        <div style={styles.billingHeader}>
                            <div>
                                <h3 style={styles.billingTitle}>Billing Summary</h3>
                                <p style={styles.billingSubtitle}>Dummy preview for your recent cafeteria activity</p>
                            </div>
                            <button
                                type="button"
                                style={styles.billingClose}
                                onClick={() => setShowBilling(false)}
                            >
                                ✕
                            </button>
                        </div>

                        <div style={styles.billingBody}>
                            <div style={styles.billingRow}>
                                <span style={styles.billingLabel}>Student ID</span>
                                <span style={styles.billingValue}>{user.student_id}</span>
                            </div>
                            <div style={styles.billingRow}>
                                <span style={styles.billingLabel}>Current Month</span>
                                <span style={styles.billingValue}>March 2026</span>
                            </div>
                            <div style={{ ...styles.billingRow, marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px dashed #e2e8f0' }}>
                                <span style={styles.billingLabel}>Sample Meals</span>
                                <span style={styles.billingValueMuted}>Illustrative only</span>
                            </div>

                            <div style={styles.billingItems}>
                                <div style={styles.billingItem}>
                                    <div>
                                        <div style={styles.billingItemName}>Cafeteria Lunch Combo</div>
                                        <div style={styles.billingItemMeta}>x3 · ৳120 each</div>
                                    </div>
                                    <div style={styles.billingItemAmount}>৳360</div>
                                </div>
                                <div style={styles.billingItem}>
                                    <div>
                                        <div style={styles.billingItemName}>Evening Snacks</div>
                                        <div style={styles.billingItemMeta}>x5 · ৳60 each</div>
                                    </div>
                                    <div style={styles.billingItemAmount}>৳300</div>
                                </div>
                                <div style={styles.billingItem}>
                                    <div>
                                        <div style={styles.billingItemName}>Special Day Menu</div>
                                        <div style={styles.billingItemMeta}>x1 · ৳180</div>
                                    </div>
                                    <div style={styles.billingItemAmount}>৳180</div>
                                </div>
                            </div>

                            <div style={{ ...styles.billingRow, marginTop: '0.75rem' }}>
                                <span style={styles.billingLabel}>Subtotal</span>
                                <span style={styles.billingValue}>৳840</span>
                            </div>
                            <div style={styles.billingRow}>
                                <span style={styles.billingLabel}>EST. VAT (5%)</span>
                                <span style={styles.billingValue}>৳42</span>
                            </div>
                            <div style={{ ...styles.billingRow, marginTop: '0.5rem' }}>
                                <span style={styles.billingTotalLabel}>Estimated Total</span>
                                <span style={styles.billingTotalValue}>৳882</span>
                            </div>

                            <p style={styles.billingNote}>
                                This is a <strong>dummy billing window</strong> for UI only. Actual payment and history will
                                be handled by the backend in a real deployment.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {notification && (
                <div className="card toast-like" style={styles.notification}>{notification}</div>
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
        maxWidth: '1200px',
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
        padding: '1.25rem 1.5rem',
    },
    cpPanel: { padding: '1.1rem 1.3rem', marginBottom: '1.25rem', maxWidth: '460px' },
    cpTitle: { marginBottom: '0.75rem', color: '#e5e7eb', fontSize: '0.95rem', fontWeight: '600' },
    pwRow: { position: 'relative', display: 'flex', alignItems: 'center' },
    cpInput: { width: '100%', padding: '9px 40px 9px 12px', borderRadius: '6px', border: '1.5px solid #dce0e5', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box', background: '#fafbfc' },
    eyeInline: { position: 'absolute', right: '10px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem' },
    main: { display: 'grid', gridTemplateColumns: 'minmax(0, 7fr) minmax(0, 3fr)', gap: '2.25rem', marginTop: '0.25rem', alignItems: 'flex-start' },
    menuSection: { minWidth: 0 },
    orderSection: { marginTop: '0.5rem' },
    sectionTitle: { marginBottom: '1.25rem', fontSize: '1.25rem', fontWeight: '700', color: '#f9fafb' },
    orderErrorBanner: { background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '10px 14px', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.85rem' },
    menuGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '1.5rem' },
    menuCard: {
        padding: '1.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        background: '#ffffff',
        border: '1px solid #e5e7eb',
        boxShadow: '0 18px 40px rgba(15,23,42,0.16)',
    },
    menuHeader: { textAlign: 'center' },
    menuIconCircle: {
        width: '72px', height: '72px', borderRadius: '999px', margin: '0 auto 0.75rem',
        background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem',
    },
    menuName: { fontSize: '1.05rem', fontWeight: 700, color: '#020617', marginBottom: '0.25rem' },
    menuPrice: { fontSize: '1rem', fontWeight: 600, color: '#16a34a' },
    menuMeta: { display: 'flex', justifyContent: 'center', marginBottom: '0.5rem' },
    menuStock: { fontSize: '0.82rem', color: '#4b5563', display: 'flex', alignItems: 'center', gap: '6px' },
    menuStockDot: { width: '8px', height: '8px', borderRadius: '999px', background: '#16a34a', display: 'inline-block' },
    menuOrderBtn: { width: '100%', marginTop: '0.5rem' },
    menuOrderBtnSold: {
        background: 'linear-gradient(135deg, #b91c1c, #ef4444)',
        boxShadow: '0 10px 24px rgba(248,113,113,0.55)',
    },
    emptyMenuCard: { padding: '1.75rem', textAlign: 'center' },
    carouselWrap: { marginTop: '2rem' },

    orderList: { display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '380px', marginLeft: 'auto' },
    orderCard: {
        padding: '1.1rem 1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.9rem',
        background: '#ffffff',
        border: '1px solid #e5e7eb',
        boxShadow: '0 18px 40px rgba(15,23,42,0.16)',
    },
    emptyCard: {
        padding: '1.5rem 1.75rem',
        textAlign: 'left',
        background: '#ffffff',
        border: '1px solid #e5e7eb',
        boxShadow: '0 18px 40px rgba(15,23,42,0.16)',
    },
    orderInfo: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' },
    itemName: { fontWeight: '600', fontSize: '0.95rem', color: '#020617' },
    emptyTitle: { fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.25rem', color: '#020617' },
    emptySub: { fontSize: '0.85rem', color: '#6b7280', marginBottom: '0.75rem' },

    timeline: { position: 'relative', marginTop: '0.6rem', paddingTop: '0.35rem' },
    timelineTrack: {
        position: 'absolute', top: '50%', left: '6px', right: '6px', height: '2px',
        background: '#e5e7eb', transform: 'translateY(-50%)',
    },
    timelineTrackActive: {
        position: 'absolute', top: '50%', left: '6px', height: '2px',
        background: '#22c55e', transform: 'translateY(-50%)', borderRadius: '999px',
    },
    timelineStepsRow: { display: 'flex', justifyContent: 'space-between', position: 'relative' },
    timelineStep: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' },
    timelineDot: {
        width: '10px', height: '10px', borderRadius: '999px', background: '#0f172a',
        border: '2px solid #cbd5f5', zIndex: 1,
    },
    timelineDotActive: { background: '#22c55e', borderColor: '#16a34a' },
    timelineLabel: { fontSize: '0.8rem', color: '#9ca3af' },
    timelineLabelActive: { color: '#22c55e', fontWeight: 600 },
    timelineSkeleton: { marginTop: '0.25rem' },
    timelineBar: { height: '4px', borderRadius: '999px', background: 'linear-gradient(90deg, #e5e7eb, #cbd5f5)' },
    notification: {
        position: 'fixed', bottom: '1.5rem', right: '1.5rem',
        padding: '12px 20px',
        borderLeft: '4px solid #1a6137',
        zIndex: 100,
        fontWeight: '600',
        fontSize: '0.9rem',
        maxWidth: '360px',
    },
    empty: { color: '#9ca3af', fontStyle: 'italic', fontSize: '0.9rem' },
    billingOverlay: {
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.32)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        zIndex: 90,
        padding: '1.5rem',
    },
    billingPanel: {
        width: '360px',
        maxWidth: '90vw',
        padding: '1.5rem 1.75rem',
        boxShadow: '0 20px 60px rgba(15,23,42,0.4)',
    },
    billingHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: '1rem',
    },
    billingTitle: {
        fontSize: '1.05rem',
        fontWeight: 700,
        color: '#f9fafb',
        margin: 0,
    },
    billingSubtitle: {
        fontSize: '0.8rem',
        color: '#9ca3af',
        marginTop: '2px',
    },
    billingClose: {
        borderRadius: '999px',
        width: '28px',
        height: '28px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '0.9rem',
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
    },
    billingBody: {
        marginTop: '0.5rem',
        fontSize: '0.85rem',
    },
    billingRow: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '0.5rem',
        marginBottom: '0.35rem',
    },
    billingLabel: {
        color: '#9ca3af',
    },
    billingValue: {
        fontWeight: 600,
        color: '#f9fafb',
    },
    billingValueMuted: {
        fontSize: '0.78rem',
        color: '#94a3b8',
        fontStyle: 'italic',
    },
    billingItems: {
        marginTop: '0.5rem',
        marginBottom: '0.5rem',
        borderRadius: '10px',
        background: 'linear-gradient(135deg, rgba(22,163,74,0.06), rgba(59,130,246,0.04))',
        padding: '0.75rem 0.85rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.35rem',
    },
    billingItem: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    billingItemName: {
        fontWeight: 600,
        color: '#f9fafb',
        fontSize: '0.86rem',
    },
    billingItemMeta: {
        fontSize: '0.78rem',
        color: '#9ca3af',
    },
    billingItemAmount: {
        fontWeight: 600,
        color: '#f9fafb',
    },
    billingTotalLabel: {
        fontWeight: 700,
        color: '#f9fafb',
    },
    billingTotalValue: {
        fontWeight: 800,
        color: '#15803d',
        fontSize: '1rem',
    },
    billingNote: {
        marginTop: '0.75rem',
        fontSize: '0.78rem',
        color: '#64748b',
        lineHeight: 1.4,
    },
};

export default StudentPage;
