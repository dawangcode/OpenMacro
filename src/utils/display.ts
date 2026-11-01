// 渲染层展示助手（src/utils/display.ts）
// 多个页面共用的键名 / 时间格式化，避免同一份映射散落各处

/** uiohook 原始键名 → 展示名（仅列常用，其余原样） */
const KEY_DISPLAY: Record<string, string> = {
  Escape: 'Esc',
  Space: '空格',
  Return: '回车',
  Backspace: '退格',
  Delete: '删除',
  Tab: 'Tab',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
}

export function keyDisplay(name: string): string {
  return KEY_DISPLAY[name] ?? name
}

/** 毫秒时间戳 → 时:分:秒.毫秒（实时检测事件表用） */
export function clockMs(ts: number): string {
  const d = new Date(ts)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

/** 毫秒时间戳 → 年-月-日 时:分（列表 / 详情时间列用） */
export function formatDateTime(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
