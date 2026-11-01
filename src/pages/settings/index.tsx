// 系统设置（src/pages/settings/index.tsx）
// 两个系统的机制完全不同，用 tab 分开，但两页**同结构、同字段名**，方便对照：
//   Windows · 提权自启 —— 解决「必须在原神这类高完整性级别进程里用宏，就得每次手动右键管理员」：
//     开启 → 写入「登录触发 + 以最高权限运行」的计划任务，开机自己起来就是管理员；
//     手动 → 触发该任务并让出单实例锁，由它重新拉起提权实例。
//   macOS · 输入权限与自启 —— macOS 没有「提权」概念（CGEvent 注入/捕获只看 TCC 授权，
//     与是否 root 无关），要管的是两项输入授权（辅助功能 / 输入监控）+ 登录项开机启动。
// 两页统一布局（改一处两页一起改）：
//   单张「开机自启」卡：只读状态字段（标签在上、值在下，多语言下标签宽度互不影响，
//     只读值加浅灰底） → 「开机自启 ?」小标题 + 操作（开关 / 提权重启，两边操作行定高
//     24px 对齐）放卡片最下面——标题跟操作走，不再用 ProCard title：
//     Windows：程序路径 / 自启路径一行两列 → 运行权限独占一行 → 自启状态 / 开机自启一行两列
//     macOS  ：程序路径 / 自启路径一线两列 → 辅助功能 / 输入监控 → 自启状态 / 开机自启；
//              开关是可操作控件，不进只读灰底值区，只与同排值区同高
//     路径超长由 CSS 省略成 …，不撑破页面
//     ⚠ 不要改回 Descriptions：表格自动布局会被 nowrap 长路径撑破卡片，横排标签列
//       还会把「程序路径」挤成一字一行，多语言下更没法保证样式
//   状态刷新：不设「刷新」按钮，切到对应 tab 时刷新 + 选中期间每 5s 轮询一次；
//   非选中页不轮询（interval 只在 visible 时挂）。
//   说明文字全部收进问号（卡片标题问号 + 字段标签问号）；正文只放状态与操作。
//   非本系统时内容照常展示但禁用操作，状态行显示「仅 xx 可读取」占位。
//   Tab 之外还有一张「数据库文件」卡（本地 SQLite 路径 + 复制 / 显示）：与两系统的权限机制无关，
//   不进 tab，避免切 tab 重复读、也不被「仅 xx 可读取」禁用。
// 安全口径写死在这里：开通 / 关闭各需要一次系统权限确认（UAC），这一步不绕；
// 绕开的是「每次启动都弹一次」的重复打扰，不是「提权本身需要用户知情」。
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Alert,
  Button,
  Col,
  Modal,
  Popconfirm,
  Row,
  Space,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import {
  BilibiliOutlined,
  CommentOutlined,
  CopyOutlined,
  ExportOutlined,
  FolderOpenOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
  ShopOutlined,
  TikTokOutlined,
} from '@ant-design/icons'
import { PageContainer, ProCard } from '@ant-design/pro-components'
import {
  disableAdminAutostart,
  enableAdminAutostart,
  getAdminAutostartStatus,
  getDatabasePath,
  getMacLoginItem,
  getMacPermissionStatus,
  openMacPrivacyPane,
  relaunchElevated,
  revealMacAppBundle,
  revealPath,
  setMacLoginItem,
} from '@/api/settings'
import type { AdminAutostartStatus } from '@/types/admin-autostart'
import type { MacLoginItemStatus, MacPermissionStatus } from '@/types/mac-permissions'
import { HintIcon, HINT_WIDTH } from '@/components/HintIcon'
import authorAvatar from '@/assets/author-avatar.png'
import {
  BILIBILI_HINT,
  BILIBILI_URL,
  DOUYIN_HINT,
  DOUYIN_URL,
  SPONSOR_FEEDBACK,
  SPONSOR_POEM,
  SPONSOR_TITLE_HINT,
  XIANYU_HINT,
  XIANYU_URL,
} from '@/constants/sponsor'

/** 问号提示统一走共享组件（与首次启动引导卡同款） */
const hintIcon = (text: string) => <HintIcon text={text} />

const PAGE_HINT =
  '两个系统的「运行权限」是两回事：Windows 用计划任务提权（低权限进程不能给管理员权限的游戏注入输入）；macOS 不需要提权，但要授两项输入监控授权（辅助功能 + 输入监控，缺一项会出现「鼠标能捕获、键盘不能」），并可用登录项开机启动。'


/** 只读字段：标签在上、值在下（与编辑表单 ProForm 竖排标签同款，多语言下标签互不挤压）；
 *  值区加浅灰底 = 技能「详情页模板」只读基线，路径等长内容在其中自然铺满一行 */
function Field({
  label,
  hint,
  warning,
  children,
}: {
  label: string
  hint?: string
  warning?: string
  children: ReactNode
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <Space size={4} style={{ marginBottom: 4 }}>
        {label}
        {hint ? hintIcon(hint) : null}
      </Space>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 0,
          // 固定高度而非 minHeight：值区内容（Tag / 图标 / 按钮）不参与撑高，
          // 否则齿轮图标所在行的行盒会把 30px 的下限再抬高约 1px
          height: 30,
          padding: '3px 8px',
          background: '#f7f7f7',
          borderRadius: 6,
        }}
      >
        {children}
      </div>
      {warning && <Typography.Text type="warning">{warning}</Typography.Text>}
    </div>
  )
}

// ---- Windows 页的问号提示 ----

/** 运行权限行：为什么 Windows 要看完整性级别 */
const WIN_PERM_HINT =
  'Windows 的完整性级别（IL）：管理员权限运行的游戏，普通权限的宏一个都注入不进去，所以这里要看当前实例是不是 High IL（管理员）。'

/** 程序路径行：这条路径是干什么的 */
const WIN_PROGRAM_HINT = '本程序的可执行文件路径，也是提权自启计划任务要指向的目标。'

/** 自启路径行：与程序路径的关系 */
const WIN_TASK_HINT = '提权自启计划任务实际指向的程序路径，应与「程序路径」一致；不一致时任务不会生效。'

/** 自启状态行：计划任务的存在与有效性怎么看 */
const WIN_ENABLED_HINT =
  '计划任务是否已创建、是否生效：「已开启」= 开机登录后会以管理员权限自动启动；「需重新指向」= 任务指向的旧程序已不在，要重新指向（按钮就在旁边）；「未创建」= 还没开通。开发模式下只按任务是否存在展示「已创建 / 未创建」，不做指向判断（当前程序是 electron.exe）。后面的文字是任务名（schtasks 里可查）。'

/** 开机自启操作卡：机制 + 风险 + 不重启的替代路径 */
const WIN_PAGE_HINT =
  'Windows 规定低完整性级别（IL）的进程不能给高 IL 进程注入输入：游戏若是管理员权限，普通权限的宏就一个都发不进去。这里用计划任务绕过「每次都要右键管理员」的重复操作——开机自启的实例天然带管理员权限，不用再手动确认。' +
  '风险知悉：开通后本机任意进程都能触发该计划任务拉起管理员权限的 OpenMacro（这是「免 UAC 重复打扰」的代价），仅在自己独占、可信任的环境开启；共用或公司域控机器请勿开启。' +
  '也可以不重启：开启后下次登录时任务自己就会以管理员权限拉起实例。' +
  '打开开关会立即以管理员权限重启，UAC 只在这一步确认。'

/** 非 Windows 系统时，当前状态卡 ? 的替换文案 */
const WIN_STATUS_HINT_UNSUPPORTED =
  '当前系统不是 Windows，本页配置仅展示、不可操作（开关已禁用，状态行显示占位）。macOS 不需要提权——输入注入只看系统授权（辅助功能 / 输入监控），请切换到「macOS」页。'

// ---- macOS 页的问号提示 ----

/** 程序路径行：手动添加系统授权时要用的路径 */
const MAC_BUNDLE_HINT =
  '手动添加系统授权（辅助功能 / 输入监控）时用这个路径：在设置面板点「+」后按 Cmd+Shift+G 粘贴，或点路径旁的文件夹按钮在 Finder 中显示后直接拖进列表。开发态是 node_modules 里的 Electron.app，打包安装后是 /Applications/OpenMacro.app。'

const MAC_AX_HINT = '不授权则全局钩子无法启动，鼠标键盘都捕获不到。点旁边的齿轮按钮直达辅助功能面板。'
const MAC_IM_HINT =
  '不授权则鼠标 / 滚轮 / 修饰键正常，但键盘按键被系统静默丢弃——「鼠标能捕获、键盘不能」就是这个原因，是最难排查的一项。点旁边的齿轮按钮直达输入监控面板。'

/** 开机自启操作卡：登录项机制 + 授权持久化 */
const MAC_LOGIN_HINT =
  '使用系统登录项（Login Items，macOS 13+ 为 SMAppService）实现，无需额外授权、不会弹窗。输入授权按程序路径持久化，开机启动的仍是同一个程序，授权不会丢，钩子直接可用。'

/** 非 macOS 系统时，拼在每条问号提示前的跨平台说明 */
const MAC_PAGE_UNSUPPORTED = '当前系统不是 macOS，本页配置仅展示、不可操作。'

// ---- 两个系统共用：下载地址 ----

/** 发布页：点链接会在系统浏览器打开（主进程把外链交给 shell.openExternal） */
const DOWNLOAD_URL = 'https://github.com/dawangcode/OpenMacro/releases'

// B 站 / 抖音入口、打赏码、赞助文案已移至 @/constants/sponsor（见文件头 import）

/** 下载地址行：发布页能拿到什么 */
const DOWNLOAD_HINT =
  '安装包与更新都发布在 GitHub Releases：点链接在系统浏览器打开，可下载最新版本安装包、查看每个版本的更新内容。当前版本以窗口左下角显示为准。'

// ---- 两个系统共用：本地数据文件 ----

/** 数据库文件行：位置、内容、备份口径 */
const DB_PATH_HINT =
  '所有宏、快捷键绑定、防抖规则与配置都存在这一个 SQLite 文件里（同目录下的 -wal / -shm 是它的临时日志，不用单独管）。备份 / 迁移时先退出程序再复制，运行中复制会拿到半写状态的数据。'

/** 当前平台（浏览器 dev 模式下取不到，按 unknown 处理） */
function currentPlatform(): string {
  return typeof window !== 'undefined' && window.electronAPI ? window.electronAPI.platform : ''
}

/** 路径行：单行省略 + 复制按钮（两页共用；antd 的 copyable 会禁用 CSS 省略，故手写）。
 *  放在 Field 的值区里自然铺满一行，按钮靠右，超出省略成 … */
function PathRow({
  path,
  suffix,
  copyable = true,
  /** 给了就渲染成可点链接：主进程 setWindowOpenHandler 会把外链交给系统浏览器打开（不会在窗口内跳转） */
  href,
}: {
  path: string
  suffix?: ReactNode
  copyable?: boolean
  href?: string
}) {
  const copy = async () => {
    if (!path) return
    try {
      await navigator.clipboard.writeText(path)
      message.success('已复制路径')
    } catch {
      message.error('复制失败，请悬停路径后手动复制')
    }
  }

  return (
    <>
      <Tooltip title={path} placement="topLeft">
        {href ? (
          <Typography.Link
            href={href}
            target="_blank"
            rel="noreferrer"
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {path || '—'}
          </Typography.Link>
        ) : (
          <Typography.Text
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {path || '—'}
          </Typography.Text>
        )}
      </Tooltip>
      {copyable && (
        <Tooltip title="复制路径">
          <Button
            type="text"
            icon={<CopyOutlined style={{ fontSize: 14 }} />}
            disabled={!path}
            onClick={copy}
            style={{ height: 22, width: 22, minWidth: 22, padding: 0, flex: '0 0 auto' }}
          />
        </Tooltip>
      )}
      {suffix}
    </>
  )
}

/** 非本系统时的占位状态 */
const placeholder = (platform: string) => (
  <Typography.Text type="secondary">仅 {platform} 可读取</Typography.Text>
)

/** 赞助卡的平台入口：整行可点（图标 + 标题 + 动作说明），URL 为空时降级成同款静态行。
 *  问号挨着平台名（解释跟着名字走），点它时拦掉跳转；行尾箭头表示「在浏览器打开」。 */
function SupportChannel({
  href,
  icon,
  color,
  tint,
  name,
  actions,
  hint,
}: {
  href: string
  icon: ReactNode
  color: string
  tint: string
  name: string
  actions: string
  hint: string
}) {
  const body = (
    <>
      <span
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 16,
          flex: '0 0 auto',
          color,
          background: tint,
        }}
      >
        {icon}
      </span>
      <span style={{ flex: 1, minWidth: 0, lineHeight: 1.4 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="openmacro-sponsor-name" style={{ fontSize: 14, fontWeight: 600 }}>
            {name}
          </span>
          {/* 问号在链接里：点它只弹说明，不跟着跳转 */}
          <span
            style={{ display: 'inline-flex' }}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            {hintIcon(hint)}
          </span>
        </span>
        <span style={{ display: 'block', fontSize: 12, color: 'rgba(0, 0, 0, 0.5)' }}>{actions}</span>
      </span>
      {href && (
        <ExportOutlined className="openmacro-sponsor-arrow" style={{ fontSize: 12, flex: '0 0 auto' }} />
      )}
    </>
  )

  return (
    <div
      className="openmacro-sponsor-channel"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        background: '#fff',
        border: '1px solid #f0f0f0',
        borderRadius: 8,
        minWidth: 0,
      }}
    >
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flex: 1,
            minWidth: 0,
            color: 'inherit',
            textDecoration: 'none',
          }}
        >
          {body}
        </a>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>{body}</div>
      )}
    </div>
  )
}

export default function SettingsPage() {
  const platform = currentPlatform()
  const isMac = platform === 'darwin'
  const [activeKey, setActiveKey] = useState(isMac ? 'macos' : 'windows')
  const [dbPath, setDbPath] = useState('')
  /** dev 态标识：页面级信息按技能规范走 PageContainer extra（页头右上角），进页面取一次即可 */
  const [devMode, setDevMode] = useState(false)

  /** 路径由主进程算好、进程内不变，进页面取一次即可；浏览器模式返回空串显示占位 */
  useEffect(() => {
    getDatabasePath().then(setDbPath)
    // devMode 在一次会话内不变，不轮询；取不到按非 dev 处理，不影响页面其余部分
    getAdminAutostartStatus()
      .then((s) => setDevMode(s.devMode))
      .catch(() => setDevMode(false))
  }, [])

  return (
    <PageContainer
      title={
        <Space size={4}>
          系统设置
          <Tooltip title={<span style={{ display: 'block', maxWidth: HINT_WIDTH }}>{PAGE_HINT}</span>}>
            <QuestionCircleOutlined style={{ color: 'rgba(0, 0, 0, 0.45)' }} />
          </Tooltip>
        </Space>
      }
      extra={devMode ? <DevModeTag /> : undefined}
    >
      <Tabs
        activeKey={activeKey}
        onChange={setActiveKey}
        items={[
          { key: 'windows', label: 'Windows', children: <WindowsPanel visible={activeKey === 'windows'} /> },
          { key: 'macos', label: 'macOS', children: <MacPanel supported={isMac} visible={activeKey === 'macos'} /> },
        ]}
      />

      {/* 数据文件与下载地址同属「本机 / 版本信息」，与两系统的权限机制无关，放 tab 外一行两列
          （切 tab 不重复读，也不受非本系统禁用影响）。外链 target=_blank 由主进程
          setWindowOpenHandler 交给系统浏览器打开，不会把设置页窗口跳走。 */}
      <ProCard size="small" style={{ marginTop: 16 }}>
        <Row gutter={12}>
          <Col span={12}>
            <Field label="数据库文件" hint={DB_PATH_HINT}>
              <PathRow
                path={dbPath}
                suffix={
                  <Tooltip title="在文件管理器中显示数据库文件">
                    <Button
                      type="text"
                      icon={<FolderOpenOutlined style={{ fontSize: 14 }} />}
                      style={{ height: 22, width: 22, minWidth: 22, padding: 0, flex: '0 0 auto' }}
                      disabled={!dbPath}
                      onClick={async () => {
                        if (!dbPath) return
                        const r = await revealPath(dbPath)
                        if (!r.ok) message.error(r.reason ?? '打开文件夹失败')
                      }}
                    />
                  </Tooltip>
                }
              />
            </Field>
          </Col>
          <Col span={12}>
            <Field label="下载地址" hint={DOWNLOAD_HINT}>
              <PathRow
                path={DOWNLOAD_URL}
                href={DOWNLOAD_URL}
                suffix={
                  <Tooltip title="在系统浏览器中打开">
                    <Button
                      type="text"
                      icon={<ExportOutlined style={{ fontSize: 14 }} />}
                      style={{ height: 22, width: 22, minWidth: 22, padding: 0, flex: '0 0 auto' }}
                      onClick={() => window.open(DOWNLOAD_URL, '_blank', 'noopener')}
                    />
                  </Tooltip>
                }
              />
            </Field>
          </Col>
        </Row>
      </ProCard>

      {/* 赞助卡：自愿打赏，放设置页底部（核心流程之外、两个 tab 共用）。
          左栏「信」：头像 + 打油诗；右栏「去处」：B 站 / 抖音 / 闲鱼入口 + 提需求说明。
          收款码暂时下线，只保留文案与三个平台入口。 */}
      <ProCard id="sponsor-card" size="small" style={{ marginTop: 16 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'stretch',
            justifyContent: 'center',
            gap: 40,
            flexWrap: 'wrap',
            padding: '4px 0',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              flex: '0 1 380px',
              minWidth: 260,
            }}
          >
            {/* 作者头像替代原来的 ☕ emoji：圆形 48px，与标题同行 */}
            <Space size={10} align="center">
              <img
                src={authorAvatar}
                alt="作者头像"
                width={48}
                height={48}
                style={{
                  display: 'block',
                  borderRadius: '50%',
                  flex: '0 0 auto',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                }}
              />
              <Typography.Text strong style={{ fontSize: 16 }}>
                支持作者
              </Typography.Text>
              {hintIcon(SPONSOR_TITLE_HINT)}
            </Space>
            {/* 主文案：四行打油诗，左侧淡蓝竖线当引文，行高 2 让四句不挤在一起 */}
            <div style={{ paddingLeft: 14, borderLeft: '3px solid #d6e4ff' }}>
              <Typography.Text
                style={{
                  display: 'block',
                  fontSize: 14,
                  lineHeight: 1.6,
                  letterSpacing: 0.6,
                  color: 'rgba(0, 0, 0, 0.78)',
                  whiteSpace: 'pre-line',
                }}
              >
                {SPONSOR_POEM}
              </Typography.Text>
            </div>
          </div>

          {/* 右栏：整块浅灰底把「去哪支持」与左侧的「信」分开；两行入口各自白底，
              悬停描边提亮（见 global.less .openmacro-sponsor-channel） */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              flex: '0 1 480px',
              minWidth: 280,
              padding: 10,
              background: '#fafbfc',
              border: '1px solid #f0f0f0',
              borderRadius: 10,
            }}
          >
            {/* 三个平台的动作组不同：B 站一键三连=点赞+投币+收藏（关注是单独动作，追加在行尾，
                一键三连按钮本身不含关注，要点进 UP 主空间）；抖音是三个独立动作含关注；
                闲鱼只作打赏入口，不是互动渠道，动作只写下单打赏，不引导留言 */}
            <SupportChannel
              href={BILIBILI_URL}
              icon={<BilibiliOutlined />}
              color="#00AEEC"
              tint="#e8f7fd"
              name="B 站"
              actions="一键三连 · 关注 · 留言"
              hint={BILIBILI_HINT}
            />
            <SupportChannel
              href={DOUYIN_URL}
              icon={<TikTokOutlined />}
              color="#161823"
              tint="#f2f2f4"
              name="抖音"
              actions="点赞 · 收藏 · 关注 · 留言"
              hint={DOUYIN_HINT}
            />
            <SupportChannel
              href={XIANYU_URL}
              icon={<ShopOutlined />}
              color="#FAAD14"
              tint="#FFFBE6"
              name="闲鱼"
              actions="下单打赏"
              hint={XIANYU_HINT}
            />
            {/* 必须写「视频评论区」：应用内没有评论区，只写「评论区」会让人以为在软件里留言 */}
            <div
              style={{
                marginTop: 'auto',
                paddingTop: 10,
                borderTop: '1px solid #f0f0f0',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 6,
              }}
            >
              <CommentOutlined style={{ fontSize: 12, marginTop: 5, color: 'rgba(0, 0, 0, 0.35)' }} />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {SPONSOR_FEEDBACK}
              </Typography.Text>
            </div>
          </div>
        </div>
      </ProCard>
    </PageContainer>
  )
}

/**
 * dev 态标识：页面级信息按技能规范放 PageContainer extra（页头右上角，与标题同一基线），
 * 不再用 position: fixed 自造悬浮块；颜色走 antd Tag 的 warning 语义色，不硬编码 hex。
 * 整块 Alert 太占地方，点开弹窗才看完整说明。
 */
function DevModeTag() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Tooltip title="开发模式：点击查看说明">
        <Tag
          color="warning"
          onClick={() => setOpen(true)}
          style={{ marginInlineEnd: 0, cursor: 'pointer' }}
        >
          开发模式
        </Tag>
      </Tooltip>
      <Modal
        title="开发模式"
        open={open}
        width={560}
        onCancel={() => setOpen(false)}
        footer={
          <Button type="primary" onClick={() => setOpen(false)}>
            知道了
          </Button>
        }
      >
        <Space direction="vertical" size={8}>
          <Typography.Text>
            当前运行的是开发模式：程序路径指向 node_modules 里的 electron.exe，与打包安装后的 OpenMacro.exe
            不是同一个，因此「自启路径」与「程序路径」显示不一致属预期，不是任务配置错误。
          </Typography.Text>
          <Typography.Text>
            影响范围：「自启状态」只按任务是否存在展示「已创建 / 未创建」，不做指向判断；开机自启开关与「重新指向」都要在打包安装后的程序里操作。
          </Typography.Text>
        </Space>
      </Modal>
    </>
  )
}

/** Windows 页：计划任务提权自启（任何系统都展示，非 Windows 仅禁用操作） */
function WindowsPanel({ visible }: { visible: boolean }) {
  const [status, setStatus] = useState<AdminAutostartStatus | null>(null)
  const [busy, setBusy] = useState(false)
  /** 轮询期间只在第一次失败时弹提示，避免每 5s 弹一次 */
  const erroredRef = useRef(false)

  const refresh = useCallback(async () => {
    try {
      setStatus(await getAdminAutostartStatus())
      erroredRef.current = false
    } catch (e) {
      if (!erroredRef.current) {
        erroredRef.current = true
        message.error(`读取运行权限状态失败：${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }, [])

  /** 切到本页刷新一次；选中期间每 5s 轮询，切走即停 */
  useEffect(() => {
    if (!visible) return
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => clearInterval(timer)
  }, [visible, refresh])

  /** 开关只管计划任务的建立 / 删除，不再顺带重启：切权限是独立动作（见 handleRelaunch）。
   *  早前把「开通 + 立即提权重启」合成一步，用户点一下开关程序就被重启，操作不可预期。 */
  const handleToggle = async (next: boolean) => {
    setBusy(true)
    try {
      const r = next ? await enableAdminAutostart() : await disableAdminAutostart()
      if (r.canceled) {
        message.warning('已取消授权，设置未变更')
        setBusy(false)
        return
      }
      if (!r.ok) {
        message.error(r.reason ?? '操作失败')
        setBusy(false)
        return
      }
      if (r.status) setStatus(r.status)
      else await refresh()
      message.success(next ? '已开启提权自启（下次登录生效，想立刻提权点「重启提权」）' : '已关闭提权自启')
      setBusy(false)
    } catch (e) {
      message.error(`操作失败：${e instanceof Error ? e.message : String(e)}`)
      setBusy(false)
    }
  }

  /** 单独的重启提权：触发计划任务拉起管理员权限实例，当前实例让出单实例锁后退出 */
  const handleRelaunch = async () => {
    setBusy(true)
    try {
      const r = await relaunchElevated()
      if (!r.ok) {
        message.error(r.reason ?? '切换失败')
        if (r.status) setStatus(r.status)
        setBusy(false)
        return
      }
      message.success('正在切换到管理员权限实例，窗口即将重启')
      // 进程即将退出，不再复位 busy
    } catch (e) {
      message.error(`切换失败：${e instanceof Error ? e.message : String(e)}`)
      setBusy(false)
    }
  }

  const supported = status?.supported === true
  // dev 态 exePath 是 electron.exe，与指向打包程序的任务必然不一致，不按「需重新指向」处理（见 devMode 注释）
  const devMode = status?.devMode === true
  const pathMismatch = supported && !devMode && !!status?.taskExists && status?.taskPathMatches === false
  const exePath = supported ? status?.exePath || '' : ''

  return (
    <ProCard size="small">
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {/* 只读状态在上：程序路径 / 自启路径一行两列 → 运行权限独占一行 → 自启状态 / 开机自启一行两列 */}
        {pathMismatch && (
          <Alert
            type="warning"
            showIcon
            message="计划任务指向的程序与当前不一致"
            description="当前运行的是新路径的程序，任务仍指向旧路径，该任务不会生效。多为重装 / 换了安装目录，或任务由旧版本创建——点「自启状态」旁的重新指向即可。"
          />
        )}
        {status ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {/* 两条路径各占半行：路径长会省略成 …，完整值走 Tooltip 悬停 + 复制按钮 */}
            <Row gutter={12}>
              <Col span={12}>
                <Field label="程序路径" hint={WIN_PROGRAM_HINT}>
                  <PathRow
                    path={exePath}
                    suffix={
                      <Tooltip title="在资源管理器中显示当前程序">
                        <Button
                          type="text"
                          icon={<FolderOpenOutlined style={{ fontSize: 14 }} />}
                          style={{ height: 22, width: 22, minWidth: 22, padding: 0, flex: '0 0 auto' }}
                          disabled={!exePath}
                          loading={busy}
                          onClick={async () => {
                            if (!exePath) return
                            const r = await revealPath(exePath)
                            if (!r.ok) message.error(r.reason ?? '打开文件夹失败')
                          }}
                        />
                      </Tooltip>
                    }
                  />
                </Field>
              </Col>
              <Col span={12}>
                <Field
                  label="自启路径"
                  hint={WIN_TASK_HINT}
                  warning={pathMismatch ? '与「程序路径」不一致，该任务不会生效' : undefined}
                >
                  <PathRow path={supported ? status?.taskCommand || '' : ''} copyable={false} />
                </Field>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={24}>
                <Field label="运行权限" hint={WIN_PERM_HINT}>
                  {supported ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                      {status?.elevated ? (
                        <Tag color="green">管理员（High IL）</Tag>
                      ) : (
                        <Tag>普通权限（Medium IL）</Tag>
                      )}
                      {/* 提权重启独立成按钮：只切当前实例的权限，与「开机自启」解耦；
                          走计划任务拉起管理员实例，不弹 UAC */}
                      {!status?.elevated && (
                        <Popconfirm
                          title="以管理员权限重启？"
                          description="当前窗口会关闭，由管理员权限实例接管；未保存的输入会丢失。"
                          okText="确定"
                          cancelText="取消"
                          onConfirm={handleRelaunch}
                        >
                          <Tooltip
                            title={status?.enabled ? '' : '未开启自启：切换时会弹一次 UAC 确认框'}
                          >
                            <Button size="small" loading={busy}>
                              重启提权
                            </Button>
                          </Tooltip>
                        </Popconfirm>
                      )}
                    </div>
                  ) : (
                    placeholder('Windows')
                  )}
                </Field>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={12}>
                <Field label="自启状态" hint={WIN_ENABLED_HINT}>
                  {supported ? (
                    <Space size={4} wrap>
                      {status?.taskExists ? (
                        <Tag color={status.enabled ? 'blue' : 'orange'}>
                          {status.enabled ? '已开启' : devMode ? '已创建' : '需重新指向'}
                        </Tag>
                      ) : (
                        <Tag>未创建</Tag>
                      )}
                      <Typography.Text type="secondary">{status?.taskName}</Typography.Text>
                      {/* 重新指向跟随状态放这里：告警只留解释，动作贴近它修复的那个字段 */}
                      {pathMismatch && (
                        <Button size="small" loading={busy} onClick={() => handleToggle(true)}>
                          重新指向
                        </Button>
                      )}
                    </Space>
                  ) : (
                    placeholder('Windows')
                  )}
                </Field>
              </Col>
              <Col span={12}>
                {/* 开关是可操作控件，不进只读灰底值区（灰底是只读信息基线）；
                    只与同排值区同高（30px）对齐，标签在上同款布局 */}
                <div style={{ minWidth: 0 }}>
                  <Space size={4} style={{ marginBottom: 4 }}>
                    开机自启
                    {hintIcon(supported ? WIN_PAGE_HINT : WIN_STATUS_HINT_UNSUPPORTED)}
                  </Space>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 30, minWidth: 0 }}>
                    <Tooltip
                      title={devMode ? '开发模式不可管理：dev 态程序路径是 electron.exe，请用打包安装后的程序操作' : ''}
                    >
                      <Switch
                        checked={supported && status?.enabled === true}
                        disabled={!supported || busy || status === null || devMode}
                        loading={busy}
                        onChange={(v) => handleToggle(v)}
                      />
                    </Tooltip>
                    <Typography.Text>开机登录后自动以管理员权限启动</Typography.Text>
                  </div>
                </div>
              </Col>
            </Row>
          </Space>
        ) : (
          <Typography.Text type="secondary">正在读取…</Typography.Text>
        )}

      </Space>
    </ProCard>
  )
}

/** macOS 页：两项输入授权（TCC）+ 登录项开机启动（任何系统都展示，非 macOS 仅禁用操作） */
function MacPanel({ supported, visible }: { supported: boolean; visible: boolean }) {
  const [perm, setPerm] = useState<MacPermissionStatus | null>(null)
  const [login, setLogin] = useState<MacLoginItemStatus | null>(null)
  const [busy, setBusy] = useState(false)
  /** 轮询期间只在第一次失败时弹提示，避免每 5s 弹一次 */
  const erroredRef = useRef(false)
  const active = supported

  const refresh = useCallback(async () => {
    try {
      const [p, l] = await Promise.all([getMacPermissionStatus(), getMacLoginItem()])
      setPerm(p)
      setLogin(l)
      erroredRef.current = false
    } catch (e) {
      if (!erroredRef.current) {
        erroredRef.current = true
        message.error(`读取 macOS 权限状态失败：${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }, [])

  /** 切到本页刷新一次；选中期间每 5s 轮询，切走即停 */
  useEffect(() => {
    if (!visible) return
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => clearInterval(timer)
  }, [visible, refresh])

  const handleOpenPane = async (pane: 'accessibility' | 'inputMonitoring') => {
    setBusy(true)
    try {
      const r = await openMacPrivacyPane(pane)
      if (!r.ok) message.error(r.reason ?? '打开系统设置失败')
    } finally {
      setBusy(false)
    }
  }

  const handleToggleLogin = async (next: boolean) => {
    setBusy(true)
    try {
      const r = await setMacLoginItem(next)
      if (!r.ok) {
        message.error(r.reason ?? '设置失败')
      } else {
        message.success(next ? '已开启开机启动：下次登录自动启动 OpenMacro' : '已关闭开机启动')
      }
      if (r.status) setLogin(r.status)
      else await refresh()
    } finally {
      setBusy(false)
    }
  }

  const handleReveal = async () => {
    setBusy(true)
    try {
      const r = await revealMacAppBundle()
      if (!r.ok) message.error(r.reason ?? '打开 Finder 失败')
    } finally {
      setBusy(false)
    }
  }

  const permTag = (granted: boolean) =>
    granted ? <Tag color="green">已授权</Tag> : <Tag color="red">未授权</Tag>

  /** 非 macOS 时在问号提示前拼一句跨平台说明 */
  const pageHint = (text: string) => (active ? text : `${MAC_PAGE_UNSUPPORTED}${text}`)

  const bundlePath = active ? perm?.appBundlePath || '' : ''
  /** 登录项注册的就是同一个 .app 包，没有独立路径可显示 */
  const loginPathHint = '登录项注册的是同一个 .app 包，路径与「程序路径」一致'

  return (
    <ProCard size="small">
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {/* 只读状态在上：程序路径 / 自启路径一行两列 → 辅助功能 / 输入监控 → 自启状态 / 开机自启 */}
        {active && (!perm || !login) ? (
          <Typography.Text type="secondary">正在读取…</Typography.Text>
        ) : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {active && perm && !perm.available && (
              <Alert
                type="warning"
                showIcon
                message="授权状态查询失败"
                description="原生输入模块未加载。请确认客户端完整启动（宏库管理页顶部无黄条）后重试。"
              />
            )}
            {/* 与 Windows 页统一：程序路径 / 自启路径一行两列 */}
            <Row gutter={12}>
              <Col span={12}>
                <Field label="程序路径" hint={MAC_BUNDLE_HINT}>
                  <PathRow
                    path={bundlePath}
                    suffix={
                      <Tooltip title="在 Finder 中显示当前 .app 包（可直接拖进系统授权列表）">
                        <Button
                          type="text"
                          icon={<FolderOpenOutlined style={{ fontSize: 14 }} />}
                          style={{ height: 22, width: 22, minWidth: 22, padding: 0, flex: '0 0 auto' }}
                          disabled={!active}
                          loading={busy}
                          onClick={handleReveal}
                        />
                      </Tooltip>
                    }
                  />
                </Field>
              </Col>
              <Col span={12}>
                <Field label="自启路径" hint={loginPathHint}>
                  {active ? (
                    bundlePath ? (
                      <Typography.Text type="secondary">与程序路径一致（同一 .app 包）</Typography.Text>
                    ) : (
                      <Typography.Text type="secondary">—</Typography.Text>
                    )
                  ) : (
                    placeholder('macOS')
                  )}
                </Field>
              </Col>
            </Row>
            {/* 两行两列，顺序：辅助功能 / 输入监控（第二行）→ 自启状态 / 开机自启（第三行） */}
            <Row gutter={12}>
              <Col span={12}>
                <Field label="辅助功能" hint={MAC_AX_HINT}>
                  {active ? (
                    // 用 flex 行代替 Space：图标作为 flex item 不参与行盒计算，值区高度恒定
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {permTag(perm?.accessibility === true)}
                      <Tooltip title="打开系统设置的辅助功能面板">
                        <SettingOutlined
                          role="button"
                          aria-label="打开辅助功能面板"
                          onClick={() => handleOpenPane('accessibility')}
                          style={{ fontSize: 16, cursor: 'pointer', color: 'rgba(0, 0, 0, 0.45)' }}
                        />
                      </Tooltip>
                    </div>
                  ) : (
                    placeholder('macOS')
                  )}
                </Field>
              </Col>
              <Col span={12}>
                <Field label="输入监控" hint={MAC_IM_HINT}>
                  {active ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {permTag(perm?.inputMonitoring === true)}
                      <Tooltip title="打开系统设置的输入监控面板">
                        <SettingOutlined
                          role="button"
                          aria-label="打开输入监控面板"
                          onClick={() => handleOpenPane('inputMonitoring')}
                          style={{ fontSize: 16, cursor: 'pointer', color: 'rgba(0, 0, 0, 0.45)' }}
                        />
                      </Tooltip>
                    </div>
                  ) : (
                    placeholder('macOS')
                  )}
                </Field>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={12}>
                <Field
                  label="自启状态"
                  hint={active && !login?.supported ? login?.reason || '仅打包安装后的程序支持设置开机启动' : undefined}
                >
                  {active ? (
                    <Tag color={login?.openAtLogin === true ? 'blue' : 'default'}>
                      {login?.openAtLogin === true ? '登录项已开启' : '登录项未开启'}
                    </Tag>
                  ) : (
                    placeholder('macOS')
                  )}
                </Field>
              </Col>
              <Col span={12}>
                {/* 开关是可操作控件，不进只读灰底值区（灰底是只读信息基线）；
                    只与同排值区同高（30px）对齐，标签在上同款布局 */}
                <div style={{ minWidth: 0 }}>
                  <Space size={4} style={{ marginBottom: 4 }}>
                    开机自启
                    {hintIcon(pageHint(MAC_LOGIN_HINT))}
                  </Space>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 30, minWidth: 0 }}>
                    <Switch
                      checked={active && login?.openAtLogin === true}
                      disabled={!active || !login?.supported || busy}
                      loading={busy}
                      onChange={handleToggleLogin}
                    />
                    <Typography.Text>登录时自动启动</Typography.Text>
                  </div>
                </div>
              </Col>
            </Row>
          </Space>
        )}

      </Space>
    </ProCard>
  )
}
