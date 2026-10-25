// Shape-aware isometric preview (front + back view side by side) for reviewing generators.
// Usage: node .dev/preview2.mjs <type|square|plaza> [seed] [out.png] [scale]
import fs from 'node:fs';
import zlib from 'node:zlib';
import { BUILDINGS, square, plaza } from '../bridge/buildings.mjs';
import { rngFrom } from '../bridge/blueprint.mjs';

const C = [
  [/water/, [55, 105, 215]], [/lava/, [230, 110, 20]],
  [/tinted_glass/, [60, 50, 70]], [/white_stained_glass/, [225, 235, 240]], [/yellow_stained/, [235, 210, 60]], [/orange_stained/, [230, 130, 40]],
  [/red_stained/, [190, 40, 40]], [/blue_stained/, [50, 70, 190]], [/light_blue_stained/, [110, 170, 230]], [/purple_stained/, [130, 60, 170]],
  [/lime_stained|green_stained/, [90, 160, 60]], [/glass/, [165, 205, 225]],
  [/oxidized.*copper|oxidized_copper/, [80, 165, 140]], [/weathered.*copper/, [100, 150, 110]], [/exposed.*copper/, [165, 125, 95]], [/copper/, [195, 110, 80]],
  [/gold/, [240, 200, 50]], [/lightning_rod/, [195, 110, 80]],
  [/red_bed|red_wool|red_carpet|red_banner|red_wall_banner|red_concrete/, [190, 35, 35]], [/white_bed/, [235, 235, 235]],
  [/blue_concrete|blue_wool|blue_carpet/, [45, 55, 150]], [/light_blue_concrete|light_blue_wool/, [80, 170, 215]], [/black_concrete|black_wool|black_carpet/, [25, 25, 30]],
  [/yellow_wool|yellow_carpet|yellow_concrete/, [240, 195, 40]], [/green_wool|green_carpet/, [85, 110, 30]], [/lime_wool|lime_carpet/, [110, 185, 30]],
  [/pink_wool|pink_carpet/, [235, 140, 170]], [/orange_wool|orange_carpet/, [235, 115, 20]], [/brown_wool|brown_carpet/, [115, 75, 45]], [/gray_wool|gray_carpet/, [70, 75, 80]],
  [/light_gray_wool|light_gray_carpet/, [140, 140, 135]], [/cyan_wool|cyan_carpet/, [20, 135, 145]],
  [/white_concrete/, [225, 228, 230]], [/light_gray_concrete/, [130, 130, 125]], [/gray_concrete/, [60, 62, 68]],
  [/white_wool|white_carpet|white_banner/, [235, 235, 235]],
  [/pale_oak_leaves/, [150, 150, 140]], [/azalea_leaves/, [95, 125, 45]], [/birch_leaves/, [110, 150, 70]], [/leaves/, [55, 100, 45]],
  [/flowering_azalea/, [120, 130, 80]], [/azalea/, [95, 125, 45]], [/moss/, [90, 115, 45]],
  [/mangrove/, [125, 50, 45]], [/warped/, [45, 125, 120]], [/crimson/, [115, 50, 75]], [/cherry/, [225, 175, 170]],
  [/pale_oak/, [225, 215, 210]], [/stripped_birch|birch_planks|birch_slab|birch_stairs/, [200, 185, 130]], [/birch_log/, [220, 220, 210]], [/birch/, [205, 190, 135]],
  [/stripped_dark_oak/, [95, 70, 45]], [/dark_oak/, [65, 43, 22]], [/stripped_spruce/, [115, 90, 55]], [/spruce_log|spruce_wood/, [60, 40, 25]], [/spruce/, [112, 80, 48]],
  [/stripped_oak/, [175, 140, 85]], [/oak_log|oak_wood/, [105, 85, 50]], [/oak/, [165, 132, 80]], [/bamboo/, [195, 175, 80]], [/jungle/, [160, 115, 80]], [/acacia/, [170, 90, 50]],
  [/tuff/, [110, 115, 105]], [/polished_blackstone|blackstone/, [45, 40, 48]], [/deepslate/, [72, 72, 78]], [/mud_brick/, [140, 105, 80]],
  [/resin/, [215, 100, 30]], [/nether_brick/, [70, 35, 40]], [/end_stone/, [220, 220, 160]],
  [/stone_brick/, [122, 122, 122]], [/brick/, [150, 72, 58]], [/mossy/, [100, 120, 90]], [/cobble/, [112, 112, 112]],
  [/polished_granite|granite/, [155, 105, 85]], [/polished_diorite|diorite/, [190, 190, 190]], [/andesite/, [135, 135, 135]], [/smooth_stone/, [160, 160, 160]], [/stone/, [125, 125, 125]],
  [/calcite/, [225, 225, 222]], [/quartz/, [235, 230, 224]], [/bone_block/, [225, 220, 200]], [/mushroom_stem/, [205, 200, 190]],
  [/white_terracotta/, [210, 178, 160]], [/sandstone/, [218, 205, 150]], [/yellow_terracotta/, [186, 133, 36]], [/light_blue_terracotta/, [113, 108, 137]],
  [/light_gray_terracotta/, [135, 106, 97]], [/pink_terracotta/, [162, 78, 79]], [/orange_terracotta/, [162, 84, 38]], [/lime_terracotta/, [104, 118, 53]],
  [/cyan_terracotta/, [87, 91, 91]], [/green_terracotta/, [76, 83, 42]], [/red_terracotta/, [143, 61, 47]], [/brown_terracotta/, [77, 51, 36]], [/terracotta/, [152, 94, 67]],
  [/hay/, [200, 170, 40]], [/daylight/, [40, 50, 70]], [/sea_lantern/, [190, 220, 215]], [/lantern|campfire|torch|candle/, [250, 180, 80]],
  [/tulip|poppy|potted|rose|geranium/, [215, 45, 55]], [/dirt_path/, [148, 122, 66]], [/gravel/, [130, 125, 120]], [/coarse|dirt|podzol|farmland|packed_mud/, [120, 85, 58]], [/:sand$/, [219, 207, 163]],
  [/wheat|carrots|potatoes|beetroots/, [140, 170, 50]], [/pumpkin/, [210, 120, 25]], [/melon/, [110, 145, 30]],
  [/barrel|chest|composter|crafting|lectern|loom|bookshelf|shelf/, [120, 85, 50]], [/iron|anvil|cauldron|chain|bars/, [95, 95, 100]],
  [/bell/, [235, 190, 60]], [/furnace|smoker/, [100, 100, 100]], [/grass|fern|flower|bluet|daisy|dandelion|allium|cornflower|bush|petals|lily/, [95, 150, 60]],
  [/wool|carpet/, [200, 200, 200]], [/cake/, [240, 230, 220]], [/yellow_(wall_)?banner/, [240, 195, 40]], [/blue_(wall_)?banner/, [45, 55, 150]], [/banner/, [230, 230, 230]], [/_bed/, [170, 70, 70]], [/sign/, [150, 120, 75]], [/statue/, [195, 110, 80]], [/decorated_pot|flower_pot/, [150, 80, 55]], [/./, [220, 0, 220]],
];
const colorOf = (b) => C.find(([re]) => re.test(b))[1];

const props = (b) => Object.fromEntries((b.match(/\[([^\]]*)\]/)?.[1] ?? '').split(',').filter(Boolean).map((p) => p.split('=')));
const nameOf = (b) => b.replace(/^minecraft:/, '').replace(/[[{].*$/, '');

/** Boxes [x0,y0,z0,x1,y1,z1] in block-local units for a block state. */
function shape(b, nb) {
  const n = nameOf(b);
  const p = props(b);
  const F = [[0, 0, 0, 1, 1, 1]];
  if (/_slab$/.test(n)) return p.type === 'top' ? [[0, 0.5, 0, 1, 1, 1]] : p.type === 'double' ? F : [[0, 0, 0, 1, 0.5, 1]];
  if (/_stairs$/.test(n)) {
    const base = p.half === 'top' ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1];
    const [y0, y1] = p.half === 'top' ? [0, 0.5] : [0.5, 1];
    const q = { east: [0.5, 0, 1, 1], west: [0, 0, 0.5, 1], south: [0, 0.5, 1, 1], north: [0, 0, 1, 0.5] }[p.facing];
    return [base, [q[0], y0, q[1], q[2], y1, q[3]]];
  }
  if (/carpet|pressure_plate|petals|leaf_litter|wildflowers|lily_pad|rail/.test(n)) return [[0, 0, 0, 1, 0.07, 1]];
  if (/_trapdoor$/.test(n)) {
    if (p.open !== 'true') return p.half === 'top' ? [[0, 0.81, 0, 1, 1, 1]] : [[0, 0, 0, 1, 0.19, 1]];
    return [{ south: [0, 0, 0, 1, 1, 0.19], north: [0, 0, 0.81, 1, 1, 1], east: [0, 0, 0, 0.19, 1, 1], west: [0.81, 0, 0, 1, 1, 1] }[p.facing]];
  }
  if (/_door$/.test(n)) return [{ south: [0, 0, 0, 1, 1, 0.19], north: [0, 0, 0.81, 1, 1, 1], east: [0, 0, 0, 0.19, 1, 1], west: [0.81, 0, 0, 1, 1, 1] }[p.facing]];
  if (/fence$|_wall$|glass_pane|_bars$|iron_bars/.test(n) && !/fence_gate/.test(n)) {
    const t = /_wall$/.test(n) ? 0.25 : /fence/.test(n) ? 0.375 : 0.44;
    const out = [[t, 0, t, 1 - t, 1, 1 - t]];
    const arm = /fence/.test(n) ? 0.44 : t;
    const conn = (o) => o && !/flower|potted|lantern|torch|carpet|sign|banner|bed|trapdoor|_door/.test(o);
    if (conn(nb(1, 0))) out.push([0.5, /fence/.test(n) ? 0.4 : 0, arm, 1, /fence/.test(n) ? 0.9 : 0.95, 1 - arm]);
    if (conn(nb(-1, 0))) out.push([0, /fence/.test(n) ? 0.4 : 0, arm, 0.5, /fence/.test(n) ? 0.9 : 0.95, 1 - arm]);
    if (conn(nb(0, 1))) out.push([arm, /fence/.test(n) ? 0.4 : 0, 0.5, 1 - arm, /fence/.test(n) ? 0.9 : 0.95, 1]);
    if (conn(nb(0, -1))) out.push([arm, /fence/.test(n) ? 0.4 : 0, 0, 1 - arm, /fence/.test(n) ? 0.9 : 0.95, 0.5]);
    return out;
  }
  if (/fence_gate/.test(n)) return [[0, 0.3, 0.4, 1, 1, 0.6]];
  if (/lantern/.test(n) && !/sea_lantern/.test(n)) return p.hanging === 'true' ? [[0.3, 0.1, 0.3, 0.7, 0.6, 0.7]] : [[0.3, 0, 0.3, 0.7, 0.5, 0.7]];
  if (/potted_|flower_pot/.test(n)) return [[0.32, 0, 0.32, 0.68, 0.38, 0.68], [0.38, 0.38, 0.38, 0.62, 0.7, 0.62]];
  if (/torch|lightning_rod|end_rod|chain/.test(n)) return [[0.42, 0, 0.42, 0.58, 1, 0.58]];
  if (/_bed$/.test(n)) return [[0, 0, 0, 1, 0.56, 1]];
  if (/campfire|daylight/.test(n)) return [[0, 0, 0, 1, 0.42, 1]];
  if (/cake/.test(n)) return [[0.1, 0, 0.1, 0.9, 0.5, 0.9]];
  if (/candle/.test(n)) return [[0.4, 0, 0.4, 0.6, 0.4, 0.6]];
  if (/bell/.test(n)) return [[0.25, 0.2, 0.25, 0.75, 0.8, 0.75]];
  if (/wall_banner/.test(n)) return [{ south: [0, -1, 0, 1, 0.9, 0.08], north: [0, -1, 0.92, 1, 0.9, 1], east: [0, -1, 0, 0.08, 0.9, 1], west: [0.92, -1, 0, 1, 0.9, 1] }[p.facing]];
  if (/banner/.test(n)) return [[0.45, 0, 0.45, 0.55, 2, 0.55], [0.05, 0.3, 0.45, 0.95, 1.9, 0.55]];
  if (/wall_hanging_sign/.test(n)) return [/east|west/.test(p.facing) ? [0.45, 0.05, 0.05, 0.55, 0.7, 0.95] : [0.05, 0.05, 0.45, 0.95, 0.7, 0.55]];
  if (/wall_sign/.test(n)) return [{ south: [0, 0.25, 0, 1, 0.75, 0.1], north: [0, 0.25, 0.9, 1, 0.75, 1], east: [0, 0.25, 0, 0.1, 0.75, 1], west: [0.9, 0.25, 0, 1, 0.75, 1] }[p.facing]];
  if (/sign/.test(n)) return [[0.45, 0, 0.45, 0.55, 0.6, 0.55], [0.05, 0.5, 0.45, 0.95, 1, 0.55]];
  if (/ladder/.test(n)) return [[0.1, 0, 0.1, 0.9, 1, 0.9]];
  if (/^(poppy|dandelion|cornflower|oxeye_daisy|azure_bluet|allium|blue_orchid|.*tulip|lily_of_the_valley|fern|short_grass|torchflower|bush|firefly_bush|sweet_berry_bush)$/.test(n)) return [[0.3, 0, 0.3, 0.7, 0.65, 0.7]];
  if (/wheat|carrots|potatoes|beetroots/.test(n)) return [[0.05, 0, 0.05, 0.95, 0.6, 0.95]];
  if (/rose_bush|lilac|peony|tall_grass|large_fern|sunflower/.test(n)) return [[0.15, 0, 0.15, 0.85, 1, 0.85]];
  if (/azalea$/.test(n)) return [[0.05, 0.2, 0.05, 0.95, 1, 0.95], [0.4, 0, 0.4, 0.6, 0.2, 0.6]];
  if (/statue/.test(n)) return [[0.25, 0, 0.25, 0.75, 0.9, 0.75]];
  if (/decorated_pot/.test(n)) return [[0.15, 0, 0.15, 0.85, 1, 0.85]];
  if (/cauldron/.test(n)) return [[0.05, 0, 0.05, 0.95, 1, 0.95]];
  if (/beehive/.test(n)) return F;
  return F;
}

function render(list, size, s) {
  const map = new Map(list.map((b) => [`${b.x},${b.y},${b.z}`, b.block]));
  const boxes = [];
  const hash = (x, y, z) => (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 1000 / 1000;
  for (const b of list) {
    const nb = (dx, dz) => map.get(`${b.x + dx},${b.y},${b.z + dz}`);
    const c = colorOf(b.block);
    const j = 0.93 + hash(b.x, b.y, b.z) * 0.14;
    for (const bx of shape(b.block, nb)) boxes.push({ x: b.x, y: b.y, z: b.z, bx, c: c.map((v) => v * j), glass: /glass/.test(b.block) });
  }
  for (let x = 0; x < size; x++) for (let z = 0; z < size; z++) if (!map.has(`${x},0,${z}`)) boxes.push({ x, y: -1, z, bx: [0, 0, 0, 1, 1, 1], c: [95, 150, 60].map((v) => v * (0.95 + hash(x, 0, z) * 0.1)) });
  const proj = (X, Y, Z) => [(X - Z) * s, ((X + Z) * s) / 2 - Y * s];
  const W = size * 2 * s + 20;
  const H = Math.round(size * s + 42 * s);
  const ox = size * s + 10;
  const oy = 34 * s;
  const img = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) img.set([236, 240, 245], i * 3);
  const poly = (pts, c, alpha = 1) => {
    const xs = pts.map((p) => p[0] + ox);
    const ys = pts.map((p) => p[1] + oy);
    const col = c.map((v) => Math.max(0, Math.min(255, Math.round(v))));
    for (let py = Math.floor(Math.min(...ys)); py <= Math.ceil(Math.max(...ys)); py++)
      for (let px = Math.floor(Math.min(...xs)); px <= Math.ceil(Math.max(...xs)); px++) {
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          if (ys[i] > py + 0.5 !== ys[j] > py + 0.5 && px + 0.5 < ((xs[j] - xs[i]) * (py + 0.5 - ys[i])) / (ys[j] - ys[i]) + xs[i]) inside = !inside;
        }
        if (!inside) continue;
        const o = (py * W + px) * 3;
        if (alpha >= 1) img.set(col, o);
        else for (let k = 0; k < 3; k++) img[o + k] = Math.round(img[o + k] * (1 - alpha) + col[k] * alpha);
      }
  };
  // Painter's order: far to near.
  boxes.sort((a, b) => a.x + a.bx[0] + a.z + a.bx[2] + (a.bx[3] - a.bx[0] + a.bx[5] - a.bx[2]) / 2 - (b.x + b.bx[0] + b.z + b.bx[2] + (b.bx[3] - b.bx[0] + b.bx[5] - b.bx[2]) / 2) || a.y + a.bx[1] - (b.y + b.bx[1]));
  for (const { x, y, z, bx, c, glass } of boxes) {
    const [x0, y0, z0, x1, y1, z1] = [x + bx[0], y + bx[1], z + bx[2], x + bx[3], y + bx[4], z + bx[5]];
    const a = glass ? 0.7 : 1;
    poly([proj(x0, y1, z0), proj(x1, y1, z0), proj(x1, y1, z1), proj(x0, y1, z1)], c, a);
    poly([proj(x1, y0, z0), proj(x1, y1, z0), proj(x1, y1, z1), proj(x1, y0, z1)], c.map((v) => v * 0.78), a);
    poly([proj(x0, y0, z1), proj(x1, y0, z1), proj(x1, y1, z1), proj(x0, y1, z1)], c.map((v) => v * 0.6), a);
  }
  return { W, H, img };
}

/** Orthographic front elevation (looking at the +z face, x to the right). Depth fog shows recesses. */
function elevation(list, s) {
  const H = 42;
  const W = 21;
  const img = Buffer.alloc(W * s * H * s * 3);
  for (let i = 0; i < W * s * H * s; i++) img.set([236, 240, 245], i * 3);
  const best = new Map();
  for (const b of list) {
    const n = nameOf(b.block);
    if (b.y < -1 || b.y >= H - 1 || (b.z >= 17 && b.y <= 2 && b.y >= 1)) continue;
    const k = `${b.x},${b.y}`;
    const cur = best.get(k);
    if (!cur || b.z > cur.z) best.set(k, b);
  }
  for (const [k, b] of best) {
    const [x, y] = k.split(',').map(Number);
    const fog = Math.max(0.45, 1 - (20 - b.z) * 0.035);
    const c = colorOf(b.block).map((v) => Math.round(v * fog + 236 * (1 - fog) * 0.15));
    const bx = shape(b.block, () => undefined);
    let [x0, y0, x1, y1] = [0, 0, 1, 1];
    if (bx.length === 1) [x0, y0, x1, y1] = [bx[0][0], Math.max(0, bx[0][1]), bx[0][3], Math.min(1, bx[0][4])];
    const py0 = (H - 2 - y) * s;
    for (let py = Math.floor(py0 + (1 - y1) * s); py < py0 + (1 - y0) * s; py++)
      for (let px = Math.floor((x + x0) * s); px < (x + x1) * s; px++) {
        if (px < 0 || py < 0 || px >= W * s || py >= H * s) continue;
        const edge = (px % s === 0 || py % s === 0) && bx.length !== 1 ? 0.9 : 1;
        img.set(c.map((v) => Math.round(v * edge)), (py * W * s + px) * 3);
      }
  }
  return { W: W * s, H: H * s, img };
}

function concat(a, b) {
  const W = a.W + b.W;
  const H = Math.max(a.H, b.H);
  const img = Buffer.alloc(W * H * 3, 255);
  for (let y = 0; y < H; y++) {
    if (y < a.H) a.img.copy(img, y * W * 3, y * a.W * 3, (y + 1) * a.W * 3);
    if (y < b.H) b.img.copy(img, (y * W + a.W) * 3, y * b.W * 3, (y + 1) * b.W * 3);
  }
  return { W, H, img };
}

function png({ W, H, img }) {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) img.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const [type, seed = 'a', out, scale = '9'] = process.argv.slice(2);
const make = () => (type === 'square' ? square(rngFrom(seed)) : type === 'plaza' ? plaza(rngFrom(seed)) : BUILDINGS[type](rngFrom(`${seed}:${type}`), { ...(process.env.STAGE ? { stage: Number(process.env.STAGE) } : {}), ...(process.env.TERRAIN ? { terrain: JSON.parse(process.env.TERRAIN) } : {}) }));
const bp = make();
const front = bp.toBuildList({ turns: 0, size: 21, offset: 2 }).filter((b) => !/^minecraft:(cave_)?air$/.test(b.block));
const back = make().toBuildList({ turns: 2, size: 21, offset: 2 }).filter((b) => !/^minecraft:(cave_)?air$/.test(b.block));
const s = Number(scale);
const img = concat(concat(render(front, 21, s), render(back, 21, s)), elevation(front, Math.round(s * 1.6)));
const file = out ?? `.dev/previews/${type}-${seed}.png`;
fs.mkdirSync(file.replace(/[\\/][^\\/]*$/, ''), { recursive: true });
fs.writeFileSync(file, png(img));
const magenta = [...new Set(front.map((b) => b.block).filter((b) => colorOf(b)[0] === 220 && colorOf(b)[1] === 0).map(nameOf))];
console.log(`${type}/${seed}: ${front.length} blocks -> ${file}${magenta.length ? `  (no colour: ${magenta.join(' ')})` : ''}`);
