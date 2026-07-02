import { defineConfig } from 'vite'
import path from 'path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // 绕过 vite 8 import-analysis 的 bug：它把 graphology ESM 中名为 import/export 的
      // 类方法（`import(data, merge = false) {}`）误判为动态 import 调用，向方法体注入
      // __vite__injectQuery(data, 'import')，把方法定义破坏成非法语法导致白屏
      // (SyntaxError: Unexpected token '(')。改用 CJS 入口：其方法为 _proto["import"]
      // （quoted key，无 `import(...)` 调用模式）可避开误判；CJS 版功能等价（merge 经
      // arguments 检测，与 ESM 一致），前端也未直接调用 import/export 方法。
      graphology: path.resolve(__dirname, 'node_modules/graphology/dist/graphology.cjs.js')
    }
  },
  server: {
    port: 5173,
    // 前端请求路由到 src/ 后端（默认 http://localhost:8000），
    // 后端转发 /documents、/health、/graphs、/graph 到 LightRAG（localhost:9621）并解析响应。
    proxy: {
      '/documents': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/health': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/graphs': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/graph': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/query': {
        target: 'http://localhost:8000',
        changeOrigin: true
      }
    }
  },
  base: './'
})
