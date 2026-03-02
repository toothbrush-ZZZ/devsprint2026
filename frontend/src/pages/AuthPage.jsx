import { useState } from 'react';
import { api } from '../utils/api';

const AuthPage = ({ onLogin }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [studentId, setStudentId] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        setLoading(true);

        const endpoint = isLogin ? '/login/' : '/register/';

        try {
            const data = await api.post('identity', endpoint, {
                student_id: studentId,
                password: password,
            });

            if (isLogin) {
                // Login: backend returns { access_token, refresh_token, student_id, is_admin }
                if (data.access_token) {
                    onLogin(data);
                } else {
                    setError('Unexpected response from server.');
                }
            } else {
                // Register: backend returns { message: "Student X registered successfully" }
                if (data.message) {
                    setSuccess('Account created! Please login.');
                    setIsLogin(true);
                    setPassword('');
                } else {
                    setError('Unexpected response from server.');
                }
            }
        } catch (err) {
            if (err.status === 429) {
                setError('Too many attempts. Please wait 1 minute and try again.');
            } else if (err.status === 401) {
                setError('Invalid Student ID or password.');
            } else if (err.status === 400) {
                setError(err.message || 'Bad request. Check your inputs.');
            } else if (err.message) {
                setError(err.message);
            } else {
                setError('Connection failed. Is the backend running?');
            }
        } finally {
            setLoading(false);
        }
    };

    const switchMode = () => {
        setIsLogin(!isLogin);
        setError('');
        setSuccess('');
        setPassword('');
        setShowPassword(false);
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
                            disabled={loading}
                        />
                    </div>

                    <div style={styles.inputGroup}>
                        <label style={styles.label}>Password</label>
                        <div style={styles.passwordWrapper}>
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                style={{ ...styles.input, paddingRight: '48px' }}
                                required
                                disabled={loading}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                style={styles.eyeBtn}
                                title={showPassword ? 'Hide password' : 'Show password'}
                            >
                                {showPassword ? '🙈' : '👁️'}
                            </button>
                        </div>
                    </div>

                    {error && <p style={styles.error}>⚠️ {error}</p>}
                    {success && <p style={styles.successMsg}>✅ {success}</p>}

                    <button
                        type="submit"
                        className="btn-primary"
                        style={{ ...styles.submitBtn, opacity: loading ? 0.7 : 1 }}
                        disabled={loading}
                    >
                        {loading ? 'Please wait...' : isLogin ? 'Login' : 'Register'}
                    </button>
                </form>

                <div style={styles.toggle}>
                    <p>
                        {isLogin ? "Don't have an account? " : 'Already have an account? '}
                        <span onClick={switchMode} style={styles.toggleLink}>
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
        boxSizing: 'border-box',
        background: 'white',
    },
    passwordWrapper: {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
    },
    eyeBtn: {
        position: 'absolute',
        right: '12px',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: '1.1rem',
        padding: '4px',
        lineHeight: 1,
    },
    submitBtn: {
        marginTop: '0.5rem',
        width: '100%',
        fontSize: '1.1rem',
    },
    error: {
        color: '#ef4444',
        fontSize: '0.9rem',
        textAlign: 'left',
        marginTop: '-0.5rem',
        background: '#fef2f2',
        padding: '8px 12px',
        borderRadius: '8px',
        border: '1px solid #fecaca',
    },
    successMsg: {
        color: '#16a34a',
        fontSize: '0.9rem',
        textAlign: 'left',
        marginTop: '-0.5rem',
        background: '#f0fdf4',
        padding: '8px 12px',
        borderRadius: '8px',
        border: '1px solid #bbf7d0',
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
    },
};

export default AuthPage;
