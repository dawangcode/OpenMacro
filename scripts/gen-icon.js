// 生成应用图标（resources/icon.png / icon.ico / icon.icns + icon.svg 矢量源）
//
// 为什么不用 sharp / canvas：本项目不引额外原生依赖，图标又只是「圆角渐变底 + 白色闪电」，
// 纯 Node 画像素 + 手写 PNG / ICO / ICNS 容器足够，且产物可复现（改颜色只改下方常量）。
//
// 用法：node scripts/gen-icon.js
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const OUT_DIR = path.join(__dirname, '..', 'resources')
const SIZE = 512 // 逻辑画布尺寸：其他尺寸按比例直接重绘（超采样抗锯齿），不靠缩放
const RADIUS = Math.round(SIZE * 0.26) // 圆角 26%：与侧栏 logo 方块（8/30）一致

// 渐变三档：深墨蓝 → 近黑（白色闪电反白，深色任务栏 / 浅色侧栏都不糊边）
const STOPS = [
  [0, [43, 50, 66]],
  [0.55, [18, 22, 31]],
  [1, [5, 7, 10]],
]

// 闪电形状：直接取 antd ThunderboltFilled 的路径（MIT），与侧栏菜单 logo 用的图标字形完全同源。
// 只支持这条路径用到的 M / H / L / C / Z（含相对命令），曲线按 16 段采样成多边形。
const BOLT_PATH =
  'M848 359.3H627.7L825.8 109c4.1-5.3.4-13-6.3-13H436c-2.8 0-5.5 1.5-6.9 4L170 547.5c-3.1 5.3.7 12 6.9 12h174.4l-89.4 357.6c-1.9 7.8 7.5 13.3 13.3 7.7L853.5 373c5.2-4.9 1.7-13.7-5.5-13.7z'

function samplePath(d, steps = 16) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || []
  const pts = []
  let i = 0
  let cmd = ''
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  const num = () => Number(tokens[i++])
  const lineTo = (nx, ny) => {
    pts.push([nx, ny])
    x = nx
    y = ny
  }
  const curveTo = (x1, y1, x2, y2, nx, ny) => {
    const x0 = x
    const y0 = y
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
      const u = 1 - t
      pts.push([
        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * nx,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ny,
      ])
    }
    x = nx
    y = ny
  }

  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) {
      cmd = tokens[i++]
      if (cmd === 'Z' || cmd === 'z') {
        x = sx
        y = sy
        continue
      }
    }
    const rel = cmd === cmd.toLowerCase()
    switch (cmd.toUpperCase()) {
      case 'M': {
        const nx = num() + (rel ? x : 0)
        const ny = num() + (rel ? y : 0)
        x = nx
        y = ny
        sx = nx
        sy = ny
        pts.push([x, y])
        cmd = rel ? 'l' : 'L' // M 后续的坐标对按 L 处理
        break
      }
      case 'L':
        lineTo(num() + (rel ? x : 0), num() + (rel ? y : 0))
        break
      case 'H':
        lineTo(num() + (rel ? x : 0), y)
        break
      case 'V':
        lineTo(x, num() + (rel ? y : 0))
        break
      case 'C': {
        const x1 = num() + (rel ? x : 0)
        const y1 = num() + (rel ? y : 0)
        const x2 = num() + (rel ? x : 0)
        const y2 = num() + (rel ? y : 0)
        const nx = num() + (rel ? x : 0)
        const ny = num() + (rel ? y : 0)
        curveTo(x1, y1, x2, y2, nx, ny)
        break
      }
      default:
        throw new Error(`不支持的 SVG 命令：${cmd}`)
    }
  }
  return pts
}

// 归一到画布：闪电宽按 BOLT_RATIO 定，高再乘 BOLT_STRETCH（只拉上下、不改宽度），
// 并按光学居中原则下移 BOLT_DY。
// 说明：
//   1) 占比历程：0.52（原值）→ 0.62 → 0.68（观感偏满）→ 0.6 → 0.55 → 0.5；
//      0.5 是「宽」的观感下限（再窄就显空），之后只做竖直方向的微调。
//      BOLT_STRETCH 只放大 Y：闪电是竖长字形，单独拉高 6% 更像「一道劈下来的电」，
//      且不会让宽度再涨回去（等比放大会把刚收下去的宽度一起放大）。
//      侧栏 30px 小方块同参数，见 src/layouts/index.tsx 的 BOLT_FONT / BOLT_STRETCH。
//   2) 光学居中：闪电上宽下尖，墨量重心比 bbox 中心高，实测偏离量恒为字形高度的 11.2%
//      （0.52 时 29.7px、0.68 时 38.8px，均吻合）。几何居中的闪电视觉上偏高「发飘」——
//      眼睛读墨量平衡，不读间隙对称。按 65% 幅度下移，BOLT_DY 由高度自动推导（见下）。
//      想恢复几何居中把 BOLT_OPTICAL 设 0 即可。
const BOLT_RATIO = 0.5
const BOLT_STRETCH = 1.06
const BOLT_OPTICAL = 0.65
const BOLT_H = SIZE * BOLT_RATIO * BOLT_STRETCH
const BOLT_DY = Math.round(BOLT_H * 0.112 * BOLT_OPTICAL)
const BOLT_RAW = samplePath(BOLT_PATH)
const BOLT = (() => {
  const xs = BOLT_RAW.map((p) => p[0])
  const ys = BOLT_RAW.map((p) => p[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const k = (SIZE * BOLT_RATIO) / (maxY - minY)
  const ky = k * BOLT_STRETCH
  return BOLT_RAW.map(([px, py]) => [SIZE / 2 + (px - cx) * k, SIZE / 2 + (py - cy) * ky + BOLT_DY])
})()

/** 点是否在圆角矩形内（按 SIZE 归一化后的坐标换算，支持任意目标尺寸） */
function inRoundedRect(x, y, size) {
  const k = size / SIZE
  const r = RADIUS * k
  const w = size
  const cx = Math.min(Math.max(x, r), w - r)
  const cy = Math.min(Math.max(y, r), w - r)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

/** 射线法判断点是否在多边形内 */
function inPolygon(x, y, poly, size) {
  const k = size / SIZE
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0] * k
    const yi = poly[i][1] * k
    const xj = poly[j][0] * k
    const yj = poly[j][1] * k
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function gradientAt(t) {
  const v = Math.min(1, Math.max(0, t))
  for (let i = 1; i < STOPS.length; i++) {
    const [p1, c1] = STOPS[i]
    const [p0, c0] = STOPS[i - 1]
    if (v <= p1) {
      const f = (v - p0) / (p1 - p0)
      return [0, 1, 2].map((c) => Math.round(c0[c] + (c1[c] - c0[c]) * f))
    }
  }
  return STOPS[STOPS.length - 1][1]
}

/** 渲染指定尺寸的 RGBA 位图（4×4 超采样做抗锯齿） */
function render(size) {
  const buf = Buffer.alloc(size * size * 4)
  const SS = 4
  // 像素中心在 (i+0.5)/SS 的偏移上采样
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS
          const y = py + (sy + 0.5) / SS
          if (!inRoundedRect(x, y, size)) continue
          a += 1
          if (inPolygon(x, y, BOLT, size)) {
            r += 255
            g += 255
            b += 255
          } else {
            const [cr, cg, cb] = gradientAt((x + y) / (2 * size))
            r += cr
            g += cg
            b += cb
          }
        }
      }
      const o = (py * size + px) * 4
      if (a === 0) continue
      buf[o] = Math.round(r / a)
      buf[o + 1] = Math.round(g / a)
      buf[o + 2] = Math.round(b / a)
      buf[o + 3] = Math.round((a / (SS * SS)) * 255)
    }
  }
  return buf
}

// ---- PNG ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  // 10~12 压缩/滤波/交错 均为 0
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter type: None
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ---- ICO（PNG 负载，Windows Vista+ 支持）----
function encodeIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)
  let offset = 6 + images.length * 16
  const entries = []
  for (const { size, data } of images) {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size
    e[1] = size >= 256 ? 0 : size
    e[2] = 0 // 调色板数
    e[3] = 0
    e.writeUInt16LE(1, 4) // planes
    e.writeUInt16LE(32, 6) // bit count
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    entries.push(e)
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)])
}

// ---- ICNS（PNG 负载）----
const ICNS_TYPES = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
]

function encodeIcns(pngBySize) {
  const chunks = ICNS_TYPES.map(([type, size]) => {
    const data = pngBySize[size]
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([head, data])
  })
  const total = 8 + chunks.reduce((s, c) => s + c.length, 0)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(total, 4)
  return Buffer.concat([head, ...chunks])
}

const cache = new Map()
function png(size) {
  if (!cache.has(size)) cache.set(size, encodePng(size, render(size)))
  return cache.get(size)
}

const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const pngBySize = Object.fromEntries(ICNS_TYPES.map(([, size]) => [size, png(size)]))

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), png(512))
fs.writeFileSync(
  path.join(OUT_DIR, 'icon.ico'),
  encodeIco(icoSizes.map((size) => ({ size, data: png(size) }))),
)
fs.writeFileSync(path.join(OUT_DIR, 'icon.icns'), encodeIcns(pngBySize))

// 矢量源文件：以后换色 / 改形状直接在设计工具里改它，再跑本脚本导出一致的三件套
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2b3242"/>
      <stop offset="0.55" stop-color="#12161f"/>
      <stop offset="1" stop-color="#05070a"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${RADIUS}" fill="url(#bg)"/>
  <polygon points="${BOLT.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" fill="#ffffff"/>
</svg>
`
fs.writeFileSync(path.join(OUT_DIR, 'icon.svg'), svg, 'utf8')

console.log('生成完成：resources/icon.png (512) / icon.ico (16~256) / icon.icns (16~1024) / icon.svg')
