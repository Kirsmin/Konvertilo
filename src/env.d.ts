/// <reference types="vite/client" />

/**
 * 构建期由 vite.config.ts 从 package.json 的 @ffmpeg/core 依赖注入，
 * 供 useFFmpeg.ts 拼接核心 CDN 地址。
 */
declare const __FFMPEG_CORE_VERSION__: string

/** 各 npm 核心包（单线程 core / 多线程 core-mt）分文件的 SHA-256，构建期注入 */
declare const __FFMPEG_CORE_INTEGRITY__: Record<
  'core' | 'core-mt',
  Partial<Record<'ffmpeg-core.js' | 'ffmpeg-core.wasm' | 'ffmpeg-core.worker.js', string>>
>
