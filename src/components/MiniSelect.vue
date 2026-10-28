<script setup lang="ts">
const props = defineProps<{
  modelValue: string
  options: string[]
  title?: string
  topHint?: string
  optionHints?: Record<string, string>
}>()

const emit = defineEmits<{
  change: [value: string]
}>()

function optionLabel(option: string) {
  const hint = props.optionHints?.[option]
  return hint ? `${option} · ${hint}` : option
}

function onChange(event: Event) {
  emit('change', (event.target as HTMLSelectElement).value)
}
</script>

<template>
  <span class="selwrap">
    <select class="mini actionable" :value="modelValue" :title="title" @change="onChange">
      <option v-if="topHint" value="" disabled>{{ topHint }}</option>
      <option v-for="option in options" :key="option" :value="option">
        {{ optionLabel(option) }}
      </option>
    </select>
  </span>
</template>

<style scoped>
.selwrap {
  position: relative;
  display: inline-block;
}

select.mini {
  font: inherit;
  font-size: 12px;
  color: var(--ink);
  background: transparent;
  border: 0;
  border-bottom: 1px dashed var(--dash);
  appearance: none;
  -webkit-appearance: none;
  padding: 0 12px 0 1px;
  cursor: pointer;
}

.selwrap::after {
  content: '▾';
  position: absolute;
  right: 1px;
  top: 0;
  font-size: 10px;
  color: var(--muted);
  pointer-events: none;
}

@media (min-width: 721px) {
  select.mini {
    font-size: 14px;
    padding-right: 14px;
  }

  .selwrap::after {
    font-size: 11px;
  }
}

@media (max-width: 720px) {
  /* 触控目标 ≥44px：内边距撑高、负边距抵消占位，视觉布局不变 */
  select.mini {
    padding: 12px 22px 12px 1px;
    margin: -12px -8px;
  }

  .selwrap::after {
    right: 9px;
    top: 12px;
  }
}
</style>
