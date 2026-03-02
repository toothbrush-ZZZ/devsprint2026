import { createContext, useContext, useState, useEffect } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    const student_id = localStorage.getItem('student_id')
    const is_admin = localStorage.getItem('is_admin') === 'true'
    if (token && student_id) setUser({ token, student_id, is_admin })
    setLoading(false)
  }, [])

  const login = (data) => {
    localStorage.setItem('access_token', data.access_token)
    localStorage.setItem('refresh_token', data.refresh_token)
    localStorage.setItem('student_id', data.student_id)
    localStorage.setItem('is_admin', String(data.is_admin))
    setUser({ token: data.access_token, student_id: data.student_id, is_admin: data.is_admin })
  }

  const logout = () => {
    localStorage.clear()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)