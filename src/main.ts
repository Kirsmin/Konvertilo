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
