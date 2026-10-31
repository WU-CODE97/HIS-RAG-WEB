<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import { useIdentityStore, ROLE_OPTIONS } from '@/stores/identity'
import { getHealth } from '@/api/rag'

const route = useRoute()
const router = useRouter()
const identity = useIdentityStore()

const NAV = [
  { name: 'chat', to: '/chat', label: '智能问答', icon: 'chat', desc: '多轮对话' },
  { name: 'knowledge', to: '/knowledge', label: '知识库', icon: 'database', desc: '文档入库' },
  { name: 'retrieve', to: '/retrieve', label: '检索调试', icon: 'search', desc: '召回分析' },
  { name: 'evaluation', to: '/evaluation', label: '效果评估', icon: 'target', desc: '指标评测' },
  { name: 'monitor', to: '/monitor', label: '系统监控', icon: 'activity', desc: '运行状态' },
]

const pageTitle = computed(() => route.meta.title || 'HIS-RAG')
const pageSubtitle = computed(() => route.meta.subtitle || '')

const health = ref({ status: 'checking', latency: null, checkedAt: null })
let timer = null

async function checkHealth() {
  const t0 = performance.now()
  try {
    const res = await getHealth()
    health.value = {
      status: res?.status === 'UP' ? 'up' : 'degraded',
      latency: Math.round(performance.now() - t0),
      checkedAt: Date.now(),
    }
  } catch {
    health.value = { status: 'down', latency: null, checkedAt: Date.now() }
  }
}

onMounted(() => {
  checkHealth()
  timer = window.setInterval(checkHealth, 30000)
})
onBeforeUnmount(() => window.clearInterval(timer))

const roleLabels = computed(() =>
  identity.roles.map((r) => ROLE_OPTIONS.find((o) => o.value === r)?.label || r),
)
const initials = computed(() => {
  const n = identity.name || identity.userId || '?'
  return n.slice(0, n.length > 2 ? 1 : 2).toUpperCase()
})

function switchIdentity() {
  router.push('/identity')
}
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand" @click="router.push('/chat')">
        <div class="brand-mark">
          <Icon name="pulse" :size="19" :stroke="2.2" />
        </div>
        <div class="brand-text">
          <div class="brand-name">HIS-RAG</div>
          <div class="brand-sub">医院知识中枢</div>
        </div>
      </div>

      <nav class="nav">
        <div class="nav-label">工作台</div>
        <router-link
          v-for="item in NAV"
          :key="item.name"
          :to="item.to"
          class="nav-item"
          :class="{ active: route.name === item.name }"
        >
          <Icon :name="item.icon" :size="17" />
          <span class="nav-text">{{ item.label }}</span>
          <span class="nav-desc">{{ item.desc }}</span>
        </router-link>
      </nav>

      <div class="sidebar-foot">
        <div class="user-card">
          <div class="avatar">{{ initials }}</div>
          <div class="user-meta">
            <div class="user-name truncate">{{ identity.displayName }}</div>
            <div class="user-sub truncate">
              {{ identity.userId }} · L{{ identity.clearanceLevel }}
              <template v-if="identity.departments.length">
                · {{ identity.departments[0] }}
              </template>
            </div>
          </div>
          <button class="btn btn-ghost btn-icon" title="切换身份" @click="switchIdentity">
            <Icon name="switch" :size="15" />
          </button>
        </div>
        <div class="version">v1.0 · Spring Boot RAG 服务</div>
      </div>
    </aside>

    <div class="main-wrap">
      <header class="topbar">
        <div class="topbar-title">
          <h1>{{ pageTitle }}</h1>
          <span v-if="pageSubtitle" class="topbar-sub">{{ pageSubtitle }}</span>
        </div>
        <div class="topbar-right">
          <div class="health" :class="health.status" :title="`最近检查：${health.checkedAt ? new Date(health.checkedAt).toLocaleTimeString('zh-CN') : '—'}`">
            <span class="dot" />
            <span class="health-text">
              {{ health.status === 'up' ? '服务正常' : health.status === 'checking' ? '检测中' : health.status === 'degraded' ? '服务降级' : '后端未连接' }}
            </span>
            <span v-if="health.latency != null" class="health-latency tnum">{{ health.latency }}ms</span>
          </div>
          <button class="btn btn-ghost btn-icon" title="重新检测" @click="checkHealth">
            <Icon name="refresh" :size="15" />
          </button>
        </div>
      </header>

      <main class="content scroll-thin">
        <router-view v-slot="{ Component }">
          <transition name="fade-page" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

/* ---------- 侧边栏 ---------- */
.sidebar {
  width: var(--sidebar-w);
  flex: none;
  background: var(--surface);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  padding: 16px 12px 12px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px 18px;
  cursor: pointer;
}
.brand-mark {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  color: #fff;
  background: linear-gradient(145deg, var(--brand-500), var(--brand-700));
  box-shadow: 0 2px 6px rgba(8, 127, 140, 0.35);
  flex: none;
}
.brand-name {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1.2;
}
.brand-sub {
  font-size: 11px;
  color: var(--ink-4);
  letter-spacing: 0.06em;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-height: 0;
}
.nav-label {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--ink-4);
  padding: 6px 10px;
  text-transform: uppercase;
}
.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: var(--radius-sm);
  color: var(--ink-2);
  font-size: 13.5px;
  font-weight: 500;
  transition: background 0.14s, color 0.14s;
}
.nav-item:hover {
  background: var(--surface-3);
  color: var(--ink);
}
.nav-item.active {
  background: var(--brand-50);
  color: var(--brand-700);
  font-weight: 600;
}
.nav-item.active::before {
  content: '';
  position: absolute;
  left: -12px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 18px;
  border-radius: 0 3px 3px 0;
  background: var(--brand-600);
}
.nav-text {
  flex: 1;
}
.nav-desc {
  font-size: 10.5px;
  color: var(--ink-4);
  font-weight: 400;
  opacity: 0;
  transition: opacity 0.14s;
}
.nav-item:hover .nav-desc,
.nav-item.active .nav-desc {
  opacity: 1;
}

.sidebar-foot {
  border-top: 1px solid var(--line);
  padding-top: 10px;
  margin-top: 8px;
}
.user-card {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 4px 6px 6px;
  border-radius: var(--radius-sm);
}
.user-card:hover {
  background: var(--surface-2);
}
.avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--brand-100);
  color: var(--brand-700);
  font-size: 12px;
  font-weight: 600;
  flex: none;
}
.user-meta {
  min-width: 0;
  flex: 1;
}
.user-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink);
  line-height: 1.3;
}
.user-sub {
  font-size: 11px;
  color: var(--ink-4);
}
.version {
  font-size: 10.5px;
  color: var(--ink-4);
  padding: 6px 8px 0;
}

/* ---------- 主区域 ---------- */
.main-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.topbar {
  height: var(--header-h);
  flex: none;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 24px;
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--line);
}
.topbar-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}
.topbar-title h1 {
  font-size: 17px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.topbar-sub {
  font-size: 12px;
  color: var(--ink-4);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.topbar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
}
.health {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 99px;
  background: var(--surface-3);
  font-size: 12px;
  color: var(--ink-2);
  white-space: nowrap;
}
.health .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ink-4);
}
.health.up .dot {
  background: var(--ok);
  box-shadow: 0 0 0 3px rgba(6, 118, 71, 0.14);
}
.health.down {
  background: var(--err-bg);
  color: #8f1d14;
}
.health.down .dot {
  background: var(--err);
  box-shadow: 0 0 0 3px rgba(180, 35, 24, 0.14);
}
.health.degraded {
  background: var(--warn-bg);
  color: #7c3407;
}
.health.degraded .dot {
  background: var(--warn);
}
.health-latency {
  color: var(--ink-4);
  font-size: 11px;
  padding-left: 5px;
  border-left: 1px solid var(--line-2);
}

.content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 20px 24px 24px;
}

/* ---------- 响应式 ---------- */
@media (max-width: 1080px) {
  .sidebar {
    width: 68px;
    padding: 16px 8px 12px;
    align-items: center;
  }
  .brand {
    padding: 4px 0 16px;
    justify-content: center;
  }
  .brand-text,
  .nav-label,
  .nav-text,
  .nav-desc,
  .user-meta,
  .version,
  .user-card .btn {
    display: none;
  }
  .nav-item {
    justify-content: center;
    padding: 10px;
    width: 44px;
  }
  .nav-item.active::before {
    left: -8px;
  }
  .user-card {
    justify-content: center;
    padding: 4px;
  }
}

@media (max-width: 720px) {
  .layout {
    flex-direction: column;
  }
  .sidebar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    width: 100%;
    height: 58px;
    flex-direction: row;
    align-items: center;
    padding: 0 8px;
    border-right: 0;
    border-top: 1px solid var(--line);
    z-index: 50;
    gap: 4px;
  }
  .brand,
  .sidebar-foot {
    display: none;
  }
  .nav {
    flex-direction: row;
    justify-content: space-around;
    width: 100%;
  }
  .nav-item {
    width: auto;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    padding: 6px 2px;
    font-size: 10px;
  }
  .nav-item.active::before {
    display: none;
  }
  .nav-text {
    display: block;
    font-size: 10px;
  }
  .content {
    padding: 14px;
    padding-bottom: 72px;
  }
  .topbar {
    padding: 0 14px;
  }
  .topbar-sub {
    display: none;
  }
}
</style>
