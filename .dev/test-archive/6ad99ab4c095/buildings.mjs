// Swiss-style procedural buildings. Each generator draws into a 17x17 local frame
// (x, z in 0..16; y = 0 is the ground surface, the street is at z > 16 — the front faces +z / south).
// square() and plaza() may use the whole 21x21 frame (-2..18) including the street ring.
import { Blueprint, rngFrom } from './blueprint.mjs';

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
function deck(bp, rng, cells, y, { floor, rail = 'board', wood = 'spruce', isHouse, flowers = 0.7, bracket, railBlock }) {
  const key = (x, z) => `${x},${z}`;
  const S = new Set(cells.map(([x, z]) => key(x, z)));
  for (const [x, z] of cells) bp.set(x, y, z, floor);
  for (const [x, z] of cells) {
    const outs = Object.keys(DIR).filter((f) => !S.has(key(x + DIR[f][0], z + DIR[f][1])) && !isHouse(x + DIR[f][0], z + DIR[f][1]));
    if (outs.length) {
      let block;
      if (railBlock) block = railBlock;
      else if (outs.length > 1 || rail === 'fence') block = `${wood}_fence`;
      else block = `${wood}_trapdoor[facing=${OPP[outs[0]]},open=true,half=bottom]`;
      bp.set(x, y + 1, z, block);
      if (flowers && rng.chance(flowers)) bp.set(x, y + 2, z, rng.pick(GERANIUMS));
    }
    if (bracket) {
      const toHouse = Object.keys(DIR).find((f) => isHouse(x + DIR[f][0], z + DIR[f][1]));
      if (toHouse && (x + z) % 2 === 0) bp.setIfEmpty(x, y - 1, z, `${bracket}[facing=${toHouse},half=top]`);
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
  for (let i = 2; i <= h; i++) {
    const t = (h - i) / Math.max(1, h - 2);
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
        if (inPlot(x + dx, z + dz, lo, hi) && cy + dy > y0) bp.setIfEmpty(x + dx, cy + dy, z + dz, `${leaves}[persistent=true]`);
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

/** Simple furniture in a room; r = {x1, z1, x2, z2, y (first air layer), h}. keep = cells to leave clear (doors). */
function furnish(bp, rng, r, kind, keep = [], wood = 'spruce') {
  const { x1, z1, x2, z2, y } = r;
  const h = r.h ?? 3;
  if (x2 < x1 || z2 < z1) return;
  const near = (x, z) => keep.some(([kx, kz]) => Math.abs(kx - x) <= 1 && Math.abs(kz - z) <= 1);
  const free = (x, z, hh = 1) => {
    if (x < x1 || x > x2 || z < z1 || z > z2 || near(x, z)) return false;
    for (let i = 0; i < hh; i++) if (bp.get(x, y + i, z)) return false;
    return true;
  };
  const slots = [];
  for (let x = x1; x <= x2; x++) slots.push([x, z1, 'south']);
  for (let z = z1 + 1; z <= z2; z++) slots.push([x1, z, 'east'], [x2, z, 'west']);
  for (let x = x1 + 1; x < x2; x++) slots.push([x, z2, 'north']);
  let si = rng.int(0, slots.length - 1);
  const place = (fn) => {
    for (let k = 0; k < slots.length; k++) {
      const [x, z, f] = slots[(si + k) % slots.length];
      if (fn(x, z, f)) {
        si = (si + k + 2) % slots.length;
        return true;
      }
    }
    return false;
  };
  const one = (block, hh = 1) => (x, z, f) => {
    if (!free(x, z, hh)) return false;
    for (let i = 0; i < hh; i++) bp.set(x, y + i, z, typeof block === 'function' ? block(f, i) : block);
    return true;
  };
  const bed = (color) => (x, z, f) => {
    const fx = x + DIR[f][0];
    const fz = z + DIR[f][1];
    if (!free(x, z) || !free(fx, fz)) return false;
    bp.set(x, y, z, `${color}_bed[facing=${OPP[f]},part=head]`);
    bp.set(fx, y, fz, `${color}_bed[facing=${OPP[f]},part=foot]`);
    return true;
  };
  const items = {
    bed: bed(rng.pick(['red', 'red', 'white', 'light_gray', 'green', 'blue'])),
    bed2: bed(rng.pick(['red', 'white', 'yellow', 'cyan'])),
    bookshelf: one('bookshelf', Math.min(2, h - 1)),
    chest: one((f) => `chest[facing=${f}]`),
    barrel: one('barrel[facing=up]'),
    furnace: one((f) => `furnace[facing=${f},lit=false]`),
    smoker: one((f) => `smoker[facing=${f},lit=false]`),
    cauldron: one('water_cauldron[level=3]'),
    crafting: one('crafting_table'),
    stove: one(rng.pick(['green_terracotta', 'cyan_terracotta', 'white_terracotta', 'lime_terracotta']), 2),
    plant: one(() => rng.pick(HOUSE_PLANTS)),
    armchair: one((f) => `${wood}_stairs[facing=${OPP[f]},half=bottom]`),
    lectern: one((f) => `lectern[facing=${f}]`),
    loom: one((f) => `loom[facing=${f}]`),
    pot: one((f) => `decorated_pot[facing=${f}]`),
    clock: one((f, i) => (i === 0 ? `${wood}_planks` : `${wood}_trapdoor[facing=${OPP[f]},open=true,half=bottom]`), 2),
  };
  const lists = {
    living: ['stove', 'bookshelf', 'armchair', 'plant', 'chest', 'clock'],
    kitchen: ['smoker', 'cauldron', 'barrel', 'crafting', 'furnace', 'barrel'],
    bedroom: ['bed', 'chest', 'plant', 'bookshelf', 'armchair'],
    twin: ['bed', 'bed2', 'chest', 'plant'],
    shop: ['barrel', 'barrel', 'chest', 'bookshelf', 'pot', 'barrel'],
    office: ['lectern', 'bookshelf', 'bookshelf', 'chest', 'plant'],
    lobby: ['plant', 'plant', 'armchair', 'armchair', 'bookshelf', 'plant'],
    modern: ['bed', 'plant', 'bookshelf', 'plant'],
    farm: ['stove', 'smoker', 'cauldron', 'barrel', 'chest', 'loom'],
  };
  for (const it of lists[kind] ?? lists.living) place(items[it]);
  // Table with chairs in the middle, rug, hanging lantern.
  const cx = (x1 + x2) >> 1;
  const cz = (z1 + z2) >> 1;
  const withTable = kind !== 'bedroom' && kind !== 'twin' && kind !== 'modern';
  if (withTable && free(cx, cz) && x2 - x1 >= 2 && z2 - z1 >= 2) {
    bp.set(cx, y, cz, `${wood}_fence`);
    bp.set(cx, y + 1, cz, `${wood}_pressure_plate`);
    for (const f of Object.keys(DIR)) if (rng.chance(0.8) && free(cx + DIR[f][0], cz + DIR[f][1])) bp.set(cx + DIR[f][0], y, cz + DIR[f][1], `${wood}_stairs[facing=${f},half=bottom]`);
  } else if (kind === 'bedroom' || kind === 'twin' || kind === 'modern' || kind === 'lobby') {
    const rug = kind === 'lobby' ? 'red_carpet' : rng.pick(['red_carpet', 'white_carpet', 'light_gray_carpet', 'brown_carpet', 'green_carpet']);
    for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz; z++) if (free(x, z) && bp.get(x, y - 1, z)) bp.set(x, y, z, rug);
  }
  const ceil = bp.get(cx, y + h, cz);
  if (ceil && !/slab\[type=top|stairs|trapdoor|glass|pane|leaves|fence/.test(ceil) && !bp.get(cx, y + h - 1, cz)) bp.set(cx, y + h - 1, cz, 'lantern[hanging=true]');
}

// ================================================================ chalet (Bernese Oberland)

export function chalet(rng) {
  const bp = new Blueprint();
  const W = rng.weighted([[9, 3], [11, 4], [13, 2]]);
  const D = rng.pick([9, 11]);
  const x1 = (INNER - W) >> 1;
  const x2 = x1 + W - 1;
  const cx = 8;
  const z2 = 11;
  const z1 = z2 - D + 1;
  const tw = WOOD(rng.weighted([['spruce', 5], ['dark_oak', 4], ['oak', 1]]));
  const trimW = WOOD(tw.name === 'dark_oak' ? rng.pick(['spruce', 'oak', 'birch']) : rng.pick(['dark_oak', 'spruce', 'birch']));
  const logWalls = rng.chance(0.55);
  const isCorner = (x, z) => (x === x1 || x === x2) && (z === z1 || z === z2);
  const timber = (x, y, z) => (isCorner(x, z) ? `${tw.log}[axis=y]` : logWalls ? `${tw.stripped}[axis=${z === z1 || z === z2 ? 'x' : 'z'}]` : tw.planks);
  const stone = stoneMix(rng);
  const plasterBase = rng.chance(0.45);
  const plaster = rng.pick(['calcite', 'calcite', 'smooth_quartz', 'white_terracotta']);
  const nUp = W >= 11 && rng.chance(0.45) ? 2 : 1;
  const steep = rng.chance(0.4);
  const roofMat = ROOFS[rng.weighted([['spruce', 3], ['dark_oak', 3], ['slate', 3], ['stone', 1]])];
  const shutter = rng.chance(0.75) ? rng.weighted(SHUTTERS) : null;
  const rail = rng.weighted([['board', 5], ['fence', 2]]);
  const leanTo = W <= 11 && rng.chance(0.45);
  const sideDeck = !leanTo && W <= 11 && rng.chance(0.4);
  const isHouse = (x, z) => x >= x1 && x <= x2 && z >= z1 && z <= z2;

  // Foundation and ground floor (masonry or whitewashed plaster on a stone plinth).
  bp.fill(x1, 0, z1, x2, 0, z2, 'stone_bricks');
  bp.fill(x1 + 1, 0, z1 + 1, x2 - 1, 0, z2 - 1, tw.planks);
  bp.walls(x1, 1, z1, x2, 3, z2, (x, y, z) => (!plasterBase || y === 1 || isCorner(x, z) ? stone() : plaster));
  // Timber storeys (Strickbau) on dark beams.
  for (let u = 0; u < nUp; u++) {
    const yb = 4 + 4 * u;
    bp.fill(x1 + 1, yb, z1 + 1, x2 - 1, yb, z2 - 1, tw.planks);
    logRing(bp, x1, z1, x2, z2, yb, tw.log);
    bp.walls(x1, yb + 1, z1, x2, yb + 3, z2, timber);
  }
  const yTop = 4 + 4 * nUp;
  bp.fill(x1 + 1, yTop, z1 + 1, x2 - 1, yTop, z2 - 1, tw.planks);
  logRing(bp, x1, z1, x2, z2, yTop, tw.log);

  // ---- windows
  const gx = W === 9 ? [[cx - 2, 1], [cx + 2, 1]] : W === 11 ? [[cx - 3, 1], [cx + 3, 1]] : [[cx - 4, 2], [cx + 3, 2]];
  for (const [x, w] of gx) win(bp, rng, x, 2, z2, 'south', { w, h: 2, shutters: shutter });
  for (const x of [cx - 2, cx + 2]) win(bp, rng, x, 2, z1, 'north', { h: 2, shutters: shutter });
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
    for (const x of [cx - 2, cx + 2]) win(bp, rng, x, yb + 1, z1, 'north', { h: 2, shutters: shutter, box: trimW.trapdoor });
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
  doorway(bp, cx, 1, z2, 'south', tw.door, {});
  wallLamp(bp, cx + 1, 3, z2, 'south', trimW.fence);
  wallLamp(bp, cx - 1, 3, z2, 'south', trimW.fence);

  // ---- lean-to woodshed (Schopf) on the east side
  if (leanTo) {
    const [za, zb] = leanZ;
    const xa = x2 + 1;
    const xb = Math.min(16, x2 + 3);
    for (let z = za; z <= zb; z++) {
      bp.fill(xb, 1, z, xb, 3, z, z === zb ? `${tw.log}[axis=y]` : `${tw.stripped}[axis=y]`);
      for (let x = xa; x <= xb; x++) {
        const d = xb - x;
        bp.set(x, 4 + (d >> 1), z, `${roofMat.slab}[type=${d % 2 ? 'top' : 'bottom'}]`);
      }
    }
    for (let x = xa; x < xb; x++) bp.fill(x, 1, za, x, 3, za, `${tw.stripped}[axis=y]`);
    for (let x = xa; x < xb; x++)
      for (let z = za + 1; z <= zb; z++)
        for (let y = 1; y <= 2; y++) if (z < zb || y === 1) bp.set(x, y, z, `${rng.pick(['oak_log', 'birch_log', 'spruce_log'])}[axis=z]`);
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

  // ---- roof: wide overhang, gable to the street, decorative barge boards
  const R = { x1: x1 - 2, x2: x2 + 2, z1: z1 - 1, z2: z2 + 3 };
  const at = roof(bp, { ...R, y: steep ? yTop - 1 : yTop, mat: roofMat, kind: steep ? 'stairs' : 'slabs', n: INF, s: INF, trim: { stairs: trimW.stairs, slab: trimW.slab } });
  closeUnder(bp, at, perimeter(x1, z1, x2, z2), yTop + 1, tw.planks, roofMat);
  for (const x of [x1, x2, x1 + 2, x2 - 2]) {
    const c = at(x, z2 + 1);
    bp.setIfEmpty(x, c.y - 1, z2 + 1, `${trimW.stairs}[facing=north,half=top]`);
  }
  // Gable: windows, attic balcony on steep roofs, Swiss flag under the ridge.
  const room = (x) => at(x, z2).y - (yTop + 1);
  if (steep && room(cx) >= 4) {
    const cells = [];
    for (let x = x1 + 2; x <= x2 - 2; x++) if (room(x) >= 3) cells.push([x, z2 + 1]);
    deck(bp, rng, cells, yTop, { floor: `${trimW.slab}[type=top]`, rail, wood: trimW.name, isHouse, flowers: 0.6 });
    bp.door(cx, yTop + 1, z2, tw.door, 'south');
    for (const x of [cx - 2, cx + 2]) if (room(x) >= 3) win(bp, rng, x, yTop + 1, z2, 'south', { h: 2 });
    if (room(cx) >= 5) bp.set(cx, yTop + 4, z2 + 1, `red_wall_banner[facing=south]${SWISS_FLAG}`);
  } else if (W >= 11) {
    bp.set(cx, yTop + 2, z2 + 1, `red_wall_banner[facing=south]${SWISS_FLAG}`);
    for (const x of [cx - 2, cx + 2]) if (room(x) >= 1) win(bp, rng, x, yTop + 1, z2, 'south', { h: Math.min(2, room(x)) });
  } else if (room(cx) >= 1) win(bp, rng, cx, yTop + 1, z2, 'south', { h: Math.min(2, room(cx)) });
  // Chimney with smoke.
  const chx = x2 - 2;
  const chz = z1 + 2;
  const ch = at(chx, chz);
  bp.fill(chx, yTop + 1, chz, chx, ch.y + 1, chz, rng.pick(['cobblestone', 'stone_bricks', 'bricks']));
  bp.set(chx, ch.y + 2, chz, 'campfire[lit=true,signal_fire=false]');

  // ---- interior
  furnish(bp, rng, { x1: x1 + 1, z1: z1 + 1, x2: x2 - 1, z2: z2 - 1, y: 1, h: 3 }, rng.pick(['living', 'kitchen']), [[cx, z2 - 1]], tw.name);
  for (let u = 0; u < nUp; u++) furnish(bp, rng, { x1: x1 + 1, z1: z1 + 1, x2: x2 - 1, z2: z2 - 1, y: 5 + 4 * u, h: 3 }, u ? 'twin' : 'bedroom', [[cx, z2 - 1]], tw.name);

  // ---- garden
  const pathKind = rng.pick(['dirt_path', 'gravel', 'stones']);
  for (let z = z2 + 1; z <= 16; z++) bp.set(cx, 0, z, pathKind === 'stones' ? (z % 2 ? 'cobblestone' : 'mossy_cobblestone') : pathKind);
  bench(bp, cx + 2, z2 + 1, 'north', 2, trimW.name);
  for (let x = x1; x <= cx - 2; x++) bp.setIfEmpty(x, 1, z2 + 1, rng.pick(BOX_FLOWERS));
  const fenceStyle = rng.weighted([['picket', 5], ['none', 2], ['stone', 1.5]]);
  if (fenceStyle === 'picket') plotFence(bp, [cx], trimW.fence, trimW.gate, { back: false, fromZ: z2 - 2 });
  if (fenceStyle === 'stone') for (let x = 0; x <= 16; x++) if (x !== cx) bp.setIfEmpty(x, 1, 16, 'cobblestone_wall');
  // Woodpile under the west eave.
  for (let z = z1 + 1; z <= z2 - 1; z++) {
    bp.setIfEmpty(x1 - 1, 1, z, `${rng.pick(['oak_log', 'birch_log', 'spruce_log'])}[axis=x]`);
    if (rng.chance(0.7)) bp.setIfEmpty(x1 - 1, 2, z, `${rng.pick(['oak_log', 'birch_log', 'spruce_log'])}[axis=x]`);
  }
  if (rng.chance(0.6)) flagPole(bp, rng.chance(0.5) ? 1 : 15, 15, 6);
  if (x1 >= 4) {
    spruce(bp, 1, z1 + 1, rng.int(7, 9), 1);
    if (!leanTo && !sideDeck) spruce(bp, 15, z1 + 1, rng.int(6, 8), 1);
    if (rng.chance(0.6)) {
      const crop = rng.pick(['carrots[age=7]', 'potatoes[age=7]', 'wheat[age=7]', 'beetroots[age=3]']);
      for (let z = z2 + 2; z <= 15; z++)
        for (let x = 1; x <= 2; x++)
          if (!bp.get(x, 1, z)) {
            bp.set(x, 0, z, 'farmland[moisture=7]');
            bp.set(x, 1, z, crop);
          }
    }
  }
  sprinkleFlowers(bp, rng, 1, z2 + 3, 15, 15, 0.15);
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
  };
}

/** Front window columns for an old-town facade: [{x, w, sh}]. Shuttered windows get room for their shutters. */
function windowLayout(x1, x2, shutters) {
  const cx = (x1 + x2) >> 1;
  const W = x2 - x1 + 1;
  if (!shutters) return [cx - 3, cx, cx + 3].map((x) => ({ x, w: 1, sh: false }));
  if (W <= 9) return [{ x: cx - 2, w: 1, sh: true }, { x: cx + 2, w: 1, sh: true }];
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

/** Upper storeys (band, 2 window rows, lintel) and roof of an old-town house. Ground storey is drawn by the caller. */
function oldTownBody(bp, rng, o) {
  const { x1, x2, z1, z2, floors, P, gableFront, oriel = false, boxes = true, noLow = false, g = 3 } = o;
  const winX = o.winX ?? windowLayout(x1, x2, !!P.shutter);
  const cx = (x1 + x2) >> 1;
  const yb = (f) => g + 1 + 4 * f;
  const wallTop = g + 4 * floors;
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
    bp.fill(x1 + 1, yb(f), z1 + 1, x2 - 1, yb(f), z2 - 1, 'spruce_planks');
  }
  bp.fill(x1 + 1, wallTop + 1, z1 + 1, x2 - 1, wallTop + 1, z2 - 1, 'spruce_planks');

  // Windows.
  const oTop = oriel && floors >= 2 ? floors - 2 : -1;
  const lintel = (ax) => (fach ? `${P.beam.log}[axis=${ax}]` : P.trim.block);
  const sill = fach ? P.beam.stairs : undefined;
  const sideZ = z2 - z1 >= 9 ? [z1 + 2, zc, z2 - 2] : [z1 + 2, z2 - 2];
  for (let f = 0; f < floors; f++) {
    const y = yb(f) + 1;
    for (const { x, w, sh } of winX) {
      const inOriel = oTop >= 0 && Math.abs(x - cx) <= 1 && f <= oTop + 1;
      const low = noLow && f === 0;
      win(bp, rng, x, y, z2, 'south', {
        w, h: 2, lintel: lintel('x'), shutters: inOriel || !sh ? null : P.shutter, frame: !fach && !sh && !inOriel && P.style === 'painted' ? P.trim.block : undefined,
        box: !inOriel && !low && boxes && f <= 1 ? P.box : undefined, sill: inOriel || low ? undefined : sill,
      });
      win(bp, rng, x, y, z1, 'north', { w, h: 2, lintel: lintel('x'), shutters: sh ? P.shutter : null, sill });
    }
    for (const z of sideZ) {
      win(bp, rng, x1, y, z, 'west', { h: 2, lintel: lintel('z'), shutters: P.shutter, sill });
      win(bp, rng, x2, y, z, 'east', { h: 2, lintel: lintel('z'), shutters: P.shutter, sill });
    }
  }
  // Oriel (Erker) over one or more storeys.
  if (oTop >= 0) {
    for (let f = 0; f <= oTop; f++)
      for (let x = cx - 1; x <= cx + 1; x++) {
        bp.set(x, yb(f), z2 + 1, fach ? `${P.beam.log}[axis=x]` : P.trim.block);
        bp.set(x, yb(f) + 1, z2 + 1, 'glass_pane');
        bp.set(x, yb(f) + 2, z2 + 1, 'glass_pane');
        bp.set(x, yb(f) + 3, z2 + 1, fach ? `${P.beam.log}[axis=x]` : x === cx ? P.trim.block : P.plaster);
        bp.set(x, yb(f) + 1, z2, null);
        bp.set(x, yb(f) + 2, z2, null);
      }
    for (let x = cx - 1; x <= cx + 1; x++) {
      bp.set(x, yb(0) - 1, z2 + 1, `${P.trim.stairs}[facing=north,half=top]`);
      bp.set(x, yb(oTop + 1), z2 + 1, `${ROOFS.copper.stairs}[facing=north,half=bottom]`);
    }
  }

  // Roof.
  const trim = { stairs: P.eave.stairs, slab: P.eave.slab };
  let at;
  if (!gableFront) {
    at = roof(bp, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 1, y: wallTop, mat: P.roof, w: INF, e: INF, trim, brackets: P.eave.stairs });
    closeUnder(bp, at, perimeter(x1, z1, x2, z2), wallTop + 1, fach ? (x, y, z) => (z === zc ? `${P.beam.log}[axis=y]` : P.plaster) : P.plaster, P.roof);
    for (const x of [x1, x2]) if (at(x, zc).y - wallTop >= 4) win(bp, rng, x, wallTop + 2, zc, x === x1 ? 'west' : 'east', { h: 2, shutters: P.shutter });
    const dx = x2 - x1 >= 10 ? [cx - 3, cx + 3] : [cx];
    for (const x of dx) dormer(bp, at, x, z2 - 1, P.plaster, P.roof);
  } else {
    at = roof(bp, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 1, y: wallTop, mat: P.roof, n: INF, s: INF, trim, brackets: P.eave.stairs });
    closeUnder(bp, at, perimeter(x1, z1, x2, z2), wallTop + 1,
      fach ? (x, y, z) => (x === cx ? `${P.beam.log}[axis=y]` : y === wallTop + 3 ? `${P.beam.log}[axis=x]` : P.plaster) : P.plaster, P.roof);
    for (const z of [z1, z2]) {
      const face = z === z2 ? 'south' : 'north';
      for (const x of [cx - 2, cx + 2]) if (at(x, z).y - wallTop >= 3) win(bp, rng, x, wallTop + 1, z, face, { h: 2, shutters: P.shutter, lintel: lintel('x') });
      if (at(cx, z).y - wallTop >= 6) win(bp, rng, cx, wallTop + 4, z, face, { h: 1, lintel: lintel('x') });
    }
  }
  // Chimneys.
  for (const chx of rng.chance(0.5) ? [x1 + 1, x2 - 1] : [rng.pick([x1 + 1, x2 - 1])]) {
    const ch = at(chx, z1 + 2);
    bp.fill(chx, wallTop + 1, z1 + 2, chx, ch.y + 1, z1 + 2, 'bricks');
    bp.set(chx, ch.y + 2, z1 + 2, rng.chance(0.4) ? 'campfire[lit=true,signal_fire=false]' : 'brick_slab[type=bottom]');
  }
  // Flag on the corner under the eaves.
  const [base, data] = rng.chance(0.5) ? ['red', SWISS_FLAG] : rng.pick(CANTONS);
  if (!bp.get(x1, wallTop - 1, z2 + 1) && !bp.get(x1, wallTop - 2, z2 + 1)) bp.set(x1, wallTop - 1, z2 + 1, `${base}_wall_banner[facing=south]${data}`);
  // Rooms.
  const kinds = ['living', 'bedroom', 'kitchen', 'office', 'twin'];
  for (let f = 0; f < floors; f++)
    furnish(bp, rng, { x1: x1 + 1, z1: z1 + 1, x2: x2 - 1, z2: z2 - 1, y: yb(f) + 1, h: 3 }, f === 0 ? rng.pick(['living', 'office']) : rng.pick(kinds), [], 'spruce');
  return { at, wallTop, cx };
}

// ---------------------------------------------------------------- townhouse

export function townhouse(rng) {
  const bp = new Blueprint();
  const style = rng.weighted([['lauben', 4], ['painted', 4], ['fachwerk', 2]]);
  const P = oldTownPalette(rng, style);
  const W = rng.pick([9, 11]);
  const x1 = (INNER - W) >> 1;
  const x2 = x1 + W - 1;
  const cx = 8;
  const z1 = 3;
  const z2 = 12;
  const floors = rng.pick([2, 3, 3]);
  const gableFront = style !== 'lauben' && rng.chance(0.45);
  const isCorner = (x, z) => (x === x1 || x === x2) && (z === z1 || z === z2);
  const [shopA, shopB] = rng.pick(SHOPS);
  const wood = rng.pick(['spruce', 'dark_oak']);

  bp.fill(x1, 0, z1, x2, 0, z2, 'polished_andesite');
  bp.fill(x1 + 1, 0, z1 + 1, x2 - 1, 0, z2 - 1, `${wood}_planks`);
  let shopZ = z2;
  if (style === 'lauben') {
    // Arcade (Lauben): sandstone arches in front, shop front set back three blocks.
    shopZ = z2 - 3;
    bp.walls(x1, 1, z1, x2, 3, shopZ, P.trim.block);
    for (let z = shopZ + 1; z <= z2; z++) {
      bp.set(x1, 3, z, P.trim.block);
      bp.set(x2, 3, z, P.trim.block);
      bp.set(x1, 0, z, 'polished_andesite');
      for (let x = x1 + 1; x < x2; x++) bp.set(x, 0, z, (x + z) % 2 ? 'polished_andesite' : 'stone_bricks');
    }
    bp.fill(x1, 1, z2, x1, 2, z2, P.trim.block);
    bp.fill(x2, 1, z2, x2, 2, z2, P.trim.block);
    bp.set(x1, 2, z2 - 1, `${P.trim.stairs}[facing=north,half=top]`);
    bp.set(x2, 2, z2 - 1, `${P.trim.stairs}[facing=north,half=top]`);
    bp.set(x1, 2, shopZ + 1, `${P.trim.stairs}[facing=south,half=top]`);
    bp.set(x2, 2, shopZ + 1, `${P.trim.stairs}[facing=south,half=top]`);
    bp.fill(x1, 3, z2, x2, 3, z2, P.trim.block);
    bp.fill(cx, 1, z2, cx, 2, z2, P.trim.block);
    for (const p of [x1, cx, x2]) {
      if (p > x1) bp.set(p - 1, 2, z2, `${P.trim.stairs}[facing=east,half=top]`);
      if (p < x2) bp.set(p + 1, 2, z2, `${P.trim.stairs}[facing=west,half=top]`);
    }
    for (const x of [(x1 + cx) >> 1, (cx + x2 + 1) >> 1]) bp.set(x, 3, z2 - 1, 'lantern[hanging=true]');
    const [bb, bd] = rng.pick(CANTONS);
    bp.set(cx, 2, z2 + 1, `${bb}_wall_banner[facing=south]${bd}`);
    for (let x = x1 + 1; x < x2; x++) if (Math.abs(x - cx) > 0) bp.fill(x, 1, shopZ, x, 2, shopZ, 'glass_pane');
    doorway(bp, cx, 1, shopZ, 'south', wood);
    bp.set(cx + 2, 3, shopZ + 1, `${wood}_wall_sign[facing=south]${signData(['', shopA, shopB, ''])}`);
  } else {
    bp.walls(x1, 1, z1, x2, 3, z2, (x, y, z) => (isCorner(x, z) || y === 1 ? P.trim.block : style === 'fachwerk' && y === 3 ? `${P.beam.log}[axis=${z === z1 || z === z2 ? 'x' : 'z'}]` : P.plaster));
    const w = cx - 2 - (x1 + 1) + 1;
    win(bp, rng, x1 + 1, 2, z2, 'south', { w, h: 2, frame: undefined });
    win(bp, rng, cx + 2, 2, z2, 'south', { w, h: 2 });
    doorway(bp, cx, 1, z2, 'south', wood, { frame: P.trim.block, transom: 'glass_pane' });
    bp.set(x2, 3, z2 + 1, `${wood}_wall_hanging_sign[facing=east]${signData([shopA, shopB, '', ''])}`);
    for (const x of [x1 + 1, x2 - 1]) bp.set(x, 1, z2 + 1, rng.pick(['barrel[facing=up]', 'decorated_pot[facing=south]', 'potted_azalea_bush']));
    win(bp, rng, x1, 2, (z1 + z2) >> 1, 'west', { h: 2, shutters: P.shutter });
    win(bp, rng, x2, 2, (z1 + z2) >> 1, 'east', { h: 2, shutters: P.shutter });
  }
  win(bp, rng, cx - 2, 2, z1, 'north', { h: 2, shutters: P.shutter });
  furnish(bp, rng, { x1: x1 + 1, z1: z1 + 1, x2: x2 - 1, z2: shopZ - 1, y: 1, h: 3 }, 'shop', [[cx, shopZ - 1]], wood);

  oldTownBody(bp, rng, { x1, x2, z1, z2, floors, P, gableFront, oriel: floors >= 2 && rng.chance(0.55) });

  // Street in front: paving, planters, lamp.
  bp.fill(0, 0, z2 + 1, 16, 0, 16, paving(rng));
  if (style !== 'lauben') bp.set(cx, 0, z2 + 1, 'polished_andesite');
  planter(bp, x1 - 2, 15, wood);
  planter(bp, x2 + 2, 15, wood);
  if (rng.chance(0.6)) lamp(bp, rng.pick([1, 15]), 14, 3, 'simple');
  if (style === 'lauben' && rng.chance(0.6)) bench(bp, x1 - 1, z2 - 4, 'west', 2, wood);
  sprinkleFlowers(bp, rng, 0, 0, 16, z1 - 2, 0.1);
  if (rng.chance(0.5)) bp.mirrorX();
  return bp;
}

// ---------------------------------------------------------------- café / Konditorei

export function cafe(rng) {
  const bp = new Blueprint();
  const style = rng.weighted([['painted', 5], ['fachwerk', 1.5]]);
  const P = oldTownPalette(rng, style, [['pink_terracotta', 3], ['white_terracotta', 3], ['calcite', 2], ['smooth_sandstone', 2], ['lime_terracotta', 1], ['light_blue_terracotta', 0.4], ['yellow_terracotta', 1.2]]);
  const W = rng.pick([9, 11]);
  const x1 = (INNER - W) >> 1;
  const x2 = x1 + W - 1;
  const cx = 8;
  const z1 = 3;
  const z2 = 10;
  const floors = rng.pick([1, 2, 2]);
  const wood = rng.pick(['spruce', 'dark_oak', 'cherry']);
  const [colA, colB] = rng.pick([['red', 'white'], ['green', 'white'], ['pink', 'white'], ['blue', 'white'], ['yellow', 'white'], ['brown', 'yellow']]);
  const name = rng.pick(['CAFE', 'KONDITOREI', 'CONFISERIE', 'TEA ROOM']);
  const owner = rng.pick(['Sprungli', 'Bachmann', 'Huber', 'Steiner', 'Meier', 'Brunner', 'Keller', 'Frey']);
  const isCorner = (x, z) => (x === x1 || x === x2) && (z === z1 || z === z2);

  // Shop ground floor with big display windows.
  bp.fill(x1, 0, z1, x2, 0, z2, 'polished_andesite');
  bp.fill(x1 + 1, 0, z1 + 1, x2 - 1, 0, z2 - 1, (x, y, z) => ((x + z) % 2 ? 'white_concrete' : 'black_concrete'));
  bp.walls(x1, 1, z1, x2, 4, z2, (x, y, z) => (isCorner(x, z) || y === 1 ? P.trim.block : P.plaster));
  const w = cx - 2 - (x1 + 1) + 1;
  win(bp, rng, x1 + 1, 2, z2, 'south', { w, h: 2, lintel: P.trim.block });
  win(bp, rng, cx + 2, 2, z2, 'south', { w, h: 2, lintel: P.trim.block });
  doorway(bp, cx, 1, z2, 'south', wood, { frame: P.trim.block, transom: 'glass_pane' });
  win(bp, rng, x1, 2, z1 + 3, 'west', { h: 2, w: 2 });
  win(bp, rng, x2, 2, z1 + 3, 'east', { h: 2, w: 2 });
  // Striped awnings over both windows; shop sign above the door.
  for (let x = x1; x <= x2; x++) {
    if (Math.abs(x - cx) <= 1) continue;
    const c = (x % 2 ? colA : colB);
    bp.set(x, 4, z2 + 1, `${wood}_trapdoor[facing=south,half=top]`);
    bp.set(x, 5, z2 + 1, `${c}_carpet`);
    bp.set(x, 3, z2 + 2, `${wood}_trapdoor[facing=south,half=top]`);
    bp.set(x, 4, z2 + 2, `${c}_carpet`);
  }
  bp.set(cx, 4, z2 + 1, `${wood}_wall_sign[facing=south]${signData(['', name, owner, ''], 'brown')}`);
  wallLamp(bp, cx - 1, 4, z2, 'south', `${wood}_fence`);
  wallLamp(bp, cx + 1, 4, z2, 'south', `${wood}_fence`);
  // Cakes in the shop window and on the counter.
  for (let x = x1 + 1; x <= x2 - 1; x++) {
    if (Math.abs(x - cx) <= 1) continue;
    bp.set(x, 1, z2 - 1, 'smooth_quartz_slab[type=top]');
    bp.set(x, 2, z2 - 1, rng.chance(0.6) ? 'cake' : rng.pick(['candle[candles=3,lit=true]', 'potted_red_tulip', 'decorated_pot[facing=south]']));
  }
  for (let x = x1 + 2; x <= x2 - 2; x++) {
    bp.set(x, 1, z1 + 2, x === x1 + 2 || x === x2 - 2 ? `${wood}_planks` : 'smooth_quartz_slab[type=top]');
    if (x !== x1 + 2 && x !== x2 - 2 && rng.chance(0.5)) bp.set(x, 2, z1 + 2, 'cake');
    bp.set(x, 1, z1 + 1, rng.pick(['barrel[facing=up]', `${wood}_shelf[facing=south]`, 'smoker[facing=south,lit=true]']));
  }
  for (const x of [x1 + 2, x2 - 2]) {
    bp.set(x, 1, z2 - 3, `${wood}_fence`);
    bp.set(x, 2, z2 - 3, 'white_carpet');
    bp.set(x - 1, 1, z2 - 3, `${wood}_stairs[facing=west,half=bottom]`);
    bp.set(x + 1, 1, z2 - 3, `${wood}_stairs[facing=east,half=bottom]`);
  }
  for (const x of [x1 + 3, x2 - 3]) bp.set(x, 4, z2 - 3, 'lantern[hanging=true]');
  bp.set(cx, 4, z1 + 3, 'lantern[hanging=true]');

  oldTownBody(bp, rng, { x1, x2, z1, z2, floors, P, gableFront: rng.chance(0.5), noLow: true, g: 4 });
  if (!bp.get(x1, 7, z2 + 1) && !bp.get(x1, 6, z2 + 1)) bp.set(x1, 7, z2 + 1, `${wood}_wall_hanging_sign[facing=west]${signData(['', name, '', ''])}`);

  // Terrace with parasols.
  bp.fill(0, 0, z2 + 1, 16, 0, 16, (x, y, z) => ((x + z) % 3 === 0 ? 'polished_andesite' : 'stone_bricks'));
  const tables = W === 9 ? [[2, 14], [8, 15], [14, 14]] : [[2, 14], [14, 14]];
  for (const [tx, tz] of tables) {
    bp.fill(tx, 1, tz, tx, 3, tz, `${wood}_fence`);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const c = (dx + dz + 2) % 2 ? colA : colB;
        if (dx || dz) bp.set(tx + dx, 4, tz + dz, `${wood}_trapdoor[facing=south,half=top]`);
        else bp.set(tx, 4, tz, `${c}_wool`);
        bp.set(tx + dx, 5, tz + dz, `${c}_carpet`);
      }
    for (const f of Object.keys(DIR)) if (inPlot(tx + DIR[f][0], tz + DIR[f][1]) && rng.chance(0.85)) bp.setIfEmpty(tx + DIR[f][0], 1, tz + DIR[f][1], `${wood}_stairs[facing=${f},half=bottom]`);
  }
  bp.set(cx + 2, 1, z2 + 3, `${wood}_sign[rotation=0]${signData(['Kaffee', 'Kuchen', 'Torten', 'Glace'], 'brown')}`);
  for (const x of [1, 15]) for (let z = z2 + 2; z <= 15; z += 3) if (!bp.get(x, 1, z)) planter(bp, x, z, wood, rng.pick(['flowering_azalea', 'azalea']));
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
  const { x1, z1, size = 5, h, front = 'south', wall, quoin, spire, roofMat, bellFloor = true, clock = true, door } = o;
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
    bp.set(x1, y, cz, 'glass_pane');
    bp.set(x2, y, cz, 'glass_pane');
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
  for (const bz of [nz1 + 1, nz1 + 4, nz1 + 7]) {
    for (const [x, face] of [[nx1, 'west'], [nx2, 'east']]) {
      win(bp, rng, x, 2, bz, face, { w: 2, h: 4, glass });
      bp.set(x, 6, bz, `stone_brick_stairs[facing=north,half=top]`);
      bp.set(x, 6, bz + 1, `stone_brick_stairs[facing=south,half=top]`);
    }
  }
  const inTower = (x, z) => (sideTower ? x >= 1 && x <= 5 && z >= 9 && z <= 13 : x >= 6 && x <= 10 && z >= nz2);
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
      bp.set(cx + dx, yc + dy, z, `stone_brick_stairs[facing=${f},half=${half}]`);
  };
  if (sideTower) rose(nz2, 'south');
  bp.set(cx, H + 3, nz1, glass());
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
  for (let z = nz1 + 3; z <= nz2 - 2; z += 2)
    for (let x = nx1 + 1; x < nx2; x++) if (Math.abs(x - cx) > 0) bp.set(x, 1, z, 'spruce_stairs[facing=south,half=bottom]');
  for (let z = nz1 + 1; z < nz2; z++) bp.set(cx, 1, z, 'red_carpet');

  // Bell tower.
  const th = rng.int(16, 19);
  if (sideTower) {
    tower(bp, rng, { x1: 1, z1: 9, h: th, wall: wallB, quoin, spire, roofMat: spire === 'onion' ? ROOFS.copper : spireMat, door: true });
    bp.fill(5, 1, 10, 6, 2, 10, null);
    doorway(bp, cx, 1, nz2, 'south', 'dark_oak', { frame: 'stone_bricks', lintel: 'chiseled_stone_bricks' });
    for (let z = nz2 + 1; z <= 16; z++) bp.set(cx, 0, z, 'gravel');
    for (let z = 14; z <= 16; z++) bp.set(3, 0, z, 'gravel');
  } else {
    tower(bp, rng, { x1: 6, z1: nz2, h: th, wall: wallB, quoin, spire, roofMat: spire === 'onion' ? ROOFS.copper : spireMat, door: true });
    bp.fill(cx, 1, nz2, cx, 2, nz2, null);
    bp.set(8, 0, 16, 'gravel');
  }

  // Churchyard: wall, graves, trees.
  for (let i = 0; i <= 16; i++) {
    bp.setIfEmpty(0, 1, i, 'stone_brick_wall');
    bp.setIfEmpty(16, 1, i, 'stone_brick_wall');
    bp.setIfEmpty(i, 1, 0, 'stone_brick_wall');
    if (!bp.get(i, 0, 16) || !/gravel/.test(bp.get(i, 0, 16))) bp.setIfEmpty(i, 1, 16, 'stone_brick_wall');
  }
  const graves = sideTower ? [[2, 2], [4, 2], [2, 5], [4, 5]] : [[1, 3], [1, 6], [1, 9], [15, 3], [15, 6], [15, 9]];
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
  // Pool with deck and loungers.
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
  const x1 = 2;
  const x2 = 14;
  const z1 = 2;
  const z2 = 10;
  // Glazed ground floor around a concrete core.
  bp.fill(x1, 0, z1, x2, 0, z2 - 1, 'smooth_stone');
  bp.walls(x1, 1, z1, x2, 3, z2 - 1, 'glass');
  bp.walls(x1, 1, z1, x1 + 4, 3, z2 - 1, concrete);
  for (const [x, z] of [[x2, z1], [x2, z2 - 1], [x1 + 8, z2 - 1]]) bp.fill(x, 1, z, x, 3, z, concrete);
  bp.set(x1 + 6, 1, z2 - 1, null);
  bp.door(x1 + 6, 1, z2 - 1, 'pale_oak', 'south');
  bp.set(x1 + 6, 3, z2 - 1, 'glass');
  bp.fill(x1 + 5, 4, z2, x1 + 7, 4, z2 + 2, `${concrete === 'smooth_quartz' ? 'smooth_quartz' : 'smooth_stone'}_slab[type=top]`);
  // Kitchen island, sofa, plants.
  bp.fill(x1 + 6, 1, z1 + 3, x1 + 8, 1, z1 + 3, 'smooth_quartz');
  bp.set(x1 + 7, 2, z1 + 3, 'potted_flowering_azalea_bush');
  for (let x = x2 - 4; x <= x2 - 2; x++) bp.set(x, 1, z1 + 2, 'white_wool');
  for (let x = x2 - 4; x <= x2 - 2; x++) bp.set(x, 1, z1 + 3, `quartz_stairs[facing=north,half=bottom]`);
  bp.set(x2 - 3, 1, z1 + 5, 'light_gray_carpet');
  bp.set(x2 - 1, 1, z2 - 2, 'potted_bamboo');
  bp.set(x1 + 5, 1, z1 + 1, 'potted_fern');
  bp.set(x1 + 7, 3, z1 + 5, 'lantern[hanging=true]');
  // Cantilevered timber box upstairs with a ribbon window.
  bp.fill(x1 - 1, 4, z1, x2, 4, z2 + 1, concrete);
  bp.walls(x1 - 1, 5, z1, x2, 7, z2 + 1, `${clad}[axis=y]`);
  bp.fill(x1, 5, z2 + 1, x2 - 1, 6, z2 + 1, 'glass');
  bp.fill(x1 - 1, 5, z1 + 2, x1 - 1, 6, z2 - 1, 'glass');
  bp.fill(x2, 5, z1 + 3, x2, 6, z1 + 5, 'glass');
  bp.fill(x1 - 1, 8, z1, x2, 8, z2 + 1, concrete);
  furnish(bp, rng, { x1: x1, z1: z1 + 1, x2: x2 - 1, z2: z2, y: 5, h: 3 }, 'modern', [], 'pale_oak');
  let roofY = 8;
  if (rng.chance(0.6)) {
    // Set-back penthouse with a glass-railed terrace.
    bp.walls(x1 + 4, 9, z1, x2 - 1, 11, z2 - 2, 'glass');
    for (const [x, z] of [[x1 + 4, z1], [x2 - 1, z1], [x1 + 4, z2 - 2], [x2 - 1, z2 - 2]]) bp.fill(x, 9, z, x, 11, z, concrete);
    bp.fill(x1 + 4, 12, z1, x2 - 1, 12, z2 - 2, concrete);
    for (let x = x1 - 1; x <= x2; x++) bp.set(x, 9, z2 + 1, 'glass_pane');
    for (let z = z1; z <= z2 + 1; z++) bp.set(x1 - 1, 9, z, 'glass_pane');
    bp.set(x1 + 1, 9, z2 - 1, 'flowering_azalea');
    bp.set(x1 + 1, 8, z2 - 1, 'moss_block');
    bp.set(x1 + 2, 9, z2, 'white_bed[facing=west,part=head]');
    bp.set(x1 + 3, 9, z2, 'white_bed[facing=west,part=foot]');
    bp.set(x1 + 6, 11, z1 + 3, 'lantern[hanging=true]');
    roofY = 12;
  } else for (let x = x1 - 1; x <= x2; x++) for (const z of [z1, z2 + 1]) bp.set(x, 9, z, concrete === 'smooth_quartz' ? 'smooth_quartz_slab[type=bottom]' : 'smooth_stone_slab[type=bottom]');
  // Green roof with solar panels.
  for (let x = x1 + 5; x <= x2 - 2; x++)
    for (let z = z1 + 1; z <= z2 - 3; z++) {
      if (roofY === 8 && (x === x1 - 1 || x === x2)) continue;
      const solar = (z - z1) % 3 === 1;
      bp.set(x, roofY + 1, z, solar ? 'daylight_detector' : 'moss_block');
      if (!solar && rng.chance(0.3)) bp.set(x, roofY + 2, z, rng.pick(['short_grass', 'fern', 'azalea', 'dandelion']));
    }
  // Garden.
  modernGarden(bp, rng, { poolX: [10, 14], poolZ: [13, 15], path: [[x1 + 6, 11], [x1 + 6, 12], [x1 + 6, 14], [x1 + 6, 16]] });
  broadTree(bp, 3, 14, 5, 2, 'birch');
  for (let z = 0; z <= 16; z++) {
    if (z >= 12 && z <= 16) continue;
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
  const x1 = 3;
  const x2 = 13;
  const z1 = 3;
  const z2 = 11;
  const cx = 8;
  bp.fill(x1 - 1, 0, z1 - 1, x2 + 1, 0, z2 + 1, 'smooth_stone');
  bp.fill(x1 + 1, 0, z1 + 1, x2 - 1, 0, z2 - 1, 'pale_oak_planks');
  bp.walls(x1, 1, z1, x2, 7, z2, kit.wall);
  bp.fill(x1 + 1, 4, z1 + 1, x2 - 1, 4, z2 - 1, 'pale_oak_planks');
  const at = roof(bp, { x1, x2, z1, z2, y: 8, mat: kit.roof, n: INF, s: INF });
  closeUnder(bp, at, perimeter(x1, z1, x2, z2), 8, kit.wall, kit.roof);
  // Big gable glazing and irregular picture windows (deep reveals).
  for (let x = cx - 2; x <= cx + 2; x++) for (let y = 5; y < at(x, z2).y; y++) bp.set(x, y, z2, 'glass');
  bp.fill(cx - 2, 4, z2 + 1, cx + 2, 4, z2 + 1, 'smooth_stone_slab[type=top]');
  for (let x = cx - 2; x <= cx + 2; x++) bp.set(x, 5, z2 + 1, 'glass_pane');
  const holes = [[x1 + 1, 1, z2, 'south', 3, 2], [x2 - 2, 2, z2, 'south', 2, 2], [x1, 5, z1 + 2, 'west', 2, 2], [x1, 1, z1 + 5, 'west', 3, 2],
    [x2, 2, z1 + 2, 'east', 2, 2], [x2, 5, z1 + 5, 'east', 3, 2], [cx - 1, 2, z1, 'north', 3, 2], [cx + 2, 5, z1, 'north', 2, 2]];
  for (const [x, y, z, face, w, h] of holes) win(bp, rng, x, y, z, face, { w, h, glass: 'glass' });
  bp.door(x2 - 3, 1, z2, 'dark_oak', 'south');
  bp.set(x2 - 3, 3, z2, 'glass');
  furnish(bp, rng, { x1: x1 + 1, z1: z1 + 1, x2: x2 - 1, z2: z2 - 1, y: 1, h: 3 }, 'living', [[x2 - 3, z2 - 1]], 'pale_oak');
  furnish(bp, rng, { x1: x1 + 1, z1: z1 + 1, x2: x2 - 1, z2: z2 - 2, y: 5, h: 3 }, 'modern', [], 'pale_oak');
  // Terrace deck with loungers and planters.
  bp.fill(x1, 0, z2 + 2, x2, 0, z2 + 4, 'pale_oak_planks');
  for (const x of [x1 + 1, x1 + 3]) {
    bp.set(x, 1, z2 + 3, 'white_bed[facing=north,part=head]');
    bp.set(x, 1, z2 + 4, 'white_bed[facing=north,part=foot]');
  }
  bp.set(x1 + 6, 1, z2 + 3, 'pale_oak_fence');
  bp.set(x1 + 6, 2, z2 + 3, 'white_carpet');
  for (const x of [x1 + 5, x1 + 7]) bp.set(x, 1, z2 + 3, `pale_oak_stairs[facing=${x < x1 + 6 ? 'west' : 'east'},half=bottom]`);
  for (let z = z2 + 2; z <= 16; z++) bp.set(x2 - 3, 0, z, 'smooth_stone_slab[type=double]');
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
  const x1 = 1;
  const x2 = 15;
  const z1 = 3;
  const z2 = 12;
  const cx = 8;
  const plaster = rng.pick(['smooth_sandstone', 'calcite', 'white_terracotta', 'mushroom_stem', 'end_stone_bricks']);
  const trim = /calcite|mushroom/.test(plaster) ? rng.pick([TRIMS.sand, TRIMS.stone, TRIMS.andesite]) : rng.pick([TRIMS.quartz, TRIMS.stone, TRIMS.diorite]);
  const mansard = rng.pick([ROOFS.slate, ROOFS.slate, ROOFS.copper, ROOFS.deepslate]);
  const cap = rng.pick([ROOFS.copper, ROOFS.copper, ROOFS.copperW]);
  const towers = rng.chance(0.5);
  const stone = stoneMix(rng);
  const name = rng.pick(['BELLEVUE', 'ALPINA', 'SCHWEIZERHOF', 'VICTORIA', 'BEAU-RIVAGE', 'JUNGFRAU', 'EDELWEISS', 'MONTANA', 'PALACE', 'NATIONAL']);
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
  bp.walls(x1, 1, z1, x2, top, z2, wallFn);
  bp.walls(6, 1, 12, 10, top, 13, wallFn);
  bp.fill(7, 1, 12, 9, top, 12, null);
  for (let f = 0; f <= floors; f++) {
    const y = f === floors ? top + 1 : yb(f);
    bp.fill(x1 + 1, y, z1 + 1, x2 - 1, y, z2 - 1, 'dark_oak_planks');
    bp.fill(7, y, 12, 9, y, 12, 'dark_oak_planks');
  }
  // Ground floor: arched windows, portal with sidelights, marquee.
  for (const x of [2, 4, 12, 14]) {
    win(bp, rng, x, 2, z2, 'south', { h: 2, lintel: trim.block });
  }
  for (const z of [5, 8, 11]) {
    win(bp, rng, x1, 2, z, 'west', { h: 2 });
    win(bp, rng, x2, 2, z, 'east', { h: 2 });
  }
  doorway(bp, cx, 1, 13, 'south', 'dark_oak', { transom: 'glass_pane' });
  for (const x of [7, 9]) bp.fill(x, 1, 13, x, 3, 13, 'glass_pane');
  bp.set(cx, 4, 13, trim.block);
  bp.fill(6, 4, 14, 10, 4, 15, `${cap.slab}[type=bottom]`);
  for (const x of [6, 10]) bp.fill(x, 1, 15, x, 3, 15, 'polished_blackstone_wall');
  for (const x of [7, 9]) bp.set(x, 3, 15, 'lantern[hanging=true]');
  bp.set(cx, 3, 14, 'lantern[hanging=true]');
  // Upper storeys: framed windows, balconies, hoods.
  const cols = [2, 4, 7, 9, 12, 14, 8];
  for (let f = 0; f < floors; f++) {
    const y = yb(f) + 1;
    for (const x of cols) {
      const z = front(x);
      if (x === cx && f >= 1) {
        bp.door(cx, y, 13, 'dark_oak', 'south');
        continue;
      }
      win(bp, rng, x, y, z, 'south', { h: 2, lintel: trim.block });
      if (f === 0 && !inRis(x)) {
        bp.set(x, y - 1, z + 1, `${trim.slab}[type=top]`);
        bp.set(x, y, z + 1, 'iron_bars');
        bp.set(x, y + 2, z + 1, `${trim.stairs}[facing=north,half=bottom]`);
      }
      if (f === 1) bp.set(x, y + 2, z + 1, `${trim.slab}[type=bottom]`);
      win(bp, rng, x, y, z1, 'north', { h: 2, lintel: trim.block });
    }
    for (const z of [5, 8, 11]) {
      win(bp, rng, x1, y, z, 'west', { h: 2, lintel: trim.block });
      win(bp, rng, x2, y, z, 'east', { h: 2, lintel: trim.block });
    }
    if (f >= 1) {
      deck(bp, rng, [6, 7, 8, 9, 10].map((x) => [x, 14]), yb(f), { floor: `${trim.slab}[type=top]`, railBlock: 'iron_bars', isHouse: (x, z) => z <= 13, flowers: f === 1 ? 0.5 : 0, bracket: trim.stairs });
    }
  }
  // Cornice.
  for (const [x, z] of perimeter(x1, z1, x2, z2)) {
    const f = z === z1 ? 'south' : z === z2 ? 'north' : x === x1 ? 'east' : 'west';
    const [dx, dz] = DIR[OPP[f]];
    if (!(z === z2 && inRis(x))) bp.setIfEmpty(x + dx, top, z + dz, `${trim.stairs}[facing=${f},half=top]`);
  }
  for (let x = 6; x <= 10; x++) bp.set(x, top, 14, `${trim.stairs}[facing=north,half=top]`);
  // Mansard roof with dormers.
  const at = roof(bp, { x1, x2, z1, z2, y: top + 1, mat: mansard, kind: 'steep', cap: 2 });
  for (const x of [2, 4, 12, 14]) {
    bp.set(x, top + 2, z2, 'glass_pane');
    bp.set(x, top + 3, z2, `${trim.slab}[type=bottom]`);
    bp.set(x, top + 2, z1, 'glass_pane');
  }
  // Pavilion over the risalit with sign and copper dome.
  bp.walls(6, top + 1, 9, 10, top + 4, 13, (x, y, z) => ((x === 6 || x === 10) && (z === 9 || z === 13) ? trim.block : y === top + 4 ? trim.block : plaster));
  bp.set(cx, top + 2, 13, 'glass_pane');
  bp.set(cx, top + 3, 13, 'glass_pane');
  bp.set(cx, top + 1, 14, `dark_oak_wall_sign[facing=south]${signData(['GRAND', 'HOTEL', name, ''], 'yellow', true)}`);
  clockFace(bp, cx, top + 3, 9, 'north');
  const pa = roof(bp, { x1: 6, x2: 10, z1: 9, z2: 13, y: top + 5, mat: cap, kind: 'steep' });
  const pt = pa(cx, 11).y;
  bp.fill(cx, pt + 1, 11, cx, pt + 3, 11, 'spruce_fence');
  bp.set(cx, pt + 4, 11, `red_banner[rotation=0]${SWISS_FLAG}`);
  // Corner turrets.
  if (towers)
    for (const tx of [x1, x2 - 2]) {
      bp.walls(tx, top + 1, z2 - 2, tx + 2, top + 4, z2, (x, y, z) => (y === top + 4 ? trim.block : plaster));
      bp.set(tx + 1, top + 2, z2, 'glass_pane');
      bp.set(tx + 1, top + 3, z2, 'glass_pane');
      const ta = roof(bp, { x1: tx, x2: tx + 2, z1: z2 - 2, z2, y: top + 5, mat: cap, kind: 'steep', pitch: 3 });
      bp.set(tx + 1, ta(tx + 1, z2 - 1).y + 1, z2 - 1, 'waxed_oxidized_lightning_rod[facing=up]');
    }
  // Interiors.
  furnish(bp, rng, { x1: x1 + 1, z1: z1 + 1, x2: x2 - 1, z2: z2 - 1, y: 1, h: 4 }, 'lobby', [[cx, 12]], 'dark_oak');
  for (let x = 4; x <= 12; x += 4) bp.set(x, 4, 7, 'lantern[hanging=true]');
  bp.fill(5, 1, 5, 11, 1, 5, 'dark_oak_planks');
  for (let f = 0; f < floors; f++) furnish(bp, rng, { x1: x1 + 1, z1: z1 + 1, x2: x2 - 1, z2: z2 - 1, y: yb(f) + 1, h: 3 }, 'twin', [[cx, 12]], 'dark_oak');
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
  const x1 = 5;
  const x2 = 11;
  const z1 = 5;
  const z2 = 11;
  const cx = 8;
  const cz = 8;
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
  // Gate passage.
  for (let z = z1; z <= z2; z++) {
    bp.fill(7, 1, z, 9, 4, z, null);
    bp.set(6, 1, z, 'stone_bricks');
    bp.fill(6, 2, z, 6, 4, z, 'stone_bricks');
    bp.fill(10, 1, z, 10, 4, z, 'stone_bricks');
    bp.fill(7, 5, z, 9, 5, z, 'stone_bricks');
  }
  for (const z of [z1, z2]) {
    bp.set(7, 4, z, 'stone_brick_stairs[facing=west,half=top]');
    bp.set(9, 4, z, 'stone_brick_stairs[facing=east,half=top]');
  }
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
  clockFace(bp, x2, 16, cz, 'east');
  for (const y of [8, 9]) {
    bp.set(x1, y, cz, 'glass_pane');
    bp.set(x2, y, cz, 'glass_pane');
    bp.set(cx, y, z1, 'glass_pane');
  }
  for (const x of [7, 9]) bp.fill(x, 18, z2, x, 19, z2, 'glass_pane');
  for (const z of [7, 9]) {
    bp.fill(x1, 12, z, x1, 12, z, 'glass_pane');
    bp.fill(x2, 12, z, x2, 12, z, 'glass_pane');
  }
  // Cornice.
  for (const [x, z] of perimeter(x1 - 1, z1 - 1, x2 + 1, z2 + 1)) {
    const f = z === z1 - 1 ? 'south' : z === z2 + 1 ? 'north' : x === x1 - 1 ? 'east' : 'west';
    bp.set(x, H, z, `${trim.stairs}[facing=${f},half=top]`);
  }
  // Big hipped roof, flat top carrying the open bell turret.
  roof(bp, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 1, y: H + 1, mat: roofMat, kind: 'steep', cap: 3 });
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
  bench(bp, 4, 7, 'west', 3, 'spruce');
  bench(bp, 12, 7, 'east', 3, 'spruce');
  lamp(bp, 6, 15, 3, 'double');
  lamp(bp, 10, 1, 3, 'double');
  return bp;
}

// ================================================================ cooperative apartment block (Genossenschaft)

export function apartment(rng) {
  const bp = new Blueprint();
  const x1 = 2;
  const x2 = 14;
  const z1 = 3;
  const z2 = 11;
  const cx = 8;
  const n = rng.int(4, 6);
  const concrete = rng.pick(['white_concrete', 'light_gray_concrete', 'smooth_quartz', 'white_concrete']);
  const timber = rng.pick(['stripped_oak_log[axis=y]', 'stripped_spruce_log[axis=y]', 'stripped_pale_oak_log[axis=y]', 'stripped_dark_oak_log[axis=y]', 'stripped_birch_log[axis=y]']);
  const rail = rng.pick(['glass_pane', 'iron_bars', 'waxed_copper_bars', 'glass_pane']);
  const accent = rng.pick(['orange', 'yellow', 'green', 'light_blue', 'red', 'lime']);
  const top = 3 * n;
  const cell = (x, y, z) => {
    if (y % 3 === 0) return concrete;
    const s = Math.floor(y / 3);
    const isFront = z === z2 || z === z1;
    const a = isFront ? x : z;
    if ((isFront && (x === x1 || x === cx || x === x2)) || (!isFront && (z === z1 || z === z2))) return concrete;
    return (a + 2 * (s % 2)) % 4 === 0 ? timber : 'glass_pane';
  };
  bp.fill(x1, 0, z1, x2, 0, z2, 'smooth_stone');
  bp.walls(x1, 1, z1, x2, top, z2, cell);
  for (let s = 1; s <= n; s++) bp.fill(x1 + 1, 3 * s, z1 + 1, x2 - 1, 3 * s, z2 - 1, s === n ? concrete : 'pale_oak_planks');
  // Entrance with canopy.
  for (let x = cx - 2; x <= cx + 2; x++) bp.fill(x, 1, z2, x, 2, z2, 'glass_pane');
  bp.set(cx, 1, z2, null);
  bp.door(cx, 1, z2, 'pale_oak', 'south');
  bp.fill(cx - 2, 3, z2 + 1, cx + 2, 3, z2 + 2, `${concrete === 'smooth_quartz' ? 'smooth_quartz' : 'smooth_stone'}_slab[type=top]`);
  bp.set(cx, 2, z2 + 1, null);
  bp.set(cx + 2, 2, z2 + 1, `${accent}_wall_banner[facing=south]`);
  bp.set(cx - 1, 2, z2 + 2, 'lantern[hanging=true]');
  bp.set(cx + 1, 2, z2 + 2, 'lantern[hanging=true]');
  // Staggered balconies.
  for (let s = 1; s < n; s++) {
    const y = 3 * s;
    const ranges = s % 2 ? [[x1, cx - 1]] : [[cx + 1, x2]];
    if (n <= 5 || s === n - 1) ranges.push(s % 2 ? [cx + 2, x2 - 1] : [x1 + 1, cx - 2]);
    for (const [a, b] of ranges) {
      const cells = [];
      for (let x = a; x <= b; x++) for (let k = 1; k <= 2; k++) cells.push([x, z2 + k]);
      deck(bp, rng, cells, y, { floor: `${concrete === 'smooth_quartz' ? 'smooth_quartz' : 'smooth_stone'}_slab[type=top]`, railBlock: rail, isHouse: (x, z) => z <= z2, flowers: 0 });
      const dx = (a + b) >> 1;
      bp.set(dx, y + 1, z2, null);
      bp.set(dx, y + 2, z2, null);
      bp.door(dx, y + 1, z2, 'pale_oak', 'south');
      bp.set(a + 1, y + 1, z2 + 1, rng.pick(['potted_azalea_bush', 'potted_flowering_azalea_bush', 'potted_bamboo', 'potted_fern']));
      if (b - a >= 3) bp.set(b - 1, y + 1, z2 + 1, `${rng.pick(['pale_oak', 'oak', 'spruce'])}_stairs[facing=north,half=bottom]`);
      bp.set(b - 1, y + 2, z2 + 2, rng.pick(['potted_red_tulip', 'potted_poppy', 'potted_cornflower']));
    }
  }
  // Rooms.
  for (let s = 0; s < n; s++) furnish(bp, rng, { x1: x1 + 1, z1: z1 + 1, x2: x2 - 1, z2: z2 - 1, y: 3 * s + 1, h: 2 }, s === 0 ? 'lobby' : rng.pick(['modern', 'living', 'kitchen']), [[cx, z2 - 1], [5, z2 - 1], [11, z2 - 1]], 'pale_oak');
  // Green roof: parapet, moss, shrubs, solar panels, stair house.
  for (const [x, z] of perimeter(x1, z1, x2, z2)) bp.set(x, top + 1, z, `${concrete === 'smooth_quartz' ? 'smooth_quartz' : 'smooth_stone'}_slab[type=bottom]`);
  for (let x = x1 + 1; x < x2; x++)
    for (let z = z1 + 1; z < z2; z++) {
      const solar = x >= cx + 1 && (z - z1) % 2 === 1;
      bp.set(x, top + 1, z, solar ? 'daylight_detector' : 'moss_block');
      if (!solar && rng.chance(0.35)) bp.set(x, top + 2, z, rng.pick(['azalea', 'flowering_azalea', 'short_grass', 'fern', 'short_grass', 'dandelion', 'cornflower']));
    }
  bp.walls(x1 + 2, top + 1, z1 + 2, x1 + 4, top + 3, z1 + 4, concrete);
  bp.fill(x1 + 2, top + 4, z1 + 2, x1 + 4, top + 4, z1 + 4, concrete);
  bp.door(x1 + 3, top + 1, z1 + 4, 'pale_oak', 'south');
  for (const z of [z1 + 1, z1 + 5]) bp.setIfEmpty(x1 + 3, top + 2, z, null);
  // Shared garden: lawn, birches, raised beds, sandpit, bench.
  for (let z = z2 + 1; z <= 16; z++) bp.set(cx, 0, z, 'smooth_stone_slab[type=double]');
  broadTree(bp, 3, 14, 5, 2, 'birch');
  broadTree(bp, 13, 15, 4, 1, 'birch');
  const crop = () => rng.pick(['carrots[age=7]', 'potatoes[age=7]', 'beetroots[age=3]', 'wheat[age=7]']);
  for (let x = 10; x <= 12; x++) {
    bp.set(x, 0, 13, 'farmland[moisture=7]');
    bp.set(x, 1, 13, crop());
  }
  for (let x = 9; x <= 13; x++) bp.setIfEmpty(x, 1, 12, 'spruce_trapdoor[facing=north,open=true,half=bottom]');
  bp.fill(5, 0, 15, 6, 0, 16, 'sand');
  for (const [x, z] of [[4, 15], [4, 16], [7, 15], [7, 16]]) bp.setIfEmpty(x, 1, z, 'birch_slab[type=bottom]');
  bench(bp, 10, 16, 'south', 2, 'pale_oak');
  sprinkleFlowers(bp, rng, 0, 12, 16, 16, 0.12, ['short_grass', 'dandelion', 'oxeye_daisy', 'short_grass']);
  if (rng.chance(0.5)) bp.mirrorX();
  return bp;
}

// ================================================================ Emmental farmhouse

export function farmhouse(rng) {
  const bp = new Blueprint();
  const X1 = 1;
  const X2 = 11;
  const Z1 = 2;
  const Z2 = 13;
  const cx = 6;
  const zb = 8; // partition between barn (behind) and living part (front)
  const tw = WOOD(rng.pick(['spruce', 'spruce', 'dark_oak', 'oak']));
  const rw = WOOD(tw.name === 'oak' ? 'spruce' : rng.pick(['oak', 'birch', 'spruce']));
  const roofMat = ROOFS[rng.weighted([['tile', 3], ['spruce', 3], ['dark_oak', 2], ['clay', 1.5]])];
  const back = rng.pick([0, 2]);
  const y0 = 4;
  const isHouse = (x, z) => x >= X1 && x <= X2 && z >= Z1 && z <= Z2;
  const board = `${tw.stripped}[axis=y]`;

  bp.fill(X1, 0, Z1, X2, 0, Z2, 'cobblestone');
  bp.fill(X1 + 1, 0, zb + 1, X2 - 1, 0, Z2 - 1, tw.planks);
  bp.fill(X1 + 1, 0, Z1 + 1, X2 - 1, 0, zb - 1, (x, y, z) => ((x * 7 + z * 3) % 5 ? 'coarse_dirt' : 'packed_mud'));
  // Living part: stone plinth, horizontal log walls. Barn: vertical boards.
  bp.walls(X1, 1, zb, X2, 4, Z2, (x, y, z) => (y === 1 ? 'stone_bricks' : (x === X1 || x === X2) && (z === zb || z === Z2) ? `${tw.log}[axis=y]` : `${y === 4 ? tw.log : tw.stripped}[axis=${z === Z2 || z === zb ? 'x' : 'z'}]`));
  bp.walls(X1, 1, Z1, X2, 4, zb, (x, y, z) => (z === zb ? bp.get(x, y, z) ?? board : board));
  bp.fill(X1 + 1, 4, zb + 1, X2 - 1, 4, Z2 - 1, tw.planks);
  bp.fill(X1 + 1, 4, Z1 + 1, X2 - 1, 4, Z1 + 3, tw.planks);
  // Huge half-hipped roof reaching low.
  const at = roof(bp, { x1: 0, x2: 12, z1: Z1 - 1, z2: Z2 + 2, y: y0, mat: roofMat, s: 4, n: back, brackets: undefined });
  closeUnder(bp, at, perimeter(X1, Z1, X2, Z2), 5, (x, y, z) => (z === Z2 ? tw.planks : board), roofMat);
  closeUnder(bp, at, [...Array(X2 - X1 - 1)].map((_, i) => [X1 + 1 + i, zb]), 5, tw.planks, roofMat);
  // Front: ribbon windows with flower boxes on both floors, door, attic window.
  const room = (x) => at(x, Z2).y;
  win(bp, rng, X1 + 1, 2, Z2, 'south', { w: 3, h: 2, box: rw.trapdoor });
  win(bp, rng, cx + 2, 2, Z2, 'south', { w: 3, h: 2, box: rw.trapdoor });
  bp.door(cx, 1, Z2, tw.door, 'south');
  let ua = X1 + 1;
  while (room(ua) < 7) ua++;
  let ub = X2 - 1;
  while (room(ub) < 7) ub--;
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
  // Sides and barn.
  win(bp, rng, X1, 2, Z2 - 2, 'west', { h: 2 });
  win(bp, rng, X2, 2, Z2 - 2, 'east', { h: 2 });
  win(bp, rng, X2, 2, zb + 1, 'east', { h: 2 });
  bp.fill(X1, 1, 4, X1, 3, 6, null);
  bp.fill(X1, 4, 4, X1, 4, 6, `${tw.log}[axis=z]`);
  for (let z = Z1 + 1; z < zb; z += 2) bp.set(X2, 3, z, tw.fence);
  bp.fill(cx - 1, 1, Z1, cx + 1, 3, Z1, null);
  for (let x = X1 + 1; x <= X2 - 1; x++) {
    if (x >= cx - 1 && x <= cx + 1) continue;
    for (let y = 1; y <= (x % 3 ? 2 : 3); y++) bp.set(x, y, Z1 + 1, 'hay_block[axis=y]');
  }
  for (let x = X1 + 1; x <= X2 - 1; x += 2) bp.set(x, 5, Z1 + 2, 'hay_block[axis=x]');
  for (let z = Z1 + 3; z < zb; z++) bp.set(X2 - 2, 1, z, tw.fence);
  bp.set(X2 - 1, 1, zb - 1, 'water_cauldron[level=3]');
  bp.set(X1 + 2, 1, zb - 2, 'composter[level=7]');
  bp.set(cx, 3, Z1 + 4, 'lantern[hanging=true]');
  furnish(bp, rng, { x1: X1 + 1, z1: zb + 1, x2: X2 - 1, z2: Z2 - 1, y: 1, h: 3 }, 'farm', [[cx, Z2 - 1]], tw.name);
  furnish(bp, rng, { x1: X1 + 2, z1: zb + 1, x2: X2 - 2, z2: Z2 - 1, y: 5, h: 2 }, 'bedroom', [], tw.name);
  // Yard: path, bench, hay cart, pasture, well.
  for (let z = Z2 + 1; z <= 16; z++) bp.set(cx, 0, z, 'dirt_path');
  for (const x of [9, 10]) {
    bp.set(x, 1, 16, `${tw.slab}[type=top]`);
    bp.set(x, 2, 16, 'hay_block[axis=x]');
    bp.set(x, 1, 15, `dark_oak_trapdoor[facing=north,open=true,half=bottom]`);
  }
  bp.set(11, 1, 16, tw.fence);
  bp.set(2, 1, 16, 'composter[level=0]');
  // Pasture strip.
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
  // Well with a little roof.
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
  const x1 = 4;
  const x2 = 12;
  const z1 = 3;
  const z2 = 9;
  const cx = 8;
  const rough = rubble(rng);
  const tw = WOOD(rng.pick(['spruce', 'dark_oak']));
  const roofMat = ROOFS[rng.pick(['stone', 'spruce', 'slate'])];
  const isHouse = (x, z) => x >= x1 && x <= x2 && z >= z1 && z <= z2;
  bp.fill(x1, 0, z1, x2, 0, z2, 'cobblestone');
  bp.fill(x1 + 1, 0, z1 + 1, x2 - 1, 0, z2 - 1, tw.planks);
  bp.walls(x1, 1, z1, x2, 3, z2, rough);
  bp.fill(x1 + 1, 4, z1 + 1, x2 - 1, 4, z2 - 1, tw.planks);
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
  for (const x of [cx - 2, cx + 2]) {
    shutterPair(x, 2, z2, 'south');
    shutterPair(x, 5, z2, 'south');
    shutterPair(x, 2, z1, 'north');
  }
  shutterPair(x1, 2, 6, 'west');
  shutterPair(x2, 5, 6, 'east');
  bp.door(cx, 1, z2, tw.door, 'south');
  bp.set(cx, 3, z2 + 1, `${tw.sign}[facing=south]${signData(['', 'SAC', 'Berghuette', ''], 'red')}`);
  if (at(cx, z2).y - 9 >= 2) bp.set(cx, 9, z2, 'glass_pane');
  const chx = x2 - 2;
  const ch = at(chx, z1 + 2);
  bp.fill(chx, 9, z1 + 2, chx, ch.y + 1, z1 + 2, 'cobblestone');
  bp.set(chx, ch.y + 2, z1 + 2, 'campfire[lit=true,signal_fire=false]');
  furnish(bp, rng, { x1: x1 + 1, z1: z1 + 1, x2: x2 - 1, z2: z2 - 1, y: 1, h: 3 }, 'kitchen', [[cx, z2 - 1]], tw.name);
  furnish(bp, rng, { x1: x1 + 1, z1: z1 + 1, x2: x2 - 1, z2: z2 - 1, y: 5, h: 3 }, 'twin', [], tw.name);
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
  bp.fill(2, 1, 15, 2, 3, 15, 'spruce_fence');
  bp.set(3, 3, 15, `bamboo_wall_sign[facing=east]${signData(['Wanderweg', 'Gipfel', '2 h 30 min', ''])}`);
  bp.set(1, 2, 15, `bamboo_wall_sign[facing=west]${signData(['Bergsee', '1 h 15 min', '', ''])}`);
  for (let z = z1 + 1; z <= z2 - 1; z++) for (let y = 1; y <= 2; y++) if (!bp.get(x2 + 1, y, z)) bp.set(x2 + 1, y, z, `${rng.pick(['spruce_log', 'oak_log', 'birch_log'])}[axis=x]`);
  bp.set(x1 - 1, 1, z2 - 1, 'water_cauldron[level=3]');
  spruce(bp, 1, 2, rng.int(7, 9), 2);
  spruce(bp, 15, 3, rng.int(6, 8), 1);
  spruce(bp, 2, 7, rng.int(5, 6), 1);
  for (let i = 0; i < 4; i++) {
    const [bx, bz] = rng.pick([[14, 8], [13, 16], [0, 10], [5, 16], [15, 15], [10, 1]]);
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
