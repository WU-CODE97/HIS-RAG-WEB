import { defineStore } from 'pinia'

const STORAGE_KEY = 'his-rag.identity'

/** 常见科室预设，仅用于表单快捷选择，可自由输入。 */
export const DEPARTMENT_OPTIONS = [
  '心内科',
  '呼吸内科',
  '消化内科',
  '神经内科',
  '内分泌科',
  '普外科',
  '骨科',
  '妇产科',
  '儿科',
  '急诊科',
  '重症医学科',
  '药学部',
  '放射科',
  '检验科',
  '医务处',
]

/** 角色预设，与后端 ACL 中的 roles 对应。 */
export const ROLE_OPTIONS = [
  { value: 'DOCTOR', label: '医生' },
  { value: 'NURSE', label: '护士' },
  { value: 'PHARMACIST', label: '药师' },
  { value: 'ADMIN', label: '管理员' },
]

function loadProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || !data.userId) return null
    const rawRoles = Array.isArray(data.roles) ? data.roles : []
    const profile = {
      userId: data.userId,
      name: data.name || '',
      departments: Array.isArray(data.departments) ? data.departments : [],
      // 过滤掉已下线（不在 ROLE_OPTIONS 中）的角色，避免旧缓存残留无法在表单中取消
      roles: rawRoles.filter((r) => ROLE_OPTIONS.some((opt) => opt.value === r)),
      clearanceLevel: Number(data.clearanceLevel) || 0,
    }
    // 角色有被裁剪时回写缓存，保证本地存储与可选集合一致
    if (profile.roles.length !== rawRoles.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
    }
    return profile
  } catch {
    return null
  }
}

export const useIdentityStore = defineStore('identity', {
  state: () => ({
    profile: loadProfile(),
  }),
  getters: {
    ready: (state) => !!state.profile,
    userId: (state) => state.profile?.userId || 'anonymous',
    name: (state) => state.profile?.name || '',
    displayName: (state) => state.profile?.name || state.profile?.userId || '未登录',
    departments: (state) => state.profile?.departments || [],
    roles: (state) => state.profile?.roles || [],
    clearanceLevel: (state) => state.profile?.clearanceLevel ?? 0,
    isAdmin: (state) => (state.profile?.roles || []).some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN'),
    /** 后端 /query、/retrieve 等接口的 user 入参。 */
    payload: (state) => {
      const p = state.profile
      if (!p) return undefined
      return {
        userId: p.userId,
        name: p.name || undefined,
        departments: p.departments,
        roles: p.roles,
        clearanceLevel: p.clearanceLevel,
      }
    },
  },
  actions: {
    save(profile) {
      const normalized = {
        userId: String(profile.userId || '').trim(),
        name: String(profile.name || '').trim(),
        departments: [...new Set(profile.departments || [])],
        roles: [...new Set(profile.roles || [])],
        clearanceLevel: Number(profile.clearanceLevel) || 0,
      }
      this.profile = normalized
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
    },
    clear() {
      this.profile = null
      localStorage.removeItem(STORAGE_KEY)
    },
  },
})
