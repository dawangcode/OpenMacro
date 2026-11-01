// 新增防抖规则（独立页 /debounce/create，PRD 4.3）
import { useEffect, useRef, useState } from 'react'
import { Button, message } from 'antd'
import { PageContainer } from '@ant-design/pro-components'
import { useNavigate } from 'umi'
import DebounceEditor from '@/components/DebounceEditor'
import { listDebounceRules, onCaptureResult, saveDebounceRules, startKeyCapture } from '@/api/binding'
import { createEmptyDebounceRule, type DebounceRule } from '@/types/binding'

export default function DebounceCreatePage() {
  const navigate = useNavigate()
  const [rule, setRule] = useState<DebounceRule>(() => createEmptyDebounceRule())
  const [capturing, setCapturing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [existing, setExisting] = useState<DebounceRule[]>([])

  useEffect(() => {
    listDebounceRules().then(setExisting)
  }, [])

  // 捕获结果经事件推送返回（与录制 / 绑定同模型）：点击时记录意图，结果到达后回填绑定按键
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
        setRule((prev) => ({
          ...prev,
          trigger: { kind: r.kind!, code: r.code!, label: r.label ?? r.code! },
        }))
        message.success(`绑定按键已设为 ${r.label ?? r.code}`)
      }),
    [],
  )

  const handleCapture = async () => {
    // 捕获结果刚到的短暂窗口内忽略重复触发（结果那次点击可能落在按钮上）
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
    if (!rule.trigger.code) {
      message.error('请先捕获绑定按键')
      return
    }
    if (
      existing.some(
        (r) => r.trigger.kind === rule.trigger.kind && r.trigger.code === rule.trigger.code,
      )
    ) {
      message.error(`绑定按键「${rule.trigger.label || rule.trigger.code}」已存在防抖规则`)
      return
    }
    setSaving(true)
    try {
      const res = await saveDebounceRules([...existing, rule])
      if (!res.ok) {
        message.error(res.reason ?? '保存失败')
        return
      }
      message.success('已新增防抖规则，立即生效')
      navigate('/debounce')
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageContainer
      title="新增防抖规则"
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
        onRuleChange={(patch) => setRule((prev) => ({ ...prev, ...patch }))}
        onCapture={handleCapture}
      />
    </PageContainer>
  )
}
