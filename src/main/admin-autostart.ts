// 运行权限自举（src/main/admin-autostart.ts）
// 目的：不必每次右键「以管理员身份运行」，也能让 OpenMacro 以 High IL 跑起来。
//
// 两条链路：
//   1. 开机自启 → 计划任务（登录时触发 + 以最高权限运行），起来即管理员，且无 UAC 弹窗；
//   2. 手动切换 → 触发该计划任务后退出当前实例，由任务拉起提权后的新实例。
//
// 硬约束（都写进注释，避免后人踩回去）：
//   · 创建 / 删除 High 权限任务需要管理员令牌；未提权时用 Start-Process -Verb RunAs 提一次权——
//     这一步是 Windows 底线（开通 / 关闭各一次），不该也没必要绕。
//   · 单实例锁的交接用「握手」而不是「先退后拉」：任务拉起的提权新实例带 --elevated-handover
//     标记，抢锁失败时短暂重试；旧实例收到带标记的 second-instance 后退出让锁。
//     曾经用过「派一个脱离本进程的延时 PowerShell 再退出」——Electron（Chromium）退出时会把
//     派生的子进程一起清掉，延时触发根本不会执行，表现就是「点了重启、程序没再起来」。
//   · 查询任务定义一律用 /xml（唯一稳定的机读格式）；不要解析 /fo LIST 的文本，
//     字段名随系统语言变（中文环境是「任务名:」），一改语言就失效。
import { app } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import type { AdminAutostartResult, AdminAutostartStatus } from '../types/admin-autostart'

/** 计划任务名：不含空格 / 特殊字符，避免 schtasks 参数歧义 */
const TASK_NAME = 'OpenMacroAdminAutostart'
/** 提权交接标记：任务以该参数拉起新实例，旧实例凭它识别「该让锁了」（见 index.ts） */
const HANDOVER_FLAG = '--elevated-handover'
/** Windows 完整性级别 SID：High mandatory level（管理员令牌才有） */
const SID_IL_HIGH = 'S-1-16-12288'
const PS_EXE = 'powershell.exe'
/** UAC 未被授权时 PowerShell 的报错特征（中英文措辞都要兜住） */
const UAC_CANCEL_PATTERN = /canceled by the user|已被用户取消/i

interface CmdOk {
  ok: true
  stdout: string
  stderr: string
}
interface CmdFail {
  ok: false
  stdout: string
  stderr: string
  message: string
}
type CmdResult = CmdOk | CmdFail

interface TaskInfo {
  exists: boolean
  command: string
  /** 任务 XML 的 <Arguments>（schtasks 会把 /tr 里 exe 之后的参数拆到这里） */
  args: string
  runLevel: string
}

interface RunOutcome {
  ok: boolean
  stdout: string
  stderr: string
  canceled: boolean
  reason?: string
}

function isWin32(): boolean {
  return process.platform === 'win32'
}

/**
 * Windows 控制台程序（schtasks / powershell / whoami）在中文系统上输出 GBK，
 * 按 utf8 硬解会得到乱码，错误提示不可读。这里先拿 buffer：
 * 尝试严格 UTF-8 解码，失败（存在非法序列）则回退 GBK。
 * Electron 主进程 Node 自带 full-ICU，TextDecoder 支持 gbk。
 */
function decodeWinOutput(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    try {
      return new TextDecoder('gbk').decode(buf)
    } catch {
      return buf.toString('utf8')
    }
  }
}

/** 统一以「不抛异常」的方式执行外部命令：失败信息交给 UI 展示，不让主进程崩 */
function execWin(file: string, args: string[], timeoutMs: number): Promise<CmdResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { encoding: 'buffer', windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = decodeWinOutput(stdout as Buffer)
        const errText = decodeWinOutput(stderr as Buffer)
        if (err) {
          const e = err as Error & { stdout?: unknown; stderr?: unknown }
          resolve({
            ok: false,
            stdout: out,
            stderr: errText,
            message: e.message ?? String(err),
          })
          return
        }
        resolve({ ok: true, stdout: out, stderr: errText })
      },
    )
  })
}

/**
 * 取最有信息量的一行做用户提示（命令行输出常常是多行，整段塞进 UI 不可读）。
 * execFile 失败时 err.message 以「Command failed: <完整命令行>」开头，命令文本里的
 * Write-Error / Start-Process 等会命中 error 关键词、把真实报错顶掉——先剔除回显行。
 */
const ECHO_PATTERN = /Start-Process|ArgumentList|Write-Error|WindowStyle|\$p\b|Command failed/i

function brief(text: string, fallback: string): string {
  const lines = text
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !ECHO_PATTERN.test(l))
  const line = lines.find((l) => /错误|error|拒绝|cannot|无法|denied|找不到/i.test(l))
  const picked = line || lines.pop() || fallback
  return picked.length > 160 ? `${picked.slice(0, 160)}…` : picked
}

/** 去掉任务 XML <Command> 原样带回的外层双引号（展示与比对都不该有引号） */
function unquote(s: string): string {
  const m = s.match(/^"(.*)"$/)
  return m ? m[1].trim() : s
}

/** 任务 Command 登记的是「"exe" 参数」整体，先取出 exe 段再做路径比对 */
function exePartOfTaskCommand(cmd: string): string {
  const quoted = cmd.trim().match(/^"([^"]+)"/)
  if (quoted) return quoted[1].trim()
  return cmd.trim().split(/\s+/)[0] ?? ''
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()
  const na = norm(a)
  const nb = norm(b)
  return !!na && !!nb && na === nb
}

let elevationCache: boolean | null = null

/** 当前实例是否已提权：进程令牌里有没有 High 完整性级别 SID */
export function isElevated(): boolean {
  if (!isWin32()) return false
  // 提权状态在一次会话内不变，缓存避免每次进设置页都派生一次 whoami
  if (elevationCache !== null) return elevationCache
  try {
    const out = execFileSync('whoami', ['/groups'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000,
    })
    elevationCache = String(out).includes(SID_IL_HIGH)
  } catch {
    elevationCache = false
  }
  return elevationCache
}

/** 读任务定义；任务不存在时 schtasks 以非 0 退出，按不存在处理 */
async function queryTask(): Promise<TaskInfo> {
  const empty: TaskInfo = { exists: false, command: '', args: '', runLevel: '' }
  if (!isWin32()) return empty
  const r = await execWin('schtasks', ['/query', '/tn', TASK_NAME, '/xml'], 10000)
  if (!r.ok) return empty
  // 任务 XML 里程序与参数是分开的两个节点：/tr '"exe" --flag' 会被拆成
  // <Command>exe</Command> + <Arguments>--flag</Arguments>，只读 Command 会漏掉交接标记。
  // 注意 <Command> 可能原样带着创建时的引号（如 "D:\a b\OpenMacro.exe"），
  // 这里统一剥掉：展示（设置页「自启路径」）与比对都不该出现双引号。
  const cmd = r.stdout.match(/<Command>([^<]*)<\/Command>/)
  const arg = r.stdout.match(/<Arguments>([^<]*)<\/Arguments>/)
  const lvl = r.stdout.match(/<RunLevel>([^<]*)<\/RunLevel>/)
  const command = cmd ? unquote(cmd[1].trim()) : ''
  return {
    exists: !!cmd,
    command,
    args: arg ? arg[1].trim() : '',
    runLevel: lvl ? lvl[1].trim() : '',
  }
}

/** 当前实例的可执行文件路径（打包态才是安装包里的 OpenMacro.exe，开发态是 electron.exe） */
function currentExe(): string {
  try {
    return app.getPath('exe')
  } catch {
    return process.execPath
  }
}

function failure(fail: CmdFail, timeoutReason: string): RunOutcome {
  const text = `${fail.stderr}\n${fail.stdout}\n${fail.message}`.trim()
  return { ok: false, stdout: '', stderr: text, canceled: false, reason: brief(text, timeoutReason) }
}

/** 当前已提权：直接执行 schtasks */
async function runSchtasksDirect(args: string[]): Promise<RunOutcome> {
  const r = await execWin('schtasks', args, 30000)
  if (r.ok) return { ok: true, stdout: r.stdout, stderr: r.stderr, canceled: false }
  return failure(r, '计划任务命令执行失败')
}

/**
 * 未提权：借 UAC 提权执行一次 schtasks（-Verb RunAs）。
 *
 * 注意：不能用 `-ArgumentList @(数组)` 传参。PowerShell 会把「带内嵌引号」的元素拆开：
 *   '/tr', '"C:\a b\app.exe" --flag'  →  实际到达 schtasks 的是两条独立参数：
 *   '/tr', 'C:\a b\app.exe', '--flag'
 * schtasks 随即以「无效参数」退出（它的输出进了隐藏窗口，stderr 为空），
 * 前端只能看到 Command failed —— 就是「点提权报错」的真正原因。
 * 所以这里自己拼一整条命令行（内层引号转义成 \"），再用单字符串形式交给
 * -ArgumentList（单字符串是原样透传，不会被重新切分）。
 */
async function runSchtasksElevated(args: string[]): Promise<RunOutcome> {
  const quoteArg = (s: string) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s)
  const cmdline = args.map(quoteArg).join(' ')
  // 失败时补一行带退出码的 stderr：schtasks 自己的报错进了隐藏窗口，至少能看出是「参数/权限」哪一类
  const ps =
    `$p = Start-Process -FilePath 'schtasks.exe' -ArgumentList '${cmdline.replace(/'/g, "''")}'` +
    ` -Verb RunAs -Wait -PassThru -WindowStyle Hidden;` +
    ` if (-not $p) { exit 1 }; if ($p.ExitCode -ne 0) { Write-Error ('schtasks exit ' + $p.ExitCode) }; exit $p.ExitCode`
  const r = await execWin(
    PS_EXE,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
    120000,
  )
  if (r.ok) return { ok: true, stdout: r.stdout, stderr: r.stderr, canceled: false }
  const text = `${r.stderr}\n${r.stdout}\n${r.message}`.trim()
  if (UAC_CANCEL_PATTERN.test(text)) {
    return { ok: false, stdout: '', stderr: text, canceled: true, reason: '未同意权限提升，计划任务未变更' }
  }
  // 带上 schtasks 自身退出码：它的具体报错进了隐藏窗口，退出码至少能区分「参数/权限/任务不存在」
  const exitCode = text.match(/schtasks exit (\d+)/)
  const reason = brief(text, '提权执行失败')
  return {
    ok: false,
    stdout: '',
    stderr: text,
    canceled: false,
    reason: exitCode ? `${reason}（schtasks 退出码 ${exitCode[1]}）` : reason,
  }
}

function runSchtasks(args: string[]): Promise<RunOutcome> {
  return isElevated() ? runSchtasksDirect(args) : runSchtasksElevated(args)
}

/** 状态：给设置页做权限展示与开关态判定 */
export async function getAdminAutostartStatus(): Promise<AdminAutostartStatus> {
  const supported = isWin32()
  const exePath = supported ? currentExe() : ''
  const task = await queryTask()
  const elevated = isElevated()
  const taskPathMatches = task.exists && samePath(exePartOfTaskCommand(task.command), exePath)
  const highest = task.runLevel === 'HighestAvailable'
  // 旧版本任务可能没有带交接标记：缺了它「立即切换」无法握手，按未开启处理让用户重开一次
  const hasHandover = `${task.command} ${task.args}`.includes(HANDOVER_FLAG)
  return {
    supported,
    devMode: !app.isPackaged,
    elevated,
    taskExists: task.exists,
    taskPathMatches,
    taskCommand: task.command,
    taskRunLevel: task.runLevel,
    exePath,
    taskName: TASK_NAME,
    // 开关态 = 任务存在 + 指向当前程序 + 最高权限 + 带交接标记（任一不符都要重开一次）
    enabled: Boolean(taskPathMatches && highest && hasHandover),
    requiresUac: supported && !elevated,
  }
}

/** 开通：创建「登录触发 + 最高权限」的计划任务 */
export async function enableAdminAutostart(): Promise<AdminAutostartResult> {
  if (!isWin32()) return { ok: false, reason: '提权自启仅支持 Windows' }
  // dev 态下 app.getPath('exe') 是 electron.exe：拿它建任务会拉起一个没有应用的空壳，
  // 直接挡掉比事后排查便宜（打包安装后本函数在 app.isPackaged 为真时才可用）
  if (!app.isPackaged) {
    return { ok: false, reason: '开发模式不支持：请用打包安装后的程序开启（dev 态程序路径是 electron.exe）' }
  }
  const args = [
    '/create',
    '/tn',
    TASK_NAME,
    '/tr',
    `"${currentExe()}" ${HANDOVER_FLAG}`,
    '/sc',
    'ONLOGON',
    '/rl',
    'HIGHEST',
    '/f',
  ]
  const r = await runSchtasks(args)
  if (!r.ok) return { ok: false, reason: r.reason, canceled: r.canceled }
  const status = await getAdminAutostartStatus()
  if (!status.enabled) return { ok: false, reason: '任务写入后校验未通过，请重试', status }
  return { ok: true, status }
}

/** 关闭：删除计划任务（本来就没有也算成功，保证幂等） */
export async function disableAdminAutostart(): Promise<AdminAutostartResult> {
  if (!isWin32()) return { ok: false, reason: '提权自启仅支持 Windows' }
  const before = await getAdminAutostartStatus()
  if (!before.taskExists) return { ok: true, status: before }
  const r = await runSchtasks(['/delete', '/tn', TASK_NAME, '/f'])
  if (!r.ok) return { ok: false, reason: r.reason, canceled: r.canceled }
  const status = await getAdminAutostartStatus()
  if (status.taskExists) return { ok: false, reason: '任务删除后仍存在，请重试', status }
  return { ok: true, status }
}

/** 直接 UAC 拉起带交接标记的提权新实例（不依赖计划任务，代价是弹一次 UAC 确认） */
async function launchElevatedHandover(): Promise<RunOutcome> {
  const exe = currentExe().replace(/'/g, "''")
  const ps = `Start-Process -FilePath '${exe}' -ArgumentList '${HANDOVER_FLAG}' -Verb RunAs`
  const r = await execWin(
    PS_EXE,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
    120000,
  )
  if (r.ok) return { ok: true, stdout: r.stdout, stderr: r.stderr, canceled: false }
  const text = `${r.stderr}\n${r.stdout}\n${r.message}`.trim()
  if (UAC_CANCEL_PATTERN.test(text)) {
    return { ok: false, stdout: '', stderr: text, canceled: true, reason: '未同意权限提升，已保持在普通权限实例' }
  }
  return { ok: false, stdout: '', stderr: text, canceled: false, reason: brief(text, '提权启动失败') }
}

/**
 * 切到管理员权限实例：
 *   · 已开启「提权自启」→ 触发计划任务（无 UAC 弹窗）；
 *   · 未开启 → 直接 UAC 拉起带 --elevated-handover 标记的新实例（弹一次 UAC 确认）。
 * 两条链路的交接握手相同：新实例抢锁失败 → 向本实例发 second-instance（带标记）
 * → 本实例退出让锁 → 新实例重试抢锁接管（握手细节在 index.ts）。本函数不主动退出：
 * 新实例没起来时当前实例原地不动，好过「窗口关了却再也没起来」。
 */
export async function relaunchElevated(): Promise<AdminAutostartResult> {
  if (!isWin32()) return { ok: false, reason: '提权自启仅支持 Windows' }
  if (!app.isPackaged) {
    return { ok: false, reason: '开发模式不支持切换：打包安装后的程序才走这条链路' }
  }
  if (isElevated()) return { ok: false, reason: '当前实例已经是管理员权限' }
  const status = await getAdminAutostartStatus()
  // 未开启自启：不走计划任务，直接 UAC 拉起（效果一样，多一次确认框）
  if (!status.enabled) {
    const r = await launchElevatedHandover()
    return r.ok
      ? { ok: true, status }
      : { ok: false, reason: r.reason, canceled: r.canceled, status }
  }
  const direct = await execWin('schtasks', ['/run', '/tn', TASK_NAME], 15000)
  // 非提权进程可能无法直接触发 HIGHEST（最高权限）任务，回退到 UAC 提权执行一次。
  // 仍在当前 Node 进程内同步等待（不像之前的延时 PowerShell 会被 Electron 一起清掉）。
  if (direct.ok) return { ok: true, status }
  if (UAC_CANCEL_PATTERN.test(`${direct.stderr}${direct.stdout}`)) {
    return { ok: false, reason: '未同意权限提升，已保持在普通权限实例', status }
  }
  const elevated = await runSchtasksElevated(['/run', '/tn', TASK_NAME])
  if (elevated.ok) return { ok: true, status }
  // 两条链路都失败时把两次的原因都带上，避免只看到一半
  const directReason = brief(
    `${direct.stderr}\n${direct.stdout}\n${direct.message}`.trim(),
    '直接触发失败',
  )
  return {
    ok: false,
    reason: `直接触发：${directReason}；提权触发：${elevated.reason ?? '失败'}`,
    status,
  }
}
