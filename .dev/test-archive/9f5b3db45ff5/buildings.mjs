// Swiss-style procedural buildings. Each generator draws into a 17x17 local frame
// (x, z in 0..16; y = 0 is the ground surface, the street is at z > 16 — the front faces +z / south).
// square() and plaza() may use the whole 21x21 frame (-2..18) including the street ring.
import { Blueprint, rngFrom, sturdyToward, isPaneLike, blockName } from './blueprint.mjs';

export const INNER = 17;

// ================================================================ materials

const DIR = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const OPP = { north: 'south', south: 'north', east: 'west', west: 'east' };
const CCW = { north: 'west', west: 'south', south: 'east', east: 'north' };
/** Unit vector running along a wall that faces `face`. */
const along = (face) => (face === 'north' || face === 'south' ? [1, 0] : [0, 1]);
const alongDir = (face) => (face === 'north' || face === 'south' ? 'east' : 'south');
const INF = 1e6;

const GERANIUMS = ['potted_red_tulip', 'potted_poppy', 'potted_red_tulip', 'potted_poppy', 'potted_pink_tulip', 'potted_red_tulip', 'potted_white_tulip'];
const BOX_FLOWERS = ['poppy', 'red_tulip', 'poppy', 'red_tulip', 'pink_tulip', 'red_tulip', 'white_tulip', 'poppy'];
const MEADOW = ['poppy', 'cornflower', 'oxeye_daisy', 'azure_bluet', 'dandelion', 'allium', 'red_tulip', 'white_tulip', 'lily_of_the_valley', 'short_grass', 'short_grass', 'short_grass'];
const HOUSE_PLANTS = ['potted_fern', 'potted_azalea_bush', 'potted_flowering_azalea_bush', 'potted_red_tulip', 'potted_spruce_sapling'];

const pattern = (list) => `{patterns:[${list.map(([p, c]) => `{pattern:"minecraft:${p}",color:"${c}"}`).join(',')}]}`;
export const SWISS_FLAG = pattern([['straight_cross', 'white'], ['border', 'red']]);
/** Canton flags as [base colour, banner data]. */
const CANTONS = [
  ['red', pattern([['stripe_downright', 'yellow']])], // Bern
  ['white', pattern([['diagonal_right', 'blue']])], // Zürich
  ['white', pattern([['half_horizontal', 'blue']])], // Luzern
  ['yellow', pattern([['half_vertical_right', 'red']])], // Genève
  ['blue', pattern([['half_vertical', 'red']])], // Ticino
  ['red', pattern([['half_vertical', 'white']])], // Valais
  ['red', pattern([['square_top_left', 'white']])], // Schwyz
  ['white', pattern([['half_horizontal', 'black']])], // Fribourg
  ['white', pattern([['stripe_middle', 'blue']])], // Zug
  ['white', pattern([['stripe_left', 'green'], ['stripe_right', 'red']])], // Neuchâtel
];

const signData = (lines, color = 'black', glow = false) => {
  const msgs = [0, 1, 2, 3].map((i) => JSON.stringify(lines[i] ?? '')).join(',');
  const side = `{messages:[${msgs}],color:"${color}",has_glowing_text:${glow ? 1 : 0}b}`;
  return `{front_text:${side},back_text:${side}}`;
};

const WOOD = (w) => ({
  name: w, planks: `${w}_planks`, log: `${w}_log`, stripped: `stripped_${w}_log`, stairs: `${w}_stairs`, slab: `${w}_slab`,
  fence: `${w}_fence`, gate: `${w}_fence_gate`, trapdoor: `${w}_trapdoor`, plate: `${w}_pressure_plate`, door: w,
  sign: `${w}_wall_sign`, hanging: `${w}_wall_hanging_sign`,
});

const ROOFS = {
  spruce: { stairs: 'spruce_stairs', slab: 'spruce_slab', block: 'spruce_planks' },
  dark_oak: { stairs: 'dark_oak_stairs', slab: 'dark_oak_slab', block: 'dark_oak_planks' },
  slate: { stairs: 'deepslate_tile_stairs', slab: 'deepslate_tile_slab', block: 'deepslate_tiles' },
  tile: { stairs: 'brick_stairs', slab: 'brick_slab', block: 'bricks' },
  clay: { stairs: 'mud_brick_stairs', slab: 'mud_brick_slab', block: 'mud_bricks' },
  granite: { stairs: 'granite_stairs', slab: 'granite_slab', block: 'granite' },
  resin: { stairs: 'resin_brick_stairs', slab: 'resin_brick_slab', block: 'resin_bricks' },
  stone: { stairs: 'andesite_stairs', slab: 'andesite_slab', block: 'andesite' },
  blackstone: { stairs: 'polished_blackstone_brick_stairs', slab: 'polished_blackstone_brick_slab', block: 'polished_blackstone_bricks' },
  copper: { stairs: 'waxed_oxidized_cut_copper_stairs', slab: 'waxed_oxidized_cut_copper_slab', block: 'waxed_oxidized_cut_copper' },
  copperW: { stairs: 'waxed_weathered_cut_copper_stairs', slab: 'waxed_weathered_cut_copper_slab', block: 'waxed_weathered_cut_copper' },
  deepslate: { stairs: 'polished_deepslate_stairs', slab: 'polished_deepslate_slab', block: 'polished_deepslate' },
};

const TRIMS = {
  tuff: { block: 'polished_tuff', stairs: 'polished_tuff_stairs', slab: 'polished_tuff_slab' },
  tuffb: { block: 'tuff_bricks', stairs: 'tuff_brick_stairs', slab: 'tuff_brick_slab' },
  sand: { block: 'smooth_sandstone', stairs: 'smooth_sandstone_stairs', slab: 'smooth_sandstone_slab' },
  stone: { block: 'stone_bricks', stairs: 'stone_brick_stairs', slab: 'stone_brick_slab' },
  andesite: { block: 'polished_andesite', stairs: 'polished_andesite_stairs', slab: 'polished_andesite_slab' },
  quartz: { block: 'smooth_quartz', stairs: 'smooth_quartz_stairs', slab: 'smooth_quartz_slab' },
  diorite: { block: 'polished_diorite', stairs: 'polished_diorite_stairs', slab: 'polished_diorite_slab' },
  granite: { block: 'polished_granite', stairs: 'polished_granite_stairs', slab: 'polished_granite_slab' },
  deepslate: { block: 'polished_deepslate', stairs: 'polished_deepslate_stairs', slab: 'polished_deepslate_slab' },
};

const PLASTERS = [
  ['calcite', 3], ['white_terracotta', 3], ['smooth_sandstone', 2], ['pink_terracotta', 2], ['yellow_terracotta', 1.5],
  ['light_blue_terracotta', 1], ['lime_terracotta', 1], ['light_gray_terracotta', 0.4], ['orange_terracotta', 0.8],
  ['cyan_terracotta', 0.2], ['mushroom_stem', 1],
];
const SHUTTERS = [
  ['mangrove_trapdoor', 2], ['waxed_oxidized_copper_trapdoor', 2], ['warped_trapdoor', 1.2], ['dark_oak_trapdoor', 1.5],
  ['spruce_trapdoor', 1], ['birch_trapdoor', 1], ['pale_oak_trapdoor', 1], ['crimson_trapdoor', 0.8],
];

const stoneMix = (rng) => () =>
  rng.weighted([['stone_bricks', 6], ['mossy_stone_bricks', 1.2], ['cracked_stone_bricks', 0.8], ['cobblestone', 1], ['andesite', 0.6]]);
const rubble = (rng) => () =>
  rng.weighted([['cobblestone', 4], ['mossy_cobblestone', 1.5], ['stone', 1.5], ['andesite', 1], ['tuff', 0.6], ['stone_bricks', 0.5]]);
const paving = (rng) => () =>
  rng.weighted([['stone_bricks', 4], ['polished_andesite', 2], ['andesite', 1], ['cobblestone', 0.7], ['mossy_stone_bricks', 0.3]]);

// ================================================================ generic helpers

function perimeter(x1, z1, x2, z2) {
  const out = [];
  for (let x = x1; x <= x2; x++) out.push([x, z1], [x, z2]);
  for (let z = z1 + 1; z < z2; z++) out.push([x1, z], [x2, z]);
  return out;
}

/** Ring of logs along the top of a wall, axis following each edge. */
function logRing(bp, x1, z1, x2, z2, y, log) {
  for (let x = x1; x <= x2; x++) {
    bp.set(x, y, z1, `${log}[axis=x]`);
    bp.set(x, y, z2, `${log}[axis=x]`);
  }
  for (let z = z1 + 1; z < z2; z++) {
    bp.set(x1, y, z, `${log}[axis=z]`);
    bp.set(x2, y, z, `${log}[axis=z]`);
  }
}

/**
 * Heightmap roof over the footprint [x1..x2] x [z1..z2]. w/e/n/s: where the slope from that edge starts
 * (0 = eave at that edge, INF = gable, k = half-hip that starts k levels up). kind: 'stairs' (45°),
 * 'steep' (2:1, stair over block) or 'slabs' (1:2). cap: flat top from that distance on.
 * trim: {stairs, slab} for barge boards on gable edges. brackets: stairs name for corbels under eaves.
 * Returns at(x, z) -> { y (roof surface cell), d, gov, ridge, top }.
 */
function roof(bp, o) {
  const { x1, x2, z1, z2, y, mat, kind = 'stairs', w = 0, e = 0, n = 0, s = 0, cap = INF, trim, brackets, skip, pitch = 2 } = o;
  const cells = new Map();
  for (let x = x1; x <= x2; x++)
    for (let z = z1; z <= z2; z++) {
      const t = [['east', x - x1 + w], ['west', x2 - x + e], ['south', z - z1 + n], ['north', z2 - z + s]];
      let d = Math.min(...t.map((a) => a[1]));
      const gov = t.filter((a) => a[1] === d).map((a) => a[0]);
      const flat = d >= cap;
      if (flat) d = cap;
      const ridge = flat || (gov.includes('east') && gov.includes('west')) || (gov.includes('north') && gov.includes('south'));
      cells.set(`${x},${z}`, { x, z, d, gov, ridge, flat, top: false });
    }
  for (const c of cells.values()) {
    if (skip?.(c.x, c.z)) continue;
    const { x, z, d, gov, ridge } = c;
    const stair = ridge ? `${mat.slab}[type=bottom]` : `${mat.stairs}[facing=${gov[0]},half=bottom]`;
    if (kind === 'slabs') {
      c.y = y + Math.floor(d / 2);
      c.top = d % 2 === 1;
      bp.set(x, c.y, z, `${mat.slab}[type=${c.top ? 'top' : 'bottom'}]`);
    } else if (kind === 'steep') {
      c.y = y + pitch * d + pitch - 1;
      for (let k = 1; k < pitch; k++) bp.set(x, c.y - k, z, mat.block);
      bp.set(x, c.y, z, stair);
    } else {
      c.y = y + d;
      bp.set(x, c.y, z, stair);
    }
  }
  const edgeSides = (c) => [c.x === x1 && 'east', c.x === x2 && 'west', c.z === z1 && 'south', c.z === z2 && 'north'].filter(Boolean);
  if (trim && kind !== 'steep')
    for (const c of cells.values()) {
      if (skip?.(c.x, c.z) || c.flat) continue;
      const sides = edgeSides(c);
      if (!sides.length || sides.every((sd) => c.gov.includes(sd))) continue; // eave, not a rake
      if (kind === 'slabs') {
        if (c.top) bp.set(c.x, c.y, c.z, `${trim.slab}[type=double]`);
        else {
          bp.set(c.x, c.y, c.z, `${trim.slab}[type=bottom]`);
          bp.setIfEmpty(c.x, c.y - 1, c.z, `${trim.slab}[type=top]`);
        }
      } else {
        bp.set(c.x, c.y, c.z, c.ridge ? `${trim.slab}[type=bottom]` : `${trim.stairs}[facing=${c.gov[0]},half=bottom]`);
        bp.setIfEmpty(c.x, c.y - 1, c.z, c.ridge ? `${trim.slab}[type=top]` : `${trim.stairs}[facing=${OPP[c.gov[0]]},half=top]`);
      }
    }
  if (brackets && kind === 'stairs')
    for (const c of cells.values()) {
      if (skip?.(c.x, c.z) || c.ridge) continue;
      const sides = edgeSides(c);
      if (sides.length !== 1 || !c.gov.includes(sides[0]) || (c.x + c.z) % 2) continue;
      const [dx, dz] = DIR[sides[0]];
      if (/pane|glass/.test(bp.get(c.x + dx, c.y - 1, c.z + dz) ?? '')) continue;
      bp.setIfEmpty(c.x, c.y - 1, c.z, `${brackets}[facing=${sides[0]},half=top]`);
    }
  return (x, z) => cells.get(`${x},${z}`);
}

/** Fills wall cells from `fromY` up to the underside of the roof (gables and knee walls). */
function closeUnder(bp, at, pts, fromY, fill, mat) {
  for (const [x, z] of pts) {
    const c = at(x, z);
    if (!c || c.y == null) continue;
    for (let y = fromY; y < c.y; y++) bp.setIfEmpty(x, y, z, typeof fill === 'function' ? fill(x, y, z) : fill);
    if (c.top && mat) bp.set(x, c.y, z, `${mat.slab}[type=double]`);
  }
}

/**
 * Window in the wall plane at (x, y, z) facing outward `face`, `w` wide (running +x / +z), `h` tall.
 * o: glass, shutters (trapdoor), box (flower box front trapdoor), sill (stairs), lintel (block), frame (block).
 */
function win(bp, rng, x, y, z, face, o = {}) {
  const { w = 1, h = 2, glass = 'glass_pane', shutters, box, sill, lintel, frame, soil = 'moss_block' } = o;
  const [ax, az] = along(face);
  const [dx, dz] = DIR[face];
  const P = (i, j, k) => [x + ax * i + dx * k, y + j, z + az * i + dz * k];
  const put = (i, j, k, b) => bp.set(...P(i, j, k), b);
  const putIf = (i, j, k, b) => bp.setIfEmpty(...P(i, j, k), b);
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) put(i, j, 0, typeof glass === 'function' ? glass(i, j) : glass);
  if (frame)
    for (let j = 0; j < h; j++) {
      put(-1, j, 0, frame);
      put(w, j, 0, frame);
    }
  if (lintel) for (let i = frame ? -1 : 0; i < w + (frame ? 1 : 0); i++) put(i, h, 0, lintel);
  if (shutters)
    for (let j = 0; j < h; j++) {
      putIf(-1, j, 1, `${shutters}[facing=${face},open=true,half=bottom]`);
      putIf(w, j, 1, `${shutters}[facing=${face},open=true,half=bottom]`);
    }
  if (box) {
    const ad = alongDir(face);
    for (let i = 0; i < w; i++) {
      put(i, -1, 1, soil);
      put(i, -1, 2, `${box}[facing=${OPP[face]},open=true,half=bottom]`);
      put(i, 0, 1, rng.pick(BOX_FLOWERS));
    }
    putIf(-1, -1, 1, `${box}[facing=${OPP[ad]},open=true,half=bottom]`);
    putIf(w, -1, 1, `${box}[facing=${ad},open=true,half=bottom]`);
  } else if (sill) for (let i = 0; i < w; i++) putIf(i, -1, 1, `${sill}[facing=${OPP[face]},half=top]`);
}

/** Door (single or double) in a wall facing `face`, with optional stone surround and transom. */
function doorway(bp, x, y, z, face, wood, o = {}) {
  const { double = false, frame, lintel, transom } = o;
  const [ax, az] = along(face);
  const w = double ? 2 : 1;
  const left = DIR[CCW[face]];
  const firstIsLeft = left[0] === -ax && left[1] === -az;
  bp.door(x, y, z, wood, face, double ? (firstIsLeft ? 'left' : 'right') : 'left');
  if (double) bp.door(x + ax, y, z + az, wood, face, firstIsLeft ? 'right' : 'left');
  if (transom) for (let i = 0; i < w; i++) bp.set(x + ax * i, y + 2, z + az * i, transom);
  const top = transom ? 3 : 2;
  if (frame)
    for (let j = 0; j < top; j++) {
      bp.set(x - ax, y + j, z - az, frame);
      bp.set(x + ax * w, y + j, z + az * w, frame);
    }
  if (lintel) for (let i = -1; i <= w; i++) bp.set(x + ax * i, y + top, z + az * i, lintel);
}

/** Wall lantern: a fence bracket sticking out of the wall with a lantern hanging below. */
function wallLamp(bp, x, y, z, face, fence = 'dark_oak_fence') {
  const [dx, dz] = DIR[face];
  if (bp.get(x + dx, y, z + dz) || bp.get(x + dx, y - 1, z + dz)) return;
  bp.set(x + dx, y, z + dz, fence);
  bp.set(x + dx, y - 1, z + dz, 'lantern[hanging=true]');
}

/**
 * Balcony deck: floor on `cells`, railing on outer edges, geraniums along the rail, corbels under the house side.
 * isHouse(x, z) tells which neighbours are the building (no railing there).
 */
function deck(bp, rng, cells, y, { floor, rail = 'board', wood = 'spruce', isHouse, flowers = 0.7, bracket, railBlock, post }) {
  const key = (x, z) => `${x},${z}`;
  const S = new Set(cells.map(([x, z]) => key(x, z)));
  for (const [x, z] of cells) bp.set(x, y, z, floor);
  for (const [x, z] of cells) {
    const outs = Object.keys(DIR).filter((f) => !S.has(key(x + DIR[f][0], z + DIR[f][1])) && !isHouse(x + DIR[f][0], z + DIR[f][1]));
    if (outs.length) {
      let block;
      const touchesHouse = Object.values(DIR).some(([dx, dz]) => isHouse(x + dx, z + dz));
      if (railBlock && touchesHouse && post) block = post;
      else if (railBlock) block = railBlock;
      else if (outs.length > 1 || rail === 'fence') block = `${wood}_fence`;
      else block = `${wood}_trapdoor[facing=${OPP[outs[0]]},open=true,half=bottom]`;
      bp.set(x, y + 1, z, block);
      if (flowers && rng.chance(flowers)) bp.set(x, y + 2, z, rng.pick(GERANIUMS));
    }
    if (bracket) {
      const toHouse = Object.keys(DIR).find((f) => isHouse(x + DIR[f][0], z + DIR[f][1]));
      const wallCell = toHouse && bp.get(x + DIR[toHouse][0], y - 1, z + DIR[toHouse][1]);
      if (toHouse && (x + z) % 2 === 0 && !/pane|glass/.test(wallCell ?? '')) bp.setIfEmpty(x, y - 1, z, `${bracket}[facing=${toHouse},half=top]`);
    }
  }
}

/** Bench of stairs with trapdoor arm rests. backTo = side of the backrest; runs along the perpendicular axis. */
function bench(bp, x, z, backTo, len = 2, wood = 'spruce', y = 1) {
  const [ax, az] = along(backTo);
  const ad = alongDir(backTo);
  for (let i = 0; i < len; i++) bp.set(x + ax * i, y, z + az * i, `${wood}_stairs[facing=${backTo},half=bottom]`);
  bp.setIfEmpty(x - ax, y, z - az, `${wood}_trapdoor[facing=${OPP[ad]},open=true,half=bottom]`);
  bp.setIfEmpty(x + ax * len, y, z + az * len, `${wood}_trapdoor[facing=${ad},open=true,half=bottom]`);
}

/** Street lamp. style 'simple' (post + lantern) or 'double' (two hanging arms). */
function lamp(bp, x, z, h = 3, style = 'simple', post = 'dark_oak_fence', base = 'polished_blackstone_wall', y0 = 1) {
  bp.set(x, y0, z, base);
  for (let y = y0 + 1; y < y0 + h; y++) bp.set(x, y, z, post);
  const top = y0 + h;
  if (style === 'double') {
    bp.set(x, top, z, post);
    for (const [dx, dz] of [[1, 0], [-1, 0]]) {
      bp.set(x + dx, top, z + dz, post);
      bp.set(x + dx, top - 1, z + dz, 'lantern[hanging=true]');
    }
    bp.set(x, top + 1, z, 'lantern[hanging=false]');
  } else bp.set(x, top, z, 'lantern[hanging=false]');
}

/** Flag pole with a standing banner on top (rotation 0 = flag faces the street). */
function flagPole(bp, x, z, h = 6, banner = `red_banner[rotation=0]${SWISS_FLAG}`, y0 = 1) {
  bp.set(x, y0, z, 'stone_brick_wall');
  for (let y = y0 + 1; y < y0 + h; y++) bp.set(x, y, z, 'spruce_fence');
  bp.set(x, y0 + h, z, banner);
}

const inPlot = (x, z, lo = 0, hi = 16) => x >= lo && x <= hi && z >= lo && z <= hi;

/** Alpine spruce: layered cone, maxR = widest tier radius. */
function spruce(bp, x, z, h = 7, maxR = 2, lo = 0, hi = 16, y0 = 1) {
  for (let i = 0; i < h; i++) bp.set(x, y0 + i, z, 'spruce_log[axis=y]');
  if (y0 === 1) bp.set(x, 0, z, 'rooted_dirt');
  const L = 'spruce_leaves[persistent=true]';
  for (let i = 3; i <= h; i++) {
    const t = (h - i) / Math.max(1, h - 3);
    let r = Math.round(t * maxR + (i % 2 ? 0.3 : -0.3));
    r = Math.max(i >= h - 1 ? 0 : 1, Math.min(maxR, r));
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > (r >= 2 ? r + 1 : r)) continue;
        if (inPlot(x + dx, z + dz, lo, hi)) bp.setIfEmpty(x + dx, y0 + i - 1, z + dz, L);
      }
  }
  bp.set(x, y0 + h, z, L);
  bp.set(x, y0 + h + 1, z, L);
}

/** Round deciduous tree (linden / birch / maple). r = crown radius 1..3. */
function broadTree(bp, x, z, h = 5, r = 2, kind = 'oak', lo = 0, hi = 16, y0 = 1) {
  const log = kind === 'birch' ? 'birch_log' : kind === 'dark_oak' ? 'dark_oak_log' : 'oak_log';
  const leaves = kind === 'birch' ? 'birch_leaves' : kind === 'azalea' ? 'flowering_azalea_leaves' : kind === 'dark_oak' ? 'dark_oak_leaves' : 'oak_leaves';
  for (let i = 0; i < h; i++) bp.set(x, y0 + i, z, `${log}[axis=y]`);
  if (y0 === 1) bp.set(x, 0, z, 'rooted_dirt');
  const cy = y0 + h - 1;
  const layers = r >= 3 ? [[-2, 2], [-1, 3], [0, 3], [1, 3], [2, 2], [3, 1]] : r === 2 ? [[-2, 1], [-1, 2], [0, 2], [1, 2], [2, 1]] : [[-2, 1], [-1, 1], [0, 1], [1, 1], [2, 0]];
  const hash = (a, b, c) => ((((a * 73856093) ^ (b * 19349663) ^ (c * 83492791)) >>> 0) % 100) / 100;
  for (const [dy, rr] of layers)
    for (let dx = -rr; dx <= rr; dx++)
      for (let dz = -rr; dz <= rr; dz++) {
        const edge = Math.abs(dx) === rr && Math.abs(dz) === rr;
        if (rr > 0 && edge && (rr > 1 || hash(x + dx, cy + dy, z + dz) < 0.6)) continue;
        if (rr >= 2 && Math.abs(dx) + Math.abs(dz) === 2 * rr - 1 && hash(x + dx, cy + dy, z + dz) < 0.35) continue;
        if (inPlot(x + dx, z + dz, lo, hi) && cy + dy > y0 + 1) bp.setIfEmpty(x + dx, cy + dy, z + dz, `${leaves}[persistent=true]`);
      }
}

function sprinkleFlowers(bp, rng, x1, z1, x2, z2, density = 0.18, list = MEADOW) {
  for (let x = x1; x <= x2; x++)
    for (let z = z1; z <= z2; z++) {
      const ground = bp.get(x, 0, z);
      if ((ground && !/grass_block|moss_block|podzol|coarse_dirt/.test(ground)) || bp.get(x, 1, z)) continue;
      if (rng.chance(density)) bp.set(x, 1, z, rng.pick(list));
    }
}

/** Fence around the plot edge; gates at the given x positions on the street side. */
function plotFence(bp, gates, fence = 'spruce_fence', gate = 'spruce_fence_gate', { back = true, sides = true, fromZ = 0 } = {}) {
  for (let i = 0; i <= 16; i++) {
    if (gates.includes(i)) bp.setIfEmpty(i, 1, 16, `${gate}[facing=south]`);
    else bp.setIfEmpty(i, 1, 16, fence);
    if (back) bp.setIfEmpty(i, 1, 0, fence);
    if (sides && i >= fromZ) {
      bp.setIfEmpty(0, 1, i, fence);
      bp.setIfEmpty(16, 1, i, fence);
    }
  }
}

/** Planter: flowering azalea on a grass block, boxed in by trapdoors. */
function planter(bp, x, z, wood = 'spruce', plant = 'flowering_azalea') {
  bp.set(x, 0, z, 'moss_block');
  bp.set(x, 1, z, plant);
  for (const f of Object.keys(DIR)) bp.setIfEmpty(x + DIR[f][0], 1, z + DIR[f][1], `${wood}_trapdoor[facing=${f},open=true,half=bottom]`);
}

// ================================================================ interiors: stairs, ladders, partitions, furniture

const isWalkable = (b) => !b || /carpet|pressure_plate/.test(b);

/**
 * Switch-back staircase in a two-lane shaft (works for any storey heights).
 * axis: 'z' (flights run along z) or 'x'. laneA / laneB: lists of cross coordinates (1 or 2 wide each).
 * u0: approach cell of the first flight along the axis, dir: +1 / -1 ascent direction of the first flight.
 * planes: floor block levels [F0, F1, ...]; flight i climbs from planes[i] to planes[i+1] in lane A (even) or B (odd).
 * Returns { cells: footprint [[x, z]] reserved on every floor, ends: approach/exit cells per plane }.
 */
function stairHall(bp, { axis, laneA, laneB, u0, dir, planes, wood = 'spruce', under }) {
  const xz = (u, v) => (axis === 'z' ? [v, u] : [u, v]);
  const facingOf = (d) => (axis === 'z' ? (d < 0 ? 'north' : 'south') : d < 0 ? 'west' : 'east');
  const us = new Set();
  const ends = {};
  let a = u0;
  let d = dir;
  for (let i = 0; i + 1 < planes.length; i++) {
    const F0 = planes[i];
    const R = planes[i + 1] - F0;
    const lane = i % 2 ? laneB : laneA;
    us.add(a);
    // A climbing player needs three clear blocks above every step it leaves (the hitbox rises mid-step),
    // so the floor above is opened over the approach and all but the last step.
    for (let k = -1; k < R; k++) {
      const u = a + d * (1 + k);
      us.add(u);
      for (const v of lane) {
        const [x, z] = xz(u, v);
        if (k >= 0) bp.set(x, F0 + 1 + k, z, `${wood}_stairs[facing=${facingOf(d)},half=bottom]`);
        if (under && k > 0) bp.set(x, F0 + k, z, under);
        const feet = F0 + 2 + k;
        for (let yy = feet; yy <= feet + (k < R - 1 ? 2 : 1); yy++) bp.set(x, yy, z, null);
      }
    }
    const e = a + d * (R + 1);
    us.add(e);
    (ends[F0] ??= []).push(...lane.map((v) => xz(a, v)));
    (ends[planes[i + 1]] ??= []).push(...lane.map((v) => xz(e, v)));
    a = e;
    d = -d;
  }
  const cells = [];
  for (const u of us) for (const v of [...laneA, ...laneB]) cells.push(xz(u, v));
  return { cells, ends };
}

/** Ladder against a wall: ladder cells from y0 up to y1 (inclusive) at (x, z), facing away from the wall. */
function ladderUp(bp, x, z, facing, y0, y1) {
  for (let y = y0; y <= y1; y++) bp.set(x, y, z, `ladder[facing=${facing}]`);
  bp.set(x, y1 + 1, z, null);
  bp.set(x, y1 + 2, z, null);
}

/** Interior wall from (x1, z1) to (x2, z2) (one of them equal), rows y0..y0+h-1, with doors. */
function partition(bp, x1, z1, x2, z2, y0, h, block, doors = [], wood = 'spruce') {
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++)
    for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++)
      for (let y = y0; y < y0 + h; y++) bp.set(x, y, z, typeof block === 'function' ? block(x, y, z) : block);
  for (const [dx, dz, open] of doors) {
    for (let y = y0; y < y0 + Math.min(h, 2); y++) bp.set(dx, y, dz, null);
    if (open) continue;
    const facing = z1 === z2 ? 'south' : 'east';
    bp.door(dx, y0, dz, wood, facing, 'left');
  }
}

/** True if placing a sturdy item at (x, y..y+hh-1, z) would bend a neighbouring glass pane. */
function nextToPane(bp, x, y, z, hh, block) {
  for (let i = 0; i < hh; i++)
    for (const [f, [dx, dz]] of Object.entries(DIR)) {
      const nb = bp.get(x + dx, y + i, z + dz);
      if (nb && isPaneLike(blockName(nb)) && sturdyToward(typeof block === 'function' ? block(OPP[f], i) : block, f)) return true;
    }
  return false;
}

const KACHELOFEN = ['green_terracotta', 'cyan_terracotta', 'white_terracotta', 'lime_terracotta', 'light_blue_terracotta'];

/**
 * Furnishes a room r = {x1, z1, x2, z2, y (feet level), h (clear height)} without blocking it:
 * items stand along the walls, never on `keep` cells, never next to window panes, and every free floor cell
 * must stay reachable from the room's entries (keep cells inside the room). Returns placed light count.
 */
function furnish(bp, rng, r, kind, keep = [], wood = 'spruce', o = {}) {
  const { x1, z1, x2, z2, y } = r;
  const h = r.h ?? 3;
  if (x2 < x1 || z2 < z1) return 0;
  const inRoom = (x, z) => x >= x1 && x <= x2 && z >= z1 && z <= z2;
  const keepSet = new Set(keep.map(([x, z]) => `${x},${z}`));
  const walk = (x, z) => isWalkable(bp.get(x, y, z)) && isWalkable(bp.get(x, y + 1, z));
  const entries = keep.filter(([x, z]) => inRoom(x, z));
  // Door cells in the room's walls are entries too.
  for (let x = x1 - 1; x <= x2 + 1; x++)
    for (let z = z1 - 1; z <= z2 + 1; z++) {
      if (inRoom(x, z)) continue;
      const b = bp.get(x, y, z);
      if (b && /_door\b|fence_gate/.test(b)) for (const [dx, dz] of Object.values(DIR)) if (inRoom(x + dx, z + dz)) entries.push([x + dx, z + dz]);
      if (!b && walk(x, z) && bp.get(x, y - 1, z)) for (const [dx, dz] of Object.values(DIR)) if (inRoom(x + dx, z + dz)) entries.push([x + dx, z + dz]);
    }
  const connected = () => {
    const free = [];
    for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) if (walk(x, z)) free.push(`${x},${z}`);
    if (!free.length) return true;
    const fs = new Set(free);
    const roots = entries.map(([x, z]) => `${x},${z}`).filter((k) => fs.has(k));
    if (entries.length && roots.length < new Set(entries.map(([x, z]) => `${x},${z}`)).size) return false;
    const seen = new Set([roots.length ? roots[0] : free[0]]);
    const q = [...seen];
    while (q.length) {
      const [x, z] = q.pop().split(',').map(Number);
      for (const [dx, dz] of Object.values(DIR)) {
        const k = `${x + dx},${z + dz}`;
        if (fs.has(k) && !seen.has(k)) { seen.add(k); q.push(k); }
      }
    }
    return seen.size === fs.size;
  };
  const tryPlace = (cells) => {
    // cells: [[x, y, z, block]]
    for (const [x, yy, z, b] of cells) {
      if (!inRoom(x, z) || keepSet.has(`${x},${z}`) || bp.get(x, yy, z)) return false;
      if (bp.get(x, y - 1, z) == null) return false;
      if (nextToPane(bp, x, yy, z, 1, b)) return false;
    }
    for (const [x, yy, z, b] of cells) bp.set(x, yy, z, b);
    if (connected()) return true;
    for (const [x, yy, z] of cells) bp.set(x, yy, z, null);
    return false;
  };
  const slots = [];
  for (let x = x1; x <= x2; x++) slots.push([x, z1, 'south'], [x, z2, 'north']);
  for (let z = z1 + 1; z < z2; z++) slots.push([x1, z, 'east'], [x2, z, 'west']);
  const shuffled = slots.map((s) => [rng.next(), s]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
  const place = (fn) => shuffled.some(([x, z, f]) => fn(x, z, f));
  const one = (block, hh = 1) => (x, z, f) => tryPlace([...Array(hh)].map((_, i) => [x, y + i, z, typeof block === 'function' ? block(f, i) : block]));
  const bed = (color, bunk = false) => (x, z, f) => {
    const fx = x + DIR[f][0];
    const fz = z + DIR[f][1];
    const cells = [[x, y, z, `${color}_bed[facing=${OPP[f]},part=head]`], [fx, y, fz, `${color}_bed[facing=${OPP[f]},part=foot]`]];
    if (bunk) cells.push([x, y + 2, z, `${color}_bed[facing=${OPP[f]},part=head]`], [fx, y + 2, fz, `${color}_bed[facing=${OPP[f]},part=foot]`], [x, y + 1, z, `${wood}_fence`]);
    if (!tryPlace(cells)) return false;
    o.marks?.push(['bed', x, y, z]);
    return true;
  };
  const sofa = (x, z, f) => {
    const [ax, az] = along(f);
    return tryPlace([[x, y, z, `quartz_stairs[facing=${OPP[f]},half=bottom]`], [x + ax, y, z + az, `quartz_stairs[facing=${OPP[f]},half=bottom]`]]);
  };
  const toilet = (x, z, f) => tryPlace([[x, y, z, 'smooth_quartz'], [x, y + 1, z, 'birch_trapdoor[facing=south,half=bottom]']]);
  const tub = (x, z, f) => {
    const [ax, az] = along(f);
    return tryPlace([[x, y, z, 'water_cauldron[level=3]'], [x + ax, y, z + az, 'water_cauldron[level=3]']]);
  };
  const items = {
    bed: bed(rng.pick(['red', 'red', 'white', 'light_gray', 'green', 'blue'])),
    bed2: bed(rng.pick(['red', 'white', 'yellow', 'cyan'])),
    bunk: bed(rng.pick(['red', 'blue', 'green', 'brown']), true),
    bunk2: bed(rng.pick(['red', 'blue', 'green', 'brown']), true),
    bookshelf: one('bookshelf', Math.min(2, h - 1)),
    chiseled: one((f) => `chiseled_bookshelf[facing=${f},slot_0_occupied=true,slot_1_occupied=true,slot_3_occupied=true,slot_4_occupied=true]`),
    chest: one((f) => `chest[facing=${f}]`),
    barrel: one('barrel[facing=up]'),
    counter: one((f) => `barrel[facing=${f}]`),
    furnace: one((f) => `furnace[facing=${f},lit=false]`),
    smoker: one((f) => `smoker[facing=${f},lit=true]`),
    sink: one('water_cauldron[level=3]'),
    crafting: one('crafting_table'),
    stove: one(rng.pick(KACHELOFEN), 2),
    plant: one(() => rng.pick(HOUSE_PLANTS)),
    armchair: one((f) => `${wood}_stairs[facing=${OPP[f]},half=bottom]`),
    lectern: one((f) => `lectern[facing=${f}]`),
    loom: one((f) => `loom[facing=${f}]`),
    pot: one((f) => `decorated_pot[facing=${f}]`),
    clock: one((f, i) => (i === 0 ? `${wood}_planks` : `${wood}_trapdoor[facing=${OPP[f]},open=true,half=bottom]`), 2),
    wardrobe: one((f, i) => `${wood}_planks`, 2),
    shelf: (x, z, f) => tryPlace([[x, y + 1, z, `${wood}_shelf[facing=${f}]`]]) && true,
    sofa,
    toilet,
    tub,
    hay: one('hay_block[axis=y]'),
    composter: one('composter[level=4]'),
  };
  const lists = {
    stube: ['stove', 'armchair', 'clock', 'bookshelf', 'plant', 'chest'],
    kitchen: ['sink', 'counter', 'crafting', 'counter', 'chest', 'barrel'],
    bedroom: ['bed', 'chest', 'wardrobe', 'plant', 'barrel'],
    twin: ['bed', 'bed2', 'chest', 'wardrobe', 'plant'],
    bath: ['tub', 'toilet', 'sink', 'chest'],
    living: ['sofa', 'bookshelf', 'plant', 'armchair', 'chest', 'plant'],
    shop: ['counter', 'barrel', 'chest', 'chiseled', 'pot', 'barrel', 'counter'],
    office: ['lectern', 'bookshelf', 'chiseled', 'chest', 'plant'],
    lobby: ['plant', 'armchair', 'plant', 'sofa', 'chiseled', 'plant'],
    dorm: ['bunk', 'bunk2', 'chest', 'chest', 'barrel'],
    common: ['stove', 'chest', 'barrel', 'chiseled', 'clock'],
    storage: ['barrel', 'barrel', 'chest', 'barrel', 'hay', 'composter'],
    guest: ['bed', 'chest', 'plant'],
  };
  for (const it of o.items ?? lists[kind] ?? lists.living) place(items[it]);
  // Dining table with chairs (and table cloth) in the middle.
  const cx = (x1 + x2) >> 1;
  const cz = (z1 + z2) >> 1;
  if (o.table ?? ['stube', 'kitchen', 'common', 'living'].includes(kind)) {
    const ok = tryPlace([[cx, y, cz, `${wood}_fence`], [cx, y + 1, cz, rng.pick(['white_carpet', `${wood}_pressure_plate`, 'red_carpet'])]]);
    if (ok) for (const f of Object.keys(DIR)) if (rng.chance(0.85)) {
      if (tryPlace([[cx + DIR[f][0], y, cz + DIR[f][1], `${wood}_stairs[facing=${f},half=bottom]`]])) o.marks?.push(['seat', cx + DIR[f][0], y, cz + DIR[f][1], { facing: OPP[f] }]);
    }
  }
  // Rug.
  if (['bedroom', 'twin', 'living', 'lobby', 'guest'].includes(kind)) {
    const rug = kind === 'lobby' ? 'red_carpet' : rng.pick(['red_carpet', 'white_carpet', 'light_gray_carpet', 'brown_carpet', 'green_carpet']);
    for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++) if (inRoom(x, z) && !bp.get(x, y, z) && bp.get(x, y - 1, z) && !keepSet.has(`${x},${z}`)) bp.set(x, y, z, rug);
  }
  return light(bp, r);
}

/** Hanging lantern from the ceiling of room r (centre first; works under sloped roofs too). Returns 1 if placed. */
function light(bp, r) {
  const { x1, z1, x2, z2, y } = r;
  const cx = (x1 + x2) >> 1;
  const cz = (z1 + z2) >> 1;
  const cand = [[cx, cz], [cx + 1, cz], [cx, cz + 1], [cx - 1, cz], [cx, cz - 1], [x1 + 1, z1 + 1], [x2 - 1, z2 - 1], [x1 + 1, z2 - 1], [x2 - 1, z1 + 1], [x1, z1], [x2, z2]];
  for (const [x, z] of cand) {
    if (x < x1 || x > x2 || z < z1 || z > z2) continue;
    if (bp.get(x, y, z) || bp.get(x, y + 1, z) || bp.get(x, y + 2, z)) continue;
    let top = y + 3;
    while (top < y + 10 && !bp.get(x, top, z)) top++;
    const ceil = bp.get(x, top, z);
    if (!ceil || top === y + 10) continue;
    if (/slab\[type=top|half=top|trapdoor|glass|pane|leaves|fence|ladder|lantern|_bed|door|carpet|chain|_rod|banner|sign/.test(ceil)) continue;
    bp.set(x, top - 1, z, 'lantern[hanging=true]');
    return 1;
  }
  // Low room: a lantern standing on a sturdy piece of furniture.
  for (let x = x1; x <= x2; x++)
    for (let z = z1; z <= z2; z++) {
      const b = bp.get(x, y, z);
      if (b && /barrel|chest|crafting|bookshelf|planks/.test(b) && !bp.get(x, y + 1, z)) {
        bp.set(x, y + 1, z, 'lantern[hanging=false]');
        return 1;
      }
    }
  return 0;
}

// ================================================================ chalet (Bernese Oberland)

export function chalet(rng) {
  const bp = new Blueprint();
  const W = rng.weighted([[11, 4], [13, 3]]);
  const D = rng.weighted([[9, 2], [11, 3]]);
  const x1 = (INNER - W) >> 1;
  const x2 = x1 + W - 1;
  const cx = 8;
  const z2 = 11;
  const z1 = z2 - D + 1;
  const ix1 = x1 + 1, ix2 = x2 - 1, iz1 = z1 + 1, iz2 = z2 - 1;
  const tw = WOOD(rng.weighted([['spruce', 5], ['dark_oak', 4], ['oak', 1]]));
  const trimW = WOOD(tw.name === 'dark_oak' ? rng.pick(['spruce', 'oak', 'birch']) : rng.pick(['dark_oak', 'spruce', 'birch']));
  const inner = WOOD(rng.pick(['spruce', 'oak', 'birch', 'spruce']));
  const logWalls = rng.chance(0.55);
  const isCorner = (x, z) => (x === x1 || x === x2) && (z === z1 || z === z2);
  const timber = (x, y, z) => (isCorner(x, z) ? `${tw.log}[axis=y]` : logWalls ? `${tw.stripped}[axis=${z === z1 || z === z2 ? 'x' : 'z'}]` : tw.planks);
  const stone = stoneMix(rng);
  const plasterBase = rng.chance(0.45);
  const plaster = rng.pick(['calcite', 'calcite', 'smooth_quartz', 'white_terracotta']);
  const nUp = rng.chance(0.45) ? 2 : 1;
  const steep = rng.chance(0.4);
  const roofMat = ROOFS[rng.weighted([['spruce', 3], ['dark_oak', 3], ['slate', 3], ['stone', 1]])];
  const shutter = rng.chance(0.75) ? rng.weighted(SHUTTERS) : null;
  const rail = rng.weighted([['board', 5], ['fence', 2]]);
  const leanTo = W === 11 && rng.chance(0.45);
  const sideDeck = !leanTo && W === 11 && rng.chance(0.4);
  const isHouse = (x, z) => x >= x1 && x <= x2 && z >= z1 && z <= z2;
  const planes = [0, 4, 8, 12].slice(0, nUp + 1);
  const yTop = 4 + 4 * nUp;

  // Foundation and ground floor (masonry or whitewashed plaster on a stone plinth).
  bp.fill(x1, 0, z1, x2, 0, z2, 'stone_bricks');
  bp.fill(ix1, 0, iz1, ix2, 0, iz2, inner.planks);
  bp.walls(x1, 1, z1, x2, 3, z2, (x, y, z) => (!plasterBase || y === 1 || isCorner(x, z) ? stone() : plaster));
  for (let u = 0; u < nUp; u++) {
    const yb = 4 + 4 * u;
    bp.fill(ix1, yb, iz1, ix2, yb, iz2, inner.planks);
    logRing(bp, x1, z1, x2, z2, yb, tw.log);
    bp.walls(x1, yb + 1, z1, x2, yb + 3, z2, timber);
  }
  bp.fill(ix1, yTop, iz1, ix2, yTop, iz2, inner.planks);
  logRing(bp, x1, z1, x2, z2, yTop, tw.log);

  // ---- windows and doors
  const gx = W === 11 ? [[cx - 3, 1], [cx + 3, 1]] : [[cx - 4, 2], [cx + 3, 2]];
  for (const [x, w] of gx) win(bp, rng, x, 2, z2, 'south', { w, h: 2, shutters: shutter });
  for (const x of [cx - 3, cx + 2]) win(bp, rng, x, 2, z1, 'north', { w: 2, h: 2, shutters: shutter });
  const groups = W === 13 ? [[2, 3], [5, 5]] : [[2, 3]];
  const leanZ = [z1 + 1, Math.min(z2 - 2, z1 + 5)];
  const inLean = (z) => leanTo && z >= leanZ[0] - 1 && z <= leanZ[1] + 1;
  const sideZ = [];
  for (let z = z1 + 2; z <= z2 - 2; z += 3) sideZ.push(z);
  for (let u = 0; u < nUp; u++) {
    const yb = 4 + 4 * u;
    for (const [a, b] of groups)
      for (const sgn of [-1, 1]) win(bp, rng, sgn > 0 ? cx + a : cx - b, yb + 1, z2, 'south', { w: b - a + 1, h: 2, shutters: shutter });
    bp.door(cx, yb + 1, z2, tw.door, 'south');
    for (const x of [cx - 3, cx + 2]) win(bp, rng, x, yb + 1, z1, 'north', { w: 2, h: 2, shutters: shutter, box: trimW.trapdoor });
  }
  for (const z of sideZ) {
    win(bp, rng, x1, 2, z, 'west', { h: 2, shutters: shutter });
    if (!inLean(z)) win(bp, rng, x2, 2, z, 'east', { h: 2, shutters: shutter });
    for (let u = 0; u < nUp; u++) {
      const yb = 4 + 4 * u;
      win(bp, rng, x1, yb + 1, z, 'west', { h: 2, shutters: shutter, box: trimW.trapdoor });
      if (u === 0 && inLean(z)) continue;
      win(bp, rng, x2, yb + 1, z, 'east', { h: 2, shutters: sideDeck && u === 0 ? undefined : shutter, box: sideDeck && u === 0 ? undefined : trimW.trapdoor });
    }
  }
  bp.door(cx, 1, z2, tw.door, 'south');
  bp.set(cx, 0, z2 + 1, 'stone_brick_slab[type=top]');
  wallLamp(bp, cx + 1, 3, z2, 'south', trimW.fence);
  wallLamp(bp, cx - 1, 3, z2, 'south', trimW.fence);

  // ---- staircase along the east wall, rooms, chimney above the kitchen stove
  const hall = stairHall(bp, { axis: 'z', laneA: [ix2 - 1], laneB: [ix2], u0: iz2, dir: -1, planes, wood: inner.name });
  let zp = (iz1 + iz2) >> 1;
  if (sideZ.includes(zp)) zp++;
  const roomX2 = ix2 - 2;
  const sx = ix1;
  for (const F of planes) {
    const panel = (x, y, z) => (y === F + 1 ? inner.planks : `${inner.stripped}[axis=x]`);
    partition(bp, ix1, zp, roomX2, zp, F + 1, 3, panel, [[F === 0 ? cx - 1 : cx, zp]], inner.door);
  }
  // Kitchen stove with its chimney breast running up through every floor and out of the roof.
  bp.set(sx, 1, iz1, 'smoker[facing=south,lit=true]');
  // ---- roof: wide overhang, gable to the street, decorative barge boards
  const R = { x1: x1 - 2, x2: x2 + 2, z1: z1 - 1, z2: z2 + 3 };
  const at = roof(bp, { ...R, y: steep ? yTop - 1 : yTop, mat: roofMat, kind: steep ? 'stairs' : 'slabs', n: INF, s: INF, trim: { stairs: trimW.stairs, slab: trimW.slab } });
  closeUnder(bp, at, perimeter(x1, z1, x2, z2), yTop + 1, tw.planks, roofMat);
  const chim = rng.pick(['cobblestone', 'stone_bricks', 'bricks']);
  bp.fill(sx, 2, iz1, sx, at(sx, iz1).y + 1, iz1, chim);
  bp.set(sx, at(sx, iz1).y + 2, iz1, 'campfire[lit=true,signal_fire=false]');
  for (const x of [x1, x2, x1 + 2, x2 - 2]) {
    const c = at(x, z2 + 1);
    bp.setIfEmpty(x, c.y - 1, z2 + 1, `${trimW.stairs}[facing=north,half=top]`);
  }
  // Attic: ladder up from the top storey against the back wall.
  ladderUp(bp, cx, iz1, 'south', planes[nUp] + 1, yTop);
  // Gable: windows, attic balcony on steep roofs, Swiss flag under the ridge.
  const room = (x) => at(x, z2).y - (yTop + 1);
  if (steep && room(cx) >= 4) {
    const cells = [];
    for (let x = x1 + 2; x <= x2 - 2; x++) if (room(x) >= 3) cells.push([x, z2 + 1], [x, z2 + 2]);
    deck(bp, rng, cells, yTop, { floor: `${trimW.slab}[type=top]`, rail, wood: trimW.name, isHouse, flowers: 0.6 });
    bp.door(cx, yTop + 1, z2, tw.door, 'south');
    for (const x of [cx - 2, cx + 2]) if (room(x) >= 3) win(bp, rng, x, yTop + 1, z2, 'south', { h: 2 });
    if (room(cx) >= 5) bp.set(cx, yTop + 4, z2 + 1, `red_wall_banner[facing=south]${SWISS_FLAG}`);
  } else {
    bp.set(cx, yTop + 2, z2 + 1, `red_wall_banner[facing=south]${SWISS_FLAG}`);
    for (const x of [cx - 2, cx + 2]) if (room(x) >= 1) win(bp, rng, x, yTop + 1, z2, 'south', { h: Math.min(2, room(x)) });
  }

  // ---- balconies
  for (let u = 0; u < nUp; u++) {
    const yb = 4 + 4 * u;
    const inset = u === 1 ? 1 : 0;
    const cells = [];
    for (let x = x1 - 1 + inset; x <= x2 + 1 - inset; x++) for (let k = 1; k <= 2; k++) cells.push([x, z2 + k]);
    if (sideDeck && u === 0) {
      for (let z = z1 + 1; z <= z2; z++) for (let x = x2 + 1; x <= x2 + 2; x++) cells.push([x, z]);
      cells.push([x2 + 2, z2 + 1], [x2 + 2, z2 + 2]);
    }
    deck(bp, rng, cells, yb, { floor: `${trimW.slab}[type=top]`, rail, wood: trimW.name, isHouse, bracket: trimW.stairs, flowers: 0.75 });
  }

  // ---- lean-to woodshed (Schopf) on the east side
  if (leanTo) {
    const [za, zb] = leanZ;
    const xa = x2 + 1;
    const xb = Math.min(16, x2 + 3);
    for (let z = za; z <= zb; z++) {
      bp.fill(xb, 1, z, xb, 3, z, z === zb ? `${tw.log}[axis=y]` : `${tw.stripped}[axis=y]`);
      for (let x = xa; x <= xb; x++) {
        const d = xb - x;
        bp.set(x, d === 2 ? 5 : 4, z, d === 1 ? `${roofMat.stairs}[facing=west,half=bottom]` : `${roofMat.slab}[type=bottom]`);
      }
    }
    for (let x = xa; x < xb; x++) bp.fill(x, 1, za, x, 3, za, `${tw.stripped}[axis=y]`);
    for (let x = xa; x < xb; x++)
      for (let z = za + 1; z <= zb; z++)
        for (let y = 1; y <= 2; y++) bp.set(x, y, z, `${rng.pick(['oak_log', 'birch_log', 'spruce_log'])}[axis=z]`);
  }

  // ---- interiors: Stube + kitchen downstairs, bedrooms + bath upstairs, storage in the attic
  const keepOn = (F) => [...hall.cells, ...(hall.ends[F] ?? []), [cx, iz2], [cx, iz1], [cx - 1, zp - 1], [cx - 1, zp + 1], [cx, zp - 1], [cx, zp + 1]];
  const front = (F) => ({ x1: ix1, z1: zp + 1, x2: roomX2, z2: iz2, y: F + 1, h: 3 });
  const back = (F) => ({ x1: ix1, z1: iz1, x2: roomX2, z2: zp - 1, y: F + 1, h: 3 });
  furnish(bp, rng, front(0), 'stube', keepOn(0), inner.name);
  furnish(bp, rng, back(0), 'kitchen', [...keepOn(0), [sx, iz1 + 1]], inner.name, { table: false });
  for (let u = 1; u <= nUp; u++) {
    const F = planes[u];
    const keep = [...keepOn(F), [cx, iz1 + 1], [cx, iz1]];
    furnish(bp, rng, front(F), u === 1 ? 'bedroom' : 'twin', keep, inner.name);
    furnish(bp, rng, back(F), u === 1 ? 'bath' : 'office', keep, inner.name);
  }
  light(bp, { x1: ix2 - 1, z1: iz1, x2: ix2, z2: iz2, y: 1, h: 3 });
  furnish(bp, rng, { x1: ix1 + 1, z1: iz1, x2: ix2 - 1, z2: iz2, y: yTop + 1, h: 2 }, 'storage', [[cx, iz1], [cx, iz1 + 1], [cx, iz2], [cx, iz2 - 1]], inner.name, { items: ['barrel', 'chest', 'barrel'] });

  // ---- garden
  const pathKind = rng.pick(['dirt_path', 'gravel', 'stones']);
  for (let z = z2 + 2; z <= 16; z++) bp.set(cx, 0, z, pathKind === 'stones' ? (z % 2 ? 'cobblestone' : 'mossy_cobblestone') : pathKind);
  bench(bp, cx + 2, z2 + 1, 'north', 2, trimW.name);
  for (let x = x1; x <= cx - 2; x++) bp.setIfEmpty(x, 1, z2 + 1, rng.pick(BOX_FLOWERS));
  const fenceStyle = rng.weighted([['picket', 5], ['none', 2], ['stone', 1.5]]);
  if (fenceStyle === 'picket') plotFence(bp, [cx], trimW.fence, trimW.gate, { back: false, fromZ: z2 - 2 });
  if (fenceStyle === 'stone') for (let x = 0; x <= 16; x++) if (x !== cx) bp.setIfEmpty(x, 1, 16, 'cobblestone_wall');
  for (let z = z1 + 1; z <= z2 - 1; z++) {
    bp.setIfEmpty(x1 - 1, 1, z, `${rng.pick(['oak_log', 'birch_log', 'spruce_log'])}[axis=x]`);
    if (rng.chance(0.7) && !/glass/.test(bp.get(x1, 2, z) ?? '')) bp.setIfEmpty(x1 - 1, 2, z, `${rng.pick(['oak_log', 'birch_log', 'spruce_log'])}[axis=x]`);
  }
  if (rng.chance(0.6)) flagPole(bp, rng.chance(0.5) ? 1 : 15, 15, 6);
  if (x1 >= 3 && !leanTo && !sideDeck) spruce(bp, 15, z1 + 1, rng.int(6, 8), 1);
  if (rng.chance(0.6)) {
    const crop = rng.pick(['carrots[age=7]', 'potatoes[age=7]', 'wheat[age=7]', 'beetroots[age=3]']);
    for (let z = z2 + 4; z <= 15; z++)
      for (let x = 1; x <= 2; x++)
        if (!bp.get(x, 1, z)) {
          bp.set(x, 0, z, 'farmland[moisture=7]');
          bp.set(x, 1, z, crop);
        }
  }
  sprinkleFlowers(bp, rng, 1, z2 + 4, 15, 15, 0.15);
  if (rng.chance(0.5)) bp.mirrorX();
  return bp;
}

// ================================================================ old town (Bern / Lucerne / Stein am Rhein)

const SHOPS = [
  ['UHREN', '& SCHMUCK'], ['KAESE', 'FROMAGERIE'], ['SCHOKOLADE', 'CHOCOLATIER'], ['BAECKEREI', 'BOULANGERIE'], ['APOTHEKE', ''],
  ['BUCHHANDLUNG', ''], ['METZGEREI', ''], ['WEINHANDLUNG', ''], ['SPIELWAREN', ''], ['HUTMACHER', ''], ['GOLDSCHMIED', ''],
];

function oldTownPalette(rng, style, plasterList = PLASTERS) {
  const plaster = style === 'fachwerk' ? rng.pick(['calcite', 'calcite', 'white_terracotta', 'mushroom_stem']) : rng.weighted(plasterList);
  let trimKey = style === 'lauben' ? rng.pick(['tuff', 'tuffb', 'sand', 'stone']) : rng.pick(['quartz', 'sand', 'andesite', 'diorite', 'quartz']);
  if (TRIMS[trimKey].block === plaster || (/calcite|mushroom/.test(plaster) && /quartz|diorite/.test(trimKey))) trimKey = rng.pick(['stone', 'andesite', 'tuff']);
  return {
    style,
    plaster,
    trim: TRIMS[trimKey],
    shutter: rng.chance(style === 'lauben' ? 0.45 : 0.85) ? rng.weighted(SHUTTERS) : null,
    roof: ROOFS[rng.weighted([['tile', 4], ['clay', 2], ['granite', 1.5], ['slate', 1.5], ['resin', 0.6]])],
    beam: WOOD(rng.pick(['dark_oak', 'dark_oak', 'spruce'])),
    eave: WOOD(rng.pick(['dark_oak', 'spruce'])),
    box: rng.pick(['spruce_trapdoor', 'dark_oak_trapdoor', 'mangrove_trapdoor']),
    inner: WOOD(rng.pick(['spruce', 'oak', 'birch', 'dark_oak'])),
  };
}

/** Front window columns for an old-town facade: [{x, w, sh}]. Shuttered windows get room for their shutters. */
function windowLayout(x1, x2, shutters) {
  const cx = (x1 + x2) >> 1;
  const W = x2 - x1 + 1;
  if (W >= 13) {
    if (shutters) return [cx - 4, cx, cx + 4].map((x) => ({ x, w: 1, sh: true }));
    return [cx - 4, cx - 2, cx, cx + 2, cx + 4].map((x) => ({ x, w: 1, sh: false }));
  }
  if (!shutters) return [cx - 3, cx, cx + 3].map((x) => ({ x, w: 1, sh: false }));
  return [{ x: cx - 3, w: 1, sh: true }, { x: cx, w: 1, sh: false }, { x: cx + 3, w: 1, sh: true }];
}

/** Small gable dormer on a roof slope descending towards +z; front wall at zf. */
function dormer(bp, at, x, zf, wallB, mat) {
  const c = at(x, zf);
  if (!c) return;
  const yb = c.y;
  bp.set(x - 1, yb, zf, wallB);
  bp.set(x + 1, yb, zf, wallB);
  bp.set(x, yb, zf, 'glass_pane');
  bp.set(x, yb + 1, zf, wallB);
  for (let z = zf - 1; z <= zf + 1; z++) {
    bp.set(x - 1, yb + 1, z, `${mat.stairs}[facing=east,half=bottom]`);
    bp.set(x + 1, yb + 1, z, `${mat.stairs}[facing=west,half=bottom]`);
    bp.set(x, yb + 2, z, `${mat.slab}[type=bottom]`);
  }
}

/**
 * Upper storeys, stair hall, flats and roof of an old-town house. The ground storey (rows 1..g) is drawn by the caller.
 * The stair hall runs along the back wall (two lanes), flights alternate; every upper floor is one flat:
 * kitchen-living along the facade, bedroom with bath behind, hall in front of the stairs; ladder to the attic.
 * Returns { at, wallTop, cx, hall, planes }.
 */
function oldTownBody(bp, rng, o) {
  const { x1, x2, z1, z2, floors, P, gableFront, oriel = false, boxes = true, noLow = false, g = 3 } = o;
  const winX = o.winX ?? windowLayout(x1, x2, !!P.shutter);
  const cx = (x1 + x2) >> 1;
  const ix1 = x1 + 1, ix2 = x2 - 1, iz1 = z1 + 1, iz2 = z2 - 1;
  const yb = (f) => g + 1 + 4 * f;
  const wallTop = g + 4 * floors;
  const planes = [0, ...Array.from({ length: floors }, (_, f) => yb(f))];
  const fach = P.style === 'fachwerk';
  const isCorner = (x, z) => (x === x1 || x === x2) && (z === z1 || z === z2);
  const posts = new Set([x1, x2]);
  for (let i = 1; i < winX.length; i++) posts.add((winX[i - 1].x + winX[i - 1].w + winX[i].x) >> 1);
  const zc = (z1 + z2) >> 1;
  const wallFn = (x, y, z) => {
    const row = (y - g - 1) % 4;
    const f = (y - g - 1) >> 2;
    const ax = z === z1 || z === z2 ? 'x' : 'z';
    if (fach) {
      if (isCorner(x, z)) return `${P.beam.log}[axis=y]`;
      if (row === 0) return `${P.beam.log}[axis=${ax}]`;
      if (ax === 'x' ? posts.has(x) : z === zc) return `${P.beam.log}[axis=y]`;
      return P.plaster;
    }
    if (row === 0 && f === 0) return P.trim.block;
    if (isCorner(x, z)) return P.style === 'lauben' || y % 2 === 0 ? P.trim.block : P.plaster;
    return P.plaster;
  };
  for (let f = 0; f < floors; f++) {
    bp.walls(x1, yb(f), z1, x2, yb(f) + 3, z2, wallFn);
    bp.fill(ix1, yb(f), iz1, ix2, yb(f), iz2, P.inner.planks);
  }
  bp.fill(ix1, wallTop + 1, iz1, ix2, wallTop + 1, iz2, 'spruce_planks');

  // Stair hall along the back wall: lane B against the wall, lane A in front of it; ladder to the attic.
  const hall = stairHall(bp, { axis: 'x', laneA: [iz1 + 1], laneB: [iz1], u0: ix2, dir: -1, planes, wood: P.inner.name });
  const hallU = Math.min(...hall.cells.map(([x]) => x));
  const zp = iz1 + 3; // wall between hall/bedroom and the front living-kitchen
  const bw = hallU - 1; // bedroom wall
  const ladderX = cx;
  const ladderZ = zp - 1;

  // Windows.
  const oTop = oriel && floors >= 2 ? floors - 2 : -1;
  const lintel = (ax) => (fach ? `${P.beam.log}[axis=${ax}]` : P.trim.block);
  const sill = fach ? P.beam.stairs : undefined;
  const sideZ = [z1 + 2, z2 - 2];
  for (let f = 0; f < floors; f++) {
    const y = yb(f) + 1;
    for (const { x, w, sh } of winX) {
      const inOriel = oTop >= 0 && Math.abs(x - cx) <= 1 && f <= oTop + 1;
      const low = noLow && f === 0;
      win(bp, rng, x, y, z2, 'south', {
        w, h: 2, lintel: lintel('x'), shutters: inOriel || !sh ? null : P.shutter, frame: !fach && !sh && !inOriel && P.style === 'painted' && winX.length <= 3 ? P.trim.block : undefined,
        box: !inOriel && !low && boxes && f <= 1 ? P.box : undefined, sill: inOriel || low ? undefined : sill,
      });
      if (Math.abs(x - cx) >= 2 && Math.abs(x - bw) >= 1 && x + w - 1 !== bw) win(bp, rng, x, y, z1, 'north', { w, h: 2, lintel: lintel('x'), shutters: sh ? P.shutter : null, sill });
    }
    for (const z of sideZ) {
      win(bp, rng, x1, y, z, 'west', { h: 2, lintel: lintel('z'), shutters: P.shutter, sill });
      win(bp, rng, x2, y, z, 'east', { h: 2, lintel: lintel('z'), shutters: P.shutter, sill });
    }
  }
  // Oriel (Erker): a glazed bay in front of the centre window.
  if (oTop >= 0) {
    for (let f = 0; f <= oTop; f++)
      for (let x = cx - 1; x <= cx + 1; x++) {
        bp.set(x, yb(f), z2 + 1, fach ? `${P.beam.log}[axis=x]` : P.trim.block);
        bp.set(x, yb(f) + 1, z2 + 1, x === cx ? 'glass_pane' : P.plaster);
        bp.set(x, yb(f) + 2, z2 + 1, x === cx ? 'glass_pane' : P.plaster);
        bp.set(x, yb(f) + 3, z2 + 1, fach ? `${P.beam.log}[axis=x]` : P.trim.block);
      }
    for (let f = 0; f <= oTop; f++) for (const y of [yb(f) + 1, yb(f) + 2]) bp.set(cx, y, z2, null);
    for (let x = cx - 1; x <= cx + 1; x++) {
      bp.set(x, yb(0) - 1, z2 + 1, x === cx ? `${P.trim.slab}[type=top]` : `${P.trim.stairs}[facing=north,half=top]`);
      bp.set(x, yb(oTop + 1), z2 + 1, `${ROOFS.copper.stairs}[facing=north,half=bottom]`);
    }
  }

  // Roof.
  const trim = { stairs: P.eave.stairs, slab: P.eave.slab };
  let at;
  if (!gableFront) {
    at = roof(bp, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 1, y: wallTop, mat: P.roof, w: INF, e: INF, trim, brackets: P.eave.stairs });
    closeUnder(bp, at, perimeter(x1, z1, x2, z2), wallTop + 1, fach ? (x, y, z) => (z === zc ? `${P.beam.log}[axis=y]` : P.plaster) : P.plaster, P.roof);
    const gz = zc === zp + 1 ? zc + 1 : zc;
    for (const x of [x1, x2]) if (at(x, gz).y - wallTop >= 4) win(bp, rng, x, wallTop + 2, gz, x === x1 ? 'west' : 'east', { h: 2, shutters: P.shutter });
    const dx = x2 - x1 >= 10 ? [cx - 3, cx + 3] : [cx];
    for (const x of dx) dormer(bp, at, x, z2 - 1, P.plaster, P.roof);
  } else {
    at = roof(bp, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 1, y: wallTop, mat: P.roof, n: INF, s: INF, trim, brackets: P.eave.stairs });
    closeUnder(bp, at, perimeter(x1, z1, x2, z2), wallTop + 1,
      fach ? (x, y, z) => (x === cx ? `${P.beam.log}[axis=y]` : y === wallTop + 3 ? `${P.beam.log}[axis=x]` : P.plaster) : P.plaster, P.roof);
    for (const z of [z1, z2]) {
      const face = z === z2 ? 'south' : 'north';
      for (const x of [cx - 2, cx + 2]) if (at(x, z).y - wallTop >= 4) win(bp, rng, x, wallTop + 2, z, face, { h: 2, shutters: P.shutter, lintel: lintel('x') });
      if (at(cx, z).y - wallTop >= 6) win(bp, rng, cx, wallTop + 4, z, face, { h: 1, lintel: lintel('x') });
    }
  }
  // Flats: kitchen stoves stacked under one chimney at the west wall.
  const stoveZ = zp + 1;
  for (let f = 0; f < floors; f++) {
    const F = yb(f);
    const y = F + 1;
    partition(bp, ix1, zp, ix2, zp, y, 3, P.inner.planks, [[ix1 + 2, zp, true], [ix2 - 1, zp, true]], P.inner.door);
    partition(bp, bw, iz1, bw, zp - 1, y, 3, P.inner.planks, [[bw, zp - 1]], P.inner.door);
    bp.set(ix1, y, stoveZ, 'smoker[facing=east,lit=true]');
    bp.set(ix1, y + 1, stoveZ, 'bricks');
    bp.set(ix1, y + 2, stoveZ, 'bricks');
    const keep = [...hall.cells, ...(hall.ends[F] ?? []), [ladderX, ladderZ], [ix1 + 2, zp - 1], [ix1 + 2, zp + 1], [ix2 - 1, zp - 1], [ix2 - 1, zp + 1], [bw - 1, zp - 1], [bw + 1, zp - 1], [ix1 + 1, stoveZ], [cx, iz2]];
    furnish(bp, rng, { x1: ix1, z1: zp + 1, x2: ix2, z2: iz2, y, h: 3 }, 'kitchen', keep, P.inner.name, { items: ['sink', 'counter', 'counter', 'crafting', 'sofa', 'bookshelf', 'plant', 'chest'], table: true });
    furnish(bp, rng, { x1: ix1, z1: iz1, x2: bw - 1, z2: zp - 1, y, h: 3 }, 'bedroom', keep, P.inner.name, { items: ['bed', 'tub', 'chest', 'toilet', 'wardrobe', 'plant'] });
    light(bp, { x1: bw + 1, z1: zp - 1, x2: ix2 - 1, z2: zp - 1, y, h: 3 });
  }
  ladderUp(bp, ladderX, ladderZ, 'north', planes[planes.length - 1] + 1, wallTop + 1);
  bp.fill(ix1, wallTop + 2, stoveZ, ix1, Math.max(wallTop + 2, at(ix1, stoveZ).y + 1), stoveZ, 'bricks');
  for (let f = 0; f < floors; f++) bp.set(ix1, yb(f), stoveZ, 'bricks');
  bp.set(ix1, wallTop + 1, stoveZ, 'bricks');
  bp.set(ix1, at(ix1, stoveZ).y + 2, stoveZ, rng.chance(0.6) ? 'campfire[lit=true,signal_fire=false]' : 'brick_slab[type=bottom]');
  // Attic storage.
  furnish(bp, rng, { x1: ix1 + 2, z1: iz1 + 1, x2: ix2 - 1, z2: iz2 - 1, y: wallTop + 2, h: 2 }, 'storage', [[ladderX, ladderZ], [ladderX - 1, ladderZ]], 'spruce', { items: ['barrel', 'chest', 'barrel'] });
  // Flag on the corner under the eaves.
  const [base, data] = rng.chance(0.5) ? ['red', SWISS_FLAG] : rng.pick(CANTONS);
  if (!bp.get(x1, wallTop - 1, z2 + 1) && !bp.get(x1, wallTop - 2, z2 + 1)) bp.set(x1, wallTop - 1, z2 + 1, `${base}_wall_banner[facing=south]${data}`);
  return { at, wallTop, cx, hall, planes, ix1, ix2, iz1, iz2 };
}

// ---------------------------------------------------------------- townhouse

export function townhouse(rng) {
  const bp = new Blueprint();
  const style = rng.weighted([['lauben', 4], ['painted', 4], ['fachwerk', 2]]);
  const P = oldTownPalette(rng, style);
  const x1 = 2;
  const x2 = 14;
  const cx = 8;
  const z1 = rng.pick([2, 3]);
  const z2 = 12;
  const ix1 = x1 + 1, ix2 = x2 - 1, iz1 = z1 + 1;
  const floors = rng.pick([2, 3, 3]);
  const gableFront = style !== 'lauben' && rng.chance(0.45);
  const isCorner = (x, z) => (x === x1 || x === x2) && (z === z1 || z === z2);
  const [shopA, shopB] = rng.pick(SHOPS);
  const wood = P.inner.name;

  bp.fill(x1, 0, z1, x2, 0, z2, 'polished_andesite');
  bp.fill(ix1, 0, iz1, ix2, 0, z2 - 1, `${wood}_planks`);
  let shopZ = z2;
  if (style === 'lauben') {
    // Arcade (Lauben): sandstone arches in front, shop front set back three blocks.
    shopZ = z2 - 3;
    bp.walls(x1, 1, z1, x2, 3, shopZ, P.trim.block);
    for (let z = shopZ + 1; z <= z2; z++) {
      bp.set(x1, 3, z, P.trim.block);
      bp.set(x2, 3, z, P.trim.block);
      for (let x = x1; x <= x2; x++) bp.set(x, 0, z, (x + z) % 2 ? 'polished_andesite' : 'stone_bricks');
    }
    bp.fill(x1, 1, z2, x1, 2, z2, P.trim.block);
    bp.fill(x2, 1, z2, x2, 2, z2, P.trim.block);
    bp.set(x1, 2, z2 - 1, `${P.trim.stairs}[facing=north,half=top]`);
    bp.set(x2, 2, z2 - 1, `${P.trim.stairs}[facing=north,half=top]`);
    bp.set(x1, 2, shopZ + 1, `${P.trim.stairs}[facing=south,half=top]`);
    bp.set(x2, 2, shopZ + 1, `${P.trim.stairs}[facing=south,half=top]`);
    bp.fill(x1, 3, z2, x2, 3, z2, P.trim.block);
    for (const p of [x1, cx - 2, cx + 2, x2]) {
      bp.fill(p, 1, z2, p, 2, z2, P.trim.block);
      if (p > x1) bp.set(p - 1, 2, z2, `${P.trim.stairs}[facing=east,half=top]`);
      if (p < x2) bp.set(p + 1, 2, z2, `${P.trim.stairs}[facing=west,half=top]`);
    }
    for (const x of [(x1 + cx - 2) >> 1, cx, (cx + 2 + x2) >> 1]) bp.set(x, 3, z2 - 1, 'lantern[hanging=true]');
    const [bb, bd] = rng.pick(CANTONS);
    bp.set(cx - 2, 2, z2 + 1, `${bb}_wall_banner[facing=south]${bd}`);
    // Shop front: framed display windows either side of the door.
    for (let x = ix1; x <= ix2; x++) bp.fill(x, 1, shopZ, x, 2, shopZ, Math.abs(x - cx) === 1 || x === cx - 4 || x === cx + 4 ? P.trim.block : 'glass_pane');
    bp.door(cx, 1, shopZ, wood, 'south');
    bp.set(cx + 2, 3, shopZ + 1, `${wood}_wall_sign[facing=south]${signData(['', shopA, shopB, ''])}`);
  } else {
    bp.walls(x1, 1, z1, x2, 3, z2, (x, y, z) => (isCorner(x, z) || y === 1 ? P.trim.block : style === 'fachwerk' && y === 3 ? `${P.beam.log}[axis=${z === z1 || z === z2 ? 'x' : 'z'}]` : P.plaster));
    const w = cx - 2 - (x1 + 1) + 1;
    win(bp, rng, x1 + 1, 2, z2, 'south', { w, h: 2 });
    win(bp, rng, cx + 2, 2, z2, 'south', { w, h: 2 });
    doorway(bp, cx, 1, z2, 'south', wood, { frame: P.trim.block, transom: 'glass_pane' });
    bp.set(cx, 0, z2 + 1, `${P.trim.slab}[type=top]`);
    bp.set(x2, 3, z2 + 1, `${wood}_wall_hanging_sign[facing=east]${signData([shopA, shopB, '', ''])}`);
    for (const x of [x1 + 1, x2 - 1]) bp.set(x, 1, z2 + 1, rng.pick(['barrel[facing=up]', 'decorated_pot[facing=south]', 'potted_azalea_bush']));
    win(bp, rng, x1, 2, z2 - 2, 'west', { h: 2, shutters: P.shutter });
    win(bp, rng, x2, 2, z2 - 2, 'east', { h: 2, shutters: P.shutter });
  }
  win(bp, rng, cx - 4, 2, z1, 'north', { h: 2, shutters: P.shutter });

  const body = oldTownBody(bp, rng, { x1, x2, z1, z2, floors, P, gableFront, oriel: floors >= 2 && rng.chance(0.55) });
  // Shop: counter, shelves, goods; keep the way to the stairs free.
  const keep = [...body.hall.cells, ...(body.hall.ends[0] ?? []), [cx, shopZ - 1], [ix2, iz1 + 2]];
  furnish(bp, rng, { x1: ix1, z1: iz1, x2: ix2, z2: shopZ - 1, y: 1, h: 3 }, 'shop', keep, wood);

  // Street in front: paving, planters, lamp.
  bp.fill(0, 0, z2 + 1, 16, 0, 16, paving(rng));
  if (style !== 'lauben') bp.set(cx, 0, z2 + 1, `${P.trim.slab}[type=top]`);
  planter(bp, 1, 15, wood);
  planter(bp, 15, 15, wood);
  if (rng.chance(0.6)) lamp(bp, rng.pick([4, 12]), 15, 3, 'simple');
  sprinkleFlowers(bp, rng, 0, 0, 16, z1 - 2, 0.1);
  if (rng.chance(0.5)) bp.mirrorX();
  return bp;
}

// ---------------------------------------------------------------- café / Konditorei

export function cafe(rng) {
  const bp = new Blueprint();
  const style = rng.weighted([['painted', 5], ['fachwerk', 1.5]]);
  const P = oldTownPalette(rng, style, [['pink_terracotta', 3], ['white_terracotta', 3], ['calcite', 2], ['smooth_sandstone', 2], ['lime_terracotta', 1], ['light_blue_terracotta', 0.4], ['yellow_terracotta', 1.2]]);
  const W = 13;
  const x1 = (INNER - W) >> 1;
  const x2 = x1 + W - 1;
  const cx = 8;
  const z1 = 1;
  const z2 = 10;
  const ix1 = x1 + 1, ix2 = x2 - 1, iz1 = z1 + 1, iz2 = z2 - 1;
  const floors = rng.pick([1, 2, 2]);
  const wood = rng.pick(['spruce', 'dark_oak', 'cherry']);
  P.inner = WOOD(wood);
  const [colA, colB] = rng.pick([['red', 'white'], ['green', 'white'], ['pink', 'white'], ['blue', 'white'], ['yellow', 'white'], ['brown', 'yellow']]);
  const name = rng.pick(['CAFE', 'KONDITOREI', 'CONFISERIE', 'TEA ROOM']);
  const owner = rng.pick(['Spruengli', 'Bachmann', 'Huber', 'Steiner', 'Meier', 'Brunner', 'Keller', 'Frey']);
  const isCorner = (x, z) => (x === x1 || x === x2) && (z === z1 || z === z2);

  // Tall shop storey (4 rows) with big display windows.
  bp.fill(x1, 0, z1, x2, 0, z2, 'polished_andesite');
  bp.fill(ix1, 0, iz1, ix2, 0, iz2, (x, y, z) => ((x + z) % 2 ? 'white_concrete' : 'black_concrete'));
  bp.walls(x1, 1, z1, x2, 4, z2, (x, y, z) => (isCorner(x, z) || y === 1 ? P.trim.block : P.plaster));
  const w = cx - 2 - (x1 + 1) + 1;
  win(bp, rng, x1 + 1, 2, z2, 'south', { w, h: 2, lintel: P.trim.block });
  win(bp, rng, cx + 2, 2, z2, 'south', { w, h: 2, lintel: P.trim.block });
  doorway(bp, cx, 1, z2, 'south', wood, { frame: P.trim.block, transom: 'glass_pane' });
  bp.set(cx, 0, z2 + 1, `${P.trim.slab}[type=top]`);
  win(bp, rng, x1, 2, iz2 - 1, 'west', { h: 2, w: 2 });
  win(bp, rng, x2, 2, iz2 - 1, 'east', { h: 2, w: 2 });
  // Striped awnings over both windows; shop sign above the door.
  for (let x = x1; x <= x2; x++) {
    if (Math.abs(x - cx) <= 1) continue;
    const c = x % 2 ? colA : colB;
    bp.set(x, 4, z2 + 1, `${wood}_trapdoor[facing=south,half=top]`);
    bp.set(x, 5, z2 + 1, `${c}_carpet`);
    bp.set(x, 3, z2 + 2, `${wood}_trapdoor[facing=south,half=top]`);
    bp.set(x, 4, z2 + 2, `${c}_carpet`);
  }
  bp.set(cx, 4, z2 + 1, `${wood}_wall_sign[facing=south]${signData(['', name, owner, ''], 'brown')}`);
  wallLamp(bp, cx - 1, 4, z2, 'south', `${wood}_fence`);
  wallLamp(bp, cx + 1, 4, z2, 'south', `${wood}_fence`);

  const body = oldTownBody(bp, rng, { x1, x2, z1, z2, floors, P, gableFront: rng.chance(0.5), noLow: true, g: 4 });
  if (!bp.get(x1, 7, z2 + 1) && !bp.get(x1, 6, z2 + 1)) bp.set(x1, 7, z2 + 1, `${wood}_wall_hanging_sign[facing=west]${signData(['', name, '', ''])}`);
  // Café hall: cakes in the window, counter with cakes in front of the stairs, tables with chairs.
  const hallZ = Math.max(...body.hall.cells.map(([, z]) => z));
  const hallX1 = Math.min(...body.hall.cells.map(([x]) => x));
  for (let x = ix1; x <= ix2; x++) {
    if (Math.abs(x - cx) <= 1) continue;
    bp.set(x, 1, iz2, 'smooth_quartz_slab[type=top]');
    bp.set(x, 2, iz2, rng.chance(0.6) ? 'cake' : rng.pick(['candle[candles=3,lit=true]', 'potted_red_tulip', 'decorated_pot[facing=south]']));
  }
  for (let x = ix1; x < hallX1 - 1; x++) {
    bp.set(x, 1, iz1, x === ix1 ? 'smoker[facing=south,lit=true]' : 'smooth_quartz_slab[type=top]');
    if (x > ix1) bp.set(x, 2, iz1, rng.chance(0.6) ? 'cake' : 'candle[candles=2,lit=true]');
    bp.set(x, 1, iz1 + 1, x === ix1 + 1 ? 'water_cauldron[level=3]' : `${wood}_shelf[facing=south]`);
  }
  const tables = [];
  for (let x = ix1 + 1; x <= ix2 - 1; x += 4) tables.push([x, hallZ + 3]);
  for (const [tx, tz] of tables) {
    if (tz >= iz2 - 1 || bp.get(tx, 1, tz)) continue;
    bp.set(tx, 1, tz, `${wood}_fence`);
    bp.set(tx, 2, tz, 'white_carpet');
    for (const f of ['east', 'west']) bp.setIfEmpty(tx + DIR[f][0], 1, tz, `${wood}_stairs[facing=${f},half=bottom]`);
  }
  for (let x = ix1 + 2; x <= ix2 - 2; x += 4) light(bp, { x1: x, z1: hallZ + 4, x2: x, z2: hallZ + 4, y: 1, h: 4 });

  // Terrace with parasols.
  bp.fill(0, 0, z2 + 1, 16, 0, 16, (x, y, z) => ((x + z) % 3 === 0 ? 'polished_andesite' : 'stone_bricks'));
  bp.set(cx, 0, z2 + 1, `${P.trim.slab}[type=top]`);
  const terrace = [[2, 14], [14, 14], ...(W === 11 ? [[8, 15]] : [])];
  for (const [tx, tz] of terrace) {
    bp.fill(tx, 1, tz, tx, 3, tz, `${wood}_fence`);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const c = (dx + dz + 2) % 2 ? colA : colB;
        if (dx || dz) bp.set(tx + dx, 4, tz + dz, `${wood}_trapdoor[facing=south,half=top]`);
        else bp.set(tx, 4, tz, `${c}_wool`);
        bp.set(tx + dx, 5, tz + dz, `${c}_carpet`);
      }
    for (const f of ['east', 'west']) if (inPlot(tx + DIR[f][0], tz)) bp.setIfEmpty(tx + DIR[f][0], 1, tz, `${wood}_stairs[facing=${f},half=bottom]`);
  }
  bp.set(cx + 3, 1, z2 + 4, `${wood}_sign[rotation=0]${signData(['Kaffee', 'Kuchen', 'Torten', 'Glace'], 'brown')}`);
  for (const x of [1, 15]) for (let z = z2 + 3; z <= 15; z += 4) if (!bp.get(x, 1, z) && !bp.get(x, 4, z)) planter(bp, x, z, wood, rng.pick(['flowering_azalea', 'azalea']));
  sprinkleFlowers(bp, rng, 0, 0, 16, z1 - 2, 0.12);
  if (rng.chance(0.5)) bp.mirrorX();
  return bp;
}

// ================================================================ church (Reformed / Romanesque, copper spire)

const GLASS_COLOURS = ['blue', 'light_blue', 'yellow', 'orange', 'red', 'purple', 'lime', 'cyan', 'magenta'];

/** Clock dial 3x3 (or 5x5 with a golden ring) set into a wall facing `face`, centred on (x, y, z). Shows ten past twelve. */
function clockFace(bp, x, y, z, face, big = false) {
  const [ax, az] = along(face);
  const sgn = face === 'south' || face === 'west' ? 1 : -1; // keep the hands readable from outside
  const r = big ? 2 : 1;
  for (let i = -r; i <= r; i++)
    for (let j = -r; j <= r; j++) {
      let b = big ? 'blue_concrete' : 'white_concrete';
      if (Math.abs(i) === 2 || Math.abs(j) === 2) b = i === 0 || j === 0 ? 'gold_block' : Math.abs(i) === 2 && Math.abs(j) === 2 ? null : 'black_concrete';
      else if (i === 0 && j === 0) b = 'gold_block';
      else if (i === 0 && j === 1) b = big ? 'gold_block' : 'black_concrete';
      else if (i === sgn && j === 0) b = big ? 'yellow_concrete' : 'black_concrete';
      if (b) bp.set(x + ax * i, y + j, z + az * i, b);
    }
}

/** Square tower with belfry, clock faces and a spire. Returns the top y of the walls. */
function tower(bp, rng, o) {
  const { x1, z1, size = 5, h, front = 'south', wall, quoin, spire, roofMat, bellFloor = true, clock = true, door, ladder = true } = o;
  const x2 = x1 + size - 1;
  const z2 = z1 + size - 1;
  const cx = x1 + (size >> 1);
  const cz = z1 + (size >> 1);
  const corner = (x, z) => (x === x1 || x === x2) && (z === z1 || z === z2);
  bp.fill(x1, 0, z1, x2, 0, z2, 'polished_andesite');
  bp.walls(x1, 1, z1, x2, h, z2, (x, y, z) => (corner(x, z) || y <= 2 || y === h ? quoin() : typeof wall === 'function' ? wall() : wall));
  // Belfry with bell.
  const bf = h - 4;
  bp.fill(x1 + 1, bf, z1 + 1, x2 - 1, bf, z2 - 1, 'spruce_planks');
  for (const [x, z, f] of [[cx, z1, 'north'], [cx, z2, 'south'], [x1, cz, 'west'], [x2, cz, 'east']]) {
    bp.fill(x, bf + 1, z, x, bf + 2, z, null);
    bp.set(x, bf + 3, z, quoin());
    const [ax, az] = along(f);
    bp.set(x - ax, bf + 2, z - az, `stone_brick_stairs[facing=${alongDir(f) === 'east' ? 'west' : 'north'},half=top]`);
    bp.set(x + ax, bf + 2, z + az, `stone_brick_stairs[facing=${alongDir(f)},half=top]`);
  }
  bp.set(cx, h - 1, cz, 'dark_oak_planks');
  bp.set(cx, h - 2, cz, 'bell[attachment=ceiling,facing=south]');
  // Ladder in the corner up to the bell floor, lantern at the top.
  if (ladder) {
    ladderUp(bp, x1 + 1, z1 + 1, 'east', 1, bf);
    bp.set(x2 - 1, bf + 3, z2 - 1, 'lantern[hanging=true]');
    bp.set(x2 - 1, bf + 4, z2 - 1, 'dark_oak_planks');
  }
  if (clock) {
    clockFace(bp, cx, bf - 3, z2, 'south');
    clockFace(bp, cx, bf - 3, z1, 'north');
    clockFace(bp, x1, bf - 3, cz, 'west');
    clockFace(bp, x2, bf - 3, cz, 'east');
  }
  // Narrow slit windows.
  for (let y = 4; y < bf - 5; y += 4) {
    bp.set(cx, y, z2, 'glass_pane');
    bp.set(cx, y + 1, z2, 'glass_pane');
    if (!bp.get(x1 - 1, y, cz)) bp.set(x1, y, cz, 'glass_pane');
    if (!bp.get(x2 + 1, y, cz)) bp.set(x2, y, cz, 'glass_pane');
  }
  if (door) {
    bp.door(cx, 1, z2, 'dark_oak', 'south');
    bp.set(cx, 3, z2, 'yellow_stained_glass_pane');
    bp.set(cx - 1, 3, z2 + 1, 'stone_brick_stairs[facing=west,half=top]');
    bp.set(cx + 1, 3, z2 + 1, 'stone_brick_stairs[facing=east,half=top]');
    bp.fill(cx - 1, 1, z2 + 1, cx - 1, 2, z2 + 1, 'stone_brick_wall');
    bp.fill(cx + 1, 1, z2 + 1, cx + 1, 2, z2 + 1, 'stone_brick_wall');
    bp.set(cx, 4, z2 + 1, 'stone_brick_slab[type=bottom]');
  }
  // Spire.
  const y0 = h + 1;
  if (spire === 'needle') {
    // Broach spire: 5x5 skirt, octagonal 3x3 shaft, slim needle.
    for (let x = x1; x <= x2; x++)
      for (let z = z1; z <= z2; z++) {
        if (corner(x, z)) continue;
        const edge = x === x1 ? 'east' : x === x2 ? 'west' : z === z1 ? 'south' : z === z2 ? 'north' : null;
        bp.set(x, y0, z, edge ? `${roofMat.stairs}[facing=${edge},half=bottom]` : roofMat.block);
      }
    for (const [x, z] of [[x1, z1], [x1, z2], [x2, z1], [x2, z2]]) {
      bp.set(x, y0, z, 'stone_brick_wall');
      bp.set(x, y0 + 1, z, 'waxed_oxidized_lightning_rod[facing=up]');
    }
    for (let y = y0 + 1; y <= y0 + 3; y++)
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) bp.set(cx + dx, y, cz + dz, roofMat.block);
    for (const [dx, dz, f] of [[-1, -1, 'south'], [1, -1, 'west'], [-1, 1, 'east'], [1, 1, 'north']]) bp.set(cx + dx, y0 + 1, cz + dz, `${roofMat.stairs}[facing=${f},half=bottom]`);
    for (const f of Object.keys(DIR)) bp.set(cx + DIR[f][0], y0 + 4, cz + DIR[f][1], `${roofMat.stairs}[facing=${OPP[f]},half=bottom]`);
    bp.fill(cx, y0 + 4, cz, cx, y0 + 8, cz, roofMat.block);
    for (const f of Object.keys(DIR)) bp.set(cx + DIR[f][0], y0 + 7, cz + DIR[f][1], `${roofMat.stairs}[facing=${OPP[f]},half=top]`);
    bp.set(cx, y0 + 9, cz, 'gold_block');
    bp.set(cx, y0 + 10, cz, 'waxed_oxidized_lightning_rod[facing=up]');
  } else if (spire === 'saddle') {
    const at = roof(bp, { x1: x1, x2: x2, z1: z1 - 1, z2: z2 + 1, y: y0, mat: roofMat, kind: 'steep', n: INF, s: INF });
    for (const [x, z] of perimeter(x1, z1, x2, z2)) {
      const c = at(x, z);
      for (let y = y0; y < c.y - 1; y++) bp.setIfEmpty(x, y, z, typeof wall === 'function' ? wall() : wall);
    }
    bp.set(cx, y0 + 1, z2, 'glass_pane');
    bp.set(cx, y0 + 1, z1, 'glass_pane');
    bp.set(cx, at(cx, cz).y + 1, cz, 'waxed_oxidized_lightning_rod[facing=up]');
  } else {
    // Baroque onion dome.
    bp.fill(x1, y0, z1, x2, y0, z2, `${roofMat.slab}[type=bottom]`);
    bp.fill(x1 + 1, y0, z1 + 1, x2 - 1, y0 + 1, z2 - 1, roofMat.block);
    for (let y = y0 + 2; y <= y0 + 3; y++)
      for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) if (!corner(x, z)) bp.set(x, y, z, roofMat.block);
    for (let x = x1; x <= x2; x++)
      for (let z = z1; z <= z2; z++) {
        if (corner(x, z) || (x > x1 && x < x2 && z > z1 && z < z2)) continue;
        const f = x === x1 ? 'east' : x === x2 ? 'west' : z === z1 ? 'south' : 'north';
        bp.set(x, y0 + 4, z, `${roofMat.stairs}[facing=${f},half=bottom]`);
      }
    bp.fill(x1 + 1, y0 + 4, z1 + 1, x2 - 1, y0 + 4, z2 - 1, roofMat.block);
    roof(bp, { x1: x1 + 1, x2: x2 - 1, z1: z1 + 1, z2: z2 - 1, y: y0 + 5, mat: roofMat });
    bp.fill(cx, y0 + 6, cz, cx, y0 + 7, cz, 'waxed_oxidized_copper_bars');
    bp.set(cx, y0 + 8, cz, 'gold_block');
    bp.set(cx, y0 + 9, cz, 'waxed_oxidized_lightning_rod[facing=up]');
  }
  return h;
}

export function church(rng) {
  const bp = new Blueprint();
  const sideTower = rng.chance(0.45);
  const nx1 = sideTower ? 6 : 4;
  const nx2 = nx1 + 8;
  const cx = nx1 + 4;
  const nz1 = 2;
  const nz2 = 11;
  const H = 7;
  const plaster = rng.pick(['calcite', 'calcite', 'white_terracotta', 'smooth_sandstone']);
  const romanesque = rng.chance(0.3);
  const stone = romanesque ? rubble(rng) : stoneMix(rng);
  const quoin = () => (romanesque ? stone() : 'stone_bricks');
  const wallB = romanesque ? stone : () => plaster;
  const roofMat = ROOFS[rng.weighted([['slate', 3], ['tile', 3], ['copper', 1.5], ['clay', 1]])];
  const spireMat = ROOFS[rng.weighted([['copper', 5], ['slate', 2], ['copperW', 1], ['tile', 1]])];
  const spire = rng.weighted([['needle', 5], ['saddle', 2.5], ['onion', 1.5]]);
  const colourful = rng.chance(0.6);
  const glass = () => (colourful ? `${rng.pick(GLASS_COLOURS)}_stained_glass_pane` : rng.pick(['white_stained_glass_pane', 'glass_pane', 'light_gray_stained_glass_pane']));
  const corner = (x, z) => (x === nx1 || x === nx2) && (z === nz1 || z === nz2);

  // Nave.
  bp.fill(nx1, 0, nz1, nx2, 0, nz2, (x, y, z) => ((x + z) % 2 ? 'polished_andesite' : 'stone_bricks'));
  bp.walls(nx1, 1, nz1, nx2, H, nz2, (x, y, z) => (corner(x, z) || y === 1 ? quoin() : wallB()));
  const inTower = (x, z) => (sideTower ? x >= 1 && x <= 5 && z >= 9 && z <= 13 : x >= 6 && x <= 10 && z >= nz2);
  for (const bz of [nz1 + 1, nz1 + 4, nz1 + 7]) {
    for (const [x, face] of [[nx1, 'west'], [nx2, 'east']]) {
      if (inTower(x + DIR[face][0], bz) || inTower(x + DIR[face][0], bz + 1)) continue;
      win(bp, rng, x, 2, bz, face, { w: 2, h: 4, glass });
      bp.set(x, 6, bz, `stone_brick_stairs[facing=north,half=top]`);
      bp.set(x, 6, bz + 1, `stone_brick_stairs[facing=south,half=top]`);
    }
  }
  for (const bz of [nz1, nz1 + 3, nz1 + 6, nz2]) {
    for (const [x, d, f] of [[nx1 - 1, -1, 'east'], [nx2 + 1, 1, 'west']]) {
      if (inTower(x, bz) || inTower(x + d, bz)) continue;
      bp.fill(x, 1, bz, x, 4, bz, 'stone_bricks');
      bp.set(x, 5, bz, `stone_brick_stairs[facing=${f},half=bottom]`);
      bp.fill(x + d, 1, bz, x + d, 2, bz, 'stone_bricks');
      bp.set(x + d, 3, bz, `stone_brick_stairs[facing=${f},half=bottom]`);
    }
  }
  const at = roof(bp, { x1: nx1 - 1, x2: nx2 + 1, z1: nz1, z2: nz2, y: H, mat: roofMat, n: INF, s: INF, trim: { stairs: 'stone_brick_stairs', slab: 'stone_brick_slab' } });
  closeUnder(bp, at, perimeter(nx1, nz1, nx2, nz2), H + 1, wallB, roofMat);
  // Rose window on the front gable, oculus on the back.
  const rose = (z, face) => {
    const yc = H + 3;
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) bp.set(cx + dx, yc + dy, z, dx || dy ? glass() : 'yellow_stained_glass_pane');
    for (const [dx, dy, f, half] of [[-1, 1, 'west', 'top'], [1, 1, 'east', 'top'], [-1, -1, 'west', 'bottom'], [1, -1, 'east', 'bottom']])
      bp.set(cx + dx, yc + dy, z, 'stone_brick_wall');
  };
  if (sideTower) rose(nz2, 'south');
  bp.set(cx, H + 2, nz1, glass());
  // Tie beams with hanging lanterns.
  for (const z of [nz1 + 2, nz1 + 5, nz1 + 8]) {
    for (let x = nx1 + 1; x < nx2; x++) bp.set(x, H, z, 'dark_oak_log[axis=x]');
    bp.set(cx - 2, H - 1, z, 'lantern[hanging=true]');
    bp.set(cx + 2, H - 1, z, 'lantern[hanging=true]');
  }

  // Choir (apse) behind the nave.
  bp.walls(cx - 2, 1, 0, cx + 2, 5, nz1, (x, y, z) => (y === 1 || ((x === cx - 2 || x === cx + 2) && z === 0) ? quoin() : wallB()));
  bp.fill(cx - 2, 0, 0, cx + 2, 0, nz1, 'polished_andesite');
  bp.fill(cx - 1, 1, nz1, cx + 1, 4, nz1, null);
  for (const x of [cx - 1, cx + 1]) bp.fill(x, 2, 0, x, 4, 0, glass());
  bp.fill(cx - 2, 2, 1, cx - 2, 4, 1, glass());
  bp.fill(cx + 2, 2, 1, cx + 2, 4, 1, glass());
  roof(bp, { x1: cx - 3, x2: cx + 3, z1: 0, z2: nz1 - 1, y: 5, mat: roofMat, s: INF, skip: (x, z) => z < 0 });
  bp.set(cx, 1, 1, 'chiseled_quartz_block');
  bp.set(cx, 2, 1, 'candle[candles=3,lit=true]');
  bp.set(cx - 1, 1, 1, 'smooth_quartz');
  bp.set(cx + 1, 1, 1, 'smooth_quartz');
  bp.set(cx - 1, 2, 1, 'candle[candles=2,lit=true]');
  bp.set(cx + 1, 2, 1, 'candle[candles=2,lit=true]');
  bp.set(cx, 4, 1, 'lantern[hanging=true]');
  bp.set(cx, 5, 1, 'stone_bricks');
  bp.set(cx - 2, 1, nz1 + 2, 'lectern[facing=south]');
  // Pews and aisle.
  // Pews either side of a three-wide central aisle.
  for (let z = nz1 + 3; z <= nz2 - 2; z += 2)
    for (let x = nx1 + 1; x < nx2; x++) if (Math.abs(x - cx) > 1) bp.set(x, 1, z, 'spruce_stairs[facing=south,half=bottom]');
  for (let z = nz1 + 1; z < nz2; z++) bp.set(cx, 1, z, 'red_carpet');

  // Bell tower.
  const th = rng.int(16, 19);
  if (sideTower) {
    tower(bp, rng, { x1: 1, z1: 9, h: th, wall: wallB, quoin, spire, roofMat: spire === 'onion' ? ROOFS.copper : spireMat, door: true });
    bp.fill(5, 1, 10, 6, 2, 11, null);
    doorway(bp, cx, 1, nz2, 'south', 'dark_oak', { frame: 'stone_bricks', lintel: 'chiseled_stone_bricks' });
    for (let z = nz2 + 1; z <= 16; z++) bp.set(cx, 0, z, 'gravel');
    for (let z = 14; z <= 16; z++) bp.set(3, 0, z, 'gravel');
  } else {
    tower(bp, rng, { x1: 6, z1: nz2, h: th, wall: wallB, quoin, spire, roofMat: spire === 'onion' ? ROOFS.copper : spireMat, door: true });
    bp.fill(cx, 1, nz2, cx, 2, nz2, null);
    for (const x of [3, 8, 13]) bp.set(x, 0, 16, 'gravel');
  }

  // Churchyard: wall, graves, trees.
  for (let i = 0; i <= 16; i++) {
    if (!sideTower) bp.setIfEmpty(0, 1, i, 'stone_brick_wall');
    if (!sideTower) bp.setIfEmpty(16, 1, i, 'stone_brick_wall');
    bp.setIfEmpty(i, 1, 0, 'stone_brick_wall');
    if ((!bp.get(i, 0, 16) || !/gravel/.test(bp.get(i, 0, 16))) && i !== 3 && i !== 13) bp.setIfEmpty(i, 1, 16, 'stone_brick_wall');
  }
  const graves = sideTower ? [[2, 2], [2, 5], [1, 7]] : [[1, 1], [15, 1], [5, 0]];
  for (const [gx, gz] of graves) {
    if (bp.get(gx, 1, gz) || bp.get(gx, 1, gz + 1)) continue;
    bp.set(gx, 1, gz, rng.pick(['stone_brick_wall', 'cobblestone_wall', 'andesite_wall', 'polished_blackstone_wall']));
    bp.set(gx, 0, gz + 1, rng.pick(['podzol', 'coarse_dirt']));
    bp.set(gx, 1, gz + 1, rng.pick(['white_tulip', 'red_tulip', 'lily_of_the_valley', 'oxeye_daisy', 'poppy']));
  }
  if (sideTower) {
    spruce(bp, 2, 7, 6, 1);
    broadTree(bp, 14, 14, 4, 2, rng.pick(['oak', 'birch']));
  } else {
    spruce(bp, 2, 13, rng.int(7, 9), 2);
    spruce(bp, 14, 13, rng.int(7, 9), 2);
    lamp(bp, 5, 15, 3);
    lamp(bp, 11, 15, 3);
  }
  sprinkleFlowers(bp, rng, 1, 1, 15, 15, 0.06);
  if (rng.chance(0.5)) bp.mirrorX();
  return bp;
}

// ================================================================ contemporary Swiss house

function modernGarden(bp, rng, { poolX, poolZ, path }) {
  const [px1, px2] = poolX;
  const [pz1, pz2] = poolZ;
  bp.fill(px1 - 1, 0, pz1 - 1, px2 + 1, 0, pz2 + 1, rng.pick(['smooth_quartz', 'pale_oak_planks', 'smooth_stone']));
  bp.fill(px1, -1, pz1, px2, -1, pz2, 'smooth_quartz');
  bp.fill(px1, 0, pz1, px2, 0, pz2, 'water');
  for (let x = px1; x < px2; x += 2) {
    if (pz1 - 3 < 0) break;
    bp.set(x, 1, pz1 - 2, 'white_bed[facing=north,part=head]');
    bp.set(x, 1, pz1 - 1, 'white_bed[facing=north,part=foot]');
  }
  for (const [x, z] of path) bp.set(x, 0, z, 'smooth_stone_slab[type=double]');
}

function modernCube(rng) {
  const bp = new Blueprint();
  const concrete = rng.pick(['white_concrete', 'white_concrete', 'smooth_quartz', 'light_gray_concrete']);
  const clad = rng.pick(['stripped_oak_log', 'stripped_spruce_log', 'stripped_pale_oak_log', 'stripped_dark_oak_log', 'stripped_birch_log']);
  const slabOf = concrete === 'smooth_quartz' ? 'smooth_quartz_slab' : 'smooth_stone_slab';
  const x1 = 2, x2 = 14, z1 = 2, z2 = 10;
  const penthouse = rng.chance(0.6);
  // Ground floor: glazed living hall around a concrete core (bath + stairs).
  bp.fill(x1, 0, z1, x2, 0, z2, 'smooth_stone');
  bp.fill(x1 + 1, 0, z1 + 1, x2 - 1, 0, z2 - 1, 'pale_oak_planks');
  bp.walls(x1, 1, z1, x2, 3, z2, 'glass');
  bp.walls(x1, 1, z1, x1 + 4, 3, z2, concrete);
  for (const [x, z] of [[x2, z1], [x2, z2], [x1 + 8, z2], [x1 + 8, z1]]) bp.fill(x, 1, z, x, 3, z, concrete);
  bp.fill(x1 + 5, 1, z1, x2 - 1, 3, z1, concrete);
  bp.set(x1 + 6, 1, z2, null);
  bp.set(x1 + 6, 2, z2, null);
  bp.door(x1 + 6, 1, z2, 'pale_oak', 'south');
  bp.fill(x1 + 5, 4, z2 + 1, x1 + 7, 4, z2 + 2, `${slabOf}[type=top]`);
  // Upper floor: cantilevered timber box with a ribbon window and concrete mullions.
  bp.fill(x1 - 1, 4, z1, x2, 4, z2 + 1, concrete);
  bp.walls(x1 - 1, 5, z1, x2, 7, z2 + 1, `${clad}[axis=y]`);
  bp.fill(x1, 5, z2 + 1, x2 - 1, 6, z2 + 1, 'glass');
  for (const x of [x1 + 5, x1 + 10]) bp.fill(x, 5, z2 + 1, x, 6, z2 + 1, `${clad}[axis=y]`);
  bp.fill(x1 - 1, 5, z1 + 3, x1 - 1, 6, z2 - 1, 'glass');
  bp.fill(x2, 5, z1 + 3, x2, 6, z1 + 5, 'glass');
  bp.fill(x1 - 1, 8, z1, x2, 8, z2 + 1, concrete);
  // Stairs along the back wall (two lanes), up to the penthouse if there is one.
  const planes = penthouse ? [0, 4, 8] : [0, 4];
  const hall = stairHall(bp, { axis: 'x', laneA: [z1 + 2], laneB: [z1 + 1], u0: x2 - 1, dir: -1, planes, wood: 'pale_oak' });
  const keepAt = (F) => [...hall.cells, ...(hall.ends[F] ?? [])];
  // Ground: bath in the core, kitchen and living in the hall.
  partition(bp, x1 + 1, z1 + 5, x1 + 3, z1 + 5, 1, 3, concrete, [[x1 + 3, z1 + 5]], 'pale_oak');
  furnish(bp, rng, { x1: x1 + 1, z1: z1 + 1, x2: x1 + 3, z2: z1 + 4, y: 1, h: 3 }, 'bath', [[x1 + 3, z1 + 4]], 'pale_oak');
  bp.set(x1 + 5, 1, z1 + 3, 'smoker[facing=south,lit=true]');
  bp.set(x1 + 6, 1, z1 + 3, 'water_cauldron[level=3]');
  bp.set(x1 + 5, 1, z1 + 4, 'smooth_quartz');
  furnish(bp, rng, { x1: x1 + 5, z1: z1 + 4, x2: x2 - 1, z2: z2 - 1, y: 1, h: 3 }, 'living', [...keepAt(0), [x1 + 6, z2 - 1], [x1 + 5, z1 + 6]], 'pale_oak', { items: ['sofa', 'plant', 'chiseled', 'plant', 'counter'] });
  furnish(bp, rng, { x1: x1 + 1, z1: z1 + 6, x2: x1 + 3, z2: z2 - 1, y: 1, h: 3 }, 'office', [[x1 + 3, z1 + 6]], 'pale_oak', { items: ['bookshelf', 'chest', 'plant'] });
  bp.set(x1 + 4, 1, z1 + 6, null);
  bp.set(x1 + 4, 2, z1 + 6, null);
  bp.door(x1 + 4, 1, z1 + 6, 'pale_oak', 'east');
  // Upper: two bedrooms and a hall in front of the stairs.
  const yU = 5;
  partition(bp, x1, z1 + 3, x1 + 4, z1 + 3, yU, 3, `${clad}[axis=y]`, [[x1 + 4, z1 + 3]], 'pale_oak');
  partition(bp, x1 + 5, z1 + 4, x1 + 5, z2, yU, 3, `${clad}[axis=y]`, [[x1 + 5, z1 + 4]], 'pale_oak');
  furnish(bp, rng, { x1: x1, z1: z1 + 4, x2: x1 + 4, z2: z2, y: yU, h: 3 }, 'bedroom', [[x1 + 4, z1 + 4]], 'pale_oak');
  furnish(bp, rng, { x1: x1 + 6, z1: z1 + 4, x2: x2 - 1, z2: z2, y: yU, h: 3 }, 'twin', [...keepAt(4), [x1 + 6, z1 + 4]], 'pale_oak', { items: ['bed', 'chest', 'tub', 'toilet', 'plant'] });
  light(bp, { x1: x1, z1: z1 + 1, x2: x1 + 3, z2: z1 + 2, y: yU, h: 3 });
  furnish(bp, rng, { x1: x1, z1: z1 + 1, x2: x1 + 3, z2: z1 + 2, y: yU, h: 3 }, 'storage', [], 'pale_oak', { items: ['wardrobe', 'chest'] });
  let roofY = 8;
  if (penthouse) {
    // Set-back glass pavilion with a terrace on the roof of the box.
    bp.walls(x1 + 4, 9, z1, x2, 11, z2 - 2, 'glass');
    for (const [x, z] of [[x1 + 4, z1], [x2, z1], [x1 + 4, z2 - 2], [x2, z2 - 2]]) bp.fill(x, 9, z, x, 11, z, concrete);
    bp.fill(x1 + 5, 9, z1, x2 - 1, 11, z1, concrete);
    bp.fill(x1 + 4, 12, z1, x2, 12, z2 - 2, concrete);
    bp.set(x1 + 7, 9, z2 - 2, null);
    bp.set(x1 + 7, 10, z2 - 2, null);
    bp.door(x1 + 7, 9, z2 - 2, 'pale_oak', 'south');
    for (let x = x1 - 1; x <= x2; x++) bp.set(x, 9, z2 + 1, 'glass_pane');
    for (let z = z1; z <= z2 + 1; z++) bp.set(x1 - 1, 9, z, 'glass_pane');
    bp.set(x1 + 1, 9, z2 - 1, 'flowering_azalea');
    bp.set(x1 + 1, 8, z2 - 1, 'moss_block');
    bp.set(x1 + 2, 9, z2, 'white_bed[facing=west,part=head]');
    bp.set(x1 + 3, 9, z2, 'white_bed[facing=west,part=foot]');
    furnish(bp, rng, { x1: x1 + 5, z1: z1 + 3, x2: x2 - 1, z2: z2 - 3, y: 9, h: 3 }, 'lobby', [...keepAt(8), [x1 + 7, z2 - 3]], 'pale_oak', { items: ['sofa', 'plant', 'chiseled'] });
    roofY = 12;
  } else for (let x = x1 - 1; x <= x2; x++) for (const z of [z1, z2 + 1]) bp.set(x, 9, z, `${slabOf}[type=bottom]`);
  // Green roof with solar panels.
  for (let x = x1 + 5; x <= x2 - 2; x++)
    for (let z = z1 + 1; z <= z2 - 3; z++) {
      if (roofY === 8 && (x === x1 - 1 || x === x2)) continue;
      const solar = (z - z1) % 3 === 1;
      bp.set(x, roofY + 1, z, solar ? 'daylight_detector' : 'moss_block');
      if (!solar && rng.chance(0.3)) bp.set(x, roofY + 2, z, rng.pick(['short_grass', 'fern', 'azalea', 'dandelion']));
    }
  modernGarden(bp, rng, { poolX: [10, 14], poolZ: [13, 15], path: [[x1 + 6, 12], [x1 + 6, 14], [x1 + 6, 16]] });
  broadTree(bp, 3, 14, 5, 2, 'birch');
  for (let z = 0; z <= 16; z++) {
    if (z >= 12) continue;
    bp.setIfEmpty(0, 1, z, 'oak_leaves[persistent=true]');
    bp.setIfEmpty(16, 1, z, 'oak_leaves[persistent=true]');
  }
  sprinkleFlowers(bp, rng, 1, 11, 15, 16, 0.12, ['short_grass', 'fern', 'short_grass', 'cornflower', 'oxeye_daisy']);
  if (rng.chance(0.5)) bp.mirrorX();
  return bp;
}

function modernGable(rng) {
  const bp = new Blueprint();
  const kit = rng.pick([
    { wall: 'stripped_spruce_log[axis=y]', roof: ROOFS.spruce },
    { wall: 'stripped_dark_oak_log[axis=y]', roof: ROOFS.dark_oak },
    { wall: 'white_concrete', roof: ROOFS.deepslate },
    { wall: 'light_gray_concrete', roof: ROOFS.slate },
    { wall: 'stripped_pale_oak_log[axis=y]', roof: { stairs: 'pale_oak_stairs', slab: 'pale_oak_slab', block: 'pale_oak_planks' } },
    { wall: 'polished_blackstone_bricks', roof: ROOFS.blackstone },
  ]);
  const x1 = 3, x2 = 13, z1 = 3, z2 = 11, cx = 8;
  const ix1 = x1 + 1, ix2 = x2 - 1, iz1 = z1 + 1, iz2 = z2 - 1;
  bp.fill(x1 - 1, 0, z1 - 1, x2 + 1, 0, z2 + 1, 'smooth_stone');
  bp.fill(ix1, 0, iz1, ix2, 0, iz2, 'pale_oak_planks');
  bp.walls(x1, 1, z1, x2, 7, z2, kit.wall);
  bp.fill(ix1, 4, iz1, ix2, 4, iz2, 'pale_oak_planks');
  const at = roof(bp, { x1, x2, z1, z2, y: 8, mat: kit.roof, n: INF, s: INF });
  closeUnder(bp, at, perimeter(x1, z1, x2, z2), 8, kit.wall, kit.roof);
  // Big gable glazing (a gallery under the roof) and picture windows with deep reveals.
  for (let x = cx - 2; x <= cx + 2; x++) for (let y = 5; y < at(x, z2).y; y++) bp.set(x, y, z2, 'glass');
  bp.fill(cx - 2, 4, z2 + 1, cx + 2, 4, z2 + 1, 'smooth_stone_slab[type=top]');
  for (let x = cx - 2; x <= cx + 2; x++) bp.set(x, 5, z2 + 1, 'glass_pane');
  const holes = [[x1 + 1, 1, z2, 'south', 3, 2], [x2 - 2, 2, z2, 'south', 2, 2], [x1, 5, z1 + 2, 'west', 2, 2], [x1, 1, z1 + 5, 'west', 3, 2],
    [x2, 2, z1 + 2, 'east', 2, 2], [x2, 5, z1 + 5, 'east', 3, 2], [cx - 1, 2, z1, 'north', 3, 2], [cx + 2, 5, z1, 'north', 2, 2]];
  for (const [x, y, z, face, w, h] of holes) win(bp, rng, x, y, z, face, { w, h, glass: 'glass' });
  bp.door(x2 - 3, 1, z2, 'dark_oak', 'south');
  bp.set(x2 - 3, 3, z2, 'glass');
  // Stair along the east wall; bath behind a wall downstairs; bedroom and study up on the gallery.
  const hall = stairHall(bp, { axis: 'z', laneA: [ix2 - 1], laneB: [ix2], u0: iz2 - 1, dir: -1, planes: [0, 4], wood: 'pale_oak' });
  const keep = [...hall.cells, ...(hall.ends[0] ?? []), ...(hall.ends[4] ?? []), [x2 - 3, iz2]];
  partition(bp, ix1, iz1 + 2, ix1 + 2, iz1 + 2, 1, 3, kit.wall, [[ix1 + 2, iz1 + 2]], 'pale_oak');
  furnish(bp, rng, { x1: ix1, z1: iz1, x2: ix1 + 2, z2: iz1 + 1, y: 1, h: 3 }, 'bath', [[ix1 + 2, iz1 + 1]], 'pale_oak', { items: ['tub', 'toilet', 'sink'] });
  bp.set(ix1 + 4, 1, iz1, 'smoker[facing=south,lit=true]');
  bp.set(ix1 + 5, 1, iz1, 'water_cauldron[level=3]');
  bp.set(ix1 + 3, 1, iz1, 'smooth_quartz');
  furnish(bp, rng, { x1: ix1, z1: iz1 + 3, x2: ix2 - 2, z2: iz2, y: 1, h: 3 }, 'living', [...keep, [ix1 + 2, iz1 + 3]], 'pale_oak', { items: ['sofa', 'chiseled', 'plant', 'counter', 'plant'], table: true });
  furnish(bp, rng, { x1: ix1 + 3, z1: iz1, x2: ix2 - 2, z2: iz1 + 2, y: 1, h: 3 }, 'kitchen', keep, 'pale_oak', { items: ['counter', 'crafting', 'chest'], table: false });
  furnish(bp, rng, { x1: ix1, z1: iz1, x2: ix2 - 2, z2: iz2, y: 5, h: 3 }, 'bedroom', [...keep, ...(hall.ends[4] ?? [])], 'pale_oak', { items: ['bed', 'bed2', 'chest', 'chiseled', 'plant', 'wardrobe'] });
  // Terrace deck with loungers and a table.
  bp.fill(x1, 0, z2 + 2, x2, 0, z2 + 4, 'pale_oak_planks');
  for (const x of [x1 + 1, x1 + 3]) {
    bp.set(x, 1, z2 + 3, 'white_bed[facing=north,part=head]');
    bp.set(x, 1, z2 + 4, 'white_bed[facing=north,part=foot]');
  }
  bp.set(x1 + 6, 1, z2 + 3, 'pale_oak_fence');
  bp.set(x1 + 6, 2, z2 + 3, 'white_carpet');
  for (const x of [x1 + 5, x1 + 7]) bp.set(x, 1, z2 + 3, `pale_oak_stairs[facing=${x < x1 + 6 ? 'west' : 'east'},half=bottom]`);
  for (let z = z2 + 1; z <= 16; z++) bp.set(x2 - 3, 0, z, 'smooth_stone_slab[type=double]');
  broadTree(bp, 2, 15, 5, 2, 'birch');
  broadTree(bp, 15, 2, 4, 1, rng.pick(['oak', 'birch']));
  for (let x = 0; x <= 16; x++) if (Math.abs(x - (x2 - 3)) > 0) bp.setIfEmpty(x, 1, 16, rng.chance(0.7) ? 'azalea' : 'flowering_azalea');
  sprinkleFlowers(bp, rng, 0, 0, 16, 16, 0.08, ['short_grass', 'fern', 'short_grass', 'cornflower']);
  if (rng.chance(0.5)) bp.mirrorX();
  return bp;
}

export function modern(rng) {
  return rng.chance(0.5) ? modernCube(rng) : modernGable(rng);
}

// ================================================================ grand hotel (Belle Époque)

export function hotel(rng) {
  const bp = new Blueprint();
  const x1 = 1, x2 = 15, z1 = 3, z2 = 12, cx = 8;
  const plaster = rng.pick(['smooth_sandstone', 'calcite', 'white_terracotta', 'mushroom_stem', 'end_stone_bricks']);
  const trim = /calcite|mushroom/.test(plaster) ? rng.pick([TRIMS.sand, TRIMS.stone, TRIMS.andesite]) : rng.pick([TRIMS.quartz, TRIMS.stone, TRIMS.diorite]);
  const mansard = rng.pick([ROOFS.slate, ROOFS.slate, ROOFS.copper, ROOFS.deepslate]);
  const cap = rng.pick([ROOFS.copper, ROOFS.copper, ROOFS.copperW]);
  const towers = rng.chance(0.5);
  const stone = stoneMix(rng);
  const name = rng.pick(['BELLEVUE', 'ALPINA', 'SCHWEIZERHOF', 'VICTORIA', 'BEAU-RIVAGE', 'JUNGFRAU', 'EDELWEISS', 'MONTANA', 'PALACE', 'NATIONAL']);
  const carpet = rng.pick(['red_carpet', 'red_carpet', 'blue_carpet', 'green_carpet']);
  const g = 4;
  const floors = 3;
  const yb = (f) => g + 1 + 4 * f;
  const top = g + 4 * floors; // 16
  const inRis = (x) => x >= 6 && x <= 10;
  const front = (x) => (inRis(x) ? 13 : z2);
  const corner = (x, z) => ((x === x1 || x === x2) && (z === z1 || z === z2)) || ((x === 6 || x === 10) && z === 13) || ((x === 5 || x === 11) && z === z2);
  const wallFn = (x, y, z) => {
    if (y <= g) return y === 1 ? 'polished_andesite' : stone();
    const row = (y - g - 1) % 4;
    if (row === 0 || y === top || corner(x, z)) return trim.block;
    return plaster;
  };

  // Body and central risalit.
  bp.fill(x1, 0, z1, x2, 0, z2, 'polished_andesite');
  bp.fill(6, 0, 12, 10, 0, 13, 'polished_andesite');
  bp.fill(x1 + 1, 0, z1 + 1, x2 - 1, 0, z2 - 1, (x, y, z) => ((x + z) % 2 ? 'polished_andesite' : 'smooth_stone'));
  bp.walls(x1, 1, z1, x2, top, z2, wallFn);
  bp.walls(6, 1, 12, 10, top, 13, wallFn);
  bp.fill(7, 1, 12, 9, top, 12, null);
  for (let f = 0; f <= floors; f++) {
    const y = f === floors ? top + 1 : yb(f);
    bp.fill(x1 + 1, y, z1 + 1, x2 - 1, y, z2 - 1, 'dark_oak_planks');
    bp.fill(7, y, 12, 9, y, 12, 'dark_oak_planks');
  }
  // Ground floor: windows, portal with glass sidelights, marquee.
  for (const x of [2, 4, 12, 14]) win(bp, rng, x, 2, z2, 'south', { h: 2, lintel: trim.block });
  for (const z of [5, 8, 11]) {
    win(bp, rng, x1, 2, z, 'west', { h: 2 });
    win(bp, rng, x2, 2, z, 'east', { h: 2 });
  }
  bp.door(cx, 1, 13, 'dark_oak', 'south');
  bp.set(cx, 3, 13, 'glass');
  for (const x of [7, 9]) bp.fill(x, 1, 13, x, 3, 13, 'glass');
  bp.set(cx, 4, 13, trim.block);
  bp.fill(6, 4, 14, 10, 4, 15, `${cap.slab}[type=bottom]`);
  for (const x of [6, 10]) bp.fill(x, 1, 15, x, 3, 15, 'polished_blackstone_wall');
  for (const x of [7, 9]) bp.set(x, 3, 15, 'lantern[hanging=true]');
  bp.set(cx, 3, 14, 'lantern[hanging=true]');
  // Upper storeys: framed windows, French windows with iron balconies, a balcony on the risalit.
  const cols = [2, 4, 7, 9, 12, 14, 8];
  for (let f = 0; f < floors; f++) {
    const y = yb(f) + 1;
    for (const x of cols) {
      const z = front(x);
      if (inRis(x) && f >= 1) {
        bp.door(x, y, 13, 'dark_oak', 'south');
        bp.set(x, y + 2, 13, trim.block);
        continue;
      }
      if (x === cx) {
        win(bp, rng, x, y, z, 'south', { h: 2, lintel: trim.block });
        continue;
      }
      if (f === 0 && (x === 2 || x === 4)) {
        bp.door(x, y, z, 'dark_oak', 'south');
        bp.set(x, y + 2, z, trim.block);
        for (let dx = -1; dx <= 1; dx++) {
          bp.set(x + dx, y - 1, z + 1, `${trim.slab}[type=top]`);
          bp.set(x + dx, y, z + 1, 'iron_bars');
        }
        bp.set(x, y + 2, z + 1, `${trim.stairs}[facing=north,half=bottom]`);
      } else win(bp, rng, x, y, z, 'south', { h: 2, lintel: trim.block });
      if (f === 1 && !inRis(x)) bp.set(x, y + 2, z + 1, `${trim.slab}[type=bottom]`);
      win(bp, rng, x, y, z1, 'north', { h: 2, lintel: trim.block });
    }
    for (const z of [5, 8, 11]) {
      win(bp, rng, x1, y, z, 'west', { h: 2, lintel: trim.block });
      win(bp, rng, x2, y, z, 'east', { h: 2, lintel: trim.block });
    }
    if (f >= 1) {
      const cells = [];
      for (let x = 6; x <= 10; x++) cells.push([x, 14], [x, 15]);
      deck(bp, rng, cells, yb(f), { floor: `${trim.slab}[type=top]`, railBlock: 'iron_bars', isHouse: (x, z) => z <= 13, flowers: f === 1 ? 0.5 : 0, bracket: trim.stairs });
    }
  }
  // Cornice.
  for (const [x, z] of perimeter(x1, z1, x2, z2)) {
    const f = z === z1 ? 'south' : z === z2 ? 'north' : x === x1 ? 'east' : 'west';
    const [dx, dz] = DIR[OPP[f]];
    if (!(z === z2 && inRis(x))) bp.setIfEmpty(x + dx, top, z + dz, `${trim.stairs}[facing=${f},half=top]`);
  }
  for (let x = 6; x <= 10; x++) bp.set(x, top, 14, `${trim.stairs}[facing=north,half=top]`);
  // Mansard roof with dormers (framed by full blocks so the glass sits flush).
  roof(bp, { x1, x2, z1, z2, y: top + 1, mat: mansard, kind: 'steep', cap: 2 });
  for (const x of [2, 4, 12, 14]) {
    for (const z of [z1, z2]) {
      bp.set(x - 1, top + 2, z, mansard.block);
      bp.set(x + 1, top + 2, z, mansard.block);
      bp.set(x, top + 2, z, 'glass_pane');
    }
    bp.set(x, top + 3, z2, `${trim.slab}[type=bottom]`);
  }
  // Pavilion over the risalit with sign and copper dome.
  bp.walls(6, top + 1, 9, 10, top + 4, 13, (x, y, z) => ((x === 6 || x === 10) && (z === 9 || z === 13) ? trim.block : y === top + 4 ? trim.block : plaster));
  bp.set(cx, top + 2, 13, 'glass_pane');
  bp.set(cx, top + 3, 13, 'glass_pane');
  bp.fill(cx, top + 2, 9, cx, top + 3, 9, null);
  bp.set(cx, top + 4, 9, trim.block);
  bp.set(cx, top + 1, 14, `dark_oak_wall_sign[facing=south]${signData(['GRAND', 'HOTEL', name, ''], 'yellow', true)}`);
  const pa = roof(bp, { x1: 6, x2: 10, z1: 9, z2: 13, y: top + 5, mat: cap, kind: 'steep' });
  const pt = pa(cx, 11).y;
  bp.fill(cx, pt + 1, 11, cx, pt + 3, 11, 'spruce_fence');
  bp.set(cx, pt + 4, 11, `red_banner[rotation=0]${SWISS_FLAG}`);
  if (towers)
    for (const tx of [x1, x2 - 2]) {
      bp.walls(tx, top + 1, z2 - 2, tx + 2, top + 4, z2, (x, y, z) => (y === top + 4 ? trim.block : plaster));
      bp.set(tx + 1, top + 2, z2, 'glass');
      bp.set(tx + 1, top + 3, z2, 'glass');
      const ta = roof(bp, { x1: tx, x2: tx + 2, z1: z2 - 2, z2, y: top + 5, mat: cap, kind: 'steep', pitch: 3 });
      bp.set(tx + 1, ta(tx + 1, z2 - 1).y + 1, z2 - 1, 'waxed_oxidized_lightning_rod[facing=up]');
    }

  // ---- Interior. Grand staircase (two 2-wide lanes) in the east wing with a hall beside it;
  // upstairs a corridor along the back with two guest rooms per floor facing the street; staff attic by ladder.
  const planes = [0, yb(0), yb(1), yb(2)];
  const hall = stairHall(bp, { axis: 'z', laneA: [11, 12], laneB: [13, 14], u0: 11, dir: -1, planes, wood: 'dark_oak' });
  const keepAt = (F) => [...hall.cells, ...(hall.ends[F] ?? [])];
  // Lobby: reception desk, lounge, restaurant.
  for (let x = 2; x <= 5; x++) bp.set(x, 1, 4, x === 5 ? 'dark_oak_planks' : 'dark_oak_slab[type=top]');
  bp.set(3, 2, 4, 'bell[attachment=floor,facing=south]');
  bp.set(5, 2, 4, 'lectern[facing=south,has_book=true]');
  for (const [tx, tz] of [[3, 7], [3, 10], [6, 9]]) {
    bp.set(tx, 1, tz, 'dark_oak_fence');
    bp.set(tx, 2, tz, 'white_carpet');
    for (const f of ['east', 'west']) bp.setIfEmpty(tx + DIR[f][0], 1, tz, `dark_oak_stairs[facing=${f},half=bottom]`);
  }
  for (let z = 6; z <= 12; z++) bp.set(cx, 1, z, carpet);
  for (let z = 6; z <= 11; z++) bp.set(9, 1, z, carpet);
  for (const [x, z] of [[2, 6], [2, 11], [10, 4], [8, 4]]) bp.setIfEmpty(x, 1, z, rng.pick(HOUSE_PLANTS));
  for (const [x, z] of [[4, 8], [9, 8], [4, 5], [12, 4]]) light(bp, { x1: x, z1: z, x2: x, z2: z, y: 1 });
  // Guest floors.
  const roomsX = [[2, 4], [6, 8]];
  for (let f = 0; f < floors; f++) {
    const F = yb(f);
    const y = F + 1;
    partition(bp, 2, 6, 9, 6, y, 3, plaster, roomsX.map(([a]) => [a + 1, 6]), 'dark_oak');
    partition(bp, 5, 7, 5, 11, y, 3, plaster, [], 'dark_oak');
    partition(bp, 9, 7, 9, 11, y, 3, plaster, [], 'dark_oak');
    for (const [a, b] of roomsX) {
      furnish(bp, rng, { x1: a, z1: 7, x2: b, z2: b === 8 ? 12 : 11, y, h: 3 }, 'guest', [[a + 1, 7], [cx, 12], [7, 12], [9, 12], [2, 11], [4, 11]], 'dark_oak', { items: ['bed', 'chest', 'armchair', 'plant', 'wardrobe'] });
      bp.set(a, y, 7, 'water_cauldron[level=3]');
    }
    for (let x = 2; x <= 10; x++) for (const z of [4, 5]) if (!bp.get(x, y, z)) bp.set(x, y, z, carpet);
    for (const x of [3, 7]) light(bp, { x1: x, z1: 5, x2: x, z2: 5, y });
    light(bp, { x1: 10, z1: 8, x2: 10, z2: 9, y });
  }
  // Staff attic under the mansard, by ladder from the top corridor.
  ladderUp(bp, 4, 5, 'north', yb(2) + 1, top + 1);
  furnish(bp, rng, { x1: 6, z1: 6, x2: 12, z2: 9, y: top + 2, h: 3 }, 'storage', [[4, 5], [5, 5], [4, 6]], 'spruce', { items: ['bed', 'chest', 'barrel', 'barrel'] });
  light(bp, { x1: 4, z1: 6, x2: 8, z2: 8, y: top + 2 });

  // Forecourt: red carpet, planters, lamps, flags, café tables.
  bp.fill(0, 0, 13, 16, 0, 16, (x, y, z) => (inRis(x) && z <= 15 ? 'polished_andesite' : (x + z) % 2 ? 'smooth_stone' : 'polished_andesite'));
  bp.fill(0, 0, 0, 16, 0, 2, 'grass_block');
  for (let z = 14; z <= 16; z++) bp.set(cx, 1, z, 'red_carpet');
  for (const x of [5, 11]) planter(bp, x, 14, 'dark_oak', 'flowering_azalea');
  lamp(bp, 5, 16, 3, 'double');
  lamp(bp, 11, 16, 3, 'double');
  const [cb, cd] = rng.pick(CANTONS);
  flagPole(bp, 0, 13, 7);
  flagPole(bp, 16, 13, 7, `${cb}_banner[rotation=0]${cd}`);
  for (const tx of [2, 14]) {
    bp.fill(tx, 1, 15, tx, 3, 15, 'dark_oak_fence');
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        if (!inPlot(tx + dx, 15 + dz)) continue;
        if (dx || dz) bp.set(tx + dx, 4, 15 + dz, 'birch_trapdoor[facing=south,half=top]');
        else bp.set(tx, 4, 15, 'white_wool');
        bp.set(tx + dx, 5, 15 + dz, 'white_carpet');
      }
    for (const f of ['east', 'west']) bp.setIfEmpty(tx + DIR[f][0], 1, 15, `dark_oak_stairs[facing=${f},half=bottom]`);
  }
  sprinkleFlowers(bp, rng, 0, 0, 16, 2, 0.2, ['red_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy']);
  return bp;
}

// ================================================================ clock tower (Zytglogge)

/** Astronomical clock: 5x5 dial with zodiac ring, sun and moon. */
function astroClock(bp, x, y, z, face) {
  const [ax, az] = along(face);
  for (let i = -2; i <= 2; i++)
    for (let j = -2; j <= 2; j++) {
      if (Math.abs(i) === 2 && Math.abs(j) === 2) continue;
      let b;
      if (Math.abs(i) === 2 || Math.abs(j) === 2) b = i === 0 || j === 0 ? 'gold_block' : (i + j) % 2 ? 'light_blue_concrete' : 'orange_concrete';
      else if (i === 0 && j === 0) b = 'gold_block';
      else if (i === 0 && j === 1) b = 'yellow_concrete';
      else if (i === 0 && j === -1) b = 'white_concrete';
      else if (j === 0) b = 'black_concrete';
      else b = 'blue_concrete';
      bp.set(x + ax * i, y + j, z + az * i, b);
    }
}

export function clocktower(rng) {
  const bp = new Blueprint();
  const x1 = 5, x2 = 11, z1 = 5, z2 = 11, cx = 8, cz = 8;
  const H = 20;
  const plaster = rng.pick(['white_terracotta', 'smooth_sandstone', 'calcite', 'pink_terracotta']);
  const trim = rng.pick([TRIMS.tuff, TRIMS.sand, TRIMS.stone]);
  const roofMat = ROOFS[rng.weighted([['tile', 3], ['clay', 2], ['granite', 1], ['slate', 1.5]])];
  const corner = (x, z) => (x === x1 || x === x2) && (z === z1 || z === z2);

  // Square with the street running through the gate.
  bp.fill(0, 0, 0, 16, 0, 16, (x, y, z) => (x >= 7 && x <= 9 ? ((x + z) % 2 ? 'cobblestone' : 'stone_bricks') : (x + z) % 4 === 0 ? 'polished_andesite' : 'stone_bricks'));
  // Tower body: rusticated base, plaster shaft, sandstone quoins and string courses.
  bp.walls(x1, 1, z1, x2, H, z2, (x, y, z) => {
    if (y <= 6) return y % 2 ? 'stone_bricks' : 'polished_andesite';
    if (corner(x, z) || y === 7 || y === 13 || y === H) return trim.block;
    return plaster;
  });
  // Gate passage under a vaulted ceiling; the chambers above are floored.
  for (let z = z1; z <= z2; z++) {
    bp.fill(7, 1, z, 9, 4, z, null);
    bp.fill(6, 1, z, 6, 4, z, 'stone_bricks');
    bp.fill(10, 1, z, 10, 4, z, 'stone_bricks');
  }
  for (const z of [z1, z2]) {
    bp.set(7, 4, z, 'stone_brick_stairs[facing=west,half=top]');
    bp.set(9, 4, z, 'stone_brick_stairs[facing=east,half=top]');
  }
  bp.fill(x1 + 1, 5, z1 + 1, x2 - 1, 5, z2 - 1, 'stone_bricks');
  bp.fill(7, 5, z1, 9, 5, z1, 'stone_bricks');
  bp.fill(7, 5, z2, 9, 5, z2, 'stone_bricks');
  for (const z of [z1 + 1, cz, z2 - 1]) bp.set(cx, 4, z, 'lantern[hanging=true]');
  bp.fill(x1 + 1, 11, z1 + 1, x2 - 1, 11, z2 - 1, 'spruce_planks');
  bp.fill(x1 + 1, 17, z1 + 1, x2 - 1, 17, z2 - 1, 'spruce_planks');
  // Flags beside the gate.
  const [cb, cd] = rng.pick(CANTONS);
  bp.set(6, 4, z2 + 1, `red_wall_banner[facing=south]${SWISS_FLAG}`);
  bp.set(10, 4, z2 + 1, `${cb}_wall_banner[facing=south]${cd}`);
  bp.set(6, 4, z1 - 1, `${cb}_wall_banner[facing=north]${cd}`);
  bp.set(10, 4, z1 - 1, `red_wall_banner[facing=north]${SWISS_FLAG}`);
  // Astronomical clock with automaton figures on a ledge, main dials above.
  astroClock(bp, cx, 10, z2, 'south');
  for (let x = 6; x <= 10; x++) bp.set(x, 7, z2 + 1, `${trim.slab}[type=top]`);
  bp.set(6, 8, z2 + 1, 'waxed_copper_golem_statue[copper_golem_pose=standing,facing=south]');
  bp.set(10, 8, z2 + 1, 'waxed_copper_golem_statue[copper_golem_pose=star,facing=south]');
  clockFace(bp, cx, 16, z2, 'south', true);
  clockFace(bp, cx, 16, z1, 'north', true);
  clockFace(bp, x1, 16, cz, 'west');
  for (const y of [8, 9]) {
    bp.set(x1, y, cz, 'glass_pane');
    bp.set(cx, y, z1, 'glass_pane');
  }
  for (const x of [7, 9]) bp.fill(x, 18, z2, x, 19, z2, 'glass_pane');
  for (const z of [7, 9]) bp.set(x1, 12, z, 'glass_pane');

  // Stair turret on the east side: door from the square, ladder to every chamber.
  const tx = 12, tz = 7;
  bp.walls(tx, 1, tz, tx + 2, 19, tz + 2, (x, y, z) => (y <= 6 ? 'stone_bricks' : (x === tx + 1 || z === tz + 1) ? plaster : trim.block));
  bp.fill(tx, 0, tz, tx + 2, 0, tz + 2, 'stone_bricks');
  bp.fill(tx, 20, tz, tx + 2, 20, tz + 2, `${roofMat.slab}[type=bottom]`);
  bp.door(tx + 1, 1, tz + 2, 'spruce', 'south');
  for (let y = 1; y <= 18; y++) bp.set(tx + 1, y, tz + 1, 'ladder[facing=west]');
  for (const y of [6, 12, 18]) for (const x of [tx, x2]) bp.fill(x, y, cz, x, y + 1, cz, null);
  for (const y of [9, 15]) bp.set(tx + 1, y, tz, 'glass_pane');
  // Chambers: clockwork above the gate, the clock room, the upper room under the roof.
  furnish(bp, rng, { x1: 6, z1: 6, x2: 10, z2: 10, y: 6, h: 5 }, 'office', [[10, cz], [9, cz]], 'spruce', { items: ['barrel', 'chest', 'lectern', 'chiseled'] });
  furnish(bp, rng, { x1: 6, z1: 6, x2: 10, z2: 10, y: 12, h: 5 }, 'office', [[10, cz], [9, cz]], 'spruce', { items: ['chest', 'barrel', 'chiseled', 'plant'] });
  furnish(bp, rng, { x1: 6, z1: 6, x2: 10, z2: 10, y: 18, h: 3 }, 'storage', [[10, cz], [9, cz]], 'spruce', { items: ['barrel', 'chest', 'barrel'] });
  // Cornice.
  for (const [x, z] of perimeter(x1 - 1, z1 - 1, x2 + 1, z2 + 1)) {
    const f = z === z1 - 1 ? 'south' : z === z2 + 1 ? 'north' : x === x1 - 1 ? 'east' : 'west';
    bp.set(x, H, z, `${trim.stairs}[facing=${f},half=top]`);
  }
  // Big hipped roof, flat top carrying the open bell turret.
  const rat = roof(bp, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 1, y: H + 1, mat: roofMat, kind: 'steep', cap: 3 });
  closeUnder(bp, rat, perimeter(x1, z1, x2, z2), H + 1, roofMat.block);
  const ty = H + 8;
  for (const [x, z] of [[7, 7], [9, 7], [7, 9], [9, 9]]) bp.fill(x, ty, z, x, ty + 1, z, 'dark_oak_fence');
  bp.set(cx, ty + 2, cz, 'waxed_oxidized_cut_copper');
  bp.set(cx, ty + 1, cz, 'bell[attachment=ceiling,facing=south]');
  roof(bp, { x1: 7, x2: 9, z1: 7, z2: 9, y: ty + 2, mat: ROOFS.copper, kind: 'steep', pitch: 2 });
  bp.set(cx, ty + 6, cz, 'gold_block');
  bp.set(cx, ty + 7, cz, 'waxed_oxidized_lightning_rod[facing=up]');
  for (const [x, z] of [[x1 - 1, z1 - 1], [x2 + 1, z1 - 1], [x1 - 1, z2 + 1], [x2 + 1, z2 + 1]]) bp.set(x, H + 3, z, 'waxed_oxidized_lightning_rod[facing=up]');

  // Surroundings: benches, lamps, planted corners.
  for (const [x, z] of [[2, 2], [14, 2], [2, 14], [14, 14]]) {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) bp.set(x + dx, 0, z + dz, 'grass_block');
    for (const [px, pz] of perimeter(x - 2, z - 2, x + 2, z + 2)) bp.setIfEmpty(px, 1, pz, 'stone_brick_slab[type=bottom]');
    if (z < 8) broadTree(bp, x, z, 5, 2, rng.pick(['oak', 'oak', 'birch']));
    else {
      bp.set(x, 0, z, 'moss_block');
      bp.set(x, 1, z, rng.pick(['flowering_azalea', 'azalea']));
    }
    for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) bp.setIfEmpty(x + dx, 1, z + dz, rng.pick(['red_tulip', 'poppy', 'white_tulip']));
  }
  bench(bp, 3, 7, 'west', 3, 'spruce');
  lamp(bp, 5, 14, 3, 'double');
  lamp(bp, 11, 1, 3, 'double');
  return bp;
}

// ================================================================ cooperative apartment block (Genossenschaft)

export function apartment(rng) {
  const bp = new Blueprint();
  const x1 = 2, x2 = 14, z1 = 3, z2 = 11, cx = 8;
  const n = rng.int(4, 6);
  const concrete = rng.pick(['white_concrete', 'light_gray_concrete', 'smooth_quartz', 'white_concrete']);
  const slabOf = concrete === 'smooth_quartz' ? 'smooth_quartz_slab' : 'smooth_stone_slab';
  const timber = rng.pick(['stripped_oak_log[axis=y]', 'stripped_spruce_log[axis=y]', 'stripped_pale_oak_log[axis=y]', 'stripped_dark_oak_log[axis=y]', 'stripped_birch_log[axis=y]']);
  const rail = rng.pick(['glass_pane', 'iron_bars', 'waxed_copper_bars', 'glass_pane']);
  const accent = rng.pick(['orange', 'yellow', 'green', 'light_blue', 'red', 'lime']);
  const wood = rng.pick(['pale_oak', 'oak', 'birch']);
  const top = 3 * n;
  const structX = new Set([x1, 5, cx, 11, x2]);
  const structZ = new Set([z1, 7, z2]);
  const cell = (x, y, z) => {
    if (y % 3 === 0) return concrete;
    const s = Math.floor(y / 3);
    const isFront = z === z2 || z === z1;
    if (isFront ? structX.has(x) : structZ.has(z)) return concrete;
    const a = isFront ? x : z;
    return (a + 2 * (s % 2)) % 4 === 0 ? timber : 'glass_pane';
  };
  bp.fill(x1, 0, z1, x2, 0, z2, 'smooth_stone');
  bp.walls(x1, 1, z1, x2, top, z2, cell);
  for (let s = 1; s <= n; s++) bp.fill(x1 + 1, 3 * s, z1 + 1, x2 - 1, 3 * s, z2 - 1, s === n ? concrete : `${wood}_planks`);
  bp.fill(x1 + 1, 0, z1 + 1, x2 - 1, 0, z2 - 1, `${wood}_planks`);
  // Entrance: glass door with glazed sidelights and a canopy.
  bp.fill(cx - 2, 1, z2, cx + 2, 2, z2, 'glass');
  bp.set(cx, 1, z2, null);
  bp.set(cx, 2, z2, null);
  bp.door(cx, 1, z2, wood, 'south');
  bp.fill(cx - 2, 3, z2 + 1, cx + 2, 3, z2 + 2, `${slabOf}[type=top]`);
  bp.set(cx + 2, 2, z2 + 1, `${accent}_wall_banner[facing=south]`);
  bp.set(cx - 1, 2, z2 + 2, 'lantern[hanging=true]');
  bp.set(cx + 1, 2, z2 + 2, 'lantern[hanging=true]');
  // Stair core (two lanes along the back wall) from the lobby up to the roof garden.
  const planes = Array.from({ length: n + 1 }, (_, s) => 3 * s);
  const core = stairHall(bp, { axis: 'x', laneA: [5], laneB: [4], u0: 10, dir: -1, planes, wood });
  for (let s = 0; s < n; s++) {
    const y = 3 * s + 1;
    // Stairwell walls with the flat's front door; bedroom and bathroom walls.
    partition(bp, 5, 4, 5, 6, y, 2, concrete);
    partition(bp, 11, 4, 11, 6, y, 2, concrete);
    partition(bp, 5, 7, 11, 7, y, 2, concrete, [[cx, 7]], wood);
    partition(bp, 3, 7, 4, 7, y, 2, concrete, [[4, 7]], wood);
    partition(bp, 12, 7, 13, 7, y, 2, concrete, [[12, 7]], wood);
    const keep = [...core.cells, ...(core.ends[3 * s] ?? []), [cx, 6], [cx, 8], [4, 8], [4, 6], [12, 8], [12, 6], [cx, z2 - 1]];
    if (s === 0) {
      furnish(bp, rng, { x1: 3, z1: 8, x2: 13, z2: 10, y, h: 2 }, 'lobby', keep, wood, { items: ['plant', 'sofa', 'chest', 'plant'] });
      furnish(bp, rng, { x1: 3, z1: 4, x2: 4, z2: 6, y, h: 2 }, 'storage', keep, wood, { items: ['barrel', 'chest'] });
      furnish(bp, rng, { x1: 12, z1: 4, x2: 13, z2: 6, y, h: 2 }, 'storage', keep, wood, { items: ['sink', 'sink', 'chest'] });
    } else {
      // Kitchen against the stairwell wall, dining table, sofa; bedroom west, bathroom east.
      bp.set(6, y, 8, 'smoker[facing=south,lit=true]');
      bp.set(7, y, 8, 'water_cauldron[level=3]');
      bp.set(9, y, 8, 'barrel[facing=south]');
      furnish(bp, rng, { x1: 3, z1: 8, x2: 13, z2: 10, y, h: 2 }, 'living', keep, wood, { items: ['sofa', 'plant', 'chiseled', 'chest'], table: true });
      furnish(bp, rng, { x1: 3, z1: 4, x2: 4, z2: 6, y, h: 2 }, 'bedroom', keep, wood, { items: ['bed', 'chest'] });
      furnish(bp, rng, { x1: 12, z1: 4, x2: 13, z2: 6, y, h: 2 }, 'bath', keep, wood, { items: ['tub', 'toilet', 'sink'] });
    }
    light(bp, { x1: 6, z1: 6, x2: 10, z2: 6, y, h: 2 });
  }
  // Staggered balconies with French doors.
  for (let s = 1; s < n; s++) {
    const y = 3 * s;
    const ranges = s % 2 ? [[x1 + 1, cx - 1]] : [[cx + 1, x2 - 1]];
    if (n <= 5 || s === n - 1) ranges.push(s % 2 ? [cx + 2, x2 - 1] : [x1 + 1, cx - 2]);
    for (const [a, b] of ranges) {
      const cells = [];
      for (let x = a; x <= b; x++) for (let k = 1; k <= 2; k++) cells.push([x, z2 + k]);
      deck(bp, rng, cells, y, { floor: `${slabOf}[type=top]`, railBlock: rail, post: concrete, isHouse: (x, z) => z <= z2, flowers: 0 });
      const dx = (a + b) >> 1;
      for (const xx of [dx - 1, dx + 1]) if (!structX.has(xx)) bp.fill(xx, y + 1, z2, xx, y + 2, z2, timber);
      bp.set(dx, y + 1, z2, null);
      bp.set(dx, y + 2, z2, null);
      bp.door(dx, y + 1, z2, wood, 'south');
      bp.set(a + 1, y + 1, z2 + 1, rng.pick(['potted_azalea_bush', 'potted_flowering_azalea_bush', 'potted_bamboo', 'potted_fern']));
      if (b - a >= 3) bp.set(b - 1, y + 1, z2 + 1, `${wood}_stairs[facing=north,half=bottom]`);
    }
  }
  // Roof: stair house over the core, parapet, green roof with solar panels.
  bp.walls(5, top + 1, 3, 11, top + 3, 7, concrete);
  bp.fill(5, top + 4, 3, 11, top + 4, 7, concrete);
  bp.set(cx, top + 1, 7, null);
  bp.set(cx, top + 2, 7, null);
  bp.door(cx, top + 1, 7, wood, 'south');
  for (const x of [6, 10]) bp.set(x, top + 2, 7, 'glass_pane');
  light(bp, { x1: 6, z1: 6, x2: 10, z2: 6, y: top + 1 });
  for (const [x, z] of perimeter(x1, z1, x2, z2)) if (!bp.get(x, top + 1, z)) bp.set(x, top + 1, z, `${slabOf}[type=bottom]`);
  for (let x = x1 + 1; x < x2; x++)
    for (let z = z1 + 1; z < z2; z++) {
      if (bp.get(x, top + 1, z) || (x >= 5 && x <= 11 && z <= 7)) continue;
      const solar = x >= cx + 1 && (z - z1) % 2 === 1 && z > 8;
      bp.set(x, top + 1, z, solar ? 'daylight_detector' : 'moss_block');
      if (!solar && rng.chance(0.3)) bp.set(x, top + 2, z, rng.pick(['azalea', 'flowering_azalea', 'short_grass', 'fern', 'short_grass', 'dandelion', 'cornflower']));
    }
  // Shared garden: lawn, birches, raised beds, sandpit, bench.
  for (let z = z2 + 1; z <= 16; z++) bp.set(cx, 0, z, 'smooth_stone_slab[type=double]');
  broadTree(bp, 3, 14, 5, 2, 'birch');
  broadTree(bp, 13, 15, 4, 1, 'birch');
  const crop = () => rng.pick(['carrots[age=7]', 'potatoes[age=7]', 'beetroots[age=3]', 'wheat[age=7]']);
  for (let x = 10; x <= 12; x++) {
    bp.set(x, 0, 14, 'farmland[moisture=7]');
    bp.set(x, 1, 14, crop());
  }
  bp.fill(5, 0, 15, 6, 0, 16, 'sand');
  for (const [x, z] of [[4, 15], [4, 16], [7, 15], [7, 16]]) bp.setIfEmpty(x, 1, z, 'birch_slab[type=bottom]');
  bench(bp, 10, 16, 'south', 2, wood);
  sprinkleFlowers(bp, rng, 0, 12, 16, 16, 0.12, ['short_grass', 'dandelion', 'oxeye_daisy', 'short_grass']);
  if (rng.chance(0.5)) bp.mirrorX();
  return bp;
}

// ================================================================ Emmental farmhouse

export function farmhouse(rng) {
  const bp = new Blueprint();
  const X1 = 1, X2 = 11, Z1 = 1, Z2 = 13, cx = 6;
  const zb = 6; // wall between the barn (behind) and the living part (front)
  const tw = WOOD(rng.pick(['spruce', 'spruce', 'dark_oak', 'oak']));
  const rw = WOOD(tw.name === 'oak' ? 'spruce' : rng.pick(['oak', 'birch', 'spruce']));
  const roofMat = ROOFS[rng.weighted([['tile', 3], ['spruce', 3], ['dark_oak', 2], ['clay', 1.5]])];
  const back = rng.pick([0, 2]);
  const y0 = 4;
  const board = `${tw.stripped}[axis=y]`;

  bp.fill(X1, 0, Z1, X2, 0, Z2, 'cobblestone');
  bp.fill(X1 + 1, 0, zb + 1, X2 - 1, 0, Z2 - 1, tw.planks);
  bp.fill(X1 + 1, 0, Z1 + 1, X2 - 1, 0, zb - 1, (x, y, z) => ((x * 7 + z * 3) % 5 ? 'coarse_dirt' : 'packed_mud'));
  // Living part: stone plinth, horizontal log walls. Barn: vertical boards.
  bp.walls(X1, 1, zb, X2, 4, Z2, (x, y, z) => (y === 1 ? 'stone_bricks' : (x === X1 || x === X2) && (z === zb || z === Z2) ? `${tw.log}[axis=y]` : `${y === 4 ? tw.log : tw.stripped}[axis=${z === Z2 || z === zb ? 'x' : 'z'}]`));
  bp.walls(X1, 1, Z1, X2, 4, zb, (x, y, z) => (z === zb ? bp.get(x, y, z) ?? board : board));
  bp.fill(X1 + 1, 4, zb + 1, X2 - 1, 4, Z2 - 1, tw.planks);
  bp.fill(X1 + 1, 5, Z1 + 1, X2 - 1, 5, zb - 2, tw.planks);
  // Huge half-hipped roof reaching low.
  const at = roof(bp, { x1: 0, x2: 12, z1: Z1 - 1, z2: Z2 + 2, y: y0, mat: roofMat, s: 4, n: back });
  closeUnder(bp, at, perimeter(X1, Z1, X2, Z2), 5, (x, y, z) => (z === Z2 ? tw.planks : board), roofMat);
  closeUnder(bp, at, [...Array(X2 - X1 - 1)].map((_, i) => [X1 + 1 + i, zb]), 5, tw.planks, roofMat);
  // Front: ribbon windows with flower boxes on both floors, door, attic window.
  const room = (x) => at(x, Z2).y;
  win(bp, rng, X1 + 1, 2, Z2, 'south', { w: 3, h: 2, box: rw.trapdoor });
  win(bp, rng, cx + 2, 2, Z2, 'south', { w: 3, h: 2, box: rw.trapdoor });
  bp.door(cx, 1, Z2, tw.door, 'south');
  let ua = X1 + 1;
  while (room(ua) < 8) ua++;
  let ub = X2 - 1;
  while (room(ub) < 8) ub--;
  if (ub - ua >= 1) win(bp, rng, ua, 5, Z2, 'south', { w: ub - ua + 1, h: 2, box: rw.trapdoor });
  if (room(cx) >= 10) for (const x of room(cx - 2) >= 10 ? [cx - 1, cx + 1] : [cx]) win(bp, rng, x, 8, Z2, 'south', { h: room(x) >= 11 ? 2 : 1 });
  // Ründi: the rounded board vault under the front half-hip.
  const zr = Z2 + 1;
  const arch = (x) => {
    const t = (x - cx) / 6;
    const want = Math.round(4 + 4.5 * Math.sqrt(Math.max(0, 1 - t * t)));
    return Math.min(want, at(x, zr).y - 1);
  };
  for (let x = X1; x <= X2; x++) {
    const a = arch(x);
    if (a < 4) continue;
    const l = arch(x - 1);
    const r = arch(x + 1);
    let b = `${rw.slab}[type=top]`;
    if (x < cx && r > a) b = `${rw.stairs}[facing=west,half=top]`;
    if (x > cx && l > a) b = `${rw.stairs}[facing=east,half=top]`;
    bp.set(x, a, zr, b);
    for (let y = a + 1; y < at(x, zr).y; y++) bp.set(x, y, zr, rw.planks);
  }
  win(bp, rng, X1, 2, Z2 - 2, 'west', { h: 2 });
  win(bp, rng, X2, 2, Z2 - 2, 'east', { h: 2 });
  win(bp, rng, X2, 2, zb + 2, 'east', { h: 2 });
  // Barn: side door, threshing door at the back, hay, stalls, loft by ladder.
  bp.fill(X1, 1, 2, X1, 3, 4, null);
  bp.fill(X1, 4, 2, X1, 4, 4, `${tw.log}[axis=z]`);
  for (let z = Z1 + 1; z < zb; z += 2) bp.set(X2, 3, z, tw.fence);
  bp.fill(cx - 1, 1, Z1, cx + 1, 3, Z1, null);
  for (let x = X1 + 1; x <= X2 - 1; x++) {
    if (x >= cx - 1 && x <= cx + 1) continue;
    if (x <= X1 + 1) continue;
    bp.set(x, 1, Z1 + 1, 'hay_block[axis=y]');
    if (x % 2) bp.set(x, 2, Z1 + 1, 'hay_block[axis=x]');
  }
  for (let x = X1 + 2; x <= X2 - 1; x += 2) bp.setIfEmpty(x, 6, Z1 + 2, 'hay_block[axis=x]');
  for (let z = Z1 + 3; z < zb; z++) bp.set(X2 - 3, 1, z, tw.fence);
  bp.set(X2 - 3, 1, Z1 + 2, `${tw.gate}[facing=east,open=true]`);
  bp.set(X2 - 1, 1, zb - 1, 'water_cauldron[level=3]');
  bp.set(X2 - 1, 1, Z1 + 2, 'composter[level=7]');
  ladderUp(bp, cx, zb - 1, 'north', 1, 5);
  bp.set(cx - 2, 4, Z1 + 3, 'lantern[hanging=true]');
  // Living part: kitchen with stove and chimney, Stube with tiled stove, stairs to the bedrooms.
  const hall = stairHall(bp, { axis: 'x', laneA: [zb + 1], laneB: [], u0: X2 - 1, dir: -1, planes: [0, 4], wood: tw.name });
  bp.set(X1 + 1, 1, zb + 2, 'smoker[facing=east,lit=true]');
  bp.fill(X1 + 1, 2, zb + 2, X1 + 1, at(X1 + 1, zb + 2).y + 1, zb + 2, 'cobblestone');
  bp.set(X1 + 1, at(X1 + 1, zb + 2).y + 2, zb + 2, 'campfire[lit=true,signal_fire=false]');
  partition(bp, 3, zb, 3, zb, 1, 2, null, [[3, zb]], tw.door);
  const keep0 = [...hall.cells, ...(hall.ends[0] ?? []), [cx, Z2 - 1], [3, zb + 1], [X1 + 2, zb + 2], [X1 + 1, zb + 3]];
  furnish(bp, rng, { x1: X1 + 1, z1: zb + 2, x2: X2 - 1, z2: zb + 3, y: 1, h: 3 }, 'kitchen', keep0, tw.name, { items: ['sink', 'counter', 'crafting', 'barrel', 'chest'], table: false });
  furnish(bp, rng, { x1: X1 + 1, z1: zb + 4, x2: X2 - 1, z2: Z2 - 1, y: 1, h: 3 }, 'stube', keep0, tw.name);
  const keep1 = [...hall.cells, ...(hall.ends[4] ?? [])];
  furnish(bp, rng, { x1: X1 + 2, z1: zb + 1, x2: X2 - 2, z2: Z2 - 1, y: 5, h: 2 }, 'twin', keep1, tw.name, { items: ['bed', 'bed2', 'chest', 'tub', 'wardrobe', 'plant'] });
  light(bp, { x1: X1 + 3, z1: zb + 3, x2: X2 - 3, z2: Z2 - 2, y: 5 });
  // Yard: path, hay cart, pasture, well.
  for (let z = Z2 + 1; z <= 16; z++) bp.set(cx, 0, z, 'dirt_path');
  for (const x of [9, 10]) {
    bp.set(x, 1, 16, `${tw.slab}[type=top]`);
    bp.set(x, 2, 16, 'hay_block[axis=x]');
    bp.set(x, 1, 15, 'dark_oak_trapdoor[facing=north,open=true,half=bottom]');
  }
  bp.set(11, 1, 16, tw.fence);
  bp.set(2, 1, 16, 'composter[level=0]');
  for (let z = 1; z <= 12; z++) {
    bp.set(13, 1, z, z === 7 ? `${tw.gate}[facing=east]` : tw.fence);
    bp.set(16, 1, z, tw.fence);
  }
  for (let x = 14; x <= 15; x++) {
    bp.set(x, 1, 1, tw.fence);
    bp.set(x, 1, 12, tw.fence);
  }
  bp.set(14, 1, 3, 'hay_block[axis=y]');
  bp.set(15, 1, 3, 'hay_block[axis=x]');
  bp.set(14, 2, 3, 'hay_block[axis=z]');
  bp.set(15, 1, 9, 'water_cauldron[level=3]');
  bp.set(14, 1, 9, 'water_cauldron[level=3]');
  sprinkleFlowers(bp, rng, 14, 2, 15, 11, 0.3, ['dandelion', 'oxeye_daisy', 'short_grass', 'short_grass', 'azure_bluet']);
  bp.fill(13, 0, 13, 15, 0, 15, 'cobblestone');
  bp.set(14, -1, 14, 'cobblestone');
  bp.set(14, 0, 14, 'water');
  for (const [x, z] of perimeter(13, 13, 15, 15)) bp.set(x, 1, z, 'mossy_cobblestone');
  for (const x of [13, 15]) bp.fill(x, 2, 14, x, 3, 14, tw.fence);
  for (let x = 13; x <= 15; x++) {
    bp.set(x, 4, 13, `${tw.stairs}[facing=south,half=bottom]`);
    bp.set(x, 4, 15, `${tw.stairs}[facing=north,half=bottom]`);
    bp.set(x, 4, 14, tw.planks);
  }
  bp.set(14, 5, 14, `${tw.slab}[type=bottom]`);
  bp.set(14, 3, 14, 'iron_chain[axis=y]');
  bp.set(14, 2, 14, 'lantern[hanging=true]');
  if (rng.chance(0.5)) bp.mirrorX();
  return bp;
}

// ================================================================ alpine hut (SAC-Hütte)

export function hut(rng) {
  const bp = new Blueprint();
  const x1 = 3, x2 = 13, z1 = 3, z2 = 10, cx = 8;
  const ix1 = x1 + 1, ix2 = x2 - 1, iz1 = z1 + 1, iz2 = z2 - 1;
  const rough = rubble(rng);
  const tw = WOOD(rng.pick(['spruce', 'dark_oak']));
  const roofMat = ROOFS[rng.pick(['stone', 'spruce', 'slate'])];
  bp.fill(x1, 0, z1, x2, 0, z2, 'cobblestone');
  bp.fill(ix1, 0, iz1, ix2, 0, iz2, tw.planks);
  bp.walls(x1, 1, z1, x2, 3, z2, rough);
  bp.fill(ix1, 4, iz1, ix2, 4, iz2, tw.planks);
  logRing(bp, x1, z1, x2, z2, 4, tw.log);
  bp.walls(x1, 5, z1, x2, 7, z2, (x, y, z) => ((x === x1 || x === x2) && (z === z1 || z === z2) ? `${tw.log}[axis=y]` : tw.planks));
  logRing(bp, x1, z1, x2, z2, 8, tw.log);
  const at = roof(bp, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 2, y: 8, mat: roofMat, kind: 'slabs', n: INF, s: INF, trim: { stairs: tw.stairs, slab: tw.slab } });
  closeUnder(bp, at, perimeter(x1, z1, x2, z2), 9, tw.planks, roofMat);
  // Red and white shutters (SAC colours).
  const shutterPair = (x, y, z, face) => {
    win(bp, rng, x, y, z, face, { h: 2 });
    const [ax, az] = along(face);
    const [dx, dz] = DIR[face];
    for (let j = 0; j < 2; j++) {
      bp.set(x - ax + dx, y + j, z - az + dz, `mangrove_trapdoor[facing=${face},open=true,half=bottom]`);
      bp.set(x + ax + dx, y + j, z + az + dz, `birch_trapdoor[facing=${face},open=true,half=bottom]`);
    }
  };
  for (const x of [cx - 3, cx + 3]) {
    shutterPair(x, 2, z2, 'south');
    shutterPair(x, 5, z2, 'south');
    shutterPair(x, 5, z1, 'north');
  }
  shutterPair(cx - 2, 2, z1, 'north');
  shutterPair(x1, 2, 7, 'west');
  shutterPair(x1, 5, 7, 'west');
  shutterPair(x2, 5, 6, 'east');
  bp.door(cx, 1, z2, tw.door, 'south');
  bp.set(cx, 3, z2 + 1, `${tw.sign}[facing=south]${signData(['', 'SAC', 'Berghuette', ''], 'red')}`);
  if (at(cx, z2).y - 9 >= 2) bp.set(cx, 9, z2, 'glass_pane');
  // Kitchen stove under the chimney, common room with long tables, stairs to the dormitory.
  const hall = stairHall(bp, { axis: 'z', laneA: [ix2 - 1], laneB: [ix2], u0: iz2, dir: -1, planes: [0, 4], wood: tw.name });
  bp.set(ix1, 1, iz1, 'smoker[facing=south,lit=true]');
  bp.set(ix1 + 1, 1, iz1, 'water_cauldron[level=3]');
  bp.set(ix1 + 2, 1, iz1, 'barrel[facing=up]');
  bp.set(ix1 + 3, 1, iz1, 'crafting_table');
  const ch = at(ix1, iz1);
  bp.fill(ix1, 2, iz1, ix1, ch.y + 1, iz1, 'cobblestone');
  bp.set(ix1, ch.y + 2, iz1, 'campfire[lit=true,signal_fire=false]');
  for (const tz of [iz1 + 2, iz1 + 4]) {
    for (let x = ix1 + 1; x <= ix1 + 4; x++) {
      bp.set(x, 1, tz, `${tw.slab}[type=top]`);
      bp.set(x, 1, tz - 1, `${tw.stairs}[facing=north,half=bottom]`);
    }
    bp.set(ix1 + 2, 2, tz, rng.pick(['candle[candles=3,lit=true]', 'potted_dandelion', 'lantern[hanging=false]']));
  }
  light(bp, { x1: ix1 + 1, z1: iz1 + 1, x2: ix1 + 4, z2: iz2, y: 1 });
  furnish(bp, rng, { x1: ix1, z1: iz1 + 1, x2: ix2 - 2, z2: iz2, y: 1, h: 3 }, 'common', [...hall.cells, ...(hall.ends[0] ?? []), [cx, iz2]], tw.name, { items: ['chest', 'clock', 'barrel', 'chiseled'], table: false });
  furnish(bp, rng, { x1: ix1, z1: iz1, x2: ix2 - 2, z2: iz2, y: 5, h: 3 }, 'dorm', [...hall.cells, ...(hall.ends[4] ?? [])], tw.name, { items: ['bunk', 'bunk2', 'bunk', 'chest', 'chest', 'barrel', 'sink'] });
  light(bp, { x1: ix1 + 2, z1: iz1 + 1, x2: ix2 - 3, z2: iz2 - 1, y: 5 });
  // Terrace with long tables.
  bp.fill(x1 - 1, 0, z2 + 1, x2 + 1, 0, z2 + 5, tw.planks);
  for (const tx of [x1 + 1, x2 - 3]) {
    for (let x = tx; x < tx + 3; x++) {
      bp.set(x, 1, z2 + 3, `${tw.slab}[type=top]`);
      bp.set(x, 1, z2 + 2, `${tw.slab}[type=bottom]`);
      bp.set(x, 1, z2 + 4, `${tw.slab}[type=bottom]`);
    }
    bp.set(tx + 1, 2, z2 + 3, rng.pick(['potted_dandelion', 'candle[candles=2,lit=true]', 'lantern[hanging=false]']));
  }
  // Flags, signpost, woodpile, trough, spruces, boulders.
  flagPole(bp, 15, 12, 8);
  flagPole(bp, 1, 12, 6, `white_banner[rotation=0]${pattern([['half_horizontal_bottom', 'red']])}`);
  bp.fill(1, 1, 15, 1, 3, 15, 'spruce_fence');
  bp.set(2, 3, 15, `bamboo_wall_sign[facing=east]${signData(['Wanderweg', 'Gipfel', '2 h 30 min', ''])}`);
  bp.set(0, 2, 15, `bamboo_wall_sign[facing=west]${signData(['Bergsee', '1 h 15 min', '', ''])}`);
  for (let z = z1 + 1; z <= z2 - 1; z++) if (!/glass/.test(bp.get(x2, 2, z) ?? '')) bp.setIfEmpty(x2 + 1, 1, z, `${rng.pick(['spruce_log', 'oak_log', 'birch_log'])}[axis=x]`);
  bp.set(x1 - 1, 1, z2 - 1, 'water_cauldron[level=3]');
  spruce(bp, 1, 1, rng.int(7, 9), 1);
  spruce(bp, 15, 2, rng.int(6, 8), 1);
  for (let i = 0; i < 4; i++) {
    const [bx, bz] = rng.pick([[15, 8], [13, 16], [0, 9], [5, 16], [15, 15], [9, 1]]);
    bp.setIfEmpty(bx, 1, bz, rng.pick(['cobblestone', 'mossy_cobblestone', 'andesite', 'stone']));
  }
  sprinkleFlowers(bp, rng, 0, 0, 16, 16, 0.14, ['azure_bluet', 'cornflower', 'dandelion', 'oxeye_daisy', 'short_grass', 'short_grass', 'allium', 'fern']);
  if (rng.chance(0.5)) bp.mirrorX();
  return bp;
}

// ================================================================ town square (city centre, 21x21 incl. street ring)

/** Market stall facing `face` (towards the square), 3x3 with a striped canopy. (x, z) = back-left corner cell. */
function marketStall(bp, rng, x0, z0, face) {
  const [colA, colB] = rng.pick([['red', 'white'], ['green', 'white'], ['blue', 'white'], ['yellow', 'white'], ['orange', 'white']]);
  const goods = ['pumpkin', 'melon', 'cake', 'hay_block[axis=y]', 'potted_red_tulip', 'potted_poppy', 'decorated_pot[facing=south]', 'barrel[facing=up]', 'carved_pumpkin[facing=south]'];
  const toFront = face === 'east' ? [1, 0] : [-1, 0];
  const frontX = face === 'east' ? x0 + 2 : x0;
  const backX = face === 'east' ? x0 : x0 + 2;
  for (let z = z0; z <= z0 + 2; z++) {
    bp.set(frontX, 1, z, z === z0 + 1 ? `spruce_slab[type=top]` : 'barrel[facing=up]');
    bp.set(frontX, 2, z, z === z0 + 1 ? rng.pick(goods.slice(0, 4)) : 'spruce_fence');
    bp.set(frontX, 3, z, 'spruce_fence');
    bp.fill(backX, 1, z, backX, 3, z, z === z0 + 1 ? null : 'spruce_fence');
    for (let x = x0; x <= x0 + 2; x++) bp.set(x, 4, z, `${(x + z) % 2 ? colA : colB}_wool`);
  }
  bp.set(backX, 1, z0 + 1, rng.pick(['chest[facing=' + face + ']', 'barrel[facing=up]']));
  bp.set(x0 + 1, 1, z0 + 1, rng.pick(['hay_block[axis=y]', 'barrel[facing=up]', 'composter[level=7]']));
  bp.set(x0 + 1, 2, z0 + 1, rng.pick(['potted_red_tulip', 'pumpkin', 'melon', 'cake']));
  bp.set(frontX + toFront[0], 1, z0 + 2, rng.pick(['potted_poppy', 'decorated_pot[facing=south]', 'hay_block[axis=y]']));
  bp.set(x0 + 1, 3, z0 + 1, 'lantern[hanging=true]');
}

export function square(rng) {
  const bp = new Blueprint();
  const c = 8;
  const r = (x, z) => Math.hypot(x - c, z - c);
  const ringA = rng.pick(['polished_andesite', 'polished_tuff', 'smooth_stone']);
  const accent = rng.pick(['polished_deepslate', 'polished_granite', 'polished_blackstone', 'tuff_bricks']);
  bp.fill(-2, 0, -2, 18, 0, 18, (x, y, z) => {
    const d = r(x, z);
    if (d > 4.6 && d <= 6.2) return ringA;
    if (Math.abs(d - 9) < 0.55) return accent;
    if ((x === c || z === c) && d > 6) return ringA;
    if (Math.abs(x - c) === Math.abs(z - c) && d > 6.2 && d < 12) return accent;
    return rng.weighted([['stone_bricks', 5], ['cobblestone', 1], ['andesite', 1], ['mossy_stone_bricks', 0.3]]);
  });
  // Fountain: round basin, column with Swiss flags and a copper figure, four spouts.
  for (let x = c - 5; x <= c + 5; x++)
    for (let z = c - 5; z <= c + 5; z++) {
      const d = r(x, z);
      if (d <= 3.6) {
        bp.set(x, -1, z, 'stone_bricks');
        bp.set(x, 0, z, 'water');
      } else if (d <= 4.6) {
        bp.set(x, 0, z, 'stone_bricks');
        bp.set(x, 1, z, (x - c) * (z - c) === 0 || Math.abs(x - c) === Math.abs(z - c) ? 'chiseled_stone_bricks' : 'polished_andesite');
      }
    }
  bp.set(c, 0, c, 'chiseled_stone_bricks');
  bp.set(c, 1, c, 'chiseled_stone_bricks');
  bp.fill(c, 2, c, c, 5, c, 'quartz_pillar[axis=y]');
  bp.set(c, 6, c, 'chiseled_quartz_block');
  for (const f of Object.keys(DIR)) {
    bp.set(c + DIR[f][0], 6, c + DIR[f][1], `red_wall_banner[facing=${f}]${SWISS_FLAG}`);
    bp.set(c + DIR[f][0], 3, c + DIR[f][1], `lightning_rod[facing=${f}]`);
    bp.set(c + 2 * DIR[f][0], 3, c + 2 * DIR[f][1], 'water');
  }
  bp.set(c, 7, c, `waxed_copper_golem_statue[copper_golem_pose=${rng.pick(['standing', 'star'])},facing=south]`);
  // Benches facing the fountain.
  bench(bp, c - 1, c - 7, 'north', 3, 'spruce');
  bench(bp, c - 1, c + 7, 'south', 3, 'spruce');
  bench(bp, c - 7, c - 1, 'west', 3, 'spruce');
  bench(bp, c + 7, c - 1, 'east', 3, 'spruce');
  // Lamps first, then corner lindens in planters.
  for (const [x, z] of [[4, 4], [12, 4], [4, 12], [12, 12]]) lamp(bp, x, z, 3, 'double');
  for (const [x, z] of [[0, 0], [16, 0], [0, 16], [16, 16]]) {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) bp.set(x + dx, 0, z + dz, 'grass_block');
    for (const [px, pz] of perimeter(x - 2, z - 2, x + 2, z + 2)) bp.setIfEmpty(px, 1, pz, 'stone_brick_slab[type=bottom]');
    broadTree(bp, x, z, 5, 2, rng.pick(['oak', 'oak', 'birch']), -2, 18);
    for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1], [0, 1], [1, 0], [-1, 0], [0, -1]]) bp.setIfEmpty(x + dx, 1, z + dz, rng.pick(['red_tulip', 'white_tulip', 'poppy']));
  }
  // Market stalls and flags.
  marketStall(bp, rng, -1, 4, 'east');
  marketStall(bp, rng, 15, 10, 'west');
  flagPole(bp, c, -1, 8);
  const [b1, d1] = rng.pick(CANTONS);
  const [b2, d2] = rng.pick(CANTONS);
  flagPole(bp, c - 3, -1, 6, `${b1}_banner[rotation=0]${d1}`);
  flagPole(bp, c + 3, -1, 6, `${b2}_banner[rotation=0]${d2}`);
  return bp;
}

// ================================================================ district plaza (cosy village square)

export function plaza(rng) {
  const bp = new Blueprint();
  const c = 8;
  const cob = () => rng.weighted([['cobblestone', 3], ['mossy_cobblestone', 1], ['stone_bricks', 1], ['andesite', 0.6]]);
  for (let x = -2; x <= 18; x++)
    for (let z = -2; z <= 18; z++) {
      const d = Math.max(Math.abs(x - c), Math.abs(z - c));
      const paved = (d <= 6 && Math.hypot(x - c, z - c) <= 7.9) || Math.abs(x - c) <= 1 || Math.abs(z - c) <= 1;
      bp.set(x, 0, z, paved ? cob() : 'grass_block');
    }
  // Village fountain: stone (or log) trough with a column, spout and geraniums.
  const wooden = rng.chance(0.35);
  for (const [x, z] of perimeter(6, 7, 10, 10)) bp.set(x, 1, z, wooden ? `stripped_spruce_log[axis=${z === 7 || z === 10 ? 'x' : 'z'}]` : rng.pick(['stone_bricks', 'stone_bricks', 'mossy_stone_bricks']));
  bp.fill(6, 0, 7, 10, 0, 10, 'stone_bricks');
  bp.fill(7, 1, 8, 9, 1, 9, 'water');
  bp.set(c, 2, 7, 'chiseled_stone_bricks');
  bp.set(c, 3, 7, wooden ? 'spruce_log[axis=y]' : 'stone_bricks');
  bp.set(c, 4, 7, 'chiseled_stone_bricks');
  bp.set(c, 5, 7, rng.pick(GERANIUMS));
  bp.set(c, 3, 8, 'lightning_rod[facing=south]');
  bp.set(c, 4, 6, `red_wall_banner[facing=north]${SWISS_FLAG}`);
  for (const x of [6, 10]) bp.set(x, 2, 10, rng.pick(GERANIUMS));
  // Linden with a round bench.
  const tx = rng.pick([3, 13]);
  const tz = 3;
  broadTree(bp, tx, tz, 5, 3, 'oak', -2, 18);
  for (const f of Object.keys(DIR)) bp.set(tx + DIR[f][0], 1, tz + DIR[f][1], `spruce_stairs[facing=${OPP[f]},half=bottom]`);
  for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) bp.set(tx + dx, 1, tz + dz, 'spruce_slab[type=bottom]');
  // Benches, lamps, flag.
  bench(bp, c - 1, 13, 'south', 3, 'spruce');
  lamp(bp, 4, 12, 3);
  lamp(bp, 12, 12, 3);
  flagPole(bp, 16 - tx, 2, 7);
  // Notice board.
  bp.fill(12, 1, 15, 12, 3, 15, 'spruce_log[axis=y]');
  bp.fill(14, 1, 15, 14, 3, 15, 'spruce_log[axis=y]');
  bp.fill(13, 2, 15, 13, 3, 15, 'spruce_planks');
  for (let x = 11; x <= 15; x++) {
    bp.set(x, 4, 15, 'spruce_slab[type=bottom]');
    bp.set(x, 4, 16, 'spruce_stairs[facing=north,half=bottom]');
  }
  const notes = [['GEMEINDE', 'Markt: Samstag', '8 - 12 Uhr', ''], ['Turnverein', 'Schwingfest', 'Sonntag 14 Uhr', ''], ['Chor', 'Probe Mittwoch', '', ''], ['Velo', 'zu verkaufen', '', '']];
  bp.set(12, 2, 16, `spruce_wall_sign[facing=south]${signData(rng.pick(notes))}`);
  bp.set(13, 3, 16, `spruce_wall_sign[facing=south]${signData(notes[0])}`);
  bp.set(14, 2, 16, `spruce_wall_sign[facing=south]${signData(rng.pick(notes.slice(1)))}`);
  // Planters with geraniums, a spruce, wild flowers on the grass.
  for (const [x, z] of [[4, 4], [12, 4]]) if (!bp.get(x, 1, z)) {
    bp.set(x, 1, z, 'barrel[facing=up]');
    bp.set(x, 2, z, rng.pick(GERANIUMS));
  }
  spruce(bp, 1, 15, rng.int(7, 9), 2, -2, 18);
  for (let x = -2; x <= 18; x++)
    for (let z = -2; z <= 18; z++) if (/grass_block/.test(bp.get(x, 0, z)) && !bp.get(x, 1, z) && rng.chance(0.22)) bp.set(x, 1, z, rng.pick(MEADOW));
  return bp;
}

// ================================================================ registry

export const BUILDINGS = { chalet, townhouse, cafe, church, clocktower, hotel, modern, apartment, farmhouse, hut };

/**
 * Building catalogue for the bridge. zones: relative weights per ring around the city centre
 * (core = old town, inner, outer, rural = villages and farms). unique: at most one per district / per city.
 */
export const CATALOG = {
  chalet: { label: 'Шале', zones: { inner: 2, outer: 5, rural: 4 } },
  townhouse: { label: 'Дом в старом городе', zones: { core: 8, inner: 5, outer: 1 } },
  cafe: { label: 'Кондитерская', zones: { core: 3, inner: 2, outer: 0.5 } },
  church: { label: 'Церковь', zones: { core: 1, inner: 1.5, outer: 1, rural: 0.6 }, unique: 'district' },
  clocktower: { label: 'Часовая башня', zones: { core: 2.5 }, unique: 'city' },
  hotel: { label: 'Гранд-отель', zones: { core: 1, inner: 2, outer: 1 }, unique: 'district' },
  modern: { label: 'Современный дом', zones: { inner: 2, outer: 4, rural: 1 } },
  apartment: { label: 'Кооперативный дом', zones: { inner: 3, outer: 3 } },
  farmhouse: { label: 'Эмментальская ферма', zones: { outer: 0.8, rural: 5 } },
  hut: { label: 'Альпийская хижина', zones: { rural: 2 } },
};

export const LABELS = { ...Object.fromEntries(Object.entries(CATALOG).map(([k, v]) => [k, v.label])), square: 'Главная площадь', plaza: 'Площадь района' };

export function generate(type, seed) {
  const rng = rngFrom(`${seed}:${type}`);
  return BUILDINGS[type](rng);
}
