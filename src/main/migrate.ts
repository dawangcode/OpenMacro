// 一次性迁移：electron-store 的 userData/config.json → SQLite
// 迁移成功后把旧文件改名为 config.json.migrated，user_version 置 1；重复执行无副作用
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getDb } from './db'
import { saveMacro } from './macro-store'
import { saveInputConfig, type InputConfig } from './binding-store'
import { setConfig } from './store'
import type { Macro } from '../types/macro'
import type { DebounceRule, KeyBinding } from '../types/binding'

const STORAGE_VERSION = 1

interface LegacyConfig {
  macros?: unknown[]
  inputConfig?: unknown
  config?: unknown
}

/** 同一触发键只保留第一条，避免撞 bindings / debounce_rules 的唯一约束 */
function dedupeByTrigger<T extends { trigger?: { kind?: unknown; code?: unknown } }>(list: T[]): T[] {
  const seen = new Set<string>()
  return list.filter((item) => {
    const trigger = item?.trigger
    if (!trigger || typeof trigger.code !== 'string' || !trigger.code) return false
    const key = `${trigger.kind === 'mouse' ? 'mouse' : 'keyboard'}:${trigger.code}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function migrateLegacyStorage(legacyPath?: string): void {
  const db = getDb()
  const versionRow = db.prepare('PRAGMA user_version').get() as { user_version?: number }
  if (Number(versionRow?.user_version ?? 0) >= STORAGE_VERSION) return

  const file = legacyPath ?? path.join(app.getPath('userData'), 'config.json')
  if (!fs.existsSync(file)) {
    db.exec(`PRAGMA user_version = ${STORAGE_VERSION}`)
    return
  }

  let legacy: LegacyConfig
  try {
    legacy = JSON.parse(fs.readFileSync(file, 'utf-8')) as LegacyConfig
  } catch (e) {
    console.error('[storage] 读取旧 config.json 失败，保留原文件下次重试：', e)
    return
  }

  try {
    if (Array.isArray(legacy.macros)) {
      for (const raw of legacy.macros) {
        const macro = raw as Partial<Macro>
        if (!macro || typeof macro.name !== 'string' || !Array.isArray(macro.steps)) continue
        try {
          saveMacro(macro as Partial<Macro> & { name: string })
        } catch (e) {
          console.error(`[storage] 跳过无法迁移的宏「${macro.name}」：`, e)
        }
      }
    }

    const cfg = legacy.inputConfig as Partial<InputConfig> | undefined
    if (cfg && typeof cfg === 'object') {
      const patch: Partial<InputConfig> = {}
      if (Array.isArray(cfg.bindings)) {
        patch.bindings = dedupeByTrigger(cfg.bindings as KeyBinding[])
      }
      if (Array.isArray(cfg.debounceRules)) {
        patch.debounceRules = dedupeByTrigger(cfg.debounceRules as DebounceRule[])
      }
      if (typeof cfg.stopHotkey === 'string' && cfg.stopHotkey) patch.stopHotkey = cfg.stopHotkey
      if (typeof cfg.complianceDismissed === 'boolean') patch.complianceDismissed = cfg.complianceDismissed
      saveInputConfig(patch)
    }

    if (legacy.config && typeof legacy.config === 'object') setConfig(legacy.config)
  } catch (e) {
    console.error('[storage] 旧数据迁移失败，保留 config.json 下次重试：', e)
    return
  }

  db.exec(`PRAGMA user_version = ${STORAGE_VERSION}`)
  try {
    fs.renameSync(file, `${file}.migrated`)
  } catch (e) {
    console.warn('[storage] 旧 config.json 改名失败（数据已迁移）：', e)
  }
}
