<script setup lang="ts">
defineProps<{
  selected: boolean
}>()

const emit = defineEmits<{
  toggle: []
}>()

/** 命中这些元素时不触发整行选中 */
const INTERACTIVE = 'select, .oname, input, a, button, .selwrap, [contenteditable="true"]'

function onRowClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest(INTERACTIVE)) return
  emit('toggle')
}
</script>

<template>
  <li class="row" :class="{ sel: selected }" @click="onRowClick">
    <button
      type="button"
      class="circle"
      :class="{ on: selected }"
      :aria-pressed="selected"
      aria-label="选择"
      @click.stop="emit('toggle')"
    ></button>
    <div class="main">
      <slot />
    </div>
  </li>
</template>

<style scoped>
.row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 9px 4px;
  border-bottom: 1px dashed var(--line);
  cursor: pointer;
  position: relative;
}

.row:hover {
  background: var(--sel);
}

.row:last-child {
  border-bottom: 0;
}

.row.sel {
  background: var(--sel);
}

.circle {
  width: 14px;
  height: 14px;
  margin-top: 5px;
  border: 1px dashed var(--dash);
  border-radius: 50%;
  position: relative;
  flex: none;
  padding: 0;
}

.circle.on {
  border-style: solid;
  border-color: currentColor;
}

.circle.on::after {
  content: '';
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  background: var(--accent);
}

.main {
  flex: 1;
  min-width: 0;
}

@media (min-width: 721px) {
  .row {
    padding: 11px 4px;
  }

  .circle {
    width: 16px;
    height: 16px;
    margin-top: 6px;
  }

  .circle.on::after {
    inset: 4px;
  }
}

@media (max-width: 720px) {
  .row {
    padding: 12px 4px;
    user-select: none;
    -webkit-user-select: none;
  }

  .circle {
    width: 18px;
    height: 18px;
    margin-top: 3px;
  }

  .circle.on::after {
    inset: 4px;
  }
}
</style>
