// 窗口唤回工具（src/main/window-utils.ts）
//
// Windows 已知坑：窗口处于「最小化态」时被 hide()，之后无论先 restore 还是先 show，
// 都可能得到一个看得见但点不中的僵尸窗——窗口正常绘制、标题栏也在，但鼠标点击落不进去，
// 键盘同样无响应（Electron issue #19777 / #38246，多版本未修）。
// 规避必须两层同时做，缺一不可：
//   1. 隐藏前先 restore()，绝不让窗口以「最小化 + 隐藏」组合态存在（见 index.ts minimize 处理）
//   2. 唤回时先 show() 再 restore()，再 moveTop + focus，把窗口拉回正常激活态（本函数）
//
// 另一类 Windows 坑：唤回后整窗空白（标题栏正常、内容一片白）。原因是窗口 hide 期间渲染被节流、
// 合成器把窗口标记为不可见，show() 回来时没有任何「画面变了」的信号，浏览器不重绘。
//   3. invalidate() 强制整窗重绘一帧（本函数末尾），这是最直接的一层；
//   4. index.ts 的 webPreferences.backgroundThrottling = false，从源头不节流隐藏窗口的渲染。
import type { BrowserWindow } from 'electron'

/** 从托盘 / 二次启动 / 录制停止等任意路径唤回窗口，保证恢复后可点击可控制 */
export function revealWindow(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  // 顺序不能反：隐藏中的最小化窗口先调 restore 不可靠，先 show 再 restore 才稳
  if (!win.isVisible()) win.show()
  if (win.isMinimized()) win.restore()
  // moveTop：部分 Windows 合成器下仅 show+focus 窗口虽在前台但点击不生效，需显式置顶
  win.moveTop()
  // 防止早前跳过任务栏的状态残留（本应用当前未启用，双保险）
  win.setSkipTaskbar(false)
  try {
    win.focus()
  } catch {
    // 窗口恰好在事件间隙被销毁时 focus 会抛，忽略即可
  }
  // 兜底重绘：hide 期间不产生新帧，唤回时内容可能是白屏 / 陈旧画面
  try {
    win.webContents.invalidate()
  } catch {
    // webContents 已销毁（窗口正在关闭）时忽略
  }
}
