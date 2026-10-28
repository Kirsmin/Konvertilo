<script setup lang="ts">
import { computed } from 'vue'
import type { ConverterConfig } from '../types'
import { useOutputsStore } from '../stores/outputs'
import OutputRow from './OutputRow.vue'

const props = defineProps<{
  converter: ConverterConfig
}>()

const outputsStore = useOutputsStore()
const outputs = computed(() => outputsStore.forPath(props.converter.path))
const selectedIds = computed(() =>
  outputs.value
    .filter((output) => outputsStore.selectedIds.includes(output.id))
    .map((output) => output.id),
)
const allSelected = computed(() => outputsStore.allSelected(props.converter.path))
</script>

<template>
  <section class="pane">
    <div id="outHead" class="pane-head">
      <span class="pane-title">↓ 输出<span class="count">×{{ outputs.length }}</span></span>
      <span v-if="outputs.length" class="toolbar">
        <button type="button" class="btn actionable" @click="outputsStore.selectAll(converter.path)">
          {{ allSelected ? '取消全选' : '全选' }}
        </button>
        <button
          v-if="outputs.length > 1"
          type="button"
          class="btn actionable"
          title="逐个下载当前全部产物（浏览器可能询问是否允许批量下载）"
          @click="outputsStore.downloadAll(converter.path)"
        >
          ↓ 全部下载
        </button>
        <button
          v-if="selectedIds.length"
          type="button"
          class="btn actionable"
          @click="outputsStore.removeSelected(converter.path)"
        >
          ✗ 删除
        </button>
      </span>
    </div>

    <ul id="outList" class="rows">
      <OutputRow
        v-for="output in outputs"
        :key="output.id"
        :output="output"
        :converter="converter"
        :selected="selectedIds.includes(output.id)"
        @toggle="outputsStore.toggleSelected(output.id)"
      />
    </ul>

    <div v-if="!outputs.length" class="empty">/</div>
  </section>
</template>
