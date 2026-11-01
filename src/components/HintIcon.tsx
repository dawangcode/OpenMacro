// 问号提示图标（src/components/HintIcon.tsx）
// 设置页各字段与赞助引导卡共用：统一「灰色问号 + 限宽 Tooltip」，避免两处各写一份
import { QuestionCircleOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'

/** 展开 Tooltip 的通用宽度，全站问号提示统一用它 */
export const HINT_WIDTH = 460

/** 说明文字一律收进问号，不在正文里放解释段落 */
export function HintIcon({ text }: { text: string }) {
  return (
    <Tooltip title={<span style={{ display: 'block', maxWidth: HINT_WIDTH }}>{text}</span>}>
      <QuestionCircleOutlined style={{ color: 'rgba(0, 0, 0, 0.45)' }} />
    </Tooltip>
  )
}
