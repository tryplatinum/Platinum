import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ToastProvider } from './components/ui'
import { startSession } from './store/session'
import { startTheme } from './theme'
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/manrope/wght.css'
import './index.css'

startTheme()
startSession()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
)
