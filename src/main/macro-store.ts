// 宏持久化：SQLite（node:sqlite）+ 导入导出文件解析
import { getDb, transaction, getSetting, setSetting } from './db'
import {
  MACRO_FILE_TYPE,
  DEFAULT_PLAY_COUNT,
  DEFAULT_REPEAT_INTERVAL,
  createEmptyMacro,
  nextName,
  normalizeStepDelays,
  slimStepsForExport,
  stringifyMacroFile,
  expandStepKeys,
} from '../types/macro'
import type { Macro, MacroFile, MacroStep, PlayMode } from '../types/macro'

const PLAY_MODES: PlayMode[] = ['once', 'holdRepeat', 'toggleLoop', 'sequence']

interface MacroRow {
  id: string
  name: string
  play_mode: string
  repeat_interval: number
  play_count: number
  speed: number
  steps: string
  created_at: number
  updated_at: number
}

function num(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function parseSteps(raw: string): MacroStep[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as MacroStep[]) : []
  } catch {
    return []
  }
}

function rowToMacro(row: MacroRow): Macro {
  const playMode = PLAY_MODES.includes(row.play_mode as PlayMode)
    ? (row.play_mode as PlayMode)
    : 'once'
  return {
    id: row.id,
    name: row.name,
    // 读取时归一化：旧字段名（keyboardAction/mouseAction）映射为 action，
    // 旧结构（延迟挂在动作步骤）自动拆出独立「等待」步骤
    steps: normalizeStepDelays(expandStepKeys(parseSteps(row.steps))),
    playMode,
    repeatInterval: num(row.repeat_interval, DEFAULT_REPEAT_INTERVAL),
    playCount: num(row.play_count, DEFAULT_PLAY_COUNT),
    speed: num(row.speed, 1),
    createdAt: num(row.created_at, 0),
    updatedAt: num(row.updated_at, 0),
  }
}

function insertMacro(macro: Macro): void {
  getDb()
    .prepare(
      `INSERT INTO macros (id, name, play_mode, repeat_interval, play_count, speed, steps, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      macro.id,
      macro.name,
      macro.playMode,
      macro.repeatInterval,
      macro.playCount,
      macro.speed,
      JSON.stringify(macro.steps),
      macro.createdAt,
      macro.updatedAt,
    )
}

export function listMacros(): Macro[] {
  const rows = getDb()
    .prepare('SELECT * FROM macros ORDER BY updated_at DESC')
    .all() as unknown as MacroRow[]
  return rows.map(rowToMacro)
}

export function getMacro(id: string): Macro | undefined {
  const row = getDb().prepare('SELECT * FROM macros WHERE id = ?').get(id) as MacroRow | undefined
  return row ? rowToMacro(row) : undefined
}

const MIGRATION_B2K = 'migrated_mouse_button_to_key'

/**
 * 一次性物理清理：把已存库里旧鼠标步骤的 button 字段改写成 key。
 * 读取层（expandStepKeys）本就兼容旧结构，这里是收尾——让磁盘数据与新结构完全一致，
 * 之后导出/再保存都不会再出现 button。已用 settings 表做幂等闸门，仅首次真正写盘；
 * 只改写确实含 "button" 的行，并保留 updated_at 不扰乱列表排序。
 */
export function migrateStoredMacrosToKey(): number {
  if (getSetting(MIGRATION_B2K) === '1') return 0
  const db = getDb()
  const rows = db
    .prepare('SELECT id, steps, updated_at FROM macros')
    .all() as { id: string; steps: string; updated_at: number }[]
  const update = db.prepare('UPDATE macros SET steps = ?, updated_at = ? WHERE id = ?')
  let n = 0
  transaction(() => {
    for (const row of rows) {
      if (!row.steps.includes('"button"')) continue
      const normalized = normalizeStepDelays(expandStepKeys(parseSteps(row.steps)))
      update.run(JSON.stringify(normalized), row.updated_at, row.id)
      n++
    }
  })
  setSetting(MIGRATION_B2K, '1')
  return n
}

/** 新建或更新：有 id 且已存在则更新，否则新建 */
export function saveMacro(input: Partial<Macro> & { name: string }): Macro {
  const now = Date.now()
  const prev = input.id ? getMacro(input.id) : undefined
  const base = prev ?? createEmptyMacro(input.name)
  const defined = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<Macro>
  const macro: Macro = {
    ...base,
    ...defined,
    id: prev?.id ?? input.id ?? base.id,
    name: input.name,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    steps: (input.steps ?? base.steps).map(normalizeStep),
  }
  getDb()
    .prepare(
      `INSERT INTO macros (id, name, play_mode, repeat_interval, play_count, speed, steps, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         play_mode = excluded.play_mode,
         repeat_interval = excluded.repeat_interval,
         play_count = excluded.play_count,
         speed = excluded.speed,
         steps = excluded.steps,
         updated_at = excluded.updated_at`,
    )
    .run(
      macro.id,
      macro.name,
      macro.playMode,
      macro.repeatInterval,
      macro.playCount,
      macro.speed,
      JSON.stringify(macro.steps),
      macro.createdAt,
      macro.updatedAt,
    )
  return macro
}

function normalizeStep(s: MacroStep, index: number): MacroStep {
  return {
    ...s,
    id: s.id || `s_${Date.now().toString(36)}_${index}`,
    delay: Number.isFinite(Number(s.delay)) ? Number(s.delay) : 0,
  }
}

export function removeMacro(id: string): boolean {
  const result = getDb().prepare('DELETE FROM macros WHERE id = ?').run(id)
  return Number(result.changes) > 0
}

/** 复制：同名副本追加序号，返回新宏（PRD 4.4） */
export function duplicateMacro(id: string): Macro | null {
  const src = getMacro(id)
  if (!src) return null
  const names = (getDb().prepare('SELECT name FROM macros').all() as { name: string }[]).map(
    (row) => row.name,
  )
  const now = Date.now()
  const copy: Macro = {
    ...src,
    id: createEmptyMacro().id,
    name: nextName(src.name, names),
    createdAt: now,
    updatedAt: now,
    steps: src.steps.map((s, i) => ({ ...s, id: `s_${now.toString(36)}_${i}` })),
  }
  insertMacro(copy)
  return copy
}

export function serializeMacro(macro: Macro): string {
  const file: MacroFile = {
    type: MACRO_FILE_TYPE,
    macro: {
      name: macro.name,
      // 导出瘦身：id/label 重建、动作步骤省略 delay（导入端兜底 0），文件更短更可读
      steps: slimStepsForExport(macro.steps) as MacroFile['macro']['steps'],
      playMode: macro.playMode,
      repeatInterval: macro.repeatInterval,
      playCount: macro.playCount,
      speed: macro.speed,
    },
  }
  // 自定义序列化：steps 每个步骤压成一行
  return stringifyMacroFile(file)
}

/** 解析宏文件；格式不符返回 null（调用方跳过并计数）。仅支持 JSON 完整格式 */
export function parseMacroFile(text: string): { name: string; macro: MacroFile['macro'] } | null {
  try {
    const obj = JSON.parse(text) as Partial<MacroFile> & { macro?: { steps?: unknown[] } }
    if (obj?.type === MACRO_FILE_TYPE && obj.macro && typeof obj.macro.name === 'string' && Array.isArray(obj.macro.steps)) {
      return {
        name: obj.macro.name,
        macro: { ...obj.macro, steps: expandStepKeys(obj.macro.steps) } as MacroFile['macro'],
      }
    }
  } catch {
    // 仅支持 JSON 完整格式
  }
  return null
}

/** 导入：名称冲突自动重命名，不覆盖（PRD 4.4 业务规则） */
export function importMacros(parsed: { name: string; macro: MacroFile['macro'] }[]): Macro[] {
  const names = (getDb().prepare('SELECT name FROM macros').all() as { name: string }[]).map(
    (row) => row.name,
  )
  const now = Date.now()
  const imported: Macro[] = []
  for (const item of parsed) {
    const name = nextName(item.name, names)
    names.push(name)
    imported.push({
      ...createEmptyMacro(name),
      name,
      steps: normalizeStepDelays(expandStepKeys(item.macro.steps).map(normalizeStep)),
      playMode: item.macro.playMode ?? 'once',
      repeatInterval: item.macro.repeatInterval ?? 100,
      playCount: item.macro.playCount ?? 1,
      speed: item.macro.speed ?? 1,
      createdAt: now,
      updatedAt: now,
    })
  }
  transaction(() => imported.forEach(insertMacro))
  return imported
}
