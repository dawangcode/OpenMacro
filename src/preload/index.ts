// 预加载脚本（src/preload/index.ts）
// 职责：通过 contextBridge 向渲染进程暴露白名单 API，不透传 ipcRenderer 本体
import { contextBridge, ipcRenderer } from 'electron'

// 与主进程 events.ts 保持一致：只转发白名单 channel
const EVENT_CHANNELS = [
  'macro:record:countdown',
  'macro:record:state',
  'macro:playback:state',
  'macro:detect:event',
  'macro:trigger:event',
  'macro:action:warning',
  'macro:capture:result',
]

const api = {
  // 本地配置读写（主进程 SQLite）
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config: unknown) => ipcRenderer.invoke('config:set', config),
  // 平台信息
  platform: process.platform,

  // ---- 宏库管理 ----
  macroList: () => ipcRenderer.invoke('macro:list'),
  macroGet: (id: string) => ipcRenderer.invoke('macro:get', id),
  macroSave: (input: unknown) => ipcRenderer.invoke('macro:save', input),
  macroRemove: (id: string) => ipcRenderer.invoke('macro:remove', id),
  macroDuplicate: (id: string) => ipcRenderer.invoke('macro:duplicate', id),
  macroExport: (id: string) => ipcRenderer.invoke('macro:export', id),
  macroImport: () => ipcRenderer.invoke('macro:import'),
  macroPlay: (id: string, opts?: { releaseFocus?: boolean }) => ipcRenderer.invoke('macro:play', id, opts),
  macroStop: () => ipcRenderer.invoke('macro:stop'),
  macroPlaybackState: () => ipcRenderer.invoke('macro:playback:state'),
  macroInputStatus: () => ipcRenderer.invoke('macro:input:status'),

  // ---- 导入罗技 G HUB 宏 ----
  logitechMacros: (dbPath?: string) => ipcRenderer.invoke('logi:list', dbPath),
  logitechPickDb: () => ipcRenderer.invoke('logi:pickDb'),
  logitechOpenFolder: (dbPath?: string) => ipcRenderer.invoke('logi:openFolder', dbPath),
  logitechImport: (items: unknown) => ipcRenderer.invoke('logi:import', items),

  // ---- 录制 ----
  recordStart: (opts: unknown) => ipcRenderer.invoke('record:start', opts),
  recordStop: () => ipcRenderer.invoke('record:stop'),
  recordCancel: () => ipcRenderer.invoke('record:cancel'),
  recordState: () => ipcRenderer.invoke('record:state'),

  // ---- 按键映射 / 防抖 / 检测（PRD 4.1 / 4.2 / 4.3 / 4.6）----
  bindingList: () => ipcRenderer.invoke('binding:list'),
  bindingSave: (list: unknown) => ipcRenderer.invoke('binding:save', list),
  debounceRuleList: () => ipcRenderer.invoke('debounce:list'),
  debounceRuleSave: (list: unknown) => ipcRenderer.invoke('debounce:save', list),
  inputConfigGet: () => ipcRenderer.invoke('input:config:get'),
  inputConfigSet: (patch: unknown) => ipcRenderer.invoke('input:config:set', patch),
  bindingCountForMacro: (macroId: string) => ipcRenderer.invoke('binding:countForMacro', macroId),
  bindingValidatePath: (p: string) => ipcRenderer.invoke('binding:validatePath', p),
  startKeyCapture: (opts?: { allowReservedMouse?: boolean }) =>
    ipcRenderer.invoke('capture:key', opts),
  detectState: () => ipcRenderer.invoke('detect:state'),
  detectSetPaused: (paused: boolean) => ipcRenderer.invoke('detect:setPaused', paused),
  detectClear: () => ipcRenderer.invoke('detect:clear'),
  triggerState: () => ipcRenderer.invoke('trigger:state'),
  triggerClear: () => ipcRenderer.invoke('trigger:clear'),
  pickExecutable: () => ipcRenderer.invoke('dialog:pickExecutable'),

  // 窗口标题（动态菜单名：OpenMacro-当前菜单）
  windowSetTitle: (t: string) => ipcRenderer.invoke('window:setTitle', t),

  // ---- 运行权限 / 提权自启 ----
  adminAutostartStatus: () => ipcRenderer.invoke('admin:autostart:status'),
  adminAutostartEnable: () => ipcRenderer.invoke('admin:autostart:enable'),
  adminAutostartDisable: () => ipcRenderer.invoke('admin:autostart:disable'),
  adminAutostartRelaunch: () => ipcRenderer.invoke('admin:autostart:relaunch'),

  // ---- macOS 输入权限 / 开机启动 ----
  macPermissionsStatus: () => ipcRenderer.invoke('mac:permissions:status'),
  macOpenPrivacyPane: (pane: 'accessibility' | 'inputMonitoring') =>
    ipcRenderer.invoke('mac:permissions:openPane', pane),
  macLoginItemStatus: () => ipcRenderer.invoke('mac:loginItem:status'),
  macLoginItemSet: (open: boolean) => ipcRenderer.invoke('mac:loginItem:set', open),
  macRevealAppBundle: () => ipcRenderer.invoke('mac:app:reveal'),

  // ---- 通用：在系统文件管理器中显示文件 ----
  revealPath: (p: string) => ipcRenderer.invoke('shell:reveal', p),

  // ---- 首次启动赞助引导（只展示一次）----
  sponsorGuideShouldShow: () => ipcRenderer.invoke('sponsor:guide:shouldShow'),
  sponsorGuideDismiss: () => ipcRenderer.invoke('sponsor:guide:dismiss'),

  // 本地 SQLite 数据库文件路径
  dbPath: () => ipcRenderer.invoke('db:path'),

  // ---- 事件订阅（主进程 → 渲染进程）----
  onMacroEvent: (cb: (channel: string, payload: unknown) => void) => {
    const listeners = EVENT_CHANNELS.map((ch) => {
      const handler = (_e: unknown, payload: unknown) => cb(ch, payload)
      ipcRenderer.on(ch, handler)
      return { ch, handler }
    })
    return () => {
      for (const l of listeners) ipcRenderer.removeListener(l.ch, l.handler)
    }
  },
}

contextBridge.exposeInMainWorld('electronAPI', api)
