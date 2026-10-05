import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:4000' } },
  build: { rollupOptions: { input: { patient: resolve('index.html'), hospital: resolve('hospital/index.html') } } },
})
