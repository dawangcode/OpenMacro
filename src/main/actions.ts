// 原子输入动作（src/main/actions.ts）
// 键盘组合 / 鼠标功能 / 系统命令 / 启动程序四类原子动作，
// 宏回放（player）与按键绑定运行时（binding-engine）共用，避免两套注入逻辑漂移。
// 全部走 requirePlayback()（nut-js 懒加载），模块不可用时返回人类可读原因而不抛栈。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { extname } from 'node:path'
import { emitToRenderer } from './events'
import { canSendScan, comboToKeycodes, requirePlayback, toggleScanKey } from './input-backend'
import { comboToNutKeys, resolveNutKey } from './keymap'
import { markSyntheticInjection } from './synthetic'
import type { SystemCommand } from '../types/macro'
import type { MouseFunction } from '../types/binding'

/** 系统命令 → nut-js Key 候选名（各平台命名不一，逐个尝试） */
const COMMAND_KEY_CANDIDATES: Record<SystemCommand, string[]> = {
  volumeUp: ['AudioUp', 'AudioVolumeUp'],
  volumeDown: ['AudioDown', 'AudioVolumeDown'],
  mute: ['AudioMute', 'AudioMuteToggle'],
  mediaPlayPause: ['AudioPlay', 'MediaPlayPause'],
  mediaPrev: ['AudioPrev', 'MediaPreviousTrack'],
  mediaNext: ['AudioNext', 'MediaNextTrack'],
  screenshot: ['PrintScreen', 'Print', 'Snapshot'],
  switchDesktop: [], // 走组合键 Ctrl+Win+Right
}

/** 可执行文件扩展名白名单（PRD 4.1：仅接受可执行文件） */
const EXECUTABLE_EXT = ['.exe', '.bat', '.cmd', '.com', '.lnk']

/** 向渲染进程推送一条动作告警（绑定触发时无 IPC 返回值可挂，走事件通道） */
export function emitActionWarning(text: string): void {
  emitToRenderer('macro:action:warning', text)
}

function warnText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** 侧键4/5 回放不支持的统一告警文案（nut-js 无 X1/X2 注入能力） */
export function sideButtonWarning(btnKey: string): string {
  return `鼠标${btnKey === 'x1' ? '侧键4' : '侧键5'}回放不支持，已跳过`
}

/** 鼠标按键名 → nut-js Button 数值；x1/x2 与未知按键返回 null（调用方告警跳过） */
export function nutButtonOf(btnKey: string): number | null {
  const pb = requirePlayback()
  if (!pb.ok) return null
  const map: Record<string, number | undefined> = {
    left: pb.backend.Button?.LEFT,
    right: pb.backend.Button?.RIGHT,
    middle: pb.backend.Button?.MIDDLE,
  }
  const v = map[btnKey]
  return typeof v === 'number' ? v : null
}

/** 按下组合键（不放） */
export async function pressCombo(key: string): Promise<string[]> {
  // Windows 优先扫描码注入（与 player 一致，游戏按键识别依赖扫描码）
  if (canSendScan()) {
    const { codes, missing } = comboToKeycodes(key)
    if (missing.length) return [`无法映射的按键：${missing.join('+')}`]
    const warnings: string[] = []
    markSyntheticInjection()
    for (const c of codes) {
      const r = toggleScanKey(c, true)
      if (!r.ok) warnings.push(r.reason)
    }
    return warnings
  }
  const pb = requirePlayback()
  if (!pb.ok) return [pb.reason]
  const { keyboard, Key } = pb.backend
  const { keys, missing } = comboToNutKeys(Key, key)
  // 与 player 一致：部分键映射不上时整键跳过，避免只按出修饰键
  if (missing.length) return [`无法映射的按键：${missing.join('+')}`]
  const warnings: string[] = []
  try {
    markSyntheticInjection()
    for (const k of keys) await keyboard.pressKey(k)
  } catch (e) {
    warnings.push(warnText(e))
  }
  return warnings
}

/** 反序释放组合键（与 pressCombo 配对，避免修饰键卡住） */
export async function releaseCombo(key: string): Promise<string[]> {
  if (canSendScan()) {
    const warnings: string[] = []
    markSyntheticInjection()
    for (const c of comboToKeycodes(key).codes.reverse()) {
      const r = toggleScanKey(c, false)
      if (!r.ok) warnings.push(r.reason)
    }
    return warnings
  }
  const pb = requirePlayback()
  if (!pb.ok) return [pb.reason]
  const { keyboard, Key } = pb.backend
  const { keys } = comboToNutKeys(Key, key)
  try {
    markSyntheticInjection()
    for (const k of [...keys].reverse()) await keyboard.releaseKey(k)
  } catch (e) {
    return [warnText(e)]
  }
  return []
}

/** 单击组合键（按下并释放） */
export async function tapCombo(key: string): Promise<string[]> {
  const warnings = await pressCombo(key)
  warnings.push(...(await releaseCombo(key)))
  return warnings
}

/** 输入文本（逐字符） */
export async function typeText(text: string): Promise<string[]> {
  const pb = requirePlayback()
  if (!pb.ok) return [pb.reason]
  try {
    markSyntheticInjection()
    await pb.backend.keyboard.type(text)
  } catch (e) {
    return [warnText(e)]
  }
  return []
}

/** 鼠标移到绝对坐标 */
export async function moveMouseTo(x: number, y: number): Promise<string[]> {
  const pb = requirePlayback()
  if (!pb.ok) return [pb.reason]
  const { mouse, Point, straightTo } = pb.backend
  try {
    markSyntheticInjection()
    await mouse.move(straightTo(new Point(x, y)))
  } catch (e) {
    return [warnText(e)]
  }
  return []
}

/** 滚轮（amount ≥ 1） */
export async function scrollWheel(up: boolean, amount: number): Promise<string[]> {
  const pb = requirePlayback()
  if (!pb.ok) return [pb.reason]
  const n = Math.max(1, Math.round(amount) || 1)
  try {
    markSyntheticInjection()
    if (up) await pb.backend.mouse.scrollUp(n)
    else await pb.backend.mouse.scrollDown(n)
  } catch (e) {
    return [warnText(e)]
  }
  return []
}

/** 鼠标功能动作（PRD 4.1 动作类型「鼠标功能」） */
export async function execMouseFunction(fn: MouseFunction): Promise<string[]> {
  if (fn === 'wheelUp' || fn === 'wheelDown') return scrollWheel(fn === 'wheelUp', 1)
  const btn = nutButtonOf(fn)
  if (btn === null) return [sideButtonWarning(fn)]
  const pb = requirePlayback()
  if (!pb.ok) return [pb.reason]
  try {
    markSyntheticInjection()
    await pb.backend.mouse.pressButton(btn)
    await pb.backend.mouse.releaseButton(btn)
  } catch (e) {
    return [warnText(e)]
  }
  return []
}

/** 系统命令动作 */
export async function execSystemCommand(cmd: SystemCommand): Promise<string[]> {
  if (cmd === 'switchDesktop') return tapCombo('Ctrl+Win+Right')
  const pb = requirePlayback()
  if (!pb.ok) return [pb.reason]
  const { keyboard, Key } = pb.backend
  const name = COMMAND_KEY_CANDIDATES[cmd].map((c) => resolveNutKey(Key, c)).find((v) => v != null)
  if (name == null) return [`系统命令「${cmd}」当前回放引擎不支持，已跳过`]
  try {
    markSyntheticInjection()
    await keyboard.pressKey(name)
    await keyboard.releaseKey(name)
  } catch (e) {
    return [warnText(e)]
  }
  return []
}

/** 校验程序路径（保存绑定与启动前双保险，PRD 4.1 异常：路径无效阻止保存） */
export function validateProgramPath(p: string): { ok: boolean; reason?: string } {
  const path = (p || '').trim()
  if (!path) return { ok: false, reason: '程序路径不能为空' }
  const ext = extname(path).toLowerCase()
  if (!EXECUTABLE_EXT.includes(ext)) {
    return { ok: false, reason: '程序路径无效：仅支持可执行文件（exe / bat / cmd / lnk）' }
  }
  if (!existsSync(path)) return { ok: false, reason: '程序路径无效：文件不存在' }
  return { ok: true }
}

/** 启动外部程序（ detached，不随本软件退出） */
export function launchProgram(p: string): { ok: boolean; reason?: string } {
  const v = validateProgramPath(p)
  if (!v.ok) return v
  const path = p.trim()
  try {
    const child =
      extname(path).toLowerCase() === '.lnk'
        ? spawn('cmd.exe', ['/c', 'start', '', path], { detached: true, stdio: 'ignore', windowsHide: true })
        : spawn(path, [], { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', (err) => emitActionWarning(`启动程序失败：${err.message}`))
    child.unref()
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: `启动程序失败：${warnText(e)}` }
  }
}
