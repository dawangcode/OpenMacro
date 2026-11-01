// macOS 输入权限与开机启动（src/main/mac-permissions.ts）
// Windows 的对应物是 admin-autostart.ts（计划任务提权自启）；本文件只处理 darwin。
//
// 为什么 macOS 不需要「提权」：Windows 上低 IL 进程不能给高 IL 进程（管理员权限的游戏）
// 注入输入，才需要计划任务 HighestAvailable；macOS 的 CGEvent 注入/捕获只看 TCC 授权，
// 与是否 root 无关。所以 macOS 侧要管的是两件事：
//   1) 输入授权状态 —— 复用 uiohook 补丁导出的 queryPermissions()（不弹框）；
//   2) 登录项开机启动 —— app.setLoginItemSettings（macOS 13+ 底层 SMAppService，无授权、无弹窗）。
import { app, shell } from 'electron'
import type {
  MacLoginItemResult,
  MacLoginItemStatus,
  MacPermissionResult,
  MacPermissionStatus,
} from '../types/mac-permissions'

function isDarwin(): boolean {
  return process.platform === 'darwin'
}

/**
 * 当前 .app 包路径。
 * TCC 授权按包（代码签名）归属，手动往「辅助功能 / 输入监控」里添加时认的是 .app，
 * 不是包内的 Mach-O 可执行文件。app.getPath('exe') 在 macOS 上位于
 * <bundle>.app/Contents/MacOS/<name>，这里反推包目录；非打包结构（异常情况）退回 exe 本身。
 * dev 态 = node_modules/electron/dist/Electron.app；打包后 = /Applications/OpenMacro.app。
 */
export function appBundlePath(): string {
  try {
    const exe = app.getPath('exe')
    const m = exe.match(/^(.*\.app)\/Contents\/MacOS\/[^/]+$/)
    return m ? m[1] : exe
  } catch {
    return ''
  }
}

/** 在 Finder 中显示 .app 包（手动添加权限时可直接拖进系统设置列表） */
export async function revealAppBundle(): Promise<MacPermissionResult> {
  if (!isDarwin()) return { ok: false, reason: '仅 macOS 支持' }
  const p = appBundlePath()
  if (!p) return { ok: false, reason: '取不到程序路径' }
  try {
    shell.showItemInFolder(p)
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 查询输入授权状态（不弹框，可随时调用）。
 * 模块加载失败时 available=false——UI 据此显示「查询失败」，而不是把加载失败
 * 误报成「用户没授权」（两者排查路径完全不同）。
 */
export function getMacPermissionStatus(): MacPermissionStatus {
  if (!isDarwin()) {
    return {
      supported: false,
      accessibility: true,
      inputMonitoring: true,
      available: false,
      exePath: '',
      appBundlePath: '',
    }
  }
  const paths = { exePath: '', appBundlePath: appBundlePath() }
  try {
    paths.exePath = app.getPath('exe')
  } catch {
    /* 取不到路径不影响授权状态本身 */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('uiohook-napi') as {
      uIOhook?: { queryPermissions?: () => { accessibility: boolean; inputMonitoring: boolean } }
    }
    const r = mod.uIOhook?.queryPermissions?.()
    if (!r) {
      return { supported: true, accessibility: false, inputMonitoring: false, available: false, ...paths }
    }
    return {
      supported: true,
      accessibility: r.accessibility === true,
      inputMonitoring: r.inputMonitoring === true,
      available: true,
      ...paths,
    }
  } catch {
    return { supported: true, accessibility: false, inputMonitoring: false, available: false, ...paths }
  }
}

/** 系统设置隐私面板深链：比让用户自己在设置里翻面板可靠 */
const PRIVACY_PANES: Record<string, string> = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  inputMonitoring: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
}

/** 打开系统设置对应隐私面板；深链失效（系统改版）时退回到「隐私与安全性」主面板 */
export async function openPrivacyPane(pane: 'accessibility' | 'inputMonitoring'): Promise<MacPermissionResult> {
  if (!isDarwin()) return { ok: false, reason: '仅 macOS 支持' }
  const url = PRIVACY_PANES[pane]
  if (!url) return { ok: false, reason: `未知面板：${pane}` }
  try {
    await shell.openExternal(url)
    return { ok: true }
  } catch (e) {
    try {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security')
      return { ok: true }
    } catch {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) }
    }
  }
}

/**
 * 登录项开机启动状态。
 * 仅打包态可用：dev 态 app.getPath('exe') 是 electron 二进制，注册登录项会得到
 * 「开机启动一个没有应用内容的 Electron 空壳」（与 admin-autostart 的 dev 态拦截同思路）。
 */
export function getLoginItemStatus(): MacLoginItemStatus {
  if (!isDarwin()) return { supported: false, openAtLogin: false, reason: '仅 macOS 支持开机启动设置' }
  if (!app.isPackaged) {
    return {
      supported: false,
      openAtLogin: false,
      reason: '开发模式不支持：请用打包安装后的程序设置（dev 态会把 electron 二进制注册成登录项）',
    }
  }
  try {
    return { supported: true, openAtLogin: app.getLoginItemSettings().openAtLogin === true }
  } catch (e) {
    return { supported: false, openAtLogin: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/** 开/关登录项开机启动（幂等） */
export function setLoginItem(open: boolean): MacLoginItemResult {
  if (!isDarwin()) return { ok: false, reason: '仅 macOS 支持开机启动设置' }
  if (!app.isPackaged) {
    return { ok: false, reason: '开发模式不支持：请用打包安装后的程序设置（dev 态会把 electron 二进制注册成登录项）' }
  }
  try {
    app.setLoginItemSettings({ openAtLogin: open })
    return { ok: true, status: getLoginItemStatus() }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
