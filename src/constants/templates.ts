// 首启引导里的内置宏模板：只放通用、可撤销、不会破坏数据的动作。
// 复杂模板（Excel/浏览器/特定软件）放在云端宏社区，避免把客户端做成一堆场景预设。
import type { MacroStep, PlayMode, SystemCommand } from '@/types/macro'

export type MacroTemplateStep = Omit<MacroStep, 'id'>

export interface MacroTemplate {
  key: string
  name: string
  description: string
  steps: MacroTemplateStep[]
  playMode: PlayMode
  repeatInterval: number
  playCount: number
  speed: number
}

const keyboard = (label: string, combo: string, delay = 100): MacroTemplateStep => ({
  kind: 'keyboard',
  label,
  delay,
  key: combo,
  action: 'click',
})

const command = (label: string, cmd: SystemCommand, delay = 100): MacroTemplateStep => ({
  kind: 'command',
  label,
  delay,
  command: cmd,
})

export const MACRO_TEMPLATES: MacroTemplate[] = [
  {
    key: 'copy-paste',
    name: '复制并粘贴',
    description: '按一下侧键，自动 Ctrl+C → Ctrl+V',
    steps: [keyboard('复制', 'Ctrl+C'), keyboard('粘贴', 'Ctrl+V', 150)],
    playMode: 'once',
    repeatInterval: 100,
    playCount: 1,
    speed: 1,
  },
  {
    key: 'save',
    name: '一键保存',
    description: '按一下侧键，自动 Ctrl+S',
    steps: [keyboard('保存', 'Ctrl+S')],
    playMode: 'once',
    repeatInterval: 100,
    playCount: 1,
    speed: 1,
  },
  {
    key: 'refresh',
    name: '刷新当前页',
    description: '按一下侧键，自动 F5',
    steps: [keyboard('刷新', 'F5')],
    playMode: 'once',
    repeatInterval: 100,
    playCount: 1,
    speed: 1,
  },
  {
    key: 'screenshot',
    name: '一键截图',
    description: '按一下侧键，调用系统截图键',
    steps: [command('截图', 'screenshot')],
    playMode: 'once',
    repeatInterval: 100,
    playCount: 1,
    speed: 1,
  },
  {
    key: 'volume-up',
    name: '音量加',
    description: '按一下侧键，系统音量加一格',
    steps: [command('音量加', 'volumeUp')],
    playMode: 'once',
    repeatInterval: 100,
    playCount: 1,
    speed: 1,
  },
  {
    key: 'media-toggle',
    name: '播放/暂停',
    description: '按一下侧键，控制当前播放器',
    steps: [command('播放/暂停', 'mediaPlayPause')],
    playMode: 'once',
    repeatInterval: 100,
    playCount: 1,
    speed: 1,
  },
]
