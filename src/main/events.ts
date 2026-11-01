// 主进程 → 渲染进程单向事件推送
// 只允许 events.ts 里列举的白名单 channel，preload 侧同样按该白名单转发
export const EVENT_CHANNELS = [
  'macro:record:countdown',
  'macro:record:state',
  'macro:playback:state',
  'macro:detect:event',
  'macro:trigger:event',
  'macro:action:warning',
  'macro:capture:result',
] as const

export type EventChannel = (typeof EVENT_CHANNELS)[number]

type Sender = (channel: EventChannel, payload: unknown) => void

let sender: Sender | null = null

export function setEventSender(fn: Sender) {
  sender = fn
}

export function emitToRenderer(channel: EventChannel, payload: unknown) {
  try {
    sender?.(channel, payload)
  } catch {
    // 窗口已销毁时静默忽略，不影响主进程
  }
}
