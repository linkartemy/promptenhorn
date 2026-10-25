// Swiss-style procedural buildings. Each generator draws into a 17x17 local frame
// (x, z in 0..16; y = 0 is the ground surface, the street is at z > 16 — the front faces +z / south).
// square() and plaza() may use the whole 21x21 frame (-2..18) including the street ring.
import { Blueprint, rngFrom, sturdyToward, isPaneLike, blockName, blockProps } from './blueprint.mjs';

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
  bp.mark('light', x - dx, y, z - dz, { facing: face });
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
function deck(bp, rng, cells, y, { floor, rail = 'board', wood = 'spruce', isHouse, flowers = 0.7, bracket, railBlock, post, openAtHouse = false }) {
  const key = (x, z) => `${x},${z}`;
  const S = new Set(cells.map(([x, z]) => key(x, z)));
  for (const [x, z] of cells) bp.set(x, y, z, floor);
  for (const [x, z] of cells) {
    const outs = Object.keys(DIR).filter((f) => !S.has(key(x + DIR[f][0], z + DIR[f][1])) && !isHouse(x + DIR[f][0], z + DIR[f][1]));
    if (outs.length) {
      let block;
      const touchesHouse = Object.values(DIR).some(([dx, dz]) => isHouse(x + dx, z + dz));
      if (touchesHouse && openAtHouse) continue;
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


const PROFESSION = { smoker: 'butcher', lectern: 'librarian', loom: 'shepherd', water_cauldron: 'leatherworker', composter: 'farmer', barrel: 'fisherman', cartography_table: 'cartographer', brewing_stand: 'cleric', fletching_table: 'fletcher', grindstone: 'weaponsmith', stonecutter: 'mason', smithing_table: 'toolsmith', blast_furnace: 'armorer' };

/**
 * Derives the semantic markers every building shares from its finished blocks (generators add special ones
 * themselves): main door with chronicle lectern / sign / pet spots, seats, beds, workstations, bells.
 */
function autoMarks(bp, type) {
  const has = (k) => bp.markers.some((m) => m.kind === k);
  const blocks = [...bp.blocks].map(([k, b]) => [...k.split(',').map(Number), b]);
  const name = (b) => blockName(b);
  const props = (b) => Object.fromEntries((b.match(/\[([^\]]*)\]/)?.[1] ?? '').split(',').filter(Boolean).map((p) => p.split('=')));
  const covered = (x, y, z) => { for (let yy = y + 1; yy <= y + 8; yy++) if (bp.get(x, yy, z)) return true; return false; };
  // Main entrance: the front-most ground-floor door.
  if (!has('door')) {
    const doors = blocks.filter(([x, y, z, b]) => /_door\b/.test(b) && /half=lower/.test(b) && y <= 2 && x >= 0 && x <= 16);
    doors.sort((a, b) => b[2] - a[2] || Math.abs(a[0] - 8) - Math.abs(b[0] - 8));
    const d = doors[0];
    if (d) {
      const [x, y, z, b] = d;
      const f = props(b).facing;
      const [dx, dz] = DIR[f];
      const [ax, az] = along(f);
      const ox = x + dx, oz = z + dz;
      bp.mark('door', ox, y, oz, { facing: f });
      const soft = (b) => !b || /^minecraft:(poppy|dandelion|cornflower|oxeye_daisy|azure_bluet|allium|.*_tulip|lily_of_the_valley|short_grass|fern)$/.test(b);
      const free = (cx, cz) => soft(bp.get(cx, y, cz)) && !bp.get(cx, y + 1, cz) && cx >= 0 && cx <= 16 && cz >= 0 && cz <= 16;
      for (const s of [1, -1, 2, -2]) if (free(ox + ax * s, oz + az * s)) { bp.mark('lectern_spot', ox + ax * s, y, oz + az * s, { facing: f }); break; }
      for (const s of [-1, 1, -2]) if (free(ox + ax * s, oz + az * s)) { bp.mark('pet_spot', ox + ax * s, y, oz + az * s); break; }
      for (const s of [1, -1]) if (bp.get(x + ax * s, y + 1, z + az * s) && !bp.get(ox + ax * s, y + 1, oz + az * s)) { bp.mark('sign_spot', ox + ax * s, y + 1, oz + az * s, { facing: f }); break; }
    }
  }
  let barrels = 0;
  for (const [x, y, z, b] of blocks) {
    const n = name(b);
    const p = props(b);
    if (n === 'bell') bp.mark('bell', x, y, z);
    if (/_bed$/.test(n) && p.part === 'head' && covered(x, y, z)) bp.mark('bed', x, y, z, { facing: p.facing, data: { owner: type === 'hotel' || type === 'hut' ? 'guest' : 'family' } });
    if (PROFESSION[n] && (n !== 'barrel' || barrels++ < 1)) bp.mark('workstation', x, y, z, { data: { profession: PROFESSION[n] } });
    // Seats: lone wooden / quartz stairs (chairs, benches, pews), not part of a staircase or a roof.
    if (/_stairs$/.test(n) && p.half === 'bottom' && /oak|spruce|birch|cherry|mangrove|bamboo|quartz|acacia|jungle|crimson|warped/.test(n) && !bp.get(x, y + 1, z)) {
      const below = bp.get(x, y - 1, z);
      const [dx, dz] = DIR[p.facing] ?? [0, 0];
      const stairLike = (b2) => b2 && /_stairs/.test(b2);
      if (below && !stairLike(below) && !stairLike(bp.get(x + dx, y + 1, z + dz)) && !stairLike(bp.get(x - dx, y - 1, z - dz)) && y <= 30)
        bp.mark('seat', x, y, z, { facing: OPP[p.facing] });
    }
  }
  return bp;
}
