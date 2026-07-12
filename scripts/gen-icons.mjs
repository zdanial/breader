// Generates placeholder PWA icons (two-tone vertical split — the "bilingual" motif)
// as raw PNGs with no image-library dependency. Run: npm run icons
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}

function png(size, pixel) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const raw = Buffer.alloc(size * (1 + size * 4))
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4)
    raw[row] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y, size)
      const o = row + 1 + x * 4
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
      raw[o + 3] = 255
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// left half indigo (target language), right half teal (base language)
const pixel = (x, _y, size) => (x < size / 2 ? [67, 56, 202] : [13, 148, 136])

mkdirSync('public/icons', { recursive: true })
writeFileSync('public/icons/icon-512.png', png(512, pixel))
writeFileSync('public/icons/icon-192.png', png(192, pixel))
writeFileSync('public/icons/apple-touch-icon.png', png(180, pixel))
console.log('icons written to public/icons/')
