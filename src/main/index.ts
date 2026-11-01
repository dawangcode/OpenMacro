// 客户端软件主进程入口（src/main/index.ts）
// 职责：单实例、创建窗口、安全配置、IPC 注册、外部链接处理
//
// 加载逻辑（renderer 由 Umi 产出 dist/）：
//   dev   → max dev 的 Umi dev server（默认 http://localhost:8000）
//   serve → 内置静态 HTTP 服务托管 dist/，再 loadURL http://127.0.0.1:<port>/
//           （app.isPackaged 或 OPENMACRO_SERVE_DIST=1 时触发）
import { app, BrowserWindow, dialog, Menu, nativeImage, shell, Tray } from 'electron'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { registerIpcHandlers } from './ipc'
import { migrateLegacyStorage } from './migrate'
import { migrateStoredMacrosToKey } from './macro-store'
import { revealWindow } from './window-utils'
import { shutdownHook } from './hook'
import { stopAll } from './player'

// 受限令牌下 Chromium 子进程崩，需要 --no-sandbox 才能完整开窗（普通桌面环境不需要）
if (process.env.OPENMACRO_NO_SANDBOX) {
  app.commandLine.appendSwitch('no-sandbox')
}

// Windows 白屏（必现）：窗口 hide 后 Chromium 的原生窗口遮挡计算把它判为「不可见」，
// 停止出帧；从托盘唤回时合成器不恢复 → 只剩窗口框架、内容全白。
// invalidation / backgroundThrottling 都救不了，必须关掉这个特征开关。
// 代价：窗口被遮挡时不再省 GPU（本应用界面轻，可接受）。
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

// 排查用：上一步仍白屏时，设 OPENMACRO_DISABLE_GPU=1 重启验证是否为 GPU 合成问题
// （走软件渲染兜底，能定位但不建议长期开：无硬件加速时大数据量列表会掉帧）
if (process.env.OPENMACRO_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration()
}

// 单实例：已运行时聚焦旧窗口，不新开。
// 例外：--elevated-handover 是提权交接标记（见 admin-autostart.ts）——任务拉起的提权新实例
// 抢不到锁时短暂重试，旧实例收到带该标记的 second-instance 后退出让锁。
const HANDOVER_FLAG = '--elevated-handover'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
/** 真正退出中（before-quit 已触发）：此状态下不再拦截 close，放行窗口关闭让进程退干净 */
let quitting = false

/** 从托盘 / 二次启动唤回窗口：隐藏与最小化两种状态都要能恢复，且恢复后必须可点击（见 window-utils.ts） */
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    void createWindow()
    return
  }
  revealWindow(mainWindow)
}

function resolveTrayIcon(): Electron.NativeImage {
  // 打包后 resources/ 不在 asar 里（见 electron-builder.yml extraResources），统一按 resourcesPath 取
  const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, '../../resources')
  const src = process.platform === 'win32' ? path.join(base, 'icon.ico') : path.join(base, 'icon.png')
  const img = nativeImage.createFromPath(fs.existsSync(src) ? src : DEV_ICON)
  if (img.isEmpty()) return img
  // .ico 自带多尺寸档，交给系统挑；png 需要缩到菜单栏 / 托盘的常规尺寸
  return process.platform === 'win32' ? img : img.resize({ width: 18, height: 18 })
}

function createTray(): void {
  if (tray) return
  try {
    tray = new Tray(resolveTrayIcon())
  } catch (e) {
    // 托盘创建失败不阻塞主流程（无托盘的桌面环境下窗口仍可用）
    console.error('[tray] 托盘创建失败：', e)
    return
  }
  tray.setToolTip('OpenMacro')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主界面', click: () => showMainWindow() },
      { type: 'separator' },
      { label: '退出 OpenMacro', click: () => app.quit() },
    ]),
  )
  // Windows / Linux 习惯单击唤回；macOS 单击由系统展开菜单，不额外接管
  if (process.platform !== 'darwin') tray.on('click', () => showMainWindow())
}

/** handover=true 时才允许重试抢锁：普通二次启动必须立即静默退出，不能弹框也不能卡住 */
async function acquireSingleInstanceLock(handover: boolean): Promise<boolean> {
  // 首次尝试保持同步（趁模块加载尽早拿锁）；只有交接重试才进入异步
  if (app.requestSingleInstanceLock()) return true
  if (!handover) return false
  // 最多等 8 秒：正常情况下旧实例收到交接信号后几百毫秒内就退出让锁
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300))
    if (app.requestSingleInstanceLock()) return true
  }
  return false
}

app.on('second-instance', (_e, argv) => {
  if (argv.includes(HANDOVER_FLAG)) {
    // 提权新实例已就绪：让出单实例锁，由它接管
    app.exit(0)
    return
  }
  // 常规二次启动：聚焦已有窗口（可能正隐藏在托盘里）
  showMainWindow()
})

// 开发态窗口 / 任务栏图标：打包后由 electron-builder 把 resources/icon.ico 嵌进 exe，
// 运行时不再依赖该路径（resources/ 是 buildResources，不在 files 白名单里，打包产物中没有它）
// Windows 用 .ico：系统会取其中 16/20/24/32 的原生档，标题栏小图标不会由 512px 缩放发虚。
// macOS 用带 9% 透明边距的 icon-dock.png：原 icon.png 是四边 0% 留白的全幅美术图，
// 直接进 Dock 会比正常 app 图标大一圈（实测正常观感为 81% 占比 / 9% 边距，
// 见 scripts/gen-icons.js，换 logo 后重跑它即可）；
// 文件缺失（未跑生成脚本）时回退 icon.png。
const DEV_ICON = (() => {
  const res = path.join(__dirname, '../../resources')
  if (process.platform === 'win32') return path.join(res, 'icon.ico')
  const dock = path.join(res, 'icon-dock.png')
  return fs.existsSync(dock) ? dock : path.join(res, 'icon.png')
})()

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

// 内置静态服务器：托管 dist/（MIME 映射 + SPA 回退 index.html）
function startStaticServer(rootDir: string): Promise<number> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
      const filePath = path.join(rootDir, urlPath === '/' ? '/index.html' : urlPath)
      if (!filePath.startsWith(rootDir)) {
        res.statusCode = 403
        res.end('forbidden')
        return
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          // SPA 回退
          fs.readFile(path.join(rootDir, 'index.html'), (e2, d2) => {
            if (e2) {
              res.statusCode = 404
              res.end('404')
            } else {
              res.setHeader('Content-Type', MIME['.html'])
              res.end(d2)
            }
          })
          return
        }
        res.setHeader('Content-Type', MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream')
        res.end(data)
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      resolve(typeof addr === 'object' && addr ? addr.port : 0)
    })
  })
}

async function createWindow() {
  // macOS dev 态：跑的是 node_modules/electron/dist/Electron.app，Dock 图标是 Electron 默认的
  // 原子 logo；用 app.dock.setIcon 覆盖成项目闪电 logo。打包态 .app 自带正确 icon，不需要这一步。
  if (!app.isPackaged && process.platform === 'darwin' && app.dock?.setIcon) {
    try {
      const img = nativeImage.createFromPath(DEV_ICON)
      if (!img.isEmpty()) app.dock.setIcon(img)
    } catch {
      // 图标覆盖失败不影响主流程（dev 便利功能，非关键路径）
    }
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    // Windows 标题栏 / 任务栏图标（macOS 由 .icns 决定，此项会被忽略）
    icon: fs.existsSync(DEV_ICON) ? DEV_ICON : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true, // 安全硬规则，禁止关闭
      nodeIntegration: false, // 安全硬规则，禁止关闭
      sandbox: true,
      // 托盘常驻应用：窗口隐藏后渲染不能停。默认 true 会节流定时器 / rAF，
      // 从托盘唤回时偶发整窗白屏（配 window-utils.ts 的 invalidate() 双保险）。
      // 代价：隐藏期间仍有少量渲染开销，本应用界面轻，可接受。
      backgroundThrottling: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    // 启动首帧可能落在系统会话初始化期：显式重绘一帧，避免「框架显示、内容空白」的僵尸窗
    // （与 revealWindow 同一道保险，见 window-utils.ts）
    try {
      mainWindow?.webContents.invalidate()
    } catch {
      /* webContents 已销毁时忽略 */
    }
    mainWindow?.show()
  })

  // 最小化到托盘：隐藏窗口而不是留在任务栏，宏 / 热键仍在主进程后台运行；
  // 从托盘「显示主界面」或再次启动程序唤回。（Electron 的 minimize 事件不带 event，无法 preventDefault）
  // 先 restore 再 hide：Windows 上「最小化态被隐藏」的窗口，之后 show() 会得到看得见但
  // 点不中的僵尸窗（Electron #19777 / #38246）——从源头消灭该组合态。
  // ⚠ 必须跨事件循环异步做，两层都不能省：
  //   1) minimize 事件里同步 restore() 往往不生效（系统还在做最小化动画），
  //      于是 hide() 打在仍是最小化态的窗口上，组合态照样出现；
  //   2) restore() 本身也异步生效，需等一个 tick 确认 isMinimized() 为 false 再 hide；
  //   3) 若确实退不出最小化态，就放弃隐藏（留在任务栏），宁可降级也不要僵尸 / 白屏。
  mainWindow.on('minimize', () => {
    setTimeout(() => {
      const win = mainWindow
      if (!win || win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      setTimeout(() => {
        const w = mainWindow
        if (!w || w.isDestroyed()) return
        if (w.isMinimized()) return // 仍在最小化态：不藏，避免组合态
        w.hide()
      }, 0)
    }, 0)
  })

  // 关闭（标题栏 X）同样收托盘，不退出：宏 / 热键常驻后台，退出统一走托盘菜单。
  // 必须配 quitting 标志——否则托盘「退出」时 close 再次被拦，进程永远退不干净。
  mainWindow.on('close', (e) => {
    const win = mainWindow
    if (quitting || !win || win.isDestroyed()) return
    e.preventDefault()
    win.hide()
  })

  // 外部链接一律系统浏览器打开，禁止 window.open
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const serveDist = app.isPackaged || process.env.OPENMACRO_SERVE_DIST === '1'
  if (serveDist) {
    // out/main → out → 工程根，Umi 产物在根目录 dist/
    const distDir = path.join(__dirname, '../../dist')
    const port = await startStaticServer(distDir)
    const url = `http://127.0.0.1:${port}/`
    // 打包态也要兜底首帧加载失败：登录自启时系统会话仍在初始化、资源争抢，
    // loadURL 偶发失败若不带重试，窗口框架已出、内容却永久空白（「只有壳」）。
    // 与 dev 模式对齐，失败 1s 后重试，避免白屏卡死。
    mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
      console.error(`[main] 加载本地页面失败 (${errorCode} ${errorDescription})，1s 后重试`)
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        mainWindow.loadURL(url)
      }, 1000)
    })
    mainWindow.loadURL(url)
  } else {
    // dev-electron.js 会传探测到的实际端口（8000 被占用时 Umi 自动 +1）；未传则回退默认 8000
    const devUrl = process.env.OPENMACRO_DEV_URL || 'http://localhost:8000'
    // Chromium 会把 validatedURL 规范化为带尾斜杠（…:8000/），与 devUrl 直接比较恒不相等，
    // 重试逻辑会静默失效，故两边都用 URL 规范化后比较
    const normalizeUrl = (u: string): string => {
      try {
        return new URL(u).href
      } catch {
        return u
      }
    }
    const devTarget = normalizeUrl(devUrl)
    // dev server 可能尚未就绪：加载失败时重试，避免白屏退出
    mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
      if (normalizeUrl(validatedURL) !== devTarget) return
      console.error(`[main] 加载 ${devUrl} 失败 (${errorCode} ${errorDescription})，1s 后重试`)
      setTimeout(() => mainWindow?.loadURL(devUrl), 1000)
    })
    mainWindow.loadURL(devUrl)
    // 套壳开发模式（scripts/dev-electron.js）：默认开 DevTools，OPENMACRO_OPEN_DEVTOOLS=0 关闭
    if (process.env.OPENMACRO_OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  }

  registerIpcHandlers(mainWindow)
}

void (async () => {
  const handover = process.argv.includes(HANDOVER_FLAG)
  const locked = await acquireSingleInstanceLock(handover)
  if (!locked) {
    // 只有提权交接超时才弹框（旧实例没让锁，用户需要知道自己手动关一下）；
    // 普通二次启动一律静默退出，由已运行实例聚焦窗口，不能弹出误导性错误框
    if (handover) {
      dialog.showErrorBox(
        'OpenMacro',
        '已有 OpenMacro 实例正在运行，且提权交接超时（旧实例未退出）。\n请手动关闭已打开的 OpenMacro 后重试。',
      )
    }
    app.quit()
    process.exit(0)
    return
  }
  await app.whenReady()
  try {
    migrateLegacyStorage()
    migrateStoredMacrosToKey()
  } catch (e) {
    console.error('[storage] 存储初始化失败：', e)
  }
  createWindow()
  createTray()
})()

app.on('before-quit', () => {
  // 标记退出中：close 拦截器放行，窗口可被真正关闭，进程退干净
  quitting = true
  // 退出前先卸干净原生层，否则 macOS 会把进程终止判定为「意外退出」并弹系统崩溃报告框：
  //   1) 全局钩子：订阅方不会退订，uiohook 原生线程带着已安装的事件钩子被进程退出杀掉（主因）；
  //   2) 宏回放：nut-js 注入进行到一半时退出，注入线程与进程终止竞争同样会崩。
  // 两步都幂等且尽力而为，失败不阻塞退出。
  try {
    shutdownHook()
  } catch (e) {
    console.error('[main] 退出前卸载输入钩子失败：', e)
  }
  try {
    stopAll()
  } catch (e) {
    console.error('[main] 退出前停止宏回放失败：', e)
  }
})

app.on('window-all-closed', () => {
  // 注意用 process.platform：新版 electron 类型里 App 已无 platform 属性
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  // 窗口被关闭或隐藏在托盘时，点击 Dock 图标都要回到主界面
  showMainWindow()
})
