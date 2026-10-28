import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useHistoryStore } from './stores/history'
import './style.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

// 初始化历史 store：首次进入为空，之后从 localStorage 恢复
useHistoryStore()

app.mount('#app')

/**
 * 预取 ffmpeg 封装的动态 import 分包（@ffmpeg/ffmpeg ~3KB / @ffmpeg/util ~0.6KB）。
 * 这两个包只在首次转换时才被动态加载：不预取时，离线状态下首次转换
 * 必然因拉不到分包而失败，还会把内部 chunk 路径暴露给报错信息。
 * 趁在线时（页面加载后空闲阶段）提前拉进 HTTP 缓存与模块表，
 * 之后的首次转换离线也能完成；拉取失败静默忽略（转换层有友好兜底提示）。
 */
function warmEngineModules() {
  void import('@ffmpeg/ffmpeg').catch(() => {
    /* 离线/预取失败由转换层给出友好提示 */
  })
  void import('@ffmpeg/util').catch(() => {
    /* 同上 */
  })
}

if (typeof window.requestIdleCallback === 'function') {
  window.requestIdleCallback(() => warmEngineModules(), { timeout: 4000 })
} else {
  window.setTimeout(warmEngineModules, 1500)
}
