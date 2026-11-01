// 跨模块共享的运行态开关（src/main/runtime-state.ts）
// 独立小模块而非挂在 engine 上：capture / recorder 都要读写「绑定运行时是否挂起」，
// 直接互相 import 会形成环依赖（engine ↔ capture），抽走后双方都只依赖本文件。
let suspended = false
let onChange: ((v: boolean) => void) | null = null

/** 挂起 / 恢复按键绑定运行时（录制中、按键捕获中应挂起） */
export function setBindingSuspended(v: boolean): void {
  if (suspended === v) return
  suspended = v
  onChange?.(v)
}

export function isBindingSuspended(): boolean {
  return suspended
}

/** 注册挂起态变更回调（绑定运行时用于清理半按状态） */
export function onSuspendedChange(fn: (v: boolean) => void): void {
  onChange = fn
}
