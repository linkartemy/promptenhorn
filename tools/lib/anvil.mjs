// Anvil (.mca) region reader for Minecraft Java 1.18+ chunk format. Dependency-free.
// Reads defensively: region files may be written concurrently by a running server, so any
// chunk that fails to decompress/parse is retried once from a fresh read and otherwise skipped.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseNBT } from './nbt.mjs';
import { classify } from './blocks.mjs';

// ---------- decompression ----------

function lz4Block(src, dlen) {
  const out = Buffer.alloc(dlen);
  let s = 0;
  let d = 0;
  while (s < src.length) {
    const tok = src[s++];
    let lit = tok >>> 4;
    if (lit === 15) {
      let b;
      do { b = src[s++]; lit += b; } while (b === 255 && s < src.length);
    }
    if (d + lit > dlen || s + lit > src.length) throw new Error('lz4: literal overflow');
    src.copy(out, d, s, s + lit);
    s += lit;
    d += lit;
    if (s >= src.length) break;
    const off = src[s] | (src[s + 1] << 8);
    s += 2;
    if (off === 0 || off > d) throw new Error('lz4: bad offset');
    let ml = tok & 15;
    if (ml === 15) {
      let b;
      do { b = src[s++]; ml += b; } while (b === 255 && s < src.length);
    }
    ml += 4;
    if (d + ml > dlen) throw new Error('lz4: match overflow');
    let m = d - off;
    for (let k = 0; k < ml; k++) out[d++] = out[m++];
  }
  return out;
}

/** lz4-java LZ4BlockOutputStream framing ("LZ4Block" magic), used by MC compression type 4. */
function lz4JavaDecompress(buf) {
  const parts = [];
  let p = 0;
  while (p + 21 <= buf.length) {
    if (buf.toString('latin1', p, p + 8) !== 'LZ4Block') throw new Error('lz4: bad block magic');
    const method = buf[p + 8] & 0xf0;
    const clen = buf.readInt32LE(p + 9);
    const dlen = buf.readInt32LE(p + 13);
    p += 21;
    if (dlen === 0) break;
    const src = buf.subarray(p, p + clen);
    p += clen;
    if (method === 0x10) parts.push(src);
    else if (method === 0x20) parts.push(lz4Block(src, dlen));
    else throw new Error(`lz4: unknown method ${method}`);
  }
  return Buffer.concat(parts);
}

function decompress(type, data) {
  switch (type) {
    case 1: return zlib.gunzipSync(data);
    case 2: return zlib.inflateSync(data);
    case 3: return data;
    case 4: return lz4JavaDecompress(data);
    default: throw new Error(`unsupported chunk compression ${type}`);
  }
}

/** Extract one chunk's raw NBT buffer from a region file buffer, or null if not generated. */
export function readChunkBuffer(regionBuf, regionDir, cx, cz) {
  if (regionBuf.length < 8192) return null;
  const idx = ((cx & 31) + (cz & 31) * 32) * 4;
  const loc = regionBuf.readUInt32BE(idx);
  const offset = loc >>> 8;
  const sectors = loc & 0xff;
  if (offset === 0 || sectors === 0) return null;
  const start = offset * 4096;
  if (start + 5 > regionBuf.length) throw new Error('chunk offset beyond end of file');
  const len = regionBuf.readUInt32BE(start);
  const ctype = regionBuf[start + 4];
  let data;
  if (ctype & 0x80) {
    data = fs.readFileSync(path.join(regionDir, `c.${cx}.${cz}.mcc`));
  } else {
    if (len < 1 || start + 4 + len > regionBuf.length) throw new Error('chunk length beyond end of file');
    data = regionBuf.subarray(start + 5, start + 4 + len);
  }
  return decompress(ctype & 0x7f, data);
}

// ---------- block state unpacking ----------

function bitsFor(paletteLen, dataLen) {
  let bits = Math.max(4, Math.ceil(Math.log2(paletteLen)));
  if (Math.ceil(4096 / Math.floor(64 / bits)) !== dataLen) {
    // Tolerate odd encodings: derive bits from the array length instead.
    for (let b = 1; b <= 32; b++) {
      if (Math.ceil(4096 / Math.floor(64 / b)) === dataLen && (1 << b) >= paletteLen) { bits = b; break; }
    }
  }
  return bits;
}

function unpack(longs, bits, map, out) {
  const epl = Math.floor(64 / bits);
  const mask = bits >= 32 ? 0xffffffff : (1 << bits) - 1;
  let i = 0;
  for (let li = 0; li < longs.length && i < 4096; li++) {
    const hi = longs.hi(li);
    const lo = longs.lo(li);
    for (let k = 0; k < epl && i < 4096; k++, i++) {
      const off = k * bits;
      let v;
      if (off + bits <= 32) v = (lo >>> off) & mask;
      else if (off >= 32) v = (hi >>> (off - 32)) & mask;
      else v = ((lo >>> off) | (hi << (32 - off))) & mask;
      out[i] = v < map.length ? map[v] : 0;
    }
  }
}

// ---------- world ----------

export class World {
  constructor(regionDir) {
    this.regionDir = regionDir;
    this.states = []; // id -> info (see blocks.mjs classify)
    this.stateIndex = new Map();
    this.chunks = new Map(); // "cx,cz" -> chunk
    this.stats = { loaded: 0, missing: 0, failed: 0, notFull: 0, failures: [] };
    this.stateId('minecraft:air', null); // id 0 = air
  }

  stateId(name, props) {
    let key = name;
    if (props) {
      const ks = Object.keys(props).sort();
      if (ks.length) key += '[' + ks.map((k) => `${k}=${props[k]}`).join(',') + ']';
    }
    let id = this.stateIndex.get(key);
    if (id === undefined) {
      id = this.states.length;
      const short = name.startsWith('minecraft:') ? name.slice(10) : name;
      this.states.push({ id, key, name: short, props: props || {}, ...classify(short, props || {}) });
      this.stateIndex.set(key, id);
    }
    return id;
  }

  /** Load all chunks covering block rect [x1..x2]x[z1..z2]. */
  loadRect(x1, z1, x2, z2) {
    const cx1 = x1 >> 4, cx2 = x2 >> 4, cz1 = z1 >> 4, cz2 = z2 >> 4;
    const byRegion = new Map();
    for (let cx = cx1; cx <= cx2; cx++) {
      for (let cz = cz1; cz <= cz2; cz++) {
        if (this.chunks.has(`${cx},${cz}`)) continue;
        const rk = `${cx >> 5},${cz >> 5}`;
        if (!byRegion.has(rk)) byRegion.set(rk, []);
        byRegion.get(rk).push([cx, cz]);
      }
    }
    for (const [rk, list] of byRegion) {
      const [rx, rz] = rk.split(',').map(Number);
      const file = path.join(this.regionDir, `r.${rx}.${rz}.mca`);
      let buf = null;
      try { buf = fs.readFileSync(file); } catch { /* region not generated */ }
      let retry = [];
      for (const [cx, cz] of list) {
        if (!buf) { this.#store(cx, cz, null); continue; }
        try {
          this.#store(cx, cz, this.#decode(readChunkBuffer(buf, this.regionDir, cx, cz)));
        } catch (err) {
          retry.push([cx, cz, err]);
        }
      }
      if (retry.length) {
        // The server may have been mid-write; re-read the file once and try again.
        try { buf = fs.readFileSync(file); } catch { buf = null; }
        for (const [cx, cz, err0] of retry) {
          try {
            if (!buf) throw err0;
            this.#store(cx, cz, this.#decode(readChunkBuffer(buf, this.regionDir, cx, cz)));
          } catch (err) {
            this.stats.failed++;
            this.stats.failures.push(`chunk ${cx},${cz}: ${err.message}`);
            this.chunks.set(`${cx},${cz}`, null);
          }
        }
      }
    }
  }

  #store(cx, cz, chunk) {
    if (chunk) this.stats.loaded++;
    else this.stats.missing++;
    this.chunks.set(`${cx},${cz}`, chunk);
  }

  #decode(raw) {
    if (!raw) return null;
    const nbt = parseNBT(raw);
    const root = nbt.Level && !nbt.sections ? nbt.Level : nbt; // pre-1.18 wrapper, best effort
    const status = String(root.Status ?? '');
    if (status && !/full$/.test(status)) this.stats.notFull++;
    const sections = root.sections || root.Sections || [];
    const secs = new Map();
    let minSy = Infinity, maxSy = -Infinity;
    for (const s of sections) {
      const bs = s.block_states;
      if (!bs || !Array.isArray(bs.palette) || bs.palette.length === 0) continue;
      const sy = s.Y;
      const map = bs.palette.map((e) => this.stateId(e.Name, e.Properties));
      let content;
      if (map.length === 1 || !bs.data || bs.data.length === 0) content = map[0];
      else {
        content = new Uint16Array(4096);
        unpack(bs.data, bitsFor(map.length, bs.data.length), map, content);
      }
      if (content === 0) continue; // all air
      secs.set(sy, content);
      if (sy < minSy) minSy = sy;
      if (sy > maxSy) maxSy = sy;
    }
    const chunk = { minSy: 0, maxSy: -1, secs: [], status };
    if (secs.size) {
      chunk.minSy = minSy;
      chunk.maxSy = maxSy;
      chunk.secs = new Array(maxSy - minSy + 1).fill(0);
      for (const [sy, c] of secs) chunk.secs[sy - minSy] = c;
    }
    return chunk;
  }

  chunkAt(x, z) {
    return this.chunks.get(`${x >> 4},${z >> 4}`) ?? null;
  }

  /** Block state id at x,y,z; 0 for air, -1 if the chunk is not loaded/generated. */
  getId(x, y, z) {
    const ch = this.chunkAt(x, z);
    if (!ch) return -1;
    return chunkGet(ch, x & 15, y, z & 15);
  }

  info(id) {
    return this.states[id];
  }
}

export function chunkGet(ch, lx, y, lz) {
  const si = (y >> 4) - ch.minSy;
  if (si < 0 || si >= ch.secs.length) return 0;
  const s = ch.secs[si];
  if (typeof s === 'number') return s;
  return s[((y & 15) << 8) | (lz << 4) | lx];
}
