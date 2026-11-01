#!/usr/bin/env node
/**
 * Umi dev server 启动包装（scripts/dev-umi.js）
 *
 * 作用：启动 max dev，并从其输出中解析实际监听端口（8000 被占用时 Umi 会落到 8001），
 * 写入工程根的 .umi-dev-port 文件，供 scripts/dev-electron.js 读取。
 * 相比轮询探测，端口来自 Umi 自身输出，不会被同端口其他服务误判。
 *
 * 退出时清理端口文件。
 */
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const root = path.resolve(__dirname, '..')
const NODE = process.execPath
const portFile = path.join(root, '.umi-dev-port')

// 清理上一次运行的残留端口文件，避免读到旧值
try { fs.unlinkSync(portFile) } catch { /* ignore */ }

// 注意：不要 spawn node_modules/.bin/max.cmd——Node 18.20/20.12/22+ 起 Windows 上
// 直接 spawn .cmd 会报 EINVAL（CVE-2024-27980 修复），必须经 node 执行入口 JS
// （与 scripts/start-client.js 同款做法）
const maxEntry = path.join(root, 'node_modules', '@umijs', 'max', 'bin', 'max.js')
if (!fs.existsSync(maxEntry)) {
  console.error('[dev-umi] 找不到 Umi 入口：', maxEntry, '（请先 pnpm install）')
  process.exit(1)
}

const child = spawn(NODE, [maxEntry, 'dev'], { cwd: root, stdio: ['inherit', 'pipe', 'pipe'] })

let portFound = false

function pipe(stream) {
  stream.setEncoding('utf8')
  let buf = ''
  stream.on('data', (chunk) => {
    buf += chunk
    process.stdout.write(chunk)
    if (portFound) return
    // 去掉 ANSI 颜色码再匹配（TTY 下 umi 会把 URL 染绿，直接匹配会失配）
    const clean = buf.replace(/\x1b\[[0-9;]*m/g, '')
    // 只认 "App listening at" 里的 Local: 行，避免误抓代理行
    // （[HPM] Proxy created: /api -> http://localhost:8080 会先于监听地址输出）
    const m = clean.match(/Local:\s*https?:\/\/localhost:(\d+)/)
    if (m) {
      portFound = true
      fs.writeFileSync(portFile, m[1])
    }
  })
}

pipe(child.stdout)
pipe(child.stderr)

child.on('error', (err) => {
  console.error('[dev-umi] 启动 max dev 失败:', err.message)
  process.exit(1)
})

child.on('exit', (code) => {
  try { fs.unlinkSync(portFile) } catch { /* ignore */ }
  process.exit(code == null ? 0 : code)
})
