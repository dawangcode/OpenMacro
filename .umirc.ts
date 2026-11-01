// 客户端形态 Umi 配置（工程根目录 .umirc.ts）
// 2026-10-18 更新：prod 由主进程内置静态 HTTP 服务托管 dist/，故 base/publicPath 统一用 '/'；
// 不要写 './'（会把 Umi 路由 basename 算错 → 根路由匹配失败 → 页面 chunk 永不加载 → 白屏零报错）。
import { defineConfig } from '@umijs/max'

export default defineConfig({
  // Umi 统一走 Vite 模式（本技能标准栈）。
  // Vite 模式下 dev server 端口走 vite.server（Umi 4 在 Vite 模式下顶层 devServer 键会被 config 校验拒绝，fatal）；
  // Umi 默认 dev 端口即 8000，与 src/main/index.ts 的 loadURL、package.json 的 wait-on 一致。
  vite: { server: { port: 8000 } },

  title: 'OpenMacro',
  // hash 路由：保底兼容，静态托管/刷新安全（云端用 browser history，此处为桌面端形态差异）
  hash: true,
  // 资源路径：renderer 由内置静态 HTTP 服务在域根托管 → '/assets/xxx' 正确解析；
  // publicPath 用 '/' 时 Umi 路由 basename 才能匹配根路由 '/'
  base: '/',
  publicPath: '/',
  outputPath: 'dist',

  // 压缩器：Vite 模式下 jsMinifier 映射为 Vite build.minify。用 esbuild（设 'terser' 会让 max build 静默失败）。
  jsMinifier: 'esbuild',

  // 路由与菜单：扁平配置，src/layouts/index.tsx 由 Umi 自动作为全局布局套在每层外面
  // （不需要的页面加 layout: false 关闭，如独立的登录页）
  // 路由有 :id 路径段用 useParams() 取参；没有 :id 段的用 useSearchParams()；
  // useLocation().query 恒为 undefined，禁用（宏编辑页的 id 走查询串）
  routes: [
    { path: '/', redirect: '/macro' },
    { path: '/binding', name: '按键映射', component: '@/pages/binding/index' },
    { path: '/binding/create', name: '新增绑定', component: '@/pages/binding/create' },
    { path: '/binding/edit/:id', name: '编辑绑定', component: '@/pages/binding/edit' },
    { path: '/debounce', name: '按键防抖', component: '@/pages/debounce/index' },
    { path: '/debounce/create', name: '新增防抖规则', component: '@/pages/debounce/create' },
    { path: '/debounce/edit/:id', name: '编辑防抖规则', component: '@/pages/debounce/edit' },
    { path: '/detect', name: '按键实时检测', component: '@/pages/detect/index' },
    { path: '/macro', name: '宏库管理', component: '@/pages/macro/index' },
    { path: '/macro/create', name: '新建宏', component: '@/pages/macro/edit' },
    { path: '/macro/edit/:id', name: '编辑宏', component: '@/pages/macro/edit' },
    { path: '/macro/detail/:id', name: '宏详情', component: '@/pages/macro/detail' },
    { path: '/settings', name: '系统设置', component: '@/pages/settings/index' },
    { path: '/help', name: '使用帮助', component: '@/pages/help/index' },
  ],

  // dev 代理：/api → 本地开发服务（端口 8080，桌面端专用本地后端）；
  // 生产用 .env 的 UMI_APP_API_BASE_URL 指向云端（云端 API 标准端口为 3001），不走 proxy
  proxy: {
    '/api': {
      target: 'http://localhost:8080',
      changeOrigin: true,
    },
  },

  locale: false,
  // 按需开启 Max 插件能力：access / initialState / model（dva）等
})
