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
                if (data.access_token) {
                    onLogin(data);
                } else {
                    setError('Unexpected response from server.');
                }
            } else {
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
        <div style={styles.page}>
            {/* Top accent bar */}
            <div style={styles.topBar}></div>

            <div style={styles.container}>
                <div className="card" style={styles.card}>
                    {/* IUT branding */}
                    <div style={styles.branding}>
                        <div style={styles.logoMark}>IUT</div>
                        <h1 style={styles.title}>IUT Cafeteria</h1>
                        <p style={styles.subtitle}>
                            Islamic University of Technology
                        </p>
                    </div>

                    <div style={styles.divider}></div>

                    <h2 style={styles.formHeading}>
                        {isLogin ? 'Sign In' : 'Create Account'}
                    </h2>
                    <p style={styles.formSubtext}>
                        {isLogin
                            ? 'Enter your credentials to continue'
                            : 'Register with your student ID'}
                    </p>

                    <form onSubmit={handleSubmit} style={styles.form}>
                        <div style={styles.inputGroup}>
                            <label style={styles.label}>ID</label>
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
                                    placeholder="Enter password"
                                    style={{ ...styles.input, paddingRight: '44px' }}
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

                        {error && <p style={styles.error}>{error}</p>}
                        {success && <p style={styles.successMsg}>{success}</p>}

                        <button
                            type="submit"
                            className="btn-primary"
                            style={{ ...styles.submitBtn, opacity: loading ? 0.7 : 1 }}
                            disabled={loading}
                        >
                            {loading ? 'Please wait...' : isLogin ? 'Sign In' : 'Register'}
                        </button>
                    </form>

                    <div style={styles.toggle}>
                        <p>
                            {isLogin ? "Don't have an account? " : 'Already have an account? '}
                            <span onClick={switchMode} style={styles.toggleLink}>
                                {isLogin ? 'Register now' : 'Sign in instead'}
                            </span>
                        </p>
                    </div>
                </div>

                <p style={styles.footer}>
                    Islamic University of Technology — A subsidiary organ of OIC
                </p>
            </div>
        </div>
    );
};

const styles = {
    page: {
        minHeight: '100vh',
        background: 'radial-gradient(circle at top left, #022c22 0, #065f46 38%, #020617 100%)',
        display: 'flex',
        flexDirection: 'column',
    },
    topBar: {
        height: '4px',
        background: 'linear-gradient(to right, #0e4528, #1a6137, #2e8b57)',
    },
    container: {
        minHeight: 'calc(100vh - 4px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.25rem',
    },
    card: {
        padding: '2rem 1.75rem',
        width: '100%',
        maxWidth: '420px',
        background: 'linear-gradient(135deg, rgba(15,23,42,0.98), rgba(15,23,42,0.96))',
    },
    branding: {
        textAlign: 'center',
        marginBottom: '0.25rem',
    },
    logoMark: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '56px',
        height: '56px',
        background: '#1a6137',
        color: 'white',
        borderRadius: '12px',
        fontSize: '1.1rem',
        fontWeight: '800',
        letterSpacing: '0.05em',
        marginBottom: '1rem',
    },
    title: {
        fontSize: '1.6rem',
        fontWeight: '700',
        color: '#f9fafb',
        margin: 0,
    },
    subtitle: {
        fontSize: '0.85rem',
        color: '#9ca3af',
        marginTop: '2px',
    },
    divider: {
        height: '1px',
        background: '#e0e4e8',
        margin: '1.1rem 0 1.25rem',
    },
    formHeading: {
        fontSize: '1.2rem',
        fontWeight: '600',
        color: '#f9fafb',
        marginBottom: '2px',
    },
    formSubtext: {
        color: '#9ca3af',
        fontSize: '0.85rem',
        marginBottom: '1.1rem',
    },
    form: {
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
    },
    inputGroup: {
        textAlign: 'left',
    },
    label: {
        display: 'block',
        fontSize: '0.85rem',
        fontWeight: '600',
        marginBottom: '6px',
        color: '#e5e7eb',
    },
    input: {
        width: '100%',
        padding: '10px 14px',
        borderRadius: '6px',
        border: '1.5px solid rgba(148,163,184,0.7)',
        fontSize: '0.95rem',
        outline: 'none',
        transition: 'border-color 0.2s, background-color 0.2s',
        boxSizing: 'border-box',
        background: 'rgba(15,23,42,0.9)',
        color: '#f9fafb',
    },
    passwordWrapper: {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
    },
    eyeBtn: {
        position: 'absolute',
        right: '10px',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: '1rem',
        padding: '4px',
        lineHeight: 1,
    },
    submitBtn: {
        marginTop: '0.15rem',
        width: '100%',
        fontSize: '0.95rem',
        padding: '11px 24px',
    },
    error: {
        color: '#fecaca',
        fontSize: '0.85rem',
        textAlign: 'left',
        marginTop: '-0.25rem',
        background: 'rgba(127,29,29,0.5)',
        padding: '8px 12px',
        borderRadius: '6px',
        border: '1px solid #fecaca',
    },
    successMsg: {
        color: '#bbf7d0',
        fontSize: '0.85rem',
        textAlign: 'left',
        marginTop: '-0.25rem',
        background: 'rgba(22,163,74,0.35)',
        padding: '8px 12px',
        borderRadius: '6px',
        border: '1px solid #bbf7d0',
    },
    toggle: {
        marginTop: '1rem',
        fontSize: '0.88rem',
        color: '#9ca3af',
        textAlign: 'center',
    },
    toggleLink: {
        color: '#4ade80',
        fontWeight: '600',
        cursor: 'pointer',
    },
    footer: {
        marginTop: '1.5rem',
        fontSize: '0.8rem',
        color: '#cbd5f5',
    },
};

export default AuthPage;
