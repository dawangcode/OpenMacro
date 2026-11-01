// 全局主题（src/theme.ts）
// 字体：使用各系统默认 UI 字体（system-ui），不内置字体文件、不加载外部字体：
//   - macOS：SF Pro + 苹方；Windows：Segoe UI + 微软雅黑；Linux：发行版默认无衬线
//   - 表格数字等宽由 global.less 的 tabular-nums 控制，与字体选择无关
import type { ThemeConfig } from 'antd'

export const FONT_FAMILY =
  "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', " +
  "'Hiragino Sans GB', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Noto Sans CJK SC', " +
  "Roboto, 'Helvetica Neue', Arial, sans-serif"

export const theme: ThemeConfig = {
  token: {
    fontFamily: FONT_FAMILY,
    fontSize: 14,
    // antd 默认由 fontSize 派生 fontSizeSM = 12（Tag / Form 提示文字等用它），
    // 这里显式抬到 14，保证全站最小文字为 14px
    fontSizeSM: 14,
    lineHeight: 1.6,
    borderRadius: 8,
    colorPrimary: '#1677ff',
    colorBgLayout: '#f5f7fa',
    colorBgContainer: '#ffffff',
    controlHeight: 34,
  },
  components: {
    Table: {
      headerBg: '#fafafa',
      headerColor: 'rgba(0, 0, 0, 0.88)',
      headerSplitColor: '#f0f0f0',
      rowHoverBg: '#f0f7ff',
    },
    Descriptions: {
      labelBg: '#fafafa',
    },
    Menu: {
      // 圆角胶囊 + 淡蓝选中底，比默认方角更轻；图标稍放大一档，视觉重心更稳
      itemBorderRadius: 8,
      itemMarginInline: 10,
      itemMarginBlock: 4,
      itemHeight: 40,
      itemColor: 'rgba(0, 0, 0, 0.72)',
      itemHoverBg: '#f2f6ff',
      itemHoverColor: '#0958d9',
      itemSelectedBg: '#e8f1ff',
      itemSelectedColor: '#0958d9',
      iconSize: 17,
      // 折叠态图标与展开态同尺寸：antd 默认会掉到 16px，收起后看着"缩小了一圈"
      collapsedIconSize: 17,
      iconMarginInlineEnd: 10,
      // 侧栏不画 antd 的横向选中条，改用 global.less 里的左侧细强调条
      activeBarBorderWidth: 0,
    },
  },
}
