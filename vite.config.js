import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Dev-only proxy — production CORS for /litellm/* must be solved at the
  // gateway (allowed_origins) or via an upstream reverse proxy on the admin host.
  server: {
    proxy: {
      '/litellm': {
        target: 'https://testing1.bol7.com',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
