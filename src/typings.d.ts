// renderer 侧 preload 暴露的 API 类型声明
import type {
  AdminAutostartResult,
  AdminAutostartStatus,
} from '@/types/admin-autostart'
import type {
  MacLoginItemResult,
  MacLoginItemStatus,
  MacPermissionResult,
  MacPermissionStatus,
} from '@/types/mac-permissions'

export interface MacroElectronAPI {
  getConfig: () => Promise<Record<string, unknown>>
  setConfig: (config: unknown) => Promise<void>
  platform: NodeJS.Platform

  macroList: () => Promise<unknown[]>
  macroGet: (id: string) => Promise<unknown | null>
  macroSave: (input: unknown) => Promise<unknown>
  macroRemove: (id: string) => Promise<{ ok: boolean; removedBindings: number }>
  macroDuplicate: (id: string) => Promise<unknown | null>
  macroExport: (id: string) => Promise<{ ok: boolean; path?: string; canceled?: boolean; reason?: string }>
  macroImport: () => Promise<{ ok: boolean; canceled?: boolean; imported: number; skipped: number; names?: string[] }>
  macroPlay: (id: string, opts?: { releaseFocus?: boolean }) => Promise<{ ok: boolean; reason?: string; warnings?: string[] }>
  macroStop: () => Promise<boolean>
  macroPlaybackState: () => Promise<unknown>
  macroInputStatus: () => Promise<{ capture: boolean; playback: boolean; errors: string[] }>

  recordStart: (opts: unknown) => Promise<{ ok: boolean; reason?: string }>
  recordStop: () => Promise<unknown[]>
  recordCancel: () => Promise<boolean>
  recordState: () => Promise<unknown>

  bindingList: () => Promise<unknown[]>
  bindingSave: (list: unknown) => Promise<{ ok: boolean; reason?: string; bindings: unknown[] }>
  debounceRuleList: () => Promise<unknown[]>
  debounceRuleSave: (list: unknown) => Promise<{ ok: boolean; reason?: string; rules: unknown[] }>
  inputConfigGet: () => Promise<{ stopHotkey: string; complianceDismissed: boolean }>
  inputConfigSet: (patch: unknown) => Promise<unknown>
  bindingCountForMacro: (macroId: string) => Promise<number>
  bindingValidatePath: (p: string) => Promise<{ ok: boolean; reason?: string }>
  startKeyCapture: (opts?: { allowReservedMouse?: boolean }) => Promise<{ ok: boolean; reason?: string }>
  detectState: () => Promise<{
    events: {
      id: string
      key: string
      eventType: string
      ts: number
      repeat: number
    }[]
    seen: string[]
    lastMouseActivityAt: number
    paused: boolean
  }>
  detectSetPaused: (paused: boolean) => Promise<boolean>
  detectClear: () => Promise<{ ok: boolean }>
  triggerState: () => Promise<unknown[]>
  triggerClear: () => Promise<{ ok: boolean }>
  pickExecutable: () => Promise<{ ok: boolean; path?: string; canceled?: boolean }>

  // 导入罗技 G HUB 宏
  logitechMacros: (dbPath?: string) => Promise<{
    ok: boolean
    reason?: string
    macros: { name: string; steps: unknown[]; warnings: string[] }[]
    schema: { table: string; rows: number; columns: string[] }[]
    scanned: number
    path: string
  }>
  logitechPickDb: () => Promise<{ ok: boolean; canceled?: boolean; path?: string }>
  logitechOpenFolder: (dbPath?: string) => Promise<{ ok: boolean; reason?: string }>
  logitechImport: (
    items: { name: string; steps: unknown[] }[],
  ) => Promise<{ ok: boolean; reason?: string; imported: number; names: string[] }>

  onMacroEvent: (cb: (channel: string, payload: unknown) => void) => () => void

  windowSetTitle: (t: string) => Promise<void>

  adminAutostartStatus: () => Promise<AdminAutostartStatus>
  adminAutostartEnable: () => Promise<AdminAutostartResult>
  adminAutostartDisable: () => Promise<AdminAutostartResult>
  adminAutostartRelaunch: () => Promise<AdminAutostartResult>

  macPermissionsStatus: () => Promise<MacPermissionStatus>
  macOpenPrivacyPane: (pane: 'accessibility' | 'inputMonitoring') => Promise<MacPermissionResult>
  macLoginItemStatus: () => Promise<MacLoginItemStatus>
  macLoginItemSet: (open: boolean) => Promise<MacLoginItemResult>
  macRevealAppBundle: () => Promise<MacPermissionResult>

  /** 在系统文件管理器中显示文件（Windows 资源管理器 / macOS Finder） */
  revealPath: (p: string) => Promise<{ ok: boolean; reason?: string }>

  /** 本地 SQLite 数据库文件路径 */
  dbPath: () => Promise<string>

  /** 首次启动赞助引导是否要展示（用户关闭过后永不再现） */
  sponsorGuideShouldShow: () => Promise<boolean>
  sponsorGuideDismiss: () => Promise<boolean>
}

// 静态图片（*.png）的类型声明在 src/images.d.ts（全局脚本文件才生效，见那里的注释）

declare global {
  interface Window {
    electronAPI?: MacroElectronAPI
  }
}

export {}
