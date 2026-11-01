// 按键绑定运行时（src/main/binding-engine.ts，PRD 4.1 / 4.3 / 4.6）
// 通用模式：绑定按「绑定按键」匹配——鼠标按键按按钮名匹配，键盘按键按组合摘要（含修饰键）匹配。
// 流程：全局钩子 → 防抖过滤 → 触发方式判定（短按=抬起时执行 / 长按=按住到阈值执行）→ 执行动作。
// 播放方式语义（PRD 4.5/4.6）：once / sequence 正常播放；toggleLoop 再触发一次停止；holdRepeat 仅长按触发时循环、松开即停。
// 防抖（PRD 4.3）：独立规则按「按键」匹配，可配置任意鼠标键（含左键 / 右键）与键盘键；
// 左键 / 右键无绑定动作，配规则后仅用于连击识别与计数（无法拦截事件到达其它程序）。
import { subscribeInput, type HookEvent } from './hook'
import { isBindingSuspended, onSuspendedChange } from './runtime-state'
import { isCaptureActive } from './capture'
import { getMacro } from './macro-store'
import { emitActionWarning, execMouseFunction, execSystemCommand, launchProgram, tapCombo } from './actions'
import { getPlaybackState, play, stopAll } from './player'
import { comboLabelFrom } from './keymap'
import { getCapture, comboToBlockEntry, mouseComboToBlockEntry } from './input-backend'
import {
  HOLD_THRESHOLD_DEFAULT,
  HOLD_THRESHOLD_MAX,
  HOLD_THRESHOLD_MIN,
  actionSummary,
  triggerLabel,
  type BindingAction,
  type DebounceRule,
  type KeyBinding,
  type TriggerKey,
} from '../types/binding'
import type { InputConfig } from './binding-store'
import type { PlayMode } from '../types/macro'

export interface ActivityInfo {
  kind: 'key' | 'mouse'
  type: 'down' | 'up' | 'wheel'
  raw: string
  /** 键盘组合摘要（如 'Ctrl+Shift+A'，按住修饰键时才有意义）；鼠标事件为空 */
  combo?: string
  repeat: number
  ts: number
  rotation?: number
}

/**
 * 实际触发事件（「实际触发检测」面板用）：软件在绑定键上真正做了什么。
 * 与「物理按键检测」（原始输入回显）区分——这里只记录软件侧行为，
 * 用来验证防抖是否抑制了重复触发、宏/动作是否真的执行。
 */
export interface TriggerActivity {
  id: string
  ts: number
  /** 触发方式：短按 / 长按 / 长按松开即停 / 被防抖抑制 / 被 C 层吞掉 */
  trigger: 'tap' | 'hold' | 'hold-stop' | 'debounce-suppressed' | 'swallowed'
  /** 绑定按键展示名 */
  bindingKey: string
  /** 动作类型：keyboard / mouse / command / launch / macro / disabled */
  actionType: string
  /** 动作详情（如「键=E」「宏：XXX」）；被抑制时为抑制原因 */
  detail: string
  /** 是否被防抖抑制（true 时命中防抖规则、未执行动作） */
  suppressed: boolean
}

const triggerListeners = new Set<(a: TriggerActivity) => void>()

/** 订阅实际触发事件（实时检测「实际触发检测」面板用） */
export function onTriggerActivity(cb: (a: TriggerActivity) => void): () => void {
  triggerListeners.add(cb)
  return () => {
    triggerListeners.delete(cb)
  }
}

function notifyTriggerActivity(a: TriggerActivity): void {
  for (const l of [...triggerListeners]) {
    try {
      l(a)
    } catch {
      // 单个订阅方异常不影响运行时
    }
  }
}

let triggerSeq = 0
function emitTrigger(
  trigger: TriggerKey,
  kind: TriggerActivity['trigger'],
  action: BindingAction | null,
  note: string,
): void {
  const summary = action ? actionSummary(action) : ''
  notifyTriggerActivity({
    id: `t_${Date.now()}_${triggerSeq++}`,
    ts: Date.now(),
    trigger: kind,
    bindingKey: triggerLabel(trigger),
    actionType: action?.type ?? '',
    detail: note ? `${summary}（${note}）` : summary,
    suppressed: kind === 'debounce-suppressed' || kind === 'swallowed',
  })
}

interface HoldRuntime {
  holdFired: boolean
  holdTimer: NodeJS.Timeout | null
  binding: KeyBinding
  /** 纯短按（无长按动作）已在按下时触发，抬起时不再重复触发 */
  tapFiredOnDown: boolean
}

const holdStates = new Map<string, HoldRuntime>()
const lastPressAt = new Map<string, number>()
const repeatCounts = new Map<string, number>()
const pressedKeys = new Set<string>()
const activityListeners = new Set<(a: ActivityInfo) => void>()

let cfg: InputConfig = { bindings: [], debounceRules: [], stopHotkey: 'Escape', complianceDismissed: false }
let attached = false

/** 热加载配置（binding-store 保存后调用，保存即生效） */
export function reloadBindings(next: InputConfig): void {
  cfg = next
  syncBlockedKeys()
  syncDebounce()
}

/**
 * 把配置里的「禁用」绑定同步到 C 层拦截表（配置驱动、无状态）：
 * 任何动作为 disabled 的键盘/鼠标绑定，其按键在 OS 层被吞掉（down/up 都拦）。
 * 删除禁用绑定或改为其它动作后，拦截表同步清空对应条目。
 */
function syncBlockedKeys(): void {
  const cap = getCapture()
  const setBlockedKeys = cap?.setBlockedKeys
  if (!setBlockedKeys) return
  const keycodes: number[] = []
  const masks: number[] = []
  const kinds: number[] = []
  for (const b of cfg.bindings) {
    const hasDisabled = b.tap?.type === 'disabled' || b.hold?.type === 'disabled'
    if (!hasDisabled) continue
    const entry = resolveBlockEntry(b.trigger.kind, b.trigger.code)
    if (!entry) continue
    keycodes.push(entry.keycode)
    masks.push(entry.mask)
    kinds.push(b.trigger.kind === 'mouse' ? 1 : 0)
  }
  setBlockedKeys(keycodes, masks, kinds)
}

/** 按键类型 + 组合键摘要 → C 层拦截条目 */
function resolveBlockEntry(
  kind: 'keyboard' | 'mouse',
  code: string,
): { keycode: number; mask: number } | null {
  return kind === 'mouse' ? mouseComboToBlockEntry(code) : comboToBlockEntry(code)
}

/**
 * 把配置里的启用防抖规则同步到 C 层防抖表（配置驱动、C 层有状态）：
 * 键盘/鼠标防抖规则命中时，窗口内的重复按下在 OS 层被吞掉（不触发动作、不到达目标程序）。
 */
function syncDebounce(): void {
  const cap = getCapture()
  const setDebounce = cap?.setDebounce
  if (!setDebounce) return
  const keycodes: number[] = []
  const masks: number[] = []
  const windows: number[] = []
  const kinds: number[] = []
  for (const r of cfg.debounceRules) {
    if (!r.enabled) continue
    const entry = resolveBlockEntry(r.trigger.kind, r.trigger.code)
    if (!entry) continue
    keycodes.push(entry.keycode)
    masks.push(entry.mask)
    windows.push(r.windowMs)
    kinds.push(r.trigger.kind === 'mouse' ? 1 : 0)
  }
  setDebounce(keycodes, masks, windows, kinds)
}

/** 订阅输入活动（实时检测面板用；含防抖窗口内重复计数） */
export function onActivity(cb: (a: ActivityInfo) => void): () => void {
  activityListeners.add(cb)
  return () => {
    activityListeners.delete(cb)
  }
}

/** 接入全局钩子（app ready 后由 ipc 注册处调用一次） */
export function attachEngine(): void {
  if (attached) return
  attached = true
  // 挂起（录制中 / 捕获中）时清掉半按状态，避免恢复后冒出残留的短按执行
  onSuspendedChange((v) => {
    if (v) clearHoldStates()
  })
  subscribeInput(onHookEvent)
}

function notifyActivity(a: ActivityInfo): void {
  for (const l of [...activityListeners]) {
    try {
      l(a)
    } catch {
      // 单个订阅方异常不影响运行时
    }
  }
}

function clearHoldStates(): void {
  for (const st of holdStates.values()) {
    if (st.holdTimer) clearTimeout(st.holdTimer)
  }
  holdStates.clear()
}

/** 按绑定按键找到对应防抖规则；找不到返回 null（PRD 4.3 独立实体） */
function findDebounce(trigger: TriggerKey): DebounceRule | null {
  return cfg.debounceRules.find((d) => d.trigger.kind === trigger.kind && d.trigger.code === trigger.code) ?? null
}

/**
 * 重复计数用的窗口（PRD 4.2 / 4.3）：
 * - 该按键有启用中的防抖规则 → 用其窗口（左键 / 右键也只有配了规则才计数）；
 * - 无规则但按键有绑定 → 按默认窗口 200ms 计算（沿用「侧键双击」提示）；
 * - 无规则且无绑定（典型：左键 / 右键未配规则）→ 0，不计数，避免正常点击被误报为连击。
 */
function repeatWindow(trigger: TriggerKey, binding: KeyBinding | null): number {
  const d = findDebounce(trigger)
  if (d?.enabled) return d.windowMs
  return binding ? 200 : 0
}

/** 事件对应的按键标识（不含展示名）：鼠标按按钮名，键盘按组合摘要 */
function eventTrigger(e: HookEvent): TriggerKey {
  if (e.kind === 'mouse') return { kind: 'mouse', code: e.raw, label: '' }
  const label = comboLabelFrom(pressedKeys, e.raw)
  return { kind: 'keyboard', code: label, label }
}

/** 按按键标识找到对应绑定；找不到返回 null */
function findBindingByTrigger(t: TriggerKey): KeyBinding | null {
  return cfg.bindings.find((b) => b.trigger.kind === t.kind && b.trigger.code === t.code) ?? null
}

function onHookEvent(e: HookEvent): void {
  // 鼠标移动不参与活动通知与绑定判定（检测面板另走心跳）
  if (e.type === 'move') return
  const now = Date.now()
  if (e.kind === 'key') {
    if (e.type === 'down') pressedKeys.add(e.raw)
    else if (e.type === 'up') pressedKeys.delete(e.raw)
  }
  // 按下时 raw 已在集合内（会被 comboLabelFrom 排除），抬起时已移出（保留仍按住的修饰键）
  const combo = e.kind === 'key' ? comboLabelFrom(pressedKeys, e.raw) : undefined
  if (e.type === 'down') {
    const trigger = eventTrigger(e)
    const binding = findBindingByTrigger(trigger)

    // C 层已吞掉（禁用拦截 / 防抖抑制）：只记录，不计算重复、不执行动作
    // （JS 侧防抖计数只对未被吞掉的事件进行，保证与 C 层窗口一致）
    if (e.reserved === 1) {
      notifyActivity({ kind: e.kind, type: 'down', raw: e.raw, combo, repeat: 0, ts: now })
      emitTrigger(trigger, 'swallowed', binding?.tap ?? binding?.hold ?? null, 'C 层已吞掉（禁用拦截 / 防抖抑制）')
      return
    }

    // 重复计数按「按键」统计（不再依赖绑定 id）：左键 / 右键配了防抖规则时同样计入
    const repeat = computeRepeat(trigger, binding, now)
    notifyActivity({ kind: e.kind, type: 'down', raw: e.raw, combo, repeat, ts: now })
    handleDown(e, trigger, binding, now, repeat)
    return
  }
  notifyActivity({ kind: e.kind, type: e.type, raw: e.raw, combo, repeat: 0, ts: now, rotation: e.rotation })
  if (e.type === 'up') handleUp(e)
}

function computeRepeat(trigger: TriggerKey, binding: KeyBinding | null, now: number): number {
  const windowMs = repeatWindow(trigger, binding)
  if (windowMs <= 0) return 0
  const key = `${trigger.kind}:${trigger.code}`
  const last = lastPressAt.get(key) ?? 0
  const prev = repeatCounts.get(key) ?? 0
  const r = last > 0 && now - last < windowMs ? prev + 1 : 0
  lastPressAt.set(key, now)
  repeatCounts.set(key, r)
  return r
}

function handleDown(
  e: HookEvent,
  trigger: TriggerKey,
  binding: KeyBinding | null,
  now: number,
  repeat: number,
): void {
  // 全局停止热键：优先级最高，不受防抖窗口影响；捕获会话中让位给按键捕获
  if (!isCaptureActive() && e.kind === 'key' && cfg.stopHotkey && e.raw === cfg.stopHotkey) {
    stopAll()
    return
  }
  if (isBindingSuspended()) return

  // 防抖（PRD 4.3）：该按键启用防抖时，窗口内的重复按下被忽略。
  // 放在「无绑定即返回」之前——左键 / 右键可能只配了防抖规则、没有绑定动作，
  // 这类纯连击过滤场景也必须能抑制，否则防抖规则形同虚设。
  const deb = findDebounce(trigger)
  if (deb?.enabled) {
    // 诊断：仅在该键存在启用中的防抖规则时打印（实测确认「规则是否命中 / 窗口 / 是否抑制」用，稳定后可删）
    console.log(
      `[OpenMacro][防抖] key=${trigger.kind}:${trigger.code} windowMs=${deb.windowMs} repeat=${repeat} -> ${repeat > 0 ? '抑制' : '放行(首次/窗口外)'}`,
    )
    if (repeat > 0) {
      emitTrigger(
        trigger,
        'debounce-suppressed',
        binding?.tap ?? binding?.hold ?? null,
        `窗口内重复，已启用防抖（${deb.windowMs}ms），本次不触发`,
      )
      return
    }
    // 有规则但为首次按下：仅放行打点；若无绑定动作则下方直接返回（不触发任何动作）
  }

  if (!binding) return
  // 该绑定键已处于按下态（系统按键自动重复等）：不重置长按计时器、也不重复触发
  if (holdStates.has(binding.id)) return

  // 纯短按（未配置长按动作）：按下即触发，零延迟。
  // 因为不存在「变成长按」的歧义，无需等到抬起；并用 tapFiredOnDown 在抬起时防止重复触发。
  if (binding.tap && !binding.hold) {
    holdStates.set(binding.id, { holdFired: false, holdTimer: null, binding, tapFiredOnDown: true })
    emitTrigger(trigger, 'tap', binding.tap, '')
    void execAction(binding.tap, 'tap')
    return
  }

  if (binding.hold) {
    const st: HoldRuntime = { holdFired: false, holdTimer: null, binding, tapFiredOnDown: false }
    holdStates.set(binding.id, st)
    st.holdTimer = setTimeout(
      () => {
        st.holdFired = true
        emitTrigger(trigger, 'hold', binding.hold!, '')
        void execAction(binding.hold!, 'hold')
      },
      Math.max(HOLD_THRESHOLD_MIN, Math.min(HOLD_THRESHOLD_MAX, binding.holdThresholdMs || HOLD_THRESHOLD_DEFAULT)),
    )
  }
}

function handleUp(e: HookEvent): void {
  if (isBindingSuspended()) return
  const trigger = eventTrigger(e)
  const binding = findBindingByTrigger(trigger)
  if (!binding) return
  const st = holdStates.get(binding.id)
  if (st) {
    if (st.holdTimer) clearTimeout(st.holdTimer)
    const wasHoldFired = st.holdFired
    const wasTapFiredOnDown = st.tapFiredOnDown
    holdStates.delete(binding.id)
    if (wasHoldFired) {
      // 按住重复：松开即停（PRD 4.5）
      if (st.binding.hold?.type === 'macro') {
        const pb = getPlaybackState()
        if (pb.running && pb.macroId === st.binding.hold.macroId) stopAll()
      }
      emitTrigger(trigger, 'hold-stop', st.binding.hold ?? null, '长按松开即停')
      return
    }
    // 纯短按已在按下时触发，抬起不再重复触发
    if (wasTapFiredOnDown) return
  }
  // 未到长按阈值（且非纯短按已在按下触发）→ 按短按处理
  if (binding.tap) {
    emitTrigger(trigger, 'tap', binding.tap, '')
    void execAction(binding.tap, 'tap')
  }
}

async function execAction(action: BindingAction, trigger: 'tap' | 'hold'): Promise<void> {
  if (!action) return
  switch (action.type) {
    case 'keyboard': {
      const w = await tapCombo(action.key ?? '')
      w.forEach(emitActionWarning)
      return
    }
    case 'mouse': {
      const w = await execMouseFunction(action.mouseFn ?? 'middle')
      w.forEach(emitActionWarning)
      return
    }
    case 'command': {
      const w = await execSystemCommand(action.command ?? 'volumeUp')
      w.forEach(emitActionWarning)
      return
    }
    case 'launch': {
      const r = launchProgram(action.path ?? '')
      if (!r.ok) emitActionWarning(r.reason ?? '启动程序失败')
      return
    }
    case 'macro': {
      const macro = getMacro(action.macroId ?? '')
      if (!macro) {
        emitActionWarning('绑定的宏不存在或已删除，请在按键映射中重新选择')
        return
      }
      const mode: PlayMode = macro.playMode
      if (mode === 'toggleLoop') {
        // 切换循环：运行中再触发一次 → 停止（PRD 4.5/4.6）
        const pb = getPlaybackState()
        if (pb.running && pb.macroId === macro.id) {
          stopAll()
          return
        }
        const r = await play(macro, { mode: 'toggleLoop' })
        r.warnings?.forEach(emitActionWarning)
        return
      }
      if (mode === 'holdRepeat') {
        // 仅长按触发才循环；短按触发退化为单次执行
        const r = await play(macro, {
          mode: trigger === 'hold' ? 'holdRepeat' : 'once',
          intervalMs: macro.repeatInterval,
        })
        r.warnings?.forEach(emitActionWarning)
        return
      }
      const r = await play(macro, { mode })
      r.warnings?.forEach(emitActionWarning)
      return
    }
    case 'disabled':
      // 禁用：本软件不产生任何动作；OS 层拦截由 C 层拦截表完成（见 syncBlockedKeys）。
      return
    default:
      return
  }
}
