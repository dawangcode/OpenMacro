// 首次启动上手引导（src/components/FirstRunGuide.tsx）
// 替代原来的「首次启动打赏卡」：新用户先看到 3 步上手 + 6 个通用模板，
// 打赏入口仍在设置页底部，不在首启抢注意力。
// 关闭一次后由主进程永久落记（复用原 sponsor:guide 的持久化标记）。
import { useEffect, useState } from 'react'
import { Button, Space, Tag, Typography, message } from 'antd'
import { AimOutlined, ApiOutlined, CloseOutlined, PlusOutlined } from '@ant-design/icons'
import { useNavigate } from 'umi'
import { dismissSponsorGuide, shouldShowSponsorGuide } from '@/api/settings'
import { listMacros, saveMacro } from '@/api/macro'
import { nextName } from '@/types/macro'
import { MACRO_TEMPLATES, type MacroTemplate } from '@/constants/templates'

export default function FirstRunGuide() {
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  // 打开后延迟 1.5 秒浮现：先让用户看到主界面，不挡第一眼；
  // 浏览器 dev 态没有持久化，shouldShow 返回 false，不会反复弹。
  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      shouldShowSponsorGuide().then((v) => {
        if (alive) setVisible(v)
      })
    }, 1500)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [])

  const close = () => {
    setVisible(false)
    void dismissSponsorGuide()
  }

  const go = (path: string) => {
    close()
    navigate(path)
  }

  /** 一键装模板：同名自动追加序号，创建后直接进编辑页，用户只需再绑一个键 */
  const useTemplate = async (tpl: MacroTemplate) => {
    setBusyKey(tpl.key)
    try {
      const existing = await listMacros()
      const created = await saveMacro({
        name: nextName(tpl.name, existing.map((m) => m.name)),
        steps: tpl.steps.map((s, i) => ({ ...s, id: `s_${Date.now().toString(36)}_${i}` })),
        playMode: tpl.playMode,
        repeatInterval: tpl.repeatInterval,
        playCount: tpl.playCount,
        speed: tpl.speed,
      })
      message.success(`已创建「${created.name}」，下一步把它绑到侧键`)
      close()
      navigate(`/macro/edit/${created.id}`)
    } catch (e) {
      message.error(`创建模板失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusyKey(null)
    }
  }

  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-label="OpenMacro 新手引导"
      style={{
        position: 'fixed',
        right: 24,
        bottom: 24,
        zIndex: 1000,
        width: 480,
        maxWidth: 'calc(100vw - 48px)',
        background: 'var(--ant-color-bg-container, #fff)',
        border: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
        borderRadius: 12,
        boxShadow: '0 8px 28px rgba(0, 0, 0, 0.14)',
        padding: 16,
      }}
    >
      <Button
        type="text"
        size="small"
        aria-label="关闭新手引导"
        icon={<CloseOutlined />}
        onClick={close}
        style={{ position: 'absolute', top: 8, right: 8 }}
      />

      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <div style={{ paddingRight: 24 }}>
          <Typography.Text strong style={{ fontSize: 16 }}>
            3 步开始用 OpenMacro
          </Typography.Text>
          <Typography.Paragraph type="secondary" style={{ margin: '4px 0 0', fontSize: 14 }}>
            不用写代码：先确认侧键能被识别，再拿一个模板绑上去。
          </Typography.Paragraph>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <Tag color="blue" style={{ marginInlineEnd: 0 }}>
            1
          </Tag>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Typography.Text strong>确认侧键能被识别</Typography.Text>
            <div style={{ marginTop: 6 }}>
              <Button size="small" icon={<AimOutlined />} onClick={() => go('/detect')}>
                去按键检测
              </Button>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <Tag color="blue" style={{ marginInlineEnd: 0 }}>
            2
          </Tag>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Typography.Text strong>选一个模板，或自己录一个</Typography.Text>
            <Space wrap size={[6, 6]} style={{ marginTop: 6 }}>
              {MACRO_TEMPLATES.map((tpl) => (
                <Button
                  key={tpl.key}
                  size="small"
                  loading={busyKey === tpl.key}
                  disabled={busyKey !== null && busyKey !== tpl.key}
                  onClick={() => void useTemplate(tpl)}
                >
                  {tpl.name}
                </Button>
              ))}
              <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => go('/macro/create')}>
                自己录
              </Button>
            </Space>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <Tag color="blue" style={{ marginInlineEnd: 0 }}>
            3
          </Tag>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Typography.Text strong>把宏绑到侧键</Typography.Text>
            <div style={{ marginTop: 6 }}>
              <Button size="small" icon={<ApiOutlined />} onClick={() => go('/binding')}>
                去按键映射
              </Button>
            </div>
          </div>
        </div>

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          关闭后不再自动弹出；完整说明在「使用帮助」。
        </Typography.Text>
      </Space>
    </div>
  )
}
