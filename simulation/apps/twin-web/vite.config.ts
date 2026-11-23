import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Puerto 5180: 5173 es la web de operaciones y 5174 lo usan sus pruebas E2E.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': { target: process.env.MINING_API_TARGET ?? 'http://localhost:5080', changeOrigin: true },
      '/hubs': { target: process.env.MINING_API_TARGET ?? 'http://localhost:5080', changeOrigin: true, ws: true },
    },
  },
  preview: { host: '127.0.0.1', port: 5181, strictPort: true },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
})
