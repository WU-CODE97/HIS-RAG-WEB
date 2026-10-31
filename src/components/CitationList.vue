<script setup>
import { ref } from 'vue'
import { formatScore } from '@/utils/format'

const props = defineProps({
  citations: { type: Array, default: () => [] },
  active: { type: Number, default: null },
})
const emit = defineEmits(['select'])

const expanded = ref(null)

function toggle(i) {
  expanded.value = expanded.value === i ? null : i
  emit('select', i)
}
</script>

<template>
  <div class="cite-list scroll-thin">
    <div
      v-for="(c, i) in props.citations"
      :id="`cite-${i + 1}`"
      :key="c.chunkId || i"
      class="cite-card"
      :class="{ active: props.active === i + 1 }"
      @click="toggle(i + 1)"
    >
      <div class="cite-top">
        <span class="cite-idx">{{ i + 1 }}</span>
        <div class="cite-title-wrap">
          <div class="cite-title truncate" :title="c.documentTitle">
            {{ c.documentTitle || c.documentId }}
          </div>
          <div class="cite-sub mono">chunk #{{ c.chunkIndex }} · score {{ formatScore(c.score) }}</div>
        </div>
      </div>
      <div class="cite-bar">
        <i :style="{ width: `${Math.max(4, Math.min(100, (c.score || 0) * 100))}%` }" />
      </div>
      <p class="cite-snippet" :class="{ clamp: expanded !== i + 1 }">{{ c.snippet }}</p>
    </div>
  </div>
</template>

<style scoped>
.cite-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 12px 12px;
  max-height: 48vh;
  overflow-y: auto;
}
.cite-card {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 9px 11px;
  background: var(--surface-2);
  cursor: pointer;
  transition: all 0.15s;
}
.cite-card:hover {
  border-color: var(--brand-300);
  background: var(--brand-50);
}
.cite-card.active {
  border-color: var(--brand-400);
  background: var(--brand-50);
  box-shadow: inset 0 0 0 1px var(--brand-200);
}
.cite-top {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.cite-idx {
  width: 17px;
  height: 17px;
  border-radius: 5px;
  background: var(--brand-600);
  color: #fff;
  font-size: 10.5px;
  font-weight: 600;
  display: grid;
  place-items: center;
  flex: none;
  margin-top: 1px;
}
.cite-title-wrap {
  min-width: 0;
  flex: 1;
}
.cite-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
  line-height: 1.4;
}
.cite-sub {
  font-size: 10.5px;
  color: var(--ink-4);
  margin-top: 1px;
}
.cite-bar {
  height: 3px;
  border-radius: 99px;
  background: #e6edf1;
  overflow: hidden;
  margin: 7px 0 6px;
}
.cite-bar i {
  display: block;
  height: 100%;
  background: var(--brand-400);
  border-radius: 99px;
}
.cite-snippet {
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--ink-3);
  word-break: break-word;
}
.cite-snippet.clamp {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
