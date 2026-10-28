import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/fredoka'
import '@fontsource-variable/nunito'
import '../index.css'
import './landing.css'
import { initStats } from '../analytics'
import { Landing } from './Landing'

initStats() // counts the landing visit (off until a GoatCounter site code is set, and in development)
createRoot(document.getElementById('landing')!).render(<StrictMode><Landing /></StrictMode>)
