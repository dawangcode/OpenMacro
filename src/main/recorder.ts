// 宏录制：全局键鼠钩子（src/main/hook.ts 中枢）→ 时间轴步骤
// 录制状态机：idle → countdown（默认 3 秒，PRD 4.5）→ recording → idle
import type { BrowserWindow } from 'electron'
import { emitToRenderer } from './events'
import { setBindingSuspended } from './runtime-state'
import { subscribeInput, type HookEvent } from './hook'
import { requireCapture } from './input-backend'
import { revealWindow } from './window-utils'
import { comboLabelFrom, displayKeyName } from './keymap'
import {
  MacroStep,
  MouseButton,
  STEP_DEFAULT_DELAY,
  STEP_MAX_DELAY,
  STEP_MIN_DELAY,
} from '../types/macro'

export type RecordPhase = 'idle' | 'countdown' | 'recording'

export interface RecordState {
  phase: RecordPhase
  /** 倒计时剩余秒数 */
  countdown: number
  steps: MacroStep[]
  captureDelay: boolean
  captureMouseMove: boolean
  /** 不可用时为空，UI 据此置灰录制按钮 */
  reason?: string
}

export interface StartRecordOptions {
  captureDelay: boolean
  captureMouseMove: boolean
  countdownSec?: number
}

/** hook.ts 归一化后的鼠标按键名 → 领域模型 MouseButton */
const NAME_TO_BUTTON: Record<string, MouseButton> = {
  left: 'left',
  right: 'right',
  middle: 'middle',
  x1: 'x1', // 侧键4
  x2: 'x2', // 侧键5
}

const BUTTON_LABEL: Record<MouseButton, string> = {
  left: '左键',
  right: '右键',
  middle: '中键',
  x1: '侧键4',
  x2: '侧键5',
}

const MOVE_THROTTLE_MS = 30

/**
 * 录制停止热键：录制期间用户通常在目标程序里操作，回到本软件点按钮会多录一次点击，
 * 故保留热键停止（uiohook 键名 F9）；窗口不再自动最小化，用户也可以直接点「停止录制」
 */
const STOP_HOTKEY = 'F9'

let seq = 0
function nextId(): string {
  seq += 1
  return `s_${Date.now().toString(36)}_${seq}`
}

function clampDelay(ms: number): number {
  if (!Number.isFinite(ms)) return STEP_DEFAULT_DELAY
  return Math.max(STEP_MIN_DELAY, Math.min(STEP_MAX_DELAY, Math.round(ms)))
}

class Recorder {
  private phase: RecordPhase = 'idle'
  private countdown = 0
  private steps: MacroStep[] = []
  private captureDelay = true
  private captureMouseMove = false
  private reason: string | undefined
  private timer: NodeJS.Timeout | null = null
  private unsub: (() => void) | null = null
  private pressed = new Set<string>()
  private lastTs = 0
  private lastMoveTs = 0
  private win: BrowserWindow | null = null

  /** 由 ipc 注册时注入主窗口：停止 / 取消录制后把窗口拉回前台（录制开始不再自动最小化） */
  setWindow(win: BrowserWindow): void {
    this.win = win
  }

  getState(): RecordState {
    return {
      phase: this.phase,
      countdown: this.countdown,
      steps: this.steps,
      captureDelay: this.captureDelay,
      captureMouseMove: this.captureMouseMove,
      reason: this.reason,
    }
  }

  private emit(): void {
    emitToRenderer('macro:record:state', this.getState())
  }

  private push(step: Omit<MacroStep, 'id' | 'delay'>): void {
    const now = Date.now()
    // 等待独立成 delay 步骤：动作步骤自身延迟恒 0，时间信息全部由「等待」承载
    const gap = this.captureDelay
      ? clampDelay(now - this.lastTs)
      : STEP_DEFAULT_DELAY
    if (this.steps.length > 0 && gap > 0) {
      this.steps.push({ id: nextId(), kind: 'delay', label: '', delay: gap })
    }
    this.lastTs = now
    this.steps.push({ ...step, id: nextId(), delay: 0 })
    this.emit()
  }

  start(opts: StartRecordOptions): { ok: boolean; reason?: string } {
    const cap = requireCapture()
    if (!cap.ok) {
      this.reason = cap.reason
      this.emit()
      return { ok: false, reason: cap.reason }
    }
    if (this.phase !== 'idle') return { ok: false, reason: '正在录制中' }

    this.steps = []
    this.pressed.clear()
    this.captureDelay = opts.captureDelay
    this.captureMouseMove = opts.captureMouseMove
    this.reason = undefined
    this.lastTs = 0
    this.lastMoveTs = 0

    // 录制期间挂起按键绑定运行时：避免录制的操作被绑定动作二次注入到目标程序
    setBindingSuspended(true)
    this.bind()

    const sec = Math.max(0, Math.round(opts.countdownSec ?? 3))
    if (sec === 0) {
      this.beginRecording()
      return { ok: true }
    }
    this.phase = 'countdown'
    this.countdown = sec
    this.emitToCountdown()
    this.timer = setInterval(() => {
      this.countdown -= 1
      if (this.countdown <= 0) {
        this.clearTimer()
        this.beginRecording()
      } else {
        this.emitToCountdown()
      }
    }, 1000)
    return { ok: true }
  }

  private emitToCountdown(): void {
    emitToRenderer('macro:record:countdown', { countdown: this.countdown, phase: this.phase })
    this.emit()
  }

  private beginRecording(): void {
    this.phase = 'recording'
    this.countdown = 0
    this.lastTs = Date.now()
    // 不主动最小化窗口：录制开始后由用户自己切到目标程序。
    // 注意：因此录制期间在本软件界面上的点击 / 滚轮也会被如实记为步骤（此前靠最小化规避）。
    this.emit()
  }

  private restoreWindow(): void {
    try {
      // 用户自己最小化（已隐藏到托盘）也一并还原：停止后要把刚录到的步骤展示出来。
      // 走统一的 revealWindow：Windows 上「最小化 + 隐藏」窗口直接 show/restore 会是僵尸窗
      revealWindow(this.win)
    } catch {
      // 恢复失败不影响已录制的步骤
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 倒计时期间用户反悔：取消录制，不产出步骤 */
  cancel(): void {
    this.clearTimer()
    this.unbind()
    this.phase = 'idle'
    this.countdown = 0
    this.steps = []
    this.emit()
    this.restoreWindow()
  }

  stop(): MacroStep[] {
    this.clearTimer()
    this.unbind()
    this.phase = 'idle'
    this.countdown = 0
    const steps = this.steps
    this.steps = []
    this.emit()
    this.restoreWindow()
    return steps
  }

  /** 订阅共享钩子（hook.ts 中枢）：录制期只收事件，钩子生命周期由中枢统一管理 */
  private bind(): void {
    const onEvent = (e: HookEvent) => {
      if (this.phase !== 'recording') return
      if (e.kind === 'key') {
        const raw = e.raw
        // 停止热键不进时间轴
        if (e.type === 'down') {
          if (raw === STOP_HOTKEY) return
          if (this.pressed.has(raw)) return // 系统自动重复，不重复记
          this.pressed.add(raw)
          const key = comboLabelFrom(this.pressed, raw)
          this.push({
            kind: 'keyboard',
            label: `按下 ${key}`,
            key,
            action: 'down',
          })
          return
        }
        this.pressed.delete(raw)
        // 录制停止热键：结束录制并恢复窗口，不记为步骤
        if (raw === STOP_HOTKEY) {
          this.stop()
          return
        }
        this.push({
          kind: 'keyboard',
            label: `抬起 ${displayKeyName(raw)}`,
            key: displayKeyName(raw),
            action: 'up',
        })
        return
      }

      if (e.kind === 'mouse') {
        if (e.type === 'down' || e.type === 'up') {
          const button = NAME_TO_BUTTON[e.raw] ?? 'left'
          this.push({
            kind: 'mouse',
            label: `${BUTTON_LABEL[button]}${e.type === 'down' ? '按下' : '抬起'}`,
            key: button,
            action: e.type === 'down' ? 'down' : 'up',
            x: e.x,
            y: e.y,
          })
          return
        }
        if (e.type === 'wheel') {
          const amount = Math.max(1, Math.abs(e.rotation ?? 1))
          const up = (e.rotation ?? 0) > 0
          this.push({
            kind: 'mouse',
            label: `滚轮${up ? '上' : '下'}滚 ${amount}`,
            action: up ? 'wheelUp' : 'wheelDown',
            wheelAmount: amount,
            x: e.x,
            y: e.y,
          })
          return
        }
        if (e.type === 'move' && this.captureMouseMove) {
          const now = Date.now()
          if (now - this.lastMoveTs < MOVE_THROTTLE_MS) return
          this.lastMoveTs = now
          this.push({
            kind: 'mouse',
            label: `移动到 (${e.x}, ${e.y})`,
            action: 'move',
            x: e.x,
            y: e.y,
          })
        }
      }
    }

    this.unsub = subscribeInput(onEvent)
  }

  private unbind(): void {
    if (this.unsub) {
      this.unsub()
      this.unsub = null
    }
    this.pressed.clear()
    // 录制结束（停止/取消/倒计时期内反悔）恢复按键绑定运行时
    setBindingSuspended(false)
  }
}

export const recorder = new Recorder()
