import { defineConfig } from 'vite'
import path from 'path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      graphology: path.resolve(__dirname, 'node_modules/graphology/dist/graphology.cjs.js')
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/documents': {
        target: 'http://backend:8000',
        changeOrigin: true
      },
      '/health': {
        target: 'http://backend:8000',
        changeOrigin: true
      },
      '/graphs': {
        target: 'http://backend:8000',
        changeOrigin: true
      },
      '/graph': {
        target: 'http://backend:8000',
        changeOrigin: true
      },
      '/query': {
        target: 'http://backend:8000',
        changeOrigin: true
      }
    }
  },
  base: './'
})
