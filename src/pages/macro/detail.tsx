// 宏详情（独立详情页 /macro/detail/:id，PRD 4.4 / 4.5 查看）
// 规范：查看 = 独立详情路由页，禁止 Modal/Drawer 弹只读详情；
// 界面与编辑页同一套：ProForm 三列栅格 + readonly 字段（hl-05 详情页模板），时间轴沿用编辑页列布局、控件置灰只读
import { useEffect, useState } from 'react'
import { Button, Card, Empty, Input, InputNumber, Select, Space, Table, Typography, message } from 'antd'
import type { TableProps } from 'antd'
import { PageContainer, ProForm, ProFormDigit, ProFormSelect, ProFormText } from '@ant-design/pro-components'
import { useNavigate, useParams } from 'umi'
import { getMacro } from '@/api/macro'
import {
  MOUSE_ACTION_OPTIONS,
  KEYBOARD_ACTION_OPTIONS,
  MOUSE_BUTTON_OPTIONS,
  PLAY_MODE_OPTIONS,
  STEP_KIND_OPTIONS,
  SYSTEM_COMMAND_OPTIONS,
  calcMacroDuration,
  formatDuration,
  type Macro,
  type MacroStep,
} from '@/types/macro'
import { formatDateTime } from '@/utils/display'

/** 与编辑页同一套控件宽度，保证两页列布局一致 */
const CTRL_W = { select: 120, input: 180, number: 120 }

/** 只读值区：与编辑页表单视觉同构，灰底代替输入框（hl-05 详情页模板） */
const READONLY_CSS = `
  .detail-readonly .ant-form-item-control-input-content {
    background-color: #f7f7f7;
    padding: 4px 11px;
    border-radius: 6px;
    min-height: 32px;
  }
`

export default function MacroDetailPage() {
  const navigate = useNavigate()
  // 路由有 :id 路径段 → 必须用 useParams（useLocation().query 恒为 undefined，禁用）
  const params = useParams<{ id: string }>()
  const id = params.id ?? ''
  const [macro, setMacro] = useState<Macro | null>(null)

  useEffect(() => {
    if (!id) return
    let alive = true
    getMacro(id).then((m) => {
      if (!alive) return
      if (m) setMacro(m)
      else {
        message.error('宏不存在')
        navigate('/macro')
      }
    })
    return () => {
      alive = false
    }
  }, [id, navigate])

  if (!macro) return <PageContainer title="宏详情" />

  // 时间轴：与编辑页相同的列宽 / 控件分组，全部控件 disabled，不提供操作列
  const renderContent = (row: MacroStep) => {
    if (row.kind === 'keyboard') {
      return (
        <Space size={4} wrap>
          <Input disabled value={row.key ?? ''} style={{ width: CTRL_W.select }} />
          <Select
            disabled
            value={row.action ?? 'click'}
            style={{ width: CTRL_W.select }}
            options={KEYBOARD_ACTION_OPTIONS}
          />
        </Space>
      )
    }
    if (row.kind === 'mouse') {
      return (
        <Space size={4} wrap>
          <Select
            disabled
            value={row.action ?? 'down'}
            options={MOUSE_ACTION_OPTIONS}
            style={{ width: CTRL_W.select }}
          />
          {(row.action === 'down' || row.action === 'up' || row.action === 'click') && (
            <Select
              disabled
              value={row.key ?? 'left'}
              options={MOUSE_BUTTON_OPTIONS}
              style={{ width: CTRL_W.select }}
            />
          )}
          {row.action === 'move' && (
            <Space size={4}>
              <InputNumber disabled value={row.x ?? 0} style={{ width: CTRL_W.number }} />
              <InputNumber disabled value={row.y ?? 0} style={{ width: CTRL_W.number }} />
            </Space>
          )}
          {(row.action === 'wheelUp' || row.action === 'wheelDown') && (
            <InputNumber disabled value={row.wheelAmount ?? 1} style={{ width: CTRL_W.number }} />
          )}
        </Space>
      )
    }
    if (row.kind === 'text') {
      return <Input disabled value={row.text ?? ''} style={{ width: CTRL_W.input }} />
    }
    if (row.kind === 'delay') {
      return (
        <Space size={4}>
          <InputNumber disabled value={row.delay} style={{ width: CTRL_W.number }} />
          <Typography.Text type="secondary">毫秒</Typography.Text>
        </Space>
      )
    }
    if (row.kind === 'loopStart') {
      return <InputNumber disabled prefix="×" value={row.loopCount ?? 1} style={{ width: CTRL_W.number }} />
    }
    if (row.kind === 'loopEnd') return null
    if (row.kind === 'command') {
      return <Select disabled value={row.command} options={SYSTEM_COMMAND_OPTIONS} style={{ width: CTRL_W.select }} />
    }
    return null
  }

  const columns: TableProps<MacroStep>['columns'] = [
    {
      title: '序号',
      key: 'idx',
      width: 80,
      render: (_v, _r, i) => <span style={{ color: 'rgba(0, 0, 0, 0.45)' }}>{i + 1}</span>,
    },
    {
      title: '动作类型',
      dataIndex: 'kind',
      width: 150,
      render: (_v, row) => (
        <Select disabled value={row.kind} options={STEP_KIND_OPTIONS} style={{ width: '100%' }} />
      ),
    },
    {
      title: '动作内容',
      key: 'content',
      render: (_v, row) => renderContent(row),
    },
  ]

  return (
    <PageContainer
      title="宏详情"
      onBack={() => navigate('/macro')}
      extra={[
        <Button
          key="edit"
          type="primary"
          style={{ minWidth: 88 }}
          onClick={() => navigate(`/macro/edit/${macro.id}`)}
        >
          编辑
        </Button>,
      ]}
    >
      <Card title="基本信息" style={{ marginBottom: 16 }}>
        <style>{READONLY_CSS}</style>
        <ProForm
          submitter={false}
          grid
          className="detail-readonly"
          initialValues={{
            name: macro.name,
            speed: macro.speed,
            repeatInterval: macro.repeatInterval,
            playCount: macro.playCount,
            playMode: macro.playMode,
            stepCount: macro.steps.length,
            duration: formatDuration(calcMacroDuration(macro.steps)),
            createdAt: formatDateTime(macro.createdAt),
            updatedAt: formatDateTime(macro.updatedAt),
          }}
        >
          <ProFormText name="name" label="宏名称" colProps={{ span: 8 }} readonly />
          <ProFormDigit name="speed" label="播放速度" colProps={{ span: 8 }} readonly />
          {macro.playMode === 'holdRepeat' && (
            <ProFormDigit name="repeatInterval" label="重复间隔（毫秒）" colProps={{ span: 8 }} readonly />
          )}
          {macro.playMode === 'sequence' && (
            <ProFormDigit name="playCount" label="播放次数" colProps={{ span: 8 }} readonly />
          )}
          <ProFormSelect
            name="playMode"
            label="播放方式"
            options={PLAY_MODE_OPTIONS}
            colProps={{ span: 8 }}
            readonly
          />
          <ProFormDigit name="stepCount" label="动作数" colProps={{ span: 8 }} readonly />
          <ProFormText name="duration" label="预计时长" colProps={{ span: 8 }} readonly />
          <ProFormText name="createdAt" label="创建时间" colProps={{ span: 8 }} readonly />
          <ProFormText name="updatedAt" label="修改时间" colProps={{ span: 8 }} readonly />
        </ProForm>
      </Card>

      <Card title="步骤明细">
        {macro.steps.length === 0 ? (
          <Empty description="暂无步骤" />
        ) : (
          <Table<MacroStep>
            rowKey="id"
            // 行内是 32px 标准控件，small 内边距把行高压到 48px（与编辑页一致）
            size="small"
            bordered
            pagination={false}
            dataSource={macro.steps}
            columns={columns}
            // 固定列之和 230（序号 80 + 动作类型 150）+ 弹性列最小 420
            scroll={{ x: 650 }}
          />
        )}
      </Card>
    </PageContainer>
  )
}
