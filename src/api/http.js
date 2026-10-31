/** 后端基地址：默认走 Vite 代理（同源 /api），可通过 VITE_API_BASE 指向独立部署的后端。 */
const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(message, { status = 0, code = '', payload = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.payload = payload
  }
}

function buildUrl(path) {
  if (/^https?:\/\//.test(path)) return path
  return `${API_BASE}${path}`
}

async function parseBody(res) {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * 统一请求封装。
 * 后端异常体形如 { error: 'FORBIDDEN', message: '...' }，这里统一转成 ApiError。
 */
export async function request(path, { method = 'GET', body, headers = {}, signal } = {}) {
  const init = { method, headers: { Accept: 'application/json', ...headers }, signal }
  if (body !== undefined) {
    if (body instanceof FormData) {
      init.body = body
    } else {
      init.headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
  }

  let res
  try {
    res = await fetch(buildUrl(path), init)
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    throw new ApiError('无法连接后端服务，请确认 HIS-RAG 已在 8080 端口启动', { code: 'NETWORK' })
  }

  const payload = await parseBody(res)
  if (!res.ok) {
    const message =
      (payload && (payload.message || payload.error)) || `请求失败（HTTP ${res.status}）`
    throw new ApiError(message, {
      status: res.status,
      code: payload?.error || '',
      payload,
    })
  }
  return payload
}

/**
 * 带进度回调的文件上传（fetch 无法读取上传进度，这里用 XHR）。
 */
export function upload(path, formData, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', buildUrl(path), true)
    xhr.responseType = 'text'

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }
    xhr.onload = () => {
      let payload = null
      try {
        payload = xhr.responseText ? JSON.parse(xhr.responseText) : null
      } catch {
        payload = xhr.responseText
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload)
      } else {
        reject(
          new ApiError(
            (payload && (payload.message || payload.error)) || `上传失败（HTTP ${xhr.status}）`,
            { status: xhr.status, code: payload?.error || '', payload },
          ),
        )
      }
    }
    xhr.onerror = () => reject(new ApiError('上传过程中网络中断', { code: 'NETWORK' }))
    xhr.onabort = () => reject(new ApiError('上传已取消', { code: 'ABORTED' }))
    if (signal) signal.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(formData)
  })
}

export { API_BASE }
