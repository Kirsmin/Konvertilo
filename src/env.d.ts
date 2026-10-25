/// <reference types="vite/client" />

/**
 * 构建期由 vite.config.ts 从 package.json 的 @ffmpeg/core 依赖注入，
 * 供 useFFmpeg.ts 拼接核心 CDN 地址。
 */
declare const __FFMPEG_CORE_VERSION__: string
