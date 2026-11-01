#!/usr/bin/env node
/**
 * 从全幅源图生成两个带标准边距的图标产物（scripts/gen-icons.js）
 *
 * 背景：resources/icon.png 是四边 0% 留白的全幅美术图。实测本机正常观感的 app 图标
 * （CodeBuddy CN / Apifox 的 icns）不透明占比 81%~84%、边距 8~9.5%；全幅图直接进
 * Dock 会明显比邻居大一圈。本脚本按 9% 边距（占比 81%）重新产出：
 *   1) resources/icon-dock.png   —— dev 态 app.dock.setIcon / 窗口图标用（630x630，512 图标居中）
 *   2) resources/icon.icns       —— electron-builder 的 mac.icon（打包态），由 icon.iconset/ 编译
 *
 * 换了 logo 源图后重跑一次即可：node scripts/gen-icons.js
 * 依赖：仅 Node 内置模块 + macOS 的 iconutil（非 darwin 只出 icon-dock.png，跳过 icns）
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const { execFileSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const SRC = path.join(root, 'resources', 'icon.png')
const OUT_DOCK = path.join(root, 'resources', 'icon-dock.png')
const ICONSET_DIR = path.join(root, 'resources', 'icon.iconset')
const OUT_ICNS = path.join(root, 'resources', 'icon.icns')

/** 目标边距比例：实测 CodeBuddy CN 81.3% 占比 / 9.4% 边距，取 9% */
const PAD_RATIO = 0.09
/** dock 图的画布边长（art 512 → 512/0.82≈624，取 630 凑整，pad=59 → 9.4%） */
const DOCK_CANVAS = 630

// ---------------- PNG 解码 ----------------
function decodePng(file) {
  const buf = fs.readFileSync(file)
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png: ' + file)
  let off = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1
  const bpp = (channels * bitDepth) / 8
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const dst = pixels.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? dst[x - bpp] : 0
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0
      const c = x >= bpp && y > 0 ? pixels[(y - 1) * stride + x - bpp] : 0
      let v = line[x]
      if (filter === 1) v = (v + a) & 0xff
      else if (filter === 2) v = (v + b) & 0xff
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
      }
      dst[x] = v
    }
  }
  return { width, height, bpp, pixels }
}

// ---------------- 面积平均缩放（保质量，小尺寸不发虚） ----------------
function scaleArea(src, sw, sh, bpp, dw, dh) {
  const dst = Buffer.alloc(dw * dh * bpp)
  for (let y = 0; y < dh; y++) {
    const sy0 = (y * sh) / dh
    const sy1 = ((y + 1) * sh) / dh
    for (let x = 0; x < dw; x++) {
      const sx0 = (x * sw) / dw
      const sx1 = ((x + 1) * sw) / dw
      for (let c = 0; c < bpp; c++) {
        let sum = 0
        let wsum = 0
        for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) {
          const wy = Math.min(sy1, sy + 1) - Math.max(sy0, sy)
          if (wy <= 0) continue
          for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
            const wx = Math.min(sx1, sx + 1) - Math.max(sx0, sx)
            if (wx <= 0) continue
            const w = wx * wy
            sum += src[(sy * sw + sx) * bpp + c] * w
            wsum += w
          }
        }
        dst[(y * dw + x) * bpp + c] = wsum > 0 ? Math.round(sum / wsum) : 0
      }
    }
  }
  return dst
}

// ---------------- PNG 编码 ----------------
const crcTable = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c
}
function crc32(b) {
  let c = -1
  for (const byte of b) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const lines = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    lines[y * (size * 4 + 1)] = 0
    rgba.copy(lines, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(lines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------------- 生成：把 art 缩放后居中放入带边距画布 ----------------
function padded(src, artSize, canvasSize) {
  const art = scaleArea(src.pixels, src.width, src.height, src.bpp, artSize, artSize)
  const out = Buffer.alloc(canvasSize * canvasSize * 4) // 全 0 = 透明边距
  const pad = Math.floor((canvasSize - artSize) / 2)
  for (let y = 0; y < artSize; y++) {
    const dst = ((y + pad) * canvasSize + pad) * 4
    art.copy(out, dst, y * artSize * 4, (y + 1) * artSize * 4)
  }
  return { rgba: out, pad }
}

function main() {
  const src = decodePng(SRC)
  console.log(`[gen-icons] 源图 ${src.width}x${src.height}，边距目标 ${(PAD_RATIO * 100).toFixed(0)}%`)

  // 1) dev 态 dock / 窗口图标
  const dock = padded(src, DOCK_CANVAS - Math.round(DOCK_CANVAS * PAD_RATIO * 2), DOCK_CANVAS)
  fs.writeFileSync(OUT_DOCK, encodePng(dock.rgba, DOCK_CANVAS))
  console.log(
    `[gen-icons] ${path.relative(root, OUT_DOCK)}: ${DOCK_CANVAS}x${DOCK_CANVAS}，边距 ${dock.pad}px` +
      `（${((dock.pad / DOCK_CANVAS) * 100).toFixed(1)}%，不透明占比 ${(((DOCK_CANVAS - dock.pad * 2) / DOCK_CANVAS) * 100).toFixed(1)}%）`,
  )

  // 2) 打包态 icns（仅 macOS：依赖 iconutil）
  if (process.platform !== 'darwin') {
    console.log('[gen-icons] 非 macOS，跳过 icns 生成')
    return
  }
  fs.rmSync(ICONSET_DIR, { recursive: true, force: true })
  fs.mkdirSync(ICONSET_DIR, { recursive: true })
  // iconutil 标准集：16/32/128/256/512 各配 @2x
  const set = [
    [16, false],
    [16, true],
    [32, false],
    [32, true],
    [128, false],
    [128, true],
    [256, false],
    [256, true],
    [512, false],
    [512, true],
  ]
  for (const [base, is2x] of set) {
    const size = is2x ? base * 2 : base
    const art = Math.max(1, Math.round(size * (1 - PAD_RATIO * 2)))
    const p = padded(src, art, size)
    const name = is2x ? `icon_${base}x${base}@2x.png` : `icon_${base}x${base}.png`
    fs.writeFileSync(path.join(ICONSET_DIR, name), encodePng(p.rgba, size))
  }
  execFileSync('iconutil', ['-c', 'icns', ICONSET_DIR, '-o', OUT_ICNS], { stdio: 'inherit' })
  console.log(`[gen-icons] ${path.relative(root, OUT_ICNS)}: 已由 icon.iconset 重打（各尺寸均含 9% 边距）`)
}

main()
