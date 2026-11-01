// 键名映射：uiohook-napi（捕获）的键名 ↔ @nut-tree/nut-js（回放）的 Key 枚举
// 两个库的枚举名并不完全一致，这里做「显式映射 + 同名直取 + 变体兜底」三级匹配，
// 匹配不到的键回放时跳过并计入 warnings（真机核对清单见 README）
export const MODIFIER_ALIAS: Record<string, string> = {
  Ctrl: 'LeftControl',
  Control: 'LeftControl',
  Shift: 'LeftShift',
  Alt: 'LeftAlt',
  Win: 'LeftSuper',
  Meta: 'LeftSuper',
}

/**
 * 数字键映射（两个库命名完全不同，且两组名字相近极易搞混，故单独用循环生成）：
 * - 主行数字：uiohook 的 UiohookKey 成员名就是字符本身（'0'..'9'，
 *   见 uiohook-napi-patch/dist/index.d.ts 的 `readonly 1: 2`）；nut-js 用 D0..D9 命名主行数字。
 *   此前完全没有这一组映射，而 TS enum 成员名不可能是数字字面量，Key['1'] 永远取不到，
 *   于是录制能存下「1」、回放却把它丢掉。
 * - 小键盘：uiohook 是 Numpad0..Numpad9；nut-js 是 Num0..Num9。
 *   原先写的 `Num0: 'Num0'` 是死映射——uiohook 从不产出 'Num0' 这个名字，永远命中不到，
 *   所以小键盘数字此前同样放不出来。
 * 循环生成而非手写 20 条：避免错漏，改动也只需动这一处。
 */
const DIGIT_ROW_TO_NUT: Record<string, string> = {}
const NUMPAD_TO_NUT: Record<string, string> = {}
for (let d = 0; d <= 9; d += 1) {
  DIGIT_ROW_TO_NUT[String(d)] = `D${d}`
  NUMPAD_TO_NUT[`Numpad${d}`] = `Num${d}`
}

/** uiohook 常用键名 → nut-js Key 名（仅列两个库命名不一致的） */
const UIOHOOK_TO_NUT: Record<string, string> = {
  ControlLeft: 'LeftControl',
  ControlRight: 'RightControl',
  ShiftLeft: 'LeftShift',
  ShiftRight: 'RightShift',
  AltLeft: 'LeftAlt',
  AltRight: 'RightAlt',
  MetaLeft: 'LeftSuper',
  MetaRight: 'RightSuper',
  Escape: 'Escape',
  Return: 'Enter',
  Space: 'Space',
  Backspace: 'Backspace',
  Delete: 'Delete',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ...DIGIT_ROW_TO_NUT,
  ...NUMPAD_TO_NUT,
}

/**
 * 数字键兜底名：nut-js 各版本对数字键的命名可能不同，逐个尝试。
 * 刻意不做「主行 ↔ 小键盘」互相兜底：两者是物理上不同的键，NumLock 关闭时小键盘语义完全不同，
 * 宁可映射不上时丢弃并告警，也不能按成另一个键。
 */
const DIGIT_ROW_FALLBACKS: Record<string, string[]> = {}
const NUMPAD_FALLBACKS: Record<string, string[]> = {}
for (let d = 0; d <= 9; d += 1) {
  DIGIT_ROW_FALLBACKS[`D${d}`] = [`Digit${d}`, `NumPad${d}`, String(d)]
  NUMPAD_FALLBACKS[`Num${d}`] = [`Numpad${d}`, `NumPad${d}`, `Kp${d}`]
}

/** nut-js Key 名在部分版本下的别名，逐个尝试 */
const NUT_FALLBACKS: Record<string, string[]> = {
  LeftSuper: ['LeftWin', 'LeftCmd', 'Meta'],
  RightSuper: ['RightWin', 'RightCmd'],
  Enter: ['Return'],
  ...DIGIT_ROW_FALLBACKS,
  ...NUMPAD_FALLBACKS,
}

const cache = new Map<string, number | null>()

/** 把单个键名解析为 nut-js 的 Key 数值；解析不到返回 null */
export function resolveNutKey(KeyEnum: Record<string, number>, name: string): number | null {
  const cacheKey = `${name}`
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null

  const candidates: string[] = []
  const mapped = UIOHOOK_TO_NUT[name]
  if (mapped) candidates.push(mapped)
  candidates.push(name)
  const fb = NUT_FALLBACKS[mapped || name]
  if (fb) candidates.push(...fb)
  // 再补一轮别名展开
  candidates.push(...candidates.flatMap((c) => NUT_FALLBACKS[c] ?? []))

  for (const c of candidates) {
    const v = KeyEnum[c]
    if (typeof v === 'number') {
      cache.set(cacheKey, v)
      return v
    }
  }
  cache.set(cacheKey, null)
  return null
}

/** 'Ctrl+Shift+A' → ['Ctrl','Shift','A'] */
export function splitCombo(key: string): string[] {
  return key
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 把组合键拆成修饰键 + 主键，返回 nut-js Key 数值数组（无效键丢弃） */
export function comboToNutKeys(
  KeyEnum: Record<string, number>,
  key: string,
): { keys: number[]; missing: string[] } {
  const parts = splitCombo(key)
  const keys: number[] = []
  const missing: string[] = []
  for (const part of parts) {
    const resolved =
      resolveNutKey(KeyEnum, part) ??
      (MODIFIER_ALIAS[part] ? resolveNutKey(KeyEnum, MODIFIER_ALIAS[part]) : null)
    if (resolved === null) missing.push(part)
    else keys.push(resolved)
  }
  return { keys, missing }
}

/** 修饰键短名（用于录制时生成 'Ctrl+A' 这类可读摘要） */
export function modifierShortName(uiohookName: string): string | null {
  // 本机 uiohook 枚举用 Ctrl / CtrlRight；Control 前缀是 nut-js 侧命名，一并兼容
  if (uiohookName.startsWith('Ctrl') || uiohookName.startsWith('Control')) return 'Ctrl'
  if (uiohookName.startsWith('Shift')) return 'Shift'
  if (uiohookName.startsWith('Alt')) return 'Alt'
  if (uiohookName.startsWith('Meta')) return 'Win'
  return null
}

/** 显示名：'Escape' → 'Esc' 之类的阅读优化，未列出的原样返回 */
const DISPLAY: Record<string, string> = { Escape: 'Esc', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' }
export function displayKeyName(name: string): string {
  return DISPLAY[name] ?? name
}

/**
 * 由「当前按住的键集合 + 刚按下的键」生成组合键摘要，如 'Ctrl+Shift+A'。
 * 录制（recorder）与按键捕获（capture）共用，保证两处摘要格式一致。
 */
export function comboLabelFrom(pressed: Set<string>, raw: string): string {
  const short = modifierShortName(raw)
  const mods = [...pressed]
    .filter((k) => k !== raw)
    .map((k) => modifierShortName(k))
    .filter((v): v is string => !!v)
  return [...mods, short ?? displayKeyName(raw)].join('+')
}
