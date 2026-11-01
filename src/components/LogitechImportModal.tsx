// 导入罗技 G HUB 宏弹窗（src/components/LogitechImportModal.tsx）
// 打开后全库扫描 settings.db（遍历所有表/列的 JSON 单元格）并列出宏；
// 可手动指定 settings.db；可重新扫描；勾选后导入到宏库。
import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Modal, Space, Table, Tag, Tooltip, Typography, message } from 'antd'
import { CopyOutlined, FolderOpenOutlined } from '@ant-design/icons'
import { HintIcon } from '@/components/HintIcon'
import type { ColumnsType } from 'antd/es/table'
import {
  logitechImport,
  logitechMacros,
  logitechOpenFolder,
  logitechPickDb,
  type LogitechMacro,
  type LogitechScanResult,
} from '@/api/macro'

/** 数据库文件行的问号说明：位置、内容与手动指定时机 */
const DB_FILE_HINT =
  '罗技 G HUB 的本地配置库，宏以 cards 卡片形式存放在里面。默认读取 %LOCALAPPDATA%\\LGHUB\\settings.db 并全库扫描；路径不同或未识别到宏时，可用「选择 settings.db 文件」手动指定。'

interface Props {
  open: boolean
  onClose: () => void
  onImported: () => void
}

export default function LogitechImportModal({ open, onClose, onImported }: Props) {
  const [loading, setLoading] = useState(false)
  const [macros, setMacros] = useState<LogitechMacro[]>([])
  const [schema, setSchema] = useState<LogitechScanResult['schema']>([])
  const [scanned, setScanned] = useState(0)
  const [dbPath, setDbPath] = useState('')
  const [reason, setReason] = useState<string | null>(null)
  const [selected, setSelected] = useState<React.Key[]>([])
  const [importing, setImporting] = useState(false)

  const load = useCallback(async (dbPath?: string) => {
    setLoading(true)
    setReason(null)
    setSelected([])
    const res = await logitechMacros(dbPath)
    setLoading(false)
    setSchema(res.schema)
    setScanned(res.scanned)
    setDbPath(res.path ?? '')
    setMacros(res.macros)
    if (!res.ok) {
      setReason(res.reason ?? '读取失败')
      return
    }
    if (res.macros.length === 0) {
      setReason('未识别到任何宏')
      return
    }
    // 扫描到宏后默认全选，用户直接点「导入选中」即可
    setSelected(res.macros.map((m) => m.name))
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const handlePick = async () => {
    const res = await logitechPickDb()
    if (res.canceled || !res.path) return
    await load(res.path)
  }

  const handleCopyPath = async () => {
    if (!dbPath) {
      message.warning('暂无数据库路径')
      return
    }
    try {
      await navigator.clipboard.writeText(dbPath)
      message.success('已复制')
    } catch {
      message.error('复制失败，请手动选择文本复制')
    }
  }

  const handleOpenFolder = async () => {
    if (!dbPath) {
      message.warning('暂无数据库路径')
      return
    }
    try {
      const res = await logitechOpenFolder(dbPath)
      if (!res.ok) message.error(res.reason ?? '打开文件夹失败')
    } catch (e) {
      message.error(`打开文件夹失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handleImport = async () => {
    const items = macros.filter((m) => selected.includes(m.name))
    if (items.length === 0) {
      message.warning('请先勾选要导入的宏')
      return
    }
    setImporting(true)
    const res = await logitechImport(items)
    setImporting(false)
    if (!res.ok) {
      message.error(res.reason ?? '导入失败')
      return
    }
    message.success(`已导入 ${res.imported} 个宏：${res.names.join('、')}`)
    onImported()
    onClose()
  }

  const columns: ColumnsType<LogitechMacro> = [
    {
      title: '宏名称',
      dataIndex: 'name',
      ellipsis: true,
    },
    {
      title: '步骤数',
      key: 'count',
      width: 90,
      render: (_v, row) => row.steps.length,
    },
    {
      title: '映射提示',
      key: 'warnings',
      width: 220,
      render: (_v, row) =>
        row.warnings.length ? (
          <Space size={[0, 4]} wrap>
            {row.warnings.slice(0, 3).map((w, i) => (
              <Tag key={i} color="warning">
                {w}
              </Tag>
            ))}
            {row.warnings.length > 3 && <Tag color="warning">+{row.warnings.length - 3}</Tag>}
          </Space>
        ) : (
          <Typography.Text type="secondary">无</Typography.Text>
        ),
    },
  ]

  return (
    <Modal
      title="导入罗技 G HUB 宏"
      open={open}
      onCancel={onClose}
      width={720}
      footer={[
        <Button key="scan" onClick={() => void load()} loading={loading}>
          重新扫描
        </Button>,
        <Button key="pick" onClick={handlePick}>
          选择 settings.db 文件
        </Button>,
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button
          key="import"
          type="primary"
          loading={importing}
          disabled={selected.length === 0}
          onClick={handleImport}
        >
          导入选中（{selected.length}）
        </Button>,
      ]}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="自动全库扫描 G HUB 的 settings.db（遍历所有表/列找 JSON 宏）；若未识别或路径不同，请点「选择 settings.db 文件」手动指定。导入后建议在编辑页核对按键与延迟。"
      />
      {reason && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={reason} />}
      <div style={{ marginBottom: 12 }}>
        <Space size={4} style={{ marginBottom: 4 }}>
          数据库文件
          <HintIcon text={DB_FILE_HINT} />
        </Space>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minWidth: 0,
            height: 30,
            padding: '3px 8px',
            background: '#f7f7f7',
            borderRadius: 6,
          }}
        >
          <Tooltip title={dbPath} placement="topLeft">
            <Typography.Text
              style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {dbPath || '（未读取）'}
            </Typography.Text>
          </Tooltip>
          <Tooltip title="复制路径">
            <Button
              type="text"
              aria-label="复制路径"
              icon={<CopyOutlined style={{ fontSize: 14 }} />}
              disabled={!dbPath}
              onClick={handleCopyPath}
              style={{ height: 22, width: 22, minWidth: 22, padding: 0, flex: '0 0 auto' }}
            />
          </Tooltip>
          <Tooltip title="在文件管理器中显示数据库文件">
            <Button
              type="text"
              aria-label="在文件管理器中显示数据库文件"
              icon={<FolderOpenOutlined style={{ fontSize: 14 }} />}
              disabled={!dbPath}
              onClick={handleOpenFolder}
              style={{ height: 22, width: 22, minWidth: 22, padding: 0, flex: '0 0 auto' }}
            />
          </Tooltip>
        </div>
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography.Text type="secondary">
            扫描结果：{schema.length} 张表 / {scanned} 个 JSON 单元格
          </Typography.Text>
          {schema.length > 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12, lineHeight: '20px' }}>
              {schema.map((s) => `${s.table}(${s.columns.join(',')} · ${s.rows}行)`).join('；')}
            </Typography.Text>
          )}
        </div>
      </div>
      <Table<LogitechMacro>
        rowKey="name"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={macros}
        rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys) }}
        pagination={{ pageSize: 8, showTotal: (t) => `共 ${t} 个宏` }}
        locale={{ emptyText: '暂无宏' }}
      />
    </Modal>
  )
}
