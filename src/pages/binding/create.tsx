// 新增绑定（独立页 /binding/create）
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Modal, Space, Typography, message } from 'antd'
import { PageContainer } from '@ant-design/pro-components'
import { useNavigate } from 'umi'
import BindingEditor from '@/components/BindingEditor'
import {
  getInputConfig,
  onCaptureResult,
  pickExecutable,
  saveBindings,
  setInputConfig,
  startKeyCapture,
  validateProgramPath,
} from '@/api/binding'
import { listMacros } from '@/api/macro'
import type { Macro } from '@/types/macro'
import { createEmptyBinding, isReservedTrigger, type KeyBinding, type TriggerMode } from '@/types/binding'

export default function BindingCreatePage() {
  const navigate = useNavigate()
  const [binding, setBinding] = useState<KeyBinding>(() => createEmptyBinding())
  const [macros, setMacros] = useState<Macro[]>([])
  const [complianceDismissed, setComplianceDismissed] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [complianceOpen, setComplianceOpen] = useState(false)
  const [dontRemind, setDontRemind] = useState(false)

  // 捕获改走事件推送（与录制同模型）：点击时记录意图，结果到达后按意图回填
  const captureIntentRef = useRef<{ intent: 'trigger' | 'action'; mode: TriggerMode } | null>(null)
  const captureIntentAtRef = useRef(0)

  useEffect(() => {
    Promise.all([getInputConfig(), listMacros()]).then(([cfg, ms]) => {
      setComplianceDismissed(cfg.complianceDismissed)
      setMacros(ms)
    })
  }, [])

  useEffect(
    () =>
      onCaptureResult((r) => {
        captureIntentAtRef.current = Date.now()
        setCapturing(false)
        const pending = captureIntentRef.current
        captureIntentRef.current = null
        if (!r.ok) {
          if (r.reason === 'canceled') message.info('已取消捕获')
          else message.error(r.reason ?? '捕获失败')
          return
        }
        if (!pending) return
        if (pending.intent === 'trigger') {
          if (!r.kind || !r.code) return
          setBinding((prev) => ({
            ...prev,
            trigger: { kind: r.kind!, code: r.code!, label: r.label ?? r.code! },
          }))
          message.success(`绑定按键已设为 ${r.label ?? r.code}`)
          return
        }
        // 键盘动作只接受键盘键；未启用对应动作时自动启用并写入，保证捕获值一定反写到输入框
        if (r.kind !== 'keyboard' || !r.code) {
          message.warning('键盘动作请按下键盘按键（鼠标键不能作为键盘动作）')
          return
        }
        const target = pending.mode
        const code = r.code
        setBinding((prev) => ({ ...prev, [target]: { type: 'keyboard', key: code } }))
        message.success(`${target === 'hold' ? '长按' : '短按'}动作按键已设为 ${code}`)
      }),
    [],
  )

  const handleCapture = useCallback(async (intent: 'trigger' | 'action', mode?: TriggerMode) => {
    // 捕获结果刚到的短暂窗口内忽略重复触发（结果那次点击可能落在按钮上）
    if (Date.now() - captureIntentAtRef.current < 600) return
    const target: TriggerMode = mode === 'hold' ? 'hold' : 'tap'
    const r = await startKeyCapture()
    if (!r.ok) {
      message.error(r.reason ?? '捕获失败')
      return
    }
    captureIntentRef.current = { intent, mode: target }
    setCapturing(true)
  }, [])

  const handlePickExecutable = useCallback(async () => {
    const r = await pickExecutable()
    if (r.ok && r.path) {
      setBinding((prev) => {
        const patch: Partial<KeyBinding> = {}
        if (prev.tap?.type === 'launch') patch.tap = { ...prev.tap, path: r.path }
        if (prev.hold?.type === 'launch') patch.hold = { ...prev.hold, path: r.path }
        return { ...prev, ...patch }
      })
    }
  }, [])

  const commitSave = async (dismissCompliance: boolean) => {
    if (!binding.trigger.code) {
      message.error('请先捕获绑定按键')
      return
    }
    if (isReservedTrigger(binding.trigger)) {
      message.error('左键 / 右键为系统保留按键，不能作为绑定按键')
      return
    }
    // 短按 / 长按允许都不启用：保存为「未启用」绑定（仅占位绑定键，不执行任何动作）
    for (const a of [binding.tap, binding.hold]) {
      if (a?.type === 'keyboard' && !a.key) return void message.error('请先捕获键盘动作按键')
      if (a?.type === 'macro' && !a.macroId) return void message.error('请选择宏')
      if (a?.type === 'launch' && !a.path) return void message.error('请选择程序')
    }
    for (const a of [binding.tap, binding.hold]) {
      if (a?.type === 'launch') {
        const r = await validateProgramPath(a.path ?? '')
        if (!r.ok) return void message.error(r.reason ?? '程序路径无效')
      }
    }
    setSaving(true)
    try {
      const list = (await getInputConfig()).bindings
      const res = await saveBindings([...list, binding])
      if (!res.ok) {
        message.error(res.reason ?? '保存失败')
        return
      }
      if (dismissCompliance) await setInputConfig({ complianceDismissed: true })
      message.success('已新增绑定，立即生效')
      navigate('/binding')
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async () => {
    const hasMacro = [binding.tap, binding.hold].some((a) => a?.type === 'macro')
    if (hasMacro && !complianceDismissed) {
      setDontRemind(false)
      setComplianceOpen(true)
      return
    }
    await commitSave(false)
  }

  return (
    <PageContainer
      title="新增绑定"
      onBack={() => navigate('/binding')}
      extra={[
        <Button key="cancel" style={{ minWidth: 88 }} onClick={() => navigate('/binding')}>
          取消
        </Button>,
        <Button key="save" type="primary" style={{ minWidth: 88 }} loading={saving} onClick={handleSave}>
          保存
        </Button>,
      ]}
    >
      <BindingEditor
        binding={binding}
        macros={macros}
        capturing={capturing}
        onBindingChange={(patch) => setBinding((prev) => ({ ...prev, ...patch }))}
        onCapture={handleCapture}
        onPickExecutable={handlePickExecutable}
      />

      {/* 合规风险提示（PRD 4.7） */}
      <Modal
        open={complianceOpen}
        title="合规风险提示"
        okText="确定"
        cancelText="取消"
        onOk={async () => {
          setComplianceOpen(false)
          await commitSave(dontRemind)
        }}
        onCancel={() => {
          setComplianceOpen(false)
          message.info('已取消，本次绑定未生效')
        }}
      >
        <Space direction="vertical" size={12}>
          <Typography.Paragraph style={{ marginBottom: 0 }}>
            部分竞技游戏官方规则将宏列为作弊行为，使用可能导致封号，须自行承担风险。
          </Typography.Paragraph>
          <Checkbox checked={dontRemind} onChange={(e) => setDontRemind(e.target.checked)}>
            不再提示
          </Checkbox>
        </Space>
      </Modal>
    </PageContainer>
  )
}
