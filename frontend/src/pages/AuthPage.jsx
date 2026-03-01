import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../utils/api'
import './AuthPage.css'

export default function AuthPage({ toast }) {
  const [mode, setMode] = useState('login') // login | register
  const [studentId, setStudentId] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit() {
    if (!studentId || !password) { toast('Fill in all fields', 'warn'); return }
    setLoading(true)
    try {
      if (mode === 'register') {
        await api.auth.register(studentId, password)
        toast('Account created! Logging you in…', 'success')
        setMode('login')
        setLoading(false)
        return
      }
      const data = await api.auth.login(studentId, password)
      login(data)
      toast('Welcome back!', 'success')
      navigate(data.is_admin ? '/admin' : '/student')
    } catch (err) {
      toast(err.message || 'Authentication failed', 'error')
    }
    setLoading(false)
  }

  return (
    <div className="auth-page">
      <div className="auth-bg">
        <div className="auth-bg-grid" />
        <div className="auth-bg-glow" />
      </div>

      <div className="auth-card fade-up">
        <div className="auth-logo">
          <span className="auth-logo-icon">⚡</span>
          <span className="auth-logo-text">IUT Cafeteria</span>
        </div>
        <p className="auth-tagline">DevSprint 2026 — Iftar Ordering System</p>

        <div className="auth-tabs">
          <button className={`auth-tab ${mode === 'login' ? 'active' : ''}`} onClick={() => setMode('login')}>Login</button>
          <button className={`auth-tab ${mode === 'register' ? 'active' : ''}`} onClick={() => setMode('register')}>Register</button>
          <div className="auth-tab-indicator" style={{ transform: `translateX(${mode === 'register' ? '100%' : '0'})` }} />
        </div>

        <div className="auth-fields">
          <div className="auth-field">
            <label className="auth-label">Student ID</label>
            <input
              className="input"
              placeholder="210041001"
              value={studentId}
              onChange={e => setStudentId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
          </div>
          <div className="auth-field">
            <label className="auth-label">Password</label>
            <input
              className="input"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
          </div>
        </div>

        <button className="btn btn-primary w-full btn-lg auth-submit" onClick={handleSubmit} disabled={loading}>
          {loading ? <span className="spinner" /> : null}
          {mode === 'login' ? 'Sign In' : 'Create Account'}
        </button>

        <p className="auth-hint">Rate limited to 3 login attempts / minute</p>
      </div>
    </div>
  )
}