// 按键映射列表（通用模式，/binding，PRD 4.1）
// 绑定为数据实体：支持新增 / 编辑 / 删除（单行删除，不提供多选批量删除），绑定按键支持鼠标键与键盘键（含组合键）。
// FD 快搭规范：PageContainer + ProTable，工具栏只放「新增」，操作列 fixed:'right' + width 160。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Popconfirm, Space, Tag, Tooltip, Typography, message } from 'antd'
import { QuestionCircleOutlined } from '@ant-design/icons'
import { PageContainer, ProTable } from '@ant-design/pro-components'
import type { ProColumns } from '@ant-design/pro-components'
import { useNavigate } from 'umi'
import { actionSummary, triggerLabel, type DebounceRule, type KeyBinding } from '@/types/binding'
import { listMacros } from '@/api/macro'
import type { Macro } from '@/types/macro'
import { getInputConfig, listDebounceRules, saveBindings } from '@/api/binding'

export default function BindingPage() {
  const navigate = useNavigate()
  const [bindings, setBindings] = useState<KeyBinding[]>([])
  const [macros, setMacros] = useState<Macro[]>([])
  const [rules, setRules] = useState<DebounceRule[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [cfg, ms, dr] = await Promise.all([getInputConfig(), listMacros(), listDebounceRules()])
      setBindings(cfg.bindings)
      setMacros(ms)
      setRules(dr)
    } finally {
      setLoading(false)
    }
  }, [])

  const debounceFor = useCallback(
    (row: KeyBinding) =>
      rules.find((r) => r.trigger.kind === row.trigger.kind && r.trigger.code === row.trigger.code),
    [rules],
  )

  useEffect(() => {
    refresh()
  }, [refresh])

  const macroName = useCallback(
    (id?: string) => (id ? macros.find((m) => m.id === id)?.name : undefined),
    [macros],
  )

  const handleDeleteOne = async (row: KeyBinding) => {
    const res = await saveBindings(bindings.filter((b) => b.id !== row.id))
    if (!res.ok) {
      message.error(res.reason ?? '删除失败')
      return
    }
    message.success(`已删除「${triggerLabel(row.trigger)}」的绑定`)
    refresh()
  }

  const columns = useMemo<ProColumns<KeyBinding>[]>(
    () => [
      {
        title: '绑定按键',
        key: 'trigger',
        width: 200,
        render: (_dom, row) => (
          <Space size={4}>
            <Typography.Text>{triggerLabel(row.trigger)}</Typography.Text>
            <Tag>{row.trigger.kind === 'mouse' ? '鼠标' : '键盘'}</Tag>
          </Space>
        ),
      },
      {
        title: '绑定动作',
        key: 'actions',
        render: (_dom, row) =>
          !row.tap && !row.hold ? (
            <Space size={8} wrap>
              <Tag color="orange">未启用</Tag>
              <Typography.Text type="secondary">短按：无 / 长按：无</Typography.Text>
            </Space>
          ) : (
            <Space size={16} wrap>
              <Typography.Text type={row.tap ? undefined : 'secondary'}>
                {row.tap ? `短按：${actionSummary(row.tap, macroName(row.tap.macroId))}` : '短按：无'}
              </Typography.Text>
              <Typography.Text type={row.hold ? undefined : 'secondary'}>
                {row.hold
                  ? `长按（${row.holdThresholdMs / 1000} 秒）：${actionSummary(row.hold, macroName(row.hold.macroId))}`
                  : '长按：无'}
              </Typography.Text>
            </Space>
          ),
      },
      {
        title: '防抖',
        key: 'debounce',
        width: 110,
        render: (_dom, row) => {
          const d = debounceFor(row)
          return d?.enabled ? (
            <Tag color="green">{d.windowMs} 毫秒</Tag>
          ) : (
            <Tag>未启用</Tag>
          )
        },
      },
      {
        title: '操作',
        valueType: 'option',
        // 单元格内边距 8px：内容 60 + 16 内边距 + 4 余量 ≈ 80（hl-05 操作列宽度规范）
        width: 80,
        className: 'openmacro-op-cell',
        fixed: 'right',
        render: (_dom, row) => (
          // 2 个操作：编辑 + 删除（删除带 Popconfirm；一律 <a> 文字链接，hl-05 操作列间距规范）
          <Space size={4}>
            <a onClick={() => navigate(`/binding/edit/${row.id}`)}>编辑</a>
            <Popconfirm
              title={`删除「${triggerLabel(row.trigger)}」的绑定`}
              description="删除后该绑定键动作为空，立即生效，确定吗？"
              okText="确定"
              cancelText="取消"
              onConfirm={() => handleDeleteOne(row)}
            >
              <a style={{ color: 'var(--ant-color-error)' }}>删除</a>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [bindings, macroName, navigate, debounceFor],
  )

  return (
    <PageContainer
      title={
        <Space size={4}>
          按键映射
          <Tooltip title="一条绑定 = 一个绑定按键（鼠标键或键盘键 / 组合键）+ 短按动作 / 长按动作。左键 / 右键为系统保留，不可作为绑定键；防抖在「按键防抖」页配置，实时事件在「按键检测」页查看。">
            <QuestionCircleOutlined style={{ color: 'rgba(0, 0, 0, 0.45)' }} />
          </Tooltip>
        </Space>
      }
    >
      <ProTable<KeyBinding>
        columns={columns}
        rowKey="id"
        dataSource={bindings}
        loading={loading}
        search={false}
        pagination={false}
        scroll={{ x: 900 }}
        size="middle"
        toolBarRender={() => [
          <Button key="new" type="primary" onClick={() => navigate('/binding/create')}>
            新增
          </Button>,
        ]}
        toolbar={{ style: { justifyContent: 'flex-start' } }}
        locale={{ emptyText: '暂无绑定，点击「新增」创建' }}
      />
    </PageContainer>
  )
}
