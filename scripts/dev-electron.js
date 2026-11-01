#!/usr/bin/env node
/**
 * 套壳开发模式（scripts/dev-electron.js）
 *
 * 与 start（生产形态，构建 dist 后用内置 HTTP 托管、加载构建产物）的区别：
 *   本脚本【不设】OPENMACRO_SERVE_DIST，让主进程走 dev 分支 → Electron 直接加载
 *   http://localhost:8000 的 Umi dev server，从而保留 HMR（改页面即时生效）。
 *
 * 流程：
 *   1) 轮询等待 Umi dev server(8000) 就绪（不依赖 wait-on，避免 localhost 解析到 IPv6 或 HEAD 探测不到）
 *   2) 校验/构建 Electron 壳 out/（main/preload，CJS 产物）
 *   3) 用与 launch-client.js 同款的运行时解析拉起 Electron 窗口（支持工作区外运行时兜底）
 *
 * 用法：node scripts/dev-electron.js
 *   环境变量：
 *     UMI_DEV_PORT=8000            Umi dev server 端口，需与 .umirc.ts 的 vite.server.port 一致
 *     OPENMACRO_OPEN_DEVTOOLS=1    默认开 DevTools（置 0 关闭）
 *     OPENMACRO_NO_SANDBOX=1       追加 --no-sandbox（受限令牌环境需要）
 *     ELECTRON_EXTERNAL_RUNTIME    工作区外 electron 运行时目录（受限目录 electron.exe 段错误时兜底）
 *     ELECTRON_OVERRIDE_DIST_PATH  直接指定 electron 运行时目录
 */
const fs = require('fs')
const path = require('path')
const http = require('http')
const { spawn, spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const NODE = process.execPath
const PORT = Number(process.env.UMI_DEV_PORT || 8000)
const EXTERNAL_RUNTIME = process.env.ELECTRON_EXTERNAL_RUNTIME || ''
// dev-umi.js 会把 max dev 实际监听端口写入该文件（优先于探测，避免误判同端口其他服务）
const PORT_FILE = path.join(root, '.umi-dev-port')

// ---------- 等待 Umi dev server 就绪 ----------
// 兜底探测：校验是 Web 应用 dev server（200 且返回 HTML 文档）。
// 注意：Umi Vite 模式下不带 Accept: text/html 会返回 404，必须带该头
function probe(host, port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host, port, path: '/', timeout: 2000, headers: { Accept: 'text/html' } },
      (res) => {
        let body = ''
        res.on('data', (c) => { body += c })
        res.on('end', () =>
          resolve(res.statusCode === 200 && /<!doctype html|<html[\s>]/i.test(body)))
        res.on('error', () => resolve(false))
      })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

// 读取 dev-umi.js 写的端口文件；文件不存在返回 null。
// 关键：只接受本进程启动之后写入的文件（按 mtime 判断）——
// 否则会抢在 dev-umi 删除旧文件之前读到上一次运行的陈旧端口（如上次跑 8000、本次应跑 8001）
const STARTED_AT = Date.now()
function readPortFile() {
  try {
    const st = fs.statSync(PORT_FILE)
    if (st.mtimeMs < STARTED_AT) return null
    const p = fs.readFileSync(PORT_FILE, 'utf8').trim()
    return /^\d+$/.test(p) ? Number(p) : null
  } catch {
    return null
  }
}

// 主路径：等 dev-umi.js 写入端口文件（端口来自 Umi 自身输出，最可靠）。
// 兜底：端口文件一直不出现（如单独手跑 max dev 时）再退化为探测 PORT..PORT+10。
async function waitForDevServer(timeoutMs = 300000) {
  const start = Date.now()
  const deadline = start + timeoutMs
  let tried = 0
  while (Date.now() < deadline) {
    tried += 1
    const p = readPortFile()
    if (p) {
      console.log(`[dev-electron] Umi dev server 就绪: http://localhost:${p}（来自端口文件）`)
      return p
    }
    if (tried % 10 === 0) console.log('[dev-electron] 等待 Umi dev server 端口 ...')
    await new Promise((r) => setTimeout(r, 800))
    // 25 秒后端口文件仍未出现，转入探测兜底（兼容单独运行 max dev 的场景）
    if (tried === 31) {
      console.log('[dev-electron] 端口文件未出现，转入探测兜底 ...')
      while (Date.now() < deadline) {
        for (let port = PORT; port <= PORT + 10; port++) {
          if (await probe('127.0.0.1', port)) {
            console.log(`[dev-electron] Umi dev server 就绪: http://localhost:${port}（探测兜底）`)
            return port
          }
        }
        await new Promise((r) => setTimeout(r, 800))
      }
    }
  }
  return null
}

// ---------- 构建/校验 Electron 壳 ----------
// 开发模式下主进程没有 HMR：渲染层（Umi dev server）改动可热更，但 main/preload 是独立 Node 进程，
// 加载编译产物 out/main/index.js，必须重建才会生效。因此这里【每次都重建】，避免「改了 src/main
// 却跑的还是旧的 out/」被误判为「硬件代码有缓存」（用户曾因此以为防抖没生效）。
// 想跳过构建加速启动可设 OPENMACRO_SKIP_SHELL_BUILD=1（需 out/ 已存在）。
function run(desc, jsEntry, args) {
  console.log(`[dev-electron] ${desc} ...`)
  const r = spawnSync(NODE, [jsEntry, ...args], { stdio: 'inherit', cwd: root })
  if (r.status !== 0) {
    console.error(`[dev-electron] ${desc} 失败 (exit ${r.status})`)
    process.exit(r.status || 1)
  }
}

function ensureShellBuilt() {
  const mainEntry = path.join(root, 'out', 'main', 'index.js')
  const preloadEntry = path.join(root, 'out', 'preload', 'index.cjs')
  const skip = process.env.OPENMACRO_SKIP_SHELL_BUILD === '1'
  if (skip && fs.existsSync(mainEntry) && fs.existsSync(preloadEntry)) {
    console.log('[dev-electron] 跳过 Electron 壳构建（OPENMACRO_SKIP_SHELL_BUILD=1 且 out/ 已存在）')
    return
  }
  run(
    '构建 Electron 壳 (main/preload -> out/)',
    path.join(root, 'node_modules/electron-vite/bin/electron-vite.js'),
    ['build'],
  )
}

// ---------- 解析 electron 可执行文件 ----------
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
  // 2) 工作区外运行时（受限目录内 electron 段错误的兜底）
  if (EXTERNAL_RUNTIME) {
    const extBin = runtimeBin(EXTERNAL_RUNTIME)
    if (extBin) {
      process.env.ELECTRON_OVERRIDE_DIST_PATH = EXTERNAL_RUNTIME
      return extBin
    }
  }
  // 3) 回退：项目自带 node_modules/electron
  try {
    const p = require('electron') // 普通 node 进程中导出 electron 可执行文件绝对路径
    if (typeof p === 'string' && fs.existsSync(p)) return p
  } catch {
    /* ignore */
  }
  return null
}

async function main() {
  const devPort = await waitForDevServer()
  if (!devPort) {
    console.error(`[dev-electron] 等待 Umi dev server :${PORT}..${PORT + 10} 超时，请确认 'max dev' 已启动`)
    process.exit(1)
  }

  ensureShellBuilt()

  const binary = resolveElectronBinary()
  if (!binary) {
    console.error('[dev-electron] 找不到 Electron 可执行文件（外部运行时与 node_modules/electron 均不可用）')
    process.exit(1)
  }

  const env = { ...process.env }
  // 关键：不设 OPENMACRO_SERVE_DIST → 主进程走 dev 分支，加载探测到的 dev server 地址（保留 HMR）
  delete env.OPENMACRO_SERVE_DIST
  // 让 Electron 以真实窗口模式启动（否则退化为纯 Node 进程）
  delete env.ELECTRON_RUN_AS_NODE
  // 套壳开发默认开 DevTools（置 0 关闭）
  env.OPENMACRO_OPEN_DEVTOOLS = process.env.OPENMACRO_OPEN_DEVTOOLS || '1'
  // 把探测到的实际端口传给主进程（8000 被占用时 Umi 会落到 8001 等）
  env.OPENMACRO_DEV_URL = `http://localhost:${devPort}`

  const args = []
  if (process.env.OPENMACRO_NO_SANDBOX) args.push('--no-sandbox')
  args.push(root) // Electron 加载该目录 package.json -> main: out/main/index.js

  console.log('[dev-electron] electron:', binary)
  console.log(`[dev-electron] dev 模式：加载 http://localhost:${devPort}（HMR 生效，DevTools=${env.OPENMACRO_OPEN_DEVTOOLS}）`)

  const child = spawn(binary, args, { stdio: 'inherit', windowsHide: false, env })

  child.on('error', (err) => {
    console.error('[dev-electron] 启动失败:', err.message)
    process.exit(1)
  })
  child.on('close', (code, signal) => {
    if (signal) {
      console.error('[dev-electron] Electron 被信号终止:', signal)
      process.exit(1)
    }
    process.exit(code == null ? 0 : code)
  })
}

main()
