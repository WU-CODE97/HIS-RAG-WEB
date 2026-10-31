<script setup>
import ToastLayer from '@/components/ToastLayer.vue'
</script>

<template>
  <router-view v-slot="{ Component }">
    <transition name="fade-page" mode="out-in">
      <component :is="Component" />
    </transition>
  </router-view>
  <ToastLayer />
</template>

<style>
.fade-page-enter-active,
.fade-page-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}
.fade-page-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.fade-page-leave-to {
  opacity: 0;
}
</style>
