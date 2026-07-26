import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // The Live Numbers section reads the demo panel's own /api/earnings. Proxying
    // it here keeps the landing page same-origin in development, so the backend
    // needs no CORS header and none of its routes change. With the panel not
    // running the fetch just fails and the section says so — see useLiveStats.
    proxy: {
      '/api': {
        target: 'http://localhost:4100',
        changeOrigin: true,
      },
    },
  },
})
