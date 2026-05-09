/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f5f6fa',
          100: '#e4e6ee',
          200: '#c7ccdc',
          300: '#9aa1bb',
          400: '#6c7494',
          500: '#4f5778',
          600: '#3d4360',
          700: '#2f3349',
          800: '#1f2230',
          900: '#13151f',
          950: '#0a0b14',
        },
        accent: {
          400: '#7dd3fc',
          500: '#38bdf8',
          600: '#0ea5e9',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
