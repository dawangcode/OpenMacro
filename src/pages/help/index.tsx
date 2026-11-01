// 使用帮助（src/pages/help/index.tsx）
// 一个页面讲清「从录制到用上」的完整链路 + 两个系统的权限机制 + 高频问题排查。
// 布局：左侧内容（每节一张 ProCard），右侧 Anchor 目录锚点跳转；
// 内容与各功能页的实际行为一一对应，改功能时记得同步这里。
import { Alert, Anchor, Col, Row, Space, Tag, Typography } from 'antd'
import { PageContainer, ProCard } from '@ant-design/pro-components'

/** 目录锚点：与下方各节 id 一一对应 */
const SECTIONS = [
  { id: 'quickstart', title: '三步上手' },
  { id: 'record', title: '录制宏' },
  { id: 'binding', title: '按键映射' },
  { id: 'debounce', title: '按键防抖' },
  { id: 'detect', title: '按键检测' },
  { id: 'perm-win', title: 'Windows 提权' },
  { id: 'perm-mac', title: 'macOS 授权' },
  { id: 'faq', title: '常见问题' },
]

/** 正文小标题：比 ProCard title 低一级，用于节内分组 */
function SubTitle({ children }: { children: React.ReactNode }) {
  return (
    <Typography.Text strong style={{ display: 'block', margin: '12px 0 6px' }}>
      {children}
    </Typography.Text>
  )
}

export default function HelpPage() {
  return (
    <PageContainer title="使用帮助" content="从录制到用上的完整链路，以及两个系统的权限机制与高频问题排查。">
      <Row gutter={16}>
        {/* 正文 */}
        <Col span={18}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {/* ---- 三步上手 ---- */}
            <ProCard id="quickstart" title="三步上手" size="small">
              <Typography.Paragraph style={{ marginBottom: 4 }}>
                OpenMacro 干的事：把一串键鼠操作录下来，绑到一个键上，以后按键就自动重放。
              </Typography.Paragraph>
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                <li style={{ marginBottom: 6 }}>
                  <b>录一个宏</b>：宏库管理 → 新建宏 → 开始录制 → 3 秒倒计时内切到目标程序做操作 → 按{' '}
                  <Tag>F9</Tag> 停止（或回到本软件点「停止录制」）。
                </li>
                <li style={{ marginBottom: 6 }}>
                  <b>绑到一个键</b>：按键映射 → 新增绑定 → 捕获触发键（推荐鼠标中键 / 侧键，或 Ctrl+Shift+字母这类组合键）→
                  动作类型选「宏」→ 选刚录的那个。保存后立即生效。
                </li>
                <li>
                  <b>用</b>：进目标程序按绑定的键即可。第一次用建议先开「按键检测」页确认钩子在工作（见下文）。
                </li>
              </ol>
              <Alert
                style={{ marginTop: 12 }}
                type="warning"
                showIcon
                message="部分竞技游戏官方规则将宏列为作弊行为，使用可能导致封号，须自行承担风险。"
              />
            </ProCard>

            {/* ---- 录制宏 ---- */}
            <ProCard id="record" title="录制宏" size="small">
              <SubTitle>录什么</SubTitle>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li>键盘：单键、组合键（按住 Ctrl 再按 A，记为 Ctrl+A）都会记；系统自动重复不会重复记</li>
                <li>鼠标：左 / 右 / 中键、侧键4 / 侧键5 的按下抬起、滚轮上下滚</li>
                <li>鼠标移动轨迹默认不录（数据量大），需要时在录制选项里打开</li>
                <li>停止热键 <Tag>F9</Tag> 不会进时间轴</li>
              </ul>
              <Alert
                style={{ marginTop: 8 }}
                type="info"
                showIcon
                message="录制开始后软件不会自动最小化，你在本软件界面上的点击也会被如实记为步骤——开始录制后就切去目标程序操作。"
              />
              <SubTitle>录完还能改</SubTitle>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li>时间轴支持手工补步骤：键盘动作、鼠标功能、文本输入、系统命令（音量 / 媒体键 / 截图 / 切换桌面）、循环（循环开始 / 结束必须成对）</li>
                <li>每步之间的间隔可调（10ms ~ 10 分钟）</li>
              </ul>
              <SubTitle>怎么放</SubTitle>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li><b>单次执行</b>：按一次放一遍</li>
                <li><b>按住重复</b>：按住不放按间隔循环，松开即停</li>
                <li><b>按下切换循环</b>：按一下开始循环，再按一下停止</li>
                <li><b>按序列执行</b>：按设定次数连放</li>
                <li>播放速度 0.5 ~ 5 倍速可调；宏可导出 / 导入（换电脑、分享给别人）</li>
              </ul>
            </ProCard>

            {/* ---- 按键映射 ---- */}
            <ProCard id="binding" title="按键映射" size="small">
              <SubTitle>触发键能选什么</SubTitle>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li>鼠标：中键、侧键4、侧键5（左键 / 右键是系统保留，不能绑）</li>
                <li>键盘：单键或组合键（Ctrl / Shift / Alt / Win 任意搭配 + 主键）</li>
              </ul>
              <SubTitle>一个键能配几个动作</SubTitle>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li><b>短按</b>：点一下立即执行</li>
                <li><b>长按</b>：按住超过阈值才执行（阈值可配），适合「按住连发、松开就停」</li>
                <li>两个都配就是「短按干这个、长按干那个」；只配一个时另一个不动作</li>
              </ul>
              <SubTitle>动作类型</SubTitle>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li>键盘动作（单键 / 组合键）、鼠标功能（中键 / 侧键 / 滚轮）、系统命令、启动程序、播放宏、禁用（占位不动作）</li>
                <li>保存即时生效，不用重启；停用 / 启用随时切</li>
              </ul>
            </ProCard>

            {/* ---- 按键防抖 ---- */}
            <ProCard id="debounce" title="按键防抖" size="small">
              <Typography.Paragraph style={{ marginBottom: 4 }}>
                解决「一次点击被识别成多次」：同一按键在设定时间窗口内的重复按下会被直接抑制，只有第一次放行。
              </Typography.Paragraph>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li>规则按「按键」单独配置，可以只给问题键（比如爱连击的侧键）开，不影响其他键</li>
                <li>窗口建议 150 ~ 200ms：短于人类正常连击间隔，又能吃掉设备双发</li>
                <li>被抑制的点击在「按键检测」页的「实际触发检测」里会显示「被防抖抑制」，方便验证规则是否生效</li>
              </ul>
            </ProCard>

            {/* ---- 按键检测 ---- */}
            <ProCard id="detect" title="按键检测" size="small">
              <Typography.Paragraph style={{ marginBottom: 4 }}>
                排查「到底哪里出了问题」的仪表盘，一行就能看出「按了什么键 → 软件做了什么」。
              </Typography.Paragraph>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li>
                  <b>物理按键检测</b>：钩子收到的原始输入。这里没有记录 = 钩子没工作（去查系统授权 / 提权），不是绑定配错了
                </li>
                <li>
                  <b>实际触发检测</b>：软件在绑定键上真正执行了什么；被防抖抑制、被禁用的也会显示，用来验证规则和宏是否生效
                </li>
                <li>「已识别到 N 个可绑定按键」：产生过事件的中键 / 侧键会被记下来，绑定时可以直接选</li>
                <li>可暂停采集（列表停止刷新但钩子继续跑，不影响已有绑定）</li>
              </ul>
            </ProCard>

            {/* ---- Windows 提权 ---- */}
            <ProCard id="perm-win" title="Windows 提权" size="small">
              <Typography.Paragraph style={{ marginBottom: 4 }}>
                <b>为什么需要</b>：以管理员权限运行的程序（不少游戏和启动器默认如此）会拒绝普通权限进程的输入注入——
                表现为「宏明明在放，游戏里没反应」。
              </Typography.Paragraph>
              <SubTitle>怎么开（系统设置 → 开机自启）</SubTitle>
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                <li style={{ marginBottom: 4 }}>打开「开机登录后自动以管理员权限启动」开关</li>
                <li style={{ marginBottom: 4 }}>系统弹一次 UAC，确认后自动写计划任务并重启进提权实例（窗口会重开，数据不丢）</li>
                <li>重启后看「运行权限」：显示 <Tag color="green">管理员（High IL）</Tag> 即到位</li>
              </ol>
              <ul style={{ margin: 0, paddingLeft: 20, marginTop: 4 }}>
                <li>开 / 关各需要一次 UAC 确认，这一步不绕——绕开的是「每次启动都弹一次」的重复打扰</li>
                <li>关闭开关只禁用任务，不会卸载；卸载软件前建议先关掉，避免残留计划任务</li>
                <li>「自启路径」与「程序路径」不一致时（重装 / 换目录）任务不生效，点警告条里的「重新指向」即可</li>
              </ul>
            </ProCard>

            {/* ---- macOS 授权 ---- */}
            <ProCard id="perm-mac" title="macOS 授权" size="small">
              <Typography.Paragraph style={{ marginBottom: 4 }}>
                macOS 没有「提权」概念，输入捕获只看系统授权（TCC）。<b>两项都要授，缺一项都会出怪问题</b>：
              </Typography.Paragraph>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li>
                  <b>辅助功能</b>：全局钩子的基础，不授则键鼠都捕获不到
                </li>
                <li>
                  <b>输入监控</b>：键盘事件的通道。只授辅助功能不授它 = 「鼠标能捕获、键盘不能」（系统静默丢弃键盘，最难排查的一项）
                </li>
              </ul>
              <SubTitle>怎么授（系统设置 → 隐私与安全性）</SubTitle>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li>最省事：系统设置页的「辅助功能 / 输入监控」行旁边有齿轮按钮，点一下直达对应面板，把 OpenMacro 打开</li>
                <li>手动加：复制「程序路径」，在面板点「+」后按 Cmd+Shift+G 粘贴；或点文件夹按钮在 Finder 显示后直接拖进列表</li>
                <li>授权按程序路径持久化：换安装位置（比如从下载目录拖进应用程序）后要重新拖一次</li>
                <li>开机启动走系统登录项，与授权无关，授权不会因为重启丢失</li>
              </ul>
            </ProCard>

            {/* ---- 常见问题 ---- */}
            <ProCard id="faq" title="常见问题" size="small">
              <Typography.Paragraph>
                <b>宏在游戏里没反应？</b><br />
                Windows：进系统设置看「运行权限」是不是管理员（High IL），不是就打开开机自启开关走一遍 UAC。
                macOS：确认辅助功能 + 输入监控两项都在（见上）。
              </Typography.Paragraph>
              <Typography.Paragraph>
                <b>鼠标能录到，键盘录不到？（macOS）</b><br />
                输入监控没授。去 系统设置 → 隐私与安全性 → 输入监控，把 OpenMacro 加进去。
              </Typography.Paragraph>
              <Typography.Paragraph>
                <b>侧键点一下，检测页出现两条「按下」？</b><br />
                设备 / 驱动把一次点击发了两次报告（间隔约 100ms），不是软件记重。给该键配一条 150 ~ 200ms
                的防抖规则即可抑制第二条。
              </Typography.Paragraph>
              <Typography.Paragraph>
                <b>组合键录不到 / 触不灵？</b><br />
                系统级热键（如 macOS 的 Cmd+Tab、Ctrl+Cmd+Q，Windows 的 Win+L）会被操作系统优先拦截，
                应用层收不到，这不是缺陷。换非系统保留的组合键即可。
              </Typography.Paragraph>
              <Typography.Paragraph>
                <b>数据存在哪？怎么备份 / 换电脑？</b><br />
                所有宏、绑定、防抖规则都在一个 SQLite 文件里，路径见系统设置「数据库文件」行（可一键在文件管理器中显示）。
                备份 / 迁移：先退出程序，再复制该文件；宏也可以单独导出成文件分享。
              </Typography.Paragraph>
              <Typography.Paragraph style={{ marginBottom: 0 }}>
                <b>怎么更新版本？</b><br />
                安装包与更新说明发布在 GitHub Releases，入口在系统设置「下载地址」行，点开在系统浏览器打开。
              </Typography.Paragraph>
            </ProCard>
          </Space>
        </Col>

        {/* 右侧目录锚点 */}
        <Col span={6}>
          <div style={{ position: 'sticky', top: 16 }}>
            <ProCard title="本页目录" size="small">
              <Anchor
                affix={false}
                offsetTop={16}
                items={SECTIONS.map((s) => ({ key: s.id, href: `#${s.id}`, title: s.title }))}
              />
            </ProCard>
          </div>
        </Col>
      </Row>
    </PageContainer>
  )
}
