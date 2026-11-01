# OpenMacro

基于 **Electron + Umi Max 4（Vite 模式）+ React 19 + antd 6** 的客户端软件工程。

> 形态：客户端（Electron 壳 + Umi renderer，一套页面两个壳）。
> 参考 PRD：`docs/prd/鼠标宏软件_需求/鼠标宏软件_PRD_2026-10-14.md`

## 技术栈

- 渲染层：Umi Max 4（Vite 模式）+ React 19 + TypeScript + antd 6 + @ant-design/icons 6
- 组件库：`@ant-design/pro-components` 3.x（锁 `3.1.14-7`，与 soft/lup 同栈同版本，LUP 已真机验证无白屏）；
  页面按 FD 快搭规范组织——列表 `PageContainer + ProTable`（枚举 `valueEnum`、操作列 `fixed:'right'` + 显式 width、
  查询 `labelWidth:'auto' / defaultCollapsed / span:6`、`toolBarRender` 放页面级按钮），
  表单 `PageContainer + Card + ProForm`（Card 与字段之间隔 `ProForm submitter={false}` 中间层，`Row gutter={24}` + `Col span={8}` 三列网格），
  布局 `ProLayout`。
- 操作列遵循 hl-05「表格操作列按钮规范」：≤3 个操作全部平铺文字链接，>3 个平铺前 2 个高频（查看 / 编辑）、其余收进「更多」下拉；
  顺序强制 `查看 → 编辑 → 业务操作 → 删除`（删除最后、`danger` + Popconfirm）；宽度 ≤2 个 `160`、含「更多」`200`；按钮不加图标、仅删除用危险色。
  例外：宏库管理列表的名称列本身就是详情链接（点击进宏详情），操作列不再重复平铺「查看」，只留「编辑」+「更多」（复制 / 导出 / 删除）
- 壳层：Electron ^43 + electron-vite（仅构建 main/preload）+ electron-builder（打包）
- 输入后端（主进程）：
  - 全局捕获 `uiohook-napi`（键鼠钩子，N-API 预编译）
  - 全局回放注入 `@nut-tree/nut-js`（N-API 预编译）
- 本地能力：主进程 node:sqlite（Electron 43 内置 Node 24，无原生模块）持久化 + IPC，渲染进程不碰 fs；
  数据库文件 `userData/openmacro.db`（WAL），首次启动自动把旧 `config.json` 迁移进库并改名 `.migrated`
- 字体：使用各系统默认 UI 字体（`system-ui`），不内置字体文件、不走 CDN；
  macOS 为 SF Pro / 苹方，Windows 为 Segoe UI / 微软雅黑，Linux 走发行版默认无衬线
- 表格数字用等宽数字（`global.less` 的 `tabular-nums`），与字体选择无关
- 包管理器：pnpm（默认；npm 用户统一 `npm install --legacy-peer-deps`）

## 目录结构

```
soft/openmacro/
├── .umirc.ts                 # 客户端形态 Umi 配置（hash + base/publicPath '/'）+ 路由
├── electron.vite.config.ts   # 仅构建 main/preload
├── electron-builder.yml      # 打包配置（files 含 dist/ + out/，asarUnpack *.node）
├── tsconfig.json / tsconfig.node.json
├── scripts/                  # 一键启动三件套（start.cmd / start-client.js / launch-client.js）
└── src/
    ├── main/                 # 主进程
    │   ├── index.ts          # 窗口 / 单实例 / 内置静态服务
    │   ├── ipc.ts            # IPC handler（macro:* / record:* / binding:* / capture:* / detect:*）
    │   ├── db.ts             # node:sqlite 连接 / 建表 / settings 读写 / 事务
    │   ├── migrate.ts        # 旧 config.json → SQLite 一次性迁移（user_version 标记）
    │   ├── store.ts          # 设置（config）持久化，走 settings 表
    │   ├── macro-store.ts    # 宏持久化与导入导出解析
    │   ├── recorder.ts       # 录制状态机（倒计时 → 采集 → 步骤）
    │   ├── player.ts         # 回放执行（循环展开 / 循环模式 / 速度 / 停止）
    │   ├── input-backend.ts  # uiohook-napi + nut-js 懒加载与降级
    │   ├── hook.ts           # 全局输入钩子中枢（录制 / 绑定 / 检测共用一份 uiohook）
    │   ├── actions.ts        # 原子输入动作（键盘 / 鼠标 / 系统命令 / 启动程序）
    │   ├── binding-store.ts  # 按键绑定 / 防抖 / 停止热键持久化
    │   ├── binding-engine.ts # 绑定运行时（防抖 → 触发判定 → 执行动作）
    │   ├── detector.ts       # 按键检测（最新 100 条事件 + 重复计数）
    │   ├── capture.ts        # 按键捕获（绑定键 / 停止热键字段用）
    │   ├── runtime-state.ts  # 跨模块「绑定运行时挂起」开关
    │   ├── keymap.ts         # 键名映射
    │   └── events.ts         # 主进程 → 渲染进程事件白名单
    ├── preload/              # 预加载 index.ts（CJS 产物）
    ├── layouts/index.tsx     # 全局布局（antd 原生 Layout + Menu）
    ├── pages/binding/index.tsx    # 按键映射列表（PRD 4.1）
    ├── pages/binding/edit.tsx     # 绑定编辑（独立页 /binding/edit/:key?trigger=）
    ├── pages/debounce/index.tsx   # 按键防抖（独立页 /debounce，PRD 4.3）
    ├── pages/detect/index.tsx     # 按键检测看板（PRD 4.2）
    ├── pages/macro/index.tsx      # 宏库管理（列表页，PRD 4.4）
    ├── pages/macro/create|edit    # 宏录制与编辑（新建 / 编辑各自独立路由，PRD 4.5）
    ├── pages/macro/detail.tsx     # 宏详情（独立只读详情页）
    ├── api/macro.ts               # 数据层（Electron 优先，浏览器模式降级 localStorage）
    ├── api/binding.ts             # 绑定 / 防抖 / 检测数据层
    ├── utils/display.ts           # 键名 / 时间展示助手
    ├── utils/macro.ts             # 步骤摘要（编辑页 / 详情页共用）
    ├── types/macro.ts             # 宏领域模型与常量（renderer / main 共用）
    ├── types/binding.ts           # 绑定领域模型与常量
    ├── global.less
    └── typings.d.ts          # electronAPI 类型声明
```

## 已实现（PRD 4.1~4.7 主链路）

**按键映射（通用模式 `/binding`，PRD 4.1）**

- 一条绑定 = 一个**绑定按键 + 短按动作 / 长按动作**，为可增删改的数据实体（不再是固定的 5 个鼠标键）
- **绑定按键支持鼠标与键盘**：捕获模式下按鼠标键（中键 / 侧键4 / 侧键5）或键盘键（含组合键如 `Ctrl+Shift+A`）自动录入；左键 / 右键为系统保留，不可作为绑定键
- 列表页支持 **新增 / 编辑 / 删除**（含多选批量删除）；新增 `/binding/create`、编辑 `/binding/edit/:id` 均为独立页面
- 动作类型：键盘动作 / 鼠标功能 / 系统命令 / 启动程序 / 宏 / 禁用；短按与长按可分别配置（长按阈值 0.3~2 秒，可单独开关）
- **短按与长按可以都不启用**：保存为「未启用」绑定（列表显示橙色「未启用」标签），该绑定键存在但**不执行任何动作**，可随时回来启用；运行时对该键不做任何处理，也不影响防抖规则
- 触发时机：**未配置长按动作时，短按在按下瞬间即时触发（零延迟）**；同时配置短按与长按时，短按在抬起时触发以区分长按（按住达到阈值才执行长按，否则按短按处理）
- 绑定键唯一（同一绑定键只允许一条绑定，主进程校验）；防抖为独立规则实体（见「按键防抖」），不在绑定上挂载
- 键盘触发匹配规则：组合摘要需完全一致——绑定键 `Ctrl+A` 仅在按住 Ctrl 时按 A 触发，绑定键 `A` 仅单独按 A 触发
- 键盘动作支持捕获模式（按下即填入，Esc 取消）；启动程序走文件选择 + 路径校验；宏选项展示名称与动作数
- 保存后主进程热加载、立即生效；取消直接返回；列表页「删除」二次确认后立即生效（无绑定时置灰）
- 删除宏时同步解除引用该宏的按键绑定（列表删除确认提示「已被 N 个按键绑定」）

> 页面组织遵循技能规范：新增 / 修改 / 详情均为独立路由页——宏为 `/macro/create`、`/macro/edit/:id`、`/macro/detail/:id`，
> 绑定编辑为 `/binding/edit/:key`；只读详情与编辑页共用同一套界面（ProForm 三列栅格 + readonly 字段、同列时间轴只读表），不用 Modal/Drawer 弹详情。

**按键检测（独立页 `/detect`，PRD 4.2）**

- **单一时间线表格**：物理输入回显与软件实际触发按时间倒序合并到一张表，只保留最新 10 条、不分页（实时监视面板翻页无意义），表格不套内滚动
- 列：**触发按键 / 事件类型 / 触发方式 / 绑定按键 / 动作类型 / 动作详情 / 时间**
  - 物理事件行：触发按键=实际按下的键，事件类型=按下 / 抬起 / 滚轮上滚 / 滚轮下滚（防抖窗口内重复按下在事件类型后追加「重复 N」标签），触发方式 / 动作类型 / 动作详情为空（—）；若该键已有绑定，「绑定按键」回填命中的绑定，否则为 —
  - 触发行：事件类型=触发，触发方式=短按 / 长按 / 长按松开 / 防抖抑制（红色 Tag），并带动作类型与动作详情；**未绑定动作的按键不会产生触发行**
  - 按下行 1.5 秒内高亮；**本软件注入的键鼠事件（宏输出、绑定动作产生的按键 / 鼠标）会被观察型钩子回环捕获，已在运行时入口剔除，不会出现在本表**——播放宏时只显示真实按下的按键
- 红色「防抖抑制」即窗口内重复触发被成功拦下的直接证据；「防抖生效」提示仅表示该键已配置规则
- 状态提示（表格上方）：已识别到 N 个可绑定按键、未识别到提示检查鼠标连接、占用提示（含排查方法折叠）、双击提示（已配防抖则提示已配置规则）、长时间无鼠标事件提示
- 页头支持「暂停采集 / 继续采集」与「清空」（暂停只冻结检测面板，不影响按键绑定与宏触发；清空同时清两个来源缓冲）

**按键防抖（`/debounce`，PRD 4.3）**

- 防抖为独立规则实体，按绑定按键逐条配置，可独立**新增 / 编辑 / 删除**（单行删除，不提供多选批量删除），与「按键映射」列表交互一致
- 每条规则绑定一个鼠标键或键盘键（含组合键）；**不限制左键 / 右键**——鼠标连击（连点抖动）主要发生在左右键，是防抖的首要场景；绑定键唯一（同一按键只允许一条规则，主进程校验）
- 每规则独立开关与窗口（10~1000ms，默认 200ms，默认开）；列表无页面级保存 / 取消，改动在编辑页保存即时生效
- 常与侧键双击、连发抖动等问题搭配使用：开启后该键在防抖窗口内的重复按下会被忽略（不触发动作、不切换宏、不停运行中的宏）
- 左键 / 右键这类无绑定动作的按键，防抖用于**连击识别**：按键检测页会把窗口内的重复点击计为重复；受观察型钩子限制，只能抑制本软件侧响应，无法阻止点击继续到达其它程序

**全局停止热键（原「播放控制」看板页已删，热键功能保留）**

- 运行中按全局停止热键（默认 Esc）立即停止所有宏；优先级最高、不受防抖影响
- 播放状态（当前运行宏 / 进度）与停止按钮在宏编辑页查看
- 停止热键改值的捕获入口随看板页删除，如需改热键可后续恢复或走配置

**窗口与托盘**

- 点窗口最小化按钮时隐藏到托盘（不占任务栏），宏 / 热键继续在后台运行；托盘菜单「显示主界面」唤回，「退出 OpenMacro」真正结束进程
- 已隐藏时再次启动程序（单实例）或点击 Dock 图标都会唤回主界面；录制中最小化，停止录制后自动恢复窗口
- 4.8 常规设置里的「最小化到托盘」开关本身未做，当前为默认开启的固定行为

**合规提示（PRD 4.7）**

- 首次保存含「宏」动作的绑定弹出「合规风险提示」，确定后才写入生效；支持「不再提示」（本机持久化）

**宏库管理（列表页 `/macro`，PRD 4.4）**

- 列表只保留 **宏名称 / 播放方式 / 修改时间 / 操作** 四列（按用户决策精简；`scroll.x` 720）
- 动作数（步骤总数）/ 预计时长（各步骤延迟累加）/ 创建时间 / 修改时间 均为系统计算只读，统一在**宏详情页**查看
- 名称模糊搜索、新建、编辑、复制（名称追加序号并直接进入编辑）、删除（二次确认，含绑定解除提示）
- 导出为单个宏文件（`.openmacro.json`）、批量导入（多选；格式不符跳过并汇总提示；同名自动重命名不覆盖）
- 输入后端不可用时页头给出降级提示

**宏录制与编辑（新建 `/macro/create` / 编辑 `/macro/edit/:id`，PRD 4.5）**

- 录制控制：3 秒倒计时后开始、记录延迟开关（默认开）、记录鼠标轨迹开关（默认关）
- 开始录制后**窗口不再自动最小化**（由用户自己切到目标程序）；按 **F9** 或点「停止录制」结束并回到窗口（F9 停止不会把热键本身记进步骤）
- 时间轴编辑：动作类型 / 动作内容 / 延迟 / 循环次数行内编辑，支持上移、下移、插入、删除；卡片右上角「清空步骤」可一次性移除全部步骤（二次确认，无步骤或录制中时置灰）
- 播放设置：单次执行、按住重复（重复间隔）、按下切换循环、按序列执行（播放次数）、播放速度倍率
- 保存校验：名称必填 ≤50 字符、循环步骤成对、延迟 10~600000、重复间隔 10~10000、播放次数 1~9999、速度 0.5~5、循环次数 1~9999、滚轮量 1~999
- 试运行（保存后播放一次）与立即停止

> 本轮未做：常规设置（4.8：开机自启 / 管理员运行 / 界面语言，及「最小化到托盘」开关）、更新与关于（4.9）。
> 已知限制：uiohook-napi 为观察型钩子，键盘「禁用」动作已通过本地 fork（`D:\opencode\soft\uiohook-napi-patch`，package.json `file:` 依赖）实现 OS 层拦截——命中拦截表的按键 down/up 均被吞掉、组合键精确匹配（裸 E 与 Ctrl+E 独立拦截）；鼠标「禁用」仍只能抑制本软件侧响应（补丁只覆盖键盘）；
> nut-js 无 X1/X2 注入能力，含侧键4/5 的宏步骤回放时跳过并在告警中说明。

## 常用命令

```bash
# 安装依赖（pnpm，peer 冲突默认忽略；uiohook-napi 为本地 fork 源码，allowBuilds 已放行）
# postinstall 会自动编译本地 fork 源码（node-gyp，首次约 1-2 分钟）；
# 改 D:\opencode\soft\uiohook-napi-patch 源码后跑 pnpm install 即自动同步 + 重编；
# 若编译失败（缺工具链），手动跑：pnpm run rebuild:uiohook
pnpm install

# 开发模式 A：纯浏览器（快速改 UI/样式，无 Electron 壳，录制/回放自动降级为不可用）
pnpm run dev        # Umi dev server :8000，浏览器打开

# 开发模式 B：套壳开发（Electron 窗口 + HMR + DevTools，调录制/回放/IPC 用这个）
pnpm run dev:app    # max dev + 等 8000 就绪后拉起 Electron 窗口加载 localhost:8000

# 一键启动（生产形态，内置 HTTP 托管 dist/，不开浏览器）
#   Windows 双击 start.cmd；或 pnpm run start
pnpm run start

# 构建 renderer(dist/) + 壳(out/)
pnpm run build

# 图标已内置（resources/icon.png / .ico / .icns，由 scripts/gen-icon.js 生成，换色改脚本常量后重跑）
# 打包安装包
pnpm run package
```

## 注意事项

- 双构建管线：`max build`（renderer）与 `electron-vite build`（main/preload）串行。
- 本地数据在 `userData/openmacro.db`（SQLite，WAL 模式，另有 `-wal` / `-shm` 附属文件）；
  备份请在应用退出后复制这三个文件，或整个用户数据目录一起复制。
- 打包前必须补齐 `resources/icon.ico|icns|png`，否则 `package` 失败。
- `uiohook-napi` / `@nut-tree/nut-js` 为原生 `.node` 产物，已在 `electron-builder.yml` 配 `asarUnpack: ['**/*.node']`，
  否则打包后 require 不到。
- 受限环境（如工作区内 electron.exe 段错误）可设 `ELECTRON_EXTERNAL_RUNTIME` 指向工作区外运行时。
- 浏览器模式（`pnpm run dev`）下 `window.electronAPI` 不存在，数据层自动降级 localStorage，
  录制 / 回放按钮会明确提示不可用——**验证录制必须走 `pnpm run start` 或 `pnpm run dev:app`**。

## 真机验证清单（沙箱无法验证，请在 Windows 10/11 x64 真机执行）

| # | 验证项 | 预期结果 | 所需环境 |
|---|--------|----------|----------|
| 1 | `pnpm install` | 安装成功，uiohook-napi 二进制下载成功（若报 ignored builds → `pnpm rebuild uiohook-napi`） | 联网 + Node 22.12+/24 |
| 2 | `pnpm run dev` | 浏览器 :8000 打开宏库管理页，可新建/编辑/删除宏（localStorage 模式） | 无 |
| 3 | `pnpm run start` | 弹出 Electron 窗口，宏库管理页无 Alert 降级提示 | Windows 真机 |
| 4 | 输入后端状态 | 列表页不出现「输入捕获/回放模块不可用」黄条；出现则按提示排查模块加载 | 同上 |
| 5 | 新建宏 → 开始录制 | 3 秒倒计时后窗口最小化，操作键鼠后按 F9，窗口恢复且时间轴出现步骤 | 同上 |
| 6 | 录制内容正确性 | 键盘按下/抬起、鼠标按下/抬起、滚轮步骤与实际操作一致；开启「记录鼠标轨迹」后出现移动步骤 | 同上 |
| 7 | 时间轴编辑 | 改延迟、插入、删除、上移、下移生效；循环不成对时保存报错「循环步骤未闭合」 | 同上 |
| 8 | 试运行 | 保存后点击试运行，目标窗口出现录制的键鼠操作；warnings 提示无法映射的键需对照 `src/main/keymap.ts` 核对 nut-js `Key` 枚举 | 同上 |
| 9 | 播放设置 | 按序列执行 N 次跑完自停；播放速度倍率对延迟生效 | 同上 |
| 10 | 导出 / 导入 | 导出得到 `.openmacro.json`；导入后同名自动追加序号；拖入一个格式错误文件提示「已跳过 1 个文件」 | 同上 |
| 11 | 复制 / 删除 | 复制生成「xxx (2)」并进入编辑页；删除二次确认后列表刷新 | 同上 |
| 12 | `pnpm run build` + `pnpm run package` | 产出 dist/ + out/ 与安装包；安装后运行录制回放正常（验证 asarUnpack 生效） | 同上 + resources 图标 |
| 13 | 按键映射 · 保存即生效 | 侧键4 绑定「键盘动作 Ctrl+C」→ 保存 → 到记事本按侧键4 出现复制效果；刷新页面绑定仍在 | 同上 |
| 14 | 按键映射 · 捕获模式 | 编辑绑定选键盘动作 → 点「捕获按键」→ 按下 Ctrl+Shift+A 自动填入；按 Esc 取消保留原值 | 同上 |
| 15 | 按键映射 · 绑定宏 | 侧键5 绑定已有宏 → 保存弹「合规风险提示」→ 取消后宏列表无该绑定；确定后生效并可触发 | 同上 |
| 16 | 按键映射 · 启动程序 | 动作类型选「启动程序」→ 选择 calc.exe → 保存 → 触发侧键打开计算器 | 同上 |
| 17 | 播放方式语义 | 绑定宏选「按序列执行 3 次」→ 触发后跑 3 次自停，看板显示「第 N 次 / 共 3 次」；选「按下切换循环」→ 再按一次停止 | 同上 |
| 18 | 长按触发 | 侧键4 配长按（阈值 1 秒）+ 宏（按住重复）→ 按住期间循环执行、松开即停 | 同上 |
| 19 | 全局停止热键 | 运行循环宏时按 Esc 立即停止（停止热键默认 Esc；改热键的捕获入口随播放控制页删除） | 同上 |
| 20 | 按键检测 | 按中键 / 侧键出现事件行并高亮；连点多下出现「检测到双击」提示；断开鼠标出现「未检测到鼠标事件」 | 同上 |
| 21 | 按键防抖 | 防抖页新增规则 → 捕获左键 / 右键（鼠标连击场景）或侧键4 → 开启防抖 200ms 保存 → 快速连点只在首次触发；列表可用行内「删除」单条移除 | 同上 |
| 22 | 删除宏解绑 | 删除已被侧键绑定的宏 → 确认框提示「已被 N 个按键绑定」→ 删除后按键映射页该键显示「无」 | 同上 |
| 23 | 旧数据迁移 | 保留旧 `userData/config.json` 启动一次 → 生成 `openmacro.db`，旧文件改名为 `config.json.migrated`，宏 / 按键映射 / 防抖 / 停止热键 / 合规标记全部保留 | Windows 真机 + 旧版数据 |
| 24 | 重启持久化 | 新建宏与绑定 → 完全退出再启动 → 数据仍在；`userData` 下可见 `openmacro.db`（含 `-wal` / `-shm`） | 同上 |

若在 #8 出现「无法映射的按键」，说明 uiohook-napi 的键名与 nut-js `Key` 枚举对不上，
按实际枚举名补进 `src/main/keymap.ts` 的 `UIOHOOK_TO_NUT` 即可，无需改动其它代码。
