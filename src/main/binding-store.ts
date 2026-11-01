// 按键绑定持久化（SQLite，PRD 4.1 / 4.3 / 4.6）
// 通用模式：绑定列表为数据实体（可新增 / 编辑 / 删除）；防抖为独立规则实体（DebounceRule），
// 按绑定按键逐条配置，可单独新增 / 编辑 / 删除。保存后立即通知绑定运行时热加载（保存即生效）。
import { getDb, getSetting, setSetting, transaction } from './db'
import { reloadBindings } from './binding-engine'
import {
  DEBOUNCE_WINDOW_DEFAULT,
  DEBOUNCE_WINDOW_MAX,
  DEBOUNCE_WINDOW_MIN,
  HOLD_THRESHOLD_DEFAULT,
  HOLD_THRESHOLD_MAX,
  HOLD_THRESHOLD_MIN,
  RESERVED_TRIGGERS,
  type ActionType,
  type BindingAction,
  type DebounceRule,
  type KeyBinding,
  type TriggerKey,
  newBindingId,
  newDebounceRuleId,
} from '../types/binding'

export interface InputConfig {
  bindings: KeyBinding[]
  /** 按键防抖规则（PRD 4.3）：按绑定按键逐条配置，独立于绑定 */
  debounceRules: DebounceRule[]
  /** 全局停止热键（uiohook 原始键名），默认 Esc */
  stopHotkey: string
  /** 合规提示「不再提示」已勾选（PRD 4.7） */
  complianceDismissed: boolean
}

export interface SaveResult {
  ok: boolean
  reason?: string
}

interface BindingRow {
  id: string
  trigger_kind: string
  trigger_code: string
  trigger_label: string
  tap: string | null
  hold: string | null
  hold_threshold_ms: number
}

interface DebounceRow {
  id: string
  trigger_kind: string
  trigger_code: string
  trigger_label: string
  enabled: number
  window_ms: number
}

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

export function defaultInputConfig(): InputConfig {
  return { bindings: [], debounceRules: [], stopHotkey: 'Escape', complianceDismissed: false }
}

function parseAction(raw: string | null): BindingAction | undefined {
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as BindingAction
  } catch {
    return undefined
  }
}

function rowToBinding(row: BindingRow): KeyBinding {
  return {
    id: row.id,
    trigger: {
      kind: row.trigger_kind === 'mouse' ? 'mouse' : 'keyboard',
      code: row.trigger_code,
      label: row.trigger_label || row.trigger_code,
    },
    tap: parseAction(row.tap),
    hold: parseAction(row.hold),
    holdThresholdMs: Number(row.hold_threshold_ms),
  }
}

function rowToRule(row: DebounceRow): DebounceRule {
  return {
    id: row.id,
    trigger: {
      kind: row.trigger_kind === 'mouse' ? 'mouse' : 'keyboard',
      code: row.trigger_code,
      label: row.trigger_label || row.trigger_code,
    },
    enabled: Number(row.enabled) === 1,
    windowMs: Number(row.window_ms),
  }
}

function sanitizeAction(a: unknown): BindingAction | undefined {
  if (!a || typeof a !== 'object') return undefined
  const action = a as Partial<BindingAction>
  const type = action.type as ActionType | undefined
  if (!type) return undefined
  return {
    type,
    key: typeof action.key === 'string' ? action.key : undefined,
    mouseFn: action.mouseFn,
    command: action.command,
    path: typeof action.path === 'string' ? action.path : undefined,
    macroId: typeof action.macroId === 'string' ? action.macroId : undefined,
  }
}

/** 净化一条防抖规则（PRD 4.3）；绑定按键无效则返回 null 丢弃。
 *  与绑定不同，这里允许左键 / 右键（鼠标连击过滤的主要场景）。 */
function sanitizeDebounceRule(d: unknown): DebounceRule | null {
  const obj = (d ?? {}) as Partial<DebounceRule>
  if (!obj.trigger || typeof obj.trigger.code !== 'string' || !obj.trigger.code) return null
  return {
    id: typeof obj.id === 'string' && obj.id ? obj.id : newDebounceRuleId(),
    trigger: {
      kind: obj.trigger.kind === 'mouse' ? 'mouse' : 'keyboard',
      code: obj.trigger.code,
      label: typeof obj.trigger.label === 'string' ? obj.trigger.label : obj.trigger.code,
    },
    enabled: obj.enabled === true,
    windowMs: clamp(obj.windowMs, DEBOUNCE_WINDOW_MIN, DEBOUNCE_WINDOW_MAX, DEBOUNCE_WINDOW_DEFAULT),
  }
}

/** 轻量净化：结构损坏 / 系统保留绑定键的记录丢弃，避免一个坏数据让整页报错 */
function sanitize(raw: unknown): InputConfig {
  const base = defaultInputConfig()
  if (!raw || typeof raw !== 'object') return base
  const obj = raw as Partial<InputConfig>
  const bindings: KeyBinding[] = []
  const migrationRules: DebounceRule[] = []
  if (Array.isArray(obj.bindings)) {
    for (const item of obj.bindings) {
      const b = item as Partial<KeyBinding>
      if (!b || typeof b.id !== 'string' || !b.trigger || typeof b.trigger.code !== 'string') continue
      if (!b.trigger.code) continue
      // 左键 / 右键系统保留，不可作为绑定键
      if (b.trigger.kind === 'mouse' && RESERVED_TRIGGERS.includes(b.trigger.code)) continue
      const trigger: TriggerKey = {
        kind: b.trigger.kind === 'mouse' ? 'mouse' : 'keyboard',
        code: b.trigger.code,
        label: typeof b.trigger.label === 'string' ? b.trigger.label : b.trigger.code,
      }
      bindings.push({
        id: b.id || newBindingId(),
        trigger,
        tap: sanitizeAction(b.tap),
        hold: sanitizeAction(b.hold),
        holdThresholdMs: clamp(
          b.holdThresholdMs,
          HOLD_THRESHOLD_MIN,
          HOLD_THRESHOLD_MAX,
          HOLD_THRESHOLD_DEFAULT,
        ),
      })
      // 旧数据迁移：防抖曾挂在绑定上（b.debounce），升级时转为独立防抖规则，避免配置丢失
      const legacy = (b as { debounce?: { enabled?: boolean; windowMs?: number } }).debounce
      if (legacy?.enabled) {
        migrationRules.push({
          id: newDebounceRuleId(),
          trigger,
          enabled: true,
          windowMs: clamp(legacy.windowMs, DEBOUNCE_WINDOW_MIN, DEBOUNCE_WINDOW_MAX, DEBOUNCE_WINDOW_DEFAULT),
        })
      }
    }
  }
  // 现有防抖规则（PRD 4.3 独立实体）
  const rules: DebounceRule[] = []
  if (Array.isArray(obj.debounceRules)) {
    for (const item of obj.debounceRules) {
      const r = sanitizeDebounceRule(item)
      if (r) rules.push(r)
    }
  }
  // 合并迁移规则：若同一按键已存在独立规则则跳过迁移，避免重复
  const seen = new Set(rules.map((r) => `${r.trigger.kind}:${r.trigger.code}`))
  for (const m of migrationRules) {
    const key = `${m.trigger.kind}:${m.trigger.code}`
    if (!seen.has(key)) {
      seen.add(key)
      rules.push(m)
    }
  }
  return {
    bindings,
    debounceRules: rules,
    stopHotkey: typeof obj.stopHotkey === 'string' && obj.stopHotkey ? obj.stopHotkey : base.stopHotkey,
    complianceDismissed: obj.complianceDismissed === true,
  }
}

function replaceBindings(list: KeyBinding[]): void {
  const db = getDb()
  db.prepare('DELETE FROM bindings').run()
  const stmt = db.prepare(
    `INSERT INTO bindings (id, trigger_kind, trigger_code, trigger_label, tap, hold, hold_threshold_ms, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  list.forEach((b, index) => {
    stmt.run(
      b.id,
      b.trigger.kind,
      b.trigger.code,
      b.trigger.label,
      b.tap ? JSON.stringify(b.tap) : null,
      b.hold ? JSON.stringify(b.hold) : null,
      b.holdThresholdMs,
      index,
    )
  })
}

function replaceDebounceRules(list: DebounceRule[]): void {
  const db = getDb()
  db.prepare('DELETE FROM debounce_rules').run()
  const stmt = db.prepare(
    `INSERT INTO debounce_rules (id, trigger_kind, trigger_code, trigger_label, enabled, window_ms, position)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  list.forEach((r, index) => {
    stmt.run(r.id, r.trigger.kind, r.trigger.code, r.trigger.label, r.enabled ? 1 : 0, r.windowMs, index)
  })
}

export function getInputConfig(): InputConfig {
  const db = getDb()
  const bindings = (
    db.prepare('SELECT * FROM bindings ORDER BY position').all() as unknown as BindingRow[]
  ).map(rowToBinding)
  const rules = (
    db.prepare('SELECT * FROM debounce_rules ORDER BY position').all() as unknown as DebounceRow[]
  ).map(rowToRule)
  return sanitize({
    bindings,
    debounceRules: rules,
    stopHotkey: getSetting('stopHotkey') ?? undefined,
    complianceDismissed: getSetting('complianceDismissed') === '1',
  })
}

export function saveInputConfig(patch: Partial<InputConfig>): InputConfig {
  const current = getInputConfig()
  const next = sanitize({
    bindings: patch.bindings !== undefined ? patch.bindings : current.bindings,
    debounceRules: patch.debounceRules !== undefined ? patch.debounceRules : current.debounceRules,
    stopHotkey: patch.stopHotkey !== undefined ? patch.stopHotkey : current.stopHotkey,
    complianceDismissed:
      patch.complianceDismissed !== undefined ? patch.complianceDismissed : current.complianceDismissed,
  })
  transaction(() => {
    if (patch.bindings !== undefined) replaceBindings(next.bindings)
    if (patch.debounceRules !== undefined) replaceDebounceRules(next.debounceRules)
    if (patch.stopHotkey !== undefined) setSetting('stopHotkey', next.stopHotkey)
    if (patch.complianceDismissed !== undefined) {
      setSetting('complianceDismissed', next.complianceDismissed ? '1' : '0')
    }
  })
  // 保存即生效：通知绑定运行时热加载
  reloadBindings(next)
  return next
}

/** 保存绑定列表：校验绑定键唯一性 */
export function saveBindings(list: KeyBinding[]): { ok: boolean; reason?: string; bindings: KeyBinding[] } {
  const next: KeyBinding[] = (Array.isArray(list) ? list : []).map((b) => ({
    ...b,
    holdThresholdMs: clamp(b.holdThresholdMs, HOLD_THRESHOLD_MIN, HOLD_THRESHOLD_MAX, HOLD_THRESHOLD_DEFAULT),
  }))
  // 绑定键去重：同一绑定键只允许一条绑定
  const seen = new Set<string>()
  for (const b of next) {
    const key = `${b.trigger.kind}:${b.trigger.code}`
    if (seen.has(key)) return { ok: false, reason: `绑定按键「${b.trigger.label || b.trigger.code}」重复`, bindings: getInputConfig().bindings }
    seen.add(key)
  }
  const saved = saveInputConfig({ bindings: next })
  return { ok: true, bindings: saved.bindings }
}

/** 保存防抖规则列表：校验绑定按键唯一性，钳制窗口，保存即生效（PRD 4.3） */
export function saveDebounceRules(
  list: DebounceRule[],
): { ok: boolean; reason?: string; rules: DebounceRule[] } {
  const next: DebounceRule[] = (Array.isArray(list) ? list : []).map((r) => ({
    ...r,
    windowMs: clamp(r.windowMs, DEBOUNCE_WINDOW_MIN, DEBOUNCE_WINDOW_MAX, DEBOUNCE_WINDOW_DEFAULT),
  }))
  // 绑定按键去重：同一绑定按键只允许一条防抖规则
  const seen = new Set<string>()
  for (const r of next) {
    const key = `${r.trigger.kind}:${r.trigger.code}`
    if (seen.has(key)) return { ok: false, reason: `防抖规则绑定按键「${r.trigger.label || r.trigger.code}」重复`, rules: getInputConfig().debounceRules }
    seen.add(key)
  }
  const saved = saveInputConfig({ debounceRules: next })
  return { ok: true, rules: saved.debounceRules }
}

/** 该宏被几条绑定引用（列表删除确认提示用，PRD 4.4 异常） */
export function bindingCountForMacro(macroId: string): number {
  return getInputConfig().bindings.filter(
    (b) => b.tap?.macroId === macroId || b.hold?.macroId === macroId,
  ).length
}

/** 删除宏时解除引用该宏的动作（动作置空，绑定保留），返回解除数 */
export function removeBindingsForMacro(macroId: string): number {
  const cfg = getInputConfig()
  let removed = 0
  const next = cfg.bindings.map((b) => {
    let changed = false
    const tap = b.tap?.macroId === macroId ? undefined : b.tap
    const hold = b.hold?.macroId === macroId ? undefined : b.hold
    if ((b.tap && !tap) || (b.hold && !hold)) {
      changed = true
      removed += 1
    }
    return changed ? { ...b, tap, hold } : b
  })
  if (removed > 0) saveInputConfig({ bindings: next })
  return removed
}
