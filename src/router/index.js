import { createRouter, createWebHistory } from 'vue-router'
import { useIdentityStore } from '@/stores/identity'

const routes = [
  {
    path: '/identity',
    name: 'identity',
    component: () => import('@/views/IdentityView.vue'),
    meta: { public: true, title: '身份设置' },
  },
  {
    path: '/',
    component: () => import('@/layouts/AppLayout.vue'),
    children: [
      { path: '', redirect: '/chat' },
      {
        path: 'chat',
        name: 'chat',
        component: () => import('@/views/ChatView.vue'),
        meta: { title: '智能问答', subtitle: '多轮对话 · 混合检索 · 引用溯源' },
      },
      {
        path: 'knowledge',
        name: 'knowledge',
        component: () => import('@/views/KnowledgeView.vue'),
        meta: { title: '知识库', subtitle: '文档入库与访问控制策略' },
      },
      {
        path: 'retrieve',
        name: 'retrieve',
        component: () => import('@/views/RetrieveView.vue'),
        meta: { title: '检索调试', subtitle: '查看召回的片段与分数拆解' },
      },
      {
        path: 'evaluation',
        name: 'evaluation',
        component: () => import('@/views/EvalView.vue'),
        meta: { title: '效果评估', subtitle: 'Recall@K / Precision@K / MRR' },
      },
      {
        path: 'monitor',
        name: 'monitor',
        component: () => import('@/views/MonitorView.vue'),
        meta: { title: '系统监控', subtitle: '知识库规模、语义缓存与服务健康' },
      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/chat' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach((to) => {
  const identity = useIdentityStore()
  if (!to.meta.public && !identity.ready) {
    return { name: 'identity', query: { redirect: to.fullPath } }
  }
  document.title = to.meta.title ? `${to.meta.title} · HIS-RAG` : 'HIS-RAG'
  return true
})

export default router
