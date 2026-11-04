import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    // Preserve the browser Host/Origin pair so the API's same-origin guard
    // stays enforced. Vite's string shorthand rewrites Host and breaks POSTs.
    proxy: { '/api': { target: 'http://127.0.0.1:4179', changeOrigin: false } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
