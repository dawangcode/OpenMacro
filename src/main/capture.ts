// 按键捕获（src/main/capture.ts，PRD 4.1 绑定按键 / 键盘动作 / 4.6 全局停止热键）
// 渲染进程点「捕获」→ invoke capture:key → 本模块临时订阅钩子，等待下一个输入：
//   - 鼠标按键（mousedown）：返回 kind='mouse'、code='x1' 等；左键 / 右键默认拒绝，
//     防抖规则捕获时允许（allowReservedMouse，用于鼠标连击过滤）
//   - 键盘按键（keydown）：返回 kind='keyboard'、code 为组合摘要（'A'、'Ctrl+Shift+A'）；
//     修饰键按下只记录、不结束捕获，等主键按下后合成，支持按住多个修饰键
//   按 Esc 取消捕获（保留原值）；30 秒无操作自动超时。
// 结果通过事件 'macro:capture:result' 推送给渲染进程（与录制 macro:record:state 同模型，
// 不走 invoke Promise 回传——录制已验证事件推送链路可用）。
// 捕获期间挂起绑定运行时，避免捕获用的按键触发已绑定动作。
import { getCapture } from './input-backend'
import { getHookError, isHookRunning, subscribeInput } from './hook'
import { comboLabelFrom, modifierShortName } from './keymap'
import { emitToRenderer } from './events'
import { isBindingSuspended, setBindingSuspended } from './runtime-state'

export interface CaptureResult {
  ok: boolean
  /** 触发类型：鼠标 / 键盘 */
  kind?: 'mouse' | 'keyboard'
  /** mouse：left/right/middle/x1/x2；keyboard：组合摘要 */
  code?: string
  /** 展示名 */
  label?: string
  /** 停止热键用：uiohook 原始键名 */
  raw?: string
  reason?: string
}

const MOUSE_LABEL: Record<string, string> = {
  left: '左键',
  right: '右键',
  middle: '中键',
  x1: '侧键4',
  x2: '侧键5',
}

let active = false

export function isCaptureActive(): boolean {
  return active
}

export interface CaptureOptions {
  /**
   * 允许捕获左键 / 右键。绑定（按键映射）禁止——会干扰正常操作；
   * 防抖规则允许——鼠标连击（连点抖动）最常发生在左右键。
   */
  allowReservedMouse?: boolean
  /** 捕获超时，默认 30 秒 */
  timeoutMs?: number
}

/** 启动捕获会话；立即返回，捕获结果经 'macro:capture:result' 事件推送 */
export function startKeyCapture(opts: CaptureOptions = {}): { ok: boolean; reason?: string } {
  const allowReservedMouse = opts.allowReservedMouse === true
  const timeoutMs = opts.timeoutMs ?? 30000
  if (active) return { ok: false, reason: '已有捕获会话进行中' }
  // 输入后端未加载（uiohook 原生模块缺失/不匹配）时立即失败，不干等 30 秒超时
  if (!getCapture()) {
    return {
      ok: false,
      reason: '输入捕获模块未加载：请确认 uiohook-napi 已随客户端安装并匹配当前 Electron 版本（详见宏库管理页顶部提示）',
    }
  }
  active = true
  const prevSuspended = isBindingSuspended()
  setBindingSuspended(true)
  const pressed = new Set<string>()

  let done = false
  let unsub: (() => void) | null = null

  const finish = (r: CaptureResult): void => {
    if (done) return
    done = true
    clearTimeout(timer)
    if (unsub) unsub()
    unsub = null
    active = false
    setBindingSuspended(prevSuspended)
    emitToRenderer('macro:capture:result', r)
  }

  const timer = setTimeout(() => finish({ ok: false, reason: '捕获超时（30 秒无操作）' }), timeoutMs)

  unsub = subscribeInput((e) => {
    if (e.kind === 'mouse') {
      if (e.type !== 'down') return
      // 左键 / 右键在「绑定按键」场景为系统保留键：捕获阶段直接拒绝并给出明确提示，不写入表单。
      // 防抖规则允许捕获左右键（allowReservedMouse），用于鼠标连击过滤。
      if (!allowReservedMouse && (e.raw === 'left' || e.raw === 'right')) {
        finish({
          ok: false,
          reason: '左键 / 右键为系统保留按键，不能作为绑定按键；请按鼠标中键 / 侧键或键盘键',
        })
        return
      }
      finish({
        ok: true,
        kind: 'mouse',
        code: e.raw,
        label: MOUSE_LABEL[e.raw] ?? e.raw,
      })
      return
    }
    if (e.type === 'down') {
      pressed.add(e.raw)
      // Esc 取消捕获并保留原值（PRD 4.1）
      if (e.raw === 'Escape') {
        finish({ ok: false, reason: 'canceled' })
        return
      }
      // 修饰键只入集合，不结束捕获：继续等主键，才能得到 'Ctrl+Shift+A'
      if (modifierShortName(e.raw)) return
      const label = comboLabelFrom(pressed, e.raw)
      finish({ ok: true, kind: 'keyboard', code: label, label, raw: e.raw })
      return
    }
    if (e.type === 'up') pressed.delete(e.raw)
  })

  // 订阅后若钩子仍未运行（start 抛错/被杀软拦截），立即失败，不让用户干等超时
  if (!isHookRunning()) {
    finish({
      ok: false,
      reason:
        getHookError() ||
        '全局输入钩子启动失败：可能被杀毒软件或其它钩子程序拦截，可尝试以管理员身份运行客户端',
    })
  }
  return { ok: true }
}
