// electron-vite 构建配置（工程根目录 electron.vite.config.ts）
// 客户端形态：renderer 归 Umi（max build → dist/），electron-vite 只构建 main/preload
import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      lib: {
        entry: resolve(__dirname, 'src/main/index.ts'),
        // CJS 产物：__dirname 可用；package.json 的 main 指向 out/main/index.js
        formats: ['cjs'],
      },
      rollupOptions: {
        output: { entryFileNames: '[name].js' },
      },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      lib: {
        entry: resolve(__dirname, 'src/preload/index.ts'),
        // 必须 CJS：sandbox: true 的预加载脚本按普通脚本运行，不支持 ESM（.mjs）
        formats: ['cjs'],
      },
      rollupOptions: {
        output: { entryFileNames: '[name].cjs' },
      },
    },
  },
  // 不配 renderer：Umi 的 max build 已产出 dist/index.html，主进程 prod 用内置静态
  // HTTP 服务托管 dist/ 再 loadURL（不要 loadFile/file://：ES module 在 file:// 下被 CORS 拦截）
})
