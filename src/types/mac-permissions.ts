// macOS 输入权限 / 开机启动的跨进程类型（src/types/mac-permissions.ts）
// main 侧用相对路径引用（tsconfig.node.json 未配 @/* alias），renderer 侧用 @/types/mac-permissions
// 对应 Windows 的 types/admin-autostart.ts：两边都是「运行权限」域，只是系统机制完全不同

/** 输入授权状态：macOS 把「辅助功能」与「输入监控」拆成两项独立授权 */
export interface MacPermissionStatus {
  /** 平台支持：仅 macOS 为 true */
  supported: boolean
  /** 辅助功能（AXIsProcessTrusted）：不授则钩子根本无法启动，鼠标键盘全无 */
  accessibility: boolean
  /** 输入监控（CGPreflightListenEventAccess）：不授则鼠标正常、键盘事件被系统静默丢弃 */
  inputMonitoring: boolean
  /** 原生模块是否加载成功；false 时上面两项不可信（显示「查询失败」而非「未授权」） */
  available: boolean
  /** 当前程序的可执行文件路径（app.getPath('exe')） */
  exePath: string
  /** 授权对象：.app 包路径——TCC 授权按包（代码签名）归属，手动添加权限时认的是这个 */
  appBundlePath: string
}

/** 登录项开机启动状态（SMAppService，仅打包态可用） */
export interface MacLoginItemStatus {
  supported: boolean
  openAtLogin: boolean
  /** 不可用原因（非 macOS / dev 态） */
  reason?: string
}

/** 跳转系统设置面板的结果 */
export interface MacPermissionResult {
  ok: boolean
  reason?: string
  status?: MacPermissionStatus
}

/** 登录项开关的变更结果 */
export interface MacLoginItemResult {
  ok: boolean
  reason?: string
  status?: MacLoginItemStatus
}
