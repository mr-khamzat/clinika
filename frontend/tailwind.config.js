export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        headline: ['Manrope', 'system-ui', 'sans-serif'],
      },
      colors: {
        // ─── Дизайн-система клиниксеть (design-preview-2) ───
        // Все эти цвета подтягиваются из CSS-переменных tokens.css.
        accent: 'var(--accent)',
        'accent-2': 'var(--accent-2)',
        'accent-soft': 'var(--accent-soft)',
        'accent-line': 'var(--accent-line)',
        'accent-fg': 'var(--accent-fg)',
        surface: 'var(--surface)',
        'surface-hi': 'var(--surface-hi)',
        'bg-deep': 'var(--bg-deep)',
        'bg-1': 'var(--bg-1)',
        'bg-2': 'var(--bg-2)',
        'bg-3': 'var(--bg-3)',
        fg: 'var(--fg)',
        'fg-2': 'var(--fg-2)',
        'fg-3': 'var(--fg-3)',
        'fg-4': 'var(--fg-4)',
        good: 'var(--good)',
        'good-soft': 'var(--good-soft)',
        warn: 'var(--warn)',
        'warn-soft': 'var(--warn-soft)',
        bad: 'var(--bad)',
        'bad-soft': 'var(--bad-soft)',
        gold: 'var(--gold)',
        'border-strong': 'var(--border-strong)',

        primary: '#00A7AA',
        'primary-dark': '#00878A',
        success: '#16A34A',
        warning: '#F59E0B',
        // Stitch "Aura Medical OS" palette
        'ms-primary': '#006173',
        'ms-primary-container': '#007c92',
        'ms-surface': '#f8fafb',
        'ms-surface-low': '#f2f4f5',
        'ms-surface-container': '#eceeef',
        'ms-on-surface': '#191c1d',
        'ms-on-surface-variant': '#3e484c',
        'ms-outline': '#6e797c',
        'ms-outline-variant': '#bec8cc',
        clinical: {
          50:  '#E0F7FA',
          100: '#B2EBF2',
          200: '#80DEEA',
          500: '#00ACC1',
          600: '#0097A7',
          700: '#00838F',
          800: '#006064',
          900: '#004D5F',
        },
      },
      borderRadius: {
        'xl': '12px',
        '2xl': '16px',
        // ─── Дизайн-токены ───
        'ks-sm': 'var(--radius-sm)',
        'ks':    'var(--radius)',
        'ks-md': 'var(--radius-md)',
        'ks-lg': 'var(--radius-lg)',
        'ks-xl': 'var(--radius-xl)',
      },
      boxShadow: {
        'ks-sm': 'var(--shadow-sm)',
        'ks-md': 'var(--shadow-md)',
        'ks-lg': 'var(--shadow-lg)',
      },
    }
  },
  plugins: []
}
