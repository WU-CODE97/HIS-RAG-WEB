<script setup>
import { computed, ref } from 'vue'
import Icon from '@/components/Icon.vue'
import { useToast } from '@/composables/useToast'
import { ROLE_OPTIONS, useIdentityStore } from '@/stores/identity'
import { evaluate } from '@/api/rag'
import { formatPercent, formatScore } from '@/utils/format'

const identity = useIdentityStore()
const toast = useToast()

const DEFAULT_CASES = [
  { query: '工伤认定的申报流程', relevant: 'doc-001' },
  { query: '住院费用结算需要哪些材料', relevant: 'doc-001, doc-002' },
  { query: '高血压用药禁忌', relevant: 'doc-003' },
]

const cases = ref(DEFAULT_CASES.map((c) => ({ ...c })))
const topK = ref(5)
const loading = ref(false)
const result = ref(null)
const bulkOpen = ref(false)
const bulkText = ref('')

const ROLE_LABELS = computed(() =>
  identity.roles.map((r) => ROLE_OPTIONS.find((o) => o.value === r)?.label || r),
)

const canRun = computed(() => cases.value.some((c) => c.query.trim()))

function addCase() {
  cases.value.push({ query: '', relevant: '' })
}
function removeCase(i) {
  cases.value.splice(i, 1)
}
function loadSample() {
  cases.value = DEFAULT_CASES.map((c) => ({ ...c }))
  toast.info('已载入示例用例')
}

function openBulk() {
  bulkText.value = JSON.stringify(
    cases.value.map((c) => ({
      query: c.query,
      relevantDocumentIds: c.relevant
        .split(/[,，\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    })),
    null,
    2,
  )
  bulkOpen.value = true
}

function applyBulk() {
  try {
    const parsed = JSON.parse(bulkText.value)
    if (!Array.isArray(parsed)) throw new Error('需要是数组')
    cases.value = parsed.map((c) => ({
      query: String(c.query || ''),
      relevant: (c.relevantDocumentIds || []).join(', '),
    }))
    bulkOpen.value = false
    toast.ok(`已载入 ${cases.value.length} 条用例`)
  } catch (e) {
    toast.err(e instanceof SyntaxError ? 'JSON 格式有误' : e.message)
  }
}

async function run() {
  const payload = cases.value
    .filter((c) => c.query.trim())
    .map((c) => ({
      query: c.query.trim(),
      relevantDocumentIds: c.relevant
        .split(/[,，\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    }))
  if (!payload.length) {
    toast.warn('至少填写一条用例')
    return
  }
  loading.value = true
  try {
    result.value = await evaluate({ cases: payload, user: identity.payload, topK: topK.value })
    toast.ok(`评估完成，共 ${result.value.caseCount} 条用例`)
  } catch (e) {
    toast.err(e.message)
  } finally {
    loading.value = false
  }
}

const metrics = computed(() => {
  if (!result.value) return []
  return [
    { key: 'recall', label: 'Average Recall@K', value: result.value.avgRecall, tone: 'brand' },
    { key: 'precision', label: 'Average Precision@K', value: result.value.avgPrecision, tone: 'violet' },
    { key: 'mrr', label: 'MRR', value: result.value.mrr, tone: 'ok' },
  ]
})

function hit(docId, expected) {
  return expected.includes(docId)
}
</script>

<template>
  <div class="eval-page">
    <div class="grid">
      <div class="col-main">
        <!-- 用例编辑 -->
        <section class="card">
          <div class="card-head">
            <Icon name="target" :size="16" style="color: var(--brand-600)" />
            <h3>评估用例</h3>
            <span class="sub">问题 + 人工标注的相关文档 ID</span>
            <span class="spacer" />
            <button class="btn btn-sm btn-ghost" @click="loadSample">载入示例</button>
            <button class="btn btn-sm btn-ghost" @click="openBulk">批量编辑</button>
          </div>

          <div class="card-body">
            <div class="case-head">
              <span class="ch-idx">#</span>
              <span class="ch-q">查询语句</span>
              <span class="ch-doc">相关文档 ID（逗号分隔）</span>
              <span style="width: 28px" />
            </div>

            <div class="cases">
              <div v-for="(c, i) in cases" :key="i" class="case-row">
                <span class="ch-idx tnum">{{ i + 1 }}</span>
                <input v-model="c.query" class="input input-sm" placeholder="例如：工伤认定的申报流程" />
                <input v-model="c.relevant" class="input input-sm mono" placeholder="doc-001, doc-002" />
                <button class="btn btn-ghost btn-icon" style="width: 28px; height: 28px" @click="removeCase(i)">
                  <Icon name="x" :size="12" />
                </button>
              </div>
            </div>

            <div class="run-bar">
              <button class="btn btn-sm" @click="addCase">
                <Icon name="plus" :size="14" />
                添加用例
              </button>

              <div class="opt">
                <span class="opt-label">Top K</span>
                <input v-model.number="topK" type="range" min="1" max="20" class="range" />
                <span class="opt-value tnum">{{ topK }}</span>
              </div>

              <span class="spacer" />
              <button class="btn btn-primary" :disabled="loading || !canRun" @click="run">
                <span v-if="loading" class="spinner" />
                <Icon v-else name="play" :size="14" />
                {{ loading ? '评估中…' : '开始评估' }}
              </button>
            </div>
          </div>
        </section>

        <!-- 结果 -->
        <section v-if="result" class="card">
          <div class="card-head">
            <Icon name="gauge" :size="16" style="color: var(--brand-600)" />
            <h3>逐条明细</h3>
            <span class="sub">Top {{ topK }} 召回文档与标注的命中情况</span>
            <span class="spacer" />
            <span class="tag tag-brand">{{ result.caseCount }} 条</span>
          </div>
          <div class="table-wrap scroll-thin">
            <table class="table">
              <thead>
                <tr>
                  <th style="width: 32px">#</th>
                  <th>查询</th>
                  <th>召回文档</th>
                  <th style="width: 78px">Recall</th>
                  <th style="width: 84px">Precision</th>
                  <th style="width: 66px">RR</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(d, i) in result.details" :key="i">
                  <td class="tnum dim">{{ i + 1 }}</td>
                  <td class="cell-strong" style="max-width: 240px">{{ d.query }}</td>
                  <td>
                    <div class="docs">
                      <span v-if="!d.retrievedDocumentIds.length" class="dim">无召回</span>
                      <span
                        v-for="doc in d.retrievedDocumentIds"
                        :key="doc"
                        class="doc-chip"
                        :class="{ hit: hit(doc, cases[i]?.relevant?.split(/[,，\s]+/).map((s) => s.trim()) || []) }"
                      >
                        {{ doc }}
                      </span>
                    </div>
                  </td>
                  <td class="tnum" :class="d.recall > 0 ? 'good' : 'bad'">{{ formatPercent(d.recall, 0) }}</td>
                  <td class="tnum">{{ formatPercent(d.precision, 0) }}</td>
                  <td class="tnum">{{ formatScore(d.reciprocalRank, 2) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section v-else class="card placeholder-card">
          <div class="empty" style="padding: 56px 20px">
            <div class="icon-wrap"><Icon name="target" :size="18" /></div>
            <span>填写用例后点击「开始评估」，将调用 <span class="mono">POST /api/rag/eval</span></span>
          </div>
        </section>
      </div>

      <!-- 右侧 -->
      <div class="col-side">
        <section v-if="result" class="card">
          <div class="card-head">
            <Icon name="activity" :size="16" style="color: var(--brand-600)" />
            <h3>汇总指标</h3>
          </div>
          <div class="card-body metrics">
            <div v-for="m in metrics" :key="m.key" class="metric" :class="m.tone">
              <div class="metric-label">{{ m.label }}</div>
              <div class="metric-value tnum">{{ formatPercent(m.value, 1) }}</div>
              <div class="bar"><i :style="{ width: `${Math.min(100, (m.value || 0) * 100)}%` }" /></div>
            </div>
            <div class="metric-meta">
              评估身份：{{ identity.displayName }} ·
              {{ ROLE_LABELS.join('、') || '未设置角色' }} · L{{ identity.clearanceLevel }}
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <Icon name="book" :size="16" style="color: var(--brand-600)" />
            <h3>指标说明</h3>
          </div>
          <div class="card-body legend">
            <div class="lg">
              <b>Recall@K</b>
              <span>Top K 结果中命中的相关文档数 ÷ 标注的相关文档总数。</span>
            </div>
            <div class="lg">
              <b>Precision@K</b>
              <span>命中的相关文档数 ÷ Top K 中去重后的文档数。</span>
            </div>
            <div class="lg">
              <b>MRR</b>
              <span>第一个相关文档排名的倒数均值，衡量「第一个正确答案有多靠前」。</span>
            </div>
            <div class="notice notice-info" style="font-size: 11.5px">
              <Icon name="info" :size="14" />
              <span>文档 ID 可在知识库入库响应中获取（<span class="mono">documentId</span>）。</span>
            </div>
          </div>
        </section>
      </div>
    </div>

    <!-- 批量编辑 -->
    <Teleport to="body">
      <transition name="fade">
        <div v-if="bulkOpen" class="modal-mask" @click.self="bulkOpen = false">
          <div class="modal" style="width: min(620px, 100%)">
            <div class="modal-head">
              <div class="modal-icon tone-brand"><Icon name="file" :size="18" /></div>
              <div class="col" style="gap: 2px">
                <h3>批量编辑用例</h3>
                <span class="muted" style="font-size: 12px">
                  数组格式：{ query, relevantDocumentIds[] }
                </span>
              </div>
              <button class="btn btn-ghost btn-icon" style="margin-left: auto" @click="bulkOpen = false">
                <Icon name="x" :size="15" />
              </button>
            </div>
            <div class="modal-body">
              <textarea v-model="bulkText" class="textarea mono" rows="14" spellcheck="false" />
            </div>
            <div class="modal-foot">
              <button class="btn" @click="bulkOpen = false">取消</button>
              <button class="btn btn-primary" @click="applyBulk">应用</button>
            </div>
          </div>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
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

.case-head,
.case-row {
  display: grid;
  grid-template-columns: 26px minmax(0, 1.2fr) minmax(0, 1fr) 28px;
  gap: 8px;
  align-items: center;
}
.case-head {
  padding: 0 0 7px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 8px;
}
.case-head span {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--ink-3);
}
.ch-idx {
  font-size: 11px;
  color: var(--ink-4);
  text-align: center;
}
.cases {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.case-row:hover .ch-idx {
  color: var(--brand-600);
}

.run-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
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
}
.opt .range {
  width: 100px;
}
.opt-value {
  font-size: 12px;
  font-weight: 600;
  color: var(--brand-700);
}

.table-wrap {
  overflow-x: auto;
}
.docs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.doc-chip {
  font-family: var(--font-mono);
  font-size: 10.5px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--surface-3);
  color: var(--ink-3);
}
.doc-chip.hit {
  background: var(--ok-bg);
  color: var(--ok);
  font-weight: 600;
}
.good {
  color: var(--ok);
  font-weight: 600;
}
.bad {
  color: var(--ink-4);
}

.metrics {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.metric-label {
  font-size: 11px;
  color: var(--ink-3);
  font-weight: 500;
  letter-spacing: 0.02em;
}
.metric-value {
  font-size: 22px;
  font-weight: 650;
  line-height: 1.3;
  color: var(--ink);
  margin: 1px 0 6px;
  letter-spacing: -0.02em;
}
.metric.brand .metric-value {
  color: var(--brand-700);
}
.metric.violet .metric-value {
  color: var(--violet);
}
.metric.ok .metric-value {
  color: var(--ok);
}
.metric.brand .bar > i {
  background: var(--brand-500);
}
.metric.violet .bar > i {
  background: var(--violet);
}
.metric.ok .bar > i {
  background: var(--ok);
}
.metric-meta {
  font-size: 11px;
  color: var(--ink-4);
  line-height: 1.6;
  padding-top: 8px;
  border-top: 1px dashed var(--line);
}

.legend {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.lg b {
  font-size: 12px;
  color: var(--brand-700);
  font-weight: 600;
}
.lg span {
  display: block;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--ink-3);
}
.placeholder-card {
  background: transparent;
  border-style: dashed;
  box-shadow: none;
}
.tone-brand {
  background: var(--brand-50);
  color: var(--brand-600);
}

@media (max-width: 1100px) {
  .grid {
    grid-template-columns: 1fr;
  }
  .col-side {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
}
@media (max-width: 760px) {
  .col-side {
    grid-template-columns: 1fr;
  }
  .case-head {
    display: none;
  }
  .case-row {
    grid-template-columns: 20px 1fr 28px;
    grid-template-areas:
      'idx q x'
      'idx doc x';
    row-gap: 5px;
  }
  .case-row > *:nth-child(1) {
    grid-area: idx;
  }
  .case-row > *:nth-child(2) {
    grid-area: q;
  }
  .case-row > *:nth-child(3) {
    grid-area: doc;
  }
  .case-row > *:nth-child(4) {
    grid-area: x;
  }
}
</style>
