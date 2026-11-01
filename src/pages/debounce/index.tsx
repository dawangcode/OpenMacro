// 按键防抖列表（独立页 /debounce，src/pages/debounce/index.tsx，PRD 4.3）
// 防抖为独立规则实体：支持新增 / 编辑 / 删除（单行删除，不提供多选批量删除），
// 每条规则绑定一个鼠标键或键盘键（含组合键）。
// 与按键映射不同：允许绑定左键 / 右键（鼠标连击过滤是主要场景）。
// 参考「按键映射」列表：PageContainer + ProTable，工具栏只放「新增」，操作列 fixed:'right' + 编辑 / 删除。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Popconfirm, Space, Tag, Tooltip, Typography, message } from 'antd'
import { QuestionCircleOutlined } from '@ant-design/icons'
import { PageContainer, ProTable } from '@ant-design/pro-components'
import type { ProColumns } from '@ant-design/pro-components'
import { useNavigate } from 'umi'
import { triggerLabel, type DebounceRule } from '@/types/binding'
import { listDebounceRules, saveDebounceRules } from '@/api/binding'

export default function DebouncePage() {
  const navigate = useNavigate()
  const [rules, setRules] = useState<DebounceRule[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setRules(await listDebounceRules())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleDeleteOne = async (row: DebounceRule) => {
    const res = await saveDebounceRules(rules.filter((r) => r.id !== row.id))
    if (!res.ok) {
      message.error(res.reason ?? '删除失败')
      return
    }
    message.success(`已删除「${triggerLabel(row.trigger)}」的防抖规则`)
    refresh()
  }

  const columns = useMemo<ProColumns<DebounceRule>[]>(
    () => [
      {
        title: '绑定按键',
        key: 'trigger',
        width: 220,
        render: (_dom, row) => (
          <Space size={4}>
            <Typography.Text>{triggerLabel(row.trigger)}</Typography.Text>
            <Tag>{row.trigger.kind === 'mouse' ? '鼠标' : '键盘'}</Tag>
          </Space>
        ),
      },
      {
        title: '防抖开关',
        key: 'enabled',
        width: 120,
        render: (_dom, row) =>
          row.enabled ? <Tag color="green">已启用</Tag> : <Tag>未启用</Tag>,
      },
      {
        title: '防抖窗口（毫秒）',
        key: 'windowMs',
        width: 160,
        render: (_dom, row) => row.windowMs ?? 200,
      },
      {
        title: '操作',
        valueType: 'option',
        width: 80,
        className: 'openmacro-op-cell',
        fixed: 'right',
        render: (_dom, row) => (
          <Space size={4}>
            <a onClick={() => navigate(`/debounce/edit/${row.id}`)}>编辑</a>
            <Popconfirm
              title={`删除「${triggerLabel(row.trigger)}」的防抖规则`}
              description="删除后立即生效，确定吗？"
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
    [navigate, rules],
  )

  return (
    <PageContainer
      title={
        <Space size={4}>
          按键防抖
          <Tooltip title="防抖只过滤窗口内的重复触发，不延迟首次触发；窗口从该按键第一次按下起算，抬起不计入。每条规则绑定一个鼠标键或键盘键（含组合键），可独立新增 / 编辑 / 删除；优先级最高的场景是鼠标连击——左键 / 右键同样可绑定（不像按键映射那样受系统保留限制）。注意当前输入库为观察型钩子，左键 / 右键的防抖只能抑制本软件侧的重复响应，无法阻止点击继续到达其它程序。">
            <QuestionCircleOutlined style={{ color: 'rgba(0, 0, 0, 0.45)' }} />
          </Tooltip>
        </Space>
      }
    >
      <ProTable<DebounceRule>
        columns={columns}
        rowKey="id"
        dataSource={rules}
        loading={loading}
        search={false}
        pagination={false}
        scroll={{ x: 700 }}
        size="middle"
        toolBarRender={() => [
          <Button key="new" type="primary" onClick={() => navigate('/debounce/create')}>
            新增
          </Button>,
        ]}
        toolbar={{ style: { justifyContent: 'flex-start' } }}
        locale={{ emptyText: '暂无防抖规则，点击「新增」创建' }}
      />
    </PageContainer>
  )
}
