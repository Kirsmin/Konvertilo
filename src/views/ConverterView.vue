<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CONVERTERS, getConverter } from '../config/converters'
import { useTasksStore } from '../stores/tasks'
import { useUiStore } from '../stores/ui'
import { useFFmpeg } from '../composables/useFFmpeg'
import { useConversion } from '../composables/useConversion'
import { fileExtension, isFileAccepted } from '../utils/format'
import { UNKNOWN_DURATION } from '../utils/media'
import { OVERSIZE_HINT, recommendedFileSize } from '../utils/limit'
import ConverterHeader from '../components/ConverterHeader.vue'
import InputPane from '../components/InputPane.vue'
import OutputPane from '../components/OutputPane.vue'

const props = defineProps<{
  from: string
  to: string
}>()

const converter = computed(
  () => getConverter(props.from, props.to) ?? CONVERTERS[0],
)

const tasksStore = useTasksStore()
const ui = useUiStore()

/** 拖入不支持的文件时，交给输入区中央显示，不使用顶部提示 */
const skipNotice = ref('')
/** 按当前设备的可用内存 / 堆上限估算；只用于提示，不阻止转换 */
const sizeLimit = recommendedFileSize()

const { ensureLoaded, probeMetadata, mode: engineMode, threads: engineThreads } = useFFmpeg()
const { startConvert, stop } = useConversion(converter)

watch(
  converter,
  () => {
    skipNotice.value = ''
    ui.warnText = ''
  },
  { immediate: true },
)

/** 形如「> ! 不支持 .mp3 格式，已跳过 1 个文件 ! <」 */
function describeSkipped(skipped: File[]): string {
  const extensions = [
    ...new Set(skipped.map((file) => fileExtension(file.name)).filter(Boolean)),
  ]
  const clause = extensions.length
    ? `不支持 ${extensions.slice(0, 3).map((ext) => `.${ext}`).join('、')} 格式`
    : '不支持该文件格式'
  return `> ! ${clause}，已跳过 ${skipped.length} 个文件 ! <`
}

/**
 * 浏览器原生解不出的容器（wma / ac3 / ts / flv）入队时只有「—」，
 * 等引擎就绪后用 ffmpeg 读一次文件头把真实时长补上。
 */
async function enrichDurations(path: string) {
  const targets = tasksStore
    .forPath(path)
    .filter((task) => task.duration === UNKNOWN_DURATION && task.file)
  if (targets.length === 0) return
  await ensureLoaded()
  for (const task of targets) {
    if (!task.file) continue
    const duration = await probeMetadata(task.file)
    if (duration) tasksStore.setDuration(task.id, duration)
  }
}

function handleFiles(files: File[]) {
  const config = converter.value
  const accepted: File[] = []
  const skipped: File[] = []

  for (const file of files) {
    if (isFileAccepted(file, config)) accepted.push(file)
    else skipped.push(file)
  }

  // 重新选文件时清掉上一轮的错误，避免「错误」状态一直挂着
  if (ui.status === 'error') {
    ui.status = 'idle'
    ui.errorText = ''
  }

  skipNotice.value = skipped.length ? describeSkipped(skipped) : ''
  if (accepted.length === 0) return

  // 只提示，不拦截：真的跑不动时 ffmpeg 会报「文件尺寸过大」
  const oversized = accepted.filter((file) => file.size > sizeLimit)
  ui.warnText = oversized
    .map((file) => `${file.name}: ${OVERSIZE_HINT}`)
    .join('\n')

  // 真正选择文件之后才下载 ffmpeg 核心
  void ensureLoaded()
  void tasksStore
    .addFiles(config.path, accepted)
    .then(() => enrichDurations(config.path))
}
</script>

<template>
  <div class="card">
    <ConverterHeader :converter="converter" />
    <InputPane
      :converter="converter"
      :skip-notice="skipNotice"
      @files="handleFiles"
      @start="startConvert()"
      @stop="stop({ notify: true })"
      @retry="startConvert([$event])"
    />
    <OutputPane :converter="converter" />

    <footer>
      <span>∮ 转换器<sup>0.1</sup></span>
      <span>·</span>
      <span>Kirsmin 作品</span>
      <span>·</span>
      <span
        class="engine"
        :title="
          engineMode === 'multi'
            ? `已启用多线程编码（${engineThreads} 线程），按设备性能自动调整`
            : '当前设备或浏览器不支持多线程编码，使用单线程引擎'
        "
      >
        {{ engineMode === 'multi' ? `多线程 ×${engineThreads}` : '单线程' }}
      </span>
      <span>·</span>
      <a class="btn" href="/privacy" target="_blank" rel="noopener">使用条款</a>
    </footer>
  </div>
</template>

<style scoped>
.card {
  max-width: 920px;
  margin: 28px auto;
  padding: 22px 26px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 0;
  box-shadow: none;
}

footer {
  margin-top: 18px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

footer sup {
  font-size: 9px;
}

footer .engine {
  color: var(--accent);
}

@media (min-width: 1024px) {
  .card {
    max-width: 1080px;
    margin: 36px auto;
    padding: 28px 34px;
  }

  footer {
    margin-top: 22px;
    padding-top: 14px;
    font-size: 13px;
  }

  footer sup {
    font-size: 10px;
  }
}

@media (max-width: 720px) {
  .card {
    margin: 10px;
    padding: 14px 12px;
  }
}
</style>
