import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

// PostCSS плагин: меняет font-display: block → swap для всех @font-face
// Иконки material-symbols теперь не блокируют отрисовку страницы
const fontDisplaySwap = {
  postcssPlugin: 'font-display-swap',
  AtRule: {
    'font-face'(node) {
      node.walkDecls('font-display', decl => {
        if (decl.value === 'block') decl.value = 'swap'
      })
    }
  }
}

export default defineConfig({
  plugins: [react()],
  base: '/',
  css: {
    postcss: {
      plugins: [
        tailwindcss(),
        autoprefixer(),
        fontDisplaySwap,
      ]
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom')) return 'react'
            if (id.includes('axios')) return 'axios'
            if (id.includes('react')) return 'react'
            return 'vendor'
          }
        }
      }
    }
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://clinika-backend:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace('/api', '')
      }
    }
  }
})
