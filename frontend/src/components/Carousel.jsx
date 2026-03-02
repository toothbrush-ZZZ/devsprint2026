import { useState } from 'react';

const Carousel = ({ items, onOrder }) => {
    const [activeIndex, setActiveIndex] = useState(0);

    const next = () => setActiveIndex((prev) => (prev + 1) % items.length);
    const prev = () => setActiveIndex((prev) => (prev - 1 + items.length) % items.length);

    if (!Array.isArray(items) || items.length === 0) return (
        <div className="glass-card" style={styles.empty}>
            <p>Loading tasty meals...</p>
        </div>
    );

    return (
        <div style={styles.container}>
            <div style={styles.track}>
                {items.map((item, index) => {
                    let position = 'next';
                    if (index === activeIndex) position = 'active';
                    else if (index === (activeIndex - 1 + items.length) % items.length) position = 'prev';

                    return (
                        <div
                            key={item.id}
                            className="glass-card"
                            style={{
                                ...styles.card,
                                ...styles[position]
                            }}
                        >
                            <div style={styles.imagePlaceholder}>
                                <span style={{ fontSize: '4rem' }}>🍔</span>
                            </div>
                            <h3 style={styles.mealName}>{item.name}</h3>
                            <p style={styles.price}>৳{item.price}</p>
                            <div style={styles.stock}>
                                {item.quantity} available
                            </div>
                            <button
                                className="btn-primary"
                                style={styles.orderBtn}
                                onClick={() => onOrder(item.id)}
                                disabled={!item.available || item.quantity <= 0}
                            >
                                {item.available ? 'Order Now' : 'Sold Out'}
                            </button>
                        </div>
                    );
                })}
            </div>

            <div style={styles.controls}>
                <button onClick={prev} style={styles.controlBtn}>←</button>
                <div style={styles.dots}>
                    {items.map((_, i) => (
                        <div
                            key={i}
                            style={{
                                ...styles.dot,
                                background: i === activeIndex ? '#e63946' : '#cbd5e1'
                            }}
                        ></div>
                    ))}
                </div>
                <button onClick={next} style={styles.controlBtn}>→</button>
            </div>
        </div>
    );
};

const styles = {
    container: {
        position: 'relative',
        height: '500px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem 0',
    },
    track: {
        position: 'relative',
        width: '100%',
        height: '400px',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
    },
    card: {
        position: 'absolute',
        width: '300px',
        padding: '2rem',
        textAlign: 'center',
        transition: 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
        opacity: 0,
        pointerEvents: 'none',
    },
    active: {
        opacity: 1,
        transform: 'translateX(0) scale(1)',
        zIndex: 5,
        pointerEvents: 'auto',
    },
    prev: {
        opacity: 0.4,
        transform: 'translateX(-120%) scale(0.8)',
        zIndex: 1,
    },
    next: {
        opacity: 0.4,
        transform: 'translateX(120%) scale(0.8)',
        zIndex: 1,
    },
    imagePlaceholder: {
        width: '120px',
        height: '120px',
        background: '#fee2e2',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto 1.5rem',
    },
    mealName: {
        fontSize: '1.5rem',
        color: '#1d3557',
        marginBottom: '0.5rem',
    },
    price: {
        fontSize: '1.25rem',
        color: '#e63946',
        fontWeight: '700',
        marginBottom: '1rem',
    },
    stock: {
        fontSize: '0.9rem',
        color: '#64748b',
        marginBottom: '1.5rem',
    },
    orderBtn: {
        width: '100%',
    },
    controls: {
        display: 'flex',
        alignItems: 'center',
        gap: '2rem',
        marginTop: '2rem',
    },
    controlBtn: {
        background: 'white',
        width: '48px',
        height: '48px',
        borderRadius: '50%',
        boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '1.25rem',
        color: '#1d3557',
        border: '1px solid #e2e8f0',
    },
    dots: {
        display: 'flex',
        gap: '8px',
    },
    dot: {
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        transition: 'all 0.3s',
    },
    empty: {
        padding: '4rem',
        textAlign: 'center',
        color: '#64748b',
    }
};

export default Carousel;
