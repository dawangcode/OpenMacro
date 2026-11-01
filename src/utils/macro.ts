// 宏相关公共助手（src/utils/macro.ts）
// buildLabel：步骤摘要（编辑页 / 详情页共用，保证两处展示一致）

import {
  MOUSE_BUTTON_OPTIONS,
  STEP_MAX_DELAY,
  STEP_MIN_DELAY,
  SYSTEM_COMMAND_OPTIONS,
  WHEEL_AMOUNT_MAX,
  WHEEL_AMOUNT_MIN,
  type MouseButton,
  type MacroStep,
} from '@/types/macro'

/** X-MOUSE / XMBC 宏文本解析（见宏编辑页「粘贴 X-MOUSE 文本」） */
function newStepId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export interface XMouseParseResult {
  steps: MacroStep[]
  warnings: string[]
}

const XMOUSE_DOWN: Record<string, MouseButton> = {
  LMBD: 'left',
  RMBD: 'right',
  MMBD: 'middle',
}
const XMOUSE_UP: Record<string, MouseButton> = {
  LMBU: 'left',
  RMBU: 'right',
  MMBU: 'middle',
}
const XMOUSE_CLICK: Record<string, MouseButton> = {
  LMB: 'left',
  RMB: 'right',
  MMB: 'middle',
}

function clampDelay(ms: number): number {
  return Math.max(STEP_MIN_DELAY, Math.min(STEP_MAX_DELAY, Math.round(ms)))
}

/** 修饰键标记 → 组合键 token（comboToNutKeys 能识别：Ctrl/Shift/Alt/Win 走别名，右修饰用全名） */
const XMOUSE_MODS: Record<string, string> = {
  CTRL: 'Ctrl',
  LCTRL: 'Ctrl',
  RCTRL: 'RightControl',
  CONTROL: 'Ctrl',
  SHIFT: 'Shift',
  LSHIFT: 'Shift',
  RSHIFT: 'RightShift',
  ALT: 'Alt',
  LALT: 'Alt',
  RALT: 'RightAlt',
  WIN: 'Win',
  LWIN: 'Win',
  RWIN: 'Win',
}

/** 具名键标记 → nut-js 键名（F1~F12、功能键等） */
const XMOUSE_NAMED: Record<string, string> = {
  F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6',
  F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12',
  ENTER: 'Enter', RET: 'Enter', RETURN: 'Enter',
  ESC: 'Escape', ESCAPE: 'Escape',
  SPACE: 'Space', TAB: 'Tab',
  BACKSPACE: 'Backspace', BKSP: 'Backspace',
  DEL: 'Delete', DELETE: 'Delete',
  INS: 'Insert', INSERT: 'Insert',
  HOME: 'Home', END: 'End',
  PGUP: 'PageUp', PGDN: 'PageDown', PAGEUP: 'PageUp', PAGEDOWN: 'PageDown',
  UP: 'Up', DOWN: 'Down', LEFT: 'Left', RIGHT: 'Right',
  NUM0: 'Num0', NUM1: 'Num1', NUM2: 'Num2', NUM3: 'Num3', NUM4: 'Num4',
  NUM5: 'Num5', NUM6: 'Num6', NUM7: 'Num7', NUM8: 'Num8', NUM9: 'Num9',
  CAPSLOCK: 'CapsLock', NUMLOCK: 'NumLock',
}

function clampWheel(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.max(WHEEL_AMOUNT_MIN, Math.min(WHEEL_AMOUNT_MAX, Math.round(n)))
}

/**
 * 解析 X-MOUSE / XMBC 宏文本为 OpenMacro 步骤。
 * 等待独立成「delay」步骤（与 XMBC 后置等待语义一一对应）：
 *   `4{WAITMS:80}e` → [单击 4] → [等待 80] → [单击 E]
 * 支持标记：
 *   · {WAITMS:n}/{PAUSE:n} 等待
 *   · {LMBD}{LMBU}{LMB} 左键按下/抬起/单击（RMB/MMB 同理）
 *   · {CTRL}{SHIFT}{ALT}{WIN} 及其 L/R 变体与 {CTRLDOWN}/{CTRLUP} 修饰键
 *   · {F1}…{F12}、{ENTER}{ESC}{SPACE}… 具名键（大小写不敏感）
 *   · {WHEEL UP}/{WHEEL DOWN}（可带滚动量，如 {WHEEL UP 3}）滚轮
 *   · 其余单字符（含字母、数字、符号）按一次键盘单击处理
 * 修饰键会「按住」累积到下一个动作；跟随鼠标动作时展开为「按下修饰键→动作→抬起修饰键」。
 * 未识别的 {} 标记记入 warnings 并跳过；空文本返回空步骤。
 */
export function parseXMouse(text: string): XMouseParseResult {
  const steps: MacroStep[] = []
  const warnings: string[] = []
  /** 已按下但尚未随动作消费的修饰键 token */
  let pendingMods: string[] = []

  /** 动作步骤：自身延迟恒为 0，等待全部由独立的 delay 步骤表达 */
  const addAction = (step: Omit<MacroStep, 'id' | 'label' | 'delay'>) => {
    steps.push({ ...step, id: newStepId(), label: '', delay: 0 })
  }
  /** 等待步骤：时长就是本步的 delay；0ms 不产步骤（无意义） */
  const addWait = (ms: number) => {
    const d = clampDelay(ms)
    if (d > 0) steps.push({ id: newStepId(), kind: 'delay', label: '', delay: d })
  }
  /** 键盘动作：把累积修饰键并入组合键（如 Ctrl+A）；keyToken 为空时仅输出修饰键本身 */
  const emitKey = (keyToken: string) => {
    const key = keyToken
      ? pendingMods.length
        ? [...pendingMods, keyToken].join('+')
        : keyToken
      : pendingMods.join('+')
    addAction({ kind: 'keyboard', key, action: 'click' })
    pendingMods = []
  }
  /** 鼠标/滚轮动作：若有待消费修饰键，展开为「按下修饰键→动作→抬起修饰键」（如 Ctrl+左键） */
  const emitMouse = (step: Omit<MacroStep, 'id' | 'label' | 'delay'>) => {
    const mods = pendingMods
    pendingMods = []
    for (const mod of mods) addAction({ kind: 'keyboard', key: mod, action: 'down' })
    addAction(step)
    for (const mod of mods) addAction({ kind: 'keyboard', key: mod, action: 'up' })
  }

  const raw = (text ?? '').replace(/[\r\n]+/g, ' ').trim()
  const re = /(\{[^}]*\})|([^{}])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const bracket = m[1]
    const ch = m[2]
    if (bracket) {
      const inner = bracket.slice(1, -1).trim()
      const wait = inner.match(/^(?:WAITMS|PAUSE):\s*(\d+)$/i)
      if (wait) {
        addWait(Number(wait[1]))
        continue
      }
      // 修饰键：CTRL / LCTRL / RCTRL / CTRLDOWN / CTRLUP …
      const mod = inner.match(/^(CTRL|LCTRL|RCTRL|CONTROL|SHIFT|LSHIFT|RSHIFT|ALT|LALT|RALT|WIN|LWIN|RWIN)(DOWN|UP)?$/i)
      if (mod) {
        const token = XMOUSE_MODS[mod[1].toUpperCase()]
        if (!mod[2] || mod[2].toUpperCase() === 'DOWN') {
          pendingMods.push(token)
        } else {
          // UP：松开最近一次同名修饰键
          const idx = [...pendingMods].reverse().findIndex((x) => x === token)
          if (idx >= 0) pendingMods.splice(pendingMods.length - 1 - idx, 1)
        }
        continue
      }
      // 滚轮
      const wheel = inner.match(/^WHEEL\s*(UP|DOWN)?\s*(\d*)$/i)
      if (wheel) {
        const dir = wheel[1] && wheel[1].toUpperCase() === 'DOWN' ? 'wheelDown' : 'wheelUp'
        emitMouse({ kind: 'mouse', action: dir, wheelAmount: clampWheel(Number(wheel[2])) })
        continue
      }
      if (XMOUSE_DOWN[inner]) {
        emitMouse({ kind: 'mouse', key: XMOUSE_DOWN[inner], action: 'down' })
        continue
      }
      if (XMOUSE_UP[inner]) {
        emitMouse({ kind: 'mouse', key: XMOUSE_UP[inner], action: 'up' })
        continue
      }
      if (XMOUSE_CLICK[inner]) {
        emitMouse({ kind: 'mouse', key: XMOUSE_CLICK[inner], action: 'click' })
        continue
      }
      const named = XMOUSE_NAMED[inner.toUpperCase()]
      if (named) {
        emitKey(named)
        continue
      }
      // 单字符花括号按键，如 {A} / {1}
      if (/^[A-Z0-9]$/i.test(inner)) {
        emitKey(inner.toUpperCase())
        continue
      }
      warnings.push(`未识别标记 ${bracket}`)
      continue
    }
    if (ch && ch !== ' ' && ch !== '\t') {
      emitKey(/^[a-z]$/i.test(ch) ? ch.toUpperCase() : ch)
    }
  }
  // 串尾残留的修饰键（如单独的 {CTRL}）作为一次组合键单击收尾
  if (pendingMods.length) emitKey('')
  return { steps, warnings }
}

/** 展示摘要随内容变化重算，避免「动作内容」与保存值不一致 */
export function buildLabel(step: MacroStep): string {
  switch (step.kind) {
    case 'keyboard': {
      const verb =
        step.action === 'up' ? '抬起' : step.action === 'click' ? '单击' : '按下'
      return `${verb} ${step.key || '未设置按键'}`
    }
    case 'mouse': {
      const btn = MOUSE_BUTTON_OPTIONS.find((o) => o.value === step.key)?.label ?? '左键'
      if (step.action === 'move') return `移动到 (${step.x ?? 0}, ${step.y ?? 0})`
      if (step.action === 'wheelUp') return `滚轮上滚 ${step.wheelAmount ?? 1}`
      if (step.action === 'wheelDown') return `滚轮下滚 ${step.wheelAmount ?? 1}`
      if (step.action === 'click') return `${btn}单击`
      return `${btn}${step.action === 'up' ? '抬起' : '按下'}`
    }
    case 'delay':
      return `等待 ${step.delay} 毫秒`
    case 'text':
      return `输入文本「${step.text ?? ''}」`
    case 'command':
      return SYSTEM_COMMAND_OPTIONS.find((o) => o.value === step.command)?.label ?? '系统命令'
    case 'loopStart':
      return `循环开始 ×${step.loopCount ?? 1}`
    case 'loopEnd':
      return '循环结束'
    default:
      return '未知动作'
  }
}
