import { useCallback, useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'
import { ApiError, loadWithRecovery } from './api/client'
import { authApi } from './api/endpoints'
import { Brand } from './components/ui/Brand'
import { Central } from './pages/Central'
import LoginPage from './pages/LoginPage'
import type { User } from './types/domain'
import './styles/app.css'
import './styles/live.css'

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [setup, setSetup] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const signOut = useCallback(() => setUser(null), [])

  useEffect(() => loadWithRecovery(
    async signal => {
      const status = await authApi.status(signal)
      if (status.setupRequired) return { setupRequired: true, user: null }
      try {
        return { setupRequired: false, user: await authApi.me(signal) }
      } catch (failure) {
        if (failure instanceof ApiError && failure.status === 401) return { setupRequired: false, user: null }
        throw failure
      }
    },
    result => {
      setSetup(result.setupRequired)
      setUser(result.user)
      setError('')
      setLoading(false)
    },
    failure => {
      setError((failure as Error).message)
      setLoading(false)
    },
  ), [])

  if (loading || error) {
    return (
      <div className="startup">
        <Brand />
        <div>
          {error ? (
            <>
              <WifiOff size={32} />
              <h1>No pudimos conectar con la central</h1>
              <p role="alert">{error}</p>
              <p role="status">La conexión se restablecerá automáticamente.</p>
            </>
          ) : (
            <>
              <span className="spinner" />
              <p>Conectando con tu central…</p>
            </>
          )}
        </div>
      </div>
    )
  }
  return user
    ? <Central user={user} signOut={signOut} />
    : <LoginPage setup={setup} authenticated={setUser} />
}
