<script setup>
import { computed, ref } from 'vue'
import Icon from '@/components/Icon.vue'
import { useToast } from '@/composables/useToast'
import { ROLE_OPTIONS, useIdentityStore } from '@/stores/identity'
import { retrieve } from '@/api/rag'
import { formatScore, highlight } from '@/utils/format'

const identity = useIdentityStore()
const toast = useToast()

const query = ref('')
const topK = ref(10)
const loading = ref(false)
const results = ref([])
const elapsed = ref(0)
const searched = ref(false)
const filterSource = ref('all')

const SOURCE_META = {
  vector: { label: '向量', cls: 'tag-brand' },
  bm25: { label: 'BM25', cls: 'tag-info' },
  hybrid: { label: '混合融合', cls: 'tag-violet' },
  rerank: { label: '重排后', cls: 'tag-ok' },
  elasticsearch: { label: 'ES 混合', cls: 'tag-violet' },
}

const sourceOf = (s) => (s || 'unknown').toLowerCase()

const filtered = computed(() => {
  if (filterSource.value === 'all') return results.value
  return results.value.filter((r) => sourceOf(r.source).includes(filterSource.value))
})

const maxScore = computed(() => Math.max(0.0001, ...results.value.map((r) => r.score || 0)))

async function run() {
  const q = query.value.trim()
  if (!q || loading.value) return
  loading.value = true
  searched.value = true
  const t0 = performance.now()
  try {
    const res = await retrieve({ query: q, user: identity.payload, topK: topK.value })
    results.value = Array.isArray(res) ? res : []
    elapsed.value = Math.round(performance.now() - t0)
    if (!results.value.length) toast.warn('未召回任何片段，请确认知识库已入库')
  } catch (e) {
    results.value = []
    toast.err(e.message)
  } finally {
    loading.value = false
  }
}

const roleLabels = computed(() =>
  identity.roles.map((r) => ROLE_OPTIONS.find((o) => o.value === r)?.label || r),
)
</script>

<template>
  <div class="retrieve-page">
    <div class="grid">
      <div class="col-main">
        <!-- 查询 -->
        <section class="card">
          <div class="card-head">
            <Icon name="search" :size="16" style="color: var(--brand-600)" />
            <h3>检索查询</h3>
            <span class="sub">只做召回，不调用大模型生成</span>
          </div>
          <div class="card-body">
            <div class="search-row">
              <input
                v-model="query"
                class="input"
                placeholder="输入检索语句，例如：工伤认定的申报材料"
                @keyup.enter="run"
              />
              <button class="btn btn-primary" :disabled="loading || !query.trim()" @click="run">
                <span v-if="loading" class="spinner" />
                <Icon v-else name="play" :size="14" />
                检索
              </button>
            </div>

            <div class="opts">
              <div class="opt">
                <span class="opt-label">Top K</span>
                <input v-model.number="topK" type="range" min="1" max="30" class="range" />
                <span class="opt-value tnum">{{ topK }}</span>
              </div>
              <div class="opt" v-if="results.length">
                <span class="opt-label">来源过滤</span>
                <div class="segmented">
                  <button :class="{ on: filterSource === 'all' }" @click="filterSource = 'all'">
                    全部 {{ results.length }}
                  </button>
                  <button :class="{ on: filterSource === 'vector' }" @click="filterSource = 'vector'">
                    向量
                  </button>
                  <button :class="{ on: filterSource === 'bm25' }" @click="filterSource = 'bm25'">
                    BM25
                  </button>
                </div>
              </div>
              <span class="spacer" />
              <span v-if="searched && !loading" class="dim tnum" style="font-size: 11.5px">
                召回 {{ results.length }} 条 · 耗时 {{ elapsed }} ms
              </span>
            </div>
          </div>
        </section>

        <!-- 结果 -->
        <section class="card results-card">
          <div class="card-head">
            <Icon name="layers" :size="16" style="color: var(--brand-600)" />
            <h3>召回结果</h3>
            <span class="sub" v-if="filtered.length">按主评分降序</span>
            <span class="spacer" />
            <span v-if="results.length" class="tag tag-brand">{{ filtered.length }} / {{ results.length }}</span>
          </div>

          <div v-if="loading" class="card-body">
            <div v-for="i in 3" :key="i" class="result-skeleton">
              <div class="skeleton" style="width: 40%; height: 12px" />
              <div class="skeleton" style="width: 100%; height: 11px; margin-top: 10px" />
              <div class="skeleton" style="width: 88%; height: 11px; margin-top: 6px" />
            </div>
          </div>

          <div v-else-if="!results.length" class="empty">
            <div class="icon-wrap"><Icon name="search" :size="18" /></div>
            <span>{{ searched ? '没有召回片段，试试更短的关键词或不同问法' : '输入语句后回车开始检索' }}</span>
          </div>

          <div v-else class="result-list scroll-thin">
            <article v-for="(r, i) in filtered" :key="r.chunk?.id || i" class="result">
              <div class="r-rank">{{ r.rank || i + 1 }}</div>
              <div class="r-main">
                <div class="r-head">
                  <span class="r-title truncate" :title="r.chunk?.documentTitle">
                    {{ r.chunk?.documentTitle || r.chunk?.documentId }}
                  </span>
                  <span class="tag" :class="SOURCE_META[sourceOf(r.source)]?.cls || 'tag'">
                    {{ SOURCE_META[sourceOf(r.source)]?.label || r.source }}
                  </span>
                  <span class="spacer" />
                  <span class="r-score tnum">{{ formatScore(r.score, 4) }}</span>
                </div>

                <div class="r-bar">
                  <i :style="{ width: `${Math.max(3, (r.score / maxScore) * 100)}%` }" />
                </div>

                <p class="r-content" v-html="highlight(r.chunk?.content, query)" />

                <div class="r-foot mono">
                  <span>{{ r.chunk?.id || `${r.chunk?.documentId}#${r.chunk?.index}` }}</span>
                  <span class="dot-sep">·</span>
                  <span>vector {{ formatScore(r.vectorScore) }}</span>
                  <span class="dot-sep">·</span>
                  <span>bm25 {{ formatScore(r.bm25Score) }}</span>
                  <template v-if="r.chunk?.accessControl">
                    <span class="dot-sep">·</span>
                    <span>ACL L{{ r.chunk.accessControl.sensitivityLevel }}</span>
                  </template>
                </div>
              </div>
            </article>
          </div>
        </section>
      </div>

      <!-- 右侧 -->
      <div class="col-side">
        <section class="card">
          <div class="card-head">
            <Icon name="shield" :size="16" style="color: var(--brand-600)" />
            <h3>当前权限上下文</h3>
          </div>
          <div class="card-body perm">
            <div class="perm-row">
              <span>用户</span>
              <b>{{ identity.displayName }} <span class="mono dim">({{ identity.userId }})</span></b>
            </div>
            <div class="perm-row">
              <span>科室</span>
              <b>{{ identity.departments.join('、') || '不限' }}</b>
            </div>
            <div class="perm-row">
              <span>角色</span>
              <b>{{ roleLabels.join('、') || '未设置' }}</b>
            </div>
            <div class="perm-row">
              <span>密级</span>
              <b>L{{ identity.clearanceLevel }}</b>
            </div>
            <div class="notice notice-info" style="margin-top: 10px; font-size: 11.5px">
              <Icon name="info" :size="14" />
              <span>检索器先按 ACL 过滤再截断 TopK，因此更换身份可能召回不同片段。</span>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <Icon name="pulse" :size="16" style="color: var(--brand-600)" />
            <h3>分数含义</h3>
          </div>
          <div class="card-body legend">
            <div class="lg"><span class="lg-k mono">score</span><span>当前阶段主评分，越大越相关</span></div>
            <div class="lg"><span class="lg-k mono">vectorScore</span><span>查询与片段的向量相似度</span></div>
            <div class="lg"><span class="lg-k mono">bm25Score</span><span>关键词命中权重分</span></div>
            <div class="lg"><span class="lg-k mono">source</span><span>评分来源：向量 / BM25 / 融合 / 重排</span></div>
            <div class="divider" />
            <div class="lg"><span class="lg-k">向量</span><span>语义词相近即命中，如「禁忌」≈「不能用」</span></div>
            <div class="lg"><span class="lg-k">BM25</span><span>精确词命中，如药品名、编码、术语</span></div>
            <div class="lg"><span class="lg-k">融合</span><span>RRF 或加权归一化后合并两路排名</span></div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 310px;
  gap: 16px;
  align-items: start;
}
.col-main,
.col-side {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.search-row {
  display: flex;
  gap: 8px;
}
.search-row .input {
  height: 38px;
}
.search-row .btn {
  height: 38px;
  flex: none;
}
.opts {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.opt {
  display: flex;
  align-items: center;
  gap: 8px;
}
.opt-label {
  font-size: 11.5px;
  color: var(--ink-3);
  font-weight: 500;
}
.opt .range {
  width: 110px;
}
.opt-value {
  font-size: 12px;
  font-weight: 600;
  color: var(--brand-700);
  min-width: 18px;
}

.results-card {
  min-height: 320px;
}
.result-list {
  padding: 6px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: calc(100vh - 340px);
  overflow-y: auto;
}
.result {
  display: flex;
  gap: 11px;
  padding: 12px 13px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.result:hover {
  border-color: var(--brand-200);
  box-shadow: var(--shadow-sm);
}
.r-rank {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: var(--surface-3);
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 600;
  display: grid;
  place-items: center;
  flex: none;
  margin-top: 1px;
  font-family: var(--font-mono);
}
.result:nth-child(1) .r-rank {
  background: var(--brand-600);
  color: #fff;
}
.result:nth-child(2) .r-rank {
  background: var(--brand-100);
  color: var(--brand-700);
}
.r-main {
  flex: 1;
  min-width: 0;
}
.r-head {
  display: flex;
  align-items: center;
  gap: 7px;
}
.r-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  max-width: 55%;
}
.r-score {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--brand-700);
}
.r-bar {
  height: 3px;
  border-radius: 99px;
  background: var(--surface-3);
  margin: 7px 0 9px;
  overflow: hidden;
}
.r-bar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--brand-400), var(--brand-600));
  border-radius: 99px;
}
.r-content {
  font-size: 12.5px;
  line-height: 1.72;
  color: var(--ink-2);
  word-break: break-word;
}
.r-content :deep(mark) {
  background: #fff2c2;
  color: var(--ink);
  padding: 0 1px;
  border-radius: 2px;
}
.r-foot {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  margin-top: 7px;
  font-size: 10.5px;
  color: var(--ink-4);
}
.dot-sep {
  opacity: 0.6;
}

.result-skeleton {
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  margin-bottom: 8px;
}

.perm {
  display: flex;
  flex-direction: column;
}
.perm-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px dashed var(--line);
  font-size: 12px;
  color: var(--ink-3);
}
.perm-row b {
  color: var(--ink);
  font-weight: 500;
  text-align: right;
}

.legend {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.lg {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.lg-k {
  font-size: 11px;
  font-weight: 600;
  color: var(--brand-700);
}
.lg span:last-child {
  font-size: 11.5px;
  color: var(--ink-3);
  line-height: 1.55;
}
.divider {
  height: 1px;
  background: var(--line);
  margin: 2px 0;
}

@media (max-width: 1100px) {
  .grid {
    grid-template-columns: 1fr;
  }
  .col-side {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .result-list {
    max-height: none;
  }
}
@media (max-width: 760px) {
  .col-side {
    grid-template-columns: 1fr;
  }
  .r-title {
    max-width: 100%;
  }
}
</style>
