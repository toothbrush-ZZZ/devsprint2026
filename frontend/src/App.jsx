import { useState } from 'react'
import AuthPage from './pages/AuthPage'
import StudentPage from './pages/StudentPage'
import AdminPage from './pages/AdminPage'

function App() {
    const [user, setUser] = useState(null)

    if (!user) {
        return <AuthPage onLogin={setUser} />
    }

    if (user.is_admin) {
        return <AdminPage user={user} onLogout={() => setUser(null)} />
    }

    return <StudentPage user={user} onLogout={() => setUser(null)} />
}

export default App
