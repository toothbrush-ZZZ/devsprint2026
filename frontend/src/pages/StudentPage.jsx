import { useState, useEffect } from 'react';
import Carousel from '../components/Carousel';
import { api } from '../utils/api';

const StudentPage = ({ user, onLogout }) => {
    const [items, setItems] = useState([]);
    const [activeOrders, setActiveOrders] = useState([]);
    const [notification, setNotification] = useState(null);

    useEffect(() => {
        fetchItems();
        setupWebSocket();
    }, []);

    const fetchItems = async () => {
        try {
            const res = await api.get('stock', '/items/', user.access_token);
            const data = res.data || res;
            if (Array.isArray(data)) {
                setItems(data);
            } else {
                console.error('Expected array of items, got:', data);
            }
        } catch (err) {
            console.error('Failed to fetch items', err);
        }
    };

    const setupWebSocket = () => {
        const ws = new WebSocket(`ws://localhost:8005/ws/student/${user.student_id}/`);

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            setNotification(`Order #${data.order_id} is now ${data.status}!`);

            // Update local orders list
            setActiveOrders(prev => {
                const index = prev.findIndex(o => o.order_id === data.order_id);
                if (index > -1) {
                    const newOrders = [...prev];
                    newOrders[index] = { ...newOrders[index], status: data.status };
                    return newOrders;
                }
                return [data, ...prev];
            });

            // Clear notification after 5s
            setTimeout(() => setNotification(null), 5000);
        };

        return () => ws.close();
    };

    const handleOrder = async (itemId) => {
        try {
            const res = await api.post('order', '/order/', { item_id: itemId }, user.access_token);
            if (res.success) {
                setNotification('Order placed successfully!');
                setActiveOrders(prev => [res, ...prev]);
                fetchItems(); // Refresh stock
            }
        } catch (err) {
            setNotification('Failed to place order.');
        }
    };

    return (
        <div style={styles.page}>
            <header style={styles.header}>
                <div style={styles.brand}>
                    <h1 className="vibrant-text" style={styles.logo}>DevSprint '26</h1>
                    <p style={styles.welcome}>Healthy meals for {user.student_id}</p>
                </div>
                <button className="btn-primary" onClick={onLogout}>Logout</button>
            </header>

            <main style={styles.main}>
                <section style={styles.menuSection}>
                    <h2 style={styles.sectionTitle}>Today's Special</h2>
                    <Carousel items={items} onOrder={handleOrder} />
                </section>

                <section style={styles.orderSection}>
                    <h2 style={styles.sectionTitle}>Active Orders</h2>
                    <div style={styles.orderList}>
                        {activeOrders.length === 0 ? (
                            <p style={styles.empty}>No active orders. Hungry?</p>
                        ) : (
                            activeOrders.map(order => (
                                <div key={order.order_id} className="glass-card" style={styles.orderCard}>
                                    <div style={styles.orderInfo}>
                                        <span style={styles.orderId}>#{order.order_id}</span>
                                        <span style={styles.itemName}>{order.item_name || 'Meal'}</span>
                                    </div>
                                    <div style={{
                                        ...styles.status,
                                        background: order.status === 'ready' ? '#22c55e' : '#e63946'
                                    }}>
                                        {order.status?.toUpperCase() || 'PENDING'}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </section>
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
    },
    logo: {
        fontSize: '2rem',
        margin: 0,
    },
    welcome: {
        color: '#64748b',
        fontSize: '0.9rem',
    },
    main: {
        display: 'grid',
        gridTemplateColumns: '1fr 350px',
        gap: '3rem',
    },
    menuSection: {
        minWidth: 0,
    },
    sectionTitle: {
        marginBottom: '1.5rem',
        fontSize: '1.5rem',
    },
    orderList: {
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
    },
    orderCard: {
        padding: '1.25rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    orderInfo: {
        display: 'flex',
        flexDirection: 'column',
    },
    orderId: {
        fontSize: '0.8rem',
        color: '#64748b',
    },
    itemName: {
        fontWeight: '600',
    },
    status: {
        padding: '4px 12px',
        borderRadius: '20px',
        color: 'white',
        fontSize: '0.75rem',
        fontWeight: '700',
    },
    notification: {
        position: 'fixed',
        bottom: '2rem',
        right: '2rem',
        padding: '1rem 2rem',
        borderLeft: '4px solid #e63946',
        zIndex: 100,
        fontWeight: '600',
    },
    empty: {
        color: '#64748b',
        fontStyle: 'italic',
    }
};

export default StudentPage;
