import { defineStore } from 'pinia'

const SESSION_KEY = (userId) => `his-rag.session.${userId}`

let seq = 0
const nextId = () => `m${++seq}-${Date.now().toString(36)}`

export const useChatStore = defineStore('chat', {
  state: () => ({
    userId: null,
    sessionId: null,
    messages: [],
    /** 当前在右侧溯源面板展示的引用所属消息 */
    focusedMessageId: null,
  }),
  getters: {
    lastAssistant(state) {
      for (let i = state.messages.length - 1; i >= 0; i -= 1) {
        if (state.messages[i].role === 'assistant') return state.messages[i]
      }
      return null
    },
    focusedMessage(state) {
      return state.messages.find((m) => m.id === state.focusedMessageId) || this.lastAssistant
    },
    citations() {
      return this.focusedMessage?.meta?.citations || []
    },
  },
  actions: {
    /** 按当前身份初始化，身份变化时丢弃旧会话，避免串用他人 sessionId。 */
    init(userId) {
      if (this.userId === userId) return
      this.userId = userId
      this.messages = []
      this.focusedMessageId = null
      this.sessionId = localStorage.getItem(SESSION_KEY(userId)) || null
    },
    setSession(sessionId) {
      this.sessionId = sessionId || null
      if (this.userId) {
        if (sessionId) localStorage.setItem(SESSION_KEY(this.userId), sessionId)
        else localStorage.removeItem(SESSION_KEY(this.userId))
      }
    },
    addMessage(msg) {
      const message = { id: nextId(), ts: Date.now(), ...msg }
      this.messages.push(message)
      return message
    },
    patchMessage(id, patch) {
      const target = this.messages.find((m) => m.id === id)
      if (target) Object.assign(target, patch)
    },
    reset() {
      this.messages = []
      this.focusedMessageId = null
      this.setSession(null)
    },
    /** 用服务端历史回填（页面刷新后恢复上下文）。 */
    hydrate(sessionId, history) {
      this.setSession(sessionId)
      this.messages = (history || []).map((m) => ({
        id: nextId(),
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
        ts: Date.now(),
        restored: true,
      }))
      this.focusedMessageId = null
    },
  },
})
