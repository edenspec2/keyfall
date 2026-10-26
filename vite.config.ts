import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset paths: the same build works at / (local) and at /keyfall/ (GitHub Pages).
  base: './',
})
