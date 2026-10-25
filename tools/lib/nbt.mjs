// Minimal, dependency-free NBT reader (Java edition, big-endian, uncompressed input).
// Values: Byte/Short/Int/Float/Double -> number, Long -> bigint, String -> string,
// Byte_Array -> Buffer slice, Int_Array -> Int32Array, Long_Array -> LongArray (lazy view),
// List -> Array, Compound -> plain object.

/** Lazy view over a big-endian TAG_Long_Array; read as (hi, lo) 32-bit halves to avoid BigInt cost. */
export class LongArray {
  constructor(buf, off, length) {
    this.buf = buf;
    this.off = off;
    this.length = length;
  }
  hi(i) {
    return this.buf.readUInt32BE(this.off + i * 8);
  }
  lo(i) {
    return this.buf.readUInt32BE(this.off + i * 8 + 4);
  }
  toBigInt64Array() {
    const out = new BigInt64Array(this.length);
    for (let i = 0; i < this.length; i++) out[i] = this.buf.readBigInt64BE(this.off + i * 8);
    return out;
  }
}

export function parseNBT(buf) {
  let p = 0;
  const need = (n) => {
    if (p + n > buf.length) throw new RangeError(`NBT truncated at ${p} (+${n} > ${buf.length})`);
  };
  const str = () => {
    need(2);
    const n = buf.readUInt16BE(p);
    p += 2;
    need(n);
    const s = buf.toString('utf8', p, p + n);
    p += n;
    return s;
  };
  const int = () => {
    need(4);
    const v = buf.readInt32BE(p);
    p += 4;
    return v;
  };
  const payload = (t, depth) => {
    if (depth > 512) throw new Error('NBT nesting too deep');
    switch (t) {
      case 1: need(1); return buf.readInt8(p++);
      case 2: { need(2); const v = buf.readInt16BE(p); p += 2; return v; }
      case 3: return int();
      case 4: { need(8); const v = buf.readBigInt64BE(p); p += 8; return v; }
      case 5: { need(4); const v = buf.readFloatBE(p); p += 4; return v; }
      case 6: { need(8); const v = buf.readDoubleBE(p); p += 8; return v; }
      case 7: { const n = int(); need(n); const v = buf.subarray(p, p + n); p += n; return v; }
      case 8: return str();
      case 9: {
        need(1);
        const et = buf[p++];
        const n = int();
        if (n < 0) throw new Error('negative list length');
        const arr = new Array(n);
        for (let i = 0; i < n; i++) arr[i] = payload(et, depth + 1);
        return arr;
      }
      case 10: {
        const o = {};
        for (;;) {
          need(1);
          const tt = buf[p++];
          if (tt === 0) break;
          const k = str();
          o[k] = payload(tt, depth + 1);
        }
        return o;
      }
      case 11: {
        const n = int();
        need(n * 4);
        const v = new Int32Array(n);
        for (let i = 0; i < n; i++) v[i] = buf.readInt32BE(p + i * 4);
        p += n * 4;
        return v;
      }
      case 12: {
        const n = int();
        need(n * 8);
        const v = new LongArray(buf, p, n);
        p += n * 8;
        return v;
      }
      case 0: return null;
      default: throw new Error(`bad NBT tag type ${t} at ${p}`);
    }
  };
  need(1);
  const rootType = buf[p++];
  if (rootType !== 10) throw new Error(`NBT root is not a compound (type ${rootType})`);
  str(); // root name (usually empty)
  return payload(10, 0);
}
