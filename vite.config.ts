import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Some upstream deps (webcrack/babel transitively) read `process.env.NODE_ENV` and
// related fields. They never run in production but Vite still tries to evaluate
// them at module load. Provide a minimal shim so the bundle doesn't crash.
//
// SINGLEFILE=1 produces a single self-contained `cipherforge.html` (everything
// inlined, no separate JS/CSS) so non-technical users can double-click it.
const singleFile = process.env.SINGLEFILE === '1';

export default defineConfig({
  plugins: [react(), ...(singleFile ? [viteSingleFile({ removeViteModuleLoader: true })] : [])],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': '{}',
    'process.platform': '"browser"',
    'process.version': '"v22.0.0"',
    global: 'globalThis',
  },
  build: singleFile
    ? {
        chunkSizeWarningLimit: 8000,
        rollupOptions: {
          output: { inlineDynamicImports: true },
        },
      }
    : {
        chunkSizeWarningLimit: 4000,
      },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
