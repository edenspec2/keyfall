import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset paths: the same build works at / (local) and at /keyfall/ (GitHub Pages).
  base: './',
  // Two pages: the app, and the landing page with its playable demo at welcome/.
  build: { rolldownOptions: { input: { main: 'index.html', welcome: 'welcome/index.html' } } },
})
