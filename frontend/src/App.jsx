import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { useToast } from './hooks/useToast'
import Toast from './components/Toast'
import AuthPage from './pages/AuthPage'
import StudentPage from './pages/StudentPage'
import AdminPage from './pages/AdminPage'

function ProtectedStudent({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="spinner" /></div>
  if (!user) return <Navigate to="/" replace />
  return children
}

function ProtectedAdmin({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="spinner" /></div>
  if (!user) return <Navigate to="/" replace />
  if (!user.is_admin) return <Navigate to="/student" replace />
  return children
}

function AppInner() {
  const { toasts, toast } = useToast()
  return (
    <>
      <Routes>
        <Route path="/" element={<AuthPage toast={toast} />} />
        <Route path="/student" element={<ProtectedStudent><StudentPage toast={toast} /></ProtectedStudent>} />
        <Route path="/admin" element={<ProtectedAdmin><AdminPage toast={toast} /></ProtectedAdmin>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toast toasts={toasts} />
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </BrowserRouter>
  )
}