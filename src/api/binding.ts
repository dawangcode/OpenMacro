// 按键映射数据层（src/api/binding.ts）
// 通用模式：绑定列表为数据实体（新增 / 编辑 / 删除），防抖配置挂在每条绑定上。
// Electron 优先；浏览器 dev 模式下降级 localStorage，仅保证 UI 可迭代（触发与捕获不可用）。
import {
  DEBOUNCE_WINDOW_DEFAULT,
  type DebounceRule,
  type KeyBinding,
  type TriggerKind,
} from '@/types/binding'

const LS_KEY = 'openmacro.inputConfig'

export interface InputConfigView {
  bindings: KeyBinding[]
  stopHotkey: string
  complianceDismissed: boolean
}

export interface DetectEventView {
  id: string
  key: string
  eventType: '按下' | '抬起' | '滚轮上滚' | '滚轮下滚'
  ts: number
  repeat: number
}

export interface TriggerActivityView {
  id: string
  ts: number
  trigger: 'tap' | 'hold' | 'hold-stop' | 'debounce-suppressed'
  bindingKey: string
  actionType: string
  detail: string
  suppressed: boolean
}

export interface DetectStateView {
  events: DetectEventView[]
  seen: string[]
  lastMouseActivityAt: number
  paused: boolean
}

export interface CaptureKeyResult {
  ok: boolean
  kind?: TriggerKind
  code?: string
  label?: string
  raw?: string
  reason?: string
}

function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI
}

function lsRead(): InputConfigView {
  const fallback: InputConfigView = { bindings: [], stopHotkey: 'Escape', complianceDismissed: false }
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (!raw) return fallback
    const obj = JSON.parse(raw) as Partial<InputConfigView>
    return {
      bindings: Array.isArray(obj.bindings) ? (obj.bindings as KeyBinding[]) : [],
      stopHotkey: typeof obj.stopHotkey === 'string' && obj.stopHotkey ? obj.stopHotkey : 'Escape',
      complianceDismissed: obj.complianceDismissed === true,
    }
  } catch {
    return fallback
  }
}

function lsWrite(cfg: InputConfigView): void {
  window.localStorage.setItem(LS_KEY, JSON.stringify(cfg))
}

export async function getInputConfig(): Promise<InputConfigView> {
  if (isElectron()) {
    const r = await window.electronAPI!.inputConfigGet()
    return { bindings: await listBindings(), stopHotkey: r.stopHotkey, complianceDismissed: r.complianceDismissed }
  }
  return lsRead()
}

export async function setInputConfig(patch: Partial<InputConfigView>): Promise<InputConfigView> {
  if (isElectron()) {
    await window.electronAPI!.inputConfigSet(patch)
    return getInputConfig()
  }
  const cfg = { ...lsRead(), ...patch }
  lsWrite(cfg)
  return cfg
}

export async function listBindings(): Promise<KeyBinding[]> {
  if (isElectron()) return (await window.electronAPI!.bindingList()) as KeyBinding[]
  return lsRead().bindings
}

/** 保存整份绑定列表；主进程校验绑定键唯一性 */
export async function saveBindings(
  list: KeyBinding[],
): Promise<{ ok: boolean; reason?: string; bindings: KeyBinding[] }> {
  if (isElectron()) {
    const r = await window.electronAPI!.bindingSave(list)
    return { ok: r.ok, reason: r.reason, bindings: (r.bindings ?? []) as KeyBinding[] }
  }
  const cfg = lsRead()
  // 浏览器模式也做一次唯一性校验，保证 UI 行为一致
  const seen = new Set<string>()
  for (const b of list) {
    const key = `${b.trigger.kind}:${b.trigger.code}`
    if (seen.has(key)) return { ok: false, reason: `绑定按键「${b.trigger.label || b.trigger.code}」重复`, bindings: cfg.bindings }
    seen.add(key)
  }
  cfg.bindings = list
  lsWrite(cfg)
  return { ok: true, bindings: list }
}

export async function countBindingsForMacro(macroId: string): Promise<number> {
  if (!isElectron()) {
    return lsRead().bindings.filter((b) => b.tap?.macroId === macroId || b.hold?.macroId === macroId).length
  }
  return window.electronAPI!.bindingCountForMacro(macroId)
}

export async function validateProgramPath(p: string): Promise<{ ok: boolean; reason?: string }> {
  if (!isElectron()) return { ok: true }
  return window.electronAPI!.bindingValidatePath(p)
}

export async function pickExecutable(): Promise<{ ok: boolean; path?: string; canceled?: boolean }> {
  if (!isElectron()) return { ok: false, canceled: true }
  return window.electronAPI!.pickExecutable()
}

/** 启动按键捕获会话；结果经 onCaptureResult 事件推送返回（与录制同模型）
 *  opts.allowReservedMouse：允许捕获左键 / 右键——仅防抖规则使用（鼠标连击过滤），绑定不可用 */
export async function startKeyCapture(opts?: {
  allowReservedMouse?: boolean
}): Promise<{ ok: boolean; reason?: string }> {
  if (!isElectron()) {
    return { ok: false, reason: '浏览器模式不支持按键捕获，请用 pnpm run start 或 dev:app 启动客户端' }
  }
  // 防呆：预加载产物过时（主进程未重建）时明确报错，避免点按钮「没反应」
  if (typeof window.electronAPI!.startKeyCapture !== 'function') {
    return { ok: false, reason: '预加载脚本过时，请重启客户端（先执行 pnpm run build:shell，再重启 dev:app）' }
  }
  return window.electronAPI!.startKeyCapture(opts)
}

/** 订阅捕获结果（主进程 macro:capture:result 推送；超时 / Esc 取消也会推送 ok=false） */
export function onCaptureResult(cb: (r: CaptureKeyResult) => void): () => void {
  if (!isElectron()) return () => undefined
  return window.electronAPI!.onMacroEvent((channel, payload) => {
    if (channel !== 'macro:capture:result') return
    cb(payload as CaptureKeyResult)
  })
}

export async function getDetectState(): Promise<DetectStateView> {
  if (!isElectron()) return { events: [], seen: [], lastMouseActivityAt: 0, paused: false }
  return (await window.electronAPI!.detectState()) as DetectStateView
}

/** 暂停 / 继续采集（钩子继续运行，不影响按键绑定） */
export async function setDetectPaused(paused: boolean): Promise<boolean> {
  if (!isElectron()) return paused
  return window.electronAPI!.detectSetPaused(paused)
}

/** 清空事件列表（主进程缓冲一并清掉，下次进页面不会又冒出来） */
export async function clearDetectEvents(): Promise<void> {
  if (!isElectron()) return
  await window.electronAPI!.detectClear()
}

/** 读取「实际触发检测」事件缓冲（软件在绑定键上真正执行的动作 / 被防抖抑制） */
export async function getTriggerState(): Promise<TriggerActivityView[]> {
  if (!isElectron()) return []
  return (await window.electronAPI!.triggerState()) as TriggerActivityView[]
}

/** 清空「实际触发检测」事件缓冲 */
export async function clearTriggerEvents(): Promise<void> {
  if (!isElectron()) return
  await window.electronAPI!.triggerClear()
}

/** 新建绑定时的默认防抖窗口（与 main 侧常量一致） */
export const DEFAULT_DEBOUNCE_WINDOW = DEBOUNCE_WINDOW_DEFAULT

/** 读取按键防抖规则列表（PRD 4.3 独立实体，按绑定按键配置） */
export async function listDebounceRules(): Promise<DebounceRule[]> {
  if (isElectron()) return (await window.electronAPI!.debounceRuleList()) as DebounceRule[]
  return []
}

/** 保存整份防抖规则列表；主进程校验绑定按键唯一性 */
export async function saveDebounceRules(
  list: DebounceRule[],
): Promise<{ ok: boolean; reason?: string; rules: DebounceRule[] }> {
  if (isElectron()) {
    const r = await window.electronAPI!.debounceRuleSave(list)
    return { ok: r.ok, reason: r.reason, rules: (r.rules ?? []) as DebounceRule[] }
  }
  return { ok: true, rules: list }
}
