<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ConverterConfig } from '../types'
import { useTasksStore } from '../stores/tasks'
import { useUiStore } from '../stores/ui'
import TaskRow from './TaskRow.vue'

const props = defineProps<{
  converter: ConverterConfig
  /** 不支持的文件提示，直接显示在输入区中央 */
  skipNotice?: string
}>()

const emit = defineEmits<{
  files: [files: File[]]
  start: []
  stop: []
}>()

const tasksStore = useTasksStore()
const ui = useUiStore()
const fileInput = ref<HTMLInputElement | null>(null)
const dragging = ref(false)

const tasks = computed(() => tasksStore.forPath(props.converter.path))
const selectedIds = computed(() => tasksStore.selectedForPath(props.converter.path))
const allSelected = computed(() => tasksStore.allSelected(props.converter.path))

function openPicker() {
  if (!fileInput.value) return
  fileInput.value.value = ''
  fileInput.value.click()
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  if (files.length) emit('files', files)
  input.value = ''
}

// 整个页面都是拖放区域，而不只是输入框
let dragDepth = 0

function hasFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

function onDragEnter(event: DragEvent) {
  if (!hasFiles(event)) return
  event.preventDefault()
  dragDepth += 1
  dragging.value = true
}

function onDragOver(event: DragEvent) {
  if (!hasFiles(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onDragLeave(event: DragEvent) {
  // 不在 dragleave 时检查 types：部分浏览器此时 types 已为空，会导致拖拽态卡住
  // relatedTarget 为空表示已离开窗口，直接复位
  if (event.relatedTarget === null) {
    dragDepth = 0
    dragging.value = false
    return
  }
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dragging.value = false
}

function onDrop(event: DragEvent) {
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (!files.length) return
  event.preventDefault()
  dragDepth = 0
  dragging.value = false
  emit('files', files)
}

onMounted(() => {
  window.addEventListener('dragenter', onDragEnter)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('drop', onDrop)
})

onBeforeUnmount(() => {
  window.removeEventListener('dragenter', onDragEnter)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('drop', onDrop)
})
</script>

<template>
  <section class="pane" :class="{ dragging }">
    <div id="inHead" class="pane-head">
      <span class="pane-title">↑ 输入<span class="count">×{{ tasks.length }}</span></span>
      <span v-if="tasks.length" class="toolbar">
        <button type="button" class="btn actionable" @click="tasksStore.selectAll(converter.path)">
          {{ allSelected ? '取消全选' : '全选' }}
        </button>
        <button type="button" class="btn actionable" @click="openPicker">上传</button>
        <button
          v-if="selectedIds.length"
          type="button"
          class="btn actionable"
          @click="tasksStore.clearSelectionForPath(converter.path)"
        >
          ✗ 取消选中任务
        </button>
      </span>
      <span class="actions">
        <button
          v-if="ui.status === 'processing'"
          type="button"
          class="btn actionable stop"
          @click="emit('stop')"
        >
          ■ 停止
        </button>
        <button
          v-if="tasks.length"
          type="button"
          class="btn actionable start"
          @click="emit('start')"
        >
          开始转换 -&gt;
        </button>
      </span>
    </div>

    <ul id="inList" class="rows">
      <TaskRow
        v-for="task in tasks"
        :key="task.id"
        :task="task"
        :converter="converter"
        :selected="selectedIds.includes(task.id)"
        @toggle="tasksStore.toggleSelected(task.id)"
      />
    </ul>

    <div v-if="!tasks.length" class="empty">
      <template v-if="skipNotice">
        <p class="skip">{{ skipNotice }}</p>
        <button type="button" class="btn actionable retry" @click="openPicker">
          重新选择文件
        </button>
      </template>
      <button v-else type="button" class="btn actionable" @click="openPicker">
        上传或拖入文件
      </button>
    </div>

    <p v-else-if="skipNotice" class="skip list-skip">{{ skipNotice }}</p>

    <input
      ref="fileInput"
      class="file-input"
      type="file"
      :accept="converter.accept"
      multiple
      @change="onFileChange"
    />
  </section>

  <Teleport to="body">
    <div v-if="dragging" class="drop-overlay" aria-hidden="true">
      &gt; 松开以导入文件 &lt;
    </div>
  </Teleport>
</template>

<style scoped>
.file-input {
  display: none;
}

.actions {
  margin-left: auto;
  display: inline-flex;
  gap: 14px;
  align-items: baseline;
}

.actions .start {
  margin-left: 0;
}

.stop {
  color: var(--err);
}

.skip {
  color: var(--err);
  font-size: 13px;
  letter-spacing: 0.5px;
}

.empty .skip {
  margin-bottom: 8px;
}

.retry {
  color: var(--muted);
  font-size: 12px;
}

.list-skip {
  padding: 6px 4px 0;
}

@media (min-width: 721px) {
  .skip {
    font-size: 14px;
  }

  .retry {
    font-size: 13px;
  }
}

.drop-overlay {
  position: fixed;
  inset: 8px;
  z-index: 100;
  display: grid;
  place-items: center;
  pointer-events: none;
  user-select: none;
  border: 1px solid var(--accent);
  color: var(--accent);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 1px;
}
</style>
