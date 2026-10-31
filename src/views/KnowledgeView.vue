<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import Icon from '@/components/Icon.vue'
import Modal from '@/components/Modal.vue'
import { useToast } from '@/composables/useToast'
import { DEPARTMENT_OPTIONS, ROLE_OPTIONS } from '@/stores/identity'
import { clearDocuments, getStats, ingestFile, ingestJson } from '@/api/rag'
import { formatBytes, formatNumber } from '@/utils/format'

const toast = useToast()

const ACL = reactive({
  departments: [],
  roles: ['DOCTOR'],
  sensitivityLevel: 1,
  publicAccess: false,
})

const LEVELS = [
  { value: 0, label: 'L0 公开' },
  { value: 1, label: 'L1 内部' },
  { value: 2, label: 'L2 受限' },
  { value: 3, label: 'L3 机密' },
]

const ACCEPT = '.pdf,.docx,.docm,.dotx,.txt,.md,.markdown,.csv'
const MAX_SIZE = 50 * 1024 * 1024

const queue = ref([])
const uploading = ref(false)
const dragOver = ref(false)
const fileInput = ref(null)
const stats = ref(null)
const statsLoading = ref(false)
const clearOpen = ref(false)
const clearing = ref(false)

/* ---------- JSON 入库 ---------- */
const jsonOpen = ref(false)
const jsonText = ref(
  JSON.stringify(
    {
      documents: [
        {
          id: 'doc-001',
          title: '高血压诊疗指南（2024版）',
          content: 'ACEI 类药物在妊娠期禁用。常用一线降压药包括 ACEI、ARB、CCB、利尿剂……',
          source: 'guideline.pdf',
          accessControl: {
            departments: ['心内科'],
            roles: ['DOCTOR'],
            sensitivityLevel: 1,
            publicAccess: false,
          },
        },
      ],
    },
    null,
    2,
  ),
)
const jsonBusy = ref(false)

const totalChunks = computed(() =>
  queue.value.filter((f) => f.status === 'done').reduce((s, f) => s + (f.result?.chunks || 0), 0),
)
const pendingCount = computed(() => queue.value.filter((f) => f.status === 'ready').length)

function toggle(list, value) {
  const i = list.indexOf(value)
  if (i >= 0) list.splice(i, 1)
  else list.push(value)
}

function addFiles(files) {
  const accepted = []
  Array.from(files || []).forEach((file) => {
    const okType = /\.(pdf|docx|docm|dotx|txt|md|markdown|csv)$/i.test(file.name)
    if (!okType) {
      toast.err(`${file.name}：格式不支持，请上传 PDF / DOCX / TXT / MD / CSV`)
      return
    }
    if (file.size > MAX_SIZE) {
      toast.err(`${file.name}：超过 50MB 上限`)
      return
    }
    accepted.push({
      id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      file,
      name: file.name,
      size: file.size,
      title: file.name.replace(/\.[^.]+$/, ''),
      status: 'ready',
      progress: 0,
      result: null,
      error: '',
    })
  })
  queue.value.push(...accepted)
}

function onDrop(e) {
  dragOver.value = false
  addFiles(e.dataTransfer?.files)
}

function onPick(e) {
  addFiles(e.target.files)
  e.target.value = ''
}

function removeItem(id) {
  queue.value = queue.value.filter((f) => f.id !== id)
}

async function refreshStats() {
  statsLoading.value = true
  try {
    stats.value = await getStats()
  } catch {
    stats.value = null
  } finally {
    statsLoading.value = false
  }
}

async function startUpload() {
  const targets = queue.value.filter((f) => f.status === 'ready' || f.status === 'error')
  if (!targets.length) return
  uploading.value = true

  for (const item of targets) {
    item.status = 'uploading'
    item.progress = 0
    item.error = ''
    try {
      const res = await ingestFile(
        {
          file: item.file,
          title: item.title,
          accessControl: {
            departments: ACL.departments,
            roles: ACL.roles,
            sensitivityLevel: ACL.sensitivityLevel,
            publicAccess: ACL.publicAccess,
          },
        },
        {
          onProgress: (p) => {
            item.progress = p
          },
        },
      )
      item.result = res
      item.progress = 100
      item.status = res?.extracted ? 'done' : 'warn'
      if (!res?.extracted) {
        item.error = '未提取到文本，可能是扫描件，需要 OCR 预处理'
      }
    } catch (e) {
      item.status = 'error'
      item.error = e.message
    }
  }

  uploading.value = false
  await refreshStats()
  const done = targets.filter((f) => f.status === 'done').length
  if (done) toast.ok(`入库完成：${done} 个文件，共 ${totalChunks.value} 个片段`)
}

async function submitJson() {
  jsonBusy.value = true
  try {
    const parsed = JSON.parse(jsonText.value)
    const docs = Array.isArray(parsed) ? parsed : parsed.documents
    if (!Array.isArray(docs) || !docs.length) {
      throw new Error('documents 必须是非空数组')
    }
    const res = await ingestJson(docs)
    toast.ok(`JSON 入库成功：${res.documents} 个文档 / ${res.chunks} 个片段`)
    await refreshStats()
  } catch (e) {
    toast.err(e instanceof SyntaxError ? 'JSON 解析失败，请检查格式' : e.message)
  } finally {
    jsonBusy.value = false
  }
}

async function doClear() {
  clearing.value = true
  try {
    await clearDocuments()
    toast.ok('知识库已清空（片段 / 向量 / 索引 / 缓存）')
    await refreshStats()
    queue.value = []
  } catch (e) {
    toast.err(e.message)
  } finally {
    clearing.value = false
    clearOpen.value = false
  }
}

onMounted(refreshStats)
</script>

<template>
  <div class="knowledge-page">
    <div class="grid">
      <!-- 左：入库 -->
      <div class="col-main">
        <section class="card">
          <div class="card-head">
            <Icon name="upload" :size="16" style="color: var(--brand-600)" />
            <h3>文档入库</h3>
            <span class="sub">解析 → 切片 → 向量化 → 写索引</span>
            <span class="spacer" />
            <span class="tag tag-brand">单文件 ≤ 50MB</span>
          </div>

          <div class="card-body">
            <div
              class="dropzone"
              :class="{ over: dragOver }"
              @dragover.prevent="dragOver = true"
              @dragleave.prevent="dragOver = false"
              @drop.prevent="onDrop"
              @click="fileInput.click()"
            >
              <input
                ref="fileInput"
                type="file"
                multiple
                :accept="ACCEPT"
                hidden
                @change="onPick"
              />
              <div class="dz-icon"><Icon name="upload" :size="20" /></div>
              <div class="dz-title">拖拽文件到此处，或<u>点击选择</u></div>
              <div class="dz-types">
                <span class="tag">PDF</span>
                <span class="tag">DOCX</span>
                <span class="tag">TXT</span>
                <span class="tag">MD</span>
                <span class="tag">CSV</span>
              </div>
            </div>

            <!-- 队列 -->
            <transition name="slide">
              <div v-if="queue.length" class="queue">
                <div class="queue-head">
                  <span class="queue-title">待入库文件 · {{ queue.length }}</span>
                  <button
                    class="btn btn-sm btn-ghost"
                    :disabled="uploading"
                    @click="queue = []"
                  >
                    清空列表
                  </button>
                </div>
                <div v-for="item in queue" :key="item.id" class="q-item">
                  <div class="q-icon" :class="item.status">
                    <Icon :name="item.status === 'done' ? 'check' : item.status === 'error' ? 'alert' : 'file'" :size="14" />
                  </div>
                  <div class="q-main">
                    <div class="q-row">
                      <input
                        v-model="item.title"
                        class="input input-sm q-title"
                        :disabled="item.status === 'uploading' || item.status === 'done'"
                        placeholder="文档标题"
                      />
                      <span class="q-size mono">{{ formatBytes(item.size) }}</span>
                      <span v-if="item.status === 'done'" class="tag tag-ok">
                        {{ item.result?.chunks }} 片段
                      </span>
                      <span v-else-if="item.status === 'warn'" class="tag tag-warn">未提取到文本</span>
                      <span v-else-if="item.status === 'error'" class="tag tag-err">失败</span>
                      <span v-else-if="item.status === 'uploading'" class="tag tag-info tnum">
                        {{ item.progress }}%
                      </span>
                      <button
                        class="btn btn-ghost btn-icon"
                        style="width: 24px; height: 24px"
                        :disabled="uploading"
                        @click="removeItem(item.id)"
                      >
                        <Icon name="x" :size="12" />
                      </button>
                    </div>
                    <div v-if="item.status === 'uploading'" class="bar" style="margin-top: 5px">
                      <i :style="{ width: `${item.progress}%` }" />
                    </div>
                    <div v-if="item.error" class="q-err">{{ item.error }}</div>
                    <div v-else-if="item.result" class="q-ok mono">
                      {{ item.result.documentId }}
                    </div>
                  </div>
                </div>
              </div>
            </transition>

            <!-- ACL -->
            <div class="acl">
              <div class="acl-head">
                <Icon name="lock" :size="14" />
                <span>访问控制策略</span>
                <span class="dim">入库后生效，检索阶段按此过滤</span>
              </div>

              <div class="field">
                <label>可见科室 <span class="dim" style="font-weight: 400">（留空表示不限科室）</span></label>
                <div class="chip-group">
                  <button
                    v-for="d in DEPARTMENT_OPTIONS.slice(0, 10)"
                    :key="d"
                    class="chip"
                    :class="{ on: ACL.departments.includes(d) }"
                    @click="toggle(ACL.departments, d)"
                  >
                    {{ d }}
                  </button>
                </div>
              </div>

              <div class="acl-grid">
                <div class="field">
                  <label>可见角色 <span class="dim" style="font-weight: 400">（留空不限）</span></label>
                  <div class="chip-group">
                    <button
                      v-for="r in ROLE_OPTIONS"
                      :key="r.value"
                      class="chip"
                      :class="{ on: ACL.roles.includes(r.value) }"
                      @click="toggle(ACL.roles, r.value)"
                    >
                      {{ r.label }}
                    </button>
                  </div>
                </div>

                <div class="field">
                  <label>最低密级</label>
                  <div class="segmented" style="align-self: flex-start">
                    <button
                      v-for="lv in LEVELS"
                      :key="lv.value"
                      :class="{ on: ACL.sensitivityLevel === lv.value }"
                      @click="ACL.sensitivityLevel = lv.value"
                    >
                      {{ lv.label }}
                    </button>
                  </div>
                </div>
              </div>

              <label class="switch">
                <input v-model="ACL.publicAccess" type="checkbox" />
                <span class="track" />
                <span>对所有登录用户公开（忽略上述科室 / 角色 / 密级限制）</span>
              </label>
            </div>

            <div class="actions">
              <button
                class="btn btn-primary"
                :disabled="uploading || !pendingCount"
                @click="startUpload"
              >
                <span v-if="uploading" class="spinner" />
                <Icon v-else name="upload" :size="15" />
                {{ uploading ? '正在入库…' : `开始入库（${pendingCount}）` }}
              </button>
              <button class="btn" @click="fileInput.click()" :disabled="uploading">
                <Icon name="plus" :size="15" />
                添加文件
              </button>
              <span v-if="totalChunks" class="muted" style="font-size: 12px">
                本次已写入 {{ totalChunks }} 个片段
              </span>
            </div>
          </div>
        </section>

        <!-- JSON 入库 -->
        <section class="card">
          <div class="card-head clickable" @click="jsonOpen = !jsonOpen">
            <Icon name="file" :size="16" style="color: var(--brand-600)" />
            <h3>JSON 批量入库</h3>
            <span class="sub">适用于已清洗好的纯文本</span>
            <span class="spacer" />
            <Icon :name="jsonOpen ? 'chevron-down' : 'chevron-right'" :size="15" class="dim" />
          </div>
          <transition name="slide">
            <div v-if="jsonOpen" class="card-body">
              <div class="notice notice-info" style="margin-bottom: 12px">
                <Icon name="info" :size="15" />
                <span>
                  请求体为 <span class="mono">{ documents: Document[] }</span>，
                  每个 document 需包含 <span class="mono">id / title / content</span>，
                  可选 <span class="mono">source</span> 与 <span class="mono">accessControl</span>。
                </span>
              </div>
              <textarea v-model="jsonText" class="textarea mono" rows="12" spellcheck="false" />
              <div class="row-gap" style="margin-top: 10px">
                <button class="btn btn-primary" :disabled="jsonBusy" @click="submitJson">
                  <span v-if="jsonBusy" class="spinner" />
                  <Icon v-else name="upload" :size="15" />
                  提交入库
                </button>
                <span class="dim" style="font-size: 12px">入库会自动失效语义缓存</span>
              </div>
            </div>
          </transition>
        </section>
      </div>

      <!-- 右：统计与说明 -->
      <div class="col-side">
        <section class="card">
          <div class="card-head">
            <Icon name="database" :size="16" style="color: var(--brand-600)" />
            <h3>知识库规模</h3>
            <span class="spacer" />
            <button class="btn btn-ghost btn-icon" title="刷新" @click="refreshStats">
              <Icon name="refresh" :size="14" :class="{ spin: statsLoading }" />
            </button>
          </div>
          <div v-if="!stats" class="card-body">
            <template v-if="statsLoading">
              <div v-for="i in 3" :key="i" class="skeleton" style="height: 14px; margin-bottom: 10px" />
            </template>
            <div v-else class="stats-error">
              <span>无法获取统计</span>
              <button class="btn btn-sm" @click="refreshStats">
                <Icon name="refresh" :size="13" />
                重试
              </button>
            </div>
          </div>
          <div v-else class="stat-list">
            <div class="stat-row">
              <span>知识片段</span>
              <b class="tnum">{{ formatNumber(stats.chunks) }}</b>
            </div>
            <div class="stat-row">
              <span>向量条数</span>
              <b class="tnum">{{ formatNumber(stats.vectors) }}</b>
            </div>
            <div class="stat-row">
              <span>BM25 文档</span>
              <b class="tnum">{{ formatNumber(stats.bm25Documents) }}</b>
            </div>
            <div class="stat-row">
              <span>混合索引</span>
              <b v-if="stats.hybrid?.enabled" class="tnum" style="color: var(--brand-700)">
                {{ stats.hybrid.documents }} 条
              </b>
              <span v-else class="tag">未启用</span>
            </div>
            <div v-if="stats.hybrid?.backend" class="stat-backend mono">
              {{ stats.hybrid.backend }}
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <Icon name="info" :size="16" style="color: var(--brand-600)" />
            <h3>入库须知</h3>
          </div>
          <div class="card-body tips">
            <div class="tip">
              <b>切片规则</b>
              <span>按配置长度（默认 400 字符）切片，相邻片段保留重叠，便于上下文连续。</span>
            </div>
            <div class="tip">
              <b>扫描件不支持</b>
              <span>PDF 仅能提取文本层，纯图片 PDF 返回 <span class="mono">extracted: false</span>，需先 OCR。</span>
            </div>
            <div class="tip">
              <b>ACL 语义</b>
              <span>科室、角色、密级三者需同时满足；任意一项留空视为不限制。</span>
            </div>
            <div class="tip">
              <b>无文档列表接口</b>
              <span>后端未提供文档清单查询，此页只展示规模统计；删除文档需清空整个知识库。</span>
            </div>
          </div>
        </section>

        <section class="card danger-card">
          <div class="card-head">
            <Icon name="alert" :size="16" style="color: var(--err)" />
            <h3>危险操作</h3>
          </div>
          <div class="card-body">
            <p class="danger-text">
              清空知识库会删除全部片段、向量、BM25 与混合索引，并失效语义缓存，操作不可恢复。
            </p>
            <button class="btn btn-danger btn-block" @click="clearOpen = true">
              <Icon name="trash" :size="15" />
              清空知识库
            </button>
          </div>
        </section>
      </div>
    </div>

    <Modal
      v-model:open="clearOpen"
      title="确认清空整个知识库？"
      tone="err"
      confirm-text="确认清空"
      :loading="clearing"
      @confirm="doClear"
    >
      该操作会调用 <span class="mono">DELETE /api/rag/documents</span>，
      删除所有知识片段与索引并失效语义缓存，<b>无法撤销</b>。请确认当前环境不是生产库。
    </Modal>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
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

/* ---------- 拖拽区 ---------- */
.dropzone {
  border: 1.5px dashed var(--line-2);
  border-radius: var(--radius-lg);
  background: var(--surface-2);
  padding: 26px 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.16s;
}
.dropzone:hover {
  border-color: var(--brand-300);
  background: var(--brand-50);
}
.dropzone.over {
  border-color: var(--brand-500);
  background: var(--brand-50);
  box-shadow: inset 0 0 0 3px rgba(8, 127, 140, 0.08);
}
.dz-icon {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  margin: 0 auto 10px;
  display: grid;
  place-items: center;
  background: #fff;
  color: var(--brand-600);
  border: 1px solid var(--brand-100);
  box-shadow: var(--shadow-xs);
}
.dz-title {
  font-size: 13px;
  color: var(--ink-2);
  font-weight: 500;
}
.dz-title u {
  color: var(--brand-600);
  text-decoration-color: var(--brand-200);
  text-underline-offset: 3px;
}
.dz-types {
  display: flex;
  gap: 5px;
  justify-content: center;
  margin-top: 9px;
}

/* ---------- 队列 ---------- */
.queue {
  margin-top: 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
}
.queue-head {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--line);
}
.queue-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
}
.queue-head .btn {
  margin-left: auto;
}
.q-item {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  background: #fff;
}
.q-item:last-child {
  border-bottom: 0;
}
.q-icon {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  background: var(--surface-3);
  color: var(--ink-3);
  flex: none;
  margin-top: 3px;
}
.q-icon.done {
  background: var(--ok-bg);
  color: var(--ok);
}
.q-icon.error {
  background: var(--err-bg);
  color: var(--err);
}
.q-main {
  flex: 1;
  min-width: 0;
}
.q-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.q-title {
  flex: 1;
  min-width: 0;
  font-weight: 500;
}
.q-size {
  color: var(--ink-4);
  font-size: 11px;
  flex: none;
}
.q-err {
  margin-top: 5px;
  font-size: 11.5px;
  color: var(--err);
  line-height: 1.5;
}
.q-ok {
  margin-top: 4px;
  color: var(--ink-4);
  font-size: 10.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- ACL ---------- */
.acl {
  margin-top: 18px;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-2);
  display: flex;
  flex-direction: column;
  gap: 13px;
}
.acl-head {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-2);
}
.acl-head .dim {
  font-weight: 400;
  font-size: 11.5px;
}
.acl-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}

/* ---------- 右侧 ---------- */
.stat-list {
  padding: 6px 16px 14px;
}
.stat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 0;
  border-bottom: 1px dashed var(--line);
  font-size: 12.5px;
  color: var(--ink-3);
}
.stat-row b {
  font-size: 14px;
  color: var(--ink);
  font-weight: 600;
}
.stat-backend {
  margin-top: 8px;
  font-size: 10.5px;
  color: var(--ink-4);
  word-break: break-all;
}
.stats-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--ink-3);
}
.tips {
  display: flex;
  flex-direction: column;
  gap: 11px;
}
.tip {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tip b {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
}
.tip span {
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--ink-3);
}
.danger-card {
  border-color: #f2d5d2;
}
.danger-text {
  font-size: 12px;
  line-height: 1.65;
  color: var(--ink-3);
  margin-bottom: 12px;
}
.clickable {
  cursor: pointer;
  user-select: none;
}
.clickable:hover {
  background: var(--surface-2);
}
.spin {
  animation: spin 0.8s linear infinite;
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
  .danger-card {
    grid-column: 1 / -1;
  }
}
@media (max-width: 760px) {
  .col-side,
  .acl-grid {
    grid-template-columns: 1fr;
  }
}
</style>
