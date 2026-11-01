// 全局行为修正（src/global.ts，Umi 启动前加载）
// Chromium 默认把鼠标侧键4/5（XButton1/2）映射为「后退 / 前进」历史导航，
// 捕获侧键作为绑定按键时页面会被切走。本客户端内侧键无其它用途，
// 统一拦截默认导航行为（捕获由主进程原生钩子完成，不受此影响）。
const SIDE_BUTTONS = new Set([3, 4]) // MouseEvent.button：3 = 侧键4，4 = 侧键5

const blockSideNav = (e: MouseEvent): void => {
  if (SIDE_BUTTONS.has(e.button)) e.preventDefault()
}

// capture 阶段监听，先于页面内任何处理器；mousedown 触发导航，auxclick/mouseup 兜底
document.addEventListener('mousedown', blockSideNav, true)
document.addEventListener('mouseup', blockSideNav, true)
document.addEventListener('auxclick', blockSideNav, true)
