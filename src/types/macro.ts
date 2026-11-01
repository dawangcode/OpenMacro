// 宏 / 宏步骤领域模型（renderer 与 main 共用）
// main 侧用相对路径引用（tsconfig.node.json 未配 @/* alias），renderer 侧用 @/types/macro

/** 步骤动作类型（PRD 4.5 时间轴） */
export type MacroStepKind =
  | 'keyboard' // 键盘动作
  | 'mouse' // 鼠标动作
  | 'delay' // 等待（独立步骤，时长即本步「延迟」列的值）
  | 'text' // 文本输入
  | 'command' // 系统命令
  | 'loopStart' // 循环开始
  | 'loopEnd' // 循环结束

/** 键盘动作细分：按下 / 抬起 / 单击（按下并抬起） */
export type KeyboardAction = 'down' | 'up' | 'click'

export type MouseButton = 'left' | 'right' | 'middle' | 'x1' | 'x2'

export type MouseAction = 'down' | 'up' | 'click' | 'move' | 'wheelUp' | 'wheelDown'

/** 步骤动作细分：kind 已区分键盘/鼠标，统一一个 action 字段 */
export type StepAction = KeyboardAction | MouseAction

export type SystemCommand =
  | 'volumeUp'
  | 'volumeDown'
  | 'mute'
  | 'mediaPlayPause'
  | 'mediaPrev'
  | 'mediaNext'
  | 'screenshot'
  | 'switchDesktop'

/** 播放方式（PRD 4.5 播放设置） */
export type PlayMode = 'once' | 'holdRepeat' | 'toggleLoop' | 'sequence'

export interface MacroStep {
  id: string
  kind: MacroStepKind
  /** 展示用摘要，如"按下 A 键""左键单击" */
  label: string
  /** 动作步骤：执行本步前的等待；delay 步骤：等待时长本身（毫秒） */
  delay: number
  /** 键盘/鼠标共用的「目标键」：键盘为单键或组合键如 'A'/'Ctrl+Shift+A'，鼠标为按钮名如 'left'/'x1' */
  key?: string
  /** 动作细分（kind 已区分键盘/鼠标）；旧字段 keyboardAction/mouseAction 已统一为 action */
  action?: StepAction
  x?: number
  y?: number
  wheelAmount?: number
  /** text */
  text?: string
  /** command */
  command?: SystemCommand
  /** loopStart 必填 */
  loopCount?: number
}

export interface Macro {
  id: string
  name: string
  steps: MacroStep[]
  playMode: PlayMode
  /** 按住重复：重复间隔（10~10000ms） */
  repeatInterval: number
  /** 按序列执行：播放次数（1~9999） */
  playCount: number
  /** 播放速度倍率 0.5~5 */
  speed: number
  createdAt: number
  updatedAt: number
}

/** 导入导出文件格式（不符合即跳过） */
export interface MacroFile {
  type: 'openmacro-macro'
  macro: Omit<Macro, 'id' | 'createdAt' | 'updatedAt'>
}

export const MACRO_FILE_TYPE = 'openmacro-macro'
export const MACRO_NAME_MAX = 50
/** 步骤延迟默认 100ms，最小 0ms（0 = 与上一步同刻执行，如鼠标单击的按下→抬起） */
export const STEP_DEFAULT_DELAY = 100
export const STEP_MIN_DELAY = 0
export const STEP_MAX_DELAY = 600000
/** 播放速度倍率 0.5~5（PRD 4.5） */
export const SPEED_MIN = 0.5
export const SPEED_MAX = 5
export const REPEAT_INTERVAL_MIN = 10
export const REPEAT_INTERVAL_MAX = 10000
export const PLAY_COUNT_MIN = 1
export const PLAY_COUNT_MAX = 9999
/** 循环开始步骤次数 1~9999（与 playCount 同上限，回放侧同步 clamp） */
export const LOOP_COUNT_MIN = 1
export const LOOP_COUNT_MAX = 9999
/** 滚轮步骤量 1~999 */
export const WHEEL_AMOUNT_MIN = 1
export const WHEEL_AMOUNT_MAX = 999
export const DEFAULT_REPEAT_INTERVAL = 100
export const DEFAULT_PLAY_COUNT = 1

export const STEP_KIND_OPTIONS: { value: MacroStepKind; label: string }[] = [
  { value: 'keyboard', label: '键盘动作' },
  { value: 'mouse', label: '鼠标动作' },
  { value: 'delay', label: '等待' },
  { value: 'text', label: '文本输入' },
  { value: 'command', label: '系统命令' },
  { value: 'loopStart', label: '循环开始' },
  { value: 'loopEnd', label: '循环结束' },
]

export const MOUSE_BUTTON_OPTIONS: { value: MouseButton; label: string }[] = [
  { value: 'left', label: '左键' },
  { value: 'right', label: '右键' },
  { value: 'middle', label: '中键' },
  { value: 'x1', label: '侧键4' },
  { value: 'x2', label: '侧键5' },
]

export const MOUSE_ACTION_OPTIONS: { value: MouseAction; label: string }[] = [
  { value: 'down', label: '按下' },
  { value: 'up', label: '抬起' },
  { value: 'click', label: '单击' },
  { value: 'move', label: '移动坐标' },
  { value: 'wheelUp', label: '滚轮上滚' },
  { value: 'wheelDown', label: '滚轮下滚' },
]

/** 键盘动作选项：与鼠标共用「按下/抬起/单击」标签，值用 tap（回放按 KeyboardAction 判定） */
export const KEYBOARD_ACTION_OPTIONS: { value: KeyboardAction; label: string }[] = [
  { value: 'down', label: '按下' },
  { value: 'up', label: '抬起' },
  { value: 'click', label: '单击' },
]

export const SYSTEM_COMMAND_OPTIONS: { value: SystemCommand; label: string }[] = [
  { value: 'volumeUp', label: '音量加' },
  { value: 'volumeDown', label: '音量减' },
  { value: 'mute', label: '静音' },
  { value: 'mediaPlayPause', label: '播放暂停' },
  { value: 'mediaPrev', label: '上一曲' },
  { value: 'mediaNext', label: '下一曲' },
  { value: 'screenshot', label: '截图' },
  { value: 'switchDesktop', label: '切换桌面' },
]

export const PLAY_MODE_OPTIONS: { value: PlayMode; label: string }[] = [
  { value: 'once', label: '单次执行' },
  { value: 'holdRepeat', label: '按住重复' },
  { value: 'toggleLoop', label: '按下切换循环' },
  { value: 'sequence', label: '按序列执行' },
]

/** 预计时长 = 各步骤延迟累加（PRD 4.4 列表字段） */
export function calcMacroDuration(steps: MacroStep[]): number {
  return steps.reduce((sum, s) => sum + (Number(s.delay) || 0), 0)
}

export function formatDuration(ms: number): string {
  if (!ms) return '0 毫秒'
  if (ms < 1000) return `${ms} 毫秒`
  if (ms < 60000) return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)} 秒`
  const m = Math.floor(ms / 60000)
  const s = Math.round((ms % 60000) / 1000)
  return `${m} 分 ${s} 秒`
}

/** 循环开始与循环结束必须成对（PRD 4.5 校验） */
export function validateLoops(steps: MacroStep[]): boolean {
  let depth = 0
  for (const s of steps) {
    if (s.kind === 'loopStart') depth += 1
    if (s.kind === 'loopEnd') {
      depth -= 1
      if (depth < 0) return false
    }
  }
  return depth === 0
}

/** 名称追加序号：副本 / 导入冲突重命名（PRD 4.4 业务规则） */
export function nextName(base: string, existed: string[], exclude?: string): string {
  const set = new Set(existed.filter((n) => n !== exclude))
  if (!set.has(base)) return base
  let i = 2
  while (set.has(`${base} (${i})`)) i += 1
  return `${base} (${i})`
}

export function createEmptyMacro(name = '未命名宏'): Macro {
  const now = Date.now()
  return {
    id: `m_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    steps: [],
    playMode: 'once',
    repeatInterval: DEFAULT_REPEAT_INTERVAL,
    playCount: DEFAULT_PLAY_COUNT,
    speed: 1,
    createdAt: now,
    updatedAt: now,
  }
}

/** 生成步骤 id（等待步骤拆分时复用） */
export function newStepId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 步骤模型归一化：把动作步骤自带的延迟拆成独立「等待」步骤。
 * 新模型里时间信息只由等待步骤承载；本函数幂等，动作步骤 delay 均为 0 时原样返回。
 * 旧结构数据（编辑器/导出前）在读取路径上统一转换，无需手工迁移。
 * 瘦身导入的动作步骤可能缺 delay 字段：先兜底成数值（缺失/非法按 0），
 * 否则 undefined 会穿透到编辑器校验（Number.isFinite 失败报「步骤延迟须为整数」）。
 */
export function normalizeStepDelays(steps: MacroStep[]): MacroStep[] {
  const coerced = steps.map((s) => {
    const n = Number(s.delay)
    return Number.isFinite(n) ? { ...s, delay: n } : { ...s, delay: 0 }
  })
  const stale = coerced.some((s) => s.kind !== 'delay' && Number.isFinite(s.delay) && s.delay > 0)
  if (!stale) return coerced
  const out: MacroStep[] = []
  for (const s of coerced) {
    if (s.kind !== 'delay' && Number.isFinite(s.delay) && s.delay > 0) {
      out.push({ id: newStepId(), kind: 'delay', label: '', delay: Math.round(s.delay) })
      out.push({ ...s, delay: 0 })
    } else {
      out.push(s)
    }
  }
  return out
}

/**
 * 导出瘦身：id/label 由导入端自动重建；动作步骤延迟恒 0，直接省略 delay 字段
 * （导入端 normalizeStep 对缺失 delay 兜底 0，等待步骤的 delay 必有值）。
 * 仅用于 JSON 序列化，运行时步骤仍需完整结构。
 */
export function slimStepsForExport(steps: MacroStep[]): unknown[] {
  return steps.map((s) => {
    const { id: _id, label: _label, ...rest } = s as Record<string, unknown> & typeof s
    // 空键盘键无意义（如导入的手写 JSON 给鼠标步骤带了 key:""），导出时剥掉
    if (rest.key === '') delete rest.key
    // 防御：任何残留的旧 button 字段一律不进导出文件（统一用 key）
    if (typeof rest.button === 'string') delete rest.button
    if (s.kind !== 'delay' && rest.delay === 0) {
      const { delay: _delay, ...core } = rest
      return core
    }
    return rest
  })
}

/**
 * 导入兼容：早期文件用 keyboardAction/mouseAction 字段名，统一映射为 action
 * （kind 已区分键盘/鼠标，无需前缀）。
 */
export function expandStepKeys(steps: unknown[]): MacroStep[] {
  return steps.map((raw) => {
    const s = { ...(raw as Record<string, unknown>) }
    if (typeof s.keyboardAction === 'string') {
      s.action = s.keyboardAction
      delete s.keyboardAction
    }
    if (typeof s.mouseAction === 'string') {
      s.action = s.mouseAction
      delete s.mouseAction
    }
    // 旧数据鼠标步骤用 button 字段，统一合并到 key（键盘/鼠标共用“目标键”）
    if (s.kind === 'mouse' && typeof s.button === 'string' && s.key == null) {
      s.key = s.button
      delete s.button
    }
    return s as MacroStep
  })
}


/**
 * 宏文件序列化为 JSON：整体 2 空格缩进，steps 数组每个步骤压成一行
 * （一行一动作，短且好读；配合 slimStepsForExport 使用效果最佳）。
 */
export function stringifyMacroFile(file: MacroFile): string {
  const m = file.macro
  const lines: string[] = ['{']
  lines.push(`  "type": ${JSON.stringify(file.type)},`)
  lines.push('  "macro": {')
  lines.push(`    "name": ${JSON.stringify(m.name)},`)
  // 播放设置放 steps 之前：先看宏配置，再看动作明细
  lines.push(`    "playMode": ${JSON.stringify(m.playMode)},`)
  lines.push(`    "repeatInterval": ${m.repeatInterval},`)
  lines.push(`    "playCount": ${m.playCount},`)
  lines.push(`    "speed": ${m.speed},`)
  if (m.steps.length) {
    lines.push('    "steps": [')
    m.steps.forEach((s, i) => {
      lines.push(`      ${JSON.stringify(s)}${i < m.steps.length - 1 ? ',' : ''}`)
    })
    lines.push('    ]')
  } else {
    lines.push('    "steps": []')
  }
  lines.push('  }')
  lines.push('}')
  return lines.join('\n') + '\n'
}
