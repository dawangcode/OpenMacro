// 合成（软件注入）输入标记（src/main/synthetic.ts）
// uiohook 是观察型钩子，会把本软件通过 nut-js 注入的键鼠事件也捕获回来；
// 若不处理，宏 / 绑定动作产生的键鼠输入就会混入「物理按键检测」，看起来像多了一组「宏的调用」。
// 这里在每次注入前记录时间戳，供绑定运行时在入口处把合成事件剔除——
// 物理按键检测只应显示真实人工输入，软件注入的键鼠事件也不应触发绑定或计入连击。
let lastSyntheticAt = 0

/** 判定合成事件的宽松窗口：注入后事件回环到 uiohook 回调通常 <50ms，留余量避免漏判 */
const SYNTHETIC_WINDOW_MS = 120

/** 每次通过本软件注入键鼠输入前后调用，记录最近一次注入时间 */
export function markSyntheticInjection(): void {
  lastSyntheticAt = Date.now()
}

/**
 * 判断事件时间戳是否来自本软件注入（合成事件）。
 * @param ts 事件时间戳（来自 hook 回调的 Date.now()）
 * @returns true 表示为软件注入的键鼠事件，应从物理检测剔除、不触发绑定、不计入连击
 */
export function isSyntheticEvent(ts: number): boolean {
  if (lastSyntheticAt === 0) return false
  // 提前 30ms 容错：注入调用与 hook 回调之间可能存在极小负偏移
  return ts >= lastSyntheticAt - 30 && ts <= lastSyntheticAt + SYNTHETIC_WINDOW_MS
}
