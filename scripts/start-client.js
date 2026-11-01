#!/usr/bin/env node
/**
 * 一键启动「客户端」：按需增量构建 renderer(dist) 与 Electron 壳(out)，然后开桌面窗口。
 *
 * 判断是否需要重新构建：比较 src/、.umirc.ts、package.json、electron.vite.config.ts
 * 的最新修改时间与 dist/index.html、out/main/index.js 的时间；落后才构建，避免每次启动都全量编译。
 *
 * 用法：node scripts/start-client.js
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const NODE = process.execPath

function walkNewest(dir) {
  let t = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue // 跳过 .umi / .umi-production 等生成目录
    const p = path.join(dir, e.name)
    if (e.isDirectory()) t = Math.max(t, walkNewest(p))
    else t = Math.max(t, fs.statSync(p).mtimeMs)
  }
  return t
}

function mtime(p) {
  try {
    const s = fs.statSync(p)
    return s.isDirectory() ? walkNewest(p) : s.mtimeMs
  } catch {
    return 0
  }
}

const baseEnv = { ...process.env }
delete baseEnv.ELECTRON_RUN_AS_NODE

function run(desc, jsEntry, args) {
  console.log(`[start-client] ${desc} ...`)
  const r = spawnSync(NODE, [jsEntry, ...args], { stdio: 'inherit', env: baseEnv, cwd: root })
  if (r.status !== 0) {
    console.error(`[start-client] ${desc} 失败 (exit ${r.status})`)
    process.exit(r.status || 1)
  }
}

const srcT = Math.max(
  mtime(path.join(root, 'src')),
  mtime(path.join(root, '.umirc.ts')),
  mtime(path.join(root, 'package.json')),
  mtime(path.join(root, 'electron.vite.config.ts')),
)
const distT = mtime(path.join(root, 'dist', 'index.html'))
const outT = mtime(path.join(root, 'out', 'main', 'index.js'))

const needRenderer = !distT || srcT > distT
const needShell = !outT || srcT > outT

if (needRenderer) {
  run('构建渲染层 (Umi -> dist/)', path.join(root, 'node_modules/@umijs/max/bin/max.js'), ['build'])
} else {
  console.log('[start-client] 渲染层无需重建（dist/ 为最新）')
}

if (needShell) {
  run('构建 Electron 壳 (main/preload -> out/)', path.join(root, 'node_modules/electron-vite/bin/electron-vite.js'), ['build'])
} else {
  console.log('[start-client] Electron 壳无需重建（out/ 为最新）')
}

console.log('[start-client] 启动客户端窗口 ...')
const r = spawnSync(NODE, [path.join(root, 'scripts/launch-client.js')], { stdio: 'inherit', env: baseEnv, cwd: root })
process.exit(r.status == null ? 0 : r.status)
