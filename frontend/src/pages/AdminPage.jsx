import { useState, useEffect } from 'react';
import { api } from '../utils/api';

const AdminPage = ({ user, onLogout }) => {
    const [items, setItems] = useState([]);
    const [orders, setOrders] = useState([]);
    const [newItem, setNewItem] = useState({ name: '', price: '', quantity: '' });
    const [notification, setNotification] = useState(null);
    const [activeTab, setActiveTab] = useState('inventory'); // 'inventory' or 'kitchen'

    useEffect(() => {
        fetchInventory();
        fetchOrders();

        // Setup Kitchen WebSocket
        const ws = new WebSocket(`ws://localhost:8005/ws/kitchen/`);
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            setNotification(`New order received! #${data.order_id}`);
            fetchOrders();
            setTimeout(() => setNotification(null), 5000);
        };
        return () => ws.close();
    }, []);

    const fetchInventory = async () => {
        try {
            const res = await api.get('stock', '/items/', user.access_token);
            setItems(res.data || res);
        } catch (err) {
            console.error('Failed to fetch inventory', err);
        }
    };

    const fetchOrders = async () => {
        try {
            const res = await api.get('kitchen', '/kitchen/orders/all/', user.access_token);
            setOrders(res.data || res);
        } catch (err) {
            console.error('Failed to fetch orders', err);
        }
    };

    const handleCreateItem = async (e) => {
        e.preventDefault();
        try {
            const res = await api.post('stock', '/items/create/', newItem, user.access_token);
            if (res.id || res.success) {
                setNotification('Item created successfully!');
                setNewItem({ name: '', price: '', quantity: '' });
                fetchInventory();
            }
        } catch (err) {
            setNotification('Failed to create item.');
        }
    };

    const handleDeleteItem = async (id) => {
        try {
            // Logic for delete depends on API (usually DELETE /items/<id>/delete/)
            await fetch(`http://localhost:8002/items/${id}/delete/`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${user.access_token}` }
            });
            setNotification('Item deleted.');
            fetchInventory();
        } catch (err) {
            setNotification('Failed to delete item.');
        }
    };

    const handleUpdateStock = async (id, action) => {
        try {
            await api.post('stock', `/stock/${id}/${action}/`, {}, user.access_token);
            fetchInventory();
        } catch (err) {
            setNotification(`Failed to ${action} stock.`);
        }
    };

    const handleMarkReady = async (orderId) => {
        try {
            const res = await api.patch('kitchen', `/kitchen/orders/${orderId}/ready/`, {}, user.access_token);
            if (res.success || res.status === 'ready') {
                setNotification(`Order #${orderId} marked as ready!`);
                fetchOrders();
            }
        } catch (err) {
            setNotification('Failed to update order status.');
        }
    };

    return (
        <div style={styles.page}>
            <header style={styles.header}>
                <div>
                    <h1 className="vibrant-text" style={styles.logo}>Admin Hub</h1>
                    <p style={styles.welcome}>Managing DevSprint Cafeteria</p>
                </div>
                <div style={styles.headerActions}>
                    <button
                        style={{ ...styles.tabBtn, backgroundColor: activeTab === 'inventory' ? '#e63946' : 'transparent', color: activeTab === 'inventory' ? 'white' : '#1d3557' }}
                        onClick={() => setActiveTab('inventory')}
                    >
                        Inventory
                    </button>
                    <button
                        style={{ ...styles.tabBtn, backgroundColor: activeTab === 'kitchen' ? '#e63946' : 'transparent', color: activeTab === 'kitchen' ? 'white' : '#1d3557' }}
                        onClick={() => setActiveTab('kitchen')}
                    >
                        Kitchen
                    </button>
                    <button className="btn-primary" onClick={onLogout}>Logout</button>
                </div>
            </header>

            <main style={styles.main}>
                {activeTab === 'inventory' ? (
                    <div style={styles.inventoryGrid}>
                        <section className="glass-card" style={styles.addItemSection}>
                            <h3>Add New Item</h3>
                            <form onSubmit={handleCreateItem} style={styles.form}>
                                <input
                                    style={styles.input}
                                    placeholder="Name"
                                    value={newItem.name}
                                    onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                                    required
                                />
                                <input
                                    style={styles.input}
                                    placeholder="Price"
                                    type="number"
                                    value={newItem.price}
                                    onChange={e => setNewItem({ ...newItem, price: e.target.value })}
                                    required
                                />
                                <input
                                    style={styles.input}
                                    placeholder="Initial Stock"
                                    type="number"
                                    value={newItem.quantity}
                                    onChange={e => setNewItem({ ...newItem, quantity: e.target.value })}
                                    required
                                />
                                <button type="submit" className="btn-primary">Create Item</button>
                            </form>
                        </section>

                        <section style={styles.listSection}>
                            <h3>Menu & Stock</h3>
                            <div style={styles.tableWrapper}>
                                <table style={styles.table}>
                                    <thead>
                                        <tr style={styles.tr}>
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
                                                        padding: '4px 8px',
                                                        borderRadius: '12px',
                                                        fontSize: '0.7rem',
                                                        backgroundColor: item.available ? '#dcfce7' : '#fee2e2',
                                                        color: item.available ? '#166534' : '#991b1b'
                                                    }}>
                                                        {item.available ? 'Active' : 'Paused'}
                                                    </span>
                                                </td>
                                                <td style={styles.td}>
                                                    <div style={styles.actionGroup}>
                                                        <button onClick={() => handleUpdateStock(item.id, 'add')} style={styles.iconBtn}>➕</button>
                                                        <button onClick={() => handleUpdateStock(item.id, item.available ? 'pause' : 'unpause')} style={styles.iconBtn}>
                                                            {item.available ? '⏸️' : '▶️'}
                                                        </button>
                                                        <button onClick={() => handleDeleteItem(item.id)} style={styles.iconBtn}>🗑️</button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    </div>
                ) : (
                    <section style={styles.kitchenSection}>
                        <h3>Live Kitchen Queue</h3>
                        <div style={styles.orderGrid}>
                            {orders.filter(o => o.status !== 'ready' && o.status !== 'cancelled').map(order => (
                                <div key={order.order_id} className="glass-card floating" style={styles.orderCard}>
                                    <div style={styles.orderHeader}>
                                        <span style={styles.orderId}>#{order.order_id}</span>
                                        <span style={styles.studentId}>{order.student_id}</span>
                                    </div>
                                    <h4 style={styles.itemName}>{order.item_name || 'Meal'}</h4>
                                    <p style={styles.orderTime}>{new Date().toLocaleTimeString()}</p>
                                    <button
                                        className="btn-primary"
                                        style={styles.readyBtn}
                                        onClick={() => handleMarkReady(order.order_id)}
                                    >
                                        Mark Ready
                                    </button>
                                </div>
                            ))}
                            {orders.length === 0 && <p style={styles.empty}>No active orders in the kitchen.</p>}
                        </div>
                    </section>
                )}
            </main>

            {notification && (
                <div className="glass-card floating" style={styles.notification}>
                    {notification}
                </div>
            )}
        </div>
    );
};

const styles = {
    page: {
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '2rem',
    },
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '3rem',
        borderBottom: '1px solid #e2e8f0',
        paddingBottom: '1.5rem',
    },
    headerActions: {
        display: 'flex',
        gap: '1rem',
        alignItems: 'center',
    },
    tabBtn: {
        padding: '8px 20px',
        borderRadius: '20px',
        fontWeight: '600',
        border: '1px solid #e2e8f0',
        transition: 'all 0.3s',
    },
    logo: { fontSize: '2rem', margin: 0 },
    welcome: { color: '#64748b', fontSize: '0.9rem' },
    main: { marginTop: '2rem' },
    inventoryGrid: {
        display: 'grid',
        gridTemplateColumns: '350px 1fr',
        gap: '2rem',
    },
    addItemSection: {
        padding: '2rem',
        height: 'fit-content',
    },
    form: {
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        marginTop: '1.5rem',
    },
    input: {
        padding: '12px',
        borderRadius: '8px',
        border: '1px solid #e2e8f0',
        outline: 'none',
    },
    listSection: {
        minWidth: 0,
    },
    tableWrapper: {
        marginTop: '1.5rem',
        overflowX: 'auto',
    },
    table: {
        width: '100%',
        borderCollapse: 'collapse',
        textAlign: 'left',
    },
    th: {
        padding: '12px',
        borderBottom: '2px solid #f1f5f9',
        color: '#64748b',
        fontWeight: '600',
        fontSize: '0.9rem',
    },
    tr: {
        borderBottom: '1px solid #f1f5f9',
    },
    td: {
        padding: '12px',
        fontSize: '0.95rem',
    },
    actionGroup: {
        display: 'flex',
        gap: '0.5rem',
    },
    iconBtn: {
        background: 'none',
        fontSize: '1.1rem',
        padding: '4px',
    },
    kitchenSection: {
        width: '100%',
    },
    orderGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: '1.5rem',
        marginTop: '1.5rem',
    },
    orderCard: {
        padding: '1.5rem',
    },
    orderHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: '1rem',
    },
    orderId: { fontWeight: '800', color: '#e63946' },
    studentId: { color: '#64748b', fontSize: '0.8rem' },
    itemName: { fontSize: '1.2rem', marginBottom: '0.5rem' },
    orderTime: { color: '#94a3b8', fontSize: '0.8rem', marginBottom: '1.5rem' },
    readyBtn: { width: '100%' },
    notification: {
        position: 'fixed',
        bottom: '2rem',
        right: '2rem',
        padding: '1rem 2rem',
        borderLeft: '4px solid #e63946',
        zIndex: 100,
        fontWeight: '600',
    },
    empty: { color: '#64748b', fontStyle: 'italic', marginTop: '2rem' }
};

export default AdminPage;
