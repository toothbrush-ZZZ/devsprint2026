import { useState } from 'react';
import { api } from '../utils/api';

const AuthPage = ({ onLogin }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [studentId, setStudentId] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        const endpoint = isLogin ? '/login/' : '/register/';

        try {
            const res = await api.post('identity', endpoint, {
                student_id: studentId,
                password: password
            });

            const data = res.data || res;

            if (data.access_token) {
                onLogin(data);
            } else if (data.success && !isLogin) {
                setIsLogin(true);
                setError('Account created! Please login.');
            } else {
                setError(data.error || res.error || 'Something went wrong');
            }
        } catch (err) {
            setError('Connection failed. Is the backend running?');
        }
    };

    return (
        <div className="auth-container" style={styles.container}>
            <div className="glass-card floating" style={styles.card}>
                <h1 className="vibrant-text" style={styles.title}>
                    {isLogin ? 'Welcome Back!' : 'Join the Sprint'}
                </h1>
                <p style={styles.subtitle}>
                    {isLogin ? 'Login to your student account' : 'Register for cafeteria ordering'}
                </p>

                <form onSubmit={handleSubmit} style={styles.form}>
                    <div style={styles.inputGroup}>
                        <label style={styles.label}>Student ID</label>
                        <input
                            type="text"
                            value={studentId}
                            onChange={(e) => setStudentId(e.target.value)}
                            placeholder="e.g. 210041001"
                            style={styles.input}
                            required
                        />
                    </div>
                    <div style={styles.inputGroup}>
                        <label style={styles.label}>Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            style={styles.input}
                            required
                        />
                    </div>

                    {error && <p style={styles.error}>{error}</p>}

                    <button type="submit" className="btn-primary" style={styles.submitBtn}>
                        {isLogin ? 'Login' : 'Register'}
                    </button>
                </form>

                <div style={styles.toggle}>
                    <p>
                        {isLogin ? "Don't have an account? " : "Already have an account? "}
                        <span
                            onClick={() => setIsLogin(!isLogin)}
                            style={styles.toggleLink}
                        >
                            {isLogin ? 'Register now' : 'Login instead'}
                        </span>
                    </p>
                </div>
            </div>

            {/* Decorative Blobs */}
            <div style={{ ...styles.blob, background: 'rgba(230, 57, 70, 0.1)', top: '10%', right: '15%' }}></div>
            <div style={{ ...styles.blob, background: 'rgba(230, 57, 70, 0.05)', bottom: '15%', left: '10%' }}></div>
        </div>
    );
};

const styles = {
    container: {
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
    },
    card: {
        padding: '3rem',
        width: '100%',
        maxWidth: '450px',
        textAlign: 'center',
        zIndex: 10,
    },
    title: {
        fontSize: '2.5rem',
        marginBottom: '0.5rem',
    },
    subtitle: {
        color: '#64748b',
        marginBottom: '2rem',
    },
    form: {
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem',
    },
    inputGroup: {
        textAlign: 'left',
    },
    label: {
        display: 'block',
        fontSize: '0.9rem',
        fontWeight: '600',
        marginBottom: '0.5rem',
        color: '#1d3557',
    },
    input: {
        width: '100%',
        padding: '12px 16px',
        borderRadius: '12px',
        border: '1.5px solid #e2e8f0',
        fontSize: '1rem',
        outline: 'none',
        transition: 'border-color 0.2s',
    },
    submitBtn: {
        marginTop: '1rem',
        width: '100%',
        fontSize: '1.1rem',
    },
    error: {
        color: '#ef4444',
        fontSize: '0.9rem',
        marginTop: '-0.5rem',
    },
    toggle: {
        marginTop: '2rem',
        fontSize: '0.95rem',
        color: '#64748b',
    },
    toggleLink: {
        color: '#e63946',
        fontWeight: '600',
        cursor: 'pointer',
    },
    blob: {
        position: 'absolute',
        width: '400px',
        height: '400px',
        borderRadius: '50%',
        filter: 'blur(80px)',
        zIndex: 1,
    }
};

export default AuthPage;
