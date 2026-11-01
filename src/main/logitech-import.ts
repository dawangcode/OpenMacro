// 导入罗技 G HUB 宏（src/main/logitech-import.ts）
// G HUB 的宏与配置都保存在本地 SQLite：%LOCALAPPDATA%\LGHUB\settings.db
// 没有官方导出接口；这里直接读库、解析宏 JSON 并转成 OpenMacro 的 MacroStep[]。
// 罗技各版本字段名有差异（keyName / keycode / function + wait），故用「宽容递归」解析，
// 不认识的字段计入 warnings，由用户导入后在编辑页核对（迁移/真机核对见 README）。
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { newStepId } from '../types/macro'
import type { MacroStep, MouseButton } from '../types/macro'

export interface LogitechMacro {
  name: string
  steps: MacroStep[]
  warnings: string[]
}

export interface LogitechTableInfo {
  table: string
  rows: number
  columns: string[]
}

export interface LogitechListResult {
  ok: boolean
  macros: LogitechMacro[]
  reason?: string
  /** 实际扫描到的库结构（UI 展示，便于排查字段差异） */
  schema: LogitechTableInfo[]
  /** 解析过的 JSON 单元格数 */
  scanned: number
  /** 实际读取的数据库路径（便于确认读的是哪个文件） */
  path: string
}

/** 默认 G HUB 数据库路径（按平台）；被占用时改由文件选择弹窗指定 */
export function defaultLogitechDb(): string {
  if (process.platform === 'win32') {
    return path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      'LGHUB',
      'settings.db',
    )
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Logitech', 'Logitech G HUB', 'settings.db')
  }
  return path.join(os.homedir(), '.config', 'logitech', 'settings.db')
}

const MOUSE_MAP: Record<string, MouseButton> = {
  MOUSE_BUTTON_1: 'left',
  MOUSE_BUTTON_LEFT: 'left',
  LEFT: 'left',
  MOUSE_BUTTON_2: 'right',
  MOUSE_BUTTON_RIGHT: 'right',
  RIGHT: 'right',
  MOUSE_BUTTON_3: 'middle',
  MOUSE_BUTTON_MIDDLE: 'middle',
  MIDDLE: 'middle',
  MOUSE_BUTTON_4: 'x1',
  MOUSE_BUTTON_X1: 'x1',
  XBUTTON1: 'x1',
  MOUSE_BUTTON_5: 'x2',
  MOUSE_BUTTON_X2: 'x2',
  XBUTTON2: 'x2',
}

// KEY_* 命名里，去掉前缀后直接可用的键，以及需改写的中文/修饰键名
const KEY_REWRITE: Record<string, string> = {
  LEFT_CTRL: 'Ctrl',
  RIGHT_CTRL: 'Ctrl',
  CTRL: 'Ctrl',
  LEFT_SHIFT: 'Shift',
  RIGHT_SHIFT: 'Shift',
  SHIFT: 'Shift',
  LEFT_ALT: 'Alt',
  RIGHT_ALT: 'Alt',
  ALT: 'Alt',
  LEFT_GUI: 'Win',
  RIGHT_GUI: 'Win',
  GUI: 'Win',
  SPACE: 'Space',
  ENTER: 'Enter',
  RETURN: 'Enter',
  ESC: 'Escape',
  ESCAPE: 'Escape',
  TAB: 'Tab',
  BACKSPACE: 'Backspace',
  DELETE: 'Delete',
  CAPS_LOCK: 'CapsLock',
  NUM_LOCK: 'NumLock',
  UP: 'Up',
  DOWN: 'Down',
  LEFT: 'Left',
  RIGHT: 'Right',
  PAGE_UP: 'PageUp',
  PAGE_DOWN: 'PageDown',
}

function mapKeyName(raw: string): { key: string; warn?: string } {
  const u = raw.trim().toUpperCase()
  if (u.startsWith('KEY_')) {
    const n = u.slice(4)
    if (KEY_REWRITE[n]) return { key: KEY_REWRITE[n] }
    return { key: n } // 字母 / 数字 / F1~F12 等原样
  }
  // 无 KEY_ 前缀（个别版本用 LEFT / CONTROL 等）：先查鼠标，再查改写表
  if (MOUSE_MAP[u]) {
    return { key: raw, warn: 'mouse-as-key' } // 不会走到这（鼠标已先判），仅兜底
  }
  if (KEY_REWRITE[u]) return { key: KEY_REWRITE[u] }
  return { key: raw }
}

function emptyStep(partial: Omit<MacroStep, 'id' | 'label' | 'delay'> & { delay?: number }): MacroStep {
  return { id: newStepId(), label: '', delay: partial.delay ?? 0, ...partial } as MacroStep
}

/** 把单个罗技动作对象转成 OpenMacro 步骤；无法识别返回 null 并提示 */
function parseAction(a: unknown, warnings: string[]): MacroStep | null {
  if (!a || typeof a !== 'object') return null
  const obj = a as Record<string, unknown>
  const hasKey = 'keyName' in obj || 'keycode' in obj || 'key' in obj
  const fn = String(obj.function ?? '').toLowerCase()
  const isDelay =
    obj.type === 'delay' ||
    obj.type === 'wait' ||
    obj.type === 'gwait' ||
    fn === 'wait' ||
    (typeof obj.duration === 'number' && !hasKey)

  if (isDelay) {
    const dur = Number(obj.duration)
    if (!Number.isFinite(dur)) {
      warnings.push('识别到延迟步骤但时长非法，已忽略')
      return null
    }
    return emptyStep({ kind: 'delay', delay: Math.max(0, Math.round(dur)) })
  }

  if (!hasKey) return null

  const keyName = String(obj.keyName ?? obj.keycode ?? obj.key ?? '').trim()
  const u = keyName.toUpperCase()
  const isMouse = u.startsWith('MOUSE') || u.startsWith('XBUTTON') || !!MOUSE_MAP[u]

  const action = obj.up === true || fn.includes('release') ? 'up' : 'down'
  if (isMouse) {
    const btn = MOUSE_MAP[u]
    if (!btn) {
      warnings.push(`未知鼠标按键：${keyName}`)
      return null
    }
    return emptyStep({ kind: 'mouse', key: btn, action })
  }
  const { key, warn } = mapKeyName(keyName)
  if (warn === 'mouse-as-key') warnings.push(`键名「${keyName}」疑似鼠标按键，已按键盘处理`)
  if (!key) {
    warnings.push(`键名「${keyName}」无法映射，已忽略`)
    return null
  }
  return emptyStep({ kind: 'keyboard', key, action })
}

function isMacroObj(o: unknown): o is { name: string; actions?: unknown[]; steps?: unknown[] } {
  if (!o || typeof o !== 'object') return false
  const obj = o as Record<string, unknown>
  return typeof obj.name === 'string' && (Array.isArray(obj.actions) || Array.isArray(obj.steps))
}

// ---- 罗技 cards/sequence 结构（G HUB 实测）----
// card: { name:'双头玛', macro:{ type:'SEQUENCE', sequence:{ toggleSequence:{ components:[...] } } } }
// component: { keyboard:{ displayName, hidUsage, isDown? } }
//          | { mouse:{ button:{ hidUsage:'1', isDown? } } }
//          | { delay:{ durationMs:50 } }
const MOUSE_HID: Record<string, MouseButton> = {
  '1': 'left',
  '2': 'right',
  '3': 'middle',
  '4': 'x1',
  '5': 'x2',
}

/** 罗技 displayName / hidUsage → OpenMacro 键名（'Ctrl' / 'A' / 'Space' ...） */
function normalizeDisplayKey(name: string, hidUsage: string | undefined, warnings: string[]): string {
  const raw = (name ?? '').trim()
  const lower = raw.toLowerCase()
  if (lower.includes('ctrl') || lower.includes('control')) return 'Ctrl'
  if (lower.includes('shift')) return 'Shift'
  if (lower.includes('alt')) return 'Alt'
  if (lower.includes('gui') || lower.includes('win') || lower.includes('cmd') || lower.includes('super')) return 'Win'
  if (lower === 'esc' || lower === 'escape') return 'Escape'
  if (lower === 'return' || lower === 'enter') return 'Enter'
  if (lower === 'space' || lower === 'spacebar' || lower === ' ') return 'Space'
  if (lower === 'backspace') return 'Backspace'
  if (lower === 'delete' || lower === 'del') return 'Delete'
  if (lower === 'tab') return 'Tab'
  if (raw) return raw.length === 1 ? raw.toUpperCase() : raw
  // displayName 缺失时用 HID usage 兜底（常用键）
  if (hidUsage) {
    const code = Number(hidUsage)
    if (code >= 4 && code <= 29) return String.fromCharCode(65 + (code - 4))
    if (code >= 30 && code <= 39) return String((code - 30 + 1) % 10)
    if (code === 40) return 'Enter'
    if (code === 41) return 'Escape'
    if (code === 43) return 'Tab'
    if (code === 44) return 'Space'
    warnings.push(`键位 hidUsage=${hidUsage} 无法映射，已忽略`)
    return ''
  }
  warnings.push('键盘组件缺少键名，已忽略')
  return ''
}

function parseComponent(comp: unknown, warnings: string[]): MacroStep | null {
  if (!comp || typeof comp !== 'object') return null
  const c = comp as Record<string, any>
  if (c.delay && typeof c.delay.durationMs === 'number') {
    return emptyStep({ kind: 'delay', delay: Math.max(0, Math.round(c.delay.durationMs)) })
  }
  if (c.mouse && c.mouse.button) {
    const hid = String(c.mouse.button.hidUsage ?? '')
    const btn = MOUSE_HID[hid]
    if (!btn) {
      warnings.push(`未知鼠标按键 hidUsage=${hid}`)
      return null
    }
    const action = c.mouse.button.isDown === true ? 'down' : 'up'
    return emptyStep({ kind: 'mouse', key: btn, action })
  }
  if (c.keyboard) {
    const key = normalizeDisplayKey(
      String(c.keyboard.displayName ?? ''),
      c.keyboard.hidUsage != null ? String(c.keyboard.hidUsage) : undefined,
      warnings,
    )
    if (!key) return null
    const action = c.keyboard.isDown === true ? 'down' : 'up'
    return emptyStep({ kind: 'keyboard', key, action })
  }
  return null
}

const SEQUENCE_KEYS = ['toggleSequence', 'simpleSequence', 'pressSequence', 'releaseSequence', 'heldSequence'] as const

function parseSequence(seq: unknown, warnings: string[]): MacroStep[] {
  if (!seq || typeof seq !== 'object') return []
  const s = seq as Record<string, any>
  for (const k of SEQUENCE_KEYS) {
    const comps = s[k]?.components
    if (Array.isArray(comps) && comps.length) {
      const steps: MacroStep[] = []
      for (const c of comps) {
        const st = parseComponent(c, warnings)
        if (st) steps.push(st)
      }
      return steps
    }
  }
  return []
}

function isCardObj(o: unknown): o is { name: string; macro: Record<string, unknown> } {
  if (!o || typeof o !== 'object') return false
  const obj = o as Record<string, unknown>
  return typeof obj.name === 'string' && !!obj.macro && typeof obj.macro === 'object'
}

function parseCard(o: unknown): LogitechMacro | null {
  if (!isCardObj(o)) return null
  const warnings: string[] = []
  const steps = parseSequence(o.macro.sequence, warnings)
  if (steps.length === 0) return null
  return { name: o.name, steps, warnings }
}

function parseMacroObject(o: unknown): LogitechMacro | null {
  if (!isMacroObj(o)) return null
  const obj = o as Record<string, unknown>
  const rawActions = (obj.actions ?? obj.steps ?? []) as unknown[]
  const warnings: string[] = []
  const steps: MacroStep[] = []
  for (const a of rawActions) {
    const step = parseAction(a, warnings)
    if (step) steps.push(step)
  }
  if (steps.length === 0) return null
  return { name: String(obj.name || '未命名罗技宏'), steps, warnings }
}

/** 候选节点：新版 cards 卡片，或旧版 name+actions 结构 */
function isCandidate(o: unknown): boolean {
  return isCardObj(o) || isMacroObj(o)
}

function parseCandidate(o: unknown): LogitechMacro | null {
  return parseCard(o) ?? parseMacroObject(o)
}

function collectMacros(node: unknown, out: unknown[], seen: Set<string>): void {
  if (Array.isArray(node)) {
    // 若整段数组都是候选节点，直接作为宏列表；否则继续递归每个元素
    if (node.length && node.every(isCandidate)) {
      node.forEach((m) => {
        const sig = JSON.stringify(m)
        if (!seen.has(sig)) {
          seen.add(sig)
          out.push(m)
        }
      })
      return
    }
    node.forEach((c) => collectMacros(c, out, seen))
    return
  }
  if (node && typeof node === 'object') {
    if (isCandidate(node)) {
      const sig = JSON.stringify(node)
      if (!seen.has(sig)) {
        seen.add(sig)
        out.push(node)
      }
    }
    for (const k of Object.keys(node as Record<string, unknown>)) {
      collectMacros((node as Record<string, unknown>)[k], out, seen)
    }
  }
}

/** 打开库（优先原路径只读；被 G HUB 占用则连 -wal/-shm 一起复制到临时目录再读） */
function openReadonly(dbPath: string): { db: DatabaseSync; cleanup?: string } {
  try {
    const db = new DatabaseSync(dbPath, { readonly: true, fileMustExist: true })
    return { db }
  } catch {
    const tmp = path.join(os.tmpdir(), `openmacro-lghub-${Date.now()}.db`)
    fs.copyFileSync(dbPath, tmp)
    // WAL 模式下最新数据可能还在 -wal 里，必须一并复制，否则会读到旧快照
    for (const suffix of ['-wal', '-shm']) {
      const side = `${dbPath}${suffix}`
      if (fs.existsSync(side)) {
        try {
          fs.copyFileSync(side, `${tmp}${suffix}`)
        } catch {
          // 辅助文件复制失败不影响主库读取
        }
      }
    }
    const db = new DatabaseSync(tmp, { readonly: true, fileMustExist: true })
    return { db, cleanup: tmp }
  }
}

/** 单表最多扫描行数，避免异常大库卡死 */
const MAX_ROWS_PER_TABLE = 5000

/** 解析 JSON；value 可能是「JSON 字符串再包一层」，最多解两层 */
function tryParseJson(text: string, depth = 0): unknown {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof value === 'string' && depth < 2 && /^[[{]/.test(value.trim())) {
    const again = tryParseJson(value, depth + 1)
    if (again !== undefined) return again
  }
  return value
}

/**
 * 扫描 G HUB 数据库：遍历所有表的所有列，挑出像 JSON 的文本/BLOB 逐个解析，
 * 再递归找宏结构。不依赖固定表名/列名，可适配各版本差异。
 */
export function readLogitechMacros(dbPath?: string): LogitechListResult {
  const target = dbPath && dbPath.trim() ? dbPath.trim() : defaultLogitechDb()
  if (!fs.existsSync(target)) {
    return {
      ok: false,
      macros: [],
      reason: `未找到罗技 G HUB 数据库：${target}（请确认已安装并运行过 G HUB）`,
      schema: [],
      scanned: 0,
      path: target,
    }
  }
  let db: DatabaseSync | null = null
  let cleanup: string | undefined
  try {
    ;({ db, cleanup } = openReadonly(target))
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'",
      )
      .all() as { name: string }[]

    const schema: LogitechTableInfo[] = []
    const candidates: unknown[] = []
    const seen = new Set<string>()
    let scanned = 0

    for (const { name } of tables) {
      let rows: Record<string, unknown>[] = []
      let colNames: string[] = []
      try {
        const cols = db.prepare(`PRAGMA table_info("${name.replace(/"/g, '""')}")`).all() as {
          name: string
        }[]
        colNames = cols.map((c) => c.name)
        rows = db
          .prepare(`SELECT * FROM "${name.replace(/"/g, '""')}" LIMIT ${MAX_ROWS_PER_TABLE}`)
          .all() as Record<string, unknown>[]
      } catch {
        continue // 视图/虚拟表读不到就跳过
      }
      schema.push({ table: name, rows: rows.length, columns: colNames })

      for (const row of rows) {
        for (const col of colNames) {
          const raw = row[col]
          let text: string | null = null
          if (typeof raw === 'string') text = raw
          else if (raw instanceof Uint8Array) text = Buffer.from(raw).toString('utf-8')
          if (!text) continue
          // 只挑看起来像 JSON 的单元格，避免把普通配置串全解析一遍
          const t = text.trim()
          if (!(t.startsWith('{') || t.startsWith('[') || t.startsWith('"'))) continue
          const parsed = tryParseJson(text)
          if (parsed === undefined) continue
          scanned += 1
          collectMacros(parsed, candidates, seen)
        }
      }
    }

    const macros = candidates
      .map(parseCandidate)
      .filter((m): m is LogitechMacro => m !== null)
    if (macros.length === 0) {
      return {
        ok: false,
        macros: [],
        reason: '已扫描数据库，但未识别到宏（库结构见下方，可据此反馈兼容问题）',
        schema,
        scanned,
        path: target,
      }
    }
    return { ok: true, macros, schema, scanned, path: target }
  } catch (e) {
    return {
      ok: false,
      macros: [],
      reason: `读取 G HUB 数据库失败：${e instanceof Error ? e.message : String(e)}`,
      schema: [],
      scanned: 0,
      path: target,
    }
  } finally {
    try {
      db?.close()
    } catch {
      // 忽略关闭错误
    }
    if (cleanup) {
      for (const f of [cleanup, `${cleanup}-wal`, `${cleanup}-shm`]) {
        try {
          fs.unlinkSync(f)
        } catch {
          // 忽略清理错误
        }
      }
    }
  }
}
