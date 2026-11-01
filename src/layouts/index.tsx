// 全局布局（src/layouts/index.tsx）
// ProLayout（@ant-design/pro-components 3.x，与 soft/lup 同栈同版本 3.1.14-7，LUP 已真机验证可用）；
// 菜单数据集中在 MENU，与 .umirc.ts routes 一一对应；menuItemRender 走 navigate（hash 路由安全）
import { ConfigProvider, Tooltip } from 'antd'
import { ProLayout } from '@ant-design/pro-components'
import {
  AimOutlined,
  ApiOutlined,
  AppstoreOutlined,
  QuestionCircleOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  ThunderboltFilled,
} from '@ant-design/icons'
import { useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'umi'
import { theme } from '@/theme'
import FirstRunGuide from '@/components/FirstRunGuide'
import { APP_VERSION } from '@/constants/app'
import authorAvatar from '@/assets/author-avatar.png'

// 六个一级菜单平级，不互相嵌套（按键防抖为独立顶层路由 /debounce，不挂在 /binding 下）
// 图标语义：九宫格=宏库（不用闪电，避免和左上角 logo 的闪电撞） / 插头=绑定 · 映射 / 盾牌=防误触 /
// 准星=捕获检测 / 齿轮=系统设置 / 问号=使用帮助（排在最后，属查阅型入口不是高频操作）
// 菜单名统一四字（宏库管理），避免"宏管理"三字在菜单里长短不一
const MENU = [
  { path: '/macro', name: '宏库管理', icon: <AppstoreOutlined /> },
  { path: '/binding', name: '按键映射', icon: <ApiOutlined /> },
  { path: '/debounce', name: '按键防抖', icon: <SafetyCertificateOutlined /> },
  { path: '/detect', name: '按键检测', icon: <AimOutlined /> },
  { path: '/settings', name: '系统设置', icon: <SettingOutlined /> },
  { path: '/help', name: '使用帮助', icon: <QuestionCircleOutlined /> },
]

// 闪电大小与桌面图标（resources/icon.png，BOLT_RATIO = 0.5 / BOLT_STRETCH = 1.06）对齐：
// antd 图标的 viewBox 是「64 64 896 896」，闪电墨迹高 831.1 / 896 = 0.928em，
// 30px 方块 × 50% ÷ 0.928 = 16.2px（定宽）；高度再由 BOLT_STRETCH 单独放大，与桌面同参数。
const BOLT_FONT = 16.2
const BOLT_STRETCH = 1.06
// 桌面图标按光学居中下移 20px（= 512 的 3.9%），侧栏同比例 = 3.9% × 30 = 1.2px
const BOLT_DY = 1.2

/**
 * 品牌方块：展开 / 收起都保持 30px，尺寸和水平位置固定。
 * 之前收起时缩到 26px，配合侧栏宽度过渡看起来像"抖一下"；现在只隐藏右侧文字，
 * 图标本身一动不动（收起后 17 + 30 + 17 = 64，正好落在折叠侧栏的视觉中心）。
 */
function BrandLogo() {
  return (
    <div
      style={{
        width: 30,
        height: 30,
        flex: '0 0 auto',
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(145deg, #2b3242 0%, #12161f 55%, #05070a 100%)',
        boxShadow: '0 2px 6px rgba(0, 0, 0, 0.25)',
      }}
    >
      <ThunderboltFilled
        style={{
          fontSize: BOLT_FONT,
          color: '#fff',
          // 先竖向拉伸再整体下移：translateY 在外层，位移量不被 scaleY 放大
          transform: `translateY(${BOLT_DY}px) scaleY(${BOLT_STRETCH})`,
        }}
      />
    </div>
  )
}

const LOGO = <BrandLogo />

export default function BasicLayout() {
  const location = useLocation()
  const navigate = useNavigate()

  // 窗口标题：OpenMacro-当前菜单名（动态，随路由变化）
  const currentMenu = MENU.find((m) => location.pathname.startsWith(m.path))
  const windowTitle = currentMenu ? `OpenMacro-${currentMenu.name}` : 'OpenMacro'
  useEffect(() => {
    document.title = windowTitle
    window.electronAPI?.windowSetTitle(windowTitle)
  }, [windowTitle])

  return (
    <ConfigProvider theme={theme}>
      <ProLayout
        title="OpenMacro"
        logo={LOGO}
        // 自绘页头：展开/收起都左对齐，logo 固定 30px 不动，只隐藏右侧文字（见 BrandLogo 注释）
        menuHeaderRender={(_logo, _title, props) => (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
              gap: 10,
              width: '100%',
              minWidth: 0,
            }}
          >
            <BrandLogo />
            {!props?.collapsed && (
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  fontSize: 16,
                  fontWeight: 600,
                  color: 'rgba(0, 0, 0, 0.88)',
                  whiteSpace: 'nowrap',
                }}
              >
                OpenMacro
              </span>
            )}
          </div>
        )}
        location={location}
        menu={{ locale: false }}
        menuItemRender={(item, dom) => <a onClick={() => item.path && navigate(item.path)}>{dom}</a>}
        route={{ path: '/', routes: MENU }}
        // 页头标语：产品定位
        headerContentRender={() => (
          <span style={{ color: 'rgba(0, 0, 0, 0.45)', fontSize: 14 }}>你的通用宏工作台</span>
        )}
        // 版本信息 + 支持作者入口，固定在左侧菜单下方、整体窗口左下角。
        // 头像折叠时也保留：侧栏唯一常驻曝光位（设置页装完配一次就再也不打开，靠这儿补曝光）
        menuFooterRender={(props) => {
          const collapsed = props?.collapsed === true
          return (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: collapsed ? '8px 0' : '8px 26px',
                justifyContent: collapsed ? 'center' : 'flex-start',
              }}
            >
              {!collapsed && (
                <span style={{ fontSize: 12, color: 'rgba(0, 0, 0, 0.45)', whiteSpace: 'nowrap' }}>
                  v{APP_VERSION}
                </span>
              )}
              <Tooltip title="支持作者">
                <img
                  src={authorAvatar}
                  alt="支持作者"
                  width={24}
                  height={24}
                  role="button"
                  onClick={() => {
                    navigate('/settings')
                    // 等设置页渲染出来再滚到赞助卡（id 见 pages/settings 的赞助 ProCard）
                    setTimeout(
                      () =>
                        document
                          .getElementById('sponsor-card')
                          ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
                      120,
                    )
                  }}
                  style={{ display: 'block', borderRadius: '50%', cursor: 'pointer', flex: '0 0 auto' }}
                />
              </Tooltip>
            </div>
          )
        }}
      >
        <Outlet />
        {/* 首次启动上手引导：3 步 + 模板，非模态右下角卡片，关闭一次后永不再现 */}
        <FirstRunGuide />
      </ProLayout>
    </ConfigProvider>
  )
}
