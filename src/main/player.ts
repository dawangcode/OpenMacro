// 宏回放：按时间轴步骤注入键鼠输入（src/main/player.ts）
// 播放方式（PRD 4.5 / 4.6）：
//   once / sequence     按次数跑完自停；
//   toggleLoop          按一次开始、再按一次停止（按键绑定运行时切状态）；
//   holdRepeat          绑定按键按住期间按 repeatInterval 循环，松开由调用方 stopAll；
// 循环模式进度统一显示「循环中」，跑到 stopAll 为止。
// 原子输入动作统一走 ./actions，与按键绑定运行时同一套注入逻辑。
import { emitToRenderer } from './events'
import { nutButtonOf, releaseCombo, scrollWheel, execSystemCommand, sideButtonWarning, moveMouseTo, typeText } from './actions'
import { markSyntheticInjection } from './synthetic'
import { canSendScan, comboToKeycodes, requirePlayback, toggleScanKey } from './input-backend'
import { comboToNutKeys } from './keymap'
import { LOOP_COUNT_MAX, LOOP_COUNT_MIN, Macro, MacroStep, PlayMode } from '../types/macro'

export interface PlaybackState {
  running: boolean
  macroId: string | null
  macroName: string
  mode: PlayMode | null
  /** 第 N 次 / 共 M 次 */
  current: number
  total: number
  progress: string
  reason?: string
}

const state: PlaybackState = {
  running: false,
  macroId: null,
  macroName: '',
  mode: null,
  current: 0,
  total: 0,
  progress: '未运行',
}

let stopped = true
let warnings: string[] = []

function emit(): void {
  emitToRenderer('macro:playback:state', { ...state })
}

function emitProgress(): void {
  state.progress = state.running
    ? state.total > 1
      ? `第 ${state.current} 次 / 共 ${state.total} 次`
      : isLoopMode(state.mode ?? 'once')
        ? '循环中'
        : '运行中'
    : '未运行'
  emit()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const end = performance.now() + ms
    const wait = () => {
      const left = end - performance.now()
      if (stopped || left <= 0) return resolve()
      if (left > 4) setTimeout(wait, left - 2) // 长段走定时器
      else {
        // 末段自旋补足，避免 Windows 计时粒度（默认 15.6ms）造成的取整偏晚
        while (performance.now() < end && !stopped) {}
        resolve()
      }
    }
    wait()
  })
}

/** 循环模式（toggleLoop / holdRepeat）的进度文案 */
function isLoopMode(mode: PlayMode): boolean {
  return mode === 'toggleLoop' || mode === 'holdRepeat'
}

async function execStep(step: MacroStep): Promise<void> {
  // 等待步骤：runSteps 已按 step.delay sleep 过，这里无需任何输入动作
  if (step.kind === 'delay') return

  if (step.kind === 'keyboard') {
    // Windows 优先扫描码注入：游戏（如原神数字键切人）按扫描码识别按键，
    // nut-js 的纯虚拟键码注入会被忽略；捕获模块不可用时回退 nut-js
    if (canSendScan()) {
      const { codes, missing } = comboToKeycodes(step.key ?? '')
      // 与 nut-js 路径一致：组合键里只要有一个键映射不上就整步跳过
      if (missing.length) {
        warnings.push(`无法映射的按键：${missing.join('+')}`)
        return
      }
      if (!codes.length) return
      const errs: string[] = []
      if (step.action === 'up') {
        for (const c of [...codes].reverse()) {
          const r = toggleScanKey(c, false)
          if (!r.ok) errs.push(r.reason)
        }
      } else {
        markSyntheticInjection()
        for (const c of codes) {
          const r = toggleScanKey(c, true)
          if (!r.ok) errs.push(r.reason)
        }
        if (step.action === 'click') {
          for (const c of [...codes].reverse()) {
            const r = toggleScanKey(c, false)
            if (!r.ok) errs.push(r.reason)
          }
        }
      }
      warnings.push(...errs)
      return
    }

    const pb = requirePlayback()
    if (!pb.ok) {
      warnings.push(pb.reason)
      return
    }
    const { keys, missing } = comboToNutKeys(pb.backend.Key, step.key ?? '')
    // 组合键里只要有一个键映射不上就整步跳过：只按出修饰键（如 Shift+1 只剩 Shift）
    // 既不是用户录制的内容，又可能触发目标程序里「修饰键单独按下」的绑定行为
    if (missing.length) {
      warnings.push(`无法映射的按键：${missing.join('+')}`)
      return
    }
    if (!keys.length) return
    try {
      if (step.action === 'up') {
        await releaseCombo(step.key ?? '')
      } else {
        markSyntheticInjection()
        for (const k of keys) await pb.backend.keyboard.pressKey(k)
        if (step.action === 'click') await releaseCombo(step.key ?? '')
      }
    } catch (e) {
      warnings.push(e instanceof Error ? e.message : String(e))
    }
    return
  }

  if (step.kind === 'mouse') {
    const btnKey = step.key ?? 'left'
    if (step.action === 'move') {
      warnings.push(...(await moveMouseTo(step.x ?? 0, step.y ?? 0)))
      return
    }
    if (step.action === 'wheelUp' || step.action === 'wheelDown') {
      warnings.push(...(await scrollWheel(step.action === 'wheelUp', step.wheelAmount ?? 1)))
      return
    }
    const btn = nutButtonOf(btnKey)
    if (btn === null) {
      warnings.push(btnKey === 'x1' || btnKey === 'x2' ? sideButtonWarning(btnKey) : `未知鼠标按键「${btnKey}」，已跳过`)
      return
    }
    const pb = requirePlayback()
    if (!pb.ok) {
      warnings.push(pb.reason)
      return
    }
    try {
      markSyntheticInjection()
      if (step.action === 'up') await pb.backend.mouse.releaseButton(btn)
      else if (step.action === 'click') {
        // 单击 = 按下并立即抬起（合成单步，等价于 XMBC 的 {LMB}）
        await pb.backend.mouse.pressButton(btn)
        await pb.backend.mouse.releaseButton(btn)
      } else await pb.backend.mouse.pressButton(btn)
    } catch (e) {
      warnings.push(e instanceof Error ? e.message : String(e))
    }
    return
  }

  if (step.kind === 'text') {
    if (step.text) warnings.push(...(await typeText(step.text)))
    return
  }

  if (step.kind === 'command') {
    if (step.command) warnings.push(...(await execSystemCommand(step.command)))
    return
  }
}

async function runSteps(steps: MacroStep[], speed: number): Promise<void> {
  let i = 0
  while (i < steps.length) {
    if (stopped) return
    const step = steps[i]

    if (step.kind === 'loopStart') {
      const endIdx = findLoopEnd(steps, i)
      if (endIdx === -1) {
        i += 1
        continue
      }
      const body = steps.slice(i + 1, endIdx)
      const times = Math.max(LOOP_COUNT_MIN, Math.min(LOOP_COUNT_MAX, Math.round(step.loopCount ?? 1)))
      for (let t = 0; t < times; t += 1) {
        if (stopped) return
        await runSteps(body, speed)
      }
      i = endIdx + 1
      continue
    }

    await sleep(Math.max(0, (Number(step.delay) || 0) / (speed || 1)))
    if (stopped) return
    await execStep(step)
    i += 1
  }
}

/** 与 i 位置 loopStart 配对的 loopEnd 下标；不成对返回 -1 */
function findLoopEnd(steps: MacroStep[], start: number): number {
  let depth = 0
  for (let i = start; i < steps.length; i += 1) {
    if (steps[i].kind === 'loopStart') depth += 1
    else if (steps[i].kind === 'loopEnd') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

export function getPlaybackState(): PlaybackState {
  return { ...state }
}

export function stopAll(): void {
  stopped = true
  state.running = false
  state.current = 0
  state.total = 0
  state.macroId = null
  state.macroName = ''
  state.mode = null
  state.progress = '未运行'
  emit()
}

export interface PlayOptions {
  /** 覆盖宏自身播放方式（试运行 / 绑定触发时按触发语义传） */
  mode?: PlayMode
  /** holdRepeat：两次循环之间的间隔（毫秒，已含宏速度倍率换算由调用方保证或此处处理） */
  intervalMs?: number
}

export async function play(
  macro: Macro,
  opts: PlayOptions = {},
): Promise<{ ok: boolean; reason?: string; warnings?: string[] }> {
  const pb = requirePlayback()
  if (!pb.ok) {
    state.reason = pb.reason
    emit()
    return { ok: false, reason: pb.reason }
  }
  if (state.running) return { ok: false, reason: '已有宏在运行，请先停止' }

  const useMode: PlayMode = opts.mode ?? macro.playMode
  const loop = isLoopMode(useMode)
  // sequence 按次数跑完自停；once / 循环模式都按「一次迭代」计数（循环模式 total=0 表示不限次）
  const total = useMode === 'sequence' ? Math.max(1, Math.min(9999, macro.playCount || 1)) : loop ? 0 : 1
  const speed = macro.speed || 1
  stopped = false
  warnings = []
  state.running = true
  state.macroId = macro.id
  state.macroName = macro.name
  state.mode = useMode
  state.current = 0
  state.total = total
  state.reason = undefined
  emitProgress()

  try {
    let n = 0
    for (;;) {
      if (stopped) break
      n += 1
      state.current = n
      emitProgress()
      await runSteps(macro.steps, speed)
      if (!loop) {
        if (n >= total) break
      } else if (stopped) {
        break
      }
      // holdRepeat：两次循环之间按重复间隔等待（速度倍率同时生效，PRD 4.5）
      if (loop && useMode === 'holdRepeat') {
        const gap = Math.max(0, (opts.intervalMs ?? macro.repeatInterval) / speed)
        if (gap > 0) await sleep(gap)
      }
    }
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : String(e))
  } finally {
    stopped = true
    state.running = false
    state.current = 0
    state.total = 0
    state.macroId = null
    state.macroName = ''
    state.mode = null
    state.progress = '未运行'
    emit()
  }
  return { ok: true, warnings }
}
