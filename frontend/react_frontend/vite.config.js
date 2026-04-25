import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/health': 'http://127.0.0.1:8000',
      '/frontend-config': 'http://127.0.0.1:8000',
      '/upload': 'http://127.0.0.1:8000',
      '/chat': 'http://127.0.0.1:8000',
      '/generate-speech': 'http://127.0.0.1:8000',
      '/3dmodel': 'http://127.0.0.1:8000',
    },
  },
})
