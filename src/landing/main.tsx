import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/fredoka'
import '@fontsource-variable/nunito'
import '../index.css'
import './landing.css'
import { Landing } from './Landing'

createRoot(document.getElementById('landing')!).render(<StrictMode><Landing /></StrictMode>)
