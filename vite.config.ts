import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Some upstream deps (webcrack/babel transitively) read `process.env.NODE_ENV` and
// related fields. They never run in production but Vite still tries to evaluate
// them at module load. Provide a minimal shim so the bundle doesn't crash.
export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': '{}',
    'process.platform': '"browser"',
    'process.version': '"v22.0.0"',
    global: 'globalThis',
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
