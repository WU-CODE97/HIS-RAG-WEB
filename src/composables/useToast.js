import { ref } from 'vue'

const items = ref([])
let seq = 0

function push(message, type = 'info', duration = 2800) {
  const id = ++seq
  items.value.push({ id, message, type })
  window.setTimeout(() => {
    items.value = items.value.filter((t) => t.id !== id)
  }, duration)
  return id
}

export function useToast() {
  return {
    items,
    toast: push,
    ok: (msg, d) => push(msg, 'ok', d),
    err: (msg, d) => push(msg, 'err', d ?? 3600),
    warn: (msg, d) => push(msg, 'warn', d),
    info: (msg, d) => push(msg, 'info', d),
  }
}
