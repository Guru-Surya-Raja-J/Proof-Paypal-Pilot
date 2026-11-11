import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the API runs on :4000 and is proxied, so the app is same-origin
// (session cookie + Server-Sent Events work exactly as in production).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: false }
    }
  }
})
