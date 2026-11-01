// 全局输入钩子中枢（src/main/hook.ts）
// 原来 recorder 直接持有 uiohook 监听器，开始录制时 on/stop 时 off；
// 现在按键绑定运行时、实时检测、录制三方都要常驻/临时监听同一份钩子，
// 由本模块统一 start/stop 与事件归一化，订阅方只拿 HookEvent。
//
// 生命周期：首个订阅者接入时 start()，最后一个退订时 stop()；
// uiohook 的 start/stop 幂等性由本模块的 started 标志保证。
import { getCapture } from './input-backend'

export type HookKind = 'key' | 'mouse'
export type HookEventType = 'down' | 'up' | 'move' | 'wheel'

export interface HookEvent {
  kind: HookKind
  type: HookEventType
  /** 键盘为 uiohook 键名（如 'A'、'ControlLeft'）；鼠标为 left/right/middle/x1/x2，滚轮为 'wheel' */
  raw: string
  x: number
  y: number
  /** 滚轮：正数上滚、负数下滚 */
  rotation?: number
  /** C 层吞掉标记：1 = 该事件已被禁用拦截 / 防抖抑制吞掉，OS 层不会收到（JS 侧仍可见） */
  reserved?: number
}

type Listener = (e: HookEvent) => void

const listeners = new Set<Listener>()
let started = false
/** 最近一次 uIOhook.start() 失败原因（UI 诊断用，空串表示未失败） */
let lastStartError = ''

/** uiohook 按钮码 → 统一按键名 */
const BUTTON_NAME: Record<number, string> = { 1: 'left', 2: 'right', 3: 'middle', 4: 'x1', 5: 'x2' }

function dispatch(e: HookEvent): void {
  for (const l of [...listeners]) {
    try {
      l(e)
    } catch {
      // 单个订阅方异常不影响其他订阅方与钩子本身
    }
  }
}

function ensureStarted(): void {
  if (started) return
  const cap = getCapture()
  if (!cap) return
  const { uIOhook, keyNameOf } = cap
  uIOhook.on('keydown', (e: any) =>
    dispatch({ kind: 'key', type: 'down', raw: keyNameOf(e.keycode), x: e.x, y: e.y, reserved: Number(e.reserved) || 0 }),
  )
  uIOhook.on('keyup', (e: any) =>
    dispatch({ kind: 'key', type: 'up', raw: keyNameOf(e.keycode), x: e.x, y: e.y, reserved: Number(e.reserved) || 0 }),
  )
  uIOhook.on('mousedown', (e: any) =>
    dispatch({ kind: 'mouse', type: 'down', raw: BUTTON_NAME[e.button] ?? `btn${e.button}`, x: e.x, y: e.y }),
  )
  uIOhook.on('mouseup', (e: any) =>
    dispatch({ kind: 'mouse', type: 'up', raw: BUTTON_NAME[e.button] ?? `btn${e.button}`, x: e.x, y: e.y }),
  )
  uIOhook.on('wheel', (e: any) =>
    dispatch({ kind: 'mouse', type: 'wheel', raw: 'wheel', x: e.x, y: e.y, rotation: Number(e.rotation) || 0 }),
  )
  uIOhook.on('mousemove', (e: any) =>
    dispatch({ kind: 'mouse', type: 'move', raw: 'move', x: e.x, y: e.y }),
  )
  try {
    uIOhook.start()
    started = true
    lastStartError = ''
  } catch (e) {
    started = false
    lastStartError = e instanceof Error ? e.message : String(e)
  }
}

function maybeStop(): void {
  if (!started || listeners.size > 0) return
  const cap = getCapture()
  if (!cap) return
  try {
    cap.uIOhook.stop()
  } catch {
    // 停止失败不影响主进程
  }
  started = false
}

/** 订阅全局输入事件；返回退订函数 */
export function subscribeInput(fn: Listener): () => void {
  listeners.add(fn)
  ensureStarted()
  return () => {
    listeners.delete(fn)
    maybeStop()
  }
}

/**
 * 进程退出前强制卸载钩子（before-quit 调用）。
 * 为什么必须有：订阅方（绑定运行时 / 检测 / 录制）在退出时不会退订，maybeStop 的
 * 「最后一个订阅者退出才 stop」条件永远不满足，uiohook 原生线程会带着已安装的
 * 事件钩子被进程退出直接杀掉——macOS 把这判定为「意外退出」，弹系统崩溃报告框
 * （dev 态显示为 "Electron"意外退出，打包态显示应用名）。
 * stop() 幂等：重复调用 / 未启动时调用都安全。
 */
export function shutdownHook(): void {
  if (!started) return
  const cap = getCapture()
  if (!cap) return
  try {
    cap.uIOhook.stop()
  } catch {
    // 卸载失败不阻塞退出：尽力而为，主进程随后照常结束
  }
  started = false
}

/** 钩子是否正在运行（UI/诊断用） */
export function isHookRunning(): boolean {
  return started
}

/** 最近一次 uIOhook.start() 失败原因（空串表示未失败） */
export function getHookError(): string {
  return lastStartError
}
