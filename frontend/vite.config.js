import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

// PostCSS: меняет font-display: block → swap для всех @font-face
const fontDisplaySwap = {
  postcssPlugin: 'font-display-swap',
  AtRule: {
    'font-face'(node) {
      // Material Symbols — иконочный шрифт. font-display: block (стандарт для
      // иконок) предотвращает FOIT с показом имени иконки текстом ("lock", "shield").
      let isIconFont = false
      node.walkDecls('font-family', decl => {
        if (/Material Symbols/i.test(decl.value)) isIconFont = true
      })
      if (isIconFont) return
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
    drop: ["debugger"],
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
        // Optim 2026-05-11:
        //  • vendor-sentry — вынесен (грузится только при наличии DSN, ~120KB)
        //  • vendor-axios, vendor-state — отдельно для лучшего кеширования
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // BUGFIX 2026-05-11: react-router-dom и @remix-run/router использовали React.createContext,
            // но попадали в vendor-misc → грузились до vendor-react → "Cannot read properties of undefined (reading 'createContext')".
            if (id.match(/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|react-is|use-sync-external-store)[\\/]/)) return 'vendor-react'
            if (id.match(/[\\/]node_modules[\\/]@remix-run[\\/]router[\\/]/)) return 'vendor-react'
            if (id.includes('react-markdown') || id.includes('remark-') || id.includes('rehype-') || id.includes('micromark') || id.includes('mdast') || id.includes('unified') || id.includes('unist')) return 'vendor-markdown'
            if (id.includes('@sentry')) return 'vendor-sentry'
            if (id.includes('axios')) return 'vendor-axios'
            if (id.includes('zustand')) return 'vendor-state'
            if (id.includes('jspdf') || id.includes('html2canvas')) return 'vendor-pdf'
            if (id.includes('qrcode') || id.includes('html5-qrcode')) return 'vendor-qr'
            if (id.includes('xlsx') || id.includes('papaparse')) return 'vendor-sheets'
            return 'vendor-misc'
          }
          // BUGFIX 2026-05-11: patient-app/staff-app split вызывал TDZ-error
          // ("Cannot access 'z' before initialization") из-за циклических импортов между chunks.
          // Откатили app-split — пусть rollup сам распределит. Vendor split остаётся.
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
