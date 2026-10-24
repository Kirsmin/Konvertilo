import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  // @ffmpeg/ffmpeg 内部用 new Worker(new URL('./worker.js', import.meta.url))，
  // 交给 Vite 处理，避免依赖预构建改写 worker 路径。
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
})
