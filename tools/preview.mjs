// Isometric PNG preview of a building blueprint, for checking generators without the game.
// Usage: node tools/preview.mjs <type|square|plaza> [seed] [turns] [out.png]
// The view looks from the south-east: the building's front (+z) is the lower-left face.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { BUILDINGS, square, plaza } from '../bridge/buildings.mjs';
import { rngFrom } from '../bridge/blueprint.mjs';

const COLORS = [
  [/lightning_rod/, [195, 110, 80]], [/tuff/, [110, 115, 105]], [/granite/, [155, 105, 85]], [/diorite/, [190, 190, 190]],
  [/cherry/, [225, 175, 170]], [/mushroom_stem/, [205, 200, 190]], [/_bed/, [170, 70, 70]], [/yellow_(wall_)?banner/, [240, 195, 40]],
  [/blue_(wall_)?banner/, [45, 55, 150]], [/banner/, [230, 230, 230]], [/yellow_concrete/, [240, 195, 40]], [/black_concrete/, [25, 25, 30]],
  [/packed_mud|rooted_dirt|podzol|farmland/, [120, 85, 58]], [/:sand$/, [219, 207, 163]], [/smoker|furnace/, [100, 100, 100]],
  [/crafting|bookshelf|lectern|loom|composter|decorated_pot/, [120, 85, 50]], [/wheat|carrots|potatoes|beetroots/, [140, 170, 50]],
  [/pumpkin/, [210, 120, 25]], [/melon/, [110, 145, 30]], [/cake|candle/, [240, 230, 220]], [/bell/, [235, 190, 60]],
  [/sign/, [150, 120, 75]], [/lily_of_the_valley/, [230, 230, 230]],
  [/water/, [60, 110, 220]], [/glass/, [170, 215, 235]], [/copper/, [80, 165, 140]],
  [/gold/, [240, 200, 50]], [/blue_concrete/, [40, 50, 150]], [/red_banner|red_wall_banner|red_carpet|red_wool/, [200, 30, 30]],
  [/mangrove/, [130, 50, 45]], [/warped/, [40, 130, 120]], [/crimson/, [120, 50, 80]], [/birch/, [215, 200, 150]],
  [/dark_oak/, [70, 45, 25]], [/spruce_leaves|oak_leaves/, [50, 90, 50]], [/azalea/, [90, 140, 60]], [/spruce/, [110, 80, 50]],
  [/oak_log|oak_planks|oak_/, [170, 135, 85]], [/deepslate/, [60, 60, 65]], [/mud_brick/, [140, 105, 80]],
  [/stone_brick/, [122, 122, 122]], [/brick/, [150, 70, 55]], [/mossy/, [100, 120, 90]], [/cobble/, [115, 115, 115]],
  [/andesite/, [135, 135, 135]], [/stone/, [125, 125, 125]], [/calcite/, [225, 225, 222]], [/quartz/, [235, 230, 225]],
  [/white_concrete|white_wool/, [230, 232, 235]], [/light_gray_concrete/, [150, 150, 150]], [/white_terracotta/, [210, 180, 160]],
  [/sandstone/, [215, 200, 150]], [/yellow_terracotta/, [190, 135, 40]], [/light_blue_terracotta/, [115, 110, 135]],
  [/light_gray_terracotta/, [135, 105, 95]], [/terracotta/, [160, 90, 70]], [/moss/, [90, 120, 45]], [/hay/, [200, 170, 40]],
  [/daylight/, [40, 50, 70]], [/lantern|campfire|torch/, [250, 180, 80]], [/tulip|poppy|potted|rose/, [220, 50, 60]],
  [/dirt_path|gravel|coarse/, [150, 125, 80]], [/fence|door|trapdoor|barrel|chest/, [100, 75, 50]], [/iron|anvil/, [90, 90, 90]],
  [/grass|fern|flower|bluet|daisy|dandelion|allium|cornflower/, [95, 150, 60]], [/wool|carpet/, [200, 200, 200]], [/./, [200, 100, 200]],
];
const colorOf = (b) => COLORS.find(([re]) => re.test(b))[1];

function render(list, size, s = 7) {
  const blocks = list.map((b) => ({ ...b, c: colorOf(b.block) }));
  for (let x = 0; x < size; x++) for (let z = 0; z < size; z++) blocks.push({ x, y: -1, z, c: [95, 150, 60] });
  const proj = (X, Y, Z) => [(X - Z) * s, ((X + Z) * s) / 2 - Y * s];
  const W = size * 2 * s + 20;
  const H = size * s + 40 * s;
  const ox = size * s + 10;
  const oy = 32 * s;
  const img = Buffer.alloc(W * H * 3, 255);
  const poly = (pts, c) => {
    const xs = pts.map((p) => p[0] + ox);
    const ys = pts.map((p) => p[1] + oy);
    for (let py = Math.floor(Math.min(...ys)); py <= Math.ceil(Math.max(...ys)); py++)
      for (let px = Math.floor(Math.min(...xs)); px <= Math.ceil(Math.max(...xs)); px++) {
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          if (ys[i] > py !== ys[j] > py && px < ((xs[j] - xs[i]) * (py - ys[i])) / (ys[j] - ys[i]) + xs[i]) inside = !inside;
        }
        if (inside) img.set(c.map((v) => Math.max(0, Math.min(255, Math.round(v)))), (py * W + px) * 3);
      }
  };
  blocks.sort((a, b) => a.x + a.z - (b.x + b.z) || a.y - b.y);
  for (const { x, y, z, c } of blocks) {
    poly([proj(x, y + 1, z), proj(x + 1, y + 1, z), proj(x + 1, y + 1, z + 1), proj(x, y + 1, z + 1)], c);
    poly([proj(x + 1, y, z), proj(x + 1, y + 1, z), proj(x + 1, y + 1, z + 1), proj(x + 1, y, z + 1)], c.map((v) => v * 0.75));
    poly([proj(x, y, z + 1), proj(x + 1, y, z + 1), proj(x + 1, y + 1, z + 1), proj(x, y + 1, z + 1)], c.map((v) => v * 0.55));
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

const [type, seed = 'a', turns = '0', out] = process.argv.slice(2);
const rng = rngFrom(seed);
const bp = type === 'square' ? square(rng) : type === 'plaza' ? plaza(rng) : BUILDINGS[type](rngFrom(`${seed}:${type}`), { ...(process.env.STAGE ? { stage: Number(process.env.STAGE) } : {}), ...(process.env.TERRAIN ? { terrain: JSON.parse(process.env.TERRAIN) } : {}) }); // STAGE=n, TERRAIN='{...}' env
const list = bp.toBuildList({ turns: Number(turns), size: 21, offset: 2 }).filter((b) => !/^minecraft:(cave_)?air$/.test(b.block));
const file = out ?? `preview-${type}-${seed}.png`;
fs.writeFileSync(file, png(render(list, 21)));
console.log(`${type}: ${list.length} blocks -> ${file}`);
