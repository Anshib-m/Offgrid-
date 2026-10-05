import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // also listen on the LAN, so phones can open http://<your-ip>:5173
    allowedHosts: true, // dev only: accept VS Code / tunnel hostnames, otherwise Vite answers 403 "Blocked request"
    // Must point at the API (port 4000), never at 5173 itself. 127.0.0.1 rather than "localhost", which can resolve to ::1.
    proxy: { '/api': 'http://127.0.0.1:4000' },
  },
  build: { rollupOptions: { input: { patient: resolve('index.html'), hospital: resolve('hospital/index.html') } } },
})
