import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fonts are bundled with the build: the central may run on a mine network without internet access.
import '@fontsource-variable/ibm-plex-sans/wdth.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import './styles/index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
