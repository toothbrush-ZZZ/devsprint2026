import { useState } from 'react'
import AuthPage from './pages/AuthPage'
import StudentPage from './pages/StudentPage'

function App() {
    const [user, setUser] = useState(null)

    if (!user) {
        return <AuthPage onLogin={setUser} />
    }

    return <StudentPage user={user} onLogout={() => setUser(null)} />
}

export default App
