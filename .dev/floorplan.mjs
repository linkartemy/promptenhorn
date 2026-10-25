// Top-down floor plans: one panel per interior level (cut at the level, furniture shown), plus a legend strip.
// Usage: node .dev/floorplan.mjs <type> [seed] [out.png] [scale]
import fs from 'node:fs';
import zlib from 'node:zlib';
import { BUILDINGS } from '../bridge/buildings.mjs';
import { rngFrom, blockName, blockProps } from '../bridge/blueprint.mjs';
import { analyse } from '../tools/walkcheck.mjs';

const src = fs.readFileSync(new URL('./preview2.mjs', import.meta.url), 'utf8');
const C = eval(src.slice(src.indexOf('const C = [') + 10, src.indexOf('];', src.indexOf('const C = [')) + 1));
const colorOf = (b) => C.find(([re]) => re.test(b))[1];

const [type, seed = 'a', out, scaleArg = '14'] = process.argv.slice(2);
const s = Number(scaleArg);
const list = BUILDINGS[type](rngFrom(`${seed}:${type}`)).toBuildList({ turns: 0, size: 21, offset: 2 });
const map = new Map(list.map((b) => [`${b.x},${b.y},${b.z}`, b.block]));
const res = analyse(list, { turns: 0 });
const levels = res.levels.filter((l) => l.area >= 6);
const unreach = new Set(levels.flatMap((l) => l.unreachable.map(([x, z]) => `${x},${l.y},${z}`)));

const N = 21;
const pad = 6;
const label = 12;
const W = levels.length * (N * s + pad) + pad;
const H = N * s + pad * 2 + label;
const img = Buffer.alloc(W * H * 3, 0);
for (let i = 0; i < W * H; i++) img.set([245, 245, 240], i * 3);
const put = (px, py, c) => { if (px >= 0 && py >= 0 && px < W && py < H) img.set(c.map((v) => Math.max(0, Math.min(255, Math.round(v)))), (py * W + px) * 3); };
// 3x5 digit font for the level label
const FONT = { 0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001001001001', 8: '111101111101111', 9: '111101111001111', y: '101101010010010', '=': '000111000111000' };
const text = (str, x0, y0) => {
  let x = x0;
  for (const ch of str) {
    const f = FONT[ch];
    if (f) for (let i = 0; i < 15; i++) if (f[i] === '1') for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) put(x + (i % 3) * 2 + a, y0 + Math.floor(i / 3) * 2 + b, [40, 40, 40]);
    x += 8;
  }
};
levels.forEach((lv, i) => {
  const ox = pad + i * (N * s + pad);
  const oy = pad + label;
  text(`y=${lv.y}`, ox, pad - 2);
  for (let x = 0; x < N; x++)
    for (let z = 0; z < N; z++) {
      const y = lv.y;
      const up = map.get(`${x},${y + 1},${z}`);
      const mid = map.get(`${x},${y},${z}`);
      const floor = map.get(`${x},${y - 1},${z}`) ?? (y - 1 <= 0 ? 'minecraft:grass_block' : undefined);
      let c;
      let mark = null;
      const wall = up && mid && !/lantern|door|_bed|carpet|trapdoor|banner|sign/.test(up + mid);
      if (wall) c = /glass|pane/.test(mid + up) ? [150, 200, 230] : colorOf(mid).map((v) => v * 0.55);
      else if (mid && !/carpet|pressure_plate/.test(mid)) {
        c = colorOf(mid);
        if (/_stairs/.test(mid)) mark = blockProps(mid).facing;
        if (/_door/.test(mid)) c = [190, 120, 40];
      } else if (up && !/lantern/.test(up)) c = colorOf(up).map((v) => v * 0.8);
      else if (mid) c = colorOf(mid);
      else if (floor) c = colorOf(floor).map((v) => v * 0.75 + 255 * 0.25);
      else c = [70, 70, 90];
      if (unreach.has(`${x},${y},${z}`)) c = [230, 60, 60];
      for (let a = 0; a < s; a++)
        for (let b = 0; b < s; b++) {
          let cc = c;
          if (a === 0 || b === 0) cc = c.map((v) => v * 0.9);
          if (mark) {
            const t = { north: s - 1 - b, south: b, west: s - 1 - a, east: a }[mark];
            if (t > s * 0.55 && Math.abs((mark === 'north' || mark === 'south' ? a : b) - s / 2) < (t - s * 0.55)) cc = [30, 30, 30];
          }
          put(ox + x * s + a, oy + z * s + b, cc);
        }
      const lamp = map.get(`${x},${y + 2},${z}`) ?? '';
      if (/lantern/.test(lamp + (up ?? ''))) for (let a = s / 2 - 2; a < s / 2 + 2; a++) for (let b = s / 2 - 2; b < s / 2 + 2; b++) put(ox + x * s + a, oy + z * s + b, [255, 200, 40]);
    }
});
function png({ W, H, img }) {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) img.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const file = out ?? `.dev/previews/plan-${type}-${seed}.png`;
fs.writeFileSync(file, png({ W, H, img }));
console.log(`${type}/${seed}: ${levels.length} levels -> ${file}`);
