// IPC 处理器（src/main/ipc.ts）
// 职责：主进程侧处理渲染进程 invoke；本地持久化走 SQLite（node:sqlite，见 db.ts）
// 命名规范 'domain:action'；渲染进程不碰 fs / 不直接 require 原生模块
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs/promises'
import {
  disableAdminAutostart,
  enableAdminAutostart,
  getAdminAutostartStatus,
  relaunchElevated,
} from './admin-autostart'
import {
  getLoginItemStatus,
  getMacPermissionStatus,
  openPrivacyPane,
  revealAppBundle,
  setLoginItem,
} from './mac-permissions'
import { validateProgramPath } from './actions'
import { attachEngine } from './binding-engine'
import {
  bindingCountForMacro,
  getInputConfig,
  removeBindingsForMacro,
  saveBindings,
  saveDebounceRules,
  saveInputConfig,
} from './binding-store'
import { startKeyCapture } from './capture'
import { getDbPath } from './db'
import { getDetectState, getTriggerState, setDetectPaused, startDetector, clearDetectEvents, clearTriggerEvents } from './detector'
import { getHookError } from './hook'
import { getConfig, isSponsorGuideDismissed, markSponsorGuideShown, setConfig } from './store'
import { setEventSender } from './events'
import { ensureInputBackend } from './input-backend'
import {
  duplicateMacro,
  getMacro,
  importMacros,
  listMacros,
  parseMacroFile,
  removeMacro,
  saveMacro,
  serializeMacro,
} from './macro-store'
import { readLogitechMacros } from './logitech-import'
import type { MacroStep } from '../types/macro'
import { recorder } from './recorder'
import { getPlaybackState, play as playMacro, stopAll } from './player'
import type { KeyBinding } from '../types/binding'
import type { DebounceRule } from '../types/binding'
import type { InputConfig } from './binding-store'

// ipcMain.handle 重复注册会抛「Attempted to register a second handler」并炸掉主进程；
// 窗口重建（macOS activate / 关窗重开 → createWindow）会再次进入本函数，只允许挂一次
let handlersRegistered = false

export function registerIpcHandlers(win: BrowserWindow) {
  // 主进程 → 渲染进程事件推流（channel 白名单见 events.ts）
  setEventSender((channel, payload) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  })
  recorder.setWindow(win)

  // 窗口重建时的重入：推流目标已换成新窗口，引擎与 handler 不重复挂
  if (handlersRegistered) return
  handlersRegistered = true

  // 按键绑定运行时 + 实时检测：接入全局钩子并热加载已保存配置（保存即生效）
  attachEngine()
  saveInputConfig({}) // 触发一次 reloadBindings，把 store 里的配置灌进运行时
  startDetector()

  ipcMain.handle('config:get', () => getConfig())
  ipcMain.handle('config:set', (_e, config: unknown) => {
    setConfig(config)
    return true
  })

  // ---- 赞助引导提醒（默认展示，关闭即永久，主版本大更新时重置一次）----
  ipcMain.handle('sponsor:guide:shouldShow', () => !isSponsorGuideDismissed())
  ipcMain.handle('sponsor:guide:dismiss', () => {
    markSponsorGuideShown()
    return true
  })

  // ---- 输入后端状态 ----
  ipcMain.handle('macro:input:status', () => {
    const s = ensureInputBackend()
    // 把运行时钩子启动失败原因一并暴露（getCapture 仅反映模块加载，start 失败靠 hook 侧记录）
    const hookErr = getHookError()
    if (hookErr && !s.errors.includes(hookErr)) s.errors.push(hookErr)
    return s
  })

  // 窗口标题：渲染进程按当前菜单动态更新（OpenMacro-当前菜单名）
  ipcMain.handle('window:setTitle', (_e, t: string) => {
    if (!win.isDestroyed()) win.setTitle(t)
  })

  // ---- 按键映射（PRD 4.1 / 4.3 / 4.6）----
  ipcMain.handle('binding:list', () => getInputConfig().bindings)
  ipcMain.handle('binding:save', (_e, list: unknown) =>
    saveBindings((list ?? []) as KeyBinding[]),
  )
  ipcMain.handle('input:config:get', () => {
    const cfg = getInputConfig()
    return { stopHotkey: cfg.stopHotkey, complianceDismissed: cfg.complianceDismissed }
  })
  ipcMain.handle('input:config:set', (_e, patch: unknown) =>
    saveInputConfig((patch ?? {}) as Partial<InputConfig>),
  )
  ipcMain.handle('binding:countForMacro', (_e, macroId: string) => bindingCountForMacro(macroId))
  ipcMain.handle('binding:validatePath', (_e, p: unknown) => validateProgramPath(String(p ?? '')))
  // ---- 按键防抖（PRD 4.3）：独立规则实体，按绑定按键配置 ----
  ipcMain.handle('debounce:list', () => getInputConfig().debounceRules)
  ipcMain.handle('debounce:save', (_e, list: unknown) =>
    saveDebounceRules((list ?? []) as DebounceRule[]),
  )
  // 捕获会话立即返回，结果经 'macro:capture:result' 事件推送（见 capture.ts）
  // opts.allowReservedMouse：防抖规则允许捕获左键 / 右键（鼠标连击过滤），绑定不允许
  ipcMain.handle('capture:key', (_e, opts?: { allowReservedMouse?: boolean }) =>
    startKeyCapture({ allowReservedMouse: opts?.allowReservedMouse === true }),
  )
  ipcMain.handle('detect:state', () => getDetectState())
  ipcMain.handle('detect:setPaused', (_e, v: unknown) => setDetectPaused(v === true))
  ipcMain.handle('detect:clear', () => {
    clearDetectEvents()
    return { ok: true }
  })
  ipcMain.handle('trigger:state', () => getTriggerState())
  ipcMain.handle('trigger:clear', () => {
    clearTriggerEvents()
    return { ok: true }
  })
  ipcMain.handle('dialog:pickExecutable', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: '选择程序',
      properties: ['openFile'],
      filters: [{ name: '可执行文件', extensions: ['exe', 'bat', 'cmd', 'lnk'] }],
    })
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true }
    return { ok: true, path: res.filePaths[0] }
  })

  // ---- 宏库管理 ----
  ipcMain.handle('macro:list', () => listMacros())
  ipcMain.handle('macro:get', (_e, id: string) => getMacro(id) ?? null)
  ipcMain.handle('macro:save', (_e, input) => saveMacro(input))
  ipcMain.handle('macro:remove', (_e, id: string) => {
    // 删除宏时同步解除引用该宏的按键绑定（PRD 4.4 业务规则）
    const removedBindings = removeBindingsForMacro(id)
    const ok = removeMacro(id)
    return { ok, removedBindings }
  })
  ipcMain.handle('macro:duplicate', (_e, id: string) => duplicateMacro(id))
  ipcMain.handle('macro:export', async (_e, id: string) => {
    const macro = getMacro(id)
    if (!macro) return { ok: false, reason: '宏不存在' }
    const res = await dialog.showSaveDialog(win, {
      title: '导出宏',
      defaultPath: `${macro.name}.openmacro.json`,
      filters: [{ name: 'OpenMacro 宏文件 (JSON)', extensions: ['json'] }],
    })
    if (res.canceled || !res.filePath) return { ok: false, canceled: true }
    await fs.writeFile(res.filePath, serializeMacro(macro), 'utf-8')
    return { ok: true, path: res.filePath }
  })
  ipcMain.handle('macro:import', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: '导入宏',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'OpenMacro 宏文件', extensions: ['json'] }],
    })
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true, imported: 0, skipped: 0 }
    const parsed: { name: string; macro: any }[] = []
    let skipped = 0
    for (const p of res.filePaths) {
      try {
        const text = await fs.readFile(p, 'utf-8')
        const item = parseMacroFile(text)
        if (item) parsed.push(item)
        else skipped += 1
      } catch {
        skipped += 1
      }
    }
    const imported = importMacros(parsed)
    return { ok: true, imported: imported.length, skipped, names: imported.map((m) => m.name) }
  })

  // ---- 导入罗技 G HUB 宏 ----
  ipcMain.handle('logi:list', (_e, dbPath?: string) => readLogitechMacros(dbPath))
  ipcMain.handle('logi:pickDb', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: '选择罗技 G HUB 数据库',
      properties: ['openFile'],
      filters: [{ name: 'SQLite 数据库', extensions: ['db'] }],
    })
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true }
    return { ok: true, path: res.filePaths[0] }
  })
  ipcMain.handle('logi:openFolder', async (_e, dbPath?: string) => {
    const target = (dbPath ?? '').trim()
    if (!target) return { ok: false, reason: '数据库路径为空' }
    const dir = target.replace(/[\\/][^\\/]+$/, '') || target
    // 优先直接打开所在目录（比 showItemInFolder 更稳，不受文件被占用影响）
    try {
      const err = await shell.openPath(dir)
      if (!err) return { ok: true }
      // 目录打不开时，退回在资源管理器中定位文件
      shell.showItemInFolder(target)
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('logi:import', (_e, items: { name: string; steps: unknown[] }[]) => {
    if (!Array.isArray(items) || items.length === 0) return { ok: false, reason: '未选择任何宏' }
    const parsed = items.map((it) => ({
      name: it.name,
      macro: {
        name: it.name,
        steps: it.steps as MacroStep[],
        playMode: 'once' as const,
        repeatInterval: 100,
        playCount: 1,
        speed: 1,
      },
    }))
    const imported = importMacros(parsed)
    return { ok: true, imported: imported.length, names: imported.map((m) => m.name) }
  })

  // ---- 播放 ----
  ipcMain.handle('macro:play', async (_e, id: string, opts?: { releaseFocus?: boolean }) => {
    const macro = getMacro(id)
    if (!macro) return { ok: false, reason: '宏不存在' }
    // 试运行：让出焦点，把合成按键发给用户当前窗口（如游戏）而非 OpenMacro 自身
    if (opts?.releaseFocus && !win.isDestroyed()) win.blur()
    return playMacro(macro)
  })
  ipcMain.handle('macro:stop', () => {
    stopAll()
    return true
  })
  ipcMain.handle('macro:playback:state', () => getPlaybackState())

  // ---- 录制 ----
  ipcMain.handle('record:start', (_e, opts) => recorder.start(opts))
  ipcMain.handle('record:stop', () => recorder.stop())
  ipcMain.handle('record:cancel', () => {
    recorder.cancel()
    return true
  })
  ipcMain.handle('record:state', () => recorder.getState())

  // ---- 运行权限 / 提权自启（仅 Windows：计划任务 + 以最高权限运行）----
  ipcMain.handle('admin:autostart:status', () => getAdminAutostartStatus())
  ipcMain.handle('admin:autostart:enable', () => enableAdminAutostart())
  ipcMain.handle('admin:autostart:disable', () => disableAdminAutostart())
  // 注意：成功时当前实例会在 400ms 后退出，让出单实例锁给任务拉起的新实例
  ipcMain.handle('admin:autostart:relaunch', () => relaunchElevated())

  // ---- macOS 输入权限 / 开机启动（仅 darwin：TCC 授权查询 + 登录项）----
  ipcMain.handle('mac:permissions:status', () => getMacPermissionStatus())
  ipcMain.handle('mac:permissions:openPane', (_e, pane: 'accessibility' | 'inputMonitoring') =>
    openPrivacyPane(pane),
  )
  ipcMain.handle('mac:loginItem:status', () => getLoginItemStatus())
  ipcMain.handle('mac:loginItem:set', (_e, open: boolean) => setLoginItem(open === true))
  // 在 Finder 中显示 .app 包（手动添加 TCC 授权时可直接拖拽）
  ipcMain.handle('mac:app:reveal', () => revealAppBundle())

  // ---- 通用：在系统文件管理器中显示文件（Windows 资源管理器 / macOS Finder）----
  ipcMain.handle('shell:reveal', (_e, p: unknown) => {
    if (typeof p !== 'string' || !p) return { ok: false, reason: '路径为空' }
    shell.showItemInFolder(p)
    return { ok: true }
  })

  // 本地 SQLite 数据库文件路径（系统设置页展示，备份 / 排障用）
  ipcMain.handle('db:path', () => getDbPath())
}
