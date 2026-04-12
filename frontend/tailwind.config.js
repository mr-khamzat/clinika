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
      }
    }
  },
  plugins: []
}
