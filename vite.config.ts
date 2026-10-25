import { readFileSync } from 'node:fs'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

interface PackageJson {
  dependencies?: Record<string, string>
}

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as PackageJson

/**
 * ffmpeg wasm 核心的版本号只在 package.json 里维护一份，
 * 构建期注入前端（__FFMPEG_CORE_VERSION__），避免升级依赖后
 * useFFmpeg.ts 里的常量悄悄漂移，出现「新封装 + 旧核心」的运行时故障。
 */
const ffmpegCoreVersion = (pkg.dependencies?.['@ffmpeg/core'] ?? '')
  .trim()
  .replace(/^[^0-9]*/, '')

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  define: {
    __FFMPEG_CORE_VERSION__: JSON.stringify(ffmpegCoreVersion),
  },
  // @ffmpeg/ffmpeg 内部用 new Worker(new URL('./worker.js', import.meta.url))，
  // 交给 Vite 处理，避免依赖预构建改写 worker 路径。
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
})
