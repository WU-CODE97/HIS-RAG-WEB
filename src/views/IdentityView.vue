<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import { useToast } from '@/composables/useToast'
import {
  DEPARTMENT_OPTIONS,
  ROLE_OPTIONS,
  useIdentityStore,
} from '@/stores/identity'

const router = useRouter()
const route = useRoute()
const identity = useIdentityStore()
const toast = useToast()

const form = ref({
  userId: identity.profile?.userId || '',
  name: identity.profile?.name || '',
  departments: [...(identity.profile?.departments || [])],
  roles: [...(identity.profile?.roles || ['DOCTOR'])],
  clearanceLevel: identity.profile?.clearanceLevel ?? 1,
})

const customDept = ref('')
const error = ref('')

const LEVELS = [
  { value: 0, label: '公开', hint: '可读公开级文档' },
  { value: 1, label: '内部', hint: '一般诊疗资料' },
  { value: 2, label: '受限', hint: '含患者隐私数据' },
  { value: 3, label: '机密', hint: '院级敏感数据' },
]

const PRESETS = [
  { key: 'doctor', title: '心内科医生', desc: '可读本科室指南与公开文档', data: { userId: 'D001', name: '张启明', departments: ['心内科'], roles: ['DOCTOR'], clearanceLevel: 1 } },
  { key: 'pharmacist', title: '药学部药师', desc: '侧重药品说明书与用药规范', data: { userId: 'P007', name: '李静', departments: ['药学部'], roles: ['PHARMACIST'], clearanceLevel: 1 } },
  { key: 'nurse', title: '急诊科护士', desc: '护理流程与操作规范', data: { userId: 'N023', name: '王悦', departments: ['急诊科'], roles: ['NURSE'], clearanceLevel: 0 } },
  { key: 'admin', title: '系统管理员', desc: '可访问全部密级文档', data: { userId: 'admin', name: '信息中心', departments: ['医务处'], roles: ['ADMIN'], clearanceLevel: 3 } },
]

function toggleDept(dep) {
  const idx = form.value.departments.indexOf(dep)
  if (idx >= 0) form.value.departments.splice(idx, 1)
  else form.value.departments.push(dep)
}

function toggleRole(role) {
  const idx = form.value.roles.indexOf(role)
  if (idx >= 0) form.value.roles.splice(idx, 1)
  else form.value.roles.push(role)
}

function addCustomDept() {
  const v = customDept.value.trim()
  if (!v) return
  if (!form.value.departments.includes(v)) form.value.departments.push(v)
  customDept.value = ''
}

function applyPreset(preset) {
  form.value = { ...preset.data, departments: [...preset.data.departments], roles: [...preset.data.roles] }
  error.value = ''
}

const deptExtra = computed(() =>
  form.value.departments.filter((d) => !DEPARTMENT_OPTIONS.includes(d)),
)

function submit() {
  if (!form.value.userId.trim()) {
    error.value = '请填写工号 / 账号，后端用它标识会话归属'
    return
  }
  if (!form.value.roles.length) {
    error.value = '至少选择一个角色，检索权限按角色过滤'
    return
  }
  identity.save(form.value)
  toast.ok(`已切换为 ${form.value.name || form.value.userId}`)
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/chat'
  router.replace(redirect)
}
</script>

<template>
  <div class="identity-page">
    <div class="identity-shell">
      <!-- 左侧品牌区 -->
      <section class="pitch">
        <div class="pitch-grid" />
        <div class="cross-mark" aria-hidden="true">
          <svg viewBox="0 0 100 100" fill="none">
            <path d="M40 8h20v32h32v20H60v32H40V60H8V40h32z" fill="currentColor" />
          </svg>
        </div>

        <div class="pitch-top">
          <div class="mark">
            <Icon name="pulse" :size="20" :stroke="2.2" />
          </div>
          <div>
            <div class="mark-name">HIS-RAG</div>
            <div class="mark-sub">医院知识智能问答平台</div>
          </div>
        </div>

        <div class="pitch-body">
          <h1>让每一条院内知识<br />都能被准确检索与引用</h1>
          <p class="lede">
            向量语义召回与 BM25 关键词召回并行，经 LLM 重排后生成带引用的答案；
            文档级权限策略贯穿检索全程，答案出库前统一做隐私脱敏。
          </p>

          <ul class="features">
            <li>
              <span class="fi"><Icon name="layers" :size="15" /></span>
              <div>
                <b>混合检索</b>
                <span>向量 + BM25 双路召回，RRF 融合排序</span>
              </div>
            </li>
            <li>
              <span class="fi"><Icon name="shield" :size="15" /></span>
              <div>
                <b>权限贯穿</b>
                <span>科室 / 角色 / 密级三维 ACL，检索阶段过滤</span>
              </div>
            </li>
            <li>
              <span class="fi"><Icon name="link" :size="15" /></span>
              <div>
                <b>引用溯源</b>
                <span>每个结论标注片段来源，可回查原文</span>
              </div>
            </li>
            <li>
              <span class="fi"><Icon name="chat" :size="15" /></span>
              <div>
                <b>多轮会话</b>
                <span>服务端维护上下文，追问自动补全指代</span>
              </div>
            </li>
          </ul>
        </div>

        <div class="pitch-foot">
          <span class="tag tag-brand tag-dot">Spring Boot 3.2 · RAG Service</span>
          <span class="muted mono">/api/rag</span>
        </div>
      </section>

      <!-- 右侧表单 -->
      <section class="panel">
        <div class="panel-inner scroll-thin">
          <header class="panel-head">
            <div class="row" style="justify-content: space-between; align-items: flex-start; gap: 10px">
              <h2>{{ identity.ready ? '切换访问身份' : '设置访问身份' }}</h2>
              <button v-if="identity.ready" class="btn btn-sm btn-ghost" @click="router.push('/chat')">
                <Icon name="chevron-left" :size="14" />
                返回工作台
              </button>
            </div>
            <p>
              身份决定检索时可命中的文档范围。这里不做真实的账号鉴权，
              仅把用户上下文（<span class="mono">UserContext</span>）带给后端用于 ACL 判定。
            </p>
          </header>

          <div class="presets">
            <button
              v-for="p in PRESETS"
              :key="p.key"
              class="preset"
              :class="{ on: form.userId === p.data.userId }"
              @click="applyPreset(p)"
            >
              <span class="preset-title">{{ p.title }}</span>
              <span class="preset-desc">{{ p.desc }}</span>
            </button>
          </div>

          <div class="form">
            <div class="grid-2">
              <div class="field">
                <label>工号 / 账号 <span class="required">*</span></label>
                <input v-model="form.userId" class="input" placeholder="如 D001" @keyup.enter="submit" />
              </div>
              <div class="field">
                <label>姓名</label>
                <input v-model="form.name" class="input" placeholder="如 张启明" @keyup.enter="submit" />
              </div>
            </div>

            <div class="field">
              <label>所属科室 <span class="dim" style="font-weight: 400">（可多选）</span></label>
              <div class="chip-group">
                <button
                  v-for="d in [...DEPARTMENT_OPTIONS, ...deptExtra]"
                  :key="d"
                  class="chip"
                  :class="{ on: form.departments.includes(d) }"
                  @click="toggleDept(d)"
                >
                  {{ d }}
                </button>
              </div>
              <div class="row-gap" style="margin-top: 4px">
                <input
                  v-model="customDept"
                  class="input input-sm"
                  style="width: 150px"
                  placeholder="其他科室，回车添加"
                  @keyup.enter="addCustomDept"
                />
                <span class="help">不选科室时，仅能命中不限科室的文档</span>
              </div>
            </div>

            <div class="field">
              <label>角色 <span class="required">*</span></label>
              <div class="chip-group">
                <button
                  v-for="r in ROLE_OPTIONS"
                  :key="r.value"
                  class="chip"
                  :class="{ on: form.roles.includes(r.value) }"
                  @click="toggleRole(r.value)"
                >
                  {{ r.label }}
                  <span class="mono" style="opacity: 0.6">{{ r.value }}</span>
                </button>
              </div>
            </div>

            <div class="field">
              <label>访问密级</label>
              <div class="segmented" style="align-self: flex-start">
                <button
                  v-for="lv in LEVELS"
                  :key="lv.value"
                  :class="{ on: form.clearanceLevel === lv.value }"
                  @click="form.clearanceLevel = lv.value"
                >
                  L{{ lv.value }} {{ lv.label }}
                </button>
              </div>
              <div class="help">
                {{ LEVELS.find((l) => l.value === form.clearanceLevel)?.hint }} ·
                可命中密级 ≤ L{{ form.clearanceLevel }} 的文档
              </div>
            </div>

            <transition name="slide">
              <div v-if="error" class="notice notice-err">
                <Icon name="alert" :size="15" />
                <span>{{ error }}</span>
              </div>
            </transition>

            <button class="btn btn-primary btn-lg btn-block" @click="submit">
              进入工作台
              <Icon name="arrow-right" :size="16" />
            </button>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.identity-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 28px;
  background:
    radial-gradient(900px 500px at 8% -10%, #e3f4f6 0%, transparent 60%),
    radial-gradient(700px 400px at 100% 100%, #eef2ff 0%, transparent 55%),
    var(--bg);
}

.identity-shell {
  width: min(1120px, 100%);
  min-height: min(720px, calc(100vh - 56px));
  display: grid;
  grid-template-columns: 1.05fr 1fr;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 22px;
  box-shadow: 0 32px 64px -24px rgba(16, 40, 56, 0.22), 0 2px 8px rgba(16, 40, 56, 0.04);
  overflow: hidden;
}

/* ---------- 左侧 ---------- */
.pitch {
  position: relative;
  padding: 34px 38px;
  display: flex;
  flex-direction: column;
  background: linear-gradient(158deg, #f0fafb 0%, #f7fbfc 45%, #eef4fa 100%);
  border-right: 1px solid var(--line);
  overflow: hidden;
}
.pitch-grid {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(circle at 1px 1px, rgba(8, 127, 140, 0.14) 1px, transparent 0);
  background-size: 22px 22px;
  mask-image: radial-gradient(ellipse at 75% 12%, #000 0%, transparent 72%);
}
.cross-mark {
  position: absolute;
  right: -70px;
  bottom: -60px;
  width: 320px;
  color: rgba(8, 127, 140, 0.05);
}
.cross-mark svg {
  width: 100%;
}

.pitch-top {
  position: relative;
  display: flex;
  align-items: center;
  gap: 11px;
}
.mark {
  width: 38px;
  height: 38px;
  border-radius: 11px;
  display: grid;
  place-items: center;
  color: #fff;
  background: linear-gradient(145deg, var(--brand-500), var(--brand-700));
  box-shadow: 0 3px 10px rgba(8, 127, 140, 0.32);
}
.mark-name {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.06em;
}
.mark-sub {
  font-size: 11.5px;
  color: var(--ink-3);
  letter-spacing: 0.04em;
}

.pitch-body {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 24px 0;
}
.pitch-body h1 {
  font-size: 27px;
  line-height: 1.42;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--ink);
}
.lede {
  margin-top: 14px;
  font-size: 13px;
  line-height: 1.85;
  color: var(--ink-3);
  max-width: 92%;
}

.features {
  list-style: none;
  padding: 0;
  margin: 26px 0 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.features li {
  display: flex;
  gap: 11px;
  padding: 10px 12px;
  border-radius: var(--radius);
  transition: background 0.16s;
}
.features li:hover {
  background: rgba(255, 255, 255, 0.75);
}
.fi {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: #fff;
  color: var(--brand-600);
  border: 1px solid var(--brand-100);
  flex: none;
  box-shadow: var(--shadow-xs);
}
.features b {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  line-height: 1.5;
}
.features span:not(.fi) {
  font-size: 12px;
  color: var(--ink-3);
  line-height: 1.5;
}

.pitch-foot {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
}

/* ---------- 右侧 ---------- */
.panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.panel-inner {
  padding: 34px 34px 30px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.panel-head h2 {
  font-size: 19px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.panel-head p {
  margin-top: 7px;
  font-size: 12.5px;
  line-height: 1.75;
  color: var(--ink-3);
}

.presets {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.preset {
  text-align: left;
  padding: 10px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--line);
  background: var(--surface-2);
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.preset:hover {
  border-color: var(--brand-300);
  background: var(--brand-50);
}
.preset.on {
  border-color: var(--brand-400);
  background: var(--brand-50);
  box-shadow: inset 0 0 0 1px var(--brand-200);
}
.preset-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink);
}
.preset-desc {
  font-size: 11px;
  color: var(--ink-3);
  line-height: 1.45;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

@media (max-width: 900px) {
  .identity-shell {
    grid-template-columns: 1fr;
  }
  .pitch {
    display: none;
  }
}
@media (max-width: 560px) {
  .identity-page {
    padding: 0;
  }
  .identity-shell {
    border-radius: 0;
    border: 0;
    min-height: 100vh;
  }
  .panel-inner {
    padding: 24px 18px;
  }
  .grid-2,
  .presets {
    grid-template-columns: 1fr;
  }
}
</style>
