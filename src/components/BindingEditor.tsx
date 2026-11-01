// 绑定编辑器（src/components/BindingEditor.tsx）
// 新增页与编辑页共用的表单主体：绑定按键（鼠标 / 键盘捕获）+ 触发方式 + 动作配置。
// 按 hl-05：Card 与字段之间隔 ProForm(submitter={false}) 中间层，grid 三列栅格。
import {
  Button,
  Card,
  Col,
  Empty,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tooltip,
  Typography,
} from 'antd'
import { QuestionCircleOutlined } from '@ant-design/icons'
import { ProForm } from '@ant-design/pro-components'
import {
  ACTION_TYPE_OPTIONS,
  HOLD_THRESHOLD_DEFAULT,
  HOLD_THRESHOLD_MAX,
  HOLD_THRESHOLD_MIN,
  MOUSE_FUNCTION_OPTIONS,
  emptyAction,
  isReservedTrigger,
  triggerLabel,
  type ActionType,
  type BindingAction,
  type KeyBinding,
  type TriggerMode,
} from '@/types/binding'
import { SYSTEM_COMMAND_OPTIONS } from '@/types/macro'
import type { Macro } from '@/types/macro'

/** 动作类型标签的问号提示：解释「禁用」动作的含义与当前输入库的限制 */
const ACTION_TYPE_TOOLTIP =
  '禁用：该绑定键不产生任何动作。注意当前输入库为观察型钩子，无法阻止事件继续到达目标程序。'

interface Props {
  binding: KeyBinding
  macros: Macro[]
  capturing: boolean
  onBindingChange: (patch: Partial<KeyBinding>) => void
  /** 捕获意图：trigger = 绑定按键（鼠标或键盘）；action = 键盘动作（仅键盘），mode 指明写入短按 / 长按 */
  onCapture: (intent: 'trigger' | 'action', mode?: TriggerMode) => void
  onPickExecutable: () => void
}

export default function BindingEditor({
  binding,
  macros,
  capturing,
  onBindingChange,
  onCapture,
  onPickExecutable,
}: Props) {
  const trigger = binding.trigger
  const reserved = isReservedTrigger(trigger)
  const tap = binding.tap ?? emptyAction('keyboard')
  const hold = binding.hold ?? emptyAction('keyboard')

  const setAction = (mode: TriggerMode, patch: Partial<BindingAction>) => {
    const current = mode === 'tap' ? tap : hold
    onBindingChange(mode === 'tap' ? { tap: { ...current, ...patch } } : { hold: { ...current, ...patch } })
  }

  const renderActionFields = (mode: TriggerMode, action: BindingAction) => (
    <>
      {action.type === 'keyboard' && (
        <Col span={8}>
          <ProForm.Item label={mode === 'tap' ? '短按动作·键盘按键' : '长按动作·键盘按键'}>
            <Space.Compact style={{ width: '100%' }}>
              <Input readOnly value={action.key ?? ''} placeholder="未捕获" />
              <Button loading={capturing} onClick={() => onCapture('action', mode)}>
                捕获按键
              </Button>
            </Space.Compact>
          </ProForm.Item>
        </Col>
      )}
      {action.type === 'mouse' && (
        <Col span={8}>
          <ProForm.Item label={mode === 'tap' ? '短按动作·鼠标功能' : '长按动作·鼠标功能'}>
            <Select
              value={action.mouseFn}
              options={MOUSE_FUNCTION_OPTIONS}
              style={{ width: '100%' }}
              onChange={(mouseFn) => setAction(mode, { mouseFn })}
            />
          </ProForm.Item>
        </Col>
      )}
      {action.type === 'command' && (
        <Col span={8}>
          <ProForm.Item label={mode === 'tap' ? '短按动作·系统命令' : '长按动作·系统命令'}>
            <Select
              value={action.command}
              options={SYSTEM_COMMAND_OPTIONS}
              style={{ width: '100%' }}
              onChange={(command) => setAction(mode, { command })}
            />
          </ProForm.Item>
        </Col>
      )}
      {action.type === 'launch' && (
        <Col span={8}>
          <ProForm.Item label={mode === 'tap' ? '短按动作·程序路径' : '长按动作·程序路径'}>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                value={action.path ?? ''}
                placeholder="程序路径（仅可执行文件）"
                onChange={(e) => setAction(mode, { path: e.target.value })}
              />
              <Button onClick={onPickExecutable}>选择文件</Button>
            </Space.Compact>
          </ProForm.Item>
        </Col>
      )}
      {action.type === 'macro' && (
        <Col span={8}>
          <ProForm.Item label={mode === 'tap' ? '短按动作·选择宏' : '长按动作·选择宏'}>
            {macros.length > 0 ? (
              <Select
                value={action.macroId || undefined}
                placeholder="选择宏"
                style={{ width: '100%' }}
                options={macros.map((m) => ({ value: m.id, label: `${m.name}（${m.steps.length} 步）` }))}
                onChange={(macroId) => setAction(mode, { macroId })}
              />
            ) : (
              <Empty description="还没有宏，请先到「宏库管理」创建" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </ProForm.Item>
        </Col>
      )}
    </>
  )

  return (
    <Card
      title={
        <Space size={4}>
          <span>绑定配置</span>
          <Tooltip title="同一绑定按键只能有一条绑定；防抖在「按键防抖」页按绑定键配置；触发方式可选短按 / 长按。未配置长按动作时，短按在按下瞬间即时触发（零延迟）；同时配置短按与长按时，短按在抬起时触发以区分长按。短按 / 长按可以都不启用，保存为「未启用」绑定：该键不执行任何动作。">
            <QuestionCircleOutlined style={{ color: 'rgba(0, 0, 0, 0.45)' }} />
          </Tooltip>
        </Space>
      }
    >
      <ProForm submitter={false} grid>
        {/* 绑定按键（单独一行，宽度与下方 1/3 列对齐） */}
        <Col span={8}>
          <ProForm.Item
            label="绑定按键"
            tooltip="点击「捕获按键」后按下鼠标键（中键 / 侧键4 / 侧键5）或键盘键自动填入。组合键：先按住 Ctrl / Shift / Alt / Win，再按主键（如先按 Ctrl 再按 C）；修饰键单独按下不会结束捕获。左键 / 右键为系统保留"
          >
            <Space.Compact style={{ width: '100%' }}>
              <Input readOnly value={triggerLabel(trigger)} placeholder="未捕获" />
              <Button loading={capturing} onClick={() => onCapture('trigger')}>
                捕获按键
              </Button>
            </Space.Compact>
          </ProForm.Item>
        </Col>
        <Col span={24} />
        {reserved && (
          <Col span={24}>
            <Typography.Text type="danger">左键 / 右键为系统保留按键，不能作为绑定按键，请重新捕获。</Typography.Text>
          </Col>
        )}

        {/* 短按 */}
        <Col span={8}>
          <ProForm.Item
            label={
              <Space size={4}>
                <span>短按动作类型</span>
                <Tooltip title={ACTION_TYPE_TOOLTIP}>
                  <QuestionCircleOutlined style={{ color: 'rgba(0, 0, 0, 0.45)' }} />
                </Tooltip>
              </Space>
            }
          >
            <Select
              value={tap.type}
              options={ACTION_TYPE_OPTIONS}
              style={{ width: '100%' }}
              onChange={(v: ActionType) => onBindingChange({ tap: emptyAction(v) })}
            />
          </ProForm.Item>
        </Col>
        {renderActionFields('tap', tap)}
        <Col span={8}>
          <ProForm.Item
            label="启用短按"
            tooltip="轻点一下触发：未配置长按时，按下瞬间即时触发（零延迟）；若同时配置了长按，短按会在抬起时触发以区分长按。"
          >
            <Switch
              checked={!!binding.tap}
              onChange={(v) => onBindingChange({ tap: v ? emptyAction(tap.type) : undefined })}
            />
          </ProForm.Item>
        </Col>

        {/* 长按 */}
        <Col span={8}>
          <ProForm.Item
            label={
              <Space size={4}>
                <span>长按动作类型</span>
                <Tooltip title={ACTION_TYPE_TOOLTIP}>
                  <QuestionCircleOutlined style={{ color: 'rgba(0, 0, 0, 0.45)' }} />
                </Tooltip>
              </Space>
            }
          >
            <Select
              value={hold.type}
              options={ACTION_TYPE_OPTIONS}
              style={{ width: '100%' }}
              onChange={(v: ActionType) => onBindingChange({ hold: emptyAction(v) })}
            />
          </ProForm.Item>
        </Col>
        {renderActionFields('hold', hold)}
        <Col span={8}>
          <ProForm.Item
            label="启用长按"
            tooltip="按住不放，达到阈值（默认 0.8 秒，可在「长按阈值」调节）才执行长按动作；适合持续型动作，如按住连发、按住说话（PTT），松开即停。"
          >
            <Switch
              checked={!!binding.hold}
              onChange={(v) =>
                onBindingChange(
                  v
                    ? {
                        hold: emptyAction(hold.type),
                        holdThresholdMs: binding.holdThresholdMs ?? HOLD_THRESHOLD_DEFAULT,
                      }
                    : { hold: undefined },
                )
              }
            />
          </ProForm.Item>
        </Col>
        {binding.hold && (
          <Col span={8}>
            <ProForm.Item label="长按阈值（秒）" tooltip="按住达到该时长才执行长按动作；未达到则按短按处理">
              <InputNumber
                min={HOLD_THRESHOLD_MIN / 1000}
                max={HOLD_THRESHOLD_MAX / 1000}
                step={0.1}
                value={(binding.holdThresholdMs ?? HOLD_THRESHOLD_DEFAULT) / 1000}
                onChange={(v) =>
                  onBindingChange({ holdThresholdMs: Math.round((Number(v) || HOLD_THRESHOLD_DEFAULT / 1000) * 1000) })
                }
                style={{ width: '100%' }}
              />
            </ProForm.Item>
          </Col>
        )}
        {!binding.tap && !binding.hold && (
          <Col span={24}>
            <Typography.Text type="warning">
              短按与长按都未启用：保存后该绑定键不执行任何动作，仅保留绑定关系（可随时回来启用，或直接删除该绑定）。
            </Typography.Text>
          </Col>
        )}
      </ProForm>
    </Card>
  )
}
