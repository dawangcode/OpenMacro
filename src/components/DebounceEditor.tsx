// 防抖规则编辑器（src/components/DebounceEditor.tsx）
// 新增页与编辑页共用的表单主体：绑定按键（鼠标 / 键盘捕获）+ 防抖开关 + 防抖窗口。
// 与绑定不同：这里允许捕获左键 / 右键——鼠标连击（连点抖动）主要发生在左右键。
// 风格对齐 BindingEditor：Card + ProForm(submitter={false}) + grid 三列栅格，标签挂问号提示。
import { Button, Card, Col, Input, InputNumber, Space, Switch, Tooltip } from 'antd'
import { QuestionCircleOutlined } from '@ant-design/icons'
import { ProForm } from '@ant-design/pro-components'
import {
  DEBOUNCE_WINDOW_DEFAULT,
  DEBOUNCE_WINDOW_MAX,
  DEBOUNCE_WINDOW_MIN,
  triggerLabel,
  type DebounceRule,
} from '@/types/binding'

interface Props {
  rule: DebounceRule
  capturing: boolean
  onRuleChange: (patch: Partial<DebounceRule>) => void
  /** 触发按键捕获（鼠标键或键盘键 / 组合键） */
  onCapture: () => void
}

export default function DebounceEditor({ rule, capturing, onRuleChange, onCapture }: Props) {
  const trigger = rule.trigger

  return (
    <Card>
      <ProForm submitter={false} grid>
        {/* 绑定按键（单独成行，宽度与下方字段对齐） */}
        <Col span={8}>
          <ProForm.Item
            label="绑定按键"
            tooltip="点击「捕获按键」后按下任意鼠标键（左键 / 右键 / 中键 / 侧键4 / 侧键5）或键盘键自动填入。组合键：先按住 Ctrl / Shift / Alt / Win，再按主键（如先按 Ctrl 再按 C）；修饰键单独按下不会结束捕获。鼠标连击最常发生在左键 / 右键，可优先用左右键配置。"
          >
            <Space.Compact style={{ width: '100%' }}>
              <Input readOnly value={triggerLabel(trigger)} placeholder="未捕获" />
              <Button loading={capturing} onClick={onCapture}>
                捕获按键
              </Button>
            </Space.Compact>
          </ProForm.Item>
        </Col>

        <Col span={8}>
          <ProForm.Item
            label={
              <Space size={4}>
                <span>启用防抖</span>
                <Tooltip title="开启后，该按键在防抖窗口内的重复按下会被忽略；窗口从该键第一次按下起算。有绑定的按键（中键 / 侧键 / 键盘键）不会重复触发动作；左键 / 右键无绑定动作，防抖用于连击识别——按键检测页会把窗口内的重复点击计为重复。注意当前输入库为观察型钩子，无法阻止事件继续到达其它程序。">
                  <QuestionCircleOutlined style={{ color: 'rgba(0, 0, 0, 0.45)' }} />
                </Tooltip>
              </Space>
            }
          >
            <Switch checked={rule.enabled} onChange={(v) => onRuleChange({ enabled: v })} />
          </ProForm.Item>
        </Col>
        <Col span={8}>
          <ProForm.Item
            label="防抖窗口（毫秒）"
            tooltip="防抖窗口 10~3000 毫秒：窗口内第二次及以后的按下会被忽略；默认 200 毫秒"
          >
            <InputNumber
              min={DEBOUNCE_WINDOW_MIN}
              max={DEBOUNCE_WINDOW_MAX}
              step={10}
              value={(rule.windowMs ?? DEBOUNCE_WINDOW_DEFAULT) < DEBOUNCE_WINDOW_MIN ? DEBOUNCE_WINDOW_DEFAULT : rule.windowMs ?? DEBOUNCE_WINDOW_DEFAULT}
              onChange={(v) =>
                onRuleChange({ windowMs: Math.round(Number(v) || DEBOUNCE_WINDOW_DEFAULT) })
              }
              style={{ width: '100%' }}
            />
          </ProForm.Item>
        </Col>
      </ProForm>
    </Card>
  )
}
