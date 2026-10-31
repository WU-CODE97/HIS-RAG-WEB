<script setup>
import { useToast } from '@/composables/useToast'
import Icon from './Icon.vue'

const { items } = useToast()
const ICON = { ok: 'check', err: 'alert', warn: 'alert', info: 'info' }
</script>

<template>
  <div class="toast-layer">
    <transition-group name="toast">
      <div v-for="t in items" :key="t.id" class="toast" :class="t.type">
        <Icon :name="ICON[t.type] || 'info'" :size="14" />
        <span>{{ t.message }}</span>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.toast.warn {
  background: #7c3407;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
