import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: process.env.MINING_API_TARGET ?? 'http://localhost:5080', changeOrigin: true },
      '/hubs': { target: process.env.MINING_API_TARGET ?? 'http://localhost:5080', changeOrigin: true, ws: true },
      '/health': { target: process.env.MINING_API_TARGET ?? 'http://localhost:5080', changeOrigin: true },
    },
  },
})
