import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    proxy: {
      // В dev: /arc/api → backend; /imed/api → backend (любой slug)
      '/api': {
        target: 'http://clinika-backend:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace('/api', '')
      }
    }
  }
})
