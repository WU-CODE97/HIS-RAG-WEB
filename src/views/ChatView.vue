<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import Modal from '@/components/Modal.vue'
import CitationList from '@/components/CitationList.vue'
import { useToast } from '@/composables/useToast'
import { useChatStore } from '@/stores/chat'
import { ROLE_OPTIONS, useIdentityStore } from '@/stores/identity'
import { clearConversation, getConversation, query, queryStream } from '@/api/rag'
import { renderMarkdown } from '@/utils/markdown'
import { formatMs } from '@/utils/format'

const identity = useIdentityStore()
const chat = useChatStore()
const toast = useToast()

const input = ref('')
const textareaRef = ref(null)
const bodyRef = ref(null)
const loading = ref(false)
const stage = ref(0)
const elapsed = ref(0)
const confirmOpen = ref(false)
const activeCite = ref(null)
const expandedCite = ref(null)
const citeSheetOpen = ref(false)

const STAGES = [
  { label: '解析问题与指代', icon: 'sparkles' },
  { label: '混合检索召回', icon: 'search' },
  { label: '候选片段重排', icon: 'layers' },
  { label: '生成答案并脱敏', icon: 'shield' },
]

const SAMPLES = [
  '高血压的一线用药有哪些，禁忌症是什么？',
  '工伤认定的申报流程需要哪些材料？',
  '门诊病历书写的规范要求有哪些？',
  '抗菌药物分级管理是如何规定的？',
]

let stageTimer = null
let elapsedTimer = null

function startTimers() {
  stopTimers()
  stage.value = 0
  elapsed.value = 0
  stageTimer = window.setInterval(() => {
    if (stage.value < STAGES.length - 1) stage.value += 1
  }, 800)
  elapsedTimer = window.setInterval(() => {
    elapsed.value += 100
  }, 100)
}
function stopTimers() {
  window.clearInterval(stageTimer)
  window.clearInterval(elapsedTimer)
}

const messages = computed(() => chat.messages)
const citations = computed(() => chat.citations)
const focused = computed(() => chat.focusedMessage)

const roleLabels = computed(() =>
  identity.roles.map((r) => ROLE_OPTIONS.find((o) => o.value === r)?.label || r),
)

function scrollToBottom(smooth = false) {
  nextTick(() => {
    const el = bodyRef.value
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  })
}

function autoGrow() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 180)}px`
}

watch(input, autoGrow)

async function send(raw) {
  const q = String(raw ?? input.value).trim()
  if (!q || loading.value) return

  input.value = ''
  nextTick(autoGrow)
  chat.addMessage({ role: 'user', content: q })
  const placeholder = chat.addMessage({
    role: 'assistant',
    content: '',
    pending: true,
    streaming: false,
    meta: { query: q, citations: [] },
  })
  loading.value = true
  startTimers()
  scrollToBottom(true)

  const startedAt = performance.now()
  let meta = { query: q, citations: [] }
  let text = ''
  let firstTokenMs = 0

  const applyMeta = (extra) => {
    meta = { ...meta, ...extra }
    chat.patchMessage(placeholder.id, { meta })
  }

  try {
    const { promise } = queryStream(
      { query: q, user: identity.payload, sessionId: chat.sessionId || undefined },
      {
        onMeta: (m) => {
          if (m.sessionId) {
            chat.setSession(m.sessionId)
            chat.focusedMessageId = placeholder.id
          }
          applyMeta({ ...m, citations: m.citations || [] })
          stage.value = 2
        },
        onDelta: (d) => {
          const chunk = d.text || ''
          if (!chunk) return
          if (!firstTokenMs) firstTokenMs = Math.round(performance.now() - startedAt)
          text += chunk
          chat.patchMessage(placeholder.id, { pending: false, streaming: true, content: text })
          scrollIfNearBottom()
        },
        onDone: (d) => {
          applyMeta({ ...d, firstTokenMs: firstTokenMs || undefined })
          chat.patchMessage(placeholder.id, {
            pending: false,
            streaming: false,
            content: text || '（后端未返回答案内容）',
          })
          if (d.error) toast.err('生成过程出错，答案可能不完整')
        },
        onFail: (e) => {
          throw new Error(e.message || '流式问答失败')
        },
      },
    )
    await promise
  } catch (e) {
    if (e.name === 'AbortError') return
    // 后端未部署流式接口时退回同步接口，避免整页不可用
    if (e.status === 404 || e.status === 405) {
      await sendFallback(q, placeholder)
      return
    }
    const forbidden = e.status === 403
    chat.patchMessage(placeholder.id, {
      pending: false,
      streaming: false,
      content: forbidden
        ? '当前会话不属于该身份，已为你重置会话。请重新提问。'
        : `请求失败：${e.message}`,
      meta: { ...meta, error: true, citations: [] },
    })
    if (forbidden) chat.setSession(null)
    toast.err(e.message)
  } finally {
    stopTimers()
    loading.value = false
    scrollToBottom(true)
  }
}

/** 同步接口兜底（仅当流式接口不存在时使用）。 */
async function sendFallback(q, placeholder) {
  try {
    const res = await query({
      query: q,
      user: identity.payload,
      sessionId: chat.sessionId || undefined,
    })
    chat.patchMessage(placeholder.id, {
      pending: false,
      streaming: false,
      content: res.answer || '（后端未返回答案内容）',
      meta: {
        query: q,
        sessionId: res.sessionId,
        rewrittenQuery: res.rewrittenQuery,
        citations: res.citations || [],
        piiMasked: res.piiMasked,
        cacheHit: res.cacheHit,
        error: res.error,
        latencyMs: res.latencyMs,
      },
    })
    chat.setSession(res.sessionId)
    chat.focusedMessageId = placeholder.id
    if (res.error) toast.err('生成过程出错，答案可能不完整')
  } catch (e) {
    chat.patchMessage(placeholder.id, {
      pending: false,
      content: `请求失败：${e.message}`,
      meta: { error: true, citations: [] },
    })
    toast.err(e.message)
  }
}

/** 仅在用户未向上翻阅时自动跟随到底部，避免打断阅读。 */
function scrollIfNearBottom() {
  const el = bodyRef.value
  if (!el) return
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 140) {
    el.scrollTop = el.scrollHeight
  }
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    send()
  }
}

function onMdClick(e) {
  const target = e.target.closest('[data-cite]')
  if (!target) return
  const idx = Number(target.dataset.cite)
  if (!Number.isFinite(idx)) return
  activeCite.value = idx
  expandedCite.value = idx
  // 找到该引用所属的消息，右侧面板同步切换
  const bubble = target.closest('[data-msg-id]')
  if (bubble) chat.focusedMessageId = bubble.dataset.msgId
  if (window.matchMedia('(max-width: 960px)').matches) {
    citeSheetOpen.value = true
    return
  }
  nextTick(() => {
    document.getElementById(`cite-${idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  })
}

function openCitations(msgId) {
  chat.focusedMessageId = msgId
  if (window.matchMedia('(max-width: 960px)').matches) citeSheetOpen.value = true
}

function onSelectCite(idx) {
  activeCite.value = idx
  expandedCite.value = idx
}

async function copyAnswer(text) {
  try {
    await navigator.clipboard.writeText(text)
    toast.ok('答案已复制')
  } catch {
    toast.err('复制失败，请手动选择文本')
  }
}

async function newSession() {
  if (loading.value) return
  const old = chat.sessionId
  chat.reset()
  activeCite.value = null
  if (old) clearConversation(old, identity.userId).catch(() => {})
  toast.ok('已开启新会话')
}

async function confirmClear() {
  confirmOpen.value = false
  await newSession()
}

onMounted(async () => {
  chat.init(identity.userId)
  if (!chat.messages.length && chat.sessionId) {
    try {
      const res = await getConversation(chat.sessionId, identity.userId)
      if (res.messages?.length) {
        chat.hydrate(chat.sessionId, res.messages)
        toast.info(`已恢复会话（${res.count} 条消息）`)
      }
    } catch {
      chat.setSession(null)
    }
  }
  scrollToBottom()
})

onBeforeUnmount(stopTimers)
</script>

<template>
  <div class="chat-page">
    <!-- 对话区 -->
    <section class="chat-main">
      <header class="chat-head">
        <div class="head-left">
          <div class="head-icon"><Icon name="chat" :size="16" /></div>
          <div>
            <div class="head-title">知识问答</div>
            <div class="head-sub">
              <template v-if="chat.sessionId">
                <span class="mono">{{ chat.sessionId.slice(0, 22) }}…</span>
                <span class="dot-sep">·</span>{{ messages.length }} 条消息
              </template>
              <template v-else>尚未创建会话，提问后由服务端自动分配</template>
            </div>
          </div>
        </div>
        <div class="head-right">
          <button class="btn btn-sm" :disabled="loading" @click="newSession">
            <Icon name="plus" :size="14" />
            <span class="btn-label">新会话</span>
          </button>
          <button
            class="btn btn-sm btn-ghost"
            :disabled="loading || !messages.length"
            title="清空服务端会话历史"
            @click="confirmOpen = true"
          >
            <Icon name="trash" :size="14" />
            <span class="btn-label">清空</span>
          </button>
        </div>
      </header>

      <div ref="bodyRef" class="chat-body scroll-thin" :class="{ 'empty-body': !messages.length }">
        <!-- 空状态 -->
        <div v-if="!messages.length" class="welcome">
          <div class="welcome-mark">
            <Icon name="pulse" :size="26" :stroke="2" />
          </div>
          <h2>{{ identity.name ? `${identity.name}，` : '' }}今天想查点什么？</h2>
          <p>
            答案基于院内知识库检索生成，并标注引用片段。
            当前身份可命中的范围：<b>{{ identity.departments.join('、') || '不限科室' }}</b>
            ·{{ roleLabels.join('、') || '未设置角色' }} · 密级 L{{ identity.clearanceLevel }}
          </p>
          <div class="samples">
            <button v-for="s in SAMPLES" :key="s" class="sample" @click="send(s)">
              <span>{{ s }}</span>
              <Icon name="arrow-right" :size="14" />
            </button>
          </div>
        </div>

        <!-- 消息列表 -->
        <div v-else class="messages">
          <div
            v-for="m in messages"
            :key="m.id"
            class="msg"
            :class="m.role"
            :data-msg-id="m.id"
          >
            <div v-if="m.role === 'assistant'" class="m-avatar ai">
              <Icon name="sparkles" :size="15" />
            </div>

            <div class="m-main">
              <!-- 用户消息 -->
              <div v-if="m.role === 'user'" class="m-bubble user-bubble">{{ m.content }}</div>

              <!-- 提问中的过程 -->
              <div v-else-if="m.pending" class="m-bubble ai-bubble pending">
                <div class="stage-list">
                  <div
                    v-for="(s, i) in STAGES"
                    :key="s.label"
                    class="stage"
                    :class="{ done: i < stage, active: i === stage }"
                  >
                    <span class="stage-dot">
                      <Icon v-if="i < stage" name="check" :size="10" :stroke="3" />
                      <span v-else-if="i === stage" class="spinner" style="width: 9px; height: 9px" />
                    </span>
                    <span>{{ s.label }}</span>
                  </div>
                </div>
                <div class="pending-foot tnum">
                  <Icon name="clock" :size="13" />
                  已等待 {{ (elapsed / 1000).toFixed(1) }}s
                  <span class="dim">· 检索与重排约 1 秒，答案会逐字显示</span>
                </div>
              </div>

              <!-- 助手答案 -->
              <template v-else>
                <div
                  class="m-bubble ai-bubble"
                  :class="{ 'has-error': m.meta?.error, streaming: m.streaming }"
                  @click="onMdClick"
                >
                  <div class="md" v-html="renderMarkdown(m.content)" />
                </div>

                <div class="m-meta">
                  <span v-if="m.meta?.cacheHit" class="tag tag-warn tag-dot">语义缓存命中</span>
                  <span v-if="m.meta?.piiMasked" class="tag tag-ok tag-dot">已脱敏</span>
                  <span v-if="m.meta?.error" class="tag tag-err tag-dot">生成异常</span>
                  <span v-if="m.meta?.citations?.length" class="tag tag-brand">
                    <Icon name="link" :size="11" />
                    {{ m.meta.citations.length }} 处引用
                  </span>
                  <span v-if="m.restored" class="tag">历史恢复</span>
                  <span v-if="m.meta?.latencyMs" class="meta-text tnum">
                    <Icon name="clock" :size="12" />{{ formatMs(m.meta.latencyMs) }}
                  </span>
                  <span v-if="m.meta?.firstTokenMs" class="meta-text tnum" title="从点击发送到收到第一个字">
                    <Icon name="sparkles" :size="12" />首字 {{ (m.meta.firstTokenMs / 1000).toFixed(1) }}s
                  </span>
                  <button
                    v-if="m.meta?.citations?.length"
                    class="meta-btn"
                    @click="openCitations(m.id)"
                  >
                    查看引用
                  </button>
                  <button class="meta-btn" @click="copyAnswer(m.content)">
                    <Icon name="copy" :size="12" /> 复制
                  </button>
                </div>

                <div
                  v-if="m.meta?.rewrittenQuery && m.meta.rewrittenQuery !== m.meta?.query"
                  class="rewrite"
                >
                  <Icon name="sparkles" :size="12" />
                  <span class="dim">多轮改写：</span>
                  <span>{{ m.meta.rewrittenQuery }}</span>
                </div>
              </template>
            </div>

            <div v-if="m.role === 'user'" class="m-avatar user-av">
              {{ identity.displayName.slice(0, 1) }}
            </div>
          </div>
        </div>
      </div>

      <!-- 输入区 -->
      <div class="composer">
        <div class="composer-box" :class="{ 'is-loading': loading }">
          <textarea
            ref="textareaRef"
            v-model="input"
            class="composer-input scroll-thin"
            rows="1"
            :placeholder="loading ? '正在生成答案，请稍候…' : '输入问题，Enter 发送，Shift + Enter 换行'"
            :disabled="loading"
            @keydown="onKeydown"
          />
          <div class="composer-bar">
            <div class="composer-hint">
              <span class="tag tag-brand"><Icon name="shield" :size="11" />ACL 过滤已生效</span>
              <span class="dim">答案由模型生成，请结合原文核对</span>
            </div>
            <button
              class="btn btn-primary send-btn"
              :disabled="loading || !input.trim()"
              @click="send()"
            >
              <span v-if="loading" class="spinner" />
              <Icon v-else name="send" :size="15" />
              {{ loading ? '生成中' : '发送' }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 溯源侧栏 -->
    <aside class="chat-aside scroll-thin">
      <div class="aside-block">
        <div class="aside-head">
          <h3>引用来源</h3>
          <span v-if="citations.length" class="tag">{{ citations.length }}</span>
        </div>

        <div v-if="!citations.length" class="empty" style="padding: 26px 12px">
          <div class="icon-wrap"><Icon name="link" :size="18" /></div>
          <span>答案生成后，引用的知识片段会显示在这里</span>
        </div>

        <CitationList
          v-else
          :citations="citations"
          :active="activeCite"
          @select="onSelectCite"
        />
      </div>

      <div class="aside-block">
        <div class="aside-head"><h3>会话信息</h3></div>
        <div class="info-list">
          <div class="info-row">
            <span>会话 ID</span>
            <span class="mono truncate" :title="chat.sessionId || ''">
              {{ chat.sessionId || '—' }}
            </span>
          </div>
          <div class="info-row">
            <span>归属用户</span>
            <span>{{ identity.displayName }}</span>
          </div>
          <div class="info-row">
            <span>上下文</span>
            <span>服务端维护 · {{ messages.length }} 条</span>
          </div>
          <div class="info-row">
            <span>最近耗时</span>
            <span class="tnum">
              {{ focused?.meta?.latencyMs ? formatMs(focused.meta.latencyMs) : '—' }}
            </span>
          </div>
        </div>
        <div class="aside-tags">
          <span v-for="d in identity.departments" :key="d" class="tag tag-brand">{{ d }}</span>
          <span v-for="r in roleLabels" :key="r" class="tag">{{ r }}</span>
          <span class="tag tag-info">L{{ identity.clearanceLevel }}</span>
        </div>
      </div>
    </aside>

    <!-- 移动端引用抽屉 -->
    <Teleport to="body">
      <transition name="fade">
        <div v-if="citeSheetOpen" class="modal-mask" @click.self="citeSheetOpen = false">
          <div class="cite-sheet">
            <header class="sheet-head">
              <h3>引用来源</h3>
              <span class="tag">{{ citations.length }}</span>
              <span class="spacer" />
              <button class="btn btn-ghost btn-icon" @click="citeSheetOpen = false">
                <Icon name="x" :size="16" />
              </button>
            </header>
            <CitationList
              :citations="citations"
              :active="activeCite"
              @select="onSelectCite"
            />
          </div>
        </div>
      </transition>
    </Teleport>

    <Modal
      v-model:open="confirmOpen"
      title="清空当前会话？"
      tone="warn"
      confirm-text="清空"
      @confirm="confirmClear"
    >
      将调用 <span class="mono">DELETE /api/rag/conversation/{sessionId}</span> 删除服务端保存的
      对话历史。清空后多轮追问将失去上下文，但不会删除知识库文档。
    </Modal>
  </div>
</template>

<style scoped>
.chat-page {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 16px;
  height: calc(100vh - var(--header-h) - 44px);
}

/* ---------- 对话主体 ---------- */
.chat-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  overflow: hidden;
}
.chat-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
  flex: none;
}
.head-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}
.head-icon {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  background: var(--brand-50);
  color: var(--brand-600);
  flex: none;
}
.head-title {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.35;
}
.head-sub {
  font-size: 11.5px;
  color: var(--ink-4);
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 44vw;
}
.head-sub .mono {
  overflow: hidden;
  text-overflow: ellipsis;
}
.dot-sep {
  margin: 0 2px;
}
.head-right {
  margin-left: auto;
  display: flex;
  gap: 6px;
}

.chat-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 20px 8px;
  scroll-behavior: smooth;
}
.chat-body.empty-body {
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ---------- 欢迎页 ---------- */
.welcome {
  max-width: 620px;
  margin: 0 auto;
  text-align: center;
  padding: 0 12px;
}
.welcome-mark {
  width: 52px;
  height: 52px;
  border-radius: 15px;
  margin: 0 auto 16px;
  display: grid;
  place-items: center;
  color: #fff;
  background: linear-gradient(145deg, var(--brand-500), var(--brand-700));
  box-shadow: 0 8px 20px -6px rgba(8, 127, 140, 0.5);
}
.welcome h2 {
  font-size: 20px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.welcome p {
  margin-top: 9px;
  font-size: 12.5px;
  line-height: 1.8;
  color: var(--ink-3);
}
.samples {
  margin-top: 22px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.sample {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 11px 13px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-2);
  font-size: 12.5px;
  color: var(--ink-2);
  text-align: left;
  cursor: pointer;
  transition: all 0.15s;
}
.sample:hover {
  border-color: var(--brand-300);
  background: var(--brand-50);
  color: var(--brand-800);
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}
.sample span {
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.sample svg {
  flex: none;
  opacity: 0.5;
}

/* ---------- 消息 ---------- */
.messages {
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 880px;
  margin: 0 auto;
  padding-bottom: 8px;
}
.msg {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.msg.user {
  justify-content: flex-end;
}
.m-avatar {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  flex: none;
  font-size: 12px;
  font-weight: 600;
}
.m-avatar.ai {
  background: var(--brand-50);
  color: var(--brand-600);
  border: 1px solid var(--brand-100);
}
.m-avatar.user-av {
  background: var(--brand-100);
  color: var(--brand-700);
  border: 1px solid var(--brand-200);
}
.m-main {
  min-width: 0;
  max-width: calc(100% - 44px);
}
.msg.assistant .m-main {
  max-width: min(100%, 760px);
}
.user-bubble {
  background: var(--brand-600);
  color: #fff;
  padding: 9px 14px;
  border-radius: 12px 12px 4px 12px;
  font-size: 13.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  box-shadow: 0 1px 2px rgba(8, 127, 140, 0.28);
}
.ai-bubble {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px 12px 12px 4px;
  padding: 13px 15px;
  box-shadow: var(--shadow-xs);
}
.ai-bubble.has-error {
  border-color: #f2c9c5;
  background: #fffbfb;
}
.ai-bubble.pending {
  background: var(--surface-2);
  border-style: dashed;
}
/* 流式输出中的光标：在正文末尾闪动，提示「还在写」 */
.ai-bubble.streaming .md::after {
  content: '▍';
  margin-left: 2px;
  color: var(--brand);
  animation: caret-blink 1s steps(2, start) infinite;
}
@keyframes caret-blink {
  50% {
    opacity: 0;
  }
}

.stage-list {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.stage {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 12.5px;
  color: var(--ink-4);
  transition: color 0.25s;
}
.stage.active {
  color: var(--brand-700);
  font-weight: 500;
}
.stage.done {
  color: var(--ink-2);
}
.stage-dot {
  width: 15px;
  height: 15px;
  border-radius: 50%;
  border: 1px solid var(--line-2);
  display: grid;
  place-items: center;
  flex: none;
  background: #fff;
  color: #fff;
}
.stage.done .stage-dot {
  background: var(--brand-600);
  border-color: var(--brand-600);
}
.stage.active .stage-dot {
  border-color: var(--brand-400);
  color: var(--brand-600);
}
.pending-foot {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--line);
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--ink-3);
}

.m-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 7px;
  padding-left: 2px;
}
.meta-text {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  color: var(--ink-4);
}
.meta-btn {
  border: 0;
  background: transparent;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11.5px;
  color: var(--ink-4);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
}
.meta-btn:hover {
  color: var(--brand-600);
  background: var(--brand-50);
}
.rewrite {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 6px;
  padding: 5px 9px;
  border-radius: 6px;
  background: var(--surface-3);
  font-size: 11.5px;
  color: var(--ink-3);
}

/* ---------- 输入区 ---------- */
.composer {
  flex: none;
  padding: 10px 16px 14px;
  background: linear-gradient(to top, var(--surface) 60%, rgba(255, 255, 255, 0));
}
.composer-box {
  border: 1px solid var(--line-2);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  transition: border-color 0.15s, box-shadow 0.15s;
  overflow: hidden;
}
.composer-box:focus-within {
  border-color: var(--brand-400);
  box-shadow: 0 0 0 3px rgba(8, 127, 140, 0.11);
}
.composer-box.is-loading {
  background: var(--surface-2);
}
.composer-input {
  width: 100%;
  border: 0;
  outline: none;
  resize: none;
  padding: 12px 14px 4px;
  font-size: 13.5px;
  line-height: 1.7;
  max-height: 180px;
  background: transparent;
  color: var(--ink);
}
.composer-input::placeholder {
  color: var(--ink-4);
}
.composer-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 10px 9px 12px;
}
.composer-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--ink-4);
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}
.send-btn {
  margin-left: auto;
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  flex: none;
}

/* ---------- 侧栏 ---------- */
.chat-aside {
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  padding-right: 2px;
}
.aside-block {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  overflow: hidden;
}
.aside-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 13px 14px 10px;
}
.aside-head h3 {
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.aside-head .tag {
  margin-left: auto;
}

.info-list {
  padding: 0 14px;
  display: flex;
  flex-direction: column;
}
.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 0;
  font-size: 11.5px;
  border-bottom: 1px dashed var(--line);
  color: var(--ink-3);
}
.info-row:last-child {
  border-bottom: 0;
}
.info-row > span:last-child {
  color: var(--ink-2);
  font-weight: 500;
  max-width: 62%;
  text-align: right;
}
.aside-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 4px 14px 14px;
}

/* ---------- 移动端引用抽屉 ---------- */
.cite-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 76vh;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-radius: 16px 16px 0 0;
  box-shadow: var(--shadow-lg);
  padding-bottom: 6px;
  animation: sheet-up 0.22s cubic-bezier(0.32, 0.72, 0, 1);
}
@keyframes sheet-up {
  from {
    transform: translateY(28px);
    opacity: 0.5;
  }
}
.sheet-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 14px 10px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 10px;
}
.sheet-head h3 {
  font-size: 13.5px;
  font-weight: 600;
}
.cite-sheet :deep(.cite-list) {
  max-height: none;
  overflow-y: auto;
}
@media (min-width: 961px) {
  .cite-sheet {
    left: auto;
    right: 24px;
    bottom: 24px;
    width: 400px;
    max-height: 70vh;
    border-radius: 14px;
    border: 1px solid var(--line);
  }
}

@media (max-width: 1180px) {
  .chat-page {
    grid-template-columns: minmax(0, 1fr) 280px;
  }
}
@media (max-width: 960px) {
  .chat-page {
    grid-template-columns: 1fr;
    height: auto;
  }
  .chat-main {
    height: calc(100vh - var(--header-h) - 44px);
  }
  .chat-aside {
    display: none;
  }
}
@media (max-width: 720px) {
  .chat-main {
    height: calc(100vh - var(--header-h) - 100px);
  }
  .samples {
    grid-template-columns: 1fr;
  }
  .msg.assistant .m-main,
  .m-main {
    max-width: calc(100% - 38px);
  }
  .btn-label {
    display: none;
  }
  .head-right .btn {
    width: 30px;
    padding: 0;
  }
  .composer-hint .dim {
    display: none;
  }
  .chat-body {
    padding: 14px 12px 6px;
  }
  .composer {
    padding: 8px 10px 12px;
  }
}
</style>
