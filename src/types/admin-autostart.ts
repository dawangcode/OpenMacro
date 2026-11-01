// 运行权限 / 提权自启的跨进程类型（src/types/admin-autostart.ts）
// main 侧用相对路径引用（tsconfig.node.json 未配 @/* alias），renderer 侧用 @/types/admin-autostart

/** 当前实例的权限状态与计划任务状态 */
export interface AdminAutostartStatus {
  /** 平台支持：目前仅 Windows（计划任务 /rl HIGHEST） */
  supported: boolean
  /** 开发模式（未打包）：exePath 是 node_modules 里的 electron.exe，与打包后的程序不是同一个，
   *  自启任务指向打包后的 OpenMacro.exe，二者不一致属预期，不按「需重新指向」处理 */
  devMode: boolean
  /** 当前实例是否已提权（High IL） */
  elevated: boolean
  /** 提权自启的计划任务是否存在 */
  taskExists: boolean
  /** 任务登记的程序路径是否与当前 exe 一致（重装到别处后会不一致） */
  taskPathMatches: boolean
  /** 任务登记的程序路径 */
  taskCommand: string
  /** 任务登记的运行级别：HighestAvailable 才代表「以最高权限运行」 */
  taskRunLevel: string
  /** 当前实例的 exe 路径 */
  exePath: string
  /** 计划任务名 */
  taskName: string
  /** 综合开关态：任务存在且路径吻合 */
  enabled: boolean
  /** 下一次变更是否需要弹 UAC（未提权且平台支持时为 true） */
  requiresUac: boolean
}

/** 变更结果：失败时给人类可读原因，便于 UI 直接展示 */
export interface AdminAutostartResult {
  ok: boolean
  reason?: string
  /** 用户在 UAC 窗口点了「否」 */
  canceled?: boolean
  status?: AdminAutostartStatus
}
