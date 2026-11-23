import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { useTwin } from './state/store.ts'
import './styles.css'

// Acceso para pruebas automatizadas (capturas y benchmark): solo en builds compilados con
// VITE_TWIN_AUTOMATION=1 (los usa Playwright) y con ?automation=1 en la URL.
if (import.meta.env.VITE_TWIN_AUTOMATION === '1' && new URLSearchParams(location.search).get('automation') === '1') {
  ;(window as unknown as { __twin: typeof useTwin }).__twin = useTwin
}

const root = document.getElementById('root')
if (!root) throw new Error('Falta el elemento #root.')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
