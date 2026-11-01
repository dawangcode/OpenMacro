/**
 * 编译本地 fork 的 uiohook-napi 原生模块（package.json postinstall 自动执行）
 *
 * 背景：uiohook-napi 已改为 file: 依赖（指向 D:\opencode\soft\uiohook-napi-patch），
 * 本地源码无预编译产物，需要 node-gyp 编译（首次约 1-2 分钟）。
 * 源码改动（src/lib/addon.c 等）后，编译产物比源码旧 → 自动重编。
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const pkgDir = path.join(root, 'node_modules', 'uiohook-napi')

function log(msg) {
  console.log(`[rebuild-uiohook] ${msg}`)
}

function main() {
  if (!fs.existsSync(pkgDir)) return // 依赖未安装，跳过

  // binding.gyp 的 target 名是 uiohook_napi（下划线），node-gyp-build 按此名加载
  const built = path.join(pkgDir, 'build', 'Release', 'uiohook_napi.node')
  const srcC = path.join(pkgDir, 'src', 'lib', 'addon.c')

  if (
    fs.existsSync(built) &&
    fs.existsSync(srcC) &&
    fs.statSync(built).mtimeMs >= fs.statSync(srcC).mtimeMs
  ) {
    log('原生模块已是最新，跳过')
    return
  }

  log('正在编译 uiohook-napi（首次约 1-2 分钟）...')
  // node-gyp 在 pnpm 的 .pnpm/node_modules 里（非直接依赖，不在 .bin）
  const nodeGypCandidates = [
    path.join(root, 'node_modules', '.bin', 'node-gyp.cmd'),
    path.join(root, 'node_modules', '.bin', 'node-gyp'),
    path.join(root, 'node_modules', '.pnpm', 'node_modules', 'node-gyp', 'bin', 'node-gyp.js'),
  ]
  const nodeGyp = nodeGypCandidates.find((c) => fs.existsSync(c))
  if (!nodeGyp) {
    throw new Error('找不到 node-gyp（请先 pnpm install 安装依赖）')
  }
  const cmd =
    nodeGyp.endsWith('.js')
      ? `"${process.execPath}" "${nodeGyp}" configure build`
      : `"${nodeGyp}" configure build`
  execSync(cmd, { cwd: pkgDir, stdio: 'inherit' })
  log('编译完成，补丁生效')
}

try {
  main()
} catch (e) {
  console.error('[rebuild-uiohook] 编译失败：' + (e.message || e))
  const hint =
    process.platform === 'win32'
      ? '请检查 VS Build Tools（VCTools + Windows SDK）与 Python 是否安装'
      : process.platform === 'darwin'
        ? '请检查 Xcode Command Line Tools（xcode-select --install）与 Python 是否安装'
        : '请检查 build-essential 与 Python 是否安装'
  console.error(`[rebuild-uiohook] ${hint}，然后手动运行 pnpm run rebuild:uiohook`)
}
