// 编辑防抖规则（独立页 /debounce/edit/:id，PRD 4.3）
import { useEffect, useRef, useState } from 'react'
import { Button, message } from 'antd'
import { PageContainer } from '@ant-design/pro-components'
import { useNavigate, useParams } from 'umi'
import DebounceEditor from '@/components/DebounceEditor'
import { listDebounceRules, onCaptureResult, saveDebounceRules, startKeyCapture } from '@/api/binding'
import type { DebounceRule } from '@/types/binding'

export default function DebounceEditPage() {
  const navigate = useNavigate()
  // 路由有 :id 路径段 → 用 useParams（useLocation().query 恒为 undefined，禁用）
  const params = useParams<{ id: string }>()
  const id = params.id ?? ''

  const [rule, setRule] = useState<DebounceRule | null>(null)
  const [rules, setRules] = useState<DebounceRule[]>([])
  const [capturing, setCapturing] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    listDebounceRules().then((list) => {
      setRules(list)
      const found = list.find((r) => r.id === id)
      if (found) setRule(found)
      else {
        message.error('防抖规则不存在')
        navigate('/debounce')
      }
    })
  }, [id, navigate])

  // 捕获结果经事件推送返回（与录制 / 绑定同模型）
  const captureIntentAtRef = useRef(0)
  useEffect(
    () =>
      onCaptureResult((r) => {
        captureIntentAtRef.current = Date.now()
        setCapturing(false)
        if (!r.ok) {
          if (r.reason === 'canceled') message.info('已取消捕获')
          else message.error(r.reason ?? '捕获失败')
          return
        }
        if (!r.kind || !r.code) return
        setRule((prev) =>
          prev ? { ...prev, trigger: { kind: r.kind!, code: r.code!, label: r.label ?? r.code! } } : prev,
        )
        message.success(`绑定按键已设为 ${r.label ?? r.code}`)
      }),
    [],
  )

  const handleCapture = async () => {
    if (Date.now() - captureIntentAtRef.current < 600) return
    // 防抖规则允许捕获左键 / 右键（鼠标连击主要发生在左右键）
    const r = await startKeyCapture({ allowReservedMouse: true })
    if (!r.ok) {
      message.error(r.reason ?? '捕获失败')
      return
    }
    setCapturing(true)
  }

  const handleSave = async () => {
    if (!rule) return
    if (!rule.trigger.code) {
      message.error('请先捕获绑定按键')
      return
    }
    if (
      rules.some(
        (r) =>
          r.id !== rule.id &&
          r.trigger.kind === rule.trigger.kind &&
          r.trigger.code === rule.trigger.code,
      )
    ) {
      message.error(`绑定按键「${rule.trigger.label || rule.trigger.code}」已存在防抖规则`)
      return
    }
    setSaving(true)
    try {
      const res = await saveDebounceRules(rules.map((r) => (r.id === rule.id ? rule : r)))
      if (!res.ok) {
        message.error(res.reason ?? '保存失败')
        return
      }
      message.success('已保存，防抖规则立即生效')
      navigate('/debounce')
    } finally {
      setSaving(false)
    }
  }

  if (!rule) return <PageContainer title="编辑防抖规则" />

  return (
    <PageContainer
      title={`编辑防抖规则：${rule.trigger.label || rule.trigger.code || '未设置'}`}
      onBack={() => navigate('/debounce')}
      extra={[
        <Button key="cancel" style={{ minWidth: 88 }} onClick={() => navigate('/debounce')}>
          取消
        </Button>,
        <Button key="save" type="primary" style={{ minWidth: 88 }} loading={saving} onClick={handleSave}>
          保存
        </Button>,
      ]}
    >
      <DebounceEditor
        rule={rule}
        capturing={capturing}
        onRuleChange={(patch) => setRule((prev) => (prev ? { ...prev, ...patch } : prev))}
        onCapture={handleCapture}
      />
    </PageContainer>
  )
}
