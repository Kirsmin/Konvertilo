<script setup lang="ts">
import { watchEffect } from 'vue'
import { RouterView } from 'vue-router'
import { useUiStore } from './stores/ui'

const ui = useUiStore()

watchEffect(() => {
  document.body.dataset.theme = ui.theme
  document.body.dataset.status = ui.status
})
</script>

<template>
  <RouterView />
</template>
