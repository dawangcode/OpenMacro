// 宏录制与编辑（详情页 /macro/edit，PRD 4.5）
// FD 快搭表单规范：PageContainer（标题 / onBack / extra 取消·保存）+ ProForm 分 Card 承载字段，
// Card 与字段之间隔 ProForm submitter={false} 中间层；时间轴是明细表，用 antd Table 嵌在表单页内。
// 新增 / 编辑复用本页，以查询串 id 区分：有 id 为编辑，无 id 为新增
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Dropdown,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { DownOutlined, HolderOutlined } from '@ant-design/icons'
import type { TableProps } from 'antd'
import { PageContainer, ProForm, ProFormDigit, ProFormSelect, ProFormText } from '@ant-design/pro-components'
import { useNavigate, useParams } from 'umi'
import {
  cancelRecording,
  getMacro,
  getPlaybackState,
  onMacroEvent,
  playMacro,
  saveMacro,
  startRecording,
  stopMacro,
  stopRecording,
} from '@/api/macro'
import {
  DEFAULT_PLAY_COUNT,
  DEFAULT_REPEAT_INTERVAL,
  MACRO_NAME_MAX,
  MOUSE_ACTION_OPTIONS,
  KEYBOARD_ACTION_OPTIONS,
  MOUSE_BUTTON_OPTIONS,
  PLAY_COUNT_MAX,
  PLAY_COUNT_MIN,
  PLAY_MODE_OPTIONS,
  REPEAT_INTERVAL_MAX,
  REPEAT_INTERVAL_MIN,
  SPEED_MAX,
  SPEED_MIN,
  STEP_DEFAULT_DELAY,
  STEP_KIND_OPTIONS,
  STEP_MAX_DELAY,
  STEP_MIN_DELAY,
  SYSTEM_COMMAND_OPTIONS,
  WHEEL_AMOUNT_MAX,
  WHEEL_AMOUNT_MIN,
  LOOP_COUNT_MAX,
  LOOP_COUNT_MIN,
  type Macro,
  type MacroStep,
  type MacroStepKind,
  type PlayMode,
  createEmptyMacro,
  normalizeStepDelays,
  expandStepKeys,
  validateLoops,
} from '@/types/macro'
import { buildLabel, parseXMouse } from '@/utils/macro'

function newStepId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/**
 * 时间轴列内控件宽度三档标准：同类控件一律同宽，禁止逐行微调
 * - select：所有下拉（动作类型 / 键盘动作 / 鼠标动作 / 鼠标按键 / 系统命令）
 * - input：所有文本填空（键盘按键 / 文本输入）
 * - number：所有数字输入（延迟 / 循环次数 / 坐标 / 滚轮量）
 */
const CTRL_W = {
  select: 120,
  input: 180,
  number: 120,
}

/** 页头右上按钮等宽：组内最长文案 4 字 → 4×14 + 内边距 32 = 88（hl-05 页头按钮组规范） */
const OP_BTN_W = { minWidth: 88 }

/** 展示摘要随内容变化重算，避免「动作内容」与保存值不一致（编辑页 / 详情页共用，见 utils/macro） */
/** 导入弹窗右侧速查表：标记 → 含义 */
const XMBC_MARKS: [string, string][] = [
  ['{WAITMS:n} / {PAUSE:n}', '等待 n 毫秒'],
  ['{LMBD} {LMBU} {LMB}', '左键按下 / 抬起 / 单击（RMB、MMB 同理）'],
  ['{CTRL} {SHIFT} {ALT} {WIN}', '修饰键，组合到下一动作（L/R 变体区分左右）'],
  ['{CTRLDOWN} … {CTRLUP}', '按住修饰键的区间'],
  ['{F1}~{F12} {ENTER} {ESC}', '具名键（大小写不敏感）'],
  ['{WHEEL UP} / {WHEEL DOWN}', '滚轮（可带量，如 {WHEEL UP 3}）'],
  ['其他单字符', '按一次对应的键盘按键'],
]

/** 速查表单个条目 */
const MarkRow = ({ mark, desc }: { mark: string; desc: string }) => (
  <div style={{ display: 'flex', gap: 8, padding: '3px 0', alignItems: 'baseline' }}>
    <code
      style={{
        flexShrink: 0,
        minWidth: 150,
        fontSize: 12,
        background: 'rgba(0, 0, 0, 0.04)',
        borderRadius: 4,
        padding: '1px 6px',
      }}
    >
      {mark}
    </code>
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
      {desc}
    </Typography.Text>
  </div>
)

/** 新步骤默认无延迟：需要等待时显式新增「等待」步骤，时间信息只由它承载 */
function defaultStepFor(kind: MacroStepKind): MacroStep {
  const base: MacroStep = {
    id: newStepId(),
    kind,
    label: '',
    delay: 0,
  }
  if (kind === 'keyboard') return { ...base, key: '', action: 'click' }
  if (kind === 'mouse') return { ...base, key: 'left', action: 'down' }
  if (kind === 'text') return { ...base, text: '' }
  if (kind === 'command') return { ...base, command: 'volumeUp' }
  if (kind === 'loopStart') return { ...base, loopCount: 2 }
  // 等待步骤：默认 100ms（这是唯一承载时长的步骤类型）
  if (kind === 'delay') return { ...base, delay: 100 }
  return base
}

export default function MacroEditPage() {
  const navigate = useNavigate()
  // 路由有 :id 路径段（/macro/edit/:id）→ 必须用 useParams（useLocation().query 恒为 undefined，禁用）
  const params = useParams<{ id: string }>()
  const id = params.id ?? ''

  const [macro, setMacro] = useState<Macro>(() => createEmptyMacro('未命名宏'))
  const [playMode, setPlayMode] = useState<PlayMode>('once')
  const [recordingSteps, setRecordingSteps] = useState<MacroStep[]>([])
  const [phase, setPhase] = useState<'idle' | 'countdown' | 'recording'>('idle')
  const [countdown, setCountdown] = useState(0)
  const [captureDelay, setCaptureDelay] = useState(true)
  const [captureMouseMove, setCaptureMouseMove] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [recordError, setRecordError] = useState('')
  const [playback, setPlayback] = useState({ running: false, progress: '未运行' })
  // 时间轴拖排序：dragIndex 为被拖行，dragOverIndex 为当前悬停行
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const dragYRef = useRef(0)
  const autoScrollRef = useRef<number | null>(null)
  // 文本导入：弹窗 + 文本框（支持从 .mac/.txt/.json 文件载入）
  const [showXMouse, setShowXMouse] = useState(false)
  const [xmouseText, setXmouseText] = useState('')
  const xmouseFileRef = useRef<HTMLInputElement>(null)

  // ProForm 实例：表单字段（名称 / 播放设置）与时间轴步骤（本地 state）分离，保存时合并
  const [form] = ProForm.useForm()

  useEffect(() => {
    let alive = true
    if (!id) {
      setLoaded(true)
      return
    }
    getMacro(id).then((m) => {
      if (!alive) return
      if (m) {
        setMacro(m)
        setPlayMode(m.playMode)
        // 异步加载后回填表单（initialValues 只在挂载时生效一次）
        form.setFieldsValue({
          name: m.name,
          playMode: m.playMode,
          speed: m.speed,
          repeatInterval: m.repeatInterval,
          playCount: m.playCount,
        })
      } else message.error('宏不存在')
      setLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [id, form])

  // 录制中的已采集步骤用 ref 留一份最新值：
  // 主进程可通过热键（F9）自行停止，此时只有事件通知、没有返回值可拿
  const recordingStepsRef = useRef<MacroStep[]>([])
  useEffect(() => {
    recordingStepsRef.current = recordingSteps
  }, [recordingSteps])

  // 主进程事件：录制状态 / 倒计时 / 播放状态
  useEffect(() => {
    const off = onMacroEvent((channel, payload) => {
      if (channel === 'macro:record:state') {
        const s = payload as { phase: 'idle' | 'countdown' | 'recording'; countdown: number; steps: MacroStep[]; reason?: string }
        setPhase(s.phase)
        setCountdown(s.countdown)
        setRecordError(s.reason ?? '')
        if (s.phase === 'idle') {
          // 停止录制（按钮或热键）：把已采集步骤落到时间轴，只合并一次
          const collected = recordingStepsRef.current
          recordingStepsRef.current = []
          if (collected.length) {
            setMacro((prev) => ({
              ...prev,
              steps: [...prev.steps, ...collected.map((st) => ({ ...st, label: st.label || buildLabel(st) }))],
            }))
            message.success(`已录制 ${collected.length} 个步骤`)
          }
          setRecordingSteps([])
        } else {
          setRecordingSteps(s.steps ?? [])
        }
      } else if (channel === 'macro:record:countdown') {
        const s = payload as { countdown: number }
        setCountdown(s.countdown)
      } else if (channel === 'macro:playback:state') {
        const s = payload as { running: boolean; progress: string }
        setPlayback({ running: s.running, progress: s.progress })
      }
    })
    getPlaybackState().then((s) => setPlayback({ running: s.running, progress: s.progress }))
    return off
  }, [])

  const steps = useMemo(() => [...macro.steps, ...recordingSteps], [macro.steps, recordingSteps])
  const recording = phase !== 'idle'

  const patchMacro = (patch: Partial<Macro>) => setMacro((prev) => ({ ...prev, ...patch }))

  const updateStep = (index: number, patch: Partial<MacroStep>) => {
    const target = steps[index]
    if (!target) return
    const next = { ...target, ...patch }
    next.label = buildLabel(next)
    if (index < macro.steps.length) {
      const list = [...macro.steps]
      list[index] = next
      patchMacro({ steps: list })
    } else {
      const list = [...recordingSteps]
      list[index - macro.steps.length] = next
      setRecordingSteps(list)
    }
  }

  const deleteStep = (index: number) => {
    if (index < macro.steps.length) {
      patchMacro({ steps: macro.steps.filter((_, i) => i !== index) })
    } else {
      const ri = index - macro.steps.length
      setRecordingSteps(recordingSteps.filter((_, i) => i !== ri))
    }
  }

  const moveStep = (index: number, dir: -1 | 1) => {
    const targetIndex = index + dir
    if (targetIndex < 0 || targetIndex >= steps.length) return
    // 录制中的步骤不参与移动，避免与主进程采集状态打架
    if (index >= macro.steps.length || targetIndex >= macro.steps.length) {
      message.info('请先停止录制再调整顺序')
      return
    }
    const list = [...macro.steps]
    const [item] = list.splice(index, 1)
    list.splice(targetIndex, 0, item)
    patchMacro({ steps: list })
  }

  const stopAutoScroll = () => {
    if (autoScrollRef.current !== null) {
      cancelAnimationFrame(autoScrollRef.current)
      autoScrollRef.current = null
    }
  }

  // 表体不固定高度、页面整体滚动：拖到视口上下边缘时持续滚动，长列表也能拖到视口外
  const startAutoScroll = () => {
    if (autoScrollRef.current !== null) return
    const tick = () => {
      const y = dragYRef.current
      const edge = 96
      const vh = window.innerHeight
      if (y < edge) window.scrollBy(0, -Math.ceil((edge - y) / 6))
      else if (y > vh - edge) window.scrollBy(0, Math.ceil((y - (vh - edge)) / 6))
      autoScrollRef.current = requestAnimationFrame(tick)
    }
    autoScrollRef.current = requestAnimationFrame(tick)
  }

  // 卸载时兜底停止：拖拽途中页面跳转，rAF 循环不会自行结束
  useEffect(() => stopAutoScroll, [])

  /** 拖拽排序：把 from 行放到 to 行的位置（目标行及其后顺移） */
  const reorderStep = (from: number, to: number) => {
    if (from === to || recording) return
    if (from < 0 || from >= macro.steps.length || to < 0 || to >= macro.steps.length) return
    const list = [...macro.steps]
    const [item] = list.splice(from, 1)
    list.splice(to, 0, item)
    patchMacro({ steps: list })
  }

  const handleDragStart = (e: DragEvent<HTMLElement>, index: number) => {
    if (recording) {
      e.preventDefault()
      return
    }
    dragYRef.current = e.clientY
    setDragIndex(index)
    setDragOverIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    // Firefox：不写数据 dragstart 不生效
    e.dataTransfer.setData('text/plain', String(index))
    startAutoScroll()
  }

  const handleDragEnd = () => {
    setDragIndex(null)
    setDragOverIndex(null)
    stopAutoScroll()
  }

  /** 在选中行下方插入，默认动作类型键盘动作（PRD 4.5 交互规则） */
  const insertStep = (index: number) => {
    if (recording) {
      message.info('录制中不能编辑时间轴')
      return
    }
    const list = [...macro.steps]
    list.splice(index + 1, 0, defaultStepFor('keyboard'))
    patchMacro({ steps: list.map((s) => ({ ...s, label: s.label || buildLabel(s) })) })
  }

  const appendStep = () => {
    if (recording) {
      message.info('录制中不能编辑时间轴')
      return
    }
    const step = defaultStepFor('keyboard')
    patchMacro({ steps: [...macro.steps, { ...step, label: buildLabel(step) }] })
  }

  /** 清空全部步骤：编辑中的步骤与录制中已采集的步骤一起清掉（二次确认由 Popconfirm 承担） */
  const clearSteps = () => {
    if (recording) {
      message.info('请先停止录制再清空步骤')
      return
    }
    patchMacro({ steps: [] })
    setRecordingSteps([])
    message.success('已清空全部步骤')
  }

  /** 从 .txt/.mac 文件载入文本到文本框（满足「直接导入文件」诉求） */
  const handleXMouseFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setXmouseText(String(reader.result ?? ''))
    reader.readAsText(file)
    e.target.value = ''
  }

  /** 解析文本并追加到时间轴：自动识别 JSON 完整格式、XMBC 内联格式 */
  const handleImportXMouse = () => {
    if (recording) {
      message.info('录制中不能编辑时间轴')
      return
    }
    let parsed: MacroStep[] = []
    let warnings: string[] = []
    // 1) JSON 完整格式（导出的 .json 直接粘回来）
    const trimmed = xmouseText.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const obj = JSON.parse(trimmed)
        const file = obj?.macro ?? obj
        if (file && Array.isArray(file.steps)) {
          parsed = normalizeStepDelays(expandStepKeys(file.steps))
        } else {
          message.warning('JSON 缺少 steps 数组，无法解析')
          return
        }
      } catch {
        // 不是合法 JSON，降级到 XMBC 文本解析
      }
    }
    // 2) XMBC 内联格式
    if (parsed.length === 0) {
      const r = parseXMouse(xmouseText)
      parsed = r.steps
      warnings = r.warnings
    }
    if (parsed.length === 0) {
      message.warning('未解析到任何步骤，请检查文本格式')
      return
    }
    patchMacro({
      steps: [
        ...macro.steps,
        ...parsed.map((s) => ({
          ...s,
          id: s.id || `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          label: s.label || buildLabel(s),
        })),
      ],
    })
    message.success(
      `已追加 ${parsed.length} 个步骤${warnings.length ? `；${warnings.length} 处未识别标记已忽略` : ''}`,
    )
    setShowXMouse(false)
    setXmouseText('')
  }

  const handleStartRecord = async () => {
    setRecordError('')
    const res = await startRecording({ captureDelay, captureMouseMove, countdownSec: 3 })
    if (!res.ok) {
      setRecordError(res.reason ?? '录制启动失败')
      message.error(res.reason ?? '录制启动失败')
      return
    }
    setPhase('countdown')
    setCountdown(3)
  }

  // 停止后由 record:state 事件统一合并步骤（主进程也可能通过 F9 自行停止）
  const handleStopRecord = async () => {
    await stopRecording()
    setPhase('idle')
    setCountdown(0)
  }

  const handleCancelRecord = async () => {
    await cancelRecording()
    setRecordingSteps([])
    setPhase('idle')
    setCountdown(0)
  }

  /** 保存前校验：表单字段（ProForm）+ 时间轴步骤（本地 state） */
  const validate = (values: Record<string, any>): string => {
    const name = String(values.name ?? '').trim()
    if (!name || name.length > MACRO_NAME_MAX) return '宏名称必填且不超过 50 字符'
    if (!validateLoops(steps)) return '循环步骤未闭合'
    const speed = Number(values.speed)
    if (!Number.isFinite(speed) || speed < SPEED_MIN || speed > SPEED_MAX) {
      return `播放速度须为 ${SPEED_MIN}~${SPEED_MAX} 之间的数字`
    }
    const mode = values.playMode as PlayMode
    if (mode === 'holdRepeat') {
      const v = Number(values.repeatInterval)
      if (!Number.isFinite(v) || v < REPEAT_INTERVAL_MIN || v > REPEAT_INTERVAL_MAX) {
        return `重复间隔须为 ${REPEAT_INTERVAL_MIN}~${REPEAT_INTERVAL_MAX} 之间的整数`
      }
    }
    if (mode === 'sequence') {
      const v = Number(values.playCount)
      if (!Number.isFinite(v) || v < PLAY_COUNT_MIN || v > PLAY_COUNT_MAX) {
        return `播放次数须为 ${PLAY_COUNT_MIN}~${PLAY_COUNT_MAX} 之间的整数`
      }
    }
    for (const s of steps) {
      if (!Number.isFinite(s.delay) || s.delay < STEP_MIN_DELAY || s.delay > STEP_MAX_DELAY) {
        return `步骤延迟须为 ${STEP_MIN_DELAY}~${STEP_MAX_DELAY} 之间的整数`
      }
      if (s.kind === 'keyboard' && !s.key) return '存在未设置按键的键盘动作'
      if (s.kind === 'text' && !s.text) return '存在未填写内容的文本输入步骤'
      if (
        s.kind === 'loopStart' &&
        (!Number.isInteger(s.loopCount ?? LOOP_COUNT_MIN) ||
          (s.loopCount ?? LOOP_COUNT_MIN) < LOOP_COUNT_MIN ||
          (s.loopCount ?? LOOP_COUNT_MIN) > LOOP_COUNT_MAX)
      ) {
        return `循环次数须为 ${LOOP_COUNT_MIN}~${LOOP_COUNT_MAX} 之间的整数`
      }
      if (
        s.kind === 'mouse' &&
        (s.action === 'wheelUp' || s.action === 'wheelDown') &&
        (!Number.isInteger(s.wheelAmount ?? WHEEL_AMOUNT_MIN) ||
          (s.wheelAmount ?? WHEEL_AMOUNT_MIN) < WHEEL_AMOUNT_MIN ||
          (s.wheelAmount ?? WHEEL_AMOUNT_MIN) > WHEEL_AMOUNT_MAX)
      ) {
        return `滚轮量须为 ${WHEEL_AMOUNT_MIN}~${WHEEL_AMOUNT_MAX} 之间的整数`
      }
    }
    return ''
  }

  const doSave = async (): Promise<Macro | null> => {
    const values = form.getFieldsValue()
    const err = validate(values)
    if (err) {
      message.error(err)
      return null
    }
    setSaving(true)
    try {
      const saved = await saveMacro({
        ...macro,
        name: String(values.name ?? '').trim(),
        playMode: (values.playMode ?? 'once') as PlayMode,
        speed: Number(values.speed) || 1,
        repeatInterval: Number(values.repeatInterval) || DEFAULT_REPEAT_INTERVAL,
        playCount: Number(values.playCount) || DEFAULT_PLAY_COUNT,
        steps: [...macro.steps, ...recordingSteps],
      })
      return saved
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async () => {
    const saved = await doSave()
    if (saved) {
      message.success('已保存')
      navigate('/macro')
    }
  }

  const handleTrialRun = async () => {
    const saved = await doSave()
    if (!saved) return
    setMacro(saved)
    const res = await playMacro(saved.id, { releaseFocus: true })
    if (!res.ok) {
      message.error(res.reason ?? '播放失败')
      return
    }
    if (res.warnings?.length) message.warning(res.warnings.join('；'))
  }

  const columns: TableProps<MacroStep>['columns'] = [
    {
      title: '序号',
      key: 'idx',
      // 拖拽手柄 + 序号：手柄约 14 + 间距 4 + 两位数 16 + 单元格内边距 32 ≈ 66，留余量 80
      width: 80,
      render: (_v, _r, i) => (
        <span
          className={`openmacro-drag-handle${recording ? ' openmacro-drag-handle-disabled' : ''}`}
          draggable={!recording}
          title={recording ? '录制中不能调整顺序' : '按住拖动调整顺序'}
          onDragStart={(e) => handleDragStart(e, i)}
          onDrag={(e) => {
            dragYRef.current = e.clientY
          }}
          onDragEnd={handleDragEnd}
        >
          <HolderOutlined />
          <span>{i + 1}</span>
        </span>
      ),
    },
    {
      title: '动作类型',
      dataIndex: 'kind',
      // 列宽须 > 控件宽 + 单元格左右内边距（16*2），否则控件溢出挤进下一列
      width: 150,
      render: (_v, row, i) => (
        <Select
          value={row.kind}
          disabled={recording}
          options={STEP_KIND_OPTIONS}
          style={{ width: '100%' }}
          onChange={(kind: MacroStepKind) =>
            updateStep(i, { ...defaultStepFor(kind), id: row.id, delay: row.delay })
          }
        />
      ),
    },
    {
      title: '动作内容',
      key: 'content',
      // 弹性列：容器宽于列宽之和时余量全给这一列，其余列（含操作列）保持死宽不被拉伸
      render: (_v, row, i) => {
        if (row.kind === 'keyboard') {
          return (
            <Space size={4} wrap>
              <Input
                value={row.key ?? ''}
                disabled={recording}
                placeholder="如 A、Ctrl+Shift+A"
                style={{ width: CTRL_W.select }}
                onChange={(e) => updateStep(i, { key: e.target.value })}
              />
              <Select
                value={row.action ?? 'click'}
                disabled={recording}
                style={{ width: CTRL_W.select }}
                options={KEYBOARD_ACTION_OPTIONS}
                onChange={(action) => updateStep(i, { action })}
              />
            </Space>
          )
        }
        if (row.kind === 'mouse') {
          return (
            <Space size={4} wrap>
              {(row.action === 'down' || row.action === 'up' || row.action === 'click') && (
                <Select
                  value={row.key ?? 'left'}
                  disabled={recording}
                  options={MOUSE_BUTTON_OPTIONS}
                  style={{ width: CTRL_W.select }}
                  onChange={(key) => updateStep(i, { key })}
                />
              )}
              <Select
                value={row.action ?? 'down'}
                disabled={recording}
                options={MOUSE_ACTION_OPTIONS}
                style={{ width: CTRL_W.select }}
                onChange={(action) => updateStep(i, { action })}
              />
              {row.action === 'move' && (
                <Space size={4}>
                  <InputNumber
                    value={row.x ?? 0}
                    disabled={recording}
                    placeholder="X"
                    style={{ width: CTRL_W.number }}
                    onChange={(x) => updateStep(i, { x: Number(x) || 0 })}
                  />
                  <InputNumber
                    value={row.y ?? 0}
                    disabled={recording}
                    placeholder="Y"
                    style={{ width: CTRL_W.number }}
                    onChange={(y) => updateStep(i, { y: Number(y) || 0 })}
                  />
                </Space>
              )}
              {(row.action === 'wheelUp' || row.action === 'wheelDown') && (
                <InputNumber
                  min={WHEEL_AMOUNT_MIN}
                  max={WHEEL_AMOUNT_MAX}
                  value={row.wheelAmount ?? 1}
                  disabled={recording}
                  style={{ width: CTRL_W.number }}
                  onChange={(wheelAmount) => updateStep(i, { wheelAmount: Number(wheelAmount) || WHEEL_AMOUNT_MIN })}
                />
              )}
            </Space>
          )
        }
        if (row.kind === 'text') {
          return (
            <Input
              value={row.text ?? ''}
              disabled={recording}
              placeholder="回放时逐字符输入的文本"
              style={{ width: CTRL_W.input }}
              onChange={(e) => updateStep(i, { text: e.target.value })}
            />
          )
        }
        // 等待步骤：无输入动作，内容列就是时长编辑器（毫秒）
        if (row.kind === 'delay') {
          return (
            <Space size={4}>
              <InputNumber
                min={STEP_MIN_DELAY}
                max={STEP_MAX_DELAY}
                step={10}
                value={row.delay}
                disabled={recording}
                style={{ width: CTRL_W.number }}
                onChange={(v) => updateStep(i, { delay: Number(v) || STEP_MIN_DELAY })}
              />
              <Typography.Text type="secondary">毫秒</Typography.Text>
            </Space>
          )
        }
        // 循环次数内联在「动作内容」列；动作类型列已标明"循环开始"，这里只放 ×N，不重复文字
        if (row.kind === 'loopStart') {
          return (
            <InputNumber
              min={LOOP_COUNT_MIN}
              max={LOOP_COUNT_MAX}
              value={row.loopCount ?? 1}
              disabled={recording}
              prefix="×"
              style={{ width: CTRL_W.number }}
              onChange={(v) => updateStep(i, { loopCount: Number(v) || LOOP_COUNT_MIN })}
            />
          )
        }
        // 循环结束：动作类型列已标明，动作内容列留空
        if (row.kind === 'loopEnd') return null
        if (row.kind === 'command') {
          return (
            <Select
              value={row.command}
              disabled={recording}
              options={SYSTEM_COMMAND_OPTIONS}
              style={{ width: CTRL_W.select }}
              onChange={(command) => updateStep(i, { command })}
            />
          )
        }
        return <Typography.Text type="secondary">{buildLabel(row)}</Typography.Text>
      },
    },
    {
      title: '操作',
      key: 'action',
      // 操作列最多 3 项（含「更多」）：平铺 插入 / 删除，
      // 上移 / 下移（拖拽的键盘可达兜底）收进「更多」；内容 ≈ 110 + 内边距 ≈ 140
      width: 140,
      className: 'openmacro-op-cell',
      fixed: 'right',
      render: (_v, _row, i) => {
        const upDisabled = recording || i === 0
        const downDisabled = recording || i === steps.length - 1
        return (
          <Space size={4}>
            <a
              className={recording ? 'ant-typography-disabled' : undefined}
              style={recording ? { pointerEvents: 'none' } : undefined}
              onClick={() => insertStep(i)}
            >
              插入
            </a>
            <Popconfirm
              title="删除步骤"
              description="删除后不可恢复，确定删除吗？"
              okText="确定"
              cancelText="取消"
              onConfirm={() => deleteStep(i)}
              disabled={recording}
            >
              <a
                className={recording ? 'ant-typography-disabled' : undefined}
                style={recording ? { pointerEvents: 'none' } : { color: 'var(--ant-color-error)' }}
              >
                删除
              </a>
            </Popconfirm>
            {/* 排序主入口为序号列拖拽；上移 / 下移作为键盘可达的兜底 */}
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'up', label: '上移', disabled: upDisabled },
                  { key: 'down', label: '下移', disabled: downDisabled },
                ],
                onClick: ({ key }) => moveStep(i, key === 'up' ? -1 : 1),
              }}
            >
              <a>
                更多 <DownOutlined />
              </a>
            </Dropdown>
          </Space>
        )
      },
    },
  ]

  if (!loaded) return <PageContainer title="加载中..." />

  return (
    <PageContainer
      title={id ? '编辑宏' : '新建宏'}
      onBack={() => navigate('/macro')}
      extra={[
        // 运行 / 录制操作收进页头右上（hl-05：按钮组 Space 右对齐；页面主按钮唯一 primary = 保存）
        // 按钮等宽：组内最长文案 4 字 → 4×14 + 内边距 32 = 88（hl-05 页头按钮组规范）
        <Button key="trial" style={OP_BTN_W} onClick={handleTrialRun} disabled={playback.running || recording}>
          试运行
        </Button>,
        <Button key="stop" danger style={OP_BTN_W} disabled={!playback.running} onClick={() => stopMacro()}>
          立即停止
        </Button>,
        phase === 'idle' ? (
          <Button key="record" style={OP_BTN_W} onClick={handleStartRecord}>
            开始录制
          </Button>
        ) : (
          <Button key="record" danger style={OP_BTN_W} onClick={handleStopRecord}>
            停止录制
          </Button>
        ),
        <Button key="cancel" style={OP_BTN_W} onClick={() => navigate('/macro')}>
          取消
        </Button>,
        // 录制中禁止保存：步骤要等停止录制后才合并完整
        <Button key="save" type="primary" style={OP_BTN_W} loading={saving} disabled={recording} onClick={handleSave}>
          保存
        </Button>,
      ]}
    >
      {/* 外层 ProForm 仅作布局包裹（hl-05：Card 与字段之间隔中间层）；
          form 实例必须绑在持有字段【内层】ProForm 上，否则 setFieldsValue / getFieldsValue 落空 */}
      <ProForm submitter={false}>
        {/* 基本信息：宏信息 + 播放设置 + 录制开关合并为一个分组，严格三列栅格（span 8 × 3） */}
        <Card title="基本信息" style={{ marginBottom: 16 }}>
          <ProForm
            form={form}
            submitter={false}
            grid
            initialValues={{
              name: macro.name,
              playMode: macro.playMode,
              speed: macro.speed,
              repeatInterval: macro.repeatInterval,
              playCount: macro.playCount,
            }}
            onValuesChange={(_, allValues) => {
              if (allValues.playMode) setPlayMode(allValues.playMode as PlayMode)
            }}
          >
            {/* 第一行：宏名称 / 播放速度 / 播放方式 */}
            <ProFormText
              name="name"
              label="宏名称"
              placeholder="宏名称（必填，≤50 字符）"
              colProps={{ span: 8 }}
              rules={[
                { required: true, message: '宏名称必填' },
                { max: MACRO_NAME_MAX, message: '宏名称不超过 50 字符' },
              ]}
            />
            <ProFormDigit
              name="speed"
              label="播放速度"
              min={SPEED_MIN}
              max={SPEED_MAX}
              step={0.5}
              tooltip="倍率 0.5~5，对延迟与重复间隔同时生效"
              fieldProps={{ style: { width: '100%' } }}
              colProps={{ span: 8 }}
            />
            <ProFormSelect
              name="playMode"
              label="播放方式"
              tooltip="按住重复与按下切换循环需绑定鼠标按键后完整生效（见按键映射页）；试运行按执行一次处理"
              options={PLAY_MODE_OPTIONS}
              fieldProps={{ style: { width: '100%' } }}
              colProps={{ span: 8 }}
            />

            {/* 第二行：紧跟在播放方式后的条件字段 / 记录延迟 / 鼠标轨迹，各占一列。
                裸 ProForm.Item 的 colProps 不生效，必须显式 <Col> 包裹（同 BindingEditor 写法） */}
            {playMode === 'holdRepeat' && (
              <ProFormDigit
                name="repeatInterval"
                label="重复间隔（毫秒）"
                min={REPEAT_INTERVAL_MIN}
                max={REPEAT_INTERVAL_MAX}
                fieldProps={{ style: { width: '100%' } }}
                colProps={{ span: 8 }}
              />
            )}
            {playMode === 'sequence' && (
              <ProFormDigit
                name="playCount"
                label="播放次数"
                min={PLAY_COUNT_MIN}
                max={PLAY_COUNT_MAX}
                fieldProps={{ style: { width: '100%' } }}
                colProps={{ span: 8 }}
              />
            )}
            <Col span={8}>
              <ProForm.Item
                label="记录延迟"
                tooltip={`关闭时每个动作前插入 ${STEP_DEFAULT_DELAY} 毫秒「等待」步骤`}
              >
                <Switch checked={captureDelay} disabled={recording} onChange={setCaptureDelay} />
              </ProForm.Item>
            </Col>
            <Col span={8}>
              <ProForm.Item
                label="鼠标轨迹"
                tooltip="开启时记录鼠标移动坐标，回放按录制的绝对坐标移动鼠标"
              >
                <Switch checked={captureMouseMove} disabled={recording} onChange={setCaptureMouseMove} />
              </ProForm.Item>
            </Col>
          </ProForm>
        </Card>

        {/* 时间轴编辑（录制状态与倒计时就近展示在明细表卡片上） */}
        <Card
          title="时间轴编辑"
          extra={
            <Space size={12} wrap>
              {playback.running && <Tag color="processing">{playback.progress}</Tag>}
              {phase === 'countdown' && (
                <>
                  <Typography.Text strong style={{ color: '#1677ff' }}>
                    {countdown} 秒后开始录制，请切到目标窗口
                  </Typography.Text>
                  <Button danger onClick={handleCancelRecord}>
                    取消录制
                  </Button>
                </>
              )}
              {phase === 'recording' && (
                <Tag color="red">录制中…已采集 {recordingSteps.length} 个步骤（按 F9 或点「停止录制」结束）</Tag>
              )}
              <Popconfirm
                title="清空全部步骤"
                description={`共 ${steps.length} 个步骤将被移除，该操作不可撤销`}
                okText="清空"
                okButtonProps={{ danger: true }}
                cancelText="取消"
                disabled={steps.length === 0 || recording}
                onConfirm={clearSteps}
              >
                <Button danger disabled={steps.length === 0 || recording}>
                  清空步骤
                </Button>
              </Popconfirm>
              <Button disabled={recording} onClick={appendStep}>
                新增步骤
              </Button>
              <Button disabled={recording} onClick={() => setShowXMouse(true)}>
                粘贴 X-MOUSE 文本
              </Button>
            </Space>
          }
        >
          {recordError && (
            <Alert type="error" showIcon message="录制不可用" description={recordError} style={{ marginBottom: 16 }} />
          )}
          {steps.length === 0 && !recording ? (
            <Empty description="暂无步骤，点击「开始录制」或「新增步骤」" />
          ) : (
            <Table<MacroStep>
              rowKey="id"
              // 行内是 32px 标准控件，用 small 单元格内边距（8px）把行高压到 48px，
              // 与其它列表的常规行高对齐；middle（12px）会把每行撑到 56px
              size="small"
              bordered
              columns={columns}
              dataSource={steps}
              pagination={false}
              rowClassName={(_r, i) =>
                dragIndex === i
                  ? 'timeline-row-dragging'
                  : dragIndex !== null && dragOverIndex === i
                    ? 'timeline-row-drag-over'
                    : ''
              }
              onRow={(_r, i) => {
                const index = i ?? 0
                return {
                  onDragOver: (e: DragEvent<HTMLElement>) => {
                    if (dragIndex === null || index >= macro.steps.length) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    dragYRef.current = e.clientY
                    if (dragOverIndex !== index) setDragOverIndex(index)
                  },
                  onDrop: (e: DragEvent<HTMLElement>) => {
                    if (dragIndex === null) return
                    e.preventDefault()
                    reorderStep(dragIndex, index)
                    handleDragEnd()
                  },
                }
              }}
              // 固定列之和 370（序号 80 + 动作类型 150 + 操作 140）+ 弹性列动作内容最小 420
              scroll={{ x: 790 }}
              // 不固定表体高度：默认步数下表格自然展开、无任何滚动条；
              // 步骤很多时表格自然增高，由页面整体滚动兜底
            />
          )}
        </Card>
      </ProForm>

      {/* X-MOUSE 文本导入：粘贴或载入文件，解析后追加到时间轴 */}
      <Modal
        title="从文本导入（X-MOUSE / JSON）"
        open={showXMouse}
        onOk={handleImportXMouse}
        onCancel={() => setShowXMouse(false)}
        okText="解析并追加"
        cancelText="取消"
        okButtonProps={{ disabled: !xmouseText.trim() }}
        width={1060}
      >
        {/* 左：粘贴/载入文本；右：标记速查表（逐条解释含义）。右侧宽一些，说明少换行 */}
        <Row gutter={16}>
          <Col span={9}>
            <Space style={{ marginBottom: 8 }}>
              <Button onClick={() => xmouseFileRef.current?.click()} title="选择宏文件：XMBC 导出的 .mac/.txt、OpenMacro 的 .json 或 .md，内容会填入左侧文本框">
                从文件导入
              </Button>
              <input
                ref={xmouseFileRef}
                type="file"
                accept=".txt,.mac,.json,.md,text/plain,application/json"
                style={{ display: 'none' }}
                onChange={handleXMouseFile}
              />
            </Space>
            <Input.TextArea
              rows={16}
              value={xmouseText}
              onChange={(e) => setXmouseText(e.target.value)}
              placeholder={'4{WAITMS:80}e{WAITMS:20}{LMBD}{WAITMS:500}{LMBU}…\n\n也支持粘贴导出的 JSON 完整格式'}
              style={{ fontFamily: 'monospace' }}
            />
          </Col>
          <Col span={15}>
            <div
              style={{
                maxHeight: 420,
                overflowY: 'auto',
                border: '1px solid rgba(5, 5, 5, 0.06)',
                borderRadius: 8,
                padding: '8px 12px',
                background: 'rgba(0, 0, 0, 0.01)',
              }}
            >
              <Typography.Text strong style={{ fontSize: 14, display: 'block' }}>
                X-MOUSE / XMBC
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                鼠标宏软件导出的内联格式；也可粘贴导出的 JSON 完整格式
              </Typography.Text>
              <div style={{ marginTop: 4 }}>
                {XMBC_MARKS.map(([mark, desc]) => (
                  <MarkRow key={mark} mark={mark} desc={desc} />
                ))}
              </div>
            </div>
          </Col>
        </Row>
      </Modal>
    </PageContainer>
  )
}
