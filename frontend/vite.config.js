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
  // Удаляем console.* и debugger из production-сборки (Фаза 5).
  // esbuild drop срабатывает на стадии минификации.
  esbuild: {
    drop: ['console', 'debugger'],
  },
  build: {
    sourcemap: false,
    target: 'es2020',  // современные браузеры — меньше polyfills
    cssCodeSplit: true,
    minify: 'esbuild',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Explicit-list manualChunks — безопаснее чем id-based:
        // Rollup сам резолвит граф зависимостей и не разрывает React ecosystem.
        // (id-based с `id.includes('/react/')` ломал порядок инициализации:
        // createContext оказывался в vendor-other до загрузки vendor-react.)
        // jspdf/xlsx/html5-qrcode НЕ в manualChunks — Rollup сам выделит их
        // в отдельные dynamic chunks, потому что импорт в коде стал async.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-markdown': ['react-markdown', 'remark-gfm', 'rehype-raw'],
          'vendor-misc': ['axios', 'zustand', 'dompurify'],
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
