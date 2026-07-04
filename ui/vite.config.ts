import { defineConfig } from 'vite'
import path from 'path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const backendProxyTarget = process.env.VITE_BACKEND_PROXY_TARGET || 'http://localhost:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      graphology: path.resolve(__dirname, 'node_modules/graphology/dist/graphology.cjs.js')
    }
  },
  server: {
    port: 5174,
    proxy: {
      '/documents': { target: backendProxyTarget, changeOrigin: true },
      '/health': { target: backendProxyTarget, changeOrigin: true },
      '/graphs': { target: backendProxyTarget, changeOrigin: true },
      '/graph': { target: backendProxyTarget, changeOrigin: true },
      '/mastery': { target: backendProxyTarget, changeOrigin: true },
      '/query': { target: backendProxyTarget, changeOrigin: true },
      '/quiz': { target: backendProxyTarget, changeOrigin: true }
    }
  },
  base: './'
})
