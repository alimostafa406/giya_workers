import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AppRouter from './routes/AppRouter'
import { LanguageProvider } from './i18n/LanguageContext'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <LanguageProvider><AppRouter /></LanguageProvider>
  </StrictMode>,
)
