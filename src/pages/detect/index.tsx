// 按键检测（src/pages/detect/index.tsx，PRD 4.2）
// 单一时间线：把「物理输入回显」与「软件在绑定键上的实际动作」按时间合并到一张表，
// 一行就能看出「按了什么键 → 软件做了什么 / 是否被防抖抑制」。
//   · 物理事件行：触发按键=实际按下的键（按住修饰键时为组合摘要，如 Ctrl+Shift+A），
//     事件类型=按下/抬起/滚轮，触发方式/动作列为空；
//   · 触发行：触发方式=短按/长按/长按松开/防抖抑制，动作类型/动作详情有值。
// FD 快搭看板规范：PageContainer + ProTable。
import { useEffect, useMemo, useState } from 'react'
import { Button, Popover, Space, Tag, Tooltip, Typography, message } from 'antd'
import { QuestionCircleOutlined } from '@ant-design/icons'
import { PageContainer, ProTable } from '@ant-design/pro-components'
import type { ProColumns } from '@ant-design/pro-components'
import { onMacroEvent } from '@/api/macro'
import {
  clearDetectEvents,
  clearTriggerEvents,
  getDetectState,
  getTriggerState,
  listBindings,
  listDebounceRules,
  setDetectPaused,
  type DetectEventView,
  type TriggerActivityView,
} from '@/api/binding'
import { triggerLabel, type DebounceRule, type KeyBinding } from '@/types/binding'
import { clockMs } from '@/utils/display'

interface DetectView {
  events: DetectEventView[]
  seen: string[]
  lastMouseActivityAt: number
  paused: boolean
}

/** 合并后的一行（物理事件与触发记录共用一套字段） */
interface MergedRow {
  key: string
  ts: number
  /** 触发按键：物理行 = 实际按下的键（含修饰键时为组合摘要）；触发行 = 命中的绑定键 */
  triggerKey: string
  /** 事件类型：按下 / 抬起 / 滚轮上滚 / 滚轮下滚 / 触发 */
  eventType: string
  /** 触发方式：仅触发行有值 */
  triggerKind?: TriggerActivityView['trigger']
  /** 绑定按键：该行命中的绑定（物理行未绑定则为空） */
  bindingKey?: string
  actionType?: string
  detail?: string
  /** 防抖窗口内重复次数（物理行） */
  repeat: number
  suppressed: boolean
}

const ACTION_TYPE_LABEL: Record<string, string> = {
  keyboard: '键盘',
  mouse: '鼠标',
  command: '命令',
  launch: '启动',
  macro: '宏',
  disabled: '禁用',
}

const TRIGGER_LABEL: Record<TriggerActivityView['trigger'], string> = {
  tap: '短按',
  hold: '长按',
  'hold-stop': '长按松开',
  'debounce-suppressed': '防抖抑制',
}

/**
 * 列表只保留最新 10 条，不做分页：这是一块实时监视面板，翻页没有意义，
 * 也不会因为条数增长出现滚动条或撑高页面。
 */
const MAX_ROWS = 10

/** 表头口径说明：放在标题问号里，避免正文顶部堆大段说明文字 */
const PAGE_HINT =
  '按时间合并两个来源：物理事件行（真实按键的原始按下 / 抬起 / 滚轮与防抖窗口内重复次数；按住修饰键时「触发按键」显示为组合摘要，如 Ctrl+Shift+A）与触发行（软件在绑定键上真正执行的动作、被防抖抑制的记录）。红色「防抖抑制」表示窗口内重复触发被成功拦下——这是验证防抖生效的直接证据；未绑定动作的按键只会有物理事件行，不会有触发行。'

export default function DetectPage() {
  const [detect, setDetect] = useState<DetectView>({
    events: [],
    seen: [],
    lastMouseActivityAt: 0,
    paused: false,
  })
  const [triggers, setTriggers] = useState<TriggerActivityView[]>([])
  // 已启用防抖规则的按键展示名集合：用于让「双击」提示感知防抖是否生效
  const [debounceLabels, setDebounceLabels] = useState<Set<string>>(new Set())
  // 绑定列表：物理事件行据此回填「绑定按键」
  const [bindings, setBindings] = useState<KeyBinding[]>([])
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    getDetectState().then((s) => setDetect(s))
    getTriggerState().then(setTriggers)
    listBindings().then(setBindings)
    listDebounceRules().then((rules: DebounceRule[]) =>
      setDebounceLabels(new Set(rules.filter((r) => r.enabled).map((r) => triggerLabel(r.trigger)))),
    )
    const off = onMacroEvent((channel, payload) => {
      if (channel === 'macro:detect:event') {
        const p = payload as {
          event: DetectEventView | null
          seen: string[]
          lastMouseActivityAt: number
        }
        setDetect((prev) => ({
          ...prev,
          events: p.event ? [p.event, ...prev.events].slice(0, MAX_ROWS) : prev.events,
          seen: p.seen,
          lastMouseActivityAt: p.lastMouseActivityAt,
        }))
      } else if (channel === 'macro:trigger:event') {
        const p = payload as TriggerActivityView
        setTriggers((prev) => [p, ...prev].slice(0, MAX_ROWS))
      }
    })
    // 2 秒滴答：驱动「长时间无事件 / 无鼠标活动」类提示与按下高亮
    const timer = setInterval(() => setNow(Date.now()), 2000)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [])

  /** 绑定键展示名 → 绑定项，供物理事件行回填「绑定按键」 */
  const bindingByLabel = useMemo(() => {
    const m = new Map<string, KeyBinding>()
    for (const b of bindings) m.set(triggerLabel(b.trigger), b)
    return m
  }, [bindings])

  /** 两个来源按时间倒序合并，只保留最新 MAX_ROWS 条 */
  const rows = useMemo<MergedRow[]>(() => {
    const merged: MergedRow[] = []
    for (const e of detect.events) {
      merged.push({
        key: `p:${e.id}`,
        ts: e.ts,
        triggerKey: e.key,
        eventType: e.eventType,
        bindingKey: bindingByLabel.get(e.key)?.trigger.label,
        repeat: e.repeat,
        suppressed: false,
      })
    }
    for (const t of triggers) {
      merged.push({
        key: `t:${t.id}`,
        ts: t.ts,
        triggerKey: t.bindingKey,
        eventType: '触发',
        triggerKind: t.trigger,
        bindingKey: t.bindingKey,
        actionType: t.actionType,
        detail: t.detail,
        repeat: 0,
        suppressed: t.suppressed,
      })
    }
    // 稳定排序：同一毫秒内保持「物理事件在前、触发行在后」（先按后触发）
    merged.sort((a, b) => b.ts - a.ts)
    return merged.slice(0, MAX_ROWS)
  }, [detect.events, triggers, bindingByLabel])

  // ---- 状态提示区 ----
  const lastEventAt = detect.events[0]?.ts ?? 0
  const noBindableSeen = detect.seen.length === 0
  const mouseActive = detect.lastMouseActivityAt > 0 && now - detect.lastMouseActivityAt < 10000
  // 暂停采集时冻结一切时间相关提示，只保留「已暂停」标记
  const timeHintsOn = !detect.paused
  const noMouseEvent =
    timeHintsOn && (detect.lastMouseActivityAt === 0 || now - detect.lastMouseActivityAt >= 10000)
  // 窗口内重复按下：已从防抖角度判定是否已被规则覆盖（避免「已配防抖却还报双击」的误解）
  const recentDouble = timeHintsOn
    ? detect.events.find((e) => e.repeat > 0 && now - e.ts < 2000)
    : undefined
  const recentDoubleCovered = recentDouble ? debounceLabels.has(recentDouble.key) : false
  // 占用提示只在「刚安静下来」的窗口内显示（3~15 秒无事件），避免长期挂屏
  const quietMs = now - lastEventAt
  const occupancyHint = timeHintsOn && detect.events.length > 0 && quietMs > 3000 && quietMs < 15000

  const handleTogglePause = async () => {
    const next = !detect.paused
    const v = await setDetectPaused(next)
    setDetect((prev) => ({ ...prev, paused: v }))
    message.success(v ? '已暂停采集' : '已继续采集')
  }

  const handleClear = async () => {
    await clearDetectEvents()
    await clearTriggerEvents()
    setDetect((prev) => ({ ...prev, events: [] }))
    setTriggers([])
    message.success('已清空事件列表')
  }

  const columns: ProColumns<MergedRow>[] = [
    { title: '触发按键', dataIndex: 'triggerKey', width: 120, ellipsis: true },
    {
      title: '事件类型',
      dataIndex: 'eventType',
      width: 130,
      render: (_dom, entity) =>
        entity.repeat > 0 ? (
          <Space size={4}>
            <span>{entity.eventType}</span>
            <Tag color="orange">重复 {entity.repeat}</Tag>
          </Space>
        ) : (
          entity.eventType
        ),
    },
    {
      title: '触发方式',
      dataIndex: 'triggerKind',
      width: 90,
      render: (_dom, entity) => {
        if (!entity.triggerKind) return <Typography.Text type="secondary">—</Typography.Text>
        return (
          <Tag color={entity.suppressed ? 'red' : 'blue'}>{TRIGGER_LABEL[entity.triggerKind]}</Tag>
        )
      },
    },
    {
      title: '绑定按键',
      dataIndex: 'bindingKey',
      width: 90,
      render: (_dom, entity) =>
        entity.bindingKey ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: '动作类型',
      dataIndex: 'actionType',
      width: 80,
      render: (_dom, entity) =>
        entity.actionType ? (
          ACTION_TYPE_LABEL[entity.actionType] ?? entity.actionType
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      // 不给宽度：占用剩余空间，窗口变宽时只拉伸这一列，避免横向滚动条
      title: '动作详情',
      dataIndex: 'detail',
      ellipsis: true,
      render: (_dom, entity) =>
        entity.detail || <Typography.Text type="secondary">—</Typography.Text>,
    },
    { title: '时间', dataIndex: 'ts', width: 110, render: (_dom, entity) => clockMs(entity.ts) },
  ]

  return (
    <PageContainer
      title={
        <Space size={4}>
          按键检测
          <Tooltip
            title={<span style={{ display: 'block', maxWidth: 460 }}>{PAGE_HINT}</span>}
          >
            <QuestionCircleOutlined style={{ color: 'rgba(0, 0, 0, 0.45)' }} />
          </Tooltip>
        </Space>
      }
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space wrap size={16}>
          <Typography.Text type="secondary">
            已识别到 {detect.seen.length} 个可绑定按键
          </Typography.Text>
          {detect.paused && <Tag color="orange">已暂停采集</Tag>}
          {noBindableSeen && mouseActive && (
            <Typography.Text type="warning">
              未识别到可绑定按键：请尝试按下中键 / 侧键4 / 侧键5；若仍无事件，可能被厂商驱动或板载配置占用
            </Typography.Text>
          )}
          {noMouseEvent && (
            <Typography.Text type="secondary">未检测到鼠标事件，请移动或点击鼠标</Typography.Text>
          )}
          {recentDouble && recentDoubleCovered && (
            <Typography.Text type="success">
              该按键已配置防抖规则：窗口内重复按下会被抑制（抑制记录见下方红色「防抖抑制」行），无需处理
            </Typography.Text>
          )}
          {recentDouble && !recentDoubleCovered && (
            <Typography.Text type="warning">
              检测到双击，建议为该按键配置防抖（配置后本表会出现红色「防抖抑制」行）
            </Typography.Text>
          )}
          {occupancyHint && (
            <Popover
              title="按下按键无高亮？排查方法"
              content={
                <div style={{ maxWidth: 360 }}>
                  1. 打开鼠标厂商驱动（如罗技 G HUB、雷蛇 Synapse），把对应侧键恢复默认；
                  <br />
                  2. 关闭鼠标官方软件中的板载配置文件，改由本软件发送动作；
                  <br />
                  3. 部分鼠标需在驱动中禁用「板载内存」后才能被软件层捕获。
                </div>
              }
            >
              <Typography.Link>按下按键无高亮？可能被厂商驱动或板载配置占用，查看排查方法</Typography.Link>
            </Popover>
          )}
        </Space>
        <ProTable<MergedRow>
          columns={columns}
          rowKey="key"
          dataSource={rows}
          search={false}
          pagination={false}
          size="middle"
          rowClassName={(row) =>
            row.eventType === '按下' && now - row.ts < 1500 ? 'detect-row-active' : ''
          }
          locale={{ emptyText: '暂无事件，请按下任意按键或移动鼠标' }}
          toolBarRender={() => [
            <Button key="pause" onClick={handleTogglePause}>
              {detect.paused ? '继续采集' : '暂停采集'}
            </Button>,
            <Button key="clear" disabled={rows.length === 0} onClick={handleClear}>
              清空
            </Button>,
          ]}
        />
      </Space>
    </PageContainer>
  )
}
