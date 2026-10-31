/**
 * 极简 Markdown 渲染器。
 *
 * 设计取舍：不引入 marked / markdown-it 等依赖，只覆盖 LLM 答案里实际会出现的语法
 * （标题、列表、表格、代码、引用、加粗、行内代码、链接、引用角标 [1]）。
 * 先转义 HTML 再做替换，避免答案内容注入脚本。
 */

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c])
}

function inline(text) {
  let s = text
  // 行内代码先占位，避免其中的 * _ 被当作强调
  const codes = []
  s = s.replace(/`([^`\n]+)`/g, (_, code) => {
    codes.push(code)
    return `\u0001IC${codes.length - 1}\u0001`
  })

  // 链接 [text](url)
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
  })

  // 引用角标：[1] [1,2] [1-3] [1、2]
  s = s.replace(/\[(\d+(?:\s*[,，、-]\s*\d+)*)\]/g, (match, inner) => {
    const nums = []
    inner.split(/[,，、]/).forEach((part) => {
      const range = part.trim().split('-')
      if (range.length === 2 && range[0].trim() && range[1].trim()) {
        const a = Number(range[0])
        const b = Number(range[1])
        if (Number.isFinite(a) && Number.isFinite(b) && b >= a && b - a <= 20) {
          for (let i = a; i <= b; i += 1) nums.push(i)
          return
        }
      }
      const n = Number(part.trim())
      if (Number.isFinite(n) && n > 0) nums.push(n)
    })
    if (!nums.length) return match
    return nums
      .map((n) => `<span class="cite-ref" data-cite="${n}">${n}</span>`)
      .join('')
  })

  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>')

  s = s.replace(/\u0001IC(\d+)\u0001/g, (_, i) => `<code>${codes[Number(i)]}</code>`)
  return s
}

function isTableSeparator(line) {
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
  return cells.length > 0 && cells.every((c) => /^\s*:?-{2,}:?\s*$/.test(c))
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

/**
 * @param {string} raw 原始 Markdown 文本
 * @returns {string} 可安全插入 v-html 的 HTML
 */
export function renderMarkdown(raw) {
  if (!raw) return ''
  const source = escapeHtml(String(raw).replace(/\r\n/g, '\n'))

  // 提取围栏代码块
  const blocks = []
  const withoutCode = source.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push(`<pre><code data-lang="${lang}">${code.replace(/\n$/, '')}</code></pre>`)
    return `\u0000BLOCK${blocks.length - 1}\u0000`
  })

  const lines = withoutCode.split('\n')
  const out = []
  let i = 0
  let listType = null
  let paragraph = []

  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${inline(paragraph.join(' '))}</p>`)
      paragraph = []
    }
  }
  const flushList = () => {
    if (listType) {
      out.push(`</${listType}>`)
      listType = null
    }
  }

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // 空行
    if (!trimmed) {
      flushParagraph()
      flushList()
      i += 1
      continue
    }

    // 代码块占位
    if (/^\u0000BLOCK\d+\u0000$/.test(trimmed)) {
      flushParagraph()
      flushList()
      out.push(trimmed)
      i += 1
      continue
    }

    // 标题
    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      flushParagraph()
      flushList()
      const level = heading[1].length
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      i += 1
      continue
    }

    // 分割线
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph()
      flushList()
      out.push('<hr />')
      i += 1
      continue
    }

    // 引用
    if (/^&gt;\s?/.test(trimmed)) {
      flushParagraph()
      flushList()
      const quote = []
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*&gt;\s?/, ''))
        i += 1
      }
      out.push(`<blockquote>${inline(quote.join('<br />'))}</blockquote>`)
      continue
    }

    // 表格
    if (trimmed.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushParagraph()
      flushList()
      const header = splitRow(trimmed)
      i += 2
      const rows = []
      while (i < lines.length && lines[i].trim().includes('|')) {
        rows.push(splitRow(lines[i]))
        i += 1
      }
      const thead = `<thead><tr>${header.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead>`
      const tbody = rows.length
        ? `<tbody>${rows
            .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
            .join('')}</tbody>`
        : ''
      out.push(`<table>${thead}${tbody}</table>`)
      continue
    }

    // 无序列表
    const ul = trimmed.match(/^[-*+]\s+(.*)$/)
    if (ul) {
      flushParagraph()
      if (listType !== 'ul') {
        flushList()
        out.push('<ul>')
        listType = 'ul'
      }
      out.push(`<li>${inline(ul[1])}</li>`)
      i += 1
      continue
    }

    // 有序列表
    const ol = trimmed.match(/^\d+[.)]\s+(.*)$/)
    if (ol) {
      flushParagraph()
      if (listType !== 'ol') {
        flushList()
        out.push('<ol>')
        listType = 'ol'
      }
      out.push(`<li>${inline(ol[1])}</li>`)
      i += 1
      continue
    }

    flushList()
    paragraph.push(trimmed)
    i += 1
  }

  flushParagraph()
  flushList()

  return out
    .join('\n')
    .replace(/\u0000BLOCK(\d+)\u0000/g, (_, idx) => blocks[Number(idx)])
}
