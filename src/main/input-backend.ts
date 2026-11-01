// 输入后端：全局捕获（uiohook-napi）+ 全局回放注入（@nut-tree/nut-js）
// 两者都是 N-API 预编译产物，随 Electron 大版本升级一般无需 electron-rebuild；
// 任一模块缺失/加载失败都不让主进程崩溃，降级为「不可用」并由 UI 提示（见 getInputStatus）
import { resolveNutKey, splitCombo } from './keymap'

type AnyRec = Record<string, any>

export interface CaptureBackend {
  uIOhook: AnyRec
  /** keycode → 键名（如 65 → 'A'） */
  keyNameOf: (keycode: number) => string
  /** 同步禁用拦截表（keycode + 修饰键掩码 + 类型 0键盘/1鼠标），C 层在 OS 层吞掉命中事件 */
  setBlockedKeys?: (keycodes: number[], masks: number[], kinds: number[]) => void
  /** 同步防抖表（keycode + 修饰键掩码 + 窗口 ms + 类型），C 层吞掉窗口内的重复按下 */
  setDebounce?: (keycodes: number[], masks: number[], windowMs: number[], kinds: number[]) => void
}

export interface PlaybackBackend {
  keyboard: AnyRec
  mouse: AnyRec
  Key: AnyRec
  Button: AnyRec
  Point: any
  straightTo: any
}

export interface InputStatus {
  capture: boolean
  playback: boolean
  errors: string[]
}

let loaded = false
let capture: CaptureBackend | null = null
let playback: PlaybackBackend | null = null
let uiohookKeyMap: AnyRec = {}
const status: InputStatus = { capture: false, playback: false, errors: [] }

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** uiohook 的 UiohookKey 是「键名 → keycode」，这里反查得到键名 */
function nameOf(UiohookKey: AnyRec, keycode: number): string {
  for (const [name, code] of Object.entries(UiohookKey)) {
    if (code === keycode) return name
  }
  return `Key${keycode}`
}

/** 修饰键短名 → uiohook 掩码（对应 libuiohook MASK_SHIFT/CTRL/ALT/META，左右键合并） */
const MODIFIER_MASK: Record<string, number> = {
  Ctrl: 0x22,
  Control: 0x22,
  Shift: 0x11,
  Alt: 0x88,
  Win: 0x44,
  Meta: 0x44,
}

/** 展示名别名 → UiohookKey 键名（displayKeyName 的逆映射） */
const DISPLAY_ALIAS: Record<string, string> = {
  Esc: 'Escape',
  Win: 'Meta',
  '←': 'ArrowLeft',
  '→': 'ArrowRight',
  '↑': 'ArrowUp',
  '↓': 'ArrowDown',
}

/** 键名 → keycode 反查（'E' → 18）；查不到返回 null */
export function keycodeOf(name: string): number | null {
  const canonical = DISPLAY_ALIAS[name] ?? name
  const code = uiohookKeyMap[canonical]
  return typeof code === 'number' ? code : null
}

/**
 * 组合键摘要 → 拦截条目 {keycode, mask}（供禁用绑定同步 C 层拦截表）。
 * 例：'Ctrl+E' → { keycode: 18, mask: 0x22 }；'E' → { keycode: 18, mask: 0 }。
 * 主键无法解析时返回 null（该绑定跳过拦截）。
 */
export function comboToBlockEntry(comboLabel: string): { keycode: number; mask: number } | null {
  const parts = splitCombo(comboLabel)
  if (parts.length === 0) return null
  const main = parts[parts.length - 1]
  const keycode = keycodeOf(main)
  if (keycode === null) return null
  let mask = 0
  for (const p of parts.slice(0, -1)) {
    mask |= MODIFIER_MASK[p] ?? 0
  }
  return { keycode, mask }
}

/** 鼠标键名 → 按钮码（与 uiohook MOUSE_BUTTON_* 一致） */
const MOUSE_BUTTON_CODE: Record<string, number> = {
  left: 1,
  right: 2,
  middle: 3,
  x1: 4,
  x2: 5,
}

/**
 * 鼠标组合键摘要 → 拦截条目 {keycode, mask}（供鼠标防抖/禁用同步 C 层）。
 * 例：'left' → { keycode: 1, mask: 0 }；'Ctrl+left' → { keycode: 1, mask: 0x22 }。
 * 按钮名无法解析时返回 null（该规则跳过拦截）。
 */
export function mouseComboToBlockEntry(comboLabel: string): { keycode: number; mask: number } | null {
  const parts = splitCombo(comboLabel)
  if (parts.length === 0) return null
  const main = parts[parts.length - 1]
  const keycode = MOUSE_BUTTON_CODE[main]
  if (keycode === undefined) return null
  let mask = 0
  for (const p of parts.slice(0, -1)) {
    mask |= MODIFIER_MASK[p] ?? 0
  }
  return { keycode, mask }
}

function load(): void {
  if (loaded) return
  loaded = true

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('uiohook-napi') as AnyRec
    const UiohookKey: AnyRec = mod.UiohookKey ?? {}
    uiohookKeyMap = UiohookKey
    capture = {
      uIOhook: mod.uIOhook,
      keyNameOf: (keycode: number) => nameOf(UiohookKey, keycode),
      setBlockedKeys: (keycodes: number[], masks: number[], kinds: number[]) => {
        mod.uIOhook.setBlockedKeys(keycodes, masks, kinds)
      },
      setDebounce: (keycodes: number[], masks: number[], windowMs: number[], kinds: number[]) => {
        mod.uIOhook.setDebounce(keycodes, masks, windowMs, kinds)
      },
    }
    status.capture = true
  } catch (e) {
    status.errors.push(`捕获模块 uiohook-napi 加载失败：${errText(e)}`)
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nut = require('@nut-tree/nut-js') as AnyRec
    playback = {
      keyboard: nut.keyboard,
      mouse: nut.mouse,
      Key: (nut.Key ?? {}) as AnyRec,
      Button: (nut.Button ?? {}) as AnyRec,
      Point: nut.Point,
      straightTo: nut.straightTo,
    }
    // 关掉 nut-js 自带的输入间隔，延迟完全由宏步骤的 delay 控制
    if (playback?.keyboard?.config) playback.keyboard.config.autoDelayMs = 0
    if (playback?.mouse?.config) {
      // 必须同步关掉鼠标动作的内置延迟（nut-js v4 默认 100ms，否则每个按下/抬起前都白等 100ms）
      playback.mouse.config.autoDelayMs = 0
      playback.mouse.config.mouseSpeed = 2000
    }
    status.playback = true
  } catch (e) {
    status.errors.push(`回放模块 @nut-tree/nut-js 加载失败：${errText(e)}`)
  }
}

export function ensureInputBackend(): InputStatus {
  load()
  return { ...status }
}

export function getInputStatus(): InputStatus {
  load()
  return { ...status }
}

export function getCapture(): CaptureBackend | null {
  load()
  return capture
}

export function getPlayback(): PlaybackBackend | null {
  load()
  return playback
}

/** 校验录制/回放所需能力，返回不可用时的人类可读原因 */
export function requireCapture(): { ok: true; backend: CaptureBackend } | { ok: false; reason: string } {
  load()
  if (!capture) return { ok: false, reason: status.errors[0] ?? '输入捕获模块不可用' }
  return { ok: true, backend: capture }
}

export function requirePlayback(): { ok: true; backend: PlaybackBackend } | { ok: false; reason: string } {
  load()
  if (!playback) return { ok: false, reason: status.errors[0] ?? '输入回放模块不可用' }
  return { ok: true, backend: playback }
}

/**
 * 扫描码注入是否可用：Windows 且捕获模块已加载。
 * uiohook 补丁的 keyToggle 走 SendInput + KEYEVENTF_SCANCODE（完整击键链），
 * 游戏按扫描码识别按键（如原神数字键切人）；nut-js 只发虚拟键码、wScan 恒 0，会被忽略。
 */
export function canSendScan(): boolean {
  return process.platform === 'win32' && getCapture() !== null
}

/** 组合键摘要 → uiohook 扫描码数组（keycodeOf 已含 Esc/Win/方向键别名） */
export function comboToKeycodes(key: string): { codes: number[]; missing: string[] } {
  const parts = splitCombo(key)
  const codes: number[] = []
  const missing: string[] = []
  for (const part of parts) {
    const code = keycodeOf(part)
    if (code === null) missing.push(part)
    else codes.push(code)
  }
  return { codes, missing }
}

/** 扫描码级按下/抬起（keyToggle 同步返回；down=true 按下） */
export function toggleScanKey(keycode: number, down: boolean): { ok: true } | { ok: false; reason: string } {
  const cap = getCapture()
  if (!cap) return { ok: false, reason: status.errors[0] ?? '输入捕获模块不可用' }
  try {
    cap.uIOhook.keyToggle(keycode, down ? 'down' : 'up')
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

export { resolveNutKey }
