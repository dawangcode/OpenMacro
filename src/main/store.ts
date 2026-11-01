// 主进程设置持久化（SQLite settings 表）
import { getSetting, setSetting } from './db'

export function getConfig(): Record<string, unknown> {
  const raw = getSetting('config')
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function setConfig(config: unknown): void {
  setSetting('config', JSON.stringify(config ?? {}) ?? '{}')
}

/**
 * 赞助引导提醒：默认展示，用户关闭后「永久」不再出现，直到主版本号（x.y.z 的 x）
 * 大更新时重置一次——既保住曝光，又把打扰压到最低（留存友好）。
 * 关闭时记录当时主版本；启动对比当前主版本，不同则允许再提醒一次。
 * 独立 settings key，不塞进 config——config 是整对象覆写，混进来容易被覆盖丢。
 */
function currentMajor(): string {
  // 主进程里拿版本号（package.json 的 version）
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { app } = require('electron')
  const v = (app.getVersion() || '0.0.0').split('.')
  return v[0] || '0'
}

export function isSponsorGuideDismissed(): boolean {
  if (getSetting('sponsorGuideDismissed') !== '1') return false
  const recordedMajor = getSetting('sponsorGuideMajor') || ''
  return recordedMajor === currentMajor()
}

export function markSponsorGuideShown(): void {
  setSetting('sponsorGuideDismissed', '1')
  setSetting('sponsorGuideMajor', currentMajor())
}
