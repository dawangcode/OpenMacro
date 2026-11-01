# 应用图标

本目录的图标由两个脚本生成（纯 Node 绘制，无第三方依赖）：

- `scripts/gen-icon.js` —— **源生成**：产出 `icon.png` / `icon.ico` / `icon.icns` / `icon.svg`
- `scripts/gen-icons.js` —— **边距变体**：从 `icon.png` 产出带 9% 透明边距的 `icon-dock.png`（dev 态 Dock/窗口图标），并重打 `icon.icns`（打包态）

## 为什么需要两个脚本

`gen-icon.js` 画的是**四边 0% 留白的全幅美术图**（闪电宽 41% / 高 53%，见 `BOLT_RATIO` 与
`BOLT_STRETCH`）。
实测本机正常观感的 app 图标（CodeBuddy CN 81.3% 占比 / 9.4% 边距，Apifox 84.4% / 7.8%）都带
8~9% 边距，全幅图直接进 Dock 会明显比邻居大一圈。`gen-icons.js` 按 9% 边距重新产出：

- `icon-dock.png`（630x630，512 图标居中）→ `src/main/index.ts` 的 `DEV_ICON`（dev 态）
- `icon.icns`（16~1024 各尺寸均含 9% 边距）→ `electron-builder.yml` 的 `mac.icon`（打包态）
- 中间产物 `icon.iconset/` 保留，可用于复查 / 重打 icns；不在 electron-builder 的 files 白名单里，不会进包

## 文件用途

- `icon.png` —— 源图（全幅，无外边距）；Linux AppImage 与 dev 态回退
- `icon-dock.png` —— dev 态 macOS Dock / 窗口图标（带 9% 边距）
- `icon.ico` —— Windows（窗口 / 任务栏 / nsis 安装包；内含 16~256 七档 PNG 负载）
- `icon.icns` —— macOS 打包态（dmg；内含 16~1024 PNG 负载，已含 9% 边距）
- `icon.svg` —— 矢量源（多边形，同 `icon.png` 形状）

闪电字形取自 antd `ThunderboltFilled` 的 SVG 路径（MIT），与侧栏菜单 logo 同源；
底色为深墨蓝 → 近黑的圆角方块（圆角 26%，与侧栏 30px logo 方块一致）。

**居中是光学居中，不是几何居中**：闪电上宽下尖，墨量重心比 bbox 中心高，实测偏离量是字形
高度的定值约 11%（0.52 时 29.7px、0.68 时 38.8px、当前 29.4px，均吻合）。几何居中的
闪电视觉上偏高「发飘」。`gen-icon.js` 按 65% 幅度下移，墨量重心落到距画布中心 1.9% 处——
眼睛读墨量平衡，不读间隙对称（同播放键右移、铃铛上移的道理）。副作用是 bbox 低于几何中心
3.9%，这是光学居中的正常代价。

闪电**宽 41% / 高 53%**（原字形宽高比 0.83，竖向再拉 `BOLT_STRETCH = 1.06`）：
高度占比历程 0.68（观感偏满）→ 0.6 → 0.55 → 0.5；**0.5 是宽度的观感下限**（再窄就显空），
之后不动比例，只靠 `BOLT_STRETCH` 单独调竖直长度——等比放大会把刚收下去的宽度一起放大。
**侧栏 30px 小方块与桌面图标拉平到同一参数**：`src/layouts/index.tsx` 用
`<ThunderboltFilled fontSize={16.2} translateY(1.2px) scaleY(1.06)>`，墨迹 12.3 × 15.9px，
与桌面一致。
换算式（改桌面参数时同步重算）：antd 图标 viewBox 是「64 64 896 896」，墨迹高
831.1/896 = 0.928em，故 `fontSize = 30 × BOLT_RATIO ÷ 0.928`；`translateY = BOLT_DY × 30 / 512`；
`scaleY = BOLT_STRETCH`。注意 `16/30 = 53%` 这类「em 框 / 方块」算法是错的，必须按墨迹算。

## 换色 / 改形 / 换 logo 流程

1. 改 `scripts/gen-icon.js` 顶部的 `STOPS`（渐变色）、`RADIUS`（圆角）、`BOLT_PATH`（闪电路径）
   或 `BOLT_RATIO`（闪电占画布宽度的基准比例，当前 0.5）/`BOLT_STRETCH`（竖向拉伸，当前 1.06，
   只改高度不改宽度）/`BOLT_OPTICAL`（光学下移幅度，0~1，0 = 几何居中）
2. `node scripts/gen-icon.js`（重出三件套 + svg）
3. `node scripts/gen-icons.js`（或 `pnpm gen:icons`，出带边距的 dock 图与 icns）

两边距由 `gen-icons.js` 顶部的 `PAD_RATIO`（默认 0.09）控制；dev / 打包两个图标必须都重新生成。
