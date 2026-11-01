// 按键实时检测（src/main/detector.ts，PRD 4.2）
// 订阅绑定运行时的输入活动（含防抖窗口内重复计数），另单独监听鼠标移动做「鼠标活动」心跳，
// 事件列表只保留最新 100 条，通过 macro:detect:event 推给渲染进程。
// 另订阅「实际触发事件」：软件在绑定键上真正执行的动作 / 被防抖抑制，通过 macro:trigger:event 推送，
// 供「实际触发检测」面板验证防抖与宏是否生效（与原始输入回显区分）。
import { onActivity, onTriggerActivity, type TriggerActivity } from './binding-engine'
import { subscribeInput } from './hook'
import { emitToRenderer } from './events'
import { displayKeyName } from './keymap'
import { isSyntheticEvent } from './synthetic'

export interface DetectEvent {
  id: string
  /** 展示名：中键 / 侧键4 / 侧键5 / 滚轮 / Esc / A / Ctrl+Shift+A ... */
  key: string
  eventType: '按下' | '抬起' | '滚轮上滚' | '滚轮下滚'
  /** 毫秒级时间戳 */
  ts: number
  /** 防抖窗口内重复计数（正常点击为 0） */
  repeat: number
}

export interface DetectState {
  events: DetectEvent[]
  /** 已识别到的可绑定按键（产生过事件的） */
  seen: string[]
  /** 最近一次鼠标活动（含移动）时间戳，0 表示从未活动 */
  lastMouseActivityAt: number
  /** 采集是否暂停 */
  paused: boolean
}

const MAX_EVENTS = 100
const MAX_TRIGGER_EVENTS = 100
const MOVE_HEARTBEAT_MS = 1000

/** 鼠标按键名 → 中文展示名（检测表「按键名称」列） */
const BUTTON_LABEL: Record<string, string> = {
  left: '左键',
  right: '右键',
  middle: '中键',
  x1: '侧键4',
  x2: '侧键5',
}

/** 可绑定按键集合：左键 / 右键是系统保留，不计入「已识别到 N 个可绑定按键」 */
const BINDABLE_BUTTONS = new Set(['middle', 'x1', 'x2'])

let events: DetectEvent[] = []
const seen = new Set<string>()
let lastMouseActivityAt = 0
let seq = 0
let triggerEvents: TriggerActivity[] = []
let started = false
/** 采集暂停开关：暂停后不再入列、不推送（钩子本身继续运行，不影响按键绑定） */
let paused = false

function emitState(event: DetectEvent | null): void {
  emitToRenderer('macro:detect:event', {
    event,
    seen: [...seen],
    lastMouseActivityAt,
  })
}

/** 暂停 / 继续采集（返回暂停后的状态） */
export function setDetectPaused(v: boolean): boolean {
  paused = v === true
  return paused
}

/** 清空事件列表（seen 与活动时间保留，避免刚清空就弹「未检测到鼠标事件」） */
export function clearDetectEvents(): void {
  events = []
}

export function startDetector(): void {
  if (started) return
  started = true

  onActivity((a) => {
    if (paused) return
    // 软件注入的合成事件（宏 / 绑定动作产生的键鼠输入会被 uiohook 捕获回来）：
    // 物理按键检测只显示真实人工输入，合成事件不进入本视图。
    if (isSyntheticEvent(a.ts)) return
    if (a.type === 'down' || a.type === 'up') {
      if (a.kind === 'mouse' && BINDABLE_BUTTONS.has(a.raw)) seen.add(a.raw)
      seq += 1
      const evt: DetectEvent = {
        id: `d_${a.ts}_${seq}`,
        key: a.kind === 'mouse' ? (BUTTON_LABEL[a.raw] ?? a.raw) : (a.combo ?? displayKeyName(a.raw)),
        eventType: a.type === 'down' ? '按下' : '抬起',
        ts: a.ts,
        repeat: a.repeat,
      }
      events = [evt, ...events].slice(0, MAX_EVENTS)
      emitState(evt)
      return
    }
    if (a.type === 'wheel') {
      seq += 1
      const evt: DetectEvent = {
        id: `d_${a.ts}_${seq}`,
        key: '滚轮',
        eventType: (a.rotation ?? 0) > 0 ? '滚轮上滚' : '滚轮下滚',
        ts: a.ts,
        repeat: 0,
      }
      events = [evt, ...events].slice(0, MAX_EVENTS)
      emitState(evt)
    }
  })

  // 鼠标移动心跳：不进事件列表，只用于「未检测到鼠标事件」判定
  let lastBeat = 0
  subscribeInput((e) => {
    if (paused) return
    if (e.kind !== 'mouse' || e.type !== 'move') return
    const now = Date.now()
    if (now - lastBeat < MOVE_HEARTBEAT_MS) return
    lastBeat = now
    lastMouseActivityAt = now
    emitState(null)
  })

  // 实际触发事件：软件在绑定键上真正执行的动作 / 被防抖抑制，供「实际触发检测」面板验证
  onTriggerActivity((a) => {
    if (paused) return
    triggerEvents = [a, ...triggerEvents].slice(0, MAX_TRIGGER_EVENTS)
    emitToRenderer('macro:trigger:event', a)
  })
}

/** 读取当前实际触发事件缓冲（最新在前） */
export function getTriggerState(): TriggerActivity[] {
  return [...triggerEvents]
}

/** 清空实际触发事件缓冲 */
export function clearTriggerEvents(): void {
  triggerEvents = []
}

export function getDetectState(): DetectState {
  return { events, seen: [...seen], lastMouseActivityAt, paused }
}
