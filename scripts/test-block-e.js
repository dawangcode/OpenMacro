/**
 * 拦截功能验证脚本（临时，验证完可删）
 *
 * 测试内容：
 *  1. 阻塞 E 键（无修饰键，mask=0）—— 模拟 binding-engine 的 syncBlockedKeys
 *  2. 监听 keydown/keyup —— 验证 JS 侧仍能收到事件（检测面板不受影响）
 *  3. 用户操作验证：
 *     - 在记事本按 E        → 不应出现 'e'（OS 层被拦截）
 *     - 在记事本按 Shift+E  → 应出现 'E'（组合键语义：只拦裸 E）
 *     - 控制台应打印每次按键的 keydown 事件（JS 分发正常）
 *  4. Ctrl+C 退出
 */
const { uIOhook, UiohookKey } = require('uiohook-napi')

uIOhook.on('keydown', (e) => {
  console.log(`[keydown] keycode=${e.keycode} (E=${UiohookKey.E}) mask=${e.mask}`)
})
uIOhook.on('keyup', (e) => {
  console.log(`[keyup] keycode=${e.keycode}`)
})

// 配置驱动：阻塞裸 E（无修饰键）
uIOhook.setBlockedKeys([UiohookKey.E], [0])
console.log('=== 已拦截裸 E（mask=0）===')
console.log('请打开记事本：')
console.log('  - 按 E        → 不应出现 e')
console.log('  - 按 Shift+E  → 应出现 E（组合键不受影响）')
console.log('Ctrl+C 退出')

uIOhook.start()
