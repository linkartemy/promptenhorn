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

// ================================================================ interiors: stairs, ladders, partitions, furniture

const isWalkable = (b) => !b || /carpet|pressure_plate/.test(b);

/**
 * Switch-back staircase in a two-lane shaft (works for any storey heights).
 * axis: 'z' (flights run along z) or 'x'. laneA / laneB: lists of cross coordinates (1 or 2 wide each).
 * u0: approach cell of the first flight along the axis, dir: +1 / -1 ascent direction of the first flight.
 * planes: floor block levels [F0, F1, ...]; flight i climbs from planes[i] to planes[i+1] in lane A (even) or B (odd).
 * Returns { cells: footprint [[x, z]] reserved on every floor, ends: approach/exit cells per plane }.
 */
function stairHall(bp, { axis, laneA, laneB, u0, dir, planes, wood = 'spruce', under = `${wood}_planks`, stageOf }) {
  // stageOf(i): growth stage of flight i (the flight that arrives at planes[i + 1]); default: the current stage.
  const stage0 = bp.stage;
  const xz = (u, v) => (axis === 'z' ? [v, u] : [u, v]);
  const facingOf = (d) => (axis === 'z' ? (d < 0 ? 'north' : 'south') : d < 0 ? 'west' : 'east');
  const us = new Set();
  const ends = {};
  let a = u0;
  let d = dir;
  for (let i = 0; i + 1 < planes.length; i++) {
    if (stageOf) bp.stage = stageOf(i);
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
        if (under && k > 0 && !nextToPane(bp, x, F0 + k, z, 1, 'stone')) bp.set(x, F0 + k, z, under);
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
  // The far end of the next flight's lane is a dead pocket on each landing (cut off by holes and steps):
  // fill it as a pillar that carries the next landing.
  {
    let a2 = u0;
    let d2 = dir;
    for (let i = 0; i + 1 < planes.length; i++) {
      if (stageOf) bp.stage = stageOf(i);
      const R = planes[i + 1] - planes[i];
      const e = a2 + d2 * (R + 1);
      if (i >= 1) {
        const lane = i % 2 ? laneB : laneA;
        const ePrevNext = a2 + d2 * (R + 1);
        for (const v of lane) {
          const [x, z] = xz(ePrevNext, v);
          for (let y = planes[i] + 1; y < planes[i + 1]; y++) if (!nextToPane(bp, x, y, z, 1, 'stone')) bp.set(x, y, z, under ?? `${wood}_planks`);
        }
      }
      a2 = e;
      d2 = -d2;
    }
  }
  bp.stage = stage0;
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
  // Only entries that are walkable to begin with (a ladder or stove on a keep cell is not a way in).
  for (let i = entries.length - 1; i >= 0; i--) if (!walk(...entries[i])) entries.splice(i, 1);
  const connected = () => {
    const free = [];
    for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) if (walk(x, z)) free.push(`${x},${z}`);
    if (!free.length) return true;
    const fs = new Set(free);
    const roots = [...new Set(entries.map(([x, z]) => `${x},${z}`))].filter((k) => fs.has(k));
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
    const had = cells.map(([x, yy, z]) => bp.everSet(x, yy, z));
    for (const [x, yy, z, b] of cells) bp.set(x, yy, z, b);
    if (connected()) return true;
    cells.forEach(([x, yy, z], i) => {
      bp.set(x, yy, z, null);
      if (!had[i]) bp.ever.delete(`${x},${yy},${z}`); // a tried and withdrawn piece leaves no trace for everSet()
    });
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
  let placedN = 0;
  for (const it of o.items ?? lists[kind] ?? lists.living) if (place(items[it])) placedN++;
  // Rooms are remembered for the props pass (decorate) that runs after the generator's own decisions.
  if (!o.bare) (bp.rooms ??= []).push({ ...r, h, kind, wood, keep, stage: bp.stage });
  if (o.bare) return placedN;
  // Dining table with chairs (and table cloth) in the middle.
  const cx = (x1 + x2) >> 1;
  const cz = (z1 + z2) >> 1;
  if (o.table ?? ['stube', 'kitchen', 'common', 'living'].includes(kind)) {
    const ok = tryPlace([[cx, y, cz, `${wood}_fence`], [cx, y + 1, cz, rng.pick(['white_carpet', `${wood}_pressure_plate`, 'red_carpet'])]]);
    if (ok) for (const f of Object.keys(DIR)) if (rng.chance(0.85)) {
      if (tryPlace([[cx + DIR[f][0], y, cz + DIR[f][1], `${wood}_stairs[facing=${f},half=bottom]`]])) o.marks?.push(['seat', cx + DIR[f][0], y, cz + DIR[f][1], { facing: OPP[f] }]);
    }
  }
  // A blank stretch of wall for a painting.
  if (['stube', 'living', 'lobby', 'bedroom', 'twin', 'guest', 'common', 'office'].includes(kind))
    for (const [x, z, f] of shuffled) {
      const wall = bp.get(x - DIR[f][0], y + 1, z - DIR[f][1]);
      if (!bp.get(x, y + 1, z) && wall && !/glass|pane|door|ladder/.test(wall) && !keepSet.has(`${x},${z}`)) {
        const p = wallPatch(bp, x, y + 1, z, f, inRoom, h - 1);
        bp.mark('painting_spot', x, y + 1, z, { facing: f, data: p ?? { w: 1, h: 1, dir: alongDir(f) } });
        break;
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
// ================================================================ props: the small things that make rooms lived in
// decorate() runs at the very end of a generator (after its last rng decision), over the rooms furnish() recorded:
// candles, cakes, pots and plants on furniture, a tapestry on a blank wall, coat hooks by the front door, and markers
// for entity props the bridge may add (paintings with their size, wall clocks, coat-rack armor stands, food on tables).
// Every prop belongs to the growth stage of its room.

/** Furniture with a full, sturdy top (candles and cakes need one; pots don't but look right there). */
const PROP_BASE = /^minecraft:(barrel|crafting_table|bookshelf|chiseled_bookshelf|[a-z_]+_planks|smooth_quartz|cartography_table|fletching_table|smithing_table|loom|composter)\b/;
const FULL_WALL = (b) => b && !/glass|pane|_door|ladder|trapdoor|_stairs|_slab|fence|_wall\b|_bars|leaves|banner|sign|lantern|torch|carpet|_bed|chest|cauldron|campfire|smoker|furnace|lectern|potted|flower_pot|decorated_pot|cake|candle|shelf|hay_block|composter|barrel|crafting|bookshelf/.test(b);

const TAPESTRIES = [
  ['red', pattern([['straight_cross', 'white'], ['border', 'red']])],
  ['green', pattern([['flower', 'white'], ['border', 'white']])],
  ['white', pattern([['rhombus', 'red'], ['border', 'red']])],
  ['blue', pattern([['stripe_center', 'white'], ['stripe_middle', 'white'], ['curly_border', 'blue']])],
  ['brown', pattern([['triangles_bottom', 'white'], ['flower', 'yellow']])],
  ['white', pattern([['stripe_top', 'red'], ['stripe_bottom', 'red'], ['circle', 'red']])],
  ['cyan', pattern([['gradient', 'white'], ['flower', 'white']])],
];

const PROPS_BY_KIND = {
  kitchen: { n: 2, list: [['cake', 2], ['potted_fern', 1], ['candle[candles=2,lit=true]', 1], ['decorated_pot[facing=south]', 1]] },
  stube: { n: 2, list: [['candle[candles=3,lit=true]', 2], ['potted_red_tulip', 1.5], ['potted_flowering_azalea_bush', 1], ['decorated_pot[facing=south]', 1]] },
  living: { n: 2, list: [['candle[candles=2,lit=true]', 1.5], ['potted_azalea_bush', 1.5], ['potted_bamboo', 1], ['decorated_pot[facing=south]', 1]] },
  common: { n: 2, list: [['candle[candles=3,lit=true]', 2], ['potted_dandelion', 1], ['decorated_pot[facing=south]', 1]] },
  lobby: { n: 2, list: [['potted_flowering_azalea_bush', 2], ['candle[candles=4,lit=true]', 1]] },
  office: { n: 2, list: [['candle[candles=1,lit=true]', 2], ['potted_fern', 1], ['decorated_pot[facing=south]', 0.6]] },
  shop: { n: 3, list: [['decorated_pot[facing=south]', 2], ['candle[candles=3,lit=true]', 1], ['potted_red_tulip', 1], ['cake', 0.6]] },
  bedroom: { n: 1, list: [['candle[candles=1,lit=true]', 1.5], ['potted_white_tulip', 1], ['potted_pink_tulip', 1]] },
  twin: { n: 1, list: [['candle[candles=1,lit=true]', 1.5], ['potted_lily_of_the_valley', 1]] },
  guest: { n: 1, list: [['potted_red_tulip', 1], ['candle[candles=1,lit=true]', 1]] },
  bath: { n: 1, list: [['potted_fern', 1], ['candle[candles=2,lit=true]', 1]] },
  dorm: { n: 1, list: [['candle[candles=1,lit=true]', 1]] },
};
const TAPESTRY_ROOMS = new Set(['stube', 'living', 'lobby', 'common', 'office', 'guest', 'bedroom', 'twin']);
const CLOCK_ROOMS = new Set(['stube', 'kitchen', 'living', 'common', 'lobby', 'office']);
const FOODS = ['bread', 'apple', 'baked_potato', 'cookie', 'pumpkin_pie', 'cake', 'sweet_berries', 'honey_bottle', 'mushroom_stew', 'cooked_chicken'];

/** Size of a blank wall patch for a painting at slot (x, y, z) facing f: { w (1..2, extending `dir`), h (1..2) }. */
function wallPatch(bp, x, y, z, f, inRoom, maxH = 2) {
  const [dx, dz] = DIR[f];
  const blank = (cx, cy, cz) => inRoom(cx, cz) && !bp.everSet(cx, cy, cz) && FULL_WALL(bp.get(cx - dx, cy, cz - dz));
  if (!blank(x, y, z)) return null;
  const [ax, az] = along(f);
  const dir = alongDir(f);
  const w = blank(x + ax, y, z + az) ? 2 : 1;
  const h = maxH >= 2 && blank(x, y + 1, z) && (w === 1 || blank(x + ax, y + 1, z + az)) ? 2 : 1;
  return { w, h, dir };
}

function decorate(bp, rng) {
  const stage0 = bp.stage;
  const marked = (kind, x, y, z) => bp.markers.some((m) => m.kind === kind && m.x === x && m.y === y && m.z === z);
  let clocks = 0;
  for (const r of bp.rooms ?? []) {
    bp.stage = r.stage ?? 1;
    const { x1, z1, x2, z2, y, kind } = r;
    const h = r.h ?? 3;
    const inRoom = (x, z) => x >= x1 && x <= x2 && z >= z1 && z <= z2;
    const keep = new Set((r.keep ?? []).map(([x, z]) => `${x},${z}`));
    // Things on furniture.
    const spec = PROPS_BY_KIND[kind];
    if (spec) {
      const tops = [];
      for (let x = x1; x <= x2; x++)
        for (let z = z1; z <= z2; z++) {
          const b = bp.get(x, y, z);
          if (b && PROP_BASE.test(b) && !bp.everSet(x, y + 1, z) && h >= 2) tops.push([x, z]);
        }
      for (let i = 0; i < spec.n && tops.length; i++) {
        const [x, z] = tops.splice(Math.floor(rng.next() * tops.length), 1)[0];
        if (rng.chance(0.25)) continue;
        bp.set(x, y + 1, z, rng.weighted(spec.list));
      }
    }
    // Food on dining tables (fence leg with a cloth or plate on top): a spot for an item display.
    for (let x = x1; x <= x2; x++)
      for (let z = z1; z <= z2; z++)
        if (/_fence$/.test(blockName(bp.get(x, y, z))) && /carpet|pressure_plate/.test(bp.get(x, y + 1, z) ?? '') && !marked('food_spot', x, y + 1, z))
          bp.mark('food_spot', x, y + 1, z, { data: { item: rng.pick(FOODS) } });
    // Slots along the walls, in a random order.
    const slots = [];
    for (let x = x1; x <= x2; x++) slots.push([x, z1, 'south'], [x, z2, 'north']);
    for (let z = z1 + 1; z < z2; z++) slots.push([x1, z, 'east'], [x2, z, 'west']);
    const order = slots.map((s) => [rng.next(), s]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
    // A tapestry (wall banner hanging from y+2) on a blank wall.
    if (TAPESTRY_ROOMS.has(kind) && h >= 3 && rng.chance(0.55)) {
      for (const [x, z, f] of order) {
        if (keep.has(`${x},${z}`) || marked('painting_spot', x, y + 1, z)) continue;
        const p = wallPatch(bp, x, y + 1, z, f, inRoom);
        if (!p || p.h < 2) continue;
        const [base, data] = rng.pick(TAPESTRIES);
        bp.set(x, y + 2, z, `${base}_wall_banner[facing=${f}]${data}`);
        break;
      }
    }
    // A wall clock (item frame / display with a clock) at eye height, one per floor's kitchen or Stube.
    if (CLOCK_ROOMS.has(kind) && h >= 3 && clocks < 6) {
      for (const [x, z, f] of order) {
        if (marked('painting_spot', x, y + 1, z) || bp.everSet(x, y + 2, z)) continue;
        const [dx, dz] = DIR[f];
        if (!FULL_WALL(bp.get(x - dx, y + 2, z - dz))) continue;
        bp.mark('wall_clock', x, y + 2, z, { facing: f });
        clocks++;
        break;
      }
    }
  }
  // Coat hooks and a coat-rack spot inside the main entrance.
  const base = bp.atStage(1);
  const doors = [...base.blocks].filter(([k, b]) => /_door\b/.test(b) && /half=lower/.test(b) && Number(k.split(',')[1]) <= 2);
  doors.sort((a, b) => Number(b[0].split(',')[2]) - Number(a[0].split(',')[2]));
  const d = doors[0];
  if (d) {
    const [x, y, z] = d[0].split(',').map(Number);
    const f = blockProps(d[1]).facing;
    if (DIR[f]) {
      bp.stage = 1;
      const [dx, dz] = DIR[f];
      const [ax, az] = along(f);
      const ix = x - dx, iz = z - dz;
      let hooks = 0;
      for (const s of [1, -1, 2, -2]) {
        const cx = ix + ax * s, cz = iz + az * s;
        const wall = base.get(cx + dx, y + 1, cz + dz);
        if (bp.everSet(cx, y + 1, cz) || !FULL_WALL(wall) || bp.get(cx + dx, y + 1, cz + dz) !== wall || base.get(cx, y - 1, cz) == null) continue;
        bp.set(cx, y + 1, cz, `tripwire_hook[facing=${OPP[f]},attached=false,powered=false]`);
        if (!hooks && !bp.everSet(cx, y, cz)) bp.mark('coat_rack', cx, y, cz, { facing: OPP[f] });
        if (++hooks >= 2) break;
      }
    }
  }
  bp.stage = stage0;
  return bp;
}

// ================================================================ chalet (Bernese Oberland)

export function chalet(rng, options = {}) {
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
  // Growth stages: 1 = this ground floor under a provisional roof (drawn at the end), 2 = the full chalet.
  for (let u = 0; u < nUp; u++) {
    const yb = 4 + 4 * u;
    bp.stage = u === 0 ? 1 : 2;
    bp.fill(ix1, yb, iz1, ix2, yb, iz2, inner.planks);
    logRing(bp, x1, z1, x2, z2, yb, tw.log);
    bp.stage = 2;
    bp.walls(x1, yb + 1, z1, x2, yb + 3, z2, timber);
  }
  bp.fill(ix1, yTop, iz1, ix2, yTop, iz2, inner.planks);
  logRing(bp, x1, z1, x2, z2, yTop, tw.log);
  bp.stage = 1;

  // ---- windows and doors
  const gx = W === 11 ? [[cx - 3, 1], [cx + 3, 1]] : [[cx - 4, 2], [cx + 3, 2]];
  for (const [x, w] of gx) win(bp, rng, x, 2, z2, 'south', { w, h: 2, shutters: shutter });
  for (const x of [cx - 3, cx + 2]) win(bp, rng, x, 2, z1, 'north', { w: 2, h: 2, shutters: shutter });
  const groups = W === 13 ? [[2, 3], [5, 5]] : [[2, 3]];
  const leanZ = [z1 + 1, Math.min(z2 - 2, z1 + 5)];
  const inLean = (z) => leanTo && z >= leanZ[0] - 1 && z <= leanZ[1] + 1;
  const sideZ = [];
  for (let z = z1 + 2; z <= z2 - 2; z += 3) sideZ.push(z);
  bp.stage = 2;
  for (let u = 0; u < nUp; u++) {
    const yb = 4 + 4 * u;
    for (const [a, b] of groups)
      for (const sgn of [-1, 1]) win(bp, rng, sgn > 0 ? cx + a : cx - b, yb + 1, z2, 'south', { w: b - a + 1, h: 2, shutters: shutter });
    bp.door(cx, yb + 1, z2, tw.door, 'south');
    win(bp, rng, cx + 2, yb + 1, z1, 'north', { w: 2, h: 2, shutters: shutter, box: trimW.trapdoor });
  }
  for (const z of sideZ) {
    bp.stage = 1;
    win(bp, rng, x1, 2, z, 'west', { h: 2, shutters: shutter });
    if (!inLean(z)) win(bp, rng, x2, 2, z, 'east', { h: 2, shutters: shutter });
    bp.stage = 2;
    for (let u = 0; u < nUp; u++) {
      const yb = 4 + 4 * u;
      win(bp, rng, x1, yb + 1, z, 'west', { h: 2, shutters: shutter, box: trimW.trapdoor });
      if (u === 0 && inLean(z)) continue;
      win(bp, rng, x2, yb + 1, z, 'east', { h: 2, shutters: sideDeck && u === 0 ? undefined : shutter, box: sideDeck && u === 0 ? undefined : trimW.trapdoor });
    }
  }
  bp.stage = 1;
  bp.door(cx, 1, z2, tw.door, 'south');
  bp.set(cx, 0, z2 + 1, 'stone_brick_slab[type=top]');
  wallLamp(bp, cx + 1, 3, z2, 'south', trimW.fence);
  wallLamp(bp, cx - 1, 3, z2, 'south', trimW.fence);

  // ---- staircase along the east wall, rooms, chimney above the kitchen stove
  bp.stage = 2;
  const hall = stairHall(bp, { axis: 'z', laneA: [ix2 - 1], laneB: [ix2], u0: iz2, dir: -1, planes, wood: inner.name });
  let zp = (iz1 + iz2) >> 1;
  if (sideZ.includes(zp)) zp++;
  const roomX2 = ix2 - 2;
  const sx = ix1;
  for (const F of planes) {
    bp.stage = F === 0 ? 1 : 2;
    const panel = (x, y, z) => (y === F + 1 ? inner.planks : `${inner.stripped}[axis=x]`);
    partition(bp, ix1, zp, roomX2, zp, F + 1, 3, panel, [[F === 0 ? cx - 1 : cx, zp]], inner.door);
  }
  // Kitchen stove with its chimney breast running up through every floor and out of the roof.
  bp.stage = 1;
  bp.set(sx, 1, iz1, 'smoker[facing=south,lit=true]');
  bp.stage = 2;
  // ---- roof: wide overhang, gable to the street, decorative barge boards
  const R = { x1: x1 - 2, x2: x2 + 2, z1: z1 - 1, z2: z2 + 3 };
  const at = roof(bp, { ...R, y: steep ? yTop - 1 : yTop, mat: roofMat, kind: steep ? 'stairs' : 'slabs', n: INF, s: INF, trim: { stairs: trimW.stairs, slab: trimW.slab } });
  closeUnder(bp, at, perimeter(x1, z1, x2, z2), yTop + 1, tw.planks, roofMat);
  const chim = rng.pick(['cobblestone', 'stone_bricks', 'bricks']);
  bp.atStageDraw(1, () => bp.fill(sx, 2, iz1, sx, 3, iz1, chim));
  bp.fill(sx, 4, iz1, sx, at(sx, iz1).y + 1, iz1, chim);
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
  bp.stage = 1;
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
  bp.stage = 2;
  for (let u = 1; u <= nUp; u++) {
    const F = planes[u];
    const keep = [...keepOn(F), [cx, iz1 + 1], [cx, iz1]];
    furnish(bp, rng, front(F), u === 1 ? 'bedroom' : 'twin', keep, inner.name);
    furnish(bp, rng, back(F), u === 1 ? 'bath' : 'office', keep, inner.name);
  }
  bp.atStageDraw(1, () => light(bp, { x1: ix2 - 1, z1: iz1, x2: ix2, z2: iz2, y: 1, h: 3 }));
  furnish(bp, rng, { x1: ix1 + 1, z1: iz1, x2: ix2 - 1, z2: iz2, y: yTop + 1, h: 2 }, 'storage', [[cx, iz1], [cx, iz1 + 1], [cx, iz2], [cx, iz2 - 1]], inner.name, { items: ['barrel', 'chest', 'barrel'] });

  // ---- garden
  bp.stage = 1;
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
  const mirror = rng.chance(0.5);
  // Everything below uses rng only after the last decision of the original generator (renovation stays a diff).

  // ---- growth stage 1: the ground floor alone under a provisional roof, with a bed and a washtub in the Stube
  bp.overlay(1, 1, (v) => {
    const skip = leanTo ? (x, z) => x > x2 && z >= leanZ[0] - 1 && z <= leanZ[1] + 1 : undefined;
    const at1 = roof(v, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 1, y: steep ? 4 : 5, mat: roofMat, kind: steep ? "stairs" : "slabs", n: INF, s: INF, trim: { stairs: trimW.stairs, slab: trimW.slab }, skip });
    closeUnder(v, at1, perimeter(x1, z1, x2, z2), 5, timber, roofMat);
    v.fill(sx, 4, iz1, sx, at1(sx, iz1).y + 1, iz1, chim);
    v.set(sx, at1(sx, iz1).y + 2, iz1, 'campfire[lit=true,signal_fire=false]');
    if (at1(cx, z2).y - 5 >= 2) v.set(cx, at1(cx, z2).y - 1, z2 + 1, `red_wall_banner[facing=south]${SWISS_FLAG}`);
    ladderUp(v, cx, iz1, 'south', 1, 4);
    // Where the staircase will go: a sleeping alcove with a washstand along the east wall.
    furnish(v, rng, { x1: ix2 - 1, z1: iz1, x2: ix2, z2: iz2, y: 1, h: 3 }, 'bedroom', [[ix2 - 1, iz2], [ix2, iz2]], inner.name, { items: ['bed', 'tub', 'chest'], bare: true });
  });
  // ---- terrain variant (walk-out cellar or Stadel posts), part of the house from stage 1
  terrainVariant(bp, rng, options.terrain, { x1, z1, x2, z2, wood: tw, mirror });
  // ---- growth stage 3: a glazed Wintergarten under the front Laube, then the yard grows (fountain, bees, flag)
  bp.stage = 3;
  {
    const zf = z2 + 3;
    for (let x = x1; x <= x2; x++)
      for (let z = z2 + 1; z <= zf; z++) {
        bp.set(x, 0, z, z === zf || x === x1 || x === x2 ? 'stone_bricks' : inner.planks);
        for (let y = 1; y <= 3; y++) {
          const b = bp.get(x, y, z);
          if (b && !/lantern|fence|_trapdoor/.test(b)) bp.set(x, y, z, null);
        }
      }
    const post = `${tw.log}[axis=y]`;
    for (let z = z2 + 1; z <= zf; z++)
      for (const x of [x1, x2]) for (let y = 1; y <= 3; y++) bp.set(x, y, z, z === zf || y === 3 ? post : 'glass_pane');
    for (let x = x1 + 1; x < x2; x++) {
      const isPost = x === cx - 1 || x === cx + 1 || (x - x1) % 4 === 0 && Math.abs(x - cx) > 1;
      for (let y = 1; y <= 2; y++) bp.set(x, y, zf, isPost ? post : 'glass_pane');
      bp.set(x, 3, zf, `${tw.stripped}[axis=x]`);
      bp.set(x, 4, zf, `${trimW.slab}[type=bottom]`);
    }
    for (const x of [x1, x2]) bp.set(x, 4, zf, `${trimW.slab}[type=bottom]`);
    bp.door(cx, 1, zf, tw.door, 'south');
    bp.set(cx, 0, zf + 1, 'stone_brick_slab[type=top]');
    for (let x = x1 + 1; x < x2; x++) if (Math.abs(x - cx) > 1 && !bp.get(x, 1, zf + 1)) bp.set(x, 1, zf + 1, rng.pick(BOX_FLOWERS));
    furnish(bp, rng, { x1: x1 + 1, z1: z2 + 1, x2: x2 - 1, z2: z2 + 2, y: 1, h: 2 }, 'living', [[cx, z2 + 1], [cx, z2 + 2]], inner.name, { items: ['plant', 'armchair', 'plant', 'armchair', 'plant'], table: false });
  }
  growYard(bp, rng, { house: [x1 - 1, z1, x2 + 1, z2 + 2], wood: trimW, roofMat, door: [cx, z2 + 1], prefer: ['fountain', 'bees', 'greenhouse', 'flag'] });
  bp.stage = 1;
  decorate(bp, rng);
  if (mirror) bp.mirrorX();
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
  // Growth stages: stage 1 has the first `f1` upper floors (one flat) under a provisional roof, stage 2 all of them.
  const f1 = Math.min(floors, o.stage1Floors ?? 1);
  const st = (f) => (f < f1 ? 1 : 2);
  const stage0 = bp.stage;
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
    bp.stage = st(f);
    bp.walls(x1, yb(f), z1, x2, yb(f) + 3, z2, wallFn);
    bp.stage = f <= f1 ? 1 : 2;
    bp.fill(ix1, yb(f), iz1, ix2, yb(f), iz2, P.inner.planks);
  }
  bp.stage = floors <= f1 ? 1 : 2;
  bp.fill(ix1, wallTop + 1, iz1, ix2, wallTop + 1, iz2, 'spruce_planks');
  bp.stage = stage0;

  // Stair hall along the back wall: lane B against the wall, lane A in front of it; ladder to the attic.
  const hall = stairHall(bp, { axis: 'x', laneA: [iz1 + 1], laneB: [iz1], u0: ix2, dir: -1, planes, wood: P.inner.name, stageOf: (i) => st(i) });
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
    bp.stage = st(f);
    for (const { x, w, sh } of winX) {
      const inOriel = oTop >= 0 && Math.abs(x - cx) <= 1 && f <= oTop + 1;
      const low = noLow && f === 0;
      win(bp, rng, x, y, z2, 'south', {
        w, h: 2, lintel: lintel('x'), shutters: inOriel || !sh ? null : P.shutter, frame: !fach && !sh && !inOriel && P.style === 'painted' && winX.length <= 3 ? P.trim.block : undefined,
        box: !inOriel && !low && boxes && f <= 1 ? P.box : undefined, sill: inOriel || low ? undefined : sill,
      });
      if (Math.abs(x - cx) >= 2 && Math.abs(x - bw) >= 1 && x + w - 1 !== bw && x + w < hallU - 1) win(bp, rng, x, y, z1, 'north', { w, h: 2, lintel: lintel('x'), shutters: sh ? P.shutter : null, sill });
    }
    for (const z of sideZ) {
      win(bp, rng, x1, y, z, 'west', { h: 2, lintel: lintel('z'), shutters: P.shutter, sill });
      win(bp, rng, x2, y, z, 'east', { h: 2, lintel: lintel('z'), shutters: P.shutter, sill });
    }
  }
  bp.stage = stage0;
  // Oriel (Erker): a glazed bay in front of the centre window.
  if (oTop >= 0) {
    for (let f = 0; f <= oTop; f++)
      for (let x = cx - 1; x <= cx + 1; x++) {
        bp.stage = st(f);
        bp.set(x, yb(f), z2 + 1, fach ? `${P.beam.log}[axis=x]` : P.trim.block);
        bp.set(x, yb(f) + 1, z2 + 1, x === cx ? 'glass_pane' : P.plaster);
        bp.set(x, yb(f) + 2, z2 + 1, x === cx ? 'glass_pane' : P.plaster);
        bp.set(x, yb(f) + 3, z2 + 1, fach ? `${P.beam.log}[axis=x]` : P.trim.block);
      }
    for (let f = 0; f <= oTop; f++) for (const y of [yb(f) + 1, yb(f) + 2]) bp.atStageDraw(st(f), () => bp.set(cx, y, z2, null));
    for (let x = cx - 1; x <= cx + 1; x++) {
      bp.stage = st(0);
      bp.set(x, yb(0) - 1, z2 + 1, x === cx ? `${P.trim.slab}[type=top]` : `${P.trim.stairs}[facing=north,half=top]`);
      bp.stage = st(oTop);
      bp.set(x, yb(oTop + 1), z2 + 1, `${ROOFS.copper.stairs}[facing=north,half=bottom]`);
    }
    bp.stage = stage0;
  }

  // Roof.
  bp.stage = floors <= f1 ? 1 : 2;
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
    bp.stage = st(f);
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
  bp.stage = floors <= f1 ? 1 : 2;
  ladderUp(bp, ladderX, ladderZ, 'north', planes[planes.length - 1] + 1, wallTop + 1);
  bp.fill(ix1, wallTop + 2, stoveZ, ix1, Math.max(wallTop + 2, at(ix1, stoveZ).y + 1), stoveZ, 'bricks');
  for (let f = 0; f < floors; f++) bp.atStageDraw(f === 0 ? 1 : bp.stage, () => bp.set(ix1, yb(f), stoveZ, 'bricks'));
  bp.set(ix1, wallTop + 1, stoveZ, 'bricks');
  bp.set(ix1, at(ix1, stoveZ).y + 2, stoveZ, rng.chance(0.6) ? 'campfire[lit=true,signal_fire=false]' : 'brick_slab[type=bottom]');
  // Attic storage.
  furnish(bp, rng, { x1: ix1 + 2, z1: iz1 + 1, x2: ix2 - 1, z2: iz2 - 1, y: wallTop + 2, h: 2 }, 'storage', [[ladderX, ladderZ], [ladderX - 1, ladderZ]], 'spruce', { items: ['barrel', 'chest', 'barrel'] });
  // Flag on the corner under the eaves.
  const [base, data] = rng.chance(0.5) ? ['red', SWISS_FLAG] : rng.pick(CANTONS);
  if (!bp.get(x1, wallTop - 1, z2 + 1) && !bp.get(x1, wallTop - 2, z2 + 1)) bp.set(x1, wallTop - 1, z2 + 1, `${base}_wall_banner[facing=south]${data}`);
  bp.stage = stage0;
  // Stage 1: the same roof (eaves or gable to the street) over the first floors; called by the generator at the end.
  const stage1Roof = () => {
    if (floors <= f1) return;
    const top1 = g + 4 * f1;
    bp.overlay(1, 1, (v) => {
      const at1 = roof(v, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 1, y: top1, mat: P.roof, ...(gableFront ? { n: INF, s: INF } : { w: INF, e: INF }), trim, brackets: P.eave.stairs });
      closeUnder(v, at1, perimeter(x1, z1, x2, z2), top1 + 1, P.plaster, P.roof);
      v.fill(ix1, top1 + 1, stoveZ, ix1, at1(ix1, stoveZ).y + 1, stoveZ, 'bricks');
      v.set(ix1, at1(ix1, stoveZ).y + 2, stoveZ, 'campfire[lit=true,signal_fire=false]');
      ladderUp(v, ladderX, ladderZ, 'north', planes[f1] + 1, top1 + 1);
      if (!v.get(x1, top1 - 1, z2 + 1) && !v.get(x1, top1 - 2, z2 + 1)) v.set(x1, top1 - 1, z2 + 1, `${base}_wall_banner[facing=south]${data}`);
    });
  };
  return { at, wallTop, cx, hall, planes, ix1, ix2, iz1, iz2, stage1Roof, f1, zp, stoveZ };
}

// ---------------------------------------------------------------- townhouse

export function townhouse(rng, options = {}) {
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
  const mirror = rng.chance(0.5);
  // Growth: stage 1 = shop and one flat under a provisional roof; stage 3 = the shop does well (awning,
  // goods and a bench on the street, a second flag) and the back yard gets beds and a bench.
  body.stage1Roof();
  terrainVariant(bp, rng, options.terrain, { x1, z1, x2, z2, wood: P.inner, mirror, modes: ['walkout'] });
  bp.stage = 3;
  if (style !== 'lauben') {
    const [ca, cb] = rng.pick([['red', 'white'], ['green', 'white'], ['blue', 'white'], ['brown', 'yellow'], ['orange', 'white']]);
    for (let x = x1; x <= x2; x++) {
      if (Math.abs(x - cx) <= 1 || bp.everSet(x, 3, z2 + 1)) continue;
      bp.set(x, 3, z2 + 1, `${wood}_trapdoor[facing=south,half=top]`);
      if (!bp.everSet(x, 4, z2 + 1)) bp.set(x, 4, z2 + 1, `${x % 2 ? ca : cb}_carpet`);
    }
  }
  for (const [x, z, back] of [[cx + 3, 15, 'south'], [cx - 4, 15, 'south']]) {
    if ([x - 1, x, x + 1, x + 2].every((xx) => !bp.everSet(xx, 1, z) && !bp.everSet(xx, 2, z) && !bp.everSet(xx, 3, z))) { bench(bp, x, z, back, 2, wood); break; }
  }
  for (const x of [x1 + 1, x2 - 1]) if (!bp.everSet(x, 1, z2 + 2) && !bp.everSet(x, 2, z2 + 2)) bp.set(x, 1, z2 + 2, rng.pick(['barrel[facing=up]', 'decorated_pot[facing=south]', 'potted_azalea_bush', 'composter[level=8]']));
  {
    const [b2, d2] = rng.pick(CANTONS);
    const y = body.wallTop - 1;
    if (!bp.everSet(x2, y, z2 + 1) && !bp.everSet(x2, y - 1, z2 + 1)) bp.set(x2, y, z2 + 1, `${b2}_wall_banner[facing=south]${d2}`);
  }
  growYard(bp, rng, { house: [x1, z1, x2, z2], wood: P.inner, roofMat: P.roof, prefer: ['beds', 'bench', 'woodpile'], max: 2 });
  bp.stage = 1;
  decorate(bp, rng);
  if (mirror) bp.mirrorX();
  return bp;
}

// ---------------------------------------------------------------- café / Konditorei

export function cafe(rng, options = {}) {
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
  const mirror = rng.chance(0.5);
  // Growth: stage 1 = the café and one flat under a provisional roof; stage 3 = two more parasol tables on the
  // terrace and a Glace cart, the back yard gets a bench and a herb bed.
  body.stage1Roof();
  bp.stage = 3;
  for (const [tx, tz] of [[5, 15], [11, 15]]) {
    const cells = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) cells.push([tx + dx, tz + dz]);
    if (cells.some(([x, z]) => !inPlot(x, z) || [1, 2, 3, 4, 5].some((y) => bp.everSet(x, y, z)))) continue;
    bp.fill(tx, 1, tz, tx, 3, tz, `${wood}_fence`);
    for (const [x, z] of cells) {
      const c = (x + z) % 2 ? colA : colB;
      bp.set(x, 4, z, x === tx && z === tz ? `${c}_wool` : `${wood}_trapdoor[facing=south,half=top]`);
      bp.set(x, 5, z, `${c}_carpet`);
    }
    bp.set(tx - 1, 1, tz, `${wood}_stairs[facing=west,half=bottom]`);
    bp.set(tx + 1, 1, tz, `${wood}_stairs[facing=east,half=bottom]`);
    bp.mark('food_spot', tx, 2, tz, { data: { item: rng.pick(['cake', 'cookie', 'pumpkin_pie', 'sweet_berries']) } });
  }
  growYard(bp, rng, { house: [x1, z1, x2, z2], wood: P.inner, roofMat: P.roof, prefer: ['bench', 'beds', 'flag'], max: 2 });
  bp.stage = 1;
  decorate(bp, rng);
  if (mirror) bp.mirrorX();
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
  bp.mark('clock_spot', x, y, z, { facing: face });
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
  const mirror = rng.chance(0.5);
  decorate(bp, rng);
  if (mirror) bp.mirrorX();
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

function modernCube(rng, options) {
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
  // Growth: stage 1 is the glazed ground floor under this slab (a flat-roofed bungalow), stage 2 adds the box.
  bp.stage = 2;
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
  bp.stage = 1;
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
  bp.stage = 2;
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
  bp.stage = 1;
  modernGarden(bp, rng, { poolX: [10, 14], poolZ: [13, 15], path: [[x1 + 6, 12], [x1 + 6, 14], [x1 + 6, 16]] });
  broadTree(bp, 3, 14, 5, 2, 'birch');
  for (let z = 0; z <= 16; z++) {
    if (z >= 12) continue;
    bp.setIfEmpty(0, 1, z, 'oak_leaves[persistent=true]');
    bp.setIfEmpty(16, 1, z, 'oak_leaves[persistent=true]');
  }
  sprinkleFlowers(bp, rng, 1, 11, 15, 16, 0.12, ['short_grass', 'fern', 'short_grass', 'cornflower', 'oxeye_daisy']);
  const mirror = rng.chance(0.5);
  bp.overlay(1, 1, (v) => {
    for (const [x, z] of perimeter(x1 - 1, z1, x2, z2 + 1)) v.set(x, 5, z, `${slabOf}[type=bottom]`);
    stage1Bed(v, rng, [[{ x1: x1 + 1, z1: z1 + 6, x2: x1 + 3, z2: z2 - 1, y: 1, h: 3 }, [[x1 + 3, z1 + 6]]], [{ x1: x1 + 5, z1: z1 + 4, x2: x2 - 1, z2: z2 - 1, y: 1, h: 3 }, [[x1 + 6, z2 - 1], [x1 + 5, z1 + 6]]]], 'pale_oak');
  });
  bp.stage = 3;
  growYard(bp, rng, { house: [x1 - 1, z1, x2, z2 + 1], door: [x1 + 6, z2 + 1], wood: WOOD('pale_oak'), prefer: ['pergola', 'beds', 'bench', 'flag'], max: 2 });
  bp.stage = 1;
  decorate(bp, rng);
  if (mirror) bp.mirrorX();
  return bp;
}

function modernGable(rng, options) {
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
  bp.walls(x1, 1, z1, x2, 4, z2, kit.wall);
  bp.atStageDraw(2, () => bp.walls(x1, 5, z1, x2, 7, z2, kit.wall));
  bp.fill(ix1, 4, iz1, ix2, 4, iz2, 'pale_oak_planks');
  // Growth: stage 1 is the ground floor with a flat roof (parapet drawn at the end), stage 2 the gabled house.
  bp.stage = 2;
  const at = roof(bp, { x1, x2, z1, z2, y: 8, mat: kit.roof, n: INF, s: INF });
  closeUnder(bp, at, perimeter(x1, z1, x2, z2), 8, kit.wall, kit.roof);
  // Big gable glazing (a gallery under the roof) and picture windows with deep reveals.
  for (let x = cx - 2; x <= cx + 2; x++) for (let y = 5; y < at(x, z2).y; y++) bp.set(x, y, z2, 'glass');
  bp.fill(cx - 2, 4, z2 + 1, cx + 2, 4, z2 + 1, 'smooth_stone_slab[type=top]');
  for (let x = cx - 2; x <= cx + 2; x++) bp.set(x, 5, z2 + 1, 'glass_pane');
  const holes = [[x1 + 1, 1, z2, 'south', 3, 2], [x2 - 2, 2, z2, 'south', 2, 2], [x1, 5, z1 + 2, 'west', 2, 2], [x1, 1, z1 + 5, 'west', 3, 2],
    [x2, 2, z1 + 2, 'east', 2, 2], [x2, 5, z1 + 5, 'east', 3, 2], [cx - 1, 2, z1, 'north', 3, 2], [cx + 2, 5, z1, 'north', 2, 2]];
  for (const [x, y, z, face, w, h] of holes) bp.atStageDraw(y < 4 ? 1 : 2, () => win(bp, rng, x, y, z, face, { w, h, glass: 'glass' }));
  bp.stage = 1;
  bp.door(x2 - 3, 1, z2, 'dark_oak', 'south');
  bp.set(x2 - 3, 3, z2, 'glass');
  // Stair along the east wall; bath behind a wall downstairs; bedroom and study up on the gallery.
  const hall = bp.atStageDraw(2, () => stairHall(bp, { axis: 'z', laneA: [ix2 - 1], laneB: [ix2], u0: iz2 - 1, dir: -1, planes: [0, 4], wood: 'pale_oak' }));
  const keep = [...hall.cells, ...(hall.ends[0] ?? []), ...(hall.ends[4] ?? []), [x2 - 3, iz2]];
  partition(bp, ix1, iz1 + 2, ix1 + 2, iz1 + 2, 1, 3, kit.wall, [[ix1 + 2, iz1 + 2]], 'pale_oak');
  furnish(bp, rng, { x1: ix1, z1: iz1, x2: ix1 + 2, z2: iz1 + 1, y: 1, h: 3 }, 'bath', [[ix1 + 2, iz1 + 1]], 'pale_oak', { items: ['tub', 'toilet', 'sink'] });
  bp.set(ix1 + 4, 1, iz1, 'smoker[facing=south,lit=true]');
  bp.set(ix1 + 5, 1, iz1, 'water_cauldron[level=3]');
  bp.set(ix1 + 3, 1, iz1, 'smooth_quartz');
  furnish(bp, rng, { x1: ix1, z1: iz1 + 3, x2: ix2 - 2, z2: iz2, y: 1, h: 3 }, 'living', [...keep, [ix1 + 2, iz1 + 3]], 'pale_oak', { items: ['sofa', 'chiseled', 'plant', 'counter', 'plant'], table: true });
  furnish(bp, rng, { x1: ix1 + 3, z1: iz1, x2: ix2 - 2, z2: iz1 + 2, y: 1, h: 3 }, 'kitchen', keep, 'pale_oak', { items: ['counter', 'crafting', 'chest'], table: false });
  bp.stage = 2;
  furnish(bp, rng, { x1: ix1, z1: iz1, x2: ix2 - 2, z2: iz2, y: 5, h: 3 }, 'bedroom', [...keep, ...(hall.ends[4] ?? [])], 'pale_oak', { items: ['bed', 'bed2', 'chest', 'chiseled', 'plant', 'wardrobe'] });
  // Terrace deck with loungers and a table.
  bp.stage = 1;
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
  const mirror = rng.chance(0.5);
  bp.overlay(1, 1, (v) => {
    for (const [x, z] of perimeter(x1, z1, x2, z2)) v.set(x, 5, z, 'smooth_stone_slab[type=bottom]');
    stage1Bed(v, rng, [[{ x1: ix1, z1: iz1 + 3, x2: ix2 - 2, z2: iz2, y: 1, h: 3 }, [...keep, [ix1 + 2, iz1 + 3]]], [{ x1: ix2 - 1, z1: iz1, x2: ix2, z2: iz2, y: 1, h: 3 }, [[ix2 - 1, iz2], [ix2, iz2]]]], 'pale_oak');
  });
  bp.stage = 3;
  growYard(bp, rng, { house: [x1, z1, x2, z2 + 4], door: [x2 - 3, z2 + 1], wood: WOOD('pale_oak'), prefer: ['greenhouse', 'pergola', 'beds', 'flag'], max: 2 });
  bp.stage = 1;
  decorate(bp, rng);
  if (mirror) bp.mirrorX();
  return bp;
}

export function modern(rng, options = {}) {
  return rng.chance(0.5) ? modernCube(rng, options) : modernGable(rng, options);
}

// ================================================================ grand hotel (Belle Époque)

export function hotel(rng, options = {}) {
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
  // Growth: stage 1 = lobby and the first guest floor under a provisional mansard, stage 2 = the grand hotel,
  // stage 3 = garden extras behind. Walls are drawn in two height bands (same order of rng use as one call).
  const top1 = g + 4;
  const st = (f) => (f === 0 ? 1 : 2);
  bp.walls(x1, 1, z1, x2, top1, z2, wallFn);
  bp.atStageDraw(2, () => bp.walls(x1, top1 + 1, z1, x2, top, z2, wallFn));
  bp.walls(6, 1, 12, 10, top1, 13, wallFn);
  bp.atStageDraw(2, () => bp.walls(6, top1 + 1, 12, 10, top, 13, wallFn));
  bp.fill(7, 1, 12, 9, top1, 12, null);
  bp.atStageDraw(2, () => bp.fill(7, top1 + 1, 12, 9, top, 12, null));
  for (let f = 0; f <= floors; f++) {
    const y = f === floors ? top + 1 : yb(f);
    bp.stage = f <= 1 ? 1 : 2;
    bp.fill(x1 + 1, y, z1 + 1, x2 - 1, y, z2 - 1, 'dark_oak_planks');
    bp.fill(7, y, 12, 9, y, 12, 'dark_oak_planks');
  }
  bp.stage = 1;
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
    bp.stage = st(f);
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
  bp.stage = 2;
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
  bp.stage = 1;
  const hall = stairHall(bp, { axis: 'z', laneA: [11, 12], laneB: [13, 14], u0: 11, dir: -1, planes, wood: 'dark_oak', stageOf: st });
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
    bp.stage = st(f);
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
  bp.stage = 2;
  ladderUp(bp, 4, 5, 'north', yb(2) + 1, top + 1);
  furnish(bp, rng, { x1: 6, z1: 6, x2: 12, z2: 9, y: top + 2, h: 3 }, 'storage', [[4, 5], [5, 5], [4, 6]], 'spruce', { items: ['bed', 'chest', 'barrel', 'barrel'] });
  light(bp, { x1: 4, z1: 6, x2: 8, z2: 8, y: top + 2 });

  // Forecourt: red carpet, planters, lamps, flags, café tables.
  bp.stage = 1;
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
  bp.overlay(1, 1, (v) => {
    for (const [x, z] of perimeter(x1, z1, x2, z2)) {
      const f = z === z1 ? 'south' : z === z2 ? 'north' : x === x1 ? 'east' : 'west';
      const [dx, dz] = DIR[OPP[f]];
      if (!(z === z2 && inRis(x))) v.setIfEmpty(x + dx, top1, z + dz, `${trim.stairs}[facing=${f},half=top]`);
    }
    for (let x = 6; x <= 10; x++) {
      v.set(x, top1, 14, `${trim.stairs}[facing=north,half=top]`);
      v.set(x, top1 + 1, 13, `${mansard.slab}[type=bottom]`);
    }
    roof(v, { x1, x2, z1, z2, y: top1 + 1, mat: mansard, kind: 'steep', cap: 2 });
    for (const x of [2, 4, 12, 14]) {
      for (const z of [z1, z2]) {
        v.set(x - 1, top1 + 2, z, mansard.block);
        v.set(x + 1, top1 + 2, z, mansard.block);
        v.set(x, top1 + 2, z, 'glass_pane');
      }
      v.set(x, top1 + 3, z2, `${trim.slab}[type=bottom]`);
    }
    ladderUp(v, 4, 5, 'north', yb(0) + 1, top1 + 1);
  });
  bp.stage = 3;
  growYard(bp, rng, { house: [x1, z1, x2, z2], wood: WOOD('dark_oak'), prefer: ['fountain', 'bench', 'flag', 'bench'], max: 3 });
  bp.stage = 1;
  decorate(bp, rng);
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
  bp.mark('clock_spot', x, y, z, { facing: face });
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
  decorate(bp, rng);
  return bp;
}

// ================================================================ cooperative apartment block (Genossenschaft)

export function apartment(rng, options = {}) {
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
    if (z === z1 && x > 5 && x < 11) return timber;
    const a = isFront ? x : z;
    return (a + 2 * (s % 2)) % 4 === 0 ? timber : 'glass_pane';
  };
  // Growth: stage 1 = entrance hall and the first two flats (three storeys) under a flat roof, stage 2 = all storeys.
  const k1 = 2;
  const st = (s) => (s <= k1 ? 1 : 2);
  bp.fill(x1, 0, z1, x2, 0, z2, 'smooth_stone');
  bp.walls(x1, 1, z1, x2, 3 * (k1 + 1), z2, cell);
  bp.atStageDraw(2, () => bp.walls(x1, 3 * (k1 + 1) + 1, z1, x2, top, z2, cell));
  for (let s = 1; s <= n; s++) bp.atStageDraw(s <= k1 + 1 ? 1 : 2, () => bp.fill(x1 + 1, 3 * s, z1 + 1, x2 - 1, 3 * s, z2 - 1, s === n ? concrete : `${wood}_planks`));
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
  const core = stairHall(bp, { axis: 'x', laneA: [5], laneB: [4], u0: 10, dir: -1, planes, wood, stageOf: (i) => st(i + 1) });
  const balconies = (s) => {
    const ranges = s % 2 ? [[x1 + 1, cx - 1]] : [[cx + 1, x2 - 1]];
    if (n <= 5 || s === n - 1) ranges.push(s % 2 ? [cx + 2, x2 - 1] : [x1 + 1, cx - 2]);
    return ranges;
  };
  for (let s = 0; s < n; s++) {
    const y = 3 * s + 1;
    bp.stage = st(s);
    // Stairwell walls with the flat's front door; bedroom and bathroom walls.
    partition(bp, 5, 4, 5, 6, y, 2, concrete);
    partition(bp, 11, 4, 11, 6, y, 2, concrete);
    partition(bp, 5, 7, 11, 7, y, 2, concrete, [[cx, 7]], wood);
    partition(bp, 3, 7, 4, 7, y, 2, concrete, [[4, 7]], wood);
    partition(bp, 12, 7, 13, 7, y, 2, concrete, [[12, 7]], wood);
    const keep = [...core.cells, ...(core.ends[3 * s] ?? []), [cx, 6], [cx, 8], [4, 8], [4, 6], [12, 8], [12, 6], [cx, z2 - 1], ...(s ? balconies(s).map(([a, b]) => [(a + b) >> 1, z2 - 1]) : [])];
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
    bp.stage = st(s);
    for (const [a, b] of balconies(s)) {
      const cells = [];
      for (let x = a; x <= b; x++) for (let k = 1; k <= 2; k++) cells.push([x, z2 + k]);
      deck(bp, rng, cells, y, { floor: `${slabOf}[type=top]`, railBlock: rail, openAtHouse: true, isHouse: (x, z) => z <= z2, flowers: 0 });
      const dx = (a + b) >> 1;
      for (const xx of [dx - 1, dx + 1]) if (!structX.has(xx)) bp.fill(xx, y + 1, z2, xx, y + 2, z2, timber);
      bp.set(dx, y + 1, z2, null);
      bp.set(dx, y + 2, z2, null);
      bp.door(dx, y + 1, z2, wood, 'south');
      bp.set(a, y + 1, z2 + 1, rng.pick(['potted_azalea_bush', 'potted_flowering_azalea_bush', 'potted_bamboo', 'potted_fern']));
      if (b - a >= 3) bp.set(b, y + 1, z2 + 1, `${wood}_stairs[facing=east,half=bottom]`);
    }
  }
  // Roof: stair house over the core, parapet, green roof with solar panels.
  bp.stage = 2;
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
  bp.stage = 1;
  for (let z = z2 + 1; z <= 16; z++) bp.set(cx, 0, z, 'smooth_stone_slab[type=double]');
  broadTree(bp, 2, 16, 4, 2, 'birch');
  broadTree(bp, 14, 16, 4, 1, 'birch');
  const crop = () => rng.pick(['carrots[age=7]', 'potatoes[age=7]', 'beetroots[age=3]', 'wheat[age=7]']);
  for (let x = 10; x <= 12; x++) {
    bp.set(x, 0, 14, 'farmland[moisture=7]');
    bp.set(x, 1, 14, crop());
  }
  bp.fill(5, 0, 15, 6, 0, 16, 'sand');
  for (const [x, z] of [[4, 15], [4, 16], [7, 15], [7, 16]]) bp.setIfEmpty(x, 1, z, 'birch_slab[type=bottom]');
  bench(bp, 10, 16, 'south', 2, wood);
  sprinkleFlowers(bp, rng, 0, 12, 16, 16, 0.12, ['short_grass', 'dandelion', 'oxeye_daisy', 'short_grass']);
  const mirror = rng.chance(0.5);
  bp.overlay(1, 1, (v) => {
    const yr = 3 * (k1 + 1);
    v.fill(x1 + 1, yr, z1 + 1, x2 - 1, yr, z2 - 1, concrete);
    for (const [x, z] of perimeter(x1, z1, x2, z2)) v.set(x, yr + 1, z, `${slabOf}[type=bottom]`);
    for (let x = cx + 1; x < x2 - 1; x++) for (let z = z1 + 2; z < z2 - 1; z += 2) v.set(x, yr + 1, z, 'daylight_detector');
  });
  bp.stage = 3;
  growYard(bp, rng, { house: [x1, z1, x2, z2 + 2], door: [cx, z2 + 1], wood: WOOD(wood), prefer: ['pergola', 'bench', 'beds', 'flag'], max: 2 });
  bp.stage = 1;
  decorate(bp, rng);
  if (mirror) bp.mirrorX();
  return bp;
}

// ================================================================ Emmental farmhouse

export function farmhouse(rng, options = {}) {
  const bp = new Blueprint();
  const X1 = 1, X2 = 11, Z1 = 1, Z2 = 13, cx = 6;
  const zb = 6; // wall between the barn (behind) and the living part (front)
  const tw = WOOD(rng.pick(['spruce', 'spruce', 'dark_oak', 'oak']));
  const rw = WOOD(tw.name === 'oak' ? 'spruce' : rng.pick(['oak', 'birch', 'spruce']));
  const roofMat = ROOFS[rng.weighted([['tile', 3], ['spruce', 3], ['dark_oak', 2], ['clay', 1.5]])];
  const back = rng.pick([0, 2]);
  const y0 = 4;
  const board = `${tw.stripped}[axis=y]`;

  // Growth: stage 1 = the living part alone under the front half of the same roof; stage 2 adds the barn behind
  // (and the roof grows backwards over it); stage 3 = garden beds, bees and a woodpile.
  bp.fill(X1, 0, zb, X2, 0, Z2, 'cobblestone');
  bp.atStageDraw(2, () => bp.fill(X1, 0, Z1, X2, 0, zb - 1, 'cobblestone'));
  bp.fill(X1 + 1, 0, zb + 1, X2 - 1, 0, Z2 - 1, tw.planks);
  bp.atStageDraw(2, () => bp.fill(X1 + 1, 0, Z1 + 1, X2 - 1, 0, zb - 1, (x, y, z) => ((x * 7 + z * 3) % 5 ? 'coarse_dirt' : 'packed_mud')));
  // Living part: stone plinth, horizontal log walls. Barn: vertical boards.
  bp.walls(X1, 1, zb, X2, 4, Z2, (x, y, z) => (y === 1 ? 'stone_bricks' : (x === X1 || x === X2) && (z === zb || z === Z2) ? `${tw.log}[axis=y]` : `${y === 4 ? tw.log : tw.stripped}[axis=${z === Z2 || z === zb ? 'x' : 'z'}]`));
  bp.atStageDraw(2, () => bp.walls(X1, 1, Z1, X2, 4, zb, (x, y, z) => (z === zb ? bp.get(x, y, z) ?? board : board)));
  bp.fill(X1 + 1, 4, zb + 1, X2 - 1, 4, Z2 - 1, tw.planks);
  bp.atStageDraw(2, () => bp.fill(X1 + 1, 5, Z1 + 1, X2 - 1, 5, zb - 2, tw.planks));
  // Huge half-hipped roof reaching low.
  const R0 = { x1: 0, x2: 12, z1: Z1 - 1, z2: Z2 + 2, y: y0, mat: roofMat, s: 4, n: back };
  bp.stage = 2;
  const at = roof(bp, R0);
  closeUnder(bp, at, perimeter(X1, Z1, X2, Z2), 5, (x, y, z) => (z === Z2 ? tw.planks : board), roofMat);
  closeUnder(bp, at, [...Array(X2 - X1 - 1)].map((_, i) => [X1 + 1 + i, zb]), 5, tw.planks, roofMat);
  bp.stage = 1;
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
  bp.stage = 2;
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
  bp.stage = 1;
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
  bp.stage = 2;
  for (const x of [9, 10]) {
    bp.set(x, 1, 16, `${tw.slab}[type=top]`);
    bp.set(x, 2, 16, 'hay_block[axis=x]');
    bp.set(x, 1, 15, 'dark_oak_trapdoor[facing=north,open=true,half=bottom]');
  }
  bp.set(11, 1, 16, tw.fence);
  bp.atStageDraw(1, () => bp.set(2, 1, 16, 'composter[level=0]'));
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
  bp.mark('pasture', 14, 1, 6, { data: { w: 2, d: 10 } });
  sprinkleFlowers(bp, rng, 14, 2, 15, 11, 0.3, ['dandelion', 'oxeye_daisy', 'short_grass', 'short_grass', 'azure_bluet']);
  bp.stage = 1;
  bp.fill(13, 0, 13, 15, 0, 15, 'cobblestone');
  bp.set(14, -1, 14, 'cobblestone');
  bp.set(14, 0, 14, 'water');
  for (const [x, z] of perimeter(13, 13, 15, 15)) bp.set(x, 1, z, 'mossy_cobblestone_wall');
  for (const x of [13, 15]) bp.fill(x, 2, 14, x, 3, 14, tw.fence);
  for (let x = 13; x <= 15; x++) {
    bp.set(x, 4, 13, `${tw.stairs}[facing=south,half=bottom]`);
    bp.set(x, 4, 15, `${tw.stairs}[facing=north,half=bottom]`);
    bp.set(x, 4, 14, tw.planks);
  }
  bp.set(14, 5, 14, `${tw.slab}[type=bottom]`);
  bp.set(14, 3, 14, 'iron_chain[axis=y]');
  bp.set(14, 2, 14, 'lantern[hanging=true]');
  const mirror = rng.chance(0.5);
  bp.overlay(1, 1, (v) => {
    const at1 = roof(v, { ...R0, z1: zb - 1, n: INF });
    closeUnder(v, at1, [...Array(X2 - X1 - 1)].map((_, i) => [X1 + 1 + i, zb]), 5, tw.planks, roofMat);
    closeUnder(v, at1, perimeter(X1, zb, X2, Z2), 5, (x, y, z) => (z === Z2 ? tw.planks : board), roofMat);
  });
  terrainVariant(bp, rng, options.terrain, { x1: X1, z1: zb, x2: X2, z2: Z2, wood: tw, mirror, modes: ['walkout'] });
  bp.stage = 3;
  growYard(bp, rng, { house: [0, Z1, 12, Z2 + 1], door: [cx, Z2 + 1], wood: tw, roofMat, prefer: ['bees', 'beds', 'woodpile', 'flag', 'fountain'], max: 3 });
  bp.stage = 1;
  decorate(bp, rng);
  if (mirror) bp.mirrorX();
  return bp;
}

// ================================================================ alpine hut (SAC-Hütte)

export function hut(rng, options = {}) {
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
  // Growth: stage 1 = the stone ground floor under a provisional roof, stage 2 = the timber dormitory storey.
  bp.stage = 2;
  bp.walls(x1, 5, z1, x2, 7, z2, (x, y, z) => ((x === x1 || x === x2) && (z === z1 || z === z2) ? `${tw.log}[axis=y]` : tw.planks));
  logRing(bp, x1, z1, x2, z2, 8, tw.log);
  const at = roof(bp, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 2, y: 8, mat: roofMat, kind: 'slabs', n: INF, s: INF, trim: { stairs: tw.stairs, slab: tw.slab } });
  closeUnder(bp, at, perimeter(x1, z1, x2, z2), 9, tw.planks, roofMat);
  bp.stage = 1;
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
    bp.atStageDraw(2, () => shutterPair(x, 5, z2, 'south'));
    bp.atStageDraw(2, () => shutterPair(x, 5, z1, 'north'));
  }
  shutterPair(cx - 2, 2, z1, 'north');
  shutterPair(x1, 2, 7, 'west');
  bp.atStageDraw(2, () => shutterPair(x1, 5, 7, 'west'));
  bp.atStageDraw(2, () => shutterPair(x2, 5, 6, 'east'));
  bp.door(cx, 1, z2, tw.door, 'south');
  bp.set(cx, 3, z2 + 1, `${tw.sign}[facing=south]${signData(['', 'SAC', 'Berghuette', ''], 'red')}`);
  if (at(cx, z2).y - 9 >= 2) bp.atStageDraw(2, () => bp.set(cx, 9, z2, 'glass_pane'));
  // Kitchen stove under the chimney, common room with long tables, stairs to the dormitory.
  const hall = bp.atStageDraw(2, () => stairHall(bp, { axis: 'z', laneA: [ix2 - 1], laneB: [ix2], u0: iz2, dir: -1, planes: [0, 4], wood: tw.name }));
  bp.set(ix1, 1, iz1, 'smoker[facing=south,lit=true]');
  bp.set(ix1 + 1, 1, iz1, 'water_cauldron[level=3]');
  bp.set(ix1 + 2, 1, iz1, 'barrel[facing=up]');
  bp.set(ix1 + 3, 1, iz1, 'crafting_table');
  const ch = at(ix1, iz1);
  bp.fill(ix1, 2, iz1, ix1, 3, iz1, 'cobblestone');
  bp.atStageDraw(2, () => {
    bp.fill(ix1, 4, iz1, ix1, ch.y + 1, iz1, 'cobblestone');
    bp.set(ix1, ch.y + 2, iz1, 'campfire[lit=true,signal_fire=false]');
  });
  for (const tz of [iz1 + 2, iz1 + 4]) {
    for (let x = ix1 + 1; x <= ix1 + 4; x++) {
      bp.set(x, 1, tz, `${tw.slab}[type=top]`);
      bp.set(x, 1, tz - 1, `${tw.stairs}[facing=north,half=bottom]`);
    }
    bp.set(ix1 + 2, 2, tz, rng.pick(['candle[candles=3,lit=true]', 'potted_dandelion', 'lantern[hanging=false]']));
  }
  light(bp, { x1: ix1 + 1, z1: iz1 + 1, x2: ix1 + 4, z2: iz2, y: 1 });
  furnish(bp, rng, { x1: ix1, z1: iz1 + 1, x2: ix2 - 2, z2: iz2, y: 1, h: 3 }, 'common', [...hall.cells, ...(hall.ends[0] ?? []), [cx, iz2]], tw.name, { items: ['chest', 'clock', 'barrel', 'chiseled'], table: false });
  bp.atStageDraw(2, () => {
    furnish(bp, rng, { x1: ix1, z1: iz1, x2: ix2 - 2, z2: iz2, y: 5, h: 3 }, 'dorm', [...hall.cells, ...(hall.ends[4] ?? [])], tw.name, { items: ['bunk', 'bunk2', 'bunk', 'chest', 'chest', 'barrel', 'sink'] });
    light(bp, { x1: ix1 + 2, z1: iz1 + 1, x2: ix2 - 3, z2: iz2 - 1, y: 5 });
  });
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
  const mirror = rng.chance(0.5);
  bp.overlay(1, 1, (v) => {
    const at1 = roof(v, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 2, y: 5, mat: roofMat, kind: 'slabs', n: INF, s: INF, trim: { stairs: tw.stairs, slab: tw.slab } });
    closeUnder(v, at1, perimeter(x1, z1, x2, z2), 5, tw.planks, roofMat);
    v.fill(ix1, 4, iz1, ix1, at1(ix1, iz1).y + 1, iz1, 'cobblestone');
    v.set(ix1, at1(ix1, iz1).y + 2, iz1, 'campfire[lit=true,signal_fire=false]');
    ladderUp(v, cx, iz1, 'south', 1, 4);
    stage1Bed(v, rng, [[{ x1: ix2 - 1, z1: iz1, x2: ix2, z2: iz2, y: 1, h: 3 }, [[ix2 - 1, iz2], [ix2, iz2]]]], tw.name, ['bunk', 'chest']);
  });
  terrainVariant(bp, rng, options.terrain, { x1, z1, x2, z2, wood: tw, mirror, modes: ['stilts'], plinth: true });
  bp.stage = 3;
  growYard(bp, rng, { house: [x1 - 1, z1, x2 + 1, z2 + 5], door: [cx, z2 + 1], wood: tw, roofMat, prefer: ['outhouse', 'woodpile', 'flag', 'bench'], max: 3 });
  bp.stage = 1;
  decorate(bp, rng);
  if (mirror) bp.mirrorX();
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
  return autoMarks(squareBlocks(rng), 'square');
}

function squareBlocks(rng) {
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
  // Town bell on a pedestal at the south edge: the meeting point.
  bp.set(c, 1, 17, 'chiseled_stone_bricks');
  bp.set(c, 2, 17, 'bell[attachment=floor,facing=south]');
  const [b1, d1] = rng.pick(CANTONS);
  const [b2, d2] = rng.pick(CANTONS);
  flagPole(bp, c - 3, -1, 6, `${b1}_banner[rotation=0]${d1}`);
  flagPole(bp, c + 3, -1, 6, `${b2}_banner[rotation=0]${d2}`);
  return bp;
}

// ================================================================ district plaza (cosy village square)

export function plaza(rng) {
  return autoMarks(plazaBlocks(rng), 'plaza');
}

function plazaBlocks(rng) {
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
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) bp.set(tx + dx, 0, tz + dz, 'rooted_dirt');
  // Benches, lamps, flag.
  bench(bp, c - 1, 13, 'south', 3, 'spruce');
  lamp(bp, 4, 12, 3);
  lamp(bp, 12, 12, 3);
  flagPole(bp, 16 - tx, 2, 7);
  // Notice board.
  bp.fill(11, 0, 15, 15, 0, 16, 'cobblestone');
  bp.fill(12, 1, 15, 12, 3, 15, 'spruce_log[axis=y]');
  bp.fill(14, 1, 15, 14, 3, 15, 'spruce_log[axis=y]');
  bp.fill(13, 2, 15, 13, 3, 15, 'spruce_planks');
  for (let x = 11; x <= 15; x++) {
    bp.set(x, 4, 15, 'spruce_slab[type=bottom]');
    bp.set(x, 4, 16, 'spruce_stairs[facing=north,half=bottom]');
  }
  bp.set(11, 3, 15, 'bell[attachment=ceiling,facing=south]');
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
// ================================================================ growth stage 3: the yard grows
// Extensions are drawn after a generator's own decisions (rng and blocks), as stage 3, only on yard cells that are
// empty in every stage, so a renovation from stage 2 to 3 only adds blocks (and replaces a few meadow flowers).

const SOFT_PLANT = /^minecraft:(poppy|dandelion|cornflower|oxeye_daisy|azure_bluet|allium|blue_orchid|.*_tulip|lily_of_the_valley|short_grass|fern|torchflower)$/;
const LAWN = /^minecraft:(grass_block|moss_block|podzol|coarse_dirt)$/;

/** Column (x, z) is lawn (or unset ground) with nothing in any stage from y=1 to y=h (meadow flowers excepted). */
function yardFree(bp, x, z, h, ground = LAWN) {
  if (!inPlot(x, z, 1, 15)) return false;
  const g = bp.get(x, 0, z);
  if (g ? !ground.test(g) : bp.everSet(x, 0, z)) return false;
  for (let y = 1; y <= h; y++) {
    if (!bp.everSet(x, y, z)) continue;
    const b = bp.get(x, y, z);
    if (y === 1 && b && SOFT_PLANT.test(b)) continue;
    return false;
  }
  return true;
}

/** Yard extensions: footprint w x d (x by z), height h, side that needs free access, and how to draw them. */
const YARD_ITEMS = {
  // Village fountain (Brunnen): post with a spout over a two-basin trough, flowers on top.
  fountain: { w: 3, d: 1, h: 3, draw(bp, rng, x, z, o) {
    bp.fill(x, 1, z, x, 2, z, `${o.wood.log}[axis=y]`);
    bp.set(x, 3, z, rng.pick(['potted_red_tulip', 'potted_poppy', 'potted_flowering_azalea_bush']));
    bp.set(x + 1, 1, z, 'water_cauldron[level=3]');
    bp.set(x + 2, 1, z, 'water_cauldron[level=3]');
    bp.set(x + 1, 2, z, `${o.wood.trapdoor}[facing=east,half=top]`);
  } },
  // Bee house: two hives on a bench under a little roof.
  bees: { w: 2, d: 1, h: 3, access: 'south', draw(bp, rng, x, z, o) {
    for (let i = 0; i < 2; i++) {
      bp.set(x + i, 1, z, `beehive[facing=${o.face},honey_level=${rng.int(0, 3)}]`);
      bp.set(x + i, 2, z, `${o.wood.slab}[type=bottom]`);
    }
  } },
  // Greenhouse: glass box with a timber frame, crop beds either side of a path, lantern under a plank.
  greenhouse: { w: 5, d: 4, h: 4, access: 'south', draw(bp, rng, x, z, o) {
    const x2 = x + 4, z2 = z + 3;
    for (let xx = x; xx <= x2; xx++)
      for (let zz = z; zz <= z2; zz++) {
        const edge = xx === x || xx === x2 || zz === z || zz === z2;
        const corner = (xx === x || xx === x2) && (zz === z || zz === z2);
        for (let y = 1; y <= 3; y++) if (edge) bp.set(xx, y, zz, corner ? `${o.wood.log}[axis=y]` : 'glass');
        bp.set(xx, 4, zz, edge ? `${o.wood.slab}[type=bottom]` : 'glass');
        if (!edge) {
          const path = xx === x + 2;
          bp.set(xx, 0, zz, path ? 'dirt_path' : 'farmland[moisture=7]');
          if (!path) bp.set(xx, 1, zz, rng.pick(['carrots[age=7]', 'beetroots[age=3]', 'potatoes[age=7]', 'wheat[age=7]']));
        }
      }
    bp.set(x + 2, 4, z + 1, o.wood.planks);
    bp.set(x + 2, 3, z + 1, 'lantern[hanging=true]');
    const dz = o.face === 'south' ? z2 : z;
    bp.door(x + 2, 1, dz, o.wood.door, o.face);
    bp.set(x + 2, 0, dz + (o.face === 'south' ? 1 : -1), 'dirt_path');
  } },
  // Pergola with a climbing plant over a garden table.
  pergola: { w: 3, d: 3, h: 4, draw(bp, rng, x, z, o) {
    for (const [px, pz] of [[x, z], [x + 2, z], [x, z + 2], [x + 2, z + 2]]) bp.fill(px, 1, pz, px, 2, pz, o.wood.fence);
    for (let xx = x; xx <= x + 2; xx++)
      for (let zz = z; zz <= z + 2; zz++) {
        bp.set(xx, 3, zz, `${o.wood.slab}[type=bottom]`);
        if ((xx + zz) % 2 === 0 || rng.chance(0.4)) bp.set(xx, 4, zz, rng.pick(['flowering_azalea_leaves[persistent=true]', 'azalea_leaves[persistent=true]', 'oak_leaves[persistent=true]']));
      }
    bp.set(x + 1, 1, z + 1, o.wood.fence);
    bp.set(x + 1, 2, z + 1, 'white_carpet');
    bp.set(x, 1, z + 1, `${o.wood.stairs}[facing=west,half=bottom]`);
    bp.set(x + 2, 1, z + 1, `${o.wood.stairs}[facing=east,half=bottom]`);
    bp.mark('food_spot', x + 1, 2, z + 1, { data: { item: rng.pick(['bread', 'apple', 'cookie', 'pumpkin_pie', 'sweet_berries']) } });
  } },
  // Flag pole with the Swiss or a canton flag.
  flag: { w: 1, d: 1, h: 8, draw(bp, rng, x, z) {
    const [b, data] = rng.chance(0.5) ? ['red', SWISS_FLAG] : rng.pick(CANTONS);
    flagPole(bp, x, z, 7, `${b}_banner[rotation=0]${data}`);
  } },
  // Raised vegetable bed with a composter.
  beds: { w: 3, d: 2, h: 2, draw(bp, rng, x, z) {
    const crop = rng.pick(['carrots[age=7]', 'potatoes[age=7]', 'beetroots[age=3]', 'wheat[age=7]']);
    for (let xx = x; xx < x + 3; xx++)
      for (let zz = z; zz < z + 2; zz++) {
        if (xx === x + 2 && zz === z) { bp.set(xx, 1, zz, 'composter[level=3]'); continue; }
        bp.set(xx, 0, zz, 'farmland[moisture=7]');
        bp.set(xx, 1, zz, crop);
      }
  } },
  // Woodpile under a lean roof.
  woodpile: { w: 3, d: 1, h: 3, draw(bp, rng, x, z, o) {
    for (let i = 0; i < 3; i++) {
      bp.set(x + i, 1, z, `${rng.pick(['oak_log', 'birch_log', 'spruce_log'])}[axis=z]`);
      if (i !== 1 || rng.chance(0.7)) bp.set(x + i, 2, z, `${rng.pick(['oak_log', 'birch_log', 'spruce_log'])}[axis=z]`);
      bp.set(x + i, 3, z, `${o.roofMat?.slab ?? o.wood.slab}[type=bottom]`);
    }
  } },
  // Outhouse (Plumpsklo) with a heart in the door.
  outhouse: { w: 3, d: 3, h: 4, access: 'south', draw(bp, rng, x, z, o) {
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        if (i !== 1 || j === 0) bp.fill(x + i, 1, z + j, x + i, 3, z + j, o.wood.planks);
        bp.set(x + i, 4, z + j, `${o.wood.slab}[type=bottom]`);
      }
    bp.set(x + 1, 0, z + 1, o.wood.planks);
    bp.set(x + 1, 1, z + 1, 'smooth_quartz_slab[type=bottom]');
    bp.set(x + 1, 3, z + 1, o.wood.planks);
    bp.door(x + 1, 1, z + 2, o.wood.door, 'south');
    bp.set(x + 1, 3, z + 2, o.wood.planks);
  } },
  // Garden bench under a small tree.
  bench: { w: 4, d: 1, h: 2, draw(bp, rng, x, z, o) {
    bench(bp, x + 1, z, 'north', 2, o.wood.name);
  } },
};

/** Stage 1 of a house whose bedrooms are upstairs: a bed (and chest) in the first of `rooms` ([room, keep]) with space. */
function stage1Bed(v, rng, rooms, wood, items = ['bed', 'chest']) {
  for (const [r, keep] of rooms) if (furnish(v, rng, r, 'bedroom', keep, wood, { items, bare: true })) return true;
  return false;
}

const PASSABLE =/_door\b|fence_gate|carpet|pressure_plate|banner|sign|torch|button|^minecraft:(poppy|dandelion|cornflower|oxeye_daisy|azure_bluet|allium|blue_orchid|.*_tulip|lily_of_the_valley|short_grass|tall_grass|fern|large_fern|torchflower|wheat|carrots|potatoes|beetroots|.*_sapling|pink_petals|wildflowers)\b/;

/** Plot cells a person can reach at ground level (y=1, two blocks clear) from the street edge, with `blocked` cells walled. */
function yardReach(bp, blocked) {
  const ok = (x, z) => {
    if (x < 0 || z < 0 || x > 16 || z > 16 || blocked.has(`${x},${z}`)) return false;
    if (/water|lava/.test(bp.get(x, 0, z) ?? '')) return false;
    for (let y = 1; y <= 2; y++) {
      const b = bp.get(x, y, z);
      if (b && !PASSABLE.test(b)) return false;
    }
    return true;
  };
  const seen = new Set();
  const q = [];
  for (let x = 0; x <= 16; x++) if (ok(x, 16)) { seen.add(`${x},16`); q.push([x, 16]); }
  while (q.length) {
    const [x, z] = q.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${x + dx},${z + dz}`;
      if (!seen.has(k) && ok(x + dx, z + dz)) { seen.add(k); q.push([x + dx, z + dz]); }
    }
  }
  return seen;
}

/**
 * Stage-3 yard: places up to `max` items from `prefer` (in that order of preference) on free lawn.
 * o: { house: [x1, z1, x2, z2] kept clear (with margin), door: [x, z] (path from there to the street stays clear),
 * wood: WOOD(), roofMat, prefer: [...kinds], max, ground: regex of acceptable ground blocks }.
 * Returns the kinds placed.
 */
function growYard(bp, rng, o) {
  const { house, door, prefer, max = 3, ground = LAWN } = o;
  const [hx1, hz1, hx2, hz2] = house;
  const taken = new Set();
  const placed = [];
  const reserved = (x, z) => (x >= hx1 - 1 && x <= hx2 + 1 && z >= hz1 - 1 && z <= hz2 + 1) || (door && Math.abs(x - door[0]) <= 1 && z >= door[1]);
  for (const kind of prefer) {
    if (placed.length >= max) break;
    const it = YARD_ITEMS[kind];
    if (!it) continue;
    const spots = [];
    for (let x = 1; x + it.w - 1 <= 15; x++)
      for (let z = 1; z + it.d - 1 <= 15; z++) {
        let ok = true;
        for (let i = 0; i < it.w && ok; i++)
          for (let j = 0; j < it.d && ok; j++) {
            const cx = x + i, cz = z + j;
            if (reserved(cx, cz) || !yardFree(bp, cx, cz, it.h, ground)) ok = false;
            for (let a = -1; a <= 1 && ok; a++) for (let b = -1; b <= 1 && ok; b++) if (taken.has(`${cx + a},${cz + b}`)) ok = false;
          }
        if (!ok) continue;
        // Access: the row in front (south, towards the street) or behind must be walkable lawn.
        const rowFree = (zz) => [...Array(it.w)].every((_, i) => yardFree(bp, x + i, zz, 2, ground) && !taken.has(`${x + i},${zz}`));
        const face = rowFree(z + it.d) ? 'south' : !it.access && rowFree(z - 1) ? 'north' : null;
        if (!face) continue;
        spots.push([x, z, face]);
      }
    // Never cut a walkway: everything reachable before must stay reachable (the item's own cells excepted).
    const before = yardReach(bp, new Set());
    let spot = null;
    while (spots.length && !spot) {
      const i = Math.floor(rng.next() * spots.length);
      const [x, z] = spots[i];
      const blocked = new Set();
      for (let a = 0; a < it.w; a++) for (let b = 0; b < it.d; b++) blocked.add(`${x + a},${z + b}`);
      const after = yardReach(bp, blocked);
      if ([...before].every((k) => blocked.has(k) || after.has(k))) spot = spots[i];
      else spots.splice(i, 1);
    }
    if (!spot) continue;
    const [x, z, face] = spot;
    it.draw(bp, rng, x, z, { ...o, face });
    // Grass under a solid block turns to dirt in the game: say so in the list.
    for (let i = 0; i < it.w; i++)
      for (let j = 0; j < it.d; j++) {
        const above = bp.get(x + i, 1, z + j);
        if (bp.get(x + i, 0, z + j) === 'minecraft:grass_block' && above && !SOFT_PLANT.test(above) && !PASSABLE.test(above)) bp.set(x + i, 0, z + j, 'coarse_dirt');
      }
    for (let i = -1; i <= it.w; i++) for (let j = -1; j <= it.d; j++) taken.add(`${x + i},${z + j}`);
    placed.push(kind);
  }
  return placed;
}

/** Sizes of the yard items, for the economy's small forms: kind -> { w, d, h } (x by z by height). */
export const YARD_FORMS = Object.fromEntries(Object.entries(YARD_ITEMS).map(([k, v]) => [k, { w: v.w, d: v.d, h: v.h }]));

/**
 * One yard item on its own (fountain, bees, greenhouse, pergola, flag, beds, woodpile, outhouse, bench) as a small form:
 * blocks at x 0..w-1, z 0..d-1 (y = 0 ground, front towards +z), deterministic per seed.
 */
export function yardForm(kind, seed, wood = 'spruce') {
  const it = YARD_ITEMS[kind];
  if (!it) return null;
  const bp = new Blueprint();
  it.draw(bp, rngFrom(`${seed}:${kind}`), 0, 0, { wood: WOOD(wood), face: 'south', roofMat: ROOFS.spruce });
  return { bp, w: it.w, d: it.d, h: it.h };
}
// ================================================================ terrain variants (docs/generator-contract.md §7)
// The bridge levels every lot to the street level (plot.y) and builds retaining walls and post decks at the lot
// edge. A generator that knows the lot sits on a slope adds what belongs to the house itself:
//   walkout: a stone cellar storey under the house (workshop / store), a ladder hatch from the ground floor and,
//            where the yard on the downhill side has room, a sunken court with steps, the cellar door and windows;
//   stilts:  Valais Stadel posts with stone "mushroom" plates (or a rubble plinth) under the house, down to the drop.
// Blocks below y = 0 dig into the lot fill: the court and the cellar are cleared with explicit `air`.

/** Local side of a world side (N/E/S/W or north/east/...) for a plot rotated `turns` times clockwise. */
export function localSide(world, turns = 0) {
  const full = { N: 'north', E: 'east', S: 'south', W: 'west' }[world] ?? world;
  const order = ['north', 'east', 'south', 'west'];
  const i = order.indexOf(full);
  if (i < 0) return null;
  return order[(((i - turns) % 4) + 4) % 4];
}

const SWAP_X = { east: 'west', west: 'east', north: 'north', south: 'south' };

/**
 * Applies options.terrain to a finished house. house: { x1, z1, x2, z2 } outer walls of the part that gets the
 * cellar / posts, wood: WOOD(), mirror: the generator will mirror the blueprint afterwards (sides are swapped here).
 */
function terrainVariant(bp, rng, terrain, o) {
  if (!terrain?.mode) return null;
  const allowed = o.modes ?? ['walkout', 'stilts'];
  const mode = terrain.mode;
  if (!allowed.includes(mode)) return null;
  const drop = Math.max(0, Math.min(16, Math.round(Number(terrain.drop) || 0)));
  // Downhill in the local frame: terrain.downhill (local), or the world aspect turned back by the plot's turns.
  const local = terrain.downhill ?? (terrain.aspect && terrain.turns != null ? localSide(terrain.aspect, terrain.turns) : 'north');
  const side = o.mirror ? SWAP_X[local] ?? 'north' : local;
  const stage0 = bp.stage;
  bp.stage = 1;
  if (mode === 'walkout') walkoutCellar(bp, rng, { ...o, side });
  if (mode === 'stilts' && drop >= 2) underpin(bp, rng, { ...o, drop, kind: o.plinth ? 'plinth' : 'stadel' });
  bp.stage = stage0;
  return mode;
}

function walkoutCellar(bp, rng, o) {
  const { x1, z1, x2, z2, side, wood } = o;
  const stone = stoneMix(rng);
  const yF = -4;
  const inside = (x, z) => x > x1 && x < x2 && z > z1 && z < z2;
  // Shell: floor, walls, and the hatch with a ladder from the ground floor.
  for (let x = x1; x <= x2; x++)
    for (let z = z1; z <= z2; z++) {
      bp.set(x, yF, z, inside(x, z) ? 'stone_bricks' : stone());
      if (!inside(x, z)) for (let y = yF + 1; y <= -1; y++) bp.set(x, y, z, stone());
    }
  // The hatch goes in a ground-floor cell against an outer wall that is free in every stage, reachable from the
  // front door, and whose removal (it is a hole in the floor) cuts no one off.
  const free = (x, z) => inside(x, z) && [1, 2].every((y) => !bp.everSet(x, y, z) || PASSABLE.test(bp.get(x, y, z) ?? 'x')) && !!bp.get(x, 0, z);
  const flood = (start, without) => {
    const seen = new Set();
    const q = start.filter(([x, z]) => free(x, z) && `${x},${z}` !== without);
    for (const [x, z] of q) seen.add(`${x},${z}`);
    while (q.length) {
      const [x, z] = q.pop();
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${x + a},${z + b}`;
        if (!seen.has(k) && k !== without && free(x + a, z + b)) { seen.add(k); q.push([x + a, z + b]); }
      }
    }
    return seen;
  };
  const doors = [];
  let front = -Infinity;
  for (let x = x1; x <= x2; x++)
    for (let z = z1; z <= z2; z++) {
      const b = bp.get(x, 1, z);
      if (!b || !/_door\b/.test(b) || /trapdoor/.test(b)) continue;
      front = Math.max(front, z);
      for (const [a, c] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inside(x + a, z + c)) doors.push([x + a, z + c]);
    }
  const reach = flood(doors);
  let hatch = null;
  for (const f of [side, ...Object.keys(DIR).filter((d) => d !== side)]) {
    const [dx, dz] = DIR[f];
    for (const k of reach) {
      const [x, z] = k.split(',').map(Number);
      if (z >= front || inside(x + dx, z + dz) || doors.some(([a, b]) => Math.abs(a - x) + Math.abs(b - z) <= 1)) continue;
      if (flood(doors, k).size !== reach.size - 1) continue;
      hatch = { x, z, f };
      break;
    }
    if (hatch) break;
  }
  if (hatch) {
    for (let y = yF + 1; y <= 0; y++) bp.set(hatch.x, y, hatch.z, `ladder[facing=${OPP[hatch.f]}]`);
    bp.set(hatch.x, 1, hatch.z, `${wood.trapdoor}[facing=${OPP[hatch.f]},half=bottom,open=true]`);
  }
  // Sunken court on the downhill side: facade span u in [a1, a2], depth v = 1..D away from the wall.
  const [ox, oz] = DIR[side];
  const ns = side === 'north' || side === 'south';
  const wallC = { north: z1, south: z2, west: x1, east: x2 }[side];
  const [a1, a2] = ns ? [x1 + 1, x2 - 1] : [z1 + 1, z2 - 1];
  const XZ = (u, v) => (ns ? [u, wallC + oz * v] : [wallC + ox * v, u]);
  const okCell = (u, v, h = 3) => {
    const [x, z] = XZ(u, v);
    if (x < 0 || z < 0 || x > 16 || z > 16) return false;
    for (let y = 1; y <= h; y++) {
      if (!bp.everSet(x, y, z)) continue;
      const b = bp.get(x, y, z);
      if (!(y === 1 && b && SOFT_PLANT.test(b))) return false;
    }
    return true;
  };
  let D = 0;
  while (D < 3 && [...Array(a2 - a1 + 3)].every((_, i) => okCell(a1 - 1 + i, D + 1) && okCell(a1 - 1 + i, D + 2, 2))) D++;
  const span = a2 - a1 + 1;
  const cellar = { x1: x1 + 1, z1: z1 + 1, x2: x2 - 1, z2: z2 - 1, y: yF + 1, h: 3 };
  let door = null;
  if (D >= 1 && span >= 6 && side !== 'south') {
    const put = (u, v, y, b) => { const [x, z] = XZ(u, v); bp.set(x, y, z, b); };
    for (let u = a1; u <= a2; u++)
      for (let v = 1; v <= D; v++) {
        put(u, v, yF, rng.chance(0.7) ? 'gravel' : 'coarse_dirt');
        for (let y = yF + 1; y <= 0; y++) put(u, v, y, 'air');
      }
    for (let v = 1; v <= D + 1; v++)
      for (const u of v <= D ? [a1 - 1, a2 + 1] : [...Array(span + 2)].map((_, i) => a1 - 1 + i)) {
        for (let y = yF; y <= 0; y++) put(u, v, y, stone());
      }
    // Steps down along the outer row, from the yard at u = a2 down towards a1.
    const along = ns ? 'east' : 'south';
    for (let k = 0; k < 4; k++) {
      const u = a2 - k;
      put(u, D, -k, `stone_brick_stairs[facing=${along},half=bottom]`);
      for (let y = yF; y < -k; y++) put(u, D, y, 'stone_bricks');
    }
    // Railing on the rim, open where the steps start.
    for (let v = 1; v <= D + 1; v++)
      for (const u of v <= D ? [a1 - 1, a2 + 1] : [...Array(span + 2)].map((_, i) => a1 - 1 + i)) {
        if (v === D + 1 && u === a2) continue;
        if (v === D && u === a2 + 1) continue;
        put(u, v, 1, wood.fence);
      }
    // Facade: door, windows, lamp.
    const du = D >= 2 ? (a1 + a2 - 4) >> 1 : a1 + 1;
    const [dxx, dzz] = XZ(du, 0);
    bp.door(dxx, yF + 1, dzz, wood.door, side);
    for (const u of [du - 2, du + 2]) if (u >= a1 && u <= a2 - (D >= 2 ? 0 : 4)) { const [wx, wz] = XZ(u, 0); bp.set(wx, yF + 2, wz, 'glass_pane'); }
    const [lx, lz] = XZ(du + 1, 1);
    if (!bp.get(lx, yF + 2, lz)) bp.set(lx, yF + 2, lz, 'lantern[hanging=false]') ;
    door = [dxx - ox, dzz - oz];
  }
  // Workshop and store inside; then clear the rest of the cellar.
  const keep = [...(hatch ? [[hatch.x, hatch.z]] : []), ...(door ? [door] : [])];
  if (hatch) for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) keep.push([hatch.x + a, hatch.z + b]);
  furnish(bp, rng, cellar, 'storage', keep, wood.name, { items: ['barrel', 'barrel', 'chest', 'crafting', 'barrel', 'composter'] });
  light(bp, cellar);
  for (let x = cellar.x1; x <= cellar.x2; x++)
    for (let z = cellar.z1; z <= cellar.z2; z++)
      for (let y = yF + 1; y <= -1; y++) if (!bp.get(x, y, z)) bp.set(x, y, z, 'air');
  bp.mark('workstation', cellar.x1, cellar.y, cellar.z1, { data: { profession: 'toolsmith', cellar: true } });
}

function underpin(bp, rng, o) {
  const { x1, z1, x2, z2, drop, kind, wood } = o;
  const low = -Math.min(drop, 14);
  if (kind === 'plinth') {
    const r = rubble(rng);
    for (const [x, z] of perimeter(x1, z1, x2, z2)) for (let y = low; y <= -1; y++) bp.set(x, y, z, r());
    return;
  }
  const posts = new Set();
  for (const [x, z] of perimeter(x1, z1, x2, z2)) {
    const corner = (x === x1 || x === x2) && (z === z1 || z === z2);
    if (corner || ((x - x1) % 3 === 0 && (z === z1 || z === z2)) || ((z - z1) % 3 === 0 && (x === x1 || x === x2))) posts.add(`${x},${z}`);
  }
  for (let x = x1 + 3; x < x2 - 1; x += 3) for (let z = z1 + 3; z < z2 - 1; z += 3) posts.add(`${x},${z}`);
  for (const k of posts) {
    const [x, z] = k.split(',').map(Number);
    for (let y = low; y <= -2; y++) bp.set(x, y, z, `${wood.log}[axis=y]`);
    bp.set(x, -1, z, 'smooth_stone_slab[type=top]');
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!bp.get(x + a, -1, z + b)) bp.set(x + a, -1, z + b, 'smooth_stone_slab[type=top]');
  }
}

/**
 * Terrain modes each type builds itself (docs/generator-contract.md §7): the bridge passes options.terrain only for
 * these and then skips its own fallback (the cellar in the retaining wall). Other modes stay with the bridge.
 */
export const TERRAIN_VARIANTS = { chalet: ['walkout', 'stilts'], townhouse: ['walkout'], farmhouse: ['walkout'], hut: ['stilts'] };
const VARIANTS = TERRAIN_VARIANTS;
// ================================================================ waterfront (zone 'shore')
// Shore types are drawn with the water on their local north (the back): the bridge turns a shore lot so that its
// water side is local north (localSide(waterSide, turns) === 'north'). They bring their own water where they need
// it (slip, pool) and dig the lot fill with explicit air, so they also stand on a dry lot.

/** Octagon test: |dx|, |dz| <= r without the four corner cells. */
const octo = (dx, dz, r) => Math.abs(dx) <= r && Math.abs(dz) <= r && !(Math.abs(dx) === r && Math.abs(dz) === r);

/** Mooring bollard: andesite post with a chain. */
function bollard(bp, x, z) {
  bp.set(x, 1, z, 'andesite_wall');
  bp.set(x, 2, z, 'iron_chain[axis=x]');
}

// ---------------------------------------------------------------- lighthouse (Leuchtturm, Romanshorn / Brunnen)

export function lighthouse(rng) {
  const bp = new Blueprint();
  const cx = 8, cz = 8;
  const H = rng.pick([13, 14, 16]);
  const red = rng.pick(['red_concrete', 'red_terracotta', 'red_concrete']);
  const white = rng.pick(['white_concrete', 'calcite', 'white_concrete']);
  const stone = stoneMix(rng);
  // Pier head: a round stone platform with a low wall, bollards and a lamp; steps up from the street.
  for (let x = 0; x <= 16; x++)
    for (let z = 0; z <= 16; z++) {
      const d = Math.hypot(x - cx, z - cz);
      if (d <= 6.4) bp.set(x, 0, z, d > 5.4 ? 'stone_bricks' : (x + z) % 3 ? 'polished_andesite' : 'andesite');
      if (d > 5.4 && d <= 6.4 && !(Math.abs(x - cx) <= 1 && z > cz)) bp.set(x, 1, z, 'stone_brick_wall');
    }
  for (let z = 15; z <= 16; z++) for (let x = cx - 1; x <= cx + 1; x++) bp.set(x, 0, z, 'stone_bricks');
  for (const [x, z] of [[3, 5], [13, 5], [4, 12], [12, 12]]) if (!bp.get(x, 1, z)) bollard(bp, x, z);
  // Tower: octagon 5 wide, red and white bands on a stone base, door to the street.
  const band = (y) => (y <= 2 ? stone() : Math.floor((y - 3) / 3) % 2 ? red : white);
  for (let dx = -2; dx <= 2; dx++)
    for (let dz = -2; dz <= 2; dz++) {
      if (!octo(dx, dz, 2)) continue;
      const ring = Math.abs(dx) === 2 || Math.abs(dz) === 2;
      bp.set(cx + dx, 0, cz + dz, 'polished_andesite');
      if (ring) for (let y = 1; y <= H; y++) bp.set(cx + dx, y, cz + dz, band(y));
    }
  bp.door(cx, 1, cz + 2, 'spruce', 'south');
  bp.set(cx, 3, cz + 2, `${white === 'calcite' ? 'polished_andesite' : stone()}`);
  // Floors with a ladder along the north wall, porthole windows.
  const floors = [5, 10].filter((y) => y < H - 2);
  for (const y of floors) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) bp.set(cx + dx, y, cz + dz, 'spruce_planks');
  for (let y = 1; y <= H + 1; y++) bp.set(cx, y, cz - 1, 'ladder[facing=south]');
  for (const y of [...floors.map((f) => f + 2), 3]) {
    if (y >= H) continue;
    bp.set(cx - 2, y, cz, 'glass_pane');
    bp.set(cx + 2, y, cz, 'glass_pane');
  }
  bp.set(cx + 1, 7, cz - 2, 'glass');
  bp.set(cx + 1, 1, cz - 1, 'barrel[facing=up]');
  bp.set(cx - 1, 1, cz - 1, 'chest[facing=south]');
  bp.set(cx - 1, 1, cz + 1, 'potted_red_tulip');
  for (const y of [4, ...floors.map((f) => f + 4)]) if (y < H) bp.set(cx + 1, y, cz + 1, 'lantern[hanging=true]');
  if (floors[0]) bp.set(cx + 1, floors[0] + 1, cz, 'barrel[facing=up]');
  // Gallery: a deck all round on corbels, iron railing; lantern room of glass with the lamp; copper cap.
  const G = H + 1;
  for (let dx = -4; dx <= 4; dx++)
    for (let dz = -4; dz <= 4; dz++) {
      if (!octo(dx, dz, 4)) continue;
      const x = cx + dx, z = cz + dz;
      if (!(dx === 0 && dz === -1)) bp.set(x, G, z, 'polished_andesite');
      if (!octo(dx, dz, 3)) bp.set(x, G + 1, z, 'iron_bars');
      if (octo(dx, dz, 3) && !octo(dx, dz, 2)) {
        const f = Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 'west' : 'east') : dz > 0 ? 'north' : 'south';
        bp.set(x, G - 1, z, `stone_brick_stairs[facing=${f},half=top]`);
      }
    }
  bp.set(cx, G, cz - 1, 'ladder[facing=south]');
  for (let dx = -2; dx <= 2; dx++)
    for (let dz = -2; dz <= 2; dz++) {
      if (!octo(dx, dz, 2) || (Math.abs(dx) <= 1 && Math.abs(dz) <= 1)) continue;
      for (let y = G + 1; y <= G + 3; y++) bp.set(cx + dx, y, cz + dz, y === G + 3 ? red : 'glass');
    }
  bp.door(cx, G + 1, cz + 2, 'iron', 'south');
  bp.set(cx, G + 1, cz, 'polished_andesite');
  bp.set(cx, G + 2, cz, 'sea_lantern');
  bp.mark('light', cx, G + 2, cz, { data: { beacon: true } });
  const cap = roof(bp, { x1: cx - 2, x2: cx + 2, z1: cz - 2, z2: cz + 2, y: G + 4, mat: ROOFS.copper, kind: 'stairs' });
  bp.set(cx, cap(cx, cz).y + 1, cz, 'waxed_oxidized_lightning_rod[facing=up]');
  // A bench and a lamp on the pier head; a life ring (red/white banner) on the wall.
  bench(bp, cx + 3, cz + 4, 'north', 2, 'spruce');
  lamp(bp, cx - 4, cz + 3, 3, 'simple');
  bp.set(cx - 3, 2, cz + 1, `white_wall_banner[facing=west]${pattern([['circle', 'red'], ['border', 'red']])}`);
  return bp;
}

// ---------------------------------------------------------------- boathouse (Bootshaus)

export function boathouse(rng) {
  const bp = new Blueprint();
  const x1 = 3, x2 = 13, z1 = 1, z2 = 12, cx = 8;
  const tw = WOOD(rng.pick(['spruce', 'dark_oak', 'spruce']));
  const roofMat = ROOFS[rng.weighted([['spruce', 2], ['dark_oak', 2], ['slate', 1], ['tile', 1]])];
  const sx1 = 6, sx2 = 10, sz2 = 8; // slip
  const boards = (x, y, z) => ((x === x1 || x === x2) && (z === z1 || z === z2) ? `${tw.log}[axis=y]` : `${tw.stripped}[axis=y]`);
  // Stone plinth, plank walkways, the slip with its own water down to y=-2.
  for (let x = x1; x <= x2; x++)
    for (let z = z1; z <= z2; z++) {
      const slip = x >= sx1 && x <= sx2 && z <= sz2;
      if (slip) {
        bp.set(x, -3, z, 'gravel');
        bp.set(x, -2, z, 'water');
        bp.set(x, -1, z, 'water');
        bp.set(x, 0, z, 'air');
      } else bp.set(x, 0, z, x === x1 || x === x2 || z === z1 || z === z2 ? 'stone_bricks' : tw.planks);
      if (!slip && (x === sx1 - 1 || x === sx2 + 1) && z <= sz2) for (let y = -3; y <= -1; y++) bp.set(x, y, z, 'stone_bricks');
    }
  for (let x = sx1; x <= sx2; x++) {
    bp.set(x, -3, z1 - 1, 'gravel');
    bp.set(x, -2, z1 - 1, 'water');
    bp.set(x, -1, z1 - 1, 'water');
    bp.set(x, 0, z1 - 1, 'air');
    for (let y = -3; y <= -1; y++) bp.set(x, y, sz2 + 1, 'stone_bricks');
  }
  for (const x of [sx1 - 1, sx2 + 1]) for (let y = -3; y <= -1; y++) bp.set(x, y, z1 - 1, 'stone_bricks');
  // Walls (boarded), the water gate (an open arch on the lake side), windows, the door to the street.
  bp.walls(x1, 1, z1, x2, 4, z2, boards);
  for (let x = sx1; x <= sx2; x++) for (let y = 1; y <= 3; y++) bp.set(x, y, z1, null);
  for (let x = sx1 - 1; x <= sx2 + 1; x++) bp.set(x, 4, z1, `${tw.log}[axis=x]`);
  for (const z of [4, 8]) {
    win(bp, rng, x1, 2, z, 'west', { h: 1, w: 2 });
    win(bp, rng, x2, 2, z, 'east', { h: 1, w: 2 });
  }
  bp.door(cx, 1, z2, tw.door, 'south');
  win(bp, rng, cx - 3, 2, z2, 'south', { w: 2, h: 2, shutters: rng.weighted(SHUTTERS) });
  win(bp, rng, cx + 2, 2, z2, 'south', { w: 2, h: 2, shutters: rng.weighted(SHUTTERS) });
  bp.set(cx, 0, z2 + 1, 'stone_brick_slab[type=top]');
  // Loft over the workshop at the back of the slip, by ladder.
  bp.fill(x1 + 1, 5, sz2 + 1, x2 - 1, 5, z2 - 1, tw.planks);
  ladderUp(bp, cx + 1, z2 - 1, 'north', 1, 5);
  // Roof: gable to the water, wide overhang, barge boards.
  const at = roof(bp, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 2, z2: z2 + 1, y: 5, mat: roofMat, n: INF, s: INF, trim: { stairs: tw.stairs, slab: tw.slab } });
  closeUnder(bp, at, perimeter(x1, z1, x2, z2), 5, `${tw.stripped}[axis=y]`, roofMat);
  for (let x = sx1; x <= sx2; x++) bp.set(x, 5, z1, `${tw.log}[axis=x]`);
  win(bp, rng, cx, 7, z1, 'north', { h: 1 });
  win(bp, rng, cx, 7, z2, 'south', { h: 1 });
  // Inside: oars and nets along the walkways, workbench and store at the back, lanterns over the slip.
  for (const [x, z] of [[x1 + 1, 3], [x2 - 1, 3], [x1 + 1, 6], [x2 - 1, 6]]) bp.set(x, 1, z, rng.pick(['barrel[facing=up]', 'chest[facing=east]', 'composter[level=0]']));
  for (const z of [2, 6]) bp.set(x1 + 1, 3, z, `${tw.trapdoor}[facing=east,half=top,open=true]`);
  bp.set(x2 - 1, 1, z2 - 1, 'crafting_table');
  bp.set(x2 - 2, 1, z2 - 1, 'smithing_table');
  bp.set(x2 - 1, 2, z2 - 1, 'lantern[hanging=false]');
  for (const z of [3, 7]) bp.set(cx, 4, z, 'lantern[hanging=true]');
  furnish(bp, rng, { x1: x1 + 2, z1: sz2 + 1, x2: x2 - 2, z2: z2 - 1, y: 6, h: 2 }, 'storage', [[cx + 1, z2 - 1], [cx, z2 - 1], [cx + 2, z2 - 1], [cx + 1, z2 - 2]], tw.name, { items: ['barrel', 'chest', 'barrel'] });
  bp.mark('boat_spot', cx, -1, 4, { facing: 'north', data: { kind: rng.pick(['spruce_boat', 'oak_boat', 'birch_boat']) } });
  bp.mark('boat_spot', cx, -1, -1, { facing: 'north', data: { kind: 'oak_boat', outside: true } });
  bp.mark('workstation', x2 - 1, 1, z2 - 1, { data: { profession: 'fisherman' } });
  // Front: path, bench, a canoe rack, flowers.
  for (let z = z2 + 2; z <= 16; z++) bp.set(cx, 0, z, rng.pick(['gravel', 'dirt_path']));
  bench(bp, cx + 3, z2 + 2, 'north', 2, tw.name);
  for (let x = x1; x <= cx - 2; x++) bp.setIfEmpty(x, 1, z2 + 1, rng.pick(BOX_FLOWERS));
  sprinkleFlowers(bp, rng, 0, z2 + 2, 16, 16, 0.12);
  return bp;
}

// ---------------------------------------------------------------- Schiffstation (steamer landing with waiting room)

export function schiffstation(rng) {
  const bp = new Blueprint();
  const x1 = 3, x2 = 13, z1 = 5, z2 = 11, cx = 8;
  const plaster = rng.pick(['calcite', 'white_terracotta', 'smooth_sandstone']);
  const trim = rng.pick([TRIMS.stone, TRIMS.andesite, TRIMS.sand]);
  const roofMat = ROOFS[rng.pick(['copper', 'copperW', 'slate'])];
  const wood = rng.pick(['spruce', 'dark_oak']);
  const place = rng.pick(['LUZERN', 'BRUNNEN', 'VITZNAU', 'WEGGIS', 'FLUELEN', 'SPIEZ', 'THUN', 'MONTREUX', 'ROMANSHORN', 'RAPPERSWIL']);
  // Quay: stone paving, the landing stage on the lake side with bollards, steps; benches on the street side.
  bp.fill(0, 0, 0, 16, 0, 16, (x, y, z) => (z <= 1 ? 'stone_bricks' : (x + z) % 3 ? 'polished_andesite' : 'stone_bricks'));
  for (let x = 1; x <= 15; x++) bp.set(x, 1, 0, x % 4 === 1 ? 'andesite_wall' : null);
  for (const x of [1, 5, 11, 15]) bp.set(x, 2, 0, 'iron_chain[axis=x]');
  bp.mark('ship_spot', cx, -1, -3, { facing: 'east', data: { kind: 'steamer' } });
  // Pavilion: tall single storey, trim plinth and cornice, big windows, doors on both sides.
  bp.walls(x1, 1, z1, x2, 4, z2, (x, y, z) => ((x === x1 || x === x2) && (z === z1 || z === z2) ? trim.block : y === 1 || y === 4 ? trim.block : plaster));
  bp.fill(x1 + 1, 0, z1 + 1, x2 - 1, 0, z2 - 1, (x, y, z) => ((x + z) % 2 ? 'white_concrete' : 'black_concrete'));
  for (const x of [x1 + 2, x2 - 3]) {
    win(bp, rng, x, 2, z2, 'south', { w: 2, h: 2 });
    win(bp, rng, x, 2, z1, 'north', { w: 2, h: 2 });
  }
  for (const z of [z1 + 2]) {
    win(bp, rng, x1, 2, z, 'west', { w: 3, h: 2 });
    win(bp, rng, x2, 2, z, 'east', { w: 3, h: 2 });
  }
  doorway(bp, cx, 1, z2, 'south', wood, { double: false, transom: 'glass_pane' });
  doorway(bp, cx, 1, z1, 'north', wood, { double: false, transom: 'glass_pane' });
  // Hipped copper roof with the station clock in a dormer over the street door, the name on a sign.
  const at = roof(bp, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 1, y: 5, mat: roofMat, kind: 'stairs', brackets: `${wood}_stairs` });
  closeUnder(bp, at, perimeter(x1, z1, x2, z2), 5, plaster, roofMat);
  clockFace(bp, cx, 6, z2, 'south');
  bp.set(cx, 4, z2 + 1, `${wood}_wall_sign[facing=south]${signData(['SCHIFFSTATION', place, '', ''], 'black')}`);
  // Canopy over the landing on slim posts.
  for (let x = x1; x <= x2; x++)
    for (let z = 1; z < z1; z++) {
      if ((x === x1 || x === x2 || x === cx) && z === 1) bp.fill(x, 1, z, x, 3, z, `${wood}_fence`);
      bp.set(x, 4, z, `${roofMat.slab}[type=bottom]`);
    }
  for (const x of [x1 + 2, x2 - 2]) bp.set(x, 3, 2, 'lantern[hanging=true]');
  // Inside: ticket counter, timetable, benches back to back, plants; a flag on the street side.
  for (let x = x2 - 3; x <= x2 - 1; x++) bp.set(x, 1, z1 + 1, x === x2 - 1 ? `${wood}_planks` : `${wood}_slab[type=top]`);
  bp.set(x2 - 2, 2, z1 + 1, 'bell[attachment=floor,facing=south]');
  bp.set(x2 - 1, 2, z1 + 1, 'lectern[facing=south,has_book=true]');
  bp.set(x1 + 1, 2, z1 + 1, `${wood}_wall_sign[facing=south]${signData(['ABFAHRT', '10:15 Weggis', '11:40 Brunnen', '13:05 Flueelen'], 'black')}`);
  bench(bp, x1 + 2, z1 + 3, 'south', 3, wood);
  bench(bp, x1 + 2, z2 - 2, 'north', 3, wood);
  for (const [x, z] of [[x1 + 1, z2 - 1], [x2 - 1, z2 - 1]]) bp.set(x, 1, z, rng.pick(HOUSE_PLANTS));
  for (const x of [x1 + 3, x2 - 3]) light(bp, { x1: x, z1: z1 + 3, x2: x, z2: z1 + 3, y: 1 });
  flagPole(bp, 15, 14, 7);
  bench(bp, 2, 14, 'south', 2, wood);
  lamp(bp, 1, 12, 3, 'double');
  planter(bp, 12, 14, wood);
  return bp;
}

// ---------------------------------------------------------------- lido (Strandbad / Badi)

export function lido(rng) {
  const bp = new Blueprint();
  const wood = rng.pick(['spruce', 'birch', 'spruce']);
  const [ca, cb] = rng.pick([['red', 'white'], ['blue', 'white'], ['green', 'white'], ['yellow', 'white']]);
  // Beach towards the water, lawn towards the street, a boardwalk between.
  for (let x = 0; x <= 16; x++)
    for (let z = 0; z <= 16; z++) bp.set(x, 0, z, z <= 7 ? 'sand' : z === 8 ? `${wood}_planks` : 'grass_block');
  // Bathing jetty with a diving tower over the water side.
  for (let z = -2; z <= 2; z++) for (let x = 7; x <= 9; x++) bp.set(x, 0, z, `${wood}_planks`);
  for (const [x, z] of [[7, -2], [9, -2]]) bp.fill(x, -3, z, x, -1, z, `stripped_${wood}_log[axis=y]`);
  bp.fill(10, 1, 1, 10, 3, 1, `stripped_${wood}_log[axis=y]`);
  for (let y = 1; y <= 3; y++) bp.set(9, y, 1, 'ladder[facing=west]');
  bp.set(9, 0, 1, 'ladder[facing=west]');
  bp.fill(8, 4, 0, 10, 4, 2, `${wood}_planks`);
  bp.set(9, 4, 1, 'ladder[facing=west]');
  for (const [x, z] of [[8, 0], [10, 0], [8, 2], [10, 2]]) bp.set(x, 5, z, `${wood}_fence`);
  bp.set(9, 4, -1, `${wood}_slab[type=top]`);
  bp.set(9, 4, -2, `${wood}_slab[type=top]`);
  // Changing cabins along the west side, striped doors.
  for (let i = 0; i < 5; i++) {
    const z = 4 + i * 2;
    bp.fill(0, 1, z - 1, 2, 3, z - 1, `stripped_${wood}_log[axis=y]`);
    bp.set(0, 1, z, `stripped_${wood}_log[axis=y]`);
    bp.set(0, 2, z, `stripped_${wood}_log[axis=y]`);
    bp.set(0, 3, z, `stripped_${wood}_log[axis=y]`);
    bp.set(1, 0, z, `${wood}_planks`);
    bp.set(1, 3, z, `stripped_${wood}_log[axis=y]`);
    bp.door(2, 1, z, wood, 'east');
    bp.set(2, 3, z, `${i % 2 ? ca : cb}_wool`);
    bp.set(1, 1, z, `${wood}_slab[type=bottom]`);
    for (let zz = z - 1; zz <= z; zz++) for (let x = 0; x <= 2; x++) bp.set(x, 4, zz, `${wood}_slab[type=bottom]`);
  }
  bp.fill(0, 1, 13, 2, 3, 13, `stripped_${wood}_log[axis=y]`);
  for (let x = 0; x <= 2; x++) bp.set(x, 4, 13, `${wood}_slab[type=bottom]`);
  // Kiosk with a serving hatch, menu and parasol tables.
  const kx1 = 11, kx2 = 15, kz1 = 10, kz2 = 13;
  bp.walls(kx1, 1, kz1, kx2, 3, kz2, (x, y, z) => ((x === kx1 || x === kx2) && (z === kz1 || z === kz2) ? `stripped_${wood}_log[axis=y]` : `${wood}_planks`));
  bp.fill(kx1 + 1, 0, kz1 + 1, kx2 - 1, 0, kz2 - 1, `${wood}_planks`);
  for (let x = kx1 + 1; x <= kx2 - 1; x++) {
    bp.set(x, 2, kz1, null);
    bp.set(x, 1, kz1, `${wood}_slab[type=top]`);
  }
  for (let x = kx1; x <= kx2; x++) {
    bp.set(x, 3, kz1 - 1, `${wood}_trapdoor[facing=south,half=top]`);
    bp.set(x, 4, kz1 - 1, `${x % 2 ? ca : cb}_carpet`);
  }
  for (let x = kx1 - 1; x <= kx2 + 1; x++) for (let z = kz1; z <= kz2 + 1; z++) bp.set(x, 4, z, `${wood}_slab[type=bottom]`);
  bp.set(kx1 + 2, 2, kz1 - 0, null);
  bp.door(kx1 + 2, 1, kz2, wood, 'south');
  bp.set(kx1 + 1, 1, kz1 + 1, 'smoker[facing=south,lit=true]');
  bp.set(kx2 - 1, 1, kz1 + 1, 'water_cauldron[level=3]');
  bp.set(kx1 + 3, 2, kz1, 'cake');
  bp.set(kx1 + 1, 2, kz1, 'candle[candles=2,lit=true]');
  bp.set(kx1 + 2, 3, kz2 - 1, 'lantern[hanging=true]');
  bp.set(kx2 + 1, 2, kz1 + 1, `${wood}_wall_sign[facing=east]${signData(['BADI KIOSK', 'Glace', 'Pommes frites', 'Sirup'], 'black')}`);
  for (const [tx, tz] of [[8, 11], [5, 14]]) {
    bp.fill(tx, 1, tz, tx, 3, tz, `${wood}_fence`);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        bp.set(tx + dx, 4, tz + dz, dx || dz ? `${wood}_trapdoor[facing=south,half=top]` : `${ca}_wool`);
        bp.set(tx + dx, 5, tz + dz, `${(dx + dz + 2) % 2 ? ca : cb}_carpet`);
      }
    bp.set(tx - 1, 1, tz, `${wood}_stairs[facing=west,half=bottom]`);
    bp.set(tx + 1, 1, tz, `${wood}_stairs[facing=east,half=bottom]`);
    bp.mark('food_spot', tx, 2, tz, { data: { item: rng.pick(['cookie', 'melon_slice', 'sweet_berries']) } });
  }
  // Loungers and parasols on the sand, towels, a life-guard chair.
  for (const [x, z] of [[4, 3], [6, 3], [12, 3], [14, 3]]) {
    bp.set(x, 1, z, 'white_bed[facing=north,part=head]');
    bp.set(x, 1, z + 1, 'white_bed[facing=north,part=foot]');
  }
  for (const [x, z] of [[5, 5], [13, 5]]) {
    bp.fill(x, 1, z, x, 2, z, `${wood}_fence`);
    bp.set(x, 3, z, `${rng.pick([ca, cb])}_wool`);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) bp.set(x + dx, 3, z + dz, `${rng.pick([ca, cb])}_carpet`);
  }
  for (const [x, z] of [[11, 6], [12, 6]]) bp.set(x, 1, z, `${rng.pick(['red', 'blue', 'yellow', 'lime'])}_carpet`);
  bp.fill(15, 1, 1, 15, 2, 1, `stripped_${wood}_log[axis=y]`);
  bp.set(15, 3, 1, `${wood}_stairs[facing=south,half=bottom]`);
  bp.set(15, 1, 2, `${wood}_slab[type=bottom]`);
  bp.set(16, 4, 1, `red_banner[rotation=4]${SWISS_FLAG}`);
  // Entrance gate from the street, a lawn with a linden and a fence; flag.
  plotFence(bp, [8], `${wood}_fence`, `${wood}_fence_gate`, { back: false, sides: false });
  broadTree(bp, 3, 15, 5, 2, 'oak');
  flagPole(bp, 15, 15, 7);
  bp.mark('pool_spot', 8, 0, -4, { data: { swimmers: 3 } });
  // Grass under a solid block turns to dirt in the game.
  for (let x = 0; x <= 16; x++)
    for (let z = 0; z <= 16; z++) {
      const above = bp.get(x, 1, z);
      if (bp.get(x, 0, z) === 'minecraft:grass_block' && above && !PASSABLE.test(above) && !SOFT_PLANT.test(above)) bp.set(x, 0, z, 'coarse_dirt');
    }
  return bp;
}
// ================================================================ public works (built by chats for their district)
// None of these is picked as a chat's home (CATALOG zones are empty): the economy decides when a district gets one.

const PLACES = ['GRINDELWALD', 'MEIRINGEN', 'ANDERMATT', 'BRIENZ', 'KANDERSTEG', 'SAMEDAN', 'ZERMATT', 'SPIEZ', 'GOLDAU', 'FLUELEN', 'ENGELBERG', 'LAUTERBRUNNEN'];

// ---------------------------------------------------------------- school (Schulhaus with a bell turret)

export function school(rng) {
  const bp = new Blueprint();
  const x1 = 1, x2 = 15, z1 = 2, z2 = 10, cx = 8;
  const plaster = rng.pick(['calcite', 'white_terracotta', 'smooth_sandstone', 'pink_terracotta']);
  const trim = rng.pick([TRIMS.stone, TRIMS.sand, TRIMS.tuff, TRIMS.andesite]);
  const roofMat = ROOFS[rng.pick(['tile', 'slate', 'clay', 'tile'])];
  const wood = rng.pick(['spruce', 'oak', 'birch']);
  const shutter = rng.weighted(SHUTTERS);
  const planes = [0, 5];
  const top = 9;
  // Shell: plinth, two storeys, cornice band; tall windows in a regular rhythm, a central portal with steps.
  bp.fill(x1, 0, z1, x2, 0, z2, 'polished_andesite');
  bp.fill(x1 + 1, 0, z1 + 1, x2 - 1, 0, z2 - 1, `${wood}_planks`);
  bp.walls(x1, 1, z1, x2, top, z2, (x, y, z) => ((x === x1 || x === x2) && (z === z1 || z === z2) ? trim.block : y === 1 || y === 5 ? trim.block : plaster));
  bp.fill(x1 + 1, 5, z1 + 1, x2 - 1, 5, z2 - 1, `${wood}_planks`);
  for (const y of [2, 6]) {
    for (const x of [x1 + 1, x1 + 4, x2 - 5, x2 - 2]) win(bp, rng, x, y, z2, 'south', { w: 2, h: 2, lintel: trim.block, shutters: shutter });
    for (const x of [x1 + 1, x1 + 4, x2 - 5, x2 - 2]) if (y === 6 || x < cx) win(bp, rng, x, y, z1, 'north', { w: 2, h: 2, lintel: trim.block });
    win(bp, rng, x1, y, z1 + 4, 'west', { w: 2, h: 2, lintel: trim.block });
    win(bp, rng, x2, y, z1 + 4, 'east', { w: 2, h: 2, lintel: trim.block });
  }
  doorway(bp, cx, 1, z2, 'south', wood, { frame: trim.block, transom: 'glass_pane' });
  for (let x = cx - 1; x <= cx + 1; x++) bp.set(x, 0, z2 + 1, `${trim.slab}[type=top]`);
  bp.set(cx, 4, z2 + 1, `${wood}_wall_sign[facing=south]${signData(['', 'SCHULHAUS', '', ''], 'black')}`);
  // Roof: hipped, with a bell turret (Dachreiter) on the ridge: open belfry, clock faces, spire.
  const at = roof(bp, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 1, y: top, mat: roofMat, brackets: `${wood}_stairs` });
  closeUnder(bp, at, perimeter(x1, z1, x2, z2), top + 1, plaster, roofMat);
  const ry = at(cx, (z1 + z2) >> 1).y;
  const tz = (z1 + z2) >> 1;
  bp.walls(cx - 1, ry, tz - 1, cx + 1, ry + 2, tz + 1, (x, y, z) => ((x === cx || z === tz) && y === ry + 1 ? null : `${wood}_planks`));
  for (const [x, z] of [[cx, tz - 1], [cx, tz + 1], [cx - 1, tz], [cx + 1, tz]]) bp.set(x, ry + 1, z, null);
  bp.set(cx, ry + 3, tz, `${wood}_planks`);
  bp.set(cx, ry + 2, tz, 'bell[attachment=ceiling,facing=south]');
  const tr = roof(bp, { x1: cx - 1, x2: cx + 1, z1: tz - 1, z2: tz + 1, y: ry + 3, mat: ROOFS.copper, kind: 'steep', pitch: 2 });
  bp.set(cx, tr(cx, tz).y + 1, tz, 'waxed_oxidized_lightning_rod[facing=up]');
  clockFace(bp, cx, ry - 2 >= top + 2 ? ry - 2 : top + 2, z2, 'south');
  // Inside: corridor along the back with the staircase, classrooms facing the street on both floors.
  const hall = stairHall(bp, { axis: 'x', laneA: [z1 + 2], laneB: [z1 + 1], u0: x2 - 1, dir: -1, planes, wood });
  for (const F of planes) {
    const y = F + 1;
    const panel = (x, yy, z) => (yy === y ? `${wood}_planks` : plaster);
    const doors = F === 0 ? [[x1 + 3, z1 + 3], [x2 - 1, z1 + 3], [cx, z1 + 3, true]] : [[x1 + 4, z1 + 3], [cx + 1, z1 + 3]];
    partition(bp, x1 + 1, z1 + 3, x2 - 1, z1 + 3, y, 3, panel, doors, wood);
    partition(bp, F === 0 ? cx - 1 : cx, z1 + 4, F === 0 ? cx - 1 : cx, z2 - 1, y, 3, panel, [], wood);
    if (F === 0) partition(bp, cx + 1, z1 + 4, cx + 1, z2 - 1, y, 3, panel, [], wood);
    const west = { x1: x1 + 1, z1: z1 + 5, x2: (F === 0 ? cx - 2 : cx - 1), z2: z2 - 1, y, wood };
    const east = { x1: F === 0 ? cx + 2 : cx + 1, z1: z1 + 5, x2: x2 - 1, z2: z2 - 1, y, wood };
    for (const r of [west, east]) {
      for (let x = r.x1; x <= r.x2; x++) if (!doors.some(([dx]) => dx === x)) bp.set(x, y + 1, z1 + 3, 'black_concrete');
      const dx = doors.find(([d]) => d >= r.x1 && d <= r.x2)?.[0] ?? r.x1;
      bp.set(dx - r.x1 <= r.x2 - dx ? r.x2 : r.x1, y, z1 + 4, 'lectern[facing=south,has_book=true]');
      for (let x = r.x1 + 1; x + 1 <= r.x2; x += 3) {
        for (let z = r.z1; z + 1 <= r.z2; z += 2) {
          bp.set(x, y, z, `${wood}_slab[type=top]`);
          bp.set(x, y, z + 1, `${wood}_stairs[facing=south,half=bottom]`);
        }
      }
      light(bp, { x1: r.x1, z1: r.z1, x2: r.x2, z2: r.z2, y, h: 3 });
      (bp.rooms ??= []).push({ x1: r.x1, z1: z1 + 4, x2: r.x2, z2: r.z2, y, h: 3, kind: 'office', wood, keep: [], stage: 1 });
    }
    // Corridor: coat hooks and a plant; light.
    for (let x = x1 + 1; x <= x1 + 6; x++) if (!bp.get(x, y + 1, z1 + 1) && FULL_WALL(bp.get(x, y + 1, z1))) bp.set(x, y + 1, z1 + 1, 'tripwire_hook[facing=south,attached=false,powered=false]');
    light(bp, { x1: x1 + 1, z1: z1 + 1, x2: x1 + 6, z2: z1 + 2, y, h: 3 });
  }
  // Upper rooms are open to the roof: partitions run up to it (no attic floor).
  closeUnder(bp, at, [...Array(x2 - x1 - 1)].map((_, i) => [x1 + 1 + i, z1 + 3]), 9, plaster);
  closeUnder(bp, at, [...Array(z2 - z1 - 4)].map((_, i) => [cx, z1 + 4 + i]), 9, plaster);
  // Ground floor centre: the entrance hall between the two classrooms.
  light(bp, { x1: cx, z1: z1 + 4, x2: cx, z2: z2 - 1, y: 1, h: 3 });
  // Playground: linden, benches, a fountain, hopscotch, flag.
  bp.fill(0, 0, z2 + 2, 16, 0, 16, (x, y, z) => ((x + z) % 4 === 0 ? 'stone_bricks' : 'polished_andesite'));
  for (let x = cx; x <= cx + 1; x++) bp.set(x, 0, z2 + 1, 'polished_andesite');
  broadTree(bp, 2, 14, 5, 2, 'oak');
  bench(bp, 5, 15, 'south', 2, wood);
  YARD_ITEMS.fountain.draw(bp, rng, 11, 15, { wood: WOOD(wood) });
  for (const [i, x] of [11, 12, 13].entries()) bp.set(x, 1, 13, `${['red', 'yellow', 'blue'][i]}_carpet`);
  flagPole(bp, 15, 12, 7);
  bp.mark('bell', cx, ry + 2, tz);
  return bp;
}

// ---------------------------------------------------------------- market hall (Markthalle / Kornhaus)

export function markethall(rng) {
  const bp = new Blueprint();
  const x1 = 1, x2 = 15, z1 = 2, z2 = 13, cx = 8;
  const pillar = rng.pick(['stone_bricks', 'polished_andesite', 'tuff_bricks', 'smooth_sandstone']);
  const tw = WOOD(rng.pick(['dark_oak', 'spruce']));
  const roofMat = ROOFS[rng.pick(['tile', 'clay', 'slate', 'tile'])];
  const [ca, cb] = rng.pick([['red', 'white'], ['green', 'white'], ['yellow', 'red'], ['blue', 'white']]);
  bp.fill(0, 0, 0, 16, 0, 16, (x, y, z) => ((x + z) % 3 === 0 ? 'stone_bricks' : 'polished_andesite'));
  bp.fill(x1, 0, z1, x2, 0, z2, (x, y, z) => ((x + z) % 2 ? 'smooth_stone' : 'polished_andesite'));
  // Pillars on a 3-block grid round the edge, timber beams on top, cross beams to hang lanterns from.
  for (const [x, z] of perimeter(x1, z1, x2, z2)) {
    const p = (x - x1) % 3 === 0 && (z - z1) % 3 === 0 || ((x === x1 || x === x2) && (z - z1) % 3 === 0) || ((z === z1 || z === z2) && (x - x1) % 3 === 0);
    if (p) bp.fill(x, 1, z, x, 4, z, pillar);
    bp.set(x, 5, z, `${tw.log}[axis=${z === z1 || z === z2 ? 'x' : 'z'}]`);
  }
  for (let x = x1 + 3; x < x2; x += 3) for (let z = z1 + 1; z < z2; z++) bp.set(x, 5, z, `${tw.log}[axis=z]`);
  // Big hipped roof with a gable to the street carrying a clock.
  const at = roof(bp, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 1, y: 6, mat: roofMat, s: 3, brackets: tw.stairs });
  closeUnder(bp, at, perimeter(x1, z1, x2, z2).filter(([x, z]) => z === z2), 6, tw.planks, roofMat);
  if (at(cx, z2).y - 6 >= 4) clockFace(bp, cx, 8, z2, 'south');
  // Stalls: counters with goods, a cheese stall, flowers, bread; lanterns from the beams.
  const stall = (x, z, goods) => {
    for (let i = 0; i < 3; i++) {
      bp.set(x + i, 1, z, `${tw.slab}[type=top]`);
      bp.set(x + i, 2, z, rng.pick(goods));
    }
    bp.set(x + 1, 1, z - 1, `${tw.stairs}[facing=south,half=bottom]`);
  };
  const GOODS = {
    veg: ['carved_pumpkin[facing=south]', 'melon', 'pumpkin', 'hay_block[axis=x]'],
    cheese: ['yellow_terracotta', 'yellow_concrete', 'cake'],
    flowers: ['potted_red_tulip', 'potted_white_tulip', 'potted_flowering_azalea_bush', 'potted_poppy'],
    bread: ['cake', 'decorated_pot[facing=south]', 'candle[candles=3,lit=true]'],
  };
  const kinds = Object.keys(GOODS).sort(() => rng.next() - 0.5);
  stall(x1 + 2, z1 + 3, GOODS[kinds[0]]);
  stall(x2 - 4, z1 + 3, GOODS[kinds[1]]);
  stall(x1 + 2, z2 - 3, GOODS[kinds[2]]);
  stall(x2 - 4, z2 - 3, GOODS[kinds[3]]);
  for (const [x, z] of [[x1 + 2, z1 + 2], [x2 - 4, z1 + 2], [x1 + 2, z2 - 4], [x2 - 4, z2 - 4]]) bp.set(x + 1, 1, z, `${tw.stairs}[facing=north,half=bottom]`);
  for (let x = x1 + 3; x < x2; x += 3) for (const z of [z1 + 3, z2 - 3]) bp.set(x, 4, z, 'lantern[hanging=true]');
  for (let x = x1; x <= x2; x++) if (x % 2 === 0) bp.set(x, 4, z2 + 1, `${x % 4 ? ca : cb}_wall_banner[facing=south]`);
  bp.mark('workstation', x1 + 3, 1, z1 + 3, { data: { profession: 'farmer' } });
  bp.mark('workstation', x2 - 3, 1, z2 - 3, { data: { profession: 'butcher' } });
  // Fountain and benches outside.
  bench(bp, 2, 15, 'south', 2, tw.name);
  bench(bp, 12, 15, 'south', 2, tw.name);
  lamp(bp, cx, 15, 3, 'double');
  return bp;
}

// ---------------------------------------------------------------- railway station (Bahnhof)

export function station(rng) {
  const bp = new Blueprint();
  const x1 = 3, x2 = 13, z1 = 7, z2 = 13, cx = 8;
  const tw = WOOD(rng.pick(['spruce', 'dark_oak']));
  const plaster = rng.pick(['calcite', 'smooth_sandstone', 'white_terracotta', 'yellow_terracotta']);
  const roofMat = ROOFS[rng.pick(['tile', 'slate', 'dark_oak', 'spruce'])];
  const place = rng.pick(PLACES);
  // Track along the back (east-west), ballast, platform edge with a white line, canopy on iron columns.
  for (let x = 0; x <= 16; x++) {
    bp.set(x, 0, 0, 'gravel');
    bp.set(x, 0, 1, 'gravel');
    bp.set(x, 1, 1, 'rail[shape=east_west]');
    bp.set(x, 0, 2, 'gravel');
    bp.set(x, 0, 3, 'smooth_stone');
    for (let z = 4; z <= 6; z++) bp.set(x, 0, z, (x + z) % 2 ? 'polished_andesite' : 'smooth_stone');
  }
  for (let x = 0; x <= 16; x++) bp.set(x, 0, 3, 'white_concrete');
  bp.mark('rail_track', -2, 1, 1, { facing: 'east', data: { to: [18, 1, 1] } });
  for (let x = 1; x <= 15; x++)
    for (let z = 4; z <= 6; z++) {
      if (z === 4 && x % 4 === 1) bp.fill(x, 1, z, x, 3, z, 'polished_blackstone_wall');
      bp.set(x, 4, z, `${tw.slab}[type=bottom]`);
    }
  for (let x = 1; x <= 15; x++) bp.set(x, 4, 3, `${tw.trapdoor}[facing=north,half=top]`);
  // The SBB clock on its post, benches, a departure board.
  bp.set(cx, 1, 5, 'polished_blackstone_wall');
  bp.set(cx, 2, 5, 'polished_blackstone_wall');
  clockFace(bp, cx, 3, 5, 'north');
  bench(bp, 3, 5, 'south', 2, tw.name);
  bench(bp, 12, 5, 'south', 2, tw.name);
  // Station building: tall waiting hall, ticket counter, timber gable roof with a wide overhang.
  bp.fill(x1, 0, z1, x2, 0, z2, 'polished_andesite');
  bp.fill(x1 + 1, 0, z1 + 1, x2 - 1, 0, z2 - 1, (x, y, z) => ((x + z) % 2 ? 'smooth_stone' : 'polished_andesite'));
  bp.walls(x1, 1, z1, x2, 4, z2, (x, y, z) => ((x === x1 || x === x2) && (z === z1 || z === z2) ? 'stone_bricks' : y === 1 ? 'stone_bricks' : plaster));
  for (const x of [x1 + 2, x2 - 3]) {
    win(bp, rng, x, 2, z1, 'north', { w: 2, h: 2 });
    win(bp, rng, x, 2, z2, 'south', { w: 2, h: 2 });
  }
  win(bp, rng, x1, 2, z1 + 3, 'west', { h: 2 });
  win(bp, rng, x2, 2, z1 + 3, 'east', { h: 2 });
  doorway(bp, cx, 1, z1, 'north', tw.door, { transom: 'glass_pane' });
  doorway(bp, cx, 1, z2, 'south', tw.door, { transom: 'glass_pane' });
  const at = roof(bp, { x1: x1 - 2, x2: x2 + 2, z1: z1 - 1, z2: z2 + 1, y: 5, mat: roofMat, w: INF, e: INF, trim: { stairs: tw.stairs, slab: tw.slab }, brackets: tw.stairs });
  closeUnder(bp, at, perimeter(x1, z1, x2, z2), 5, tw.planks, roofMat);
  bp.set(cx, 4, z1 - 1, `${tw.sign}[facing=north]${signData(['', place, '', ''], 'black')}`);
  bp.set(cx + 2, 4, z2 + 1, `${tw.sign}[facing=south]${signData(['', place, 'SBB CFF FFS', ''], 'black')}`);
  for (let x = x2 - 3; x <= x2 - 1; x++) bp.set(x, 1, z1 + 1, x === x2 - 1 ? tw.planks : `${tw.slab}[type=top]`);
  bp.set(x2 - 2, 2, z1 + 1, 'bell[attachment=floor,facing=south]');
  bp.set(x1 + 1, 2, z1 + 1, `${tw.sign}[facing=south]${signData(['ABFAHRT', '08:12 Bern', '08:47 Luzern', '09:03 Chur'], 'black')}`);
  bench(bp, x1 + 2, z2 - 1, 'north', 3, tw.name);
  for (const x of [x1 + 3, x2 - 3]) light(bp, { x1: x, z1: z1 + 3, x2: x, z2: z1 + 3, y: 1 });
  bp.set(x2 - 1, 1, z2 - 1, rng.pick(HOUSE_PLANTS));
  // Forecourt: PostAuto stop, bike stand, lamp.
  for (let z = z2 + 1; z <= 16; z++) for (let x = 0; x <= 16; x++) bp.set(x, 0, z, (x + z) % 3 ? 'polished_andesite' : 'stone_bricks');
  bp.fill(1, 1, 15, 1, 2, 15, 'polished_blackstone_wall');
  bp.set(1, 3, 15, 'yellow_concrete');
  bp.set(2, 3, 15, `${tw.sign}[facing=east]${signData(['PostAuto', '', '', ''], 'black')}`);
  for (let x = 12; x <= 14; x++) bp.set(x, 1, 15, 'iron_bars');
  lamp(bp, 6, 15, 3, 'simple');
  return bp;
}

// ---------------------------------------------------------------- funicular stations (Standseilbahn)

/** Inclined track: rails ascending northwards from (x, y0, zFrom) to zTo, on a stone bed (or a dug trench). */
function funicularTrack(bp, x, y0, zFrom, zTo, { bed = 'stone_bricks', dig = false }) {
  let y = y0;
  for (let z = zFrom; z >= zTo; z--) {
    for (const dx of [0, 1]) {
      bp.set(x + dx, y - 1, z, bed);
      // One rail lane on a two-wide bed: parallel rails would bend towards each other when placed.
      if (dx === 0) bp.set(x + dx, y, z, z === zFrom ? 'rail[shape=north_south]' : 'rail[shape=ascending_north]');
      if (dig) for (let yy = y + 1; yy <= Math.max(y + 3, 0); yy++) bp.set(x + dx, yy, z, yy <= 0 ? 'air' : null);
    }
    y++;
  }
  return y - 1;
}

function funicularStation(rng, top) {
  const bp = new Blueprint();
  const x1 = 3, x2 = 13, z1 = 4, z2 = 12, cx = 8;
  const tw = WOOD(rng.pick(['spruce', 'dark_oak']));
  const roofMat = ROOFS[rng.pick(['slate', 'tile', 'copper'])];
  const plaster = rng.pick(['calcite', 'smooth_sandstone', 'white_terracotta']);
  const tx = cx; // track lanes tx, tx + 1
  bp.fill(0, 0, z2 + 1, 16, 0, 16, (x, y, z) => ((x + z) % 3 ? 'polished_andesite' : 'stone_bricks'));
  // Hall: platform steps beside the track, the track leaves through a portal in the back wall.
  bp.fill(x1, 0, z1, x2, 0, z2, 'polished_andesite');
  bp.walls(x1, 1, z1, x2, 8, z2, (x, y, z) => ((x === x1 || x === x2) && (z === z1 || z === z2) ? 'stone_bricks' : y <= 1 ? 'stone_bricks' : plaster));
  for (const x of [x1 + 1, x2 - 1]) {
    win(bp, rng, x, 2, z2, 'south', { h: 3 });
    win(bp, rng, x1, 3, z1 + 3, 'west', { h: 2, w: 3 });
    win(bp, rng, x2, 3, z1 + 3, 'east', { h: 2, w: 3 });
  }
  doorway(bp, cx - 2, 1, z2, 'south', tw.door, { transom: 'glass_pane' });
  // Track: at the bottom station it climbs out through the back wall on piers; at the top it comes up from below.
  if (!top) {
    const yEnd = funicularTrack(bp, tx, 1, z2 - 1, -2, {});
    for (let z = z2 - 1; z >= -2; z--) {
      const yy = 1 + (z2 - 1 - z);
      for (const dx of [0, 1]) {
        if (z >= z1) for (let y = 1; y <= yy - 2; y++) bp.set(tx + dx, y, z, 'stone_bricks'); // ramp inside the hall
        else if ((z1 - z) % 3 === 1) bp.fill(tx + dx, 0, z, tx + dx, yy - 2, z, 'stone_bricks'); // piers outside
      }
    }
    const yp = 1 + (z2 - 1 - z1);
    for (const x of [tx, tx + 1]) for (let y = yp + 1; y <= yp + 3; y++) bp.set(x, y, z1, null);
    bp.mark('funicular', tx, 1, z2 - 1, { facing: 'north', data: { end: 'bottom', top: [tx, yEnd, -2] } });
  } else {
    let y = 1;
    for (let z = z2 - 1; z >= -2; z--) {
      for (const dx of [0, 1]) {
        bp.set(tx + dx, y - 1, z, 'stone_bricks');
        if (dx === 0) bp.set(tx + dx, y, z, z === z2 - 1 ? 'rail[shape=north_south]' : 'rail[shape=ascending_south]');
        else if (y <= 0) bp.set(tx + dx, y, z, 'air');
        for (let yy = y + 1; yy <= 0; yy++) bp.set(tx + dx, yy, z, 'air');
      }
      if (y <= 0) for (const dx of [-1, 2]) for (let yy = y - 1; yy <= 0; yy++) bp.set(tx + dx, yy, z, 'stone_bricks');
      y--;
    }
    bp.mark('funicular', tx, 1, z2 - 1, { facing: 'south', data: { end: 'top', bottom: [tx, y + 1, -2] } });
  }
  // Platform: stepped slabs beside the track, a railing to the track, benches, ticket gate, clock.
  for (let z = z1 + 1; z <= z2 - 1; z++) bp.set(tx + 2, 1, z, 'iron_bars');
  for (let z = z1 + 1; z <= z2 - 1; z++) bp.set(tx - 1, 1, z, 'iron_bars');
  bp.set(tx + 2, 1, z2 - 1, null);
  bp.set(tx - 1, 1, z2 - 1, null);
  bench(bp, x1 + 1, z1 + 3, 'west', 3, tw.name);
  for (let x = x1 + 1; x <= x1 + 2; x++) bp.set(x, 1, z1 + 1, `${tw.slab}[type=top]`);
  bp.set(x1 + 1, 2, z1 + 1, 'bell[attachment=floor,facing=east]');
  clockFace(bp, cx + 3, 5, z2, 'south');
  const at = roof(bp, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 1, y: 9, mat: roofMat, n: INF, s: INF, trim: { stairs: tw.stairs, slab: tw.slab } });
  closeUnder(bp, at, perimeter(x1, z1, x2, z2), 9, plaster, roofMat);
  if (!top) { const yp = 1 + (z2 - 1 - z1); for (const x of [tx, tx + 1]) for (let y = yp + 1; y <= yp + 3; y++) bp.set(x, y, z1, null); }
  bp.set(cx - 2, 4, z2 + 1, `${tw.sign}[facing=south]${signData(['STANDSEILBAHN', top ? 'Bergstation' : 'Talstation', rng.pick(PLACES), ''], 'black')}`);
  for (const x of [x1 + 2, x2 - 2]) light(bp, { x1: x, z1: (z1 + z2) >> 1, x2: x, z2: (z1 + z2) >> 1, y: 1, h: 3 });
  lamp(bp, 2, 15, 3, 'double');
  bench(bp, 12, 15, 'south', 2, tw.name);
  if (top) flagPole(bp, 15, 14, 8);
  return bp;
}

export function funicular_bottom(rng) {
  return funicularStation(rng, false);
}

export function funicular_top(rng) {
  return funicularStation(rng, true);
}

// ---------------------------------------------------------------- viewpoint shelter (Aussichtspunkt)

export function viewpoint(rng) {
  const bp = new Blueprint();
  const tw = WOOD(rng.pick(['spruce', 'dark_oak', 'oak']));
  const roofMat = ROOFS[rng.pick(['spruce', 'slate', 'dark_oak'])];
  const cx = 8, cz = 7;
  // Stone terrace towards the view (north) with a railing, a path from the street.
  for (let x = 2; x <= 14; x++) for (let z = 1; z <= 11; z++) bp.set(x, 0, z, (x + z) % 3 ? 'stone_bricks' : 'mossy_stone_bricks');
  for (let x = 2; x <= 14; x++) bp.set(x, 1, 1, tw.fence);
  for (let z = 1; z <= 11; z++) for (const x of [2, 14]) bp.set(x, 1, z, tw.fence);
  for (let z = 12; z <= 16; z++) bp.set(cx, 0, z, rng.pick(['dirt_path', 'gravel']));
  // Open shelter: four posts, a pyramid roof, benches facing the view.
  for (const [x, z] of [[cx - 2, cz - 2], [cx + 2, cz - 2], [cx - 2, cz + 2], [cx + 2, cz + 2]]) bp.fill(x, 1, z, x, 3, z, `${tw.log}[axis=y]`);
  for (let x = cx - 2; x <= cx + 2; x++) for (const z of [cz - 2, cz + 2]) bp.set(x, 4, z, `${tw.log}[axis=x]`);
  for (let z = cz - 1; z <= cz + 1; z++) for (const x of [cx - 2, cx + 2]) bp.set(x, 4, z, `${tw.log}[axis=z]`);
  roof(bp, { x1: cx - 3, x2: cx + 3, z1: cz - 3, z2: cz + 3, y: 4, mat: roofMat, trim: { stairs: tw.stairs, slab: tw.slab } });
  bp.set(cx, 4, cz, 'lantern[hanging=true]');
  bp.set(cx, 3, cz, null);
  bp.set(cx, 4, cz, tw.planks);
  bp.set(cx, 3, cz, 'lantern[hanging=true]');
  bench(bp, cx - 1, cz - 1, 'south', 3, tw.name);
  bench(bp, cx - 1, cz + 1, 'south', 3, tw.name);
  bp.mark('spyglass_spot', cx + 3, 2, 2, { facing: 'north', data: { item: 'spyglass' } });
  bp.set(cx + 3, 1, 2, 'andesite_wall');
  bp.set(cx - 3, 1, 2, `${tw.sign.replace('_wall_sign', '_sign')}[rotation=8]${signData(['AUSSICHT', 'Eiger  3967', 'Moench 4107', 'Jungfrau 4158'], 'black')}`);
  flagPole(bp, 13, 10, 6);
  for (const [x, z] of [[4, 10], [12, 4]]) bp.set(x, 1, z, rng.pick(['flowering_azalea', 'azalea']));
  sprinkleFlowers(bp, rng, 0, 12, 16, 16, 0.25, ['azure_bluet', 'cornflower', 'dandelion', 'oxeye_daisy', 'short_grass', 'allium']);
  spruce(bp, 1, 14, rng.int(6, 8), 1);
  spruce(bp, 15, 14, rng.int(5, 7), 1);
  return bp;
}

// ---------------------------------------------------------------- fire station (Feuerwehrdepot with hose tower)

export function firestation(rng) {
  const bp = new Blueprint();
  const x1 = 1, x2 = 11, z1 = 3, z2 = 12;
  const plaster = rng.pick(['calcite', 'white_terracotta', 'smooth_sandstone']);
  const roofMat = ROOFS[rng.pick(['tile', 'slate', 'clay'])];
  const wood = rng.pick(['spruce', 'dark_oak']);
  // Garage hall with two red gates, crew room above, hose tower at the side.
  bp.fill(x1, 0, z1, x2, 0, z2, 'smooth_stone');
  bp.walls(x1, 1, z1, x2, 8, z2, (x, y, z) => ((x === x1 || x === x2) && (z === z1 || z === z2) ? 'stone_bricks' : y <= 1 ? 'stone_bricks' : y === 5 ? 'red_terracotta' : plaster));
  bp.fill(x1 + 1, 5, z1 + 1, x2 - 1, 5, z2 - 1, `${wood}_planks`);
  for (const gx of [x1 + 1, x1 + 5]) {
    for (let x = gx; x <= gx + 2; x++) for (let y = 1; y <= 3; y++) bp.set(x, y, z2, y === 3 ? 'red_concrete' : 'red_terracotta');
    for (let x = gx - 1; x <= gx + 3; x++) bp.set(x, 4, z2, 'stone_bricks');
    bp.set(gx + 1, 2, z2 + 1, 'stone_button[face=wall,facing=south]');
  }
  bp.door(x2 - 1, 1, z2, wood, 'south');
  bp.set(x2 - 1, 3, z2, 'glass');
  for (const x of [x1 + 2, x1 + 5, x1 + 8]) win(bp, rng, x, 6, z2, 'south', { w: 2, h: 2 });
  win(bp, rng, x1, 2, z1 + 3, 'west', { w: 3, h: 2 });
  win(bp, rng, x1, 6, z1 + 3, 'west', { w: 3, h: 2 });
  bp.set(x1 + 5, 5, z2 + 1, `${wood}_wall_sign[facing=south]${signData(['', 'FEUERWEHR', '118', ''], 'red')}`);
  const at = roof(bp, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 1, y: 9, mat: roofMat, n: INF, s: INF, brackets: `${wood}_stairs` });
  closeUnder(bp, at, perimeter(x1, z1, x2, z2), 9, plaster, roofMat);
  // Two engines (block models: red body, white stripe, black wheels) and kit along the walls.
  for (const gx of [x1 + 1, x1 + 5]) {
    for (let z = z1 + 3; z <= z1 + 7; z++) {
      bp.set(gx, 1, z, z === z1 + 3 || z === z1 + 7 ? 'black_terracotta' : 'red_terracotta');
      bp.set(gx + 2, 1, z, z === z1 + 3 || z === z1 + 7 ? 'black_terracotta' : 'red_terracotta');
      bp.set(gx + 1, 1, z, 'red_terracotta');
      bp.set(gx + 1, 2, z, z >= z1 + 6 ? 'light_gray_stained_glass' : z === z1 + 5 ? 'white_terracotta' : 'red_terracotta');
    }
    bp.set(gx + 1, 3, z1 + 6, 'blue_stained_glass');
    bp.mark('vehicle_spot', gx + 1, 1, z1 + 5, { facing: 'south', data: { kind: 'fire_engine' } });
  }
  for (let x = x1 + 1; x <= x1 + 7; x += 2) bp.set(x, 2, z1 + 1, 'tripwire_hook[facing=south,attached=false,powered=false]');
  bp.set(x1 + 1, 1, z1 + 1, 'barrel[facing=up]');
  bp.set(x1 + 2, 1, z1 + 1, 'chest[facing=south]');
  for (const [x, z] of [[x1 + 3, z1 + 5], [x1 + 7, z1 + 5], [x2 - 2, z2 - 2]]) bp.set(x, 4, z, 'lantern[hanging=true]');
  // Hose tower (Schlauchturm) at the east side: ladder to the top room with the alarm bell.
  const tx1 = x2, tz1 = z1 + 1, tx2 = x2 + 2, tz2 = z1 + 3, H = 15;
  bp.fill(tx1, 0, tz1, tx2, 0, tz2, 'stone_bricks');
  bp.walls(tx1, 1, tz1, tx2, H, tz2, (x, y, z) => ((x === tx1 || x === tx2) && (z === tz1 || z === tz2) ? 'stone_bricks' : y <= 1 ? 'stone_bricks' : plaster));
  bp.door(x2, 1, tz1 + 1, wood, 'east');
  for (let y = 1; y <= H - 2; y++) bp.set(tx1 + 1, y, tz1 + 1, 'ladder[facing=north]');
  for (const [x, z, f] of [[tx1 + 1, tz1, 'north'], [tx2, tz1 + 1, 'east'], [tx1 + 1, tz2, 'south']]) bp.set(x, H - 1, z, 'glass_pane');
  bp.set(tx1 + 1, H - 1, tz1 + 1, 'bell[attachment=ceiling,facing=south]');
  bp.set(tx1 + 1, H, tz1 + 1, `${wood}_planks`);
  for (let y = 4; y < H - 4; y += 4) bp.set(tx2, y, tz1 + 1, 'glass_pane');
  const tr = roof(bp, { x1: tx1, x2: tx2, z1: tz1, z2: tz2, y: H + 1, mat: roofMat, kind: 'steep', pitch: 2 });
  bp.set(tx1 + 1, tr(tx1 + 1, tz1 + 1).y + 1, tz1 + 1, 'waxed_oxidized_lightning_rod[facing=up]');
  // Crew room upstairs by stairs from the garage.
  const hall = stairHall(bp, { axis: 'z', laneA: [x2 - 2], laneB: [x2 - 1], u0: z2 - 2, dir: -1, planes: [0, 5], wood });
  furnish(bp, rng, { x1: x1 + 1, z1: z1 + 1, x2: x2 - 3, z2: z2 - 1, y: 6, h: 3 }, 'common', [...hall.cells, ...(hall.ends[5] ?? [])], wood, { items: ['chest', 'barrel', 'chiseled', 'clock'], table: true });
  // Apron: hydrant, flag.
  bp.fill(x1, 0, z2 + 1, x2, 0, 16, 'smooth_stone');
  bp.set(14, 1, 14, 'red_concrete');
  bp.set(14, 2, 14, 'red_terracotta');
  flagPole(bp, 15, 16, 7);
  return bp;
}

// ---------------------------------------------------------------- post office (Post, PTT yellow)

export function postoffice(rng) {
  const bp = new Blueprint();
  const x1 = 2, x2 = 14, z1 = 4, z2 = 11, cx = 8;
  const plaster = rng.pick(['calcite', 'smooth_sandstone', 'white_terracotta', 'light_gray_terracotta']);
  const trim = rng.pick([TRIMS.stone, TRIMS.andesite, TRIMS.tuff]);
  const roofMat = ROOFS[rng.pick(['tile', 'slate', 'clay', 'deepslate'])];
  const wood = rng.pick(['spruce', 'oak', 'dark_oak']);
  const planes = [0, 5];
  bp.fill(x1, 0, z1, x2, 0, z2, 'polished_andesite');
  bp.fill(x1 + 1, 0, z1 + 1, x2 - 1, 0, z2 - 1, (x, y, z) => ((x + z) % 2 ? 'smooth_stone' : 'polished_andesite'));
  bp.walls(x1, 1, z1, x2, 8, z2, (x, y, z) => ((x === x1 || x === x2) && (z === z1 || z === z2) ? trim.block : y === 1 || y === 5 ? trim.block : plaster));
  bp.fill(x1 + 1, 5, z1 + 1, x2 - 1, 5, z2 - 1, `${wood}_planks`);
  for (const x of [x1 + 2, x2 - 3]) {
    win(bp, rng, x, 2, z2, 'south', { w: 2, h: 2, lintel: trim.block });
    win(bp, rng, x, 6, z2, 'south', { w: 2, h: 2, lintel: trim.block, box: `${wood}_trapdoor` });
  }
  win(bp, rng, cx - 1, 6, z2, 'south', { w: 3, h: 2, lintel: trim.block });
  for (const z of [z1 + 5]) {
    win(bp, rng, x1, 2, z, 'west', { w: 2, h: 2 });
    win(bp, rng, x1, 6, z, 'west', { w: 2, h: 2 });
    win(bp, rng, x2, 6, z, 'east', { w: 2, h: 2 });
  }
  doorway(bp, cx, 1, z2, 'south', wood, { double: true, frame: trim.block, transom: 'glass_pane' });
  // The yellow POST band with the post horn, a mailbox, the PostAuto stop.
  for (let x = x1 + 1; x <= x2 - 1; x++) bp.set(x, 4, z2 + 1, 'yellow_wall_banner[facing=south]');
  bp.set(cx, 4, z2 + 1, `yellow_wall_banner[facing=south]${pattern([['circle', 'black'], ['half_horizontal_bottom', 'yellow'], ['border', 'black']])}`);
  bp.set(cx + 2, 4, z2 + 1, `${wood}_wall_sign[facing=south]${signData(['', 'POST', 'PTT', ''], 'black')}`);
  bp.set(x2 - 1, 1, z2 + 1, 'yellow_concrete');
  bp.set(x2 - 1, 2, z2 + 1, 'yellow_terracotta');
  const at = roof(bp, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 1, y: 9, mat: roofMat, w: INF, e: INF, brackets: `${wood}_stairs` });
  closeUnder(bp, at, perimeter(x1, z1, x2, z2), 9, plaster, roofMat);
  // Counter hall: three counters with bells, parcel shelves, a bench; stairs to the postmaster's flat.
  const hall = stairHall(bp, { axis: 'x', laneA: [z1 + 2], laneB: [z1 + 1], u0: x2 - 1, dir: -1, planes, wood });
  for (let x = x1 + 1; x <= x1 + 7; x++) {
    bp.set(x, 1, z1 + 4, x % 2 ? `${wood}_slab[type=top]` : 'yellow_terracotta');
    if (x % 2) bp.set(x, 2, z1 + 4, x === x1 + 3 ? 'bell[attachment=floor,facing=south]' : 'candle[candles=1,lit=true]');
  }
  for (let x = x1 + 1; x <= x1 + 6; x++) bp.set(x, 1, z1 + 1, 'barrel[facing=south]');
  bench(bp, x2 - 4, z2 - 1, 'north', 3, wood);
  for (const x of [x1 + 3, x2 - 4]) light(bp, { x1: x, z1: z1 + 5, x2: x, z2: z1 + 6, y: 1, h: 3 });
  bp.mark('workstation', x1 + 3, 1, z1 + 4, { data: { profession: 'cartographer' } });
  const keep = [...hall.cells, ...(hall.ends[5] ?? [])];
  partition(bp, x1 + 1, z1 + 3, x2 - 1, z1 + 3, 6, 3, plaster, [[x2 - 4, z1 + 3], [x1 + 3, z1 + 3]], wood);
  bp.set(x1 + 1, 6, z1 + 4, 'smoker[facing=south,lit=true]');
  bp.set(x1 + 2, 6, z1 + 4, 'water_cauldron[level=3]');
  furnish(bp, rng, { x1: x1 + 1, z1: z1 + 4, x2: cx + 1, z2: z2 - 1, y: 6, h: 3 }, 'kitchen', [...keep, [x1 + 3, z1 + 4], [cx + 1, z1 + 5]], wood, { items: ['counter', 'crafting', 'chest'], table: true });
  partition(bp, cx + 2, z1 + 4, cx + 2, z2 - 1, 6, 3, plaster, [[cx + 2, z1 + 5]], wood);
  furnish(bp, rng, { x1: cx + 3, z1: z1 + 4, x2: x2 - 1, z2: z2 - 1, y: 6, h: 3 }, 'bedroom', [[cx + 3, z1 + 5], ...keep], wood, { items: ['bed', 'chest', 'tub', 'plant', 'toilet'] });
  closeUnder(bp, at, [...Array(x2 - x1 - 1)].map((_, i) => [x1 + 1 + i, z1 + 3]), 9, plaster);
  closeUnder(bp, at, [...Array(z2 - z1 - 4)].map((_, i) => [cx + 2, z1 + 4 + i]), 9, plaster);
  light(bp, { x1: x1 + 4, z1: z1 + 1, x2: x1 + 8, z2: z1 + 2, y: 6 });
  // Forecourt with the PostAuto stop.
  bp.fill(0, 0, z2 + 1, 16, 0, 16, (x, y, z) => ((x + z) % 3 ? 'polished_andesite' : 'stone_bricks'));
  bp.fill(2, 1, 15, 2, 2, 15, 'polished_blackstone_wall');
  bp.set(2, 3, 15, 'yellow_concrete');
  bp.set(3, 3, 15, `${wood}_wall_sign[facing=east]${signData(['PostAuto', 'Haltestelle', '', ''], 'black')}`);
  bench(bp, 4, 16, 'south', 2, wood);
  planter(bp, 14, 15, wood);
  return bp;
}

// ================================================================ registry

const RAW = {
  chalet, townhouse, cafe, church, clocktower, hotel, modern, apartment, farmhouse, hut,
  // waterfront (zone 'shore')
  lighthouse, boathouse, schiffstation, lido,
  // public works (built for a district by the economy)
  school, markethall, station, funicular_bottom, funicular_top, viewpoint, firestation, postoffice,
};

/**
 * Growth stages per type (docs/generator-contract.md §3): 1 small house, 2 full house, 3 extension.
 * Types not listed have one stage (the full building) whatever stage is asked for.
 */
export const STAGES = { chalet: 3, townhouse: 3, cafe: 3, hotel: 3, modern: 3, apartment: 3, farmhouse: 3, hut: 3 };

/**
 * type -> (rng, options) => Blueprint at options.stage (default: the last stage), with the shared semantic
 * markers (doors, seats, beds, ...) added. Generators always draw every stage, so rng use is the same for all.
 */
export const BUILDINGS = Object.fromEntries(Object.entries(RAW).map(([type, gen]) => [type, (rng, options = {}) => {
  const max = STAGES[type] ?? 1;
  const stage = Math.max(1, Math.min(max, Math.round(Number(options?.stage) || max)));
  const bp = gen(rng, options ?? {});
  return autoMarks(max > 1 ? bp.atStage(stage) : bp, type);
}]));

/**
 * Building catalogue for the bridge. label: English name (for the UI use t(labelKey), locales/*.json "building.<type>").
 * zones: relative weights per ring around the city centre (core = old town, inner, outer, rural = villages and farms);
 * a type with no weight in any of these is never picked as a chat's home. unique: at most one per district / city.
 * kind: 'home' (a chat's house, grows in STAGES), 'public' (built for a district by the economy), 'shore' (needs a lot
 * with water on its local north, see docs/generator-contract.md §7). site: where such a building belongs (hint for the
 * terrain planner); variants: terrain modes the generator builds itself (VARIANTS). Terrain weights for homes stay in
 * bridge/city.mjs (TERRAIN_WEIGHTS) unless a type sets terrain: { slope, stilts, waterfront }.
 */
const C = (type, label, o) => ({ label, labelKey: `building.${type}`, ...o, ...(VARIANTS[type] ? { variants: VARIANTS[type] } : {}) });
export const CATALOG = {
  chalet: C('chalet', 'Chalet', { kind: 'home', zones: { inner: 2, outer: 5, rural: 4 } }),
  townhouse: C('townhouse', 'Old-town house', { kind: 'home', zones: { core: 8, inner: 5, outer: 1 } }),
  cafe: C('cafe', 'Konditorei', { kind: 'home', zones: { core: 3, inner: 2, outer: 0.5 } }),
  church: C('church', 'Church', { kind: 'public', zones: { core: 1, inner: 1.5, outer: 1, rural: 0.6 }, unique: 'district' }),
  clocktower: C('clocktower', 'Clock tower', { kind: 'public', zones: { core: 2.5 }, unique: 'city' }),
  hotel: C('hotel', 'Grand Hotel', { kind: 'home', zones: { core: 1, inner: 2, outer: 1 }, unique: 'district' }),
  modern: C('modern', 'Modern house', { kind: 'home', zones: { inner: 2, outer: 4, rural: 1 } }),
  apartment: C('apartment', 'Co-op housing', { kind: 'home', zones: { inner: 3, outer: 3 } }),
  farmhouse: C('farmhouse', 'Emmental farm', { kind: 'home', zones: { outer: 0.8, rural: 5 } }),
  hut: C('hut', 'Alpine hut', { kind: 'home', zones: { rural: 2 } }),
  // Waterfront: only on shore lots (the terrain planner picks them by zone 'shore').
  lighthouse: C('lighthouse', 'Lighthouse', { kind: 'shore', zones: { shore: 1 }, unique: 'city', site: 'mole head' }),
  boathouse: C('boathouse', 'Boathouse', { kind: 'shore', zones: { shore: 4 }, site: 'shoreline' }),
  schiffstation: C('schiffstation', 'Steamer landing', { kind: 'shore', zones: { shore: 1.5 }, unique: 'district', site: 'harbour' }),
  lido: C('lido', 'Lido', { kind: 'shore', zones: { shore: 1.5 }, unique: 'district', site: 'beach' }),
  // Public works: built for a district by the economy, never a chat's home.
  school: C('school', 'School', { kind: 'public', zones: {}, unique: 'district' }),
  markethall: C('markethall', 'Market hall', { kind: 'public', zones: {}, unique: 'district' }),
  station: C('station', 'Railway station', { kind: 'public', zones: {}, unique: 'city' }),
  funicular_bottom: C('funicular_bottom', 'Funicular (valley)', { kind: 'public', zones: {}, unique: 'city', pair: 'funicular_top' }),
  funicular_top: C('funicular_top', 'Funicular (summit)', { kind: 'public', zones: {}, unique: 'city', pair: 'funicular_bottom', site: 'upper end of a steep slope' }),
  viewpoint: C('viewpoint', 'Viewpoint', { kind: 'public', zones: {}, site: 'edge of a cliff or steep cell' }),
  firestation: C('firestation', 'Fire station', { kind: 'public', zones: {}, unique: 'district' }),
  postoffice: C('postoffice', 'Post office', { kind: 'public', zones: {}, unique: 'district' }),
};

export const LABELS = { ...Object.fromEntries(Object.entries(CATALOG).map(([k, v]) => [k, v.label])), square: 'Main square', plaza: 'District square' };
export const LABEL_KEYS = { ...Object.fromEntries(Object.entries(CATALOG).map(([k, v]) => [k, v.labelKey])), square: 'building.square', plaza: 'building.plaza' };

export function generate(type, seed, options = {}) {
  return BUILDINGS[type](rngFrom(`${seed}:${type}`), options);
}
