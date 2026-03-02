import { useState } from 'react';

const Carousel = ({ items, onOrder }) => {
    const [activeIndex, setActiveIndex] = useState(0);

    const next = () => setActiveIndex((prev) => (prev + 1) % items.length);
    const prev = () => setActiveIndex((prev) => (prev - 1 + items.length) % items.length);

    if (!Array.isArray(items) || items.length === 0) return (
        <div className="card" style={styles.empty}>
            <p>Loading menu items...</p>
        </div>
    );

    return (
        <div style={styles.container}>
            <div style={styles.track}>
                {items.map((item, index) => {
                    let position = 'hidden';
                    if (index === activeIndex) position = 'active';
                    else if (index === (activeIndex + 1) % items.length) position = 'next';
                    else if (index === (activeIndex - 1 + items.length) % items.length) position = 'prev';

                    return (
                        <div
                            key={item.id}
                            className="card"
                            style={{
                                ...styles.card,
                                ...styles[position]
                            }}
                        >
                            <div style={styles.iconCircle}>
                                <span style={{ fontSize: '2.5rem' }}>🍽️</span>
                            </div>
                            <h3 style={styles.mealName}>{item.name}</h3>
                            <p style={styles.price}>৳{item.price}</p>
                            <div style={styles.stock}>
                                <span style={styles.stockDot}></span>
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
                <button onClick={prev} style={styles.controlBtn}>‹</button>
                <div style={styles.dots}>
                    {items.map((_, i) => (
                        <div
                            key={i}
                            onClick={() => setActiveIndex(i)}
                            style={{
                                ...styles.dot,
                                background: i === activeIndex ? '#1a6137' : '#d1d5db',
                                width: i === activeIndex ? '20px' : '8px',
                                borderRadius: i === activeIndex ? '4px' : '50%',
                            }}
                        ></div>
                    ))}
                </div>
                <button onClick={next} style={styles.controlBtn}>›</button>
            </div>
        </div>
    );
};

const styles = {
    container: {
        position: 'relative',
        height: '480px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem 0',
    },
    track: {
        position: 'relative',
        width: '100%',
        height: '380px',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
    },
    card: {
        position: 'absolute',
        width: '280px',
        padding: '2rem',
        textAlign: 'center',
        transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
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
        opacity: 0.35,
        transform: 'translateX(-105%) scale(0.85)',
        zIndex: 1,
    },
    next: {
        opacity: 0.35,
        transform: 'translateX(105%) scale(0.85)',
        zIndex: 1,
    },
    hidden: {
        opacity: 0,
        transform: 'translateX(0) scale(0.5)',
        zIndex: 0,
        pointerEvents: 'none',
    },
    iconCircle: {
        width: '90px',
        height: '90px',
        background: '#f0fdf4',
        border: '2px solid #bbf7d0',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto 1.25rem',
    },
    mealName: {
        fontSize: '1.3rem',
        color: '#1a1a2e',
        marginBottom: '0.4rem',
        fontWeight: '700',
    },
    price: {
        fontSize: '1.15rem',
        color: '#1a6137',
        fontWeight: '700',
        marginBottom: '0.75rem',
    },
    stock: {
        fontSize: '0.82rem',
        color: '#5a6474',
        marginBottom: '1.25rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
    },
    stockDot: {
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        background: '#16a34a',
        display: 'inline-block',
    },
    orderBtn: {
        width: '100%',
    },
    controls: {
        display: 'flex',
        alignItems: 'center',
        gap: '1.5rem',
        marginTop: '1.5rem',
    },
    controlBtn: {
        background: 'white',
        width: '40px',
        height: '40px',
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '1.5rem',
        color: '#1a1a2e',
        border: '1.5px solid #dce0e5',
        cursor: 'pointer',
        fontWeight: '300',
    },
    dots: {
        display: 'flex',
        gap: '6px',
        alignItems: 'center',
    },
    dot: {
        height: '8px',
        transition: 'all 0.3s',
        cursor: 'pointer',
    },
    empty: {
        padding: '4rem',
        textAlign: 'center',
        color: '#5a6474',
    }
};

export default Carousel;
