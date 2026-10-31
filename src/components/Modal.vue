<script setup>
import { onBeforeUnmount, onMounted, watch } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  tone: { type: String, default: 'warn' }, // warn | err | info | brand
  confirmText: { type: String, default: '确认' },
  cancelText: { type: String, default: '取消' },
  loading: { type: Boolean, default: false },
  width: { type: String, default: '460px' },
})
const emit = defineEmits(['update:open', 'confirm', 'cancel'])

const ICON_BY_TONE = { warn: 'alert', err: 'alert', info: 'info', brand: 'info' }

function close() {
  emit('update:open', false)
  emit('cancel')
}

function onKey(e) {
  if (e.key === 'Escape' && props.open) close()
}

watch(
  () => props.open,
  (v) => {
    document.body.style.overflow = v ? 'hidden' : ''
  },
)

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <transition name="fade">
      <div v-if="open" class="modal-mask" @click.self="close">
        <div class="modal" :style="{ width }" role="dialog" aria-modal="true">
          <div class="modal-head">
            <div class="modal-icon" :class="`tone-${tone}`">
              <Icon :name="ICON_BY_TONE[tone] || 'info'" :size="18" />
            </div>
            <div class="col" style="gap: 2px; min-width: 0">
              <h3>{{ title }}</h3>
              <div v-if="$slots.sub" class="muted" style="font-size: 12px">{{ $slots.sub }}</div>
            </div>
            <button class="btn btn-ghost btn-icon" style="margin-left: auto" @click="close">
              <Icon name="x" :size="15" />
            </button>
          </div>
          <div class="modal-body">
            <slot />
          </div>
          <div class="modal-foot">
            <button class="btn" :disabled="loading" @click="close">{{ cancelText }}</button>
            <button
              class="btn"
              :class="tone === 'err' || tone === 'warn' ? 'btn-danger' : 'btn-primary'"
              :disabled="loading"
              @click="emit('confirm')"
            >
              <span v-if="loading" class="spinner" />
              {{ confirmText }}
            </button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.tone-warn {
  background: var(--warn-bg);
  color: var(--warn);
}
.tone-err {
  background: var(--err-bg);
  color: var(--err);
}
.tone-info {
  background: var(--info-bg);
  color: var(--info);
}
.tone-brand {
  background: var(--brand-50);
  color: var(--brand-600);
}
</style>
