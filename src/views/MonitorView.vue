<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from '@/components/Icon.vue'
import Modal from '@/components/Modal.vue'
import { useToast } from '@/composables/useToast'
import { clearCache, getHealth, getStats } from '@/api/rag'
import { API_BASE } from '@/api/http'
import { formatNumber, formatPercent, formatTime } from '@/utils/format'

const toast = useToast()

const stats = ref(null)
const health = ref({ status: 'checking', latency: null, at: null, service: 'his-rag' })
const loading = ref(false)
const autoRefresh = ref(true)
const lastUpdated = ref(null)
const cacheModal = ref(false)
const clearingCache = ref(false)

let timer = null

async function load() {
  loading.value = true
  const t0 = performance.now()
  try {
    const [s, h] = await Promise.all([getStats(), getHealth()])
    stats.value = s
    health.value = {
      status: h?.status === 'UP' ? 'up' : 'degraded',
      service: h?.service || 'his-rag',
      latency: Math.round(performance.now() - t0),
      at: Date.now(),
    }
    lastUpdated.value = Date.now()
  } catch (e) {
    health.value = { status: 'down', latency: null, at: Date.now(), service: 'his-rag' }
    stats.value = null
    if (!loading.value) toast.err(e.message)
  } finally {
    loading.value = false
  }
}

function toggleAuto() {
  autoRefresh.value = !autoRefresh.value
  if (autoRefresh.value) startTimer()
  else stopTimer()
}
function startTimer() {
  stopTimer()
  timer = window.setInterval(load, 10000)
}
function stopTimer() {
  window.clearInterval(timer)
  timer = null
}

async function doClearCache() {
  clearingCache.value = true
  try {
    await clearCache()
    toast.ok('语义缓存已清空')
    await load()
  } catch (e) {
    toast.err(e.message)
  } finally {
    clearingCache.value = false
    cacheModal.value = false
  }
}

const kpis = computed(() => {
  const s = stats.value
  if (!s) return []
  const indexed = s.hybrid?.enabled ? s.hybrid.documents : (s.vectors || 0)
  return [
    {
      label: '知识片段',
      value: formatNumber(s.chunks),
      sub: 'chunks',
      icon: 'database',
      tone: 'brand',
    },
    {
      label: '索引文档',
      value: formatNumber(indexed),
      sub: s.hybrid?.enabled ? '混合索引' : '向量库',
      icon: 'layers',
      tone: 'violet',
    },
    {
      label: '缓存条目',
      value: formatNumber(s.cache?.size || 0),
      sub: `命中率 ${formatPercent(s.cache?.hitRate || 0, 0)}`,
      icon: 'zap',
      tone: 'warn',
    },
    {
      label: '活跃会话',
      value: formatNumber(s.conversation?.sessions || 0),
      sub: '服务端会话',
      icon: 'chat',
      tone: 'ok',
    },
  ]
})

const hitRate = computed(() => Math.max(0, Math.min(1, stats.value?.cache?.hitRate || 0)))
const DONUT_R = 26
const DONUT_C = 2 * Math.PI * DONUT_R
const dash = computed(() => `${hitRate.value * DONUT_C} ${DONUT_C}`)

const API_LIST = [
  ['POST', '/api/rag/query', '端到端问答（多轮只需回传 sessionId）'],
  ['POST', '/api/rag/retrieve', '仅检索，返回分数拆解'],
  ['POST', '/api/rag/eval', '检索效果评估'],
  ['POST', '/api/rag/ingest', 'JSON 批量入库'],
  ['POST', '/api/rag/ingest/file', '文件上传入库（multipart）'],
  ['GET', '/api/rag/conversation/{id}', '查看会话历史'],
  ['DELETE', '/api/rag/conversation/{id}', '清空会话历史'],
  ['GET', '/api/rag/stats', '知识库与缓存统计'],
  ['DELETE', '/api/rag/cache', '清空语义缓存'],
  ['DELETE', '/api/rag/documents', '清空知识库'],
  ['GET', '/api/rag/health', '健康检查'],
]

onMounted(() => {
  load()
  startTimer()
})
onBeforeUnmount(stopTimer)
</script>

<template>
  <div class="monitor-page">
    <!-- KPI -->
    <div class="kpis">
      <div v-for="k in kpis" :key="k.label" class="kpi card">
        <div class="kpi-icon" :class="k.tone"><Icon :name="k.icon" :size="16" /></div>
        <div class="kpi-main">
          <div class="kpi-label">{{ k.label }}</div>
          <div class="kpi-value tnum">{{ k.value }}</div>
          <div class="kpi-sub">{{ k.sub }}</div>
        </div>
      </div>
      <div v-if="!kpis.length" class="kpi card skeleton" style="height: 88px" />
    </div>

    <div class="grid">
      <div class="col-main">
        <!-- 服务状态 -->
        <section class="card">
          <div class="card-head">
            <Icon name="server" :size="16" style="color: var(--brand-600)" />
            <h3>服务状态</h3>
            <span class="spacer" />
            <label class="switch" style="font-size: 12px">
              <input :checked="autoRefresh" type="checkbox" @change="toggleAuto" />
              <span class="track" />
              <span class="dim">10s 自动刷新</span>
            </label>
            <button class="btn btn-sm btn-ghost" :disabled="loading" @click="load">
              <Icon name="refresh" :size="13" :class="{ spin: loading }" />
              刷新
            </button>
          </div>

          <div class="card-body">
            <div class="health-block" :class="health.status">
              <div class="hb-dot">
                <span class="pulse-ring" v-if="health.status === 'up'" />
              </div>
              <div class="hb-main">
                <div class="hb-title">
                  {{ health.status === 'up' ? 'HIS-RAG 服务运行中' : health.status === 'down' ? '无法连接后端服务' : health.status === 'degraded' ? '服务状态异常' : '正在检测…' }}
                </div>
                <div class="hb-sub mono">
                  {{ health.service }} · {{ API_BASE || '同源代理 /api' }}
                </div>
              </div>
              <div class="hb-meta">
                <div class="hb-item">
                  <span>响应延迟</span>
                  <b class="tnum">{{ health.latency != null ? `${health.latency} ms` : '—' }}</b>
                </div>
                <div class="hb-item">
                  <span>最近检查</span>
                  <b class="tnum">{{ health.at ? formatTime(health.at) : '—' }}</b>
                </div>
              </div>
            </div>

            <div v-if="health.status === 'down'" class="notice notice-err" style="margin-top: 14px">
              <Icon name="alert" :size="15" />
              <span>
                请确认后端已启动：<span class="mono">mvn spring-boot:run</span>（默认
                <span class="mono">http://localhost:8080</span>）。开发环境下 Vite 会把
                <span class="mono">/api</span> 代理到该地址。
              </span>
            </div>
          </div>
        </section>

        <!-- 缓存 -->
        <section class="card">
          <div class="card-head">
            <Icon name="zap" :size="16" style="color: var(--brand-600)" />
            <h3>语义缓存</h3>
            <span class="sub">按查询向量余弦相似度命中，按权限域隔离</span>
            <span class="spacer" />
            <button class="btn btn-sm btn-danger" :disabled="!stats" @click="cacheModal = true">
              清空缓存
            </button>
          </div>

          <div v-if="stats" class="card-body cache-body">
            <div class="donut-wrap">
              <svg viewBox="0 0 64 64" class="donut">
                <circle cx="32" cy="32" :r="DONUT_R" fill="none" stroke="#eef2f5" stroke-width="7" />
                <circle
                  cx="32"
                  cy="32"
                  :r="DONUT_R"
                  fill="none"
                  stroke="var(--brand-500)"
                  stroke-width="7"
                  stroke-linecap="round"
                  :stroke-dasharray="dash"
                  transform="rotate(-90 32 32)"
                />
              </svg>
              <div class="donut-center">
                <b class="tnum">{{ formatPercent(hitRate, 0) }}</b>
                <span>命中率</span>
              </div>
            </div>

            <div class="cache-stats">
              <div class="cs">
                <span>状态</span>
                <b>
                  <span :class="stats.cache?.enabled ? 'tag tag-ok tag-dot' : 'tag'">
                    {{ stats.cache?.enabled ? '已启用' : '已关闭' }}
                  </span>
                </b>
              </div>
              <div class="cs">
                <span>条目数</span>
                <b class="tnum">{{ formatNumber(stats.cache?.size || 0) }}</b>
              </div>
              <div class="cs">
                <span>命中次数</span>
                <b class="tnum" style="color: var(--ok)">{{ formatNumber(stats.cache?.hits || 0) }}</b>
              </div>
              <div class="cs">
                <span>未命中次数</span>
                <b class="tnum" style="color: var(--ink-3)">{{ formatNumber(stats.cache?.misses || 0) }}</b>
              </div>
            </div>
          </div>
          <div v-else class="card-body">
            <div class="skeleton" style="height: 90px" />
          </div>
        </section>

        <!-- 索引构成 -->
        <section class="card">
          <div class="card-head">
            <Icon name="layers" :size="16" style="color: var(--brand-600)" />
            <h3>存储与索引</h3>
            <span class="sub">不同 hybrid 模式下的数据落点不同</span>
          </div>
          <div class="card-body">
            <div class="store-grid">
              <div class="store-item">
                <div class="si-label">混合索引</div>
                <div class="si-value">
                  <span v-if="stats?.hybrid?.enabled" class="tag tag-ok tag-dot">已启用</span>
                  <span v-else class="tag">未启用</span>
                </div>
                <div class="si-sub mono">{{ stats?.hybrid?.backend || '—' }}</div>
              </div>
              <div class="store-item">
                <div class="si-label">混合索引文档</div>
                <div class="si-value tnum">{{ formatNumber(stats?.hybrid?.documents || 0) }}</div>
                <div class="si-sub">启用后向量与 BM25 均不参与检索</div>
              </div>
              <div class="store-item">
                <div class="si-label">向量库条数</div>
                <div class="si-value tnum">{{ formatNumber(stats?.vectors || 0) }}</div>
                <div class="si-sub">memory / pgvector</div>
              </div>
              <div class="store-item">
                <div class="si-label">BM25 文档数</div>
                <div class="si-value tnum">{{ formatNumber(stats?.bm25Documents || 0) }}</div>
                <div class="si-sub">memory / elasticsearch</div>
              </div>
            </div>
            <div class="notice notice-info" style="margin-top: 14px; font-size: 11.5px">
              <Icon name="info" :size="14" />
              <span>
                <span class="mono">hybrid.enabled = true</span> 时，向量库与 BM25 计数为 0 属正常现象——
                数据只写入 ES 混合索引。
              </span>
            </div>
          </div>
        </section>
      </div>

      <!-- 右侧 API 清单 -->
      <div class="col-side">
        <section class="card">
          <div class="card-head">
            <Icon name="link" :size="16" style="color: var(--brand-600)" />
            <h3>后端接口</h3>
            <span class="spacer" />
            <span class="tag">{{ API_LIST.length }}</span>
          </div>
          <div class="api-list">
            <div v-for="a in API_LIST" :key="a[1] + a[0]" class="api-row">
              <span class="method" :class="a[0].toLowerCase()">{{ a[0] }}</span>
              <div class="api-main">
                <div class="api-path mono">{{ a[1] }}</div>
                <div class="api-desc">{{ a[2] }}</div>
              </div>
            </div>
          </div>
        </section>

        <div class="refresh-note">
          最后更新：{{ lastUpdated ? formatTime(lastUpdated) : '—' }}
        </div>
      </div>
    </div>

    <Modal
      v-model:open="cacheModal"
      title="清空语义缓存？"
      tone="warn"
      confirm-text="清空"
      :loading="clearingCache"
      @confirm="doClearCache"
    >
      将调用 <span class="mono">DELETE /api/rag/cache</span> 丢弃全部缓存条目。
      不会影响知识库内容，只是下一次相同问题需要重新检索与生成。
    </Modal>
  </div>
</template>

<style scoped>
.kpis {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}
.kpi {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 15px 16px;
}
.kpi-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  flex: none;
}
.kpi-icon.brand {
  background: var(--brand-50);
  color: var(--brand-600);
}
.kpi-icon.violet {
  background: var(--violet-bg);
  color: var(--violet);
}
.kpi-icon.warn {
  background: var(--warn-bg);
  color: var(--warn);
}
.kpi-icon.ok {
  background: var(--ok-bg);
  color: var(--ok);
}
.kpi-main {
  min-width: 0;
}
.kpi-label {
  font-size: 11.5px;
  color: var(--ink-3);
  line-height: 1.3;
}
.kpi-value {
  font-size: 21px;
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.35;
}
.kpi-sub {
  font-size: 10.5px;
  color: var(--ink-4);
}

.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 330px;
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

/* ---------- 健康 ---------- */
.health-block {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-radius: var(--radius);
  background: var(--surface-2);
  border: 1px solid var(--line);
}
.hb-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--ink-4);
  flex: none;
  position: relative;
}
.health-block.up .hb-dot {
  background: var(--ok);
}
.health-block.down .hb-dot {
  background: var(--err);
}
.health-block.degraded .hb-dot {
  background: var(--warn);
}
.pulse-ring {
  position: absolute;
  inset: -5px;
  border-radius: 50%;
  border: 1.5px solid var(--ok);
  opacity: 0.45;
  animation: pulse 2s ease-out infinite;
}
@keyframes pulse {
  0% {
    transform: scale(0.7);
    opacity: 0.6;
  }
  100% {
    transform: scale(1.5);
    opacity: 0;
  }
}
.hb-main {
  min-width: 0;
}
.hb-title {
  font-size: 13.5px;
  font-weight: 600;
}
.hb-sub {
  font-size: 11px;
  color: var(--ink-4);
  margin-top: 1px;
}
.hb-meta {
  margin-left: auto;
  display: flex;
  gap: 26px;
}
.hb-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
  text-align: right;
}
.hb-item span {
  font-size: 10.5px;
  color: var(--ink-4);
}
.hb-item b {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-2);
}

/* ---------- 缓存 ---------- */
.cache-body {
  display: flex;
  align-items: center;
  gap: 28px;
}
.donut-wrap {
  position: relative;
  width: 96px;
  height: 96px;
  flex: none;
}
.donut {
  width: 96px;
  height: 96px;
}
.donut circle {
  transition: stroke-dasharray 0.5s ease;
}
.donut-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0;
}
.donut-center b {
  font-size: 17px;
  font-weight: 650;
  letter-spacing: -0.02em;
}
.donut-center span {
  font-size: 10px;
  color: var(--ink-4);
}
.cache-stats {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 20px;
}
.cs {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px dashed var(--line);
  font-size: 12px;
  color: var(--ink-3);
}
.cs b {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}

/* ---------- 存储 ---------- */
.store-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.store-item {
  padding: 12px 13px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-2);
}
.si-label {
  font-size: 11px;
  color: var(--ink-3);
}
.si-value {
  font-size: 18px;
  font-weight: 650;
  margin: 3px 0 2px;
  letter-spacing: -0.02em;
}
.si-sub {
  font-size: 10px;
  color: var(--ink-4);
  line-height: 1.45;
}

/* ---------- API ---------- */
.api-list {
  padding: 4px 8px 10px;
  max-height: none;
}
.api-row {
  display: flex;
  gap: 9px;
  padding: 8px 6px;
  border-radius: 6px;
}
.api-row:hover {
  background: var(--surface-2);
}
.method {
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 700;
  padding: 2px 5px;
  border-radius: 4px;
  height: 17px;
  line-height: 13px;
  flex: none;
  margin-top: 1px;
  letter-spacing: 0.02em;
}
.method.get {
  background: var(--info-bg);
  color: var(--info);
}
.method.post {
  background: var(--ok-bg);
  color: var(--ok);
}
.method.delete {
  background: var(--err-bg);
  color: var(--err);
}
.api-main {
  min-width: 0;
}
.api-path {
  font-size: 11px;
  color: var(--ink);
  word-break: break-all;
}
.api-desc {
  font-size: 10.5px;
  color: var(--ink-4);
  line-height: 1.5;
}
.refresh-note {
  font-size: 11px;
  color: var(--ink-4);
  text-align: center;
}
.spin {
  animation: spin 0.8s linear infinite;
}

@media (max-width: 1200px) {
  .kpis {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 1100px) {
  .grid {
    grid-template-columns: 1fr;
  }
  .store-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 640px) {
  .cache-body {
    flex-direction: column;
    align-items: flex-start;
    gap: 14px;
  }
  .hb-meta {
    display: none;
  }
}
</style>
