#!/usr/bin/env node
/**
 * 客户端启动器：以「生产形态」拉起 Electron 桌面窗口。
 *
 * 与 `dev`（纯浏览器 Umi dev server）/ `dev:app`（Umi dev server + Electron 窗口）不同：
 *   本脚本让 Electron 主进程用内置静态 HTTP 服务托管已构建好的 dist/，
 *   直接开一个真正的客户端窗口，不启动 web 服务器、不自动开浏览器。
 *
 * 环境兼容：本机工作区内的 electron.exe 一启动就段错误，必须用工作区外的运行时，
 * 通过 ELECTRON_OVERRIDE_DIST_PATH 指向它。换到没有该限制的机器时自动回退到项目自带的 node_modules/electron。
 *
 * 用法：node scripts/launch-client.js
 *   可选环境变量：
 *     OPENMACRO_SERVE_DIST=1     主进程据此内置 HTTP 托管 dist（本脚本自动注入；名字需与主进程约定一致）
 *     OPENMACRO_NO_SANDBOX=1     追加 --no-sandbox（受限令牌/CI 环境需要；普通桌面一般不需要）
 *     ELECTRON_EXTERNAL_RUNTIME  工作区外 electron 运行时目录（默认空 = 直接用 node_modules/electron）
 *     ELECTRON_OVERRIDE_DIST_PATH  直接指定 electron 运行时目录
 * OPENMACRO_* 前缀环境变量名与主进程 src/main/index.ts 保持同一套。
 */
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const root = path.resolve(__dirname, '..')

// 工作区外 Electron 运行时路径（受限令牌下工作区内 electron.exe 段错误的兜底）。
// 用环境变量 ELECTRON_EXTERNAL_RUNTIME 覆盖；留空则自动回退 node_modules/electron。
const EXTERNAL_RUNTIME = process.env.ELECTRON_EXTERNAL_RUNTIME || ''

// 跨平台解析 electron 可执行文件（与 dev-electron.js 同款）
function runtimeBin(dir) {
  // Windows: <dir>/electron.exe；macOS: <dir>/Electron.app/Contents/MacOS/Electron；Linux: <dir>/electron
  const candidates = process.platform === 'darwin'
    ? [path.join(dir, 'Electron.app', 'Contents', 'MacOS', 'Electron'), path.join(dir, 'Electron')]
    : process.platform === 'win32'
      ? [path.join(dir, 'electron.exe')]
      : [path.join(dir, 'electron')]
  return candidates.find((p) => fs.existsSync(p)) || null
}

function resolveElectronBinary() {
  // 1) 显式指定的运行时
  const override = process.env.ELECTRON_OVERRIDE_DIST_PATH
  if (override) {
    const bin = runtimeBin(override)
    if (bin) return bin
  }
  // 2) 工作区外运行时（仅当配置了 ELECTRON_EXTERNAL_RUNTIME 时）
  if (EXTERNAL_RUNTIME) {
    const extBin = runtimeBin(EXTERNAL_RUNTIME)
    if (extBin) {
      process.env.ELECTRON_OVERRIDE_DIST_PATH = EXTERNAL_RUNTIME
      return extBin
    }
  }
  // 3) 回退：项目自带 node_modules/electron（无该限制的机器）
  try {
    const p = require('electron') // 在普通 node 进程中导出 electron 可执行文件路径
    if (typeof p === 'string' && fs.existsSync(p)) return p
  } catch {
    /* ignore */
  }
  return null
}

function main() {
  // 构建产物检查：dist（renderer）与 out（main/preload）必须存在
  const distIndex = path.join(root, 'dist', 'index.html')
  const mainEntry = path.join(root, 'out', 'main', 'index.js')
  if (!fs.existsSync(distIndex) || !fs.existsSync(mainEntry)) {
    console.error('[launch-client] 缺少构建产物，请先运行构建：')
    console.error('   pnpm run build   （max build -> dist/ + electron-vite build -> out/）')
    process.exit(1)
  }

  const binary = resolveElectronBinary()
  if (!binary) {
    console.error('[launch-client] 找不到 Electron 可执行文件（外部运行时与 node_modules/electron 均不可用）')
    process.exit(1)
  }

  const env = { ...process.env, OPENMACRO_SERVE_DIST: '1' }
  // 让 Electron 以真实窗口模式启动（去掉这个变量，否则会退化成纯 Node 进程）
  delete env.ELECTRON_RUN_AS_NODE

  const args = []
  if (process.env.OPENMACRO_NO_SANDBOX) args.push('--no-sandbox')
  args.push(root) // Electron 加载该目录的 package.json -> main: out/main/index.js

  console.log('[launch-client] electron:', binary)
  console.log('[launch-client] app dir :', root, '(OPENMACRO_SERVE_DIST=1, 内置 HTTP 托管 dist/)')

  const child = spawn(binary, args, { stdio: 'inherit', windowsHide: false, env })

  // 自检钩子：仅当显式设置 OPENMACRO_SELFTEST_MS 时，N 毫秒后自动关闭（用于无人值守冒烟测试）
  const selftest = Number(process.env.OPENMACRO_SELFTEST_MS || 0)
  if (selftest > 0) {
    setTimeout(() => {
      console.log(`[launch-client] selftest: ${selftest}ms 后关闭窗口`)
      child.kill()
      // 兜底：若 Electron 未响应 kill，1.5s 后强制退出冒烟测试进程
      setTimeout(() => process.exit(0), 1500)
    }, selftest)
  }

  child.on('error', (err) => {
    console.error('[launch-client] 启动失败:', err.message)
    process.exit(1)
  })
  child.on('close', (code, signal) => {
    if (signal) {
      console.error('[launch-client] Electron 被信号终止:', signal)
      process.exit(1)
    }
    process.exit(code == null ? 0 : code)
  })
}

main()
