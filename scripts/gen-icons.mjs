// Generates the PWA PNG icons from scratch (no image deps) so the repo stays
// self-contained. Draws a simple Russian-tricolour motif on a dark tile.
// Run with: npm run gen:icons
import { deflateSync, crc32 } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '../public/icons')
mkdirSync(outDir, { recursive: true })

const COLORS = {
  bg: [11, 16, 33, 255], // #0b1021
  white: [238, 241, 251, 255], // #eef1fb
  blue: [0, 57, 166, 255], // #0039a6
  red: [213, 43, 30, 255], // #d52b1e
}

function render(size) {
  const px = Buffer.alloc(size * size * 4)
  const set = (x, y, [r, g, b, a]) => {
    const i = (y * size + x) * 4
    px[i] = r
    px[i + 1] = g
    px[i + 2] = b
    px[i + 3] = a
  }

  const lo = Math.round(size * 0.2)
  const hi = Math.round(size * 0.8)
  const band = (hi - lo) / 3
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let c = COLORS.bg
      if (x >= lo && x < hi && y >= lo && y < hi) {
        const k = Math.floor((y - lo) / band)
        c = k === 0 ? COLORS.white : k === 1 ? COLORS.blue : COLORS.red
      }
      set(x, y, c)
    }
  }
  return px
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0, 0)
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type RGBA
  // 10-12 left zero: compression, filter, interlace
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = deflateSync(raw)
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

for (const size of [192, 512]) {
  const file = resolve(outDir, `icon-${size}.png`)
  writeFileSync(file, encodePng(size, render(size)))
  console.log(`wrote ${file}`)
}
