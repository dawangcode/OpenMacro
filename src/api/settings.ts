// 运行权限数据层（src/api/settings.ts）
// Electron 优先；浏览器 dev 模式下返回「不支持」，保证 UI 可迭代（与 binding.ts 同套降级约定）。
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

function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI
}

const UNSUPPORTED_STATUS: AdminAutostartStatus = {
  supported: false,
  elevated: false,
  taskExists: false,
  taskPathMatches: false,
  taskCommand: '',
  taskRunLevel: '',
  exePath: '',
  taskName: '',
  enabled: false,
  requiresUac: false,
}

function unsupported(reason: string): AdminAutostartResult {
  return { ok: false, reason }
}

export async function getAdminAutostartStatus(): Promise<AdminAutostartStatus> {
  if (!isElectron()) return UNSUPPORTED_STATUS
  return window.electronAPI!.adminAutostartStatus()
}

/** 开通提权自启；未提权的实例会在这里触发一次 UAC（用户可能拒绝） */
export async function enableAdminAutostart(): Promise<AdminAutostartResult> {
  if (!isElectron()) return unsupported('浏览器模式不支持提权自启')
  return window.electronAPI!.adminAutostartEnable()
}

export async function disableAdminAutostart(): Promise<AdminAutostartResult> {
  if (!isElectron()) return unsupported('浏览器模式不支持提权自启')
  return window.electronAPI!.adminAutostartDisable()
}

/** 切到管理员权限实例：成功则表示当前窗口即将关闭并由任务重新拉起 */
export async function relaunchElevated(): Promise<AdminAutostartResult> {
  if (!isElectron()) return unsupported('浏览器模式不支持提权自启')
  return window.electronAPI!.adminAutostartRelaunch()
}

// ---- macOS：输入授权状态（辅助功能 / 输入监控） ----

/** 查询 macOS 输入授权状态（不弹框，可随时调用） */
export async function getMacPermissionStatus(): Promise<MacPermissionStatus> {
  if (!isElectron()) {
    return {
      supported: false,
      accessibility: false,
      inputMonitoring: false,
      available: false,
      exePath: '',
      appBundlePath: '',
    }
  }
  return window.electronAPI!.macPermissionsStatus()
}

/** 打开系统设置对应隐私面板（accessibility / inputMonitoring） */
export async function openMacPrivacyPane(
  pane: 'accessibility' | 'inputMonitoring',
): Promise<MacPermissionResult> {
  if (!isElectron()) return unsupportedPane('浏览器模式不支持打开系统设置')
  return window.electronAPI!.macOpenPrivacyPane(pane)
}

function unsupportedPane(reason: string): MacPermissionResult {
  return { ok: false, reason }
}

// ---- macOS：登录项开机启动 ----

/** 登录项开机启动状态（仅打包态可用） */
export async function getMacLoginItem(): Promise<MacLoginItemStatus> {
  if (!isElectron()) return { supported: false, openAtLogin: false, reason: '浏览器模式不支持' }
  return window.electronAPI!.macLoginItemStatus()
}

/** 开 / 关登录项开机启动 */
export async function setMacLoginItem(open: boolean): Promise<MacLoginItemResult> {
  if (!isElectron()) return { ok: false, reason: '浏览器模式不支持开机启动设置' }
  return window.electronAPI!.macLoginItemSet(open)
}

/** 在 Finder 中显示当前 .app 包（手动添加 TCC 授权时可直接拖拽） */
export async function revealMacAppBundle(): Promise<MacPermissionResult> {
  if (!isElectron()) return { ok: false, reason: '浏览器模式不支持' }
  return window.electronAPI!.macRevealAppBundle()
}

/** 在系统文件管理器中显示文件（Windows 资源管理器 / macOS Finder） */
export async function revealPath(p: string): Promise<{ ok: boolean; reason?: string }> {
  if (!isElectron()) return { ok: false, reason: '浏览器模式不支持' }
  return window.electronAPI!.revealPath(p)
}

// ---- 首次启动赞助引导（只展示一次）----

/** 是否要展示引导卡；浏览器 dev 态不展示（没有持久化，刷一次又弹） */
export async function shouldShowSponsorGuide(): Promise<boolean> {
  if (!isElectron()) return false
  return window.electronAPI!.sponsorGuideShouldShow()
}

/** 关闭引导（任意关闭方式都算），之后永不再现 */
export async function dismissSponsorGuide(): Promise<boolean> {
  if (!isElectron()) return true
  return window.electronAPI!.sponsorGuideDismiss()
}

/** 本地 SQLite 数据库文件路径（浏览器模式没有主进程，返回空串由 UI 显示占位） */
export async function getDatabasePath(): Promise<string> {
  if (!isElectron()) return ''
  return window.electronAPI!.dbPath()
}
