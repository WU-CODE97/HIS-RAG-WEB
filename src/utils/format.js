export function formatMs(ms) {
  if (ms == null) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

export function formatNumber(n) {
  if (n == null || Number.isNaN(n)) return '—'
  return Number(n).toLocaleString('zh-CN')
}

export function formatPercent(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return '—'
  return `${(Number(v) * 100).toFixed(digits)}%`
}

export function formatScore(v, digits = 3) {
  if (v == null || Number.isNaN(v)) return '—'
  return Number(v).toFixed(digits)
}

export function formatTime(ts = Date.now()) {
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function formatDateTime(ts = Date.now()) {
  const d = new Date(ts)
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = Number(bytes)
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** 分数归一化到 0-100，用于进度条宽度。 */
export function scoreToPercent(score, max = 1) {
  if (!score) return 0
  const pct = (Number(score) / (max || 1)) * 100
  return Math.max(3, Math.min(100, pct))
}

export function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 高亮命中关键词（返回 HTML，调用方需保证 text 已转义）。 */
export function highlight(text, query) {
  const safe = String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const terms = String(query || '')
    .split(/[\s，,。？?！!、；;：:]+/)
    .filter((t) => t.length > 1)
  if (!terms.length) return safe
  const re = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi')
  return safe.replace(re, '<mark>$1</mark>')
}
