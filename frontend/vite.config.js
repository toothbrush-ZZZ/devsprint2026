import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api/identity': { target: 'http://localhost:8001', rewrite: p => p.replace('/api/identity', '') },
      '/api/stock': { target: 'http://localhost:8002', rewrite: p => p.replace('/api/stock', '') },
      '/api/order': { target: 'http://localhost:8003', rewrite: p => p.replace('/api/order', '') },
      '/api/kitchen': { target: 'http://localhost:8004', rewrite: p => p.replace('/api/kitchen', '') },
      '/api/notify': { target: 'http://localhost:8005', rewrite: p => p.replace('/api/notify', '') },
    }
  }
})