// 按键绑定领域模型（renderer 与 main 共用，PRD 4.1 / 4.3）
// 通用模式：一条绑定 = 一个「绑定按键（鼠标键或键盘键/组合键）」+ 短按动作 / 长按动作。
// 防抖为独立规则实体（DebounceRule），按绑定按键逐条配置，可单独新增 / 编辑 / 删除。
// 绑定按键通过捕获模式录入，支持鼠标（中键 / 侧键4 / 侧键5）与键盘（单键或组合键）；
// 左键 / 右键为系统保留，不可作为绑定键（会干扰正常操作）。
// 例外：防抖规则（DebounceRule）允许绑定任意鼠标键，含左键 / 右键——鼠标连击最常发生在左右键。
import type { SystemCommand } from './macro'

/** 绑定按键类型：鼠标按键 / 键盘按键（含组合键） */
export type TriggerKind = 'mouse' | 'keyboard'

export interface TriggerKey {
  kind: TriggerKind
  /** mouse：left / right / middle / x1 / x2；keyboard：'A'、'Ctrl+Shift+A' 等组合摘要 */
  code: string
  /** 展示名：侧键4 / Ctrl+Shift+A */
  label: string
}

/** 鼠标按键名 → 展示名 */
export const MOUSE_TRIGGER_LABELS: Record<string, string> = {
  left: '左键',
  right: '右键',
  middle: '中键',
  x1: '侧键4',
  x2: '侧键5',
}

/** 系统保留的鼠标按键，不可作为绑定键 */
export const RESERVED_TRIGGERS = ['left', 'right']

/** 触发方式：短按 / 长按（PRD 4.1） */
export type TriggerMode = 'tap' | 'hold'

export const TRIGGER_MODE_OPTIONS: { value: TriggerMode; label: string }[] = [
  { value: 'tap', label: '短按' },
  { value: 'hold', label: '长按' },
]

/** 动作类型（PRD 4.1：「键盘单键 / 键盘组合键」合并为键盘动作一个入口） */
export type ActionType = 'keyboard' | 'mouse' | 'command' | 'launch' | 'macro' | 'disabled'

export const ACTION_TYPE_OPTIONS: { value: ActionType; label: string }[] = [
  { value: 'keyboard', label: '键盘动作' },
  { value: 'mouse', label: '鼠标功能' },
  { value: 'command', label: '系统命令' },
  { value: 'launch', label: '启动程序' },
  { value: 'macro', label: '宏' },
  { value: 'disabled', label: '禁用' },
]

/** 鼠标功能（PRD 4.1 动作类型「鼠标功能」的可选项） */
export type MouseFunction = 'middle' | 'x1' | 'x2' | 'wheelUp' | 'wheelDown'

export const MOUSE_FUNCTION_OPTIONS: { value: MouseFunction; label: string }[] = [
  { value: 'middle', label: '中键' },
  { value: 'x1', label: '侧键4' },
  { value: 'x2', label: '侧键5' },
  { value: 'wheelUp', label: '滚轮上滚' },
  { value: 'wheelDown', label: '滚轮下滚' },
]

export interface BindingAction {
  type: ActionType
  /** keyboard：单键或组合键，如 'A'、'Ctrl+Shift+A'（捕获模式填入） */
  key?: string
  mouseFn?: MouseFunction
  command?: SystemCommand
  /** launch：程序路径（仅可执行文件） */
  path?: string
  /** macro：宏 id */
  macroId?: string
}

/** 按键防抖规则（PRD 4.3）：按绑定按键逐条配置，可独立新增 / 编辑 / 删除 */
export interface DebounceRule {
  id: string
  /**
   * 被防抖的按键（鼠标键或键盘键 / 组合键）。
   * 与「按键映射」不同：这里允许左键 / 右键——鼠标连击（连点抖动）主要发生在左右键。
   */
  trigger: TriggerKey
  /** 是否启用该防抖规则 */
  enabled: boolean
  /** 防抖窗口 10~3000 毫秒 */
  windowMs: number
}

export interface KeyBinding {
  id: string
  trigger: TriggerKey
  /** 短按动作 */
  tap?: BindingAction
  /** 长按动作 */
  hold?: BindingAction
  /** 长按阈值 300~2000ms（PRD 4.1：0.3~2 秒） */
  holdThresholdMs: number
}

/** 长按阈值范围（PRD 4.1） */
export const HOLD_THRESHOLD_MIN = 300
export const HOLD_THRESHOLD_MAX = 2000
export const HOLD_THRESHOLD_DEFAULT = 800

/** 防抖窗口范围（PRD 4.3） */
export const DEBOUNCE_WINDOW_MIN = 10
export const DEBOUNCE_WINDOW_MAX = 3000
export const DEBOUNCE_WINDOW_DEFAULT = 200

export function newBindingId(): string {
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** 新建一条空绑定（绑定按键待捕获） */
export function createEmptyBinding(): KeyBinding {
  return {
    id: newBindingId(),
    trigger: { kind: 'keyboard', code: '', label: '' },
    holdThresholdMs: HOLD_THRESHOLD_DEFAULT,
  }
}

/** 新建一条空防抖规则（绑定按键待捕获） */
export function newDebounceRuleId(): string {
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** 新建一条默认启用的空防抖规则（绑定按键待捕获） */
export function createEmptyDebounceRule(): DebounceRule {
  return {
    id: newDebounceRuleId(),
    trigger: { kind: 'keyboard', code: '', label: '' },
    enabled: true,
    windowMs: DEBOUNCE_WINDOW_DEFAULT,
  }
}

/** 新建一个指定类型的空动作 */
export function emptyAction(type: ActionType): BindingAction {
  const base: BindingAction = { type }
  if (type === 'keyboard') base.key = ''
  if (type === 'mouse') base.mouseFn = 'middle'
  if (type === 'command') base.command = 'volumeUp'
  if (type === 'launch') base.path = ''
  if (type === 'macro') base.macroId = ''
  return base
}

/** 动作摘要（列表「绑定动作」列用）；macroName 由调用方传入，避免此处依赖宏列表 */
export function actionSummary(action: BindingAction | undefined, macroName?: string): string {
  if (!action) return '无'
  switch (action.type) {
    case 'keyboard':
      return action.key ? `键盘 ${action.key}` : '键盘动作（未设置按键）'
    case 'mouse': {
      const label = MOUSE_FUNCTION_OPTIONS.find((o) => o.value === action.mouseFn)?.label ?? '鼠标功能'
      return `鼠标 ${label}`
    }
    case 'command':
      return `系统命令 ${action.command ?? ''}`
    case 'launch':
      return action.path ? `启动程序 ${action.path}` : '启动程序（未选择）'
    case 'macro':
      return macroName ? `宏：${macroName}` : '宏（未选择）'
    case 'disabled':
      return '禁用'
    default:
      return '未知动作'
  }
}

/** 绑定按键展示名（列表 / 表单回显） */
export function triggerLabel(trigger: TriggerKey): string {
  if (!trigger.code) return '未设置'
  return trigger.label || (trigger.kind === 'mouse' ? MOUSE_TRIGGER_LABELS[trigger.code] ?? trigger.code : trigger.code)
}

/** 绑定按键是否为系统保留（左键 / 右键）。仅用于「按键映射」校验；防抖规则允许左右键。 */
export function isReservedTrigger(trigger: TriggerKey): boolean {
  return trigger.kind === 'mouse' && RESERVED_TRIGGERS.includes(trigger.code)
}
