<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { CONVERTERS } from '../config/converters'
import type { ConverterConfig } from '../types'
import { useFlash } from '../composables/useFlash'
import { useUiStore } from '../stores/ui'
import { copyText } from '../utils/format'
import HistoryPopover from './HistoryPopover.vue'

const props = defineProps<{
  converter: ConverterConfig
}>()

const router = useRouter()
const ui = useUiStore()
const { status, progress, done, total, histOpen } = storeToRefs(ui)

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
        <span class="ok">✓</span> 准备就绪
      </template>
      <template v-else-if="status === 'downloading'">
        ↓ 下载引擎中({{ progress }}%)
        <span class="bar"><i :style="{ width: `${progress}%` }"></i></span>
      </template>
      <template v-else-if="status === 'error'">
        <span class="er">✗</span> 错误
        <button type="button" class="btn" @click="copyError">
          {{ copyLabel }}
        </button>
      </template>
      <template v-else-if="status === 'processing'">
        <span class="spin">✳︎</span> 处理中({{ done }}/{{ total }} · {{ progress }}%)
        <span class="bar"><i :style="{ width: `${progress}%` }"></i></span>
      </template>
    </div>

    <div ref="histWrap" class="hist-wrap" :class="{ open: histOpen }">
      <button type="button" class="btn" @click="toggleHistory">历史</button>
      <HistoryPopover v-if="histOpen" />
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
}
</style>
