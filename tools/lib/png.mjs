// RGB raster + PNG encoder (zlib + hand-built chunks) + a tiny 3x5 bitmap font. No dependencies.
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Encode 8-bit RGB pixels (Uint8Array, w*h*3) as a PNG buffer. */
export function encodePNG(w, h, rgb) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1);
    raw[o] = 1; // filter: Sub (compresses flat map areas well)
    const row = y * stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= 3 ? rgb[row + i - 3] : 0;
      raw[o + 1 + i] = (rgb[row + i] - left) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 7 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// 3x5 glyphs, rows top->bottom, 3 bits each (MSB = left).
const GLYPHS = {
  0: [7, 5, 5, 5, 7], 1: [2, 6, 2, 2, 7], 2: [7, 1, 7, 4, 7], 3: [7, 1, 7, 1, 7], 4: [5, 5, 7, 1, 1],
  5: [7, 4, 7, 1, 7], 6: [7, 4, 7, 5, 7], 7: [7, 1, 2, 2, 2], 8: [7, 5, 7, 5, 7], 9: [7, 5, 7, 1, 7],
  '-': [0, 0, 7, 0, 0], ',': [0, 0, 0, 2, 4], '.': [0, 0, 0, 0, 2], ' ': [0, 0, 0, 0, 0], '=': [0, 7, 0, 7, 0],
  ':': [0, 2, 0, 2, 0], '/': [1, 1, 2, 4, 4], '(': [2, 4, 4, 4, 2], ')': [2, 1, 1, 1, 2],
  a: [0, 7, 1, 7, 7], b: [4, 4, 7, 5, 7], c: [0, 7, 4, 4, 7], d: [1, 1, 7, 5, 7], e: [0, 7, 7, 4, 7],
  f: [3, 4, 7, 4, 4], g: [7, 5, 7, 1, 6], h: [4, 4, 7, 5, 5], i: [2, 0, 2, 2, 2], j: [1, 0, 1, 5, 7],
  k: [4, 5, 6, 5, 5], l: [6, 2, 2, 2, 7], m: [0, 7, 7, 5, 5], n: [0, 6, 5, 5, 5], o: [0, 7, 5, 5, 7],
  p: [0, 7, 5, 7, 4], q: [0, 7, 5, 7, 1], r: [0, 7, 4, 4, 4], s: [0, 3, 6, 3, 6], t: [4, 7, 4, 4, 3],
  u: [0, 5, 5, 5, 7], v: [0, 5, 5, 5, 2], w: [0, 5, 5, 7, 7], x: [0, 5, 2, 5, 5], y: [5, 5, 7, 1, 7],
  z: [0, 7, 1, 4, 7], N: [5, 7, 7, 7, 5], S: [7, 4, 7, 1, 7], E: [7, 4, 6, 4, 7], W: [5, 5, 7, 7, 5],
};

export class Raster {
  constructor(w, h, bg = [0, 0, 0]) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      this.px[i * 3] = bg[0]; this.px[i * 3 + 1] = bg[1]; this.px[i * 3 + 2] = bg[2];
    }
  }
  set(x, y, r, g, b) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 3;
    this.px[o] = r; this.px[o + 1] = g; this.px[o + 2] = b;
  }
  blend(x, y, c, a) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 3;
    this.px[o] = this.px[o] * (1 - a) + c[0] * a;
    this.px[o + 1] = this.px[o + 1] * (1 - a) + c[1] * a;
    this.px[o + 2] = this.px[o + 2] * (1 - a) + c[2] * a;
  }
  fill(x, y, w, h, c) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c[0], c[1], c[2]);
  }
  /** Draw text with the 3x5 font; returns width in px. */
  text(x, y, str, c, scale = 1, shadow = null) {
    let cx = x;
    for (const ch of String(str)) {
      const g = GLYPHS[ch] ?? GLYPHS[ch.toLowerCase()] ?? GLYPHS[' '];
      for (let r = 0; r < 5; r++) {
        for (let col = 0; col < 3; col++) {
          if (!(g[r] & (4 >> col))) continue;
          for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
            if (shadow) this.set(cx + col * scale + dx + 1, y + r * scale + dy + 1, ...shadow);
            this.set(cx + col * scale + dx, y + r * scale + dy, c[0], c[1], c[2]);
          }
        }
      }
      cx += 4 * scale;
    }
    return cx - x;
  }
  static textWidth(str, scale = 1) {
    return String(str).length * 4 * scale - scale;
  }
  toPNG() {
    return encodePNG(this.w, this.h, this.px);
  }
}
