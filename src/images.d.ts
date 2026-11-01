// 静态图片 import 类型声明（src/images.d.ts）
// ⚠ 必须保持「全局脚本」形态：本文件不能有任何 import / export。
//   实测：同样的 declare module '*.png' 写在带 import 的模块型 .d.ts（如 src/typings.d.ts）里
//   不生效，别名（@/assets/x.png）与相对路径导入都会报 TS2307；独立全局文件才生效。
declare module '*.png' {
  const src: string
  export default src
}
