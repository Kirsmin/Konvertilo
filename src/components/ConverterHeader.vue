<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { CONVERTERS } from '../config/converters'
import type { ConverterConfig } from '../types'
import { useFlash } from '../composables/useFlash'
import { useFFmpeg } from '../composables/useFFmpeg'
import { useUiStore } from '../stores/ui'
import { copyText } from '../utils/format'
import HistoryPopover from './HistoryPopover.vue'

const props = defineProps<{
  converter: ConverterConfig
}>()

const router = useRouter()
const ui = useUiStore()
const { status, progress, done, total, failed, histOpen } = storeToRefs(ui)
const { state: engineState, download } = useFFmpeg()

/** 引擎是否已就绪：首屏还没加载核心时不要谎报「准备就绪」 */
const engineReady = computed(() => engineState.value === 'ready')

/** 错误日志默认折叠：首行说人话，原始日志需要时再展开 */
const showErrorLog = ref(false)
const errorHead = computed(() => ui.errorText.split('\n')[0].trim())
const errorTail = computed(() =>
  ui.errorText.split('\n').slice(1).join('\n').trim(),
)

watch(
  () => ui.errorText,
  () => {
    showErrorLog.value = false
  },
)

/** 处理中的计时：已用时间 + 按进度外推的剩余时间，避免用户盯着百分比干等 */
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null

watch(
  status,
  (value) => {
    if (value === 'processing') {
      now.value = Date.now()
      if (!ticker) {
        ticker = setInterval(() => {
          now.value = Date.now()
        }, 1_000)
      }
      return
    }
    if (ticker) {
      clearInterval(ticker)
      ticker = null
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker)
})

const elapsed = computed(() =>
  ui.startedAt ? Math.max(0, Math.round((now.value - ui.startedAt) / 1000)) : 0,
)
const eta = computed(() => {
  if (status.value !== 'processing' || progress.value < 5) return 0
  return Math.round((elapsed.value * (100 - progress.value)) / progress.value)
})

function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

/** 下载期的体积 / 速度，比百分比更能说明「要不要等」 */
const downloadSize = computed(() => {
  const { received, total, indeterminate } = download.value
  if (!received) return ''
  const done = (received / 1048576).toFixed(1)
  if (indeterminate) return `${done}MB`
  if (!total) return ''
  return `${done}/${(total / 1048576).toFixed(1)}MB`
})
const downloadSpeed = computed(() =>
  download.value.bps > 0
    ? `${(download.value.bps / 1048576).toFixed(2)}MB/s`
    : '',
)

const fromWrap = ref<HTMLElement | null>(null)
const toWrap = ref<HTMLElement | null>(null)
const histWrap = ref<HTMLElement | null>(null)
const openMenu = ref<'from' | 'to' | null>(null)

const TYPE_LABELS: Record<string, string> = {
  Video: '视频',
  Audio: '音频',
}

const fromOptions = computed(() => [
  ...new Set(CONVERTERS.map((item) => item.from)),
])

const toOptions = computed(() =>
  CONVERTERS.filter((item) => item.from === props.converter.from).map(
    (item) => item.to,
  ),
)

const { text: copyLabel, flash: flashCopied } = useFlash('复制错误信息', '已复制 ✓')

function typeLabel(type: string) {
  return TYPE_LABELS[type] ?? type
}

function toggleMenu(menu: 'from' | 'to') {
  openMenu.value = openMenu.value === menu ? null : menu
  histOpen.value = false
}

function toggleHistory() {
  ui.toggleHistory()
  openMenu.value = null
}

function pushConverter(from: string, to: string) {
  const converter = CONVERTERS.find(
    (item) => item.from === from && item.to === to,
  )
  if (converter && converter.path !== props.converter.path) {
    void router.push(converter.path)
  }
}

function chooseFrom(from: string) {
  const availableTargets = CONVERTERS.filter((item) => item.from === from).map(
    (item) => item.to,
  )
  const to = availableTargets.includes(props.converter.to)
    ? props.converter.to
    : availableTargets[0]

  openMenu.value = null
  pushConverter(from, to)
}

function chooseTo(to: string) {
  openMenu.value = null
  pushConverter(props.converter.from, to)
}

async function copyError() {
  await copyText(ui.errorText)
  flashCopied()
}

function onDocumentClick(event: MouseEvent) {
  const target = event.target as Node | null
  if (!target) return

  if (
    openMenu.value &&
    fromWrap.value &&
    toWrap.value &&
    !fromWrap.value.contains(target) &&
    !toWrap.value.contains(target)
  ) {
    openMenu.value = null
  }

  if (histOpen.value && histWrap.value && !histWrap.value.contains(target)) {
    histOpen.value = false
  }
}

watch(
  () => props.converter.path,
  () => {
    openMenu.value = null
    histOpen.value = false
  },
)

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
})
</script>

<template>
  <header class="card-header">
    <h1 class="logo">
      <span class="mark">∮</span>
      <span class="type-picker">
        <span ref="fromWrap" class="type-wrap">
          <button
            type="button"
            class="type-btn"
            :class="{ active: openMenu === 'from' }"
            aria-haspopup="menu"
            :aria-expanded="openMenu === 'from'"
            @click="toggleMenu('from')"
          >
            {{ typeLabel(converter.from) }}
          </button>
          <div
            v-if="openMenu === 'from'"
            class="type-menu"
            role="menu"
            aria-label="选择来源类型"
          >
            <ul>
              <li v-for="from in fromOptions" :key="from">
                <button
                  type="button"
                  class="menu-item"
                  :class="{ sel: from === converter.from }"
                  role="menuitem"
                  @click="chooseFrom(from)"
                >
                  {{ typeLabel(from) }}
                </button>
              </li>
            </ul>
          </div>
        </span>
        <span class="arrow">→</span>
        <span ref="toWrap" class="type-wrap">
          <button
            type="button"
            class="type-btn"
            :class="{ active: openMenu === 'to' }"
            aria-haspopup="menu"
            :aria-expanded="openMenu === 'to'"
            @click="toggleMenu('to')"
          >
            {{ typeLabel(converter.to) }}
          </button>
          <div
            v-if="openMenu === 'to'"
            class="type-menu"
            role="menu"
            aria-label="选择目标类型"
          >
            <ul>
              <li v-for="to in toOptions" :key="to">
                <button
                  type="button"
                  class="menu-item"
                  :class="{ sel: to === converter.to }"
                  role="menuitem"
                  @click="chooseTo(to)"
                >
                  {{ typeLabel(to) }}
                </button>
              </li>
            </ul>
          </div>
        </span>
      </span>
    </h1>

    <div class="status" aria-live="polite">
      <template v-if="status === 'idle'">
        <template v-if="engineReady">
          <span class="ok">✓</span> 准备就绪
        </template>
        <template v-else>
          <span class="idle-hint">选择文件后加载引擎（首次约 32MB）</span>
        </template>
      </template>
      <template v-else-if="status === 'downloading'">
        ↓ 下载引擎中<template v-if="!download.indeterminate">({{ progress }}%)</template>
        <span v-if="downloadSize" class="dl-detail">
          {{ downloadSize }}<template v-if="downloadSpeed"> · {{ downloadSpeed }}</template>
        </span>
        <span class="bar" :class="{ moving: download.indeterminate }">
          <i :style="download.indeterminate ? undefined : { width: `${progress}%` }"></i>
        </span>
      </template>
      <template v-else-if="status === 'error'">
        <span class="er">✗</span> 错误
        <span v-if="failed" class="err-count">（失败 {{ failed }}/{{ total }}）</span>
      </template>
      <template v-else-if="status === 'processing'">
        <span class="spin">✳︎</span> 处理中({{ done }}/{{ total }} · {{ progress }}%)
        <span class="timing">
          {{ clock(elapsed) }}<template v-if="eta"> / 预计还需 {{ clock(eta) }}</template>
        </span>
        <span class="bar"><i :style="{ width: `${progress}%` }"></i></span>
      </template>
    </div>

    <div ref="histWrap" class="hist-wrap" :class="{ open: histOpen }">
      <button type="button" class="btn" @click="toggleHistory">历史</button>
      <HistoryPopover v-if="histOpen" />
    </div>

    <div v-if="status === 'error' && ui.errorText" class="errbox" role="alert">
      <div class="errhead">
        <span>错误详情</span>
        <span class="erractions">
          <button
            v-if="errorTail"
            type="button"
            class="btn"
            :aria-expanded="showErrorLog"
            @click="showErrorLog = !showErrorLog"
          >
            {{ showErrorLog ? '收起日志' : '查看日志' }}
          </button>
          <button type="button" class="btn" @click="copyError">
            {{ copyLabel }}
          </button>
          <button
            type="button"
            class="btn errclose"
            title="关闭错误信息"
            aria-label="关闭错误信息"
            @click="ui.dismissError()"
          >
            ✗
          </button>
        </span>
      </div>
      <p class="errmsg">{{ errorHead }}</p>
      <pre v-if="showErrorLog && errorTail" class="errbody">{{ errorTail }}</pre>
    </div>

    <div v-if="status !== 'error' && ui.warnText" class="warnbox">
      <div class="warnhead">
        <span>提示</span>
        <button
          type="button"
          class="btn warnclose"
          title="关闭提示"
          aria-label="关闭提示"
          @click="ui.dismissWarn()"
        >
          ✗
        </button>
      </div>
      <pre class="warnbody">{{ ui.warnText }}</pre>
    </div>
  </header>
</template>

<style scoped>
.card-header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 12px;
  align-items: baseline;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--line);
}

.logo {
  justify-self: start;
  display: flex;
  gap: 6px;
  align-items: baseline;
  font-size: 15px;
  font-weight: 400;
  letter-spacing: 0.5px;
}

.mark {
  color: var(--ink);
}

.type-picker {
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
}

.type-wrap {
  position: relative;
  display: inline-block;
}

.type-btn {
  font: inherit;
  font-weight: 400;
  letter-spacing: inherit;
  color: inherit;
  padding: 0 1px;
  border-bottom: 1px dashed var(--dash);
}

.type-btn:hover,
.type-btn.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

.arrow {
  color: var(--muted);
  font-weight: 400;
}

.type-menu {
  position: absolute;
  top: calc(100% + 5px);
  left: 0;
  width: max-content;
  min-width: 76px;
  max-width: calc(100vw - 44px);
  background: var(--card);
  border: 1px solid var(--line);
  padding: 2px;
  z-index: 70;
  text-align: left;
  font-weight: 400;
}

.type-menu ul {
  list-style: none;
}

.menu-item {
  display: block;
  width: 100%;
  padding: 3px 7px;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.4;
  text-align: left;
  border-bottom: 1px dashed var(--line);
}

.type-menu li:last-child .menu-item {
  border-bottom: 0;
}

.menu-item.sel {
  color: var(--accent);
  background: transparent;
}

.menu-item:hover {
  background: var(--sel);
}

.status {
  justify-self: center;
  color: var(--muted);
  font-size: 13px;
  display: flex;
  gap: 8px;
  align-items: center;
  white-space: nowrap;
}

.status .ok {
  color: var(--accent);
}

.status .er {
  color: var(--err);
}

.errbox,
.warnbox {
  grid-column: 1 / -1;
  margin-top: 10px;
  border: 1px dashed currentColor;
}

.errbox {
  color: var(--err);
}

.errmsg {
  margin: 0;
  padding: 6px 8px;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.err-count,
.dl-detail,
.timing,
.idle-hint {
  color: var(--muted);
  font-size: 11px;
  margin-left: 2px;
}

.warnbox {
  color: var(--warn);
  margin-top: 8px;
}

.errhead,
.warnhead {
  display: flex;
  gap: 10px;
  align-items: baseline;
  justify-content: space-between;
  padding: 4px 8px 3px;
  border-bottom: 1px dashed currentColor;
  font-size: 12px;
}

.erractions {
  display: flex;
  gap: 12px;
  align-items: baseline;
}

.errclose,
.warnclose {
  padding: 0 3px;
  line-height: 1.2;
}

.errbody,
.warnbody {
  margin: 0;
  padding: 7px 8px;
  max-height: 132px;
  overflow: auto;
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.bar {
  display: inline-block;
  width: 10ch;
  height: 0.55em;
  border: 1px dashed var(--dash);
  vertical-align: middle;
}

.bar i {
  display: block;
  height: 100%;
  background: var(--accent);
}

/* 总大小未知（CDN 压缩响应）时用不定态进度条，而不是假装 98% 卡住 */
.bar.moving i {
  width: 38%;
  animation: bar-move 1.1s ease-in-out infinite;
}

@keyframes bar-move {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(280%);
  }
}

.spin {
  display: inline-block;
  animation: sp 6.5s linear infinite;
}

@keyframes sp {
  0% {
    transform: rotate(0);
  }
  76.9% {
    transform: rotate(1080deg);
  }
  100% {
    transform: rotate(1080deg);
  }
}

.hist-wrap {
  justify-self: end;
  position: relative;
}

.hist-wrap.open > .btn {
  border-bottom-style: solid;
}

@media (min-width: 721px) {
  .logo {
    font-size: 20px;
  }

  .type-picker {
    gap: 9px;
  }

  .type-menu {
    min-width: 96px;
    padding: 4px;
  }

  .menu-item {
    padding: 5px 10px;
    font-size: 14px;
    line-height: 1.5;
  }

  .status {
    font-size: 14px;
  }
}

@media (max-width: 720px) {
  .card-header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    row-gap: 2px;
    padding-bottom: 10px;
  }

  .status {
    order: 3;
    width: 100%;
    justify-content: flex-start;
    white-space: normal;
    flex-wrap: wrap;
  }

  /* 手机上错误面板限高，避免一条报错刷满整屏 */
  .errbox,
  .warnbox {
    order: 4;
    flex-basis: 100%;
    margin-top: 8px;
  }

  .errhead,
  .warnhead {
    padding: 3px 7px;
    font-size: 11px;
  }

  .errbody,
  .warnbody {
    max-height: 88px;
    padding: 6px 7px;
    font-size: 11px;
  }
}
</style>
