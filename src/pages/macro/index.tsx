// 宏库管理（列表页 /macro，PRD 4.4）
// FD 快搭列表规范：PageContainer + ProTable，枚举 valueEnum，操作列 fixed:'right' + 显式 width，
// 查询表单 labelWidth auto / defaultCollapsed / span 6，toolBarRender 放页面级按钮
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Dropdown, Popconfirm, Space, Tooltip, Typography, message } from 'antd'
import { DownOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { PageContainer, ProTable } from '@ant-design/pro-components'
import type { ProColumns, ActionType } from '@ant-design/pro-components'
import { useNavigate } from 'umi'
import {
  duplicateMacro,
  exportMacro,
  getInputStatus,
  importMacros,
  listMacros,
  removeMacro,
} from '@/api/macro'
import { countBindingsForMacro } from '@/api/binding'
import { PLAY_MODE_OPTIONS, type Macro } from '@/types/macro'
import { formatDateTime } from '@/utils/display'
import LogitechImportModal from '@/components/LogitechImportModal'

export default function MacroListPage() {
  const navigate = useNavigate()
  const actionRef = useRef<ActionType>(null)
  // 每个宏被按键绑定的数量（删除确认提示用，PRD 4.4 异常）
  const bindingCounts = useRef<Record<string, number>>({})
  const [inputErrors, setInputErrors] = useState<string[]>([])
  const [logiOpen, setLogiOpen] = useState(false)

  // 输入后端（uiohook / nut-js）不可用时给出降级提示
  useEffect(() => {
    getInputStatus().then((s) => setInputErrors(s.errors))
  }, [])

  /** ProTable request：本地数据 + 名称模糊筛选；顺带拉取按键绑定数 */
  const request = async (params: Record<string, any>) => {
    const list = await listMacros()
    const kw = (params.name ?? '').trim().toLowerCase()
    const data = kw ? list.filter((m) => m.name.toLowerCase().includes(kw)) : list
    const counts: Record<string, number> = {}
    await Promise.all(
      data.map(async (m) => {
        counts[m.id] = await countBindingsForMacro(m.id)
      }),
    )
    bindingCounts.current = counts
    return { data, success: true, total: data.length }
  }

  const handleDelete = async (row: Macro) => {
    const res = await removeMacro(row.id)
    if (!res.ok) {
      message.error('删除失败')
      return
    }
    message.success(res.removedBindings > 0 ? `已删除，同步解除 ${res.removedBindings} 个按键绑定` : '已删除')
    actionRef.current?.reload()
  }

  const handleDuplicate = async (row: Macro) => {
    const copy = await duplicateMacro(row.id)
    if (!copy) {
      message.error('复制失败')
      return
    }
    message.success(`已复制为「${copy.name}」`)
    navigate(`/macro/edit/${copy.id}`)
  }

  const handleExport = async (row: Macro) => {
    const res = await exportMacro(row.id)
    if (res.canceled) return
    if (!res.ok) {
      message.error('导出失败')
      return
    }
    message.success(res.path ? `已导出：${res.path}` : '已导出')
  }

  const handleImport = async () => {
    const res = await importMacros()
    if (res.canceled) return
    if (res.skipped > 0) message.warning(`文件格式不正确，已跳过 ${res.skipped} 个文件`)
    if (res.imported > 0) message.success(`已导入 ${res.imported} 个宏`)
    if (res.imported === 0 && res.skipped === 0) message.info('未选择文件')
    actionRef.current?.reload()
  }

  const columns: ProColumns<Macro>[] = [
    {
      title: '宏名称',
      dataIndex: 'name',
      // 不设 width = 弹性列：table-layout fixed 下，容器宽于列宽之和时余量全给这一列，
      // 其余列（含操作列）保持死宽不被拉伸（hl-05 操作列宽度规范）
      ellipsis: true,
      render: (_dom, row) => (
        <Typography.Link onClick={() => navigate(`/macro/detail/${row.id}`)}>{row.name}</Typography.Link>
      ),
    },
    {
      title: '播放方式',
      dataIndex: 'playMode',
      width: 120,
      search: false,
      // 只读展示，编辑请进宏编辑页「基本信息」
      valueEnum: Object.fromEntries(PLAY_MODE_OPTIONS.map((o) => [o.value, { text: o.label }])),
    },
    {
      title: '修改时间',
      dataIndex: 'updatedAt',
      width: 160,
      search: false,
      render: (_dom, row) => formatDateTime(row.updatedAt),
    },
    {
      title: '操作',
      valueType: 'option',
      // 查看入口由「宏名称」链接承担；操作列最多 3 项（含「更多」）：
      // 平铺 编辑 / 复制，导出与删除收进下拉；内容 ≈ 130 + 内边距 ≈ 140
      width: 140,
      className: 'openmacro-op-cell',
      fixed: 'right',
      render: (_v, row) => (
        // 平铺 2 个高频操作，导出 / 删除收进「更多」（hl-05 操作列规范）
        <Space size={4}>
          <a onClick={() => navigate(`/macro/edit/${row.id}`)}>编辑</a>
          <a onClick={() => handleDuplicate(row)}>复制</a>
          <Dropdown
            trigger={['click']}
            popupRender={() => (
              <div
                style={{
                  background: '#fff',
                  borderRadius: 8,
                  boxShadow: '0 6px 16px rgba(0, 0, 0, 0.08)',
                  padding: 4,
                  minWidth: 120,
                }}
              >
                <Button type="text" block onClick={() => handleExport(row)}>
                  导出
                </Button>
                <Popconfirm
                  title="删除宏"
                  description={
                    (bindingCounts.current[row.id] ?? 0) > 0
                      ? `该宏已被 ${bindingCounts.current[row.id]} 个按键绑定，删除后这些按键将恢复为无动作`
                      : '删除后不可恢复，确定删除吗？'
                  }
                  okText="确定"
                  cancelText="取消"
                  onConfirm={() => handleDelete(row)}
                >
                  <Button type="text" block danger>
                    删除
                  </Button>
                </Popconfirm>
              </div>
            )}
          >
            <a>
              更多 <DownOutlined />
            </a>
          </Dropdown>
        </Space>
      ),
    },
  ]

  return (
    <PageContainer
      title={
        <Space size={4}>
          宏库管理
          <Tooltip title="支持新建、编辑、复制、删除、搜索与导入导出；动作数、预计时长、创建/修改时间均为系统计算只读">
            <QuestionCircleOutlined style={{ color: 'rgba(0, 0, 0, 0.45)' }} />
          </Tooltip>
        </Space>
      }
    >
      {inputErrors.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="输入捕获 / 回放模块当前不可用"
          description={inputErrors.join('；')}
        />
      )}
      <ProTable<Macro>
        columns={columns}
        actionRef={actionRef}
        request={request}
        rowKey="id"
        search={{ labelWidth: 'auto', defaultCollapsed: true, span: 6 }}
        pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 个宏` }}
        toolBarRender={() => [
          <Button key="import" onClick={handleImport}>
            导入
          </Button>,
          <Button key="importLogitech" onClick={() => setLogiOpen(true)}>
            导入罗技宏
          </Button>,
          <Button key="new" type="primary" onClick={() => navigate('/macro/create')}>
            新建宏
          </Button>,
        ]}
        toolbar={{ style: { justifyContent: 'flex-start' } }}
        // 固定列之和 420（播放方式 120 + 修改时间 160 + 操作 140）+ 弹性列宏名称最小 220
        scroll={{ x: 640 }}
        size="middle"
        locale={{ emptyText: '暂无宏，点击「新建宏」开始录制' }}
      />
      <LogitechImportModal open={logiOpen} onClose={() => setLogiOpen(false)} onImported={() => actionRef.current?.reload()} />
    </PageContainer>
  )
}
