import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/clinika/',
  server: {
    proxy: {
      '/clinika/api': {
        target: 'http://clinika-backend:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace('/clinika/api', '')
      }
    }
  }
})
