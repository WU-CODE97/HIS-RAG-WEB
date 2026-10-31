import { request, upload } from './http'

const P = '/api/rag'

/* ---------- 服务状态 ---------- */

export const getHealth = () => request(`${P}/health`)
export const getStats = () => request(`${P}/stats`)
export const getCacheStats = () => request(`${P}/cache/stats`)
export const clearCache = () => request(`${P}/cache`, { method: 'DELETE' })
export const clearDocuments = () => request(`${P}/documents`, { method: 'DELETE' })

/* ---------- 问答 ---------- */

/**
 * 端到端问答。会话历史由服务端按 sessionId 维护：
 * 首轮不传 sessionId，响应里返回新建的会话 id，后续轮次带上它即可延续上下文。
 */
export const query = ({ query, user, sessionId, topK }) =>
  request(`${P}/query`, {
    method: 'POST',
    body: { query, user, sessionId: sessionId || undefined, topK },
  })

/** 尝试解析 JSON，失败时返回空对象（异常帧不应打断整个流）。 */
function safeParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

/**
 * 流式问答（SSE）。
 *
 * EventSource 只支持 GET，而这里要带请求体，因此用 fetch + ReadableStream 自己解析 SSE：
 * 事件块以空行分隔，同一事件的多条 `data:` 行按规范用换行拼接。
 *
 * 服务端事件序列：`meta`（引用已就绪）→ `delta` × N（正文增量）→ `done`；
 * 异常时为 `error`，之后不再有 `done`。
 *
 * @param {object} payload  { query, user, sessionId, topK }
 * @param {object} handlers { onMeta, onDelta, onDone, onFail }
 * @returns {{ promise: Promise<void>, abort: () => void }}
 */
export function queryStream({ query, user, sessionId, topK }, handlers = {}) {
  const controller = new AbortController()

  const promise = (async () => {
    const res = await fetch(`${P}/query/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ query, user, sessionId: sessionId || undefined, topK }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      const error = new Error(detail || `请求失败（HTTP ${res.status}）`)
      error.status = res.status
      throw error
    }
    if (!res.body) {
      throw new Error('当前浏览器不支持流式响应')
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let eventName = null
    let dataLines = []

    const dispatch = () => {
      if (!eventName || dataLines.length === 0) {
        eventName = null
        dataLines = []
        return
      }
      const payload = safeParse(dataLines.join('\n'))
      const handler = {
        meta: handlers.onMeta,
        delta: handlers.onDelta,
        done: handlers.onDone,
        error: handlers.onFail,
      }[eventName]
      eventName = null
      dataLines = []
      if (handler) handler(payload)
    }

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '')
        buffer = buffer.slice(index + 1)
        if (line === '') {
          dispatch()
        } else if (!line.startsWith(':')) {
          const colon = line.indexOf(':')
          const field = colon < 0 ? line : line.slice(0, colon)
          const rest = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
          if (field === 'event') eventName = rest
          else if (field === 'data') dataLines.push(rest)
        }
        index = buffer.indexOf('\n')
      }
    }
    // 流结束但最后一个事件缺空行时兜底处理
    dispatch()
  })()

  return { promise, abort: () => controller.abort() }
}

export const getConversation = (sessionId, userId) =>  request(`${P}/conversation/${encodeURIComponent(sessionId)}?userId=${encodeURIComponent(userId || 'anonymous')}`)

export const clearConversation = (sessionId, userId) =>
  request(`${P}/conversation/${encodeURIComponent(sessionId)}?userId=${encodeURIComponent(userId || 'anonymous')}`, {
    method: 'DELETE',
  })

/* ---------- 检索 / 评估 ---------- */

export const retrieve = ({ query, user, topK }) =>
  request(`${P}/retrieve`, { method: 'POST', body: { query, user, topK } })

export const evaluate = ({ cases, user, topK }) =>
  request(`${P}/eval`, { method: 'POST', body: { cases, user, topK } })

/* ---------- 入库 ---------- */

export const ingestJson = (documents) =>
  request(`${P}/ingest`, { method: 'POST', body: { documents } })

/**
 * 文件入库。后端以 List<String> 接收 departments / roles，
 * 因此同名字段需要重复追加而不是拼接。
 */
export function ingestFile({ file, title, documentId, accessControl = {} }, { onProgress } = {}) {
  const form = new FormData()
  form.append('file', file)
  if (title) form.append('title', title)
  if (documentId) form.append('documentId', documentId)
  for (const d of accessControl.departments || []) form.append('departments', d)
  for (const r of accessControl.roles || []) form.append('roles', r)
  if (accessControl.sensitivityLevel != null) {
    form.append('sensitivityLevel', String(accessControl.sensitivityLevel))
  }
  form.append('publicAccess', String(!!accessControl.publicAccess))
  return upload(`${P}/ingest/file`, form, { onProgress })
}
