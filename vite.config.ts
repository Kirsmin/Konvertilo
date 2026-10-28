import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

/**
 * 核心完整性校验：对本地 node_modules 里的核心文件计算 SHA-256，
 * 构建期注入前端。运行时每从 CDN 拉到一个文件都按哈希核对，
 * 任何一个镜像返回被篡改 / 截断的内容都会换源重试，全部不符则明确报错。
 * 哈希与版本同源（都来自 package.json 锁定的包），不会出现版本与哈希漂移。
 */
type CorePackage = 'core' | 'core-mt'
type CoreFile = 'ffmpeg-core.js' | 'ffmpeg-core.wasm' | 'ffmpeg-core.worker.js'

function coreIntegrity(): Record<CorePackage, Partial<Record<CoreFile, string>>> {
  const root = fileURLToPath(new URL('./node_modules/@ffmpeg', import.meta.url))
  const files: CoreFile[] = [
    'ffmpeg-core.js',
    'ffmpeg-core.wasm',
    'ffmpeg-core.worker.js',
  ]
  const hashes: Record<CorePackage, Partial<Record<CoreFile, string>>> = {
    core: {},
    'core-mt': {},
  }
  for (const pack of ['core', 'core-mt'] as CorePackage[]) {
    for (const file of files) {
      const path = `${root}/${pack}/dist/esm/${file}`
      // 单线程核心没有 worker 文件，跳过即可
      if (!existsSync(path)) continue
      const bytes = readFileSync(path)
      hashes[pack][file] = createHash('sha256').update(bytes).digest('hex')
    }
  }
  return hashes
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  define: {
    __FFMPEG_CORE_VERSION__: JSON.stringify(ffmpegCoreVersion),
    __FFMPEG_CORE_INTEGRITY__: JSON.stringify(coreIntegrity()),
  },
  // @ffmpeg/ffmpeg 内部用 new Worker(new URL('./worker.js', import.meta.url))，
  // 交给 Vite 处理，避免依赖预构建改写 worker 路径。
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
})
