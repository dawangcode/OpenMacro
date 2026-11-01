// 本地持久化：Node 内置 SQLite（Electron 43 内置 Node 24，无需原生模块与重编）
// 数据库文件：userData/openmacro.db（测试可用 OPENMACRO_DB_PATH 覆盖）
import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS macros (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  play_mode TEXT NOT NULL,
  repeat_interval INTEGER NOT NULL,
  play_count INTEGER NOT NULL,
  speed REAL NOT NULL,
  steps TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_macros_updated_at ON macros (updated_at DESC);

CREATE TABLE IF NOT EXISTS bindings (
  id TEXT PRIMARY KEY,
  trigger_kind TEXT NOT NULL,
  trigger_code TEXT NOT NULL,
  trigger_label TEXT NOT NULL,
  tap TEXT,
  hold TEXT,
  hold_threshold_ms INTEGER NOT NULL,
  position INTEGER NOT NULL,
  UNIQUE (trigger_kind, trigger_code)
);

CREATE TABLE IF NOT EXISTS debounce_rules (
  id TEXT PRIMARY KEY,
  trigger_kind TEXT NOT NULL,
  trigger_code TEXT NOT NULL,
  trigger_label TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  window_ms INTEGER NOT NULL,
  position INTEGER NOT NULL,
  UNIQUE (trigger_kind, trigger_code)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

let instance: DatabaseSync | null = null

export function getDbPath(): string {
  return process.env.OPENMACRO_DB_PATH || path.join(app.getPath('userData'), 'openmacro.db')
}

export function getDb(): DatabaseSync {
  if (instance) return instance
  const file = getDbPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec(SCHEMA)
  instance = db
  return db
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row ? row.value : null
}

export function setSetting(key: string, value: string | null): void {
  const db = getDb()
  if (value === null) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key)
    return
  }
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value)
}

export function transaction<T>(fn: () => T): T {
  const db = getDb()
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
