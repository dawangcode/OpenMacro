// 宏数据层：优先走 Electron 主进程（SQLite + 全局输入），
// 浏览器 dev 模式（pnpm run dev）下自动降级为 localStorage，便于纯 UI 迭代
import {
  Macro,
  MacroFile,
  type MacroStep,
  MACRO_FILE_TYPE,
  STEP_DEFAULT_DELAY,
  createEmptyMacro,
  nextName,
  normalizeStepDelays,
  slimStepsForExport,
  stringifyMacroFile,
  expandStepKeys,
} from '@/types/macro'

const LS_KEY = 'openmacro.macros'

export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI
}

function lsRead(): Macro[] {
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as Macro[]
    // 读取时归一化：旧字段名（keyboardAction/mouseAction）映射为 action，
    // 旧结构（延迟挂在动作步骤）自动拆出独立「等待」步骤
    return Array.isArray(arr)
      ? arr.map((m) => ({ ...m, steps: normalizeStepDelays(expandStepKeys(m.steps ?? [])) }))
      : []
  } catch {
    return []
  }
}

function lsWrite(list: Macro[]): void {
  window.localStorage.setItem(LS_KEY, JSON.stringify(list))
}

export async function listMacros(): Promise<Macro[]> {
  if (isElectron()) return (await window.electronAPI!.macroList()) as Macro[]
  return lsRead().sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getMacro(id: string): Promise<Macro | null> {
  if (isElectron()) return (await window.electronAPI!.macroGet(id)) as Macro | null
  return lsRead().find((m) => m.id === id) ?? null
}

export async function saveMacro(input: Partial<Macro> & { name: string }): Promise<Macro> {
  if (isElectron()) return (await window.electronAPI!.macroSave(input)) as Macro
  const list = lsRead()
  const now = Date.now()
  const idx = input.id ? list.findIndex((m) => m.id === input.id) : -1
  if (idx >= 0) {
    const merged: Macro = { ...list[idx], ...input, id: list[idx].id, updatedAt: now }
    list[idx] = merged
    lsWrite(list)
    return merged
  }
  const created: Macro = { ...createEmptyMacro(input.name), ...input, createdAt: now, updatedAt: now }
  list.push(created)
  lsWrite(list)
  return created
}

export async function removeMacro(id: string): Promise<{ ok: boolean; removedBindings: number }> {
  if (isElectron()) return window.electronAPI!.macroRemove(id)
  const list = lsRead().filter((m) => m.id !== id)
  lsWrite(list)
  return { ok: true, removedBindings: 0 }
}

export async function duplicateMacro(id: string): Promise<Macro | null> {
  if (isElectron()) return (await window.electronAPI!.macroDuplicate(id)) as Macro | null
  const list = lsRead()
  const src = list.find((m) => m.id === id)
  if (!src) return null
  const now = Date.now()
  const copy: Macro = {
    ...src,
    id: createEmptyMacro().id,
    name: nextName(src.name, list.map((m) => m.name)),
    createdAt: now,
    updatedAt: now,
  }
  list.push(copy)
  lsWrite(list)
  return copy
}

export async function exportMacro(id: string): Promise<{ ok: boolean; path?: string; canceled?: boolean }> {
  if (isElectron()) return window.electronAPI!.macroExport(id)
  const macro = lsRead().find((m) => m.id === id)
  if (!macro) return { ok: false }
  const file: MacroFile = {
    type: MACRO_FILE_TYPE,
    macro: {
      name: macro.name,
      // 导出瘦身：id/label 重建、动作步骤省略 delay（导入端兜底 0）
      steps: slimStepsForExport(macro.steps) as MacroFile['macro']['steps'],
      playMode: macro.playMode,
      repeatInterval: macro.repeatInterval,
      playCount: macro.playCount,
      speed: macro.speed,
    },
  }
  // 自定义序列化：steps 每个步骤压成一行
  const blob = new Blob([stringifyMacroFile(file)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${macro.name}.openmacro.json`
  a.click()
  URL.revokeObjectURL(url)
  return { ok: true }
}

export async function importMacros(): Promise<{ ok: boolean; imported: number; skipped: number; canceled?: boolean }> {
  if (isElectron()) return window.electronAPI!.macroImport()
  // 浏览器模式：用隐藏 file input 选多个文件
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = '.json,application/json'
    input.onchange = async () => {
      const files = Array.from(input.files ?? [])
      let skipped = 0
      const list = lsRead()
      const importedNames: string[] = []
      for (const f of files) {
        try {
          const text = await f.text()
          const obj = JSON.parse(text) as Partial<MacroFile>
          if (obj?.type !== MACRO_FILE_TYPE || !obj.macro || !Array.isArray(obj.macro.steps)) {
            skipped += 1
            continue
          }
          const name = nextName(obj.macro.name, [...list.map((m) => m.name), ...importedNames])
          importedNames.push(name)
          const now = Date.now()
          list.push({
            ...createEmptyMacro(name),
            name,
            steps: expandStepKeys(obj.macro.steps).map((s, i) => ({
              ...s,
              // 与主进程 normalizeStep 一致：动作步骤缺 delay 兜底 0；等待步骤缺值才给默认
              delay:
                s.kind === 'delay'
                  ? Number.isFinite(Number(s.delay))
                    ? Number(s.delay)
                    : STEP_DEFAULT_DELAY
                  : Number(s.delay) || 0,
              id: s.id || `s_${i}`,
            })),
            playMode: obj.macro.playMode ?? 'once',
            repeatInterval: obj.macro.repeatInterval ?? 100,
            playCount: obj.macro.playCount ?? 1,
            speed: obj.macro.speed ?? 1,
            createdAt: now,
            updatedAt: now,
            })
            } catch {
            skipped += 1
            }
            }
      lsWrite(list)
      resolve({ ok: true, imported: importedNames.length, skipped })
    }
    input.click()
  })
}

export async function playMacro(
  id: string,
  opts?: { releaseFocus?: boolean },
): Promise<{ ok: boolean; reason?: string; warnings?: string[] }> {
  if (!isElectron()) return { ok: false, reason: '浏览器模式不支持回放，请用 pnpm run start 或 dev:app 启动客户端' }
  return window.electronAPI!.macroPlay(id, opts)
}

export async function stopMacro(): Promise<boolean> {
  if (!isElectron()) return false
  return window.electronAPI!.macroStop()
}

// ---- 导入罗技 G HUB 宏 ----
export interface LogitechMacro {
  name: string
  steps: MacroStep[]
  warnings: string[]
}

export interface LogitechScanResult {
  ok: boolean
  reason?: string
  macros: LogitechMacro[]
  schema: { table: string; rows: number; columns: string[] }[]
  scanned: number
  path: string
}

export async function logitechMacros(dbPath?: string): Promise<LogitechScanResult> {
  if (!isElectron()) {
    return { ok: false, reason: '浏览器模式不支持', macros: [], schema: [], scanned: 0, path: '' }
  }
  return (await window.electronAPI!.logitechMacros(dbPath)) as LogitechScanResult
}

export async function logitechPickDb(): Promise<{ ok: boolean; canceled?: boolean; path?: string }> {
  if (!isElectron()) return { ok: false, canceled: true }
  return window.electronAPI!.logitechPickDb()
}

export async function logitechOpenFolder(dbPath?: string): Promise<{ ok: boolean; reason?: string }> {
  if (!isElectron()) return { ok: false, reason: '浏览器模式不支持' }
  const fn = window.electronAPI!.logitechOpenFolder
  if (typeof fn !== 'function') return { ok: false, reason: '当前客户端版本不支持，请重启 OpenMacro' }
  return fn(dbPath)
}

export async function logitechImport(items: LogitechMacro[]): Promise<{
  ok: boolean
  reason?: string
  imported: number
  names: string[]
}> {
  if (!isElectron()) return { ok: false, reason: '浏览器模式不支持', imported: 0, names: [] }
  return (await window.electronAPI!.logitechImport(items)) as {
    ok: boolean
    reason?: string
    imported: number
    names: string[]
  }
}

export async function getPlaybackState(): Promise<{
  running: boolean
  macroId: string | null
  macroName: string
  progress: string
}> {
  if (!isElectron()) return { running: false, macroId: null, macroName: '', progress: '未运行' }
  return (await window.electronAPI!.macroPlaybackState()) as {
    running: boolean
    macroId: string | null
    macroName: string
    progress: string
  }
}

export async function getInputStatus(): Promise<{ capture: boolean; playback: boolean; errors: string[] }> {
  if (!isElectron()) {
    return {
      capture: false,
      playback: false,
      errors: ['当前为浏览器模式（pnpm run dev），无全局输入捕获与回放能力；请用 pnpm run start 或 dev:app 启动客户端'],
    }
  }
  return window.electronAPI!.macroInputStatus()
}

export interface RecordStartOptions {
  captureDelay: boolean
  captureMouseMove: boolean
  countdownSec?: number
}

export async function startRecording(opts: RecordStartOptions): Promise<{ ok: boolean; reason?: string }> {
  if (!isElectron()) return { ok: false, reason: '浏览器模式不支持录制，请用 pnpm run start 或 dev:app 启动客户端' }
  return window.electronAPI!.recordStart(opts)
}

export async function stopRecording(): Promise<{ id: string; kind: string; label: string; delay: number }[]> {
  if (!isElectron()) return []
  return (await window.electronAPI!.recordStop()) as { id: string; kind: string; label: string; delay: number }[]
}

export async function cancelRecording(): Promise<boolean> {
  if (!isElectron()) return false
  return window.electronAPI!.recordCancel()
}

export async function getRecordState(): Promise<{
  phase: 'idle' | 'countdown' | 'recording'
  countdown: number
  steps: unknown[]
  reason?: string
}> {
  if (!isElectron()) return { phase: 'idle', countdown: 0, steps: [] }
  return window.electronAPI!.recordState() as Promise<{
    phase: 'idle' | 'countdown' | 'recording'
    countdown: number
    steps: unknown[]
    reason?: string
  }>
}

/** 订阅主进程事件：macro:record:countdown / macro:record:state / macro:playback:state */
export function onMacroEvent(cb: (channel: string, payload: unknown) => void): () => void {
  if (!isElectron()) return () => undefined
  return window.electronAPI!.onMacroEvent(cb)
}
