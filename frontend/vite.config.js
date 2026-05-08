import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

// PostCSS: меняет font-display: block → swap для всех @font-face
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
    // sourcemap: true оставлено для отладки prod-крашей W4 компонентов
    sourcemap: true,
    rollupOptions: {
      output: {
        // Vendor splitting — index.js был 1.4MB, разделяем на отдельные кэшируемые чанки
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-router-dom')) return 'vendor-router'
            if (id.includes('react-dom') || id.includes('/react/')) return 'vendor-react'
            if (id.includes('@sentry')) return 'vendor-sentry'
            if (id.includes('jspdf') || id.includes('html5-qrcode') || id.includes('jsqr') || id.includes('dompurify')) return 'vendor-heavy'
            if (id.includes('react-markdown') || id.includes('remark-') || id.includes('rehype-')) return 'vendor-markdown'
            if (id.includes('axios') || id.includes('zustand')) return 'vendor-state'
            return 'vendor-other'
          }
        },
        // Даём фиксированное имя woff2 Material Symbols чтобы preload в index.html работал
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'material-symbols-outlined.woff2' || assetInfo.name === 'material-symbols-rounded.woff2') {
            return 'assets/' + assetInfo.name
          }
          return 'assets/[name]-[hash][extname]'
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
