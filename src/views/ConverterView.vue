<script setup lang="ts">
import { computed, watch } from 'vue'
import { CONVERTERS, getConverter } from '../config/converters'
import { useTasksStore } from '../stores/tasks'
import { useOutputsStore } from '../stores/outputs'
import { useFFmpeg } from '../composables/useFFmpeg'
import { useConversion } from '../composables/useConversion'
import { isFileAccepted } from '../utils/format'
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
const outputsStore = useOutputsStore()

const { ensureLoaded } = useFFmpeg()
const { startConvert } = useConversion(converter)

watch(
  converter,
  (value) => {
    tasksStore.ensureSeeded(value.path)
    outputsStore.ensureSeeded(value.path)
  },
  { immediate: true },
)

function handleFiles(files: File[]) {
  const config = converter.value
  const accepted = files.filter((file) => isFileAccepted(file, config))
  if (accepted.length === 0) return

  // 真正选择文件之后才下载 ffmpeg 核心
  void ensureLoaded()
  void tasksStore.addFiles(config.path, accepted)
}
</script>

<template>
  <div class="card">
    <ConverterHeader :converter="converter" />
    <InputPane :converter="converter" @files="handleFiles" @start="startConvert" />
    <OutputPane :converter="converter" />

    <footer>
      <span>∮ 转换器<sup>0.1</sup></span>
      <span>·</span>
      <span>Kirsmin 作品</span>
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
