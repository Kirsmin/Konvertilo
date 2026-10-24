<script setup lang="ts">
import type { OutputItem } from '../types'
import { useFlash } from '../composables/useFlash'
import SelectRow from './SelectRow.vue'

const props = defineProps<{
  output: OutputItem
  selected: boolean
}>()

const emit = defineEmits<{
  toggle: []
}>()

const { text: downloadLabel, flash: flashDownloaded } = useFlash('↓ 下载', '✓ 已下载')

function download() {
  const blob = props.output.blob
  if (!blob) {
    // 示例数据等无真实产物的兜底：保持原有闪字行为
    flashDownloaded()
    return
  }

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = props.output.name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // 浏览器开始下载后再释放 ObjectURL
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  flashDownloaded()
}
</script>

<template>
  <SelectRow :selected="selected" @toggle="emit('toggle')">
    <div class="line1">
      <span class="fname">{{ output.name }}</span>
      <span class="mmeta">
        <span class="fmt">{{ output.format }}</span>
      </span>
      <button type="button" class="btn actionable dl" @click="download">
        {{ downloadLabel }}
      </button>
    </div>
    <div class="line2" :data-fmt="output.format">
      <span class="meta">{{ output.duration }}</span>
      <span class="meta">{{ output.sizeLabel }}</span>
      <span class="meta">{{ output.quality }} · 编码器 {{ output.encoder }}</span>
    </div>
  </SelectRow>
</template>

<style scoped>
.line1 {
  display: flex;
  gap: 10px;
  align-items: baseline;
  flex-wrap: wrap;
}

.mmeta {
  display: contents;
}

.fname {
  max-width: 34ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fmt {
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 0.5px;
}

.meta {
  color: var(--muted);
  font-size: 12px;
}

.line2 {
  color: var(--muted);
  font-size: 12px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 2px;
}

@media (min-width: 721px) {
  .fname {
    max-width: 42ch;
  }

  .fmt {
    font-size: 12px;
  }

  .meta {
    font-size: 13px;
  }

  .line2 {
    gap: 12px;
    font-size: 14px;
  }
}

@media (max-width: 720px) {
  .line1 .mmeta {
    display: none;
  }

  .line1 .fname {
    flex: 1 1 auto;
    min-width: 0;
    max-width: none;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .line1 .dl {
    margin-left: auto;
    flex: none;
  }

  .line2 {
    gap: 6px 12px;
  }

  .line2::before {
    content: attr(data-fmt);
    color: var(--muted);
    font-size: 11px;
    letter-spacing: 0.5px;
  }
}
</style>
