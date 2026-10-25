// Town infrastructure that follows the terrain: quays, piers, a lake promenade, a lido beach, the harbour
// (breakwater, lighthouse, steamer landing), stair lanes up the hillside, viewpoints at cliffs and bridges
// over rivers. Nothing here fills water or flattens a hill: piers stand on posts, breakwaters and quay walls
// are narrow stone walls, lanes and bridges carry their own supports.
//
// Every piece is a record in state.terrain.infra: { id, type, cell, seed, params, placed, done, v }.
// `params` are measured from the terrain scan once, when the piece is planned (heights along a pier, the
// stair path…), so the build list is a pure function of (type, params, seed): deterministic, resumable after
// a restart, and renovatable — when this file changes (INFRA_VERSION), finished pieces are re-applied
// additively by the crew (setblock of an unchanged block is a no-op; nothing is ever demolished).
//
// Planning:  planAfterPlot(ctx, plot, hop)  — around a new plot (quay, pier, promenade, beach, viewpoint,
//            harbour, the stair lane or bridge it was reached by);  planShoreRenovation(ctx) — quays and
//            piers for existing plots that meet the water, plus the harbour (additive migration).
// Building:  InfraWorks.step(dt) — a small crew places a few blocks per tick while chats are working.
// Anchors for boats and steamers (life agent): state.terrain.anchors, see docs/world-anchors.md.
import { rngFrom, withConnections } from './blueprint.mjs';
import { PLOT, SIDES, sideOf, WALL_STONES } from './terrain.mjs';
import { harbourSites } from './terrain-scan.mjs';
import { t } from './i18n.mjs';

const FACING = { N: 'north', S: 'south', E: 'east', W: 'west' };
const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
const dirName = ([dx, dz]) => (dx === 1 ? 'east' : dx === -1 ? 'west' : dz === 1 ? 'south' : 'north');
const DECOR = /lantern|torch|banner|flower_pot|potted_|carpet|_door\b|trapdoor|ladder|sign|vine|leaves|fern|poppy|cornflower|daisy|tulip|allium|bluet|dandelion|lily|bars|chain|bell|campfire|candle/;
const ns = (b) => (b.includes(':') ? b : `minecraft:${b}`);
const SWISS_BANNER = 'red_banner[rotation=0]{patterns:[{pattern:"minecraft:straight_cross",color:"white"},{pattern:"minecraft:border",color:"red"}]}';
const FLOWERS = ['poppy', 'cornflower', 'oxeye_daisy', 'azure_bluet', 'red_tulip', 'white_tulip', 'allium', 'lily_of_the_valley'];

// ------------------------------------------------------------------ frames
//
// A frame maps (u, v) to world (x, z) inside a cell: u runs from the cell edge on side `from` into the cell
// (u = 0 is the first row), v runs across. dir = the u direction as [dx, dz].

export function frame(r, from) {
  const d = SIDES[OPP[from]]; // walking from the `from` edge into the cell
  const e = d[0] !== 0 ? [0, 1] : [1, 0];
  const ox = d[0] === -1 ? r.x2 : r.x1;
  const oz = d[1] === -1 ? r.z2 : r.z1;
  return {
    d, e,
    at: (u, v) => [ox + d[0] * u + e[0] * v, oz + d[1] * u + e[1] * v],
    fwd: dirName(d), back: dirName([-d[0], -d[1]]), left: dirName([-e[0], -e[1]]), right: dirName(e),
  };
}

// ------------------------------------------------------------------ build list

class Build {
  constructor() {
    this.m = new Map();
    this.cmds = [];
  }
  set(x, y, z, block) {
    this.m.set(`${x},${y},${z}`, ns(block));
  }
  keep(x, y, z, block) {
    if (!this.m.has(`${x},${y},${z}`)) this.set(x, y, z, block);
  }
  get(x, y, z) {
    return this.m.get(`${x},${y},${z}`);
  }
  column(x, z, y1, y2, block) {
    for (let y = y1; y <= y2; y++) this.set(x, y, z, typeof block === 'function' ? block(y) : block);
  }
  cmd(c) {
    this.cmds.push(c);
  }
  /** Ordered list: structure bottom-up, then decorations, then entity commands. */
  list() {
    const out = [];
    for (const [k, block] of this.m) {
      const [x, y, z] = k.split(',').map(Number);
      out.push({ x, y, z, block, decor: DECOR.test(block) });
    }
    withConnections(out);
    out.sort((a, b) => a.decor - b.decor || a.y - b.y || a.x - b.x || a.z - b.z);
    return [...out, ...this.cmds.map((cmd) => ({ cmd }))];
  }
}

const lamp = (b, x, y, z) => {
  b.set(x, y, z, 'stone_brick_wall');
  b.set(x, y + 1, z, 'dark_oak_fence');
  b.set(x, y + 2, z, 'dark_oak_fence');
  b.set(x, y + 3, z, 'lantern[hanging=false]');
};
const flag = (b, x, y, z, h = 5) => {
  for (let k = 0; k < h; k++) b.set(x, y + k, z, 'spruce_fence');
  b.set(x, y + h, z, SWISS_BANNER);
};
const wallStone = (rng) => rng.weighted(WALL_STONES);
const boatCmd = (x, y, z, yaw, wood = 'oak') =>
  `summon minecraft:${wood}_boat ${x + 0.5} ${y} ${z + 0.5} {Tags:["alps","alps_infra","alps_boat"],Invulnerable:1b,Rotation:[${yaw}f,0f]}`;

/** Posts of a deck over water: waterlogged fence below the surface, plain fence above. */
function post(b, x, z, bottom, waterY, deckY) {
  for (let y = bottom + 1; y <= deckY - 1; y++) b.set(x, y, z, y <= waterY ? 'spruce_fence[waterlogged=true]' : 'spruce_fence');
}

// ------------------------------------------------------------------ walks (stairs, ramps, bridge decks)
//
// A walk is a list of points {u, v, b} (b = height of the path block; you walk on b + 1), consecutive points
// 4-adjacent with |db| <= 1. render() lays a 3-wide path along it: where the path climbs, the higher row is
// a stair facing uphill; supports, cuts and side walls follow the natural ground in `ground(u, v)`.

function stepsBetween(b0, b1, len, landingEvery = 5, ends = 2) {
  // Heights for `len` columns from b0 to b1 (`ends` flat columns at each end), a landing after every few steps.
  const rise = b1 - b0;
  const n = Math.abs(rise);
  const s = Math.sign(rise);
  const out = new Array(len).fill(b0);
  if (n === 0) return out;
  const free = len - 2 * ends;
  const landings = Math.max(0, Math.ceil(n / landingEvery) - 1);
  if (n + landings > free) return null;
  const spare = free - n - landings;
  let h = b0, k = ends, made = 0;
  // Spread the spare flat columns between the flights.
  const flights = landings + 1;
  const gap = Math.floor(spare / (flights + 1));
  k += gap;
  for (let i = ends; i < k; i++) out[i] = h;
  for (let f = 0; f < flights; f++) {
    const steps = Math.min(landingEvery, n - made);
    for (let q = 0; q < steps; q++) {
      h += s;
      out[k++] = h;
    }
    made += steps;
    if (f < flights - 1) out[k++] = h; // landing
    const extra = f < flights - 1 ? gap : 0;
    for (let q = 0; q < extra; q++) out[k++] = h;
  }
  while (k < len) out[k++] = h;
  return out;
}

/**
 * A walk across a cell from u = 0 (height b0) to u = uEnd (height b1): one straight flight at v = 10 when
 * the rise fits, else three switchback flights at v = 3, 10, 17 joined by flat landings. null if too steep.
 */
export function laneWalk(b0, b1, uEnd = 20, straightV = 10) {
  const len = uEnd + 1;
  const one = stepsBetween(b0, b1, len);
  if (one) return one.map((b, u) => ({ u, v: straightV, b }));
  // Three flights: forward at v=3, back at v=10, forward at v=17 (each over u = 2..uEnd-2).
  const rise = b1 - b0;
  const parts = [Math.round(rise / 3), Math.round(rise / 3)];
  parts.push(rise - parts[0] - parts[1]);
  const lo = 2, hi = uEnd - 2;
  const walk = [];
  let h = b0;
  for (let u = 0; u < lo; u++) walk.push({ u, v: 3, b: h });
  const flight = (from, to, v, dh) => {
    const n = Math.abs(to - from) + 1;
    const hs = stepsBetween(h, h + dh, n);
    if (!hs) return false;
    for (let q = 0; q < n; q++) walk.push({ u: from + Math.sign(to - from) * q, v, b: hs[q] });
    h += dh;
    return true;
  };
  const turn = (u, v1, v2) => {
    for (let v = v1 + Math.sign(v2 - v1); v !== v2; v += Math.sign(v2 - v1)) walk.push({ u, v, b: h });
  };
  if (!flight(lo, hi, 3, parts[0])) return null;
  turn(hi, 3, 10);
  if (!flight(hi, lo, 10, parts[1])) return null;
  turn(lo, 10, 17);
  if (!flight(lo, hi, 17, parts[2])) return null;
  for (let u = hi + 1; u <= uEnd; u++) walk.push({ u, v: 17, b: h });
  return walk;
}

/**
 * Lays a walk into `b` through frame `f`: path blocks (stairs where it climbs), support under the path down
 * to the ground (`support` block), headroom cut above it, side walls where the slope rises beside it and a
 * low wall as railing where it falls away. `ground(x, z)` -> natural ground height or null.
 */
function render(b, f, walk, ground, rng, { path = 'stone_bricks', stairs = 'stone_brick_stairs', support = null, width = 1, railing = 'stone_brick_wall', clearTo = 3, sideWalls = true } = {}) {
  const cells = new Map(); // "u,v" -> {b, stair facing | null}
  const along = (p, q) => (p.u !== q.u ? 'u' : 'v');
  for (let k = 0; k < walk.length; k++) {
    const p = walk[k];
    const prev = walk[k - 1], next = walk[k + 1];
    const axis = next ? along(p, next) : prev ? along(prev, p) : 'u';
    for (let w = -width; w <= width; w++) {
      const u = axis === 'u' ? p.u : p.u + w;
      const v = axis === 'u' ? p.v + w : p.v;
      const key = `${u},${v}`;
      if (!cells.has(key) || cells.get(key).b < p.b) cells.set(key, { u, v, b: p.b, facing: null });
    }
  }
  // Stairs: the higher of two consecutive points (|db| = 1) faces from the lower towards it.
  for (let k = 1; k < walk.length; k++) {
    const p = walk[k - 1], q = walk[k];
    if (Math.abs(q.b - p.b) !== 1) continue;
    const [hi, lo] = q.b > p.b ? [q, p] : [p, q];
    const [hx, hz] = f.at(hi.u, hi.v), [lx, lz] = f.at(lo.u, lo.v);
    const facing = dirName([Math.sign(hx - lx), Math.sign(hz - lz)]);
    const axis = hi.u !== lo.u ? 'u' : 'v';
    for (let w = -width; w <= width; w++) {
      const u = axis === 'u' ? hi.u : hi.u + w;
      const v = axis === 'u' ? hi.v + w : hi.v;
      const c = cells.get(`${u},${v}`);
      if (c && c.b === hi.b) c.facing = facing;
    }
  }
  for (const c of cells.values()) {
    const [x, z] = f.at(c.u, c.v);
    const g = ground(x, z);
    b.set(x, c.b, z, c.facing ? `${stairs}[facing=${c.facing},half=bottom]` : typeof path === 'function' ? path(rng) : path);
    if (g != null && g < c.b - 1 && support) b.column(x, z, g + 1, c.b - 1, typeof support === 'function' ? () => support(rng) : support);
    for (let y = c.b + 1; y <= Math.max(c.b + clearTo, g ?? c.b); y++) b.keep(x, y, z, 'air');
  }
  // Side walls / railings on the cells beside the path.
  for (const c of cells.values()) {
    for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = `${c.u + du},${c.v + dv}`;
      if (cells.has(key)) continue;
      const [x, z] = f.at(c.u + du, c.v + dv);
      if (b.get(x, c.b, z) && !b.get(x, c.b, z).endsWith(':air')) continue;
      const g = ground(x, z);
      if (g == null) continue;
      if (sideWalls && g > c.b + 1) b.column(x, z, c.b + 1, g, () => wallStone(rng)); // cut face
      else if (railing && g < c.b) {
        if (support) b.column(x, z, g + 1, c.b, () => wallStone(rng));
        b.set(x, c.b + 1, z, railing);
      }
    }
  }
  return cells;
}

/** Opens the street edge of the plots a walk starts and ends at (a lot railing may stand there). */
function openEntries(b, f, walk) {
  const first = walk[0], last = walk[walk.length - 1];
  for (const w of [-1, 0, 1]) {
    const [ax, az] = f.at(-1, first.v + w);
    b.set(ax, first.b + 1, az, 'air');
    if (last.u === 20) {
      const [bx, bz] = f.at(21, last.v + w);
      b.set(bx, last.b + 1, bz, 'air');
    }
  }
}

// ------------------------------------------------------------------ builders: (params, seed) -> Build

const BUILDERS = {
  /** Lake front of a plot: railing or stepped embankment, lamps, benches, a ladder. */
  quay(p, seed) {
    const b = new Build();
    const rng = rngFrom(`${seed}:quay`);
    const [dx, dz] = SIDES[p.side];
    const inward = FACING[OPP[p.side]];
    const outward = FACING[p.side];
    const mid = new Set([9, 10, 11]);
    const gap = new Set(p.pierAt ? [p.pierAt - 1, p.pierAt, p.pierAt + 1] : []);
    for (let k = 1; k <= 19; k++) {
      const [x, z] = p.row[k];
      const strip = p.strips[k]; // [[G, wet, W] for a = 0..]
      const wetAt = strip.findIndex((s) => s[1]);
      if (wetAt < 0) continue;
      const W = strip[wetAt][2];
      if (wetAt <= 1) {
        // Quay wall: face the lot edge with stone down to below the water line.
        for (let y = Math.max(W - 2, p.floor ?? W - 2); y <= p.y - 1; y++) b.set(x, y, z, y <= W - 1 ? 'cobblestone' : wallStone(rng));
        if (k === 10 && !p.steps) {
          const [lx, lz] = [x + dx, z + dz];
          for (let y = W - 2; y <= p.y; y++) b.set(lx, y, lz, `ladder[facing=${outward},waterlogged=${y <= W}]`);
          continue;
        }
      } else {
        // A grass bank between lot and water: pitch it with stone, a flight of steps to the water in the middle.
        let prev = p.y;
        for (let a = 1; a < wetAt; a++) {
          const [G] = strip[a];
          const [ax, az] = [x + dx * a, z + dz * a];
          if (G == null || G > p.y || G < W) break;
          if (mid.has(k) && prev === G + 1) b.set(ax, G, az, `stone_brick_stairs[facing=${inward},half=bottom]`);
          else b.set(ax, G, az, rng.chance(0.2) ? 'mossy_stone_bricks' : mid.has(k) ? 'stone_bricks' : rng.pick(['stone_bricks', 'cobblestone', 'stone_bricks']));
          b.set(ax, G - 1, az, 'stone_bricks');
          b.set(ax, G + 1, az, 'air');
          prev = G;
        }
        if (mid.has(k)) continue;
      }
      if (gap.has(k)) continue; // the pier starts here
      if (k % 6 === 3) lamp(b, x, p.y + 1, z);
      else if (k === 6 || k === 7 || k === 14 || k === 15) b.set(x, p.y + 1, z, `spruce_stairs[facing=${inward},half=bottom]`);
      else if (!(strip[1] && !strip[1][1] && strip[1][0] >= p.y - 1)) b.set(x, p.y + 1, z, 'iron_bars');
    }
    return b;
  },

  /** Jetty: a plank deck on posts, steps down from the quay, a lantern at the head, moored boats. */
  pier(p, seed) {
    const b = new Build();
    const rng = rngFrom(`${seed}:pier`);
    const [dx, dz] = p.dir;
    const [ex, ez] = dx !== 0 ? [0, 1] : [1, 0];
    const len = p.bottoms.length;
    const wood = p.wood ?? 'spruce';
    for (let s = 0; s < len; s++) {
      const stepY = s < p.steps ? p.fromY - 1 - s : p.deckY;
      for (let l = -1; l <= 1; l++) {
        const x = p.start[0] + dx * s + ex * l, z = p.start[1] + dz * s + ez * l;
        const bottom = p.bottoms[s][l + 1];
        if (s < p.steps) b.set(x, stepY, z, `${wood}_stairs[facing=${dirName([-dx, -dz])},half=bottom]`);
        else b.set(x, p.deckY, z, `${wood}_planks`);
        if ((l !== 0 && s % 3 === 1) || (s === len - 1 && l !== 0)) post(b, x, z, bottom, p.waterY, s < p.steps ? stepY : p.deckY);
      }
      if (s >= p.steps && s % 4 === 2 && s < len - 1) b.set(p.start[0] + dx * s + ex * (rng.chance(0.5) ? 1 : -1), p.deckY + 1, p.start[1] + dz * s + ez * (rng.chance(0.5) ? 1 : -1), `${wood}_fence`);
    }
    // Head: lanterns on posts at both corners, a bench looking out.
    const hx = p.start[0] + dx * (len - 1), hz = p.start[1] + dz * (len - 1);
    for (const l of [-1, 1]) {
      b.set(hx + ex * l, p.deckY + 1, hz + ez * l, `${wood}_fence`);
      b.set(hx + ex * l, p.deckY + 2, hz + ez * l, 'lantern[hanging=false]');
    }
    if (!p.tower) b.set(hx - dx, p.deckY + 1, hz - dz, `${wood}_stairs[facing=${dirName([-dx, -dz])},half=bottom]`);
    else {
      // Diving tower of the lido: a frame with a platform and a ladder.
      for (const l of [-1, 1]) for (let y = p.deckY + 1; y <= p.deckY + 3; y++) b.set(hx + ex * l - dx, y, hz + ez * l - dz, `${wood}_fence`);
      for (let l = -1; l <= 1; l++) b.set(hx + ex * l - dx, p.deckY + 4, hz + ez * l - dz, `${wood}_slab[type=bottom]`);
      b.set(hx - dx * 2, p.deckY + 1, hz - dz * 2, `ladder[facing=${dirName([-dx, -dz])}]`);
      b.set(hx - dx * 2, p.deckY + 2, hz - dz * 2, `ladder[facing=${dirName([-dx, -dz])}]`);
      b.set(hx - dx * 2, p.deckY + 3, hz - dz * 2, `ladder[facing=${dirName([-dx, -dz])}]`);
      b.set(hx - dx, p.deckY + 1, hz - dz, 'air');
    }
    if (p.boats) {
      const yaw = dx === 1 ? -90 : dx === -1 ? 90 : dz === 1 ? 0 : 180;
      for (let n = 0; n < p.boats; n++) {
        const s = Math.max(p.steps + 1, len - 2 - n * 3);
        b.cmd(boatCmd(p.start[0] + dx * s + ex * 2 * (n % 2 ? 1 : -1), p.waterY + 0.5, p.start[1] + dz * s + ez * 2 * (n % 2 ? 1 : -1), yaw, rng.pick(['oak', 'spruce', 'birch'])));
      }
    }
    return b;
  },

  /** Lake promenade on a shore cell: a paved path along the water, lamps, benches, linden trees. */
  promenade(p, seed) {
    const b = new Build();
    const rng = rngFrom(`${seed}:promenade`);
    for (const [x, z, G, d, fx, fz] of p.cols) {
      if (d <= 3) {
        b.set(x, G, z, d === 1 ? 'stone_bricks' : (x + z) % 5 === 0 ? 'polished_andesite' : rng.chance(0.15) ? 'mossy_stone_bricks' : 'stone_bricks');
        b.set(x, G - 1, z, 'stone_bricks');
        b.set(x, G + 1, z, 'air');
        b.set(x, G + 2, z, 'air');
        if (d === 1 && G - p.waterY >= 2) b.set(x, G + 1, z, 'stone_brick_wall');
      }
      if (d === 4 && (x * 7 + z * 13) % 11 === 0) {
        b.set(x, G, z, 'grass_block');
        b.set(x, G + 1, z, rng.pick(FLOWERS));
      }
    }
    for (const [x, z, G] of p.lamps) lamp(b, x, G + 1, z);
    for (const [x, z, G, facing] of p.benches) {
      b.set(x, G + 1, z, `spruce_stairs[facing=${facing},half=bottom]`);
    }
    for (const [x, z, G] of p.trees) {
      const h = 4;
      for (let y = 1; y <= h; y++) b.set(x, G + y, z, 'oak_log[axis=y]');
      for (let y = h; y <= h + 2; y++)
        for (let a = -2; a <= 2; a++)
          for (let c = -2; c <= 2; c++) {
            const dd = Math.abs(a) + Math.abs(c) + (y === h + 2 ? 2 : 0);
            if (dd <= 3 && !(a === 0 && c === 0 && y < h + 1)) b.keep(x + a, G + y, z + c, 'oak_leaves[distance=1,persistent=true]');
          }
    }
    return b;
  },

  /** Strandbad: sand, parasols, towels, deck chairs, changing cabins, boats pulled up on the beach. */
  beach(p, seed) {
    const b = new Build();
    const rng = rngFrom(`${seed}:beach`);
    for (const [x, z, G] of p.sand) {
      b.set(x, G, z, 'sand');
      b.set(x, G + 1, z, 'air');
    }
    const colours = ['red', 'white', 'yellow', 'light_blue', 'orange', 'lime'];
    for (const [x, z, G, facing] of p.umbrellas) {
      const c = rng.pick(colours);
      b.set(x, G + 1, z, 'birch_fence');
      b.set(x, G + 2, z, 'birch_fence');
      b.set(x, G + 3, z, `${c}_banner[rotation=${rng.int(0, 15)}]{patterns:[{pattern:"minecraft:stripe_center",color:"white"},{pattern:"minecraft:stripe_top",color:"${rng.pick(colours)}"}]}`);
      const [tx, tz] = facing;
      b.set(x + tx, G + 1, z + tz, `${rng.pick(colours)}_carpet`);
      b.set(x + tx * 2, G + 1, z + tz * 2, `${rng.pick(colours)}_carpet`);
    }
    for (const [x, z, G, facing] of p.chairs) b.set(x, G + 1, z, `birch_stairs[facing=${facing},half=bottom]`);
    if (p.cabins) {
      const { x, z, G, along, back } = p.cabins; // a row of three changing cabins, doors towards the water
      const [ax, az] = along, [bx, bz] = back;
      for (let k = 0; k <= 6; k++)
        for (let d = 0; d <= 2; d++) {
          const cx = x + ax * k + bx * d, cz = z + az * k + bz * d;
          b.set(cx, G, cz, 'spruce_planks');
          const wall = k % 2 === 0 || d === 2;
          for (let y = 1; y <= 2; y++) b.set(cx, G + y, cz, wall ? (k % 4 === 0 ? 'white_terracotta' : 'blue_terracotta') : 'air');
          b.set(cx, G + 3, cz, 'spruce_slab[type=bottom]');
        }
      const doorFacing = dirName([-bx, -bz]);
      for (const k of [1, 3, 5]) {
        const cx = x + ax * k, cz = z + az * k;
        b.set(cx, G + 1, cz, `spruce_door[facing=${doorFacing},half=lower,hinge=left,open=false]`);
        b.set(cx, G + 2, cz, `spruce_door[facing=${doorFacing},half=upper,hinge=left,open=false]`);
      }
      flag(b, x + ax * 7 + bx, G + 1, z + az * 7 + bz, 5);
    }
    for (const [x, z, G, yaw] of p.boats) b.cmd(boatCmd(x, G + 1, z, yaw, rng.pick(['oak', 'spruce', 'birch'])));
    return b;
  },

  /** Harbour: an L-shaped breakwater with lamps and a lighthouse on its head, a steamer landing inside. */
  harbour(p, seed) {
    const b = new Build();
    const rng = rngFrom(`${seed}:harbour`);
    const top = p.waterY + 2;
    for (const [x, z, bottom, outer] of p.mole) {
      for (let y = bottom + 1; y <= top - 1; y++) b.set(x, y, z, y <= p.waterY - 1 ? rng.pick(['cobblestone', 'stone', 'cobblestone', 'mossy_cobblestone']) : wallStone(rng));
      b.set(x, top, z, (x + z) % 3 === 0 ? 'polished_andesite' : 'stone_bricks');
      if (outer) b.set(x, top + 1, z, 'stone_brick_wall');
    }
    for (const [x, z] of p.moleLamps) lamp(b, x, top + 1, z);
    // Lighthouse (fallback until the generators have one): 3x3 tower, red and white bands, lamp room.
    if (p.light) {
      const [lx, lz, bottom] = p.light;
      const h = 9;
      for (let a = -1; a <= 1; a++)
        for (let c = -1; c <= 1; c++) {
          for (let y = bottom + 1; y <= top; y++) b.set(lx + a, y, lz + c, 'stone_bricks');
          const ring = a !== 0 || c !== 0;
          for (let y = top + 1; y <= top + h; y++) b.set(lx + a, y, lz + c, ring ? (Math.floor((y - top - 1) / 2) % 2 ? 'white_concrete' : 'red_concrete') : 'air');
          b.set(lx + a, top + h + 1, lz + c, ring ? 'glass' : 'sea_lantern');
          b.set(lx + a, top + h + 2, lz + c, 'glass');
          b.set(lx + a, top + h + 3, lz + c, 'stone_brick_slab[type=bottom]');
        }
      b.set(lx, top + h + 2, lz, 'sea_lantern');
      b.set(lx, top + h + 4, lz, 'lightning_rod');
      const [ddx, ddz] = p.lightDoor;
      b.set(lx + ddx, top + 1, lz + ddz, `spruce_door[facing=${dirName([ddx, ddz])},half=lower,hinge=left,open=false]`);
      b.set(lx + ddx, top + 2, lz + ddz, `spruce_door[facing=${dirName([ddx, ddz])},half=upper,hinge=left,open=false]`);
      for (let y = top + 1; y <= top + h; y++) b.set(lx, y, lz, `ladder[facing=${dirName([ddx, ddz])}]`); // against the far wall
    }
    // Steamer landing ("Schiffstation") and moored boats.
    if (p.landing) for (const it of BUILDERS.pier(p.landing, `${seed}:landing`).list()) if (it.block) b.set(it.x, it.y, it.z, it.block);
    for (const [x, z, yaw] of p.boats) b.cmd(boatCmd(x, p.waterY + 0.5, z, yaw, rng.pick(['oak', 'spruce', 'birch', 'dark_oak'])));
    return b;
  },

  /** Treppengasse over a steep cell: flights of stone stairs with landings, walls, railings and lamps. */
  lane(p, seed) {
    const b = new Build();
    const rng = rngFrom(`${seed}:lane`);
    const f = frame(p.rect, p.from);
    const ground = (x, z) => p.ground[`${x},${z}`] ?? null;
    const cells = render(b, f, p.walk, ground, rng, { path: () => rng.pick(['stone_bricks', 'stone_bricks', 'cobblestone', 'andesite']), stairs: 'stone_brick_stairs', support: (r) => wallStone(r) });
    openEntries(b, f, p.walk);
    // Lamps beside every landing where the walk turns or rests, at most every 6 points.
    let last = -99;
    p.walk.forEach((w, k) => {
      const nxt = p.walk[k + 1];
      if (!nxt || nxt.b !== w.b || k - last < 6) return;
      for (const [du, dv] of [[0, 2], [0, -2], [2, 0], [-2, 0]]) {
        if (cells.has(`${w.u + du},${w.v + dv}`)) continue;
        const [x, z] = f.at(w.u + du, w.v + dv);
        const g = ground(x, z);
        if (g == null || Math.abs(g - w.b) > 1) continue;
        lamp(b, x, w.b + 1, z);
        last = k;
        break;
      }
    });
    return b;
  },

  /** Viewpoint at a cliff edge: a plank deck on posts, railing, bench, Swiss flag, a spyglass, a sign. */
  viewpoint(p, seed) {
    const b = new Build();
    const rng = rngFrom(`${seed}:viewpoint`);
    const f = frame(p.rect, p.from);
    const ground = (x, z) => p.ground[`${x},${z}`] ?? null;
    if (p.walk) render(b, f, p.walk, ground, rng, { support: (r) => wallStone(r) });
    openEntries(b, f, p.walk ?? [{ u: 0, v: 10, b: p.y }]);
    const { u0, y } = p;
    for (let u = u0; u <= u0 + 4; u++)
      for (let v = 7; v <= 13; v++) {
        const [x, z] = f.at(u, v);
        b.set(x, y, z, 'spruce_planks');
        for (let yy = y + 1; yy <= y + 3; yy++) b.keep(x, yy, z, 'air');
        const g = ground(x, z);
        if (g != null && g < y - 1 && (u === u0 + 4 || u === u0 + 2 || u === u0) && (v === 7 || v === 13 || v === 10)) b.column(x, z, g + 1, y - 1, 'spruce_log[axis=y]');
        const rim = u === u0 + 4 || v === 7 || v === 13;
        if (rim && !(u === u0 && (v === 7 || v === 13))) b.set(x, y + 1, z, 'spruce_fence');
      }
    const [fx, fz] = f.at(u0 + 3, 8);
    flag(b, fx, y + 1, fz, 4);
    for (let v = 9; v <= 11; v++) {
      const [x, z] = f.at(u0 + 3, v);
      b.set(x, y + 1, z, `spruce_stairs[facing=${f.back},half=bottom]`);
    }
    const [sx, sz] = f.at(u0 + 3, 12);
    b.set(sx, y + 1, sz, 'spruce_fence');
    b.cmd(`summon minecraft:item_display ${sx + 0.5} ${y + 2.15} ${sz + 0.5} {Tags:["alps","alps_infra"],item:{id:"minecraft:spyglass",count:1},transformation:{left_rotation:[0f,0f,0.38f,0.92f],right_rotation:[0f,0f,0f,1f],translation:[0f,0f,0f],scale:[0.8f,0.8f,0.8f]}}`);
    const [gx, gz] = f.at(u0, 10);
    const line = (s) => JSON.stringify(String(s).slice(0, 15));
    b.set(gx, y + 1, gz, `spruce_sign[rotation=${{ south: 0, west: 4, north: 8, east: 12 }[f.back]}]{front_text:{messages:[${line(p.title)},${line(p.sub ?? '')},${line(p.peak ?? '')},""]}}`);
    return b;
  },

  /** Bridge over a river: stone arch, covered wooden bridge with flower boxes and a water tower, or viaduct. */
  bridge(p, seed) {
    const b = new Build();
    const rng = rngFrom(`${seed}:bridge`);
    const f = frame(p.rect, p.from);
    const ground = (x, z) => p.ground[`${x},${z}`] ?? null;
    const water = (x, z) => p.water[`${x},${z}`] ?? null;
    const deckOf = (u) => p.walk.find((w) => w.u === u)?.b;
    const kind = p.kind;
    const mat = kind === 'covered' ? { path: 'spruce_planks', stairs: 'spruce_stairs' } : { path: () => rng.pick(['stone_bricks', 'stone_bricks', 'polished_andesite']), stairs: 'stone_brick_stairs' };
    render(b, f, p.walk, ground, rng, { ...mat, support: (r) => wallStone(r), railing: null, sideWalls: false, clearTo: kind === 'covered' ? 4 : 3 });
    openEntries(b, f, p.walk);
    const Y = p.deckY;
    const [s1, s2] = p.span;
    for (let u = 0; u <= 20; u++) {
      const by = deckOf(u);
      if (by == null) continue;
      for (const v of [8, 12]) {
        const [x, z] = f.at(u, v);
        const g = ground(x, z), w = water(x, z);
        const bottom = g ?? by - 1;
        const over = w != null;
        // Parapets.
        if (kind === 'covered') {
          b.set(x, by, z, 'spruce_planks');
          if (over || u >= s1 - 1) {
            b.set(x, by + 1, z, 'spruce_fence');
            if (u % 2 === 0) b.set(x, by + 2, z, rng.pick(['potted_red_tulip', 'potted_poppy', 'potted_orange_tulip', 'potted_azure_bluet']));
          }
        } else {
          b.set(x, by, z, 'stone_bricks');
          b.set(x, by + 1, z, 'stone_brick_wall');
        }
        if (!over && bottom < by - 1) b.column(x, z, bottom + 1, by - 1, () => wallStone(rng));
      }
    }
    // Spans: the river gets an arch (stone), trestle piers (covered) or tall arches (viaduct).
    const piers = kind === 'arch' ? [] : [];
    if (kind === 'covered') for (let u = s1 + 4; u <= s2 - 3; u += 5) piers.push(u);
    if (kind === 'viaduct') for (let u = s1 + 6; u <= s2 - 5; u += 7) piers.push(u);
    const bays = [s1 - 1, ...piers, s2 + 1];
    for (let q = 0; q + 1 < bays.length; q++) {
      const a = bays[q], c = bays[q + 1];
      const L = c - a - 1;
      let bayMin = Infinity;
      for (let u = a + 1; u < c; u++) bayMin = Math.min(bayMin, deckOf(u) ?? Y);
      for (let u = a + 1; u < c; u++) {
        if (kind === 'covered') continue;
        const tt = (u - a) / (c - a);
        const springY = (p.waterY ?? Y - 4) + 1;
        const rise = Math.max(0, bayMin - 2 - springY);
        const soffit = springY + Math.round(rise * Math.sin(Math.PI * tt) ** 0.6);
        for (let v = 8; v <= 12; v++) {
          const [x, z] = f.at(u, v);
          for (let y = soffit; y <= (deckOf(u) ?? Y) - 1; y++) b.set(x, y, z, wallStone(rng));
          void L;
        }
      }
    }
    for (const u of [s1 - 1, ...piers, s2 + 1]) {
      for (let v = 8; v <= 12; v++) {
        const [x, z] = f.at(u, v);
        const g = ground(x, z);
        if (g == null) continue;
        const pierBlock = kind === 'covered' ? 'stone_bricks' : null;
        b.column(x, z, g + 1, (deckOf(u) ?? Y) - 1, pierBlock ? (y) => (y <= (water(x, z) ?? -999) ? 'cobblestone' : pierBlock) : () => wallStone(rng));
      }
    }
    if (kind === 'covered') {
      // Roof on posts: a pitched spruce roof over the whole span, flower boxes on the rails.
      for (let u = s1 - 1; u <= s2 + 1; u++) {
        const by = deckOf(u) ?? Y;
        for (const v of [8, 12]) {
          const [x, z] = f.at(u, v);
          if ((u - s1) % 3 === 0) for (let y = by + 1; y <= by + 3; y++) b.set(x, y, z, 'stripped_spruce_log[axis=y]');
          b.set(x, by + 4, z, `spruce_stairs[facing=${v === 8 ? f.left : f.right},half=bottom]`);
        }
        for (const v of [9, 11]) {
          const [x, z] = f.at(u, v);
          b.set(x, by + 4, z, 'spruce_planks');
          b.set(x, by + 5, z, `spruce_stairs[facing=${v === 9 ? f.left : f.right},half=bottom]`);
        }
        const [cx, cz] = f.at(u, 10);
        b.set(cx, by + 5, cz, 'spruce_planks');
        b.set(cx, by + 6, cz, 'spruce_slab[type=bottom]');
        if ((u - s1) % 6 === 3) b.set(cx, by + 4, cz, 'lantern[hanging=true]');
      }
      // Wasserturm: an octagonal stone tower beside the middle of the bridge.
      const um = Math.round((s1 + s2) / 2);
      const [tx, tz] = f.at(um, 15);
      const g = ground(tx, tz) ?? (p.waterY ?? Y) - 3;
      const towerTop = Y + 8;
      for (let a = -2; a <= 2; a++)
        for (let c = -2; c <= 2; c++) {
          if (Math.abs(a) === 2 && Math.abs(c) === 2) continue;
          const ring = Math.abs(a) === 2 || Math.abs(c) === 2 || (Math.abs(a) === 1 && Math.abs(c) === 1 && false);
          for (let y = g - 0; y <= towerTop; y++) {
            const gg = ground(tx + a, tz + c) ?? g;
            if (y <= gg) continue;
            b.set(tx + a, y, tz + c, ring || y <= (p.waterY ?? Y) ? (y % 4 === 0 ? 'mossy_stone_bricks' : 'stone_bricks') : 'air');
          }
          const d = Math.max(Math.abs(a), Math.abs(c));
          b.set(tx + a, towerTop + 1 + (2 - d), tz + c, d === 0 ? 'dark_oak_planks' : 'dark_oak_slab[type=bottom]');
          for (let y = towerTop + 1; y < towerTop + 1 + (2 - d); y++) b.set(tx + a, y, tz + c, 'dark_oak_planks');
        }
      b.set(tx, towerTop + 4, tz, 'lightning_rod');
      for (const [a, c] of [[0, -2], [2, 0], [0, 2], [-2, 0]]) b.set(tx + a, Y + 5, tz + c, 'iron_bars');
    } else {
      for (const u of [s1 - 2, s2 + 2]) {
        const by = deckOf(u);
        if (by == null) continue;
        for (const v of [8, 12]) {
          const [x, z] = f.at(u, v);
          b.set(x, by + 1, z, 'stone_brick_wall');
          b.set(x, by + 2, z, 'dark_oak_fence');
          b.set(x, by + 3, z, 'lantern[hanging=false]');
        }
      }
    }
    return b;
  },
};

// Version of the builders: finished pieces are re-applied (additively) when it changes.
export const INFRA_VERSION = (() => {
  let h = 2166136261;
  const src = Object.values(BUILDERS).map(String).join('\n') + render + laneWalk + stepsBetween + lamp + flag + post + openEntries;
  for (let i = 0; i < src.length; i++) h = Math.imul(h ^ src.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
})();

const listCache = new Map();
/** World-coordinate build list of an infra record ({x, y, z, block} entries and {cmd} entity commands). */
export function infraList(rec) {
  const k = `${rec.id}:${INFRA_VERSION}`;
  if (!listCache.has(k)) {
    const make = BUILDERS[rec.type];
    listCache.set(k, make ? make(rec.params, rec.seed).list() : []);
  }
  return listCache.get(k);
}

export const infraLabel = (rec) => t(`infra.type.${rec.type === 'bridge' ? `bridge.${rec.params?.kind ?? 'arch'}` : rec.type}`);

// ------------------------------------------------------------------ planning

/** state.terrain, created on first use. */
export function terrainState(state) {
  state.terrain ??= {};
  const T = state.terrain;
  T.infra ??= {};
  T.reserved ??= {};
  T.nextId ??= 0;
  T.anchors ??= { harbours: [], piers: [], bridges: [], beaches: [] };
  return T;
}

const ckey = ([i, j]) => `${i},${j}`;

function addRecord(state, type, cell, params, { reserve = null, label = null, renovation = false } = {}) {
  const T = terrainState(state);
  const id = String(++T.nextId);
  const rec = { id, type, cell, seed: `infra:${id}:${type}`, params, placed: 0, done: false, created: Date.now() };
  if (renovation) rec.renovation = true;
  if (label) rec.label = label;
  rec.rect = recordRect(rec);
  rec.total = infraList(rec).length;
  T.infra[id] = rec;
  if (reserve) T.reserved[ckey(reserve)] = { role: type, infra: id };
  return rec;
}

/** Bounding rectangle of a record's blocks (for chunk loading). */
function recordRect(rec) {
  let x1 = Infinity, z1 = Infinity, x2 = -Infinity, z2 = -Infinity;
  for (const b of infraList(rec)) {
    if (b.cmd) continue;
    if (b.x < x1) x1 = b.x;
    if (b.x > x2) x2 = b.x;
    if (b.z < z1) z1 = b.z;
    if (b.z > z2) z2 = b.z;
  }
  return Number.isFinite(x1) ? { x1, z1, x2, z2 } : null;
}

/** Row 0 (outermost street row) of a plot on `side`, k = 0..20 along it. */
function edgeRow(r, side) {
  const out = [];
  for (let k = 0; k <= 20; k++) {
    if (side === 'N') out.push([r.x1 + k, r.z1]);
    else if (side === 'S') out.push([r.x1 + k, r.z2]);
    else if (side === 'W') out.push([r.x1, r.z1 + k]);
    else out.push([r.x2, r.z1 + k]);
  }
  return out;
}

const plotRectOf = (planner, plot) => planner.cellRect(plot.cell);
const hasInfra = (state, pred) => Object.values(terrainState(state).infra).some(pred);
const cheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

/** Measures the water side of a plot; returns quay params or null when the water is not close to the edge. */
function measureQuay(planner, plot, side) {
  const r = plotRectOf(planner, plot);
  const row = edgeRow(r, side);
  const [dx, dz] = SIDES[side];
  const strips = [];
  let near = 0;
  const ws = [];
  for (let k = 0; k <= 20; k++) {
    const [x, z] = row[k];
    const strip = [];
    for (let a = 0; a <= 8; a++) {
      const c = planner.col(x + dx * a, z + dz * a);
      if (!c) {
        strip.push([null, 0, null]);
        break;
      }
      strip.push([c.wet ? c.G : c.G, c.wet ? 1 : 0, c.wet ? c.W : null]);
      if (c.wet) {
        ws.push(c.W);
        if (a <= 3) near++;
        break;
      }
    }
    strips.push(strip);
  }
  if (near < 5) return null;
  ws.sort((a, b) => a - b);
  const waterY = ws[ws.length >> 1];
  if (plot.y - waterY > 9 || plot.y <= waterY) return null;
  // The row itself was water before the lot was built: the lot edge is a quay wall already (adaptiveOps).
  return { plot: plot.key, side, y: plot.y, waterY, row, strips, steps: strips.slice(9, 12).every((s) => s.findIndex((q) => q[1]) >= 2) };
}

/** A jetty from the middle of a quay (or from the water's edge of a bank) out to depth >= 3, max 12 long. */
function measurePier(planner, from, dir, fromY, { maxLen = 12, minLen = 4, tower = false, boats = 2 } = {}) {
  const [dx, dz] = dir;
  const [ex, ez] = dx !== 0 ? [0, 1] : [1, 0];
  let [x, z] = from;
  // Walk out over the bank to the first water column.
  let start = null;
  for (let a = 1; a <= 9; a++) {
    const c = planner.col(x + dx * a, z + dz * a);
    if (!c) return null;
    if (c.wet) {
      start = [x + dx * a, z + dz * a, c.W];
      break;
    }
    fromY = Math.min(fromY, c.G); // over a bank the jetty starts at the water's edge
  }
  if (!start) return null;
  const waterY = start[2];
  const bottoms = [];
  for (let s = 0; s < maxLen; s++) {
    const row = [];
    for (let l = -1; l <= 1; l++) {
      const c = planner.col(start[0] + dx * s + ex * l, start[1] + dz * s + ez * l);
      if (!c || !c.wet) return bottoms.length >= minLen ? done() : null;
      row.push(c.G);
    }
    bottoms.push(row);
    if (bottoms.length >= minLen + 2 && waterY - Math.min(...row) >= 4) break;
  }
  return done();
  function done() {
    const deckY = Math.max(waterY + 1, fromY - 6);
    const steps = Math.max(0, fromY - deckY);
    if (bottoms.length < Math.max(minLen, steps + 2)) return null;
    return { start: [start[0], start[1]], dir, waterY, deckY, fromY, steps, bottoms, tower, boats };
  }
}

/** Shore cell next to the town: promenade along the water, or a lido where the bank is sandy and low. */
function measureShore(planner, cell) {
  const c = planner.cell(cell);
  const r = planner.cellRect(cell);
  const cols = [];
  const ws = [];
  let sand = 0, low = 0, land = 0;
  for (let z = r.z1; z <= r.z2; z++)
    for (let x = r.x1; x <= r.x2; x++) {
      const q = planner.col(x, z);
      if (!q) continue;
      if (q.wet) {
        ws.push(q.W);
        continue;
      }
      land++;
      if (q.kind === 3) sand++; // KIND sand
      if (q.shore >= 1 && q.shore <= 8) cols.push([x, z, q.G, q.shore]);
    }
  if (!ws.length || cols.length < 20) return null;
  ws.sort((a, b) => a - b);
  const waterY = ws[ws.length >> 1];
  for (const [, , G, d] of cols) if (d <= 5 && G <= waterY + 3) low++;
  const beach = (sand >= land * 0.2 || c?.use === 'beach') && low >= 25;
  return { r, cols, waterY, beach };
}

function promenadeParams(planner, cell, m) {
  const rng = rngFrom(`promenade:${cell}`);
  const cols = m.cols.filter(([, , G, d]) => d <= 4 && G >= m.waterY && G <= m.waterY + 6).map(([x, z, G, d]) => [x, z, G, d, 0, 0]);
  const lamps = [], benches = [], trees = [];
  const far = (list, x, z, dmin) => list.every(([a, b]) => Math.hypot(a - x, b - z) >= dmin);
  for (const [x, z, G, d] of cols) {
    if (d === 2 && far(lamps, x, z, 7) && rng.chance(0.5)) lamps.push([x, z, G]);
  }
  for (const [x, z, G, d] of cols) {
    if (d !== 3 || !far(benches, x, z, 6) || !far(lamps, x, z, 2)) continue;
    // Face the nearest water.
    let best = null;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let a = 1; a <= 4; a++) {
        const q = planner.col(x + dx * a, z + dz * a);
        if (q?.wet) {
          if (!best || a < best.a) best = { a, dx, dz };
          break;
        }
      }
    }
    if (best) benches.push([x, z, G, dirName([-best.dx, -best.dz])]);
  }
  for (const [x, z, G, d] of m.cols) {
    if (d < 5 || d > 7 || !far(trees, x, z, 8) || !far(lamps, x, z, 3)) continue;
    const q = planner.col(x, z);
    if (q && !q.tree && x - m.r.x1 >= 2 && m.r.x2 - x >= 2 && z - m.r.z1 >= 2 && m.r.z2 - z >= 2) trees.push([x, z, G]);
  }
  return { cell, waterY: m.waterY, cols, lamps, benches, trees };
}

function beachParams(planner, cell, m) {
  const rng = rngFrom(`beach:${cell}`);
  const sand = m.cols.filter(([, , G, d]) => d <= 6 && G <= m.waterY + 3 && G >= m.waterY - 1).map(([x, z, G]) => [x, z, G]);
  const umbrellas = [], chairs = [], boats = [];
  const far = (list, x, z, dmin) => list.every(([a, b]) => Math.hypot(a - x, b - z) >= dmin);
  const toWater = (x, z) => {
    for (let a = 1; a <= 6; a++)
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (planner.col(x + dx * a, z + dz * a)?.wet) return [dx, dz];
    return [0, 1];
  };
  for (const [x, z, G, d] of m.cols) {
    if (d >= 2 && d <= 4 && G <= m.waterY + 3 && far(umbrellas, x, z, 5) && rng.chance(0.6)) {
      const [dx, dz] = toWater(x, z);
      umbrellas.push([x, z, G, [dz !== 0 ? 1 : 0, dx !== 0 ? 1 : 0]]); // towels beside the parasol, along the shore
      chairs.push([x - dx, z - dz, G, dirName([-dx, -dz])]);
    }
  }
  for (const [x, z, G, d] of m.cols) if (d === 1 && G <= m.waterY + 1 && far(boats, x, z, 6) && boats.length < 2 && far(umbrellas, x, z, 3)) boats.push([x, z, G, rng.int(0, 3) * 90]);
  // Cabins: the first straight stretch of land 6..9 from the water.
  let cabins = null;
  for (const [x, z, G, d] of m.cols) {
    if (d < 6 || d > 9 || cabins) continue;
    const [dx, dz] = toWater(x, z);
    const along = dx !== 0 ? [0, 1] : [1, 0];
    const back = [-dx, -dz];
    let ok = true;
    for (let k = 0; k <= 7 && ok; k++)
      for (let q = 0; q <= 2 && ok; q++) {
        const c = planner.col(x + along[0] * k + back[0] * q, z + along[1] * k + back[1] * q);
        const cx = x + along[0] * k + back[0] * q, cz = z + along[1] * k + back[1] * q;
        if (!c || c.wet || c.G !== G || c.tree || cx < m.r.x1 + 1 || cx > m.r.x2 - 1 || cz < m.r.z1 + 1 || cz > m.r.z2 - 1) ok = false;
      }
    if (ok) cabins = { x, z, G, along, back };
  }
  return { cell, waterY: m.waterY, sand, umbrellas, chairs, boats, cabins };
}

/** Ground heights of a cell (plus 1 block around) for lanes, viewpoints and bridges. */
function groundMap(planner, r, pad = 1) {
  const g = {};
  const w = {};
  for (let z = r.z1 - pad; z <= r.z2 + pad; z++)
    for (let x = r.x1 - pad; x <= r.x2 + pad; x++) {
      const c = planner.col(x, z);
      if (!c) continue;
      g[`${x},${z}`] = c.G;
      if (c.wet) w[`${x},${z}`] = c.W;
    }
  return { g, w };
}

/** Stair lane over cell `via` from plot A (on side `from` of it) to plot B on the opposite side. */
function laneParams(planner, via, a, bPlot) {
  const from = sideOf([a.cell[0] - via[0], a.cell[1] - via[1]]);
  const r = planner.cellRect(via);
  const walk = laneWalk(a.y, bPlot.y);
  if (!walk) return null;
  return { rect: r, from, walk, ground: groundMap(planner, r).g, a: a.key, b: bPlot.key };
}

/** Viewpoint on a cliff cell next to plot P: a deck at street level, or a stair up to the top. */
function viewpointParams(planner, cell, plot, state) {
  const from = sideOf([plot.cell[0] - cell[0], plot.cell[1] - cell[1]]);
  const r = planner.cellRect(cell);
  const f = frame(r, from);
  const { g } = groundMap(planner, r);
  let sum = 0, n = 0, wet = 0;
  for (let u = 0; u <= 5; u++)
    for (let v = 7; v <= 13; v++) {
      const [x, z] = f.at(u, v);
      const c = planner.col(x, z);
      if (!c) continue;
      if (c.wet) wet++;
      sum += c.G;
      n++;
    }
  if (!n) return null;
  const mean = sum / n;
  const peak = state.city?.peaks?.[0];
  const titles = { title: t('infra.viewpoint.sign'), sub: state.city?.name ?? '', peak: peak ? t('infra.viewpoint.peak', { y: peak.y }) : '' };
  if (mean <= plot.y + 1) return { rect: r, from, ground: g, u0: 0, y: plot.y, ...titles };
  // The cliff rises: a stair lane up to a deck near the top.
  let best = null;
  for (let u = 8; u <= 14; u++) {
    const [x, z] = f.at(u, 10);
    const c = planner.col(x, z);
    if (c && !c.wet && (!best || c.G > best.G)) best = { u, G: c.G };
  }
  if (!best || best.G - plot.y > 40) return null;
  const walk = laneWalk(plot.y, best.G, best.u - 1);
  if (!walk) return null;
  const last = walk[walk.length - 1];
  return { rect: r, from, ground: g, walk, u0: best.u, y: last.b, ...titles };
}

/** Bridge over the river cell `via` between plots A and B. */
function bridgeParams(planner, via, a, bPlot) {
  const from = sideOf([a.cell[0] - via[0], a.cell[1] - via[1]]);
  const r = planner.cellRect(via);
  const f = frame(r, from);
  const { g, w } = groundMap(planner, r);
  let s1 = null, s2 = null, waterY = null, deepest = Infinity;
  for (let u = 0; u <= 20; u++) {
    const [x, z] = f.at(u, 10);
    if (w[`${x},${z}`] != null) {
      if (s1 == null) s1 = u;
      s2 = u;
      waterY = w[`${x},${z}`];
      deepest = Math.min(deepest, g[`${x},${z}`]);
    }
  }
  if (s1 == null) return null;
  s1 = Math.max(2, s1);
  s2 = Math.min(18, s2);
  if (s2 - s1 < 2) return null; // no real river across the axis
  const span = s2 - s1 + 1;
  const relief = planner.cell(via)?.relief ?? 0;
  const kind = relief >= 12 && waterY - deepest >= 4 ? 'viaduct' : span <= 12 ? 'arch' : 'covered';
  const deckY = Math.max(a.y, bPlot.y, waterY + (kind === 'arch' ? 3 : 4));
  // Stairs up from A's street to the deck and down to B's (on the banks or, if needed, on the deck itself).
  const need = (h) => (h === 0 ? 0 : Math.abs(h) + Math.max(0, Math.ceil(Math.abs(h) / 6) - 1) + 2);
  const L1 = need(deckY - a.y), L2 = need(deckY - bPlot.y);
  if (L1 + L2 > 21) return null;
  const up = L1 ? stepsBetween(a.y, deckY, L1, 6, 1) : [];
  const down = L2 ? stepsBetween(deckY, bPlot.y, L2, 6, 1) : [];
  if (!up || !down) return null;
  const walk = [];
  for (let u = 0; u <= 20; u++) walk.push({ u, v: 10, b: u < L1 ? up[u] : u > 20 - L2 ? down[u - (21 - L2)] : deckY });
  return { rect: r, from, kind, walk, deckY, span: [s1, s2], waterY, ground: g, water: w, a: a.key, b: bPlot.key };
}

/** Harbour in front of shoreline cell `site`: basin in the water cell beside it. */
function harbourParams(planner, site, state) {
  const options = [];
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = planner.cell([site.i + dx, site.j + dz]);
    if (!n || n.cls !== 'water' || ['river', 'pond'].includes(n.waterType) || terrainState(state).reserved[ckey([n.i, n.j])]) continue;
    options.push({ n, d: [dx, dz] });
  }
  options.sort((a, b) => b.n.maxDepth - a.n.maxDepth);
  for (const o of options) {
    const p = harbourInto(planner, o);
    if (p) return p;
  }
  return null;
}

function harbourInto(planner, best) {
  const wcell = [best.n.i, best.n.j];
  const from = sideOf([-best.d[0], -best.d[1]]); // the shore is on this side of the water cell
  const r = planner.cellRect(wcell);
  const f = frame(r, from);
  const col = (u, v) => planner.col(...f.at(u, v));
  const ws = [];
  for (let u = 0; u <= 20; u++) for (let v = 0; v <= 20; v++) { const c = col(u, v); if (c?.wet) ws.push(c.W); }
  if (ws.length < 380) return null; // the basin cell must be (nearly) all water
  ws.sort((a, b) => a - b);
  const waterY = ws[ws.length >> 1];
  // A real bay of a big lake or the sea, with open water beyond the breakwater's mouth.
  const body = planner.bodyAt(...f.at(10, 10));
  if (!body || body.area < 2500 || !['lake', 'ocean'].includes(body.type)) return null;
  let shut = 0;
  for (let u = 12; u <= 20; u++) for (let v = 15; v <= 20; v++) if (!col(u, v)?.wet) shut++;
  if (shut > 3) return null;
  let dry = 0;
  for (let u = 0; u <= 14; u++) if (!col(u, 1)?.wet) dry++;
  if (dry > 3) return null;
  // Breakwater: out along v = 1..2, then across at u = 13..14 towards v = 14; a mouth beyond.
  const mole = [];
  const take = (u, v, outer) => {
    const c = col(u, v);
    if (!c) return false;
    if (!c.wet) return true; // runs onto land: fine, just no block needed
    if (waterY - c.G > 14) return false;
    const [x, z] = f.at(u, v);
    mole.push([x, z, c.G, outer]);
    return true;
  };
  for (let u = 0; u <= 14; u++) for (const v of [1, 2]) if (!take(u, v, v === 1)) return null;
  for (let v = 3; v <= 14; v++) for (const u of [13, 14]) if (!take(u, v, u === 14)) return null;
  const moleLamps = [];
  for (const u of [4, 9]) moleLamps.push(f.at(u, 2));
  const [lx, lz] = f.at(14, 15);
  const lc = col(14, 15);
  const light = lc ? [lx, lz, lc.G] : null;
  const lightDoor = f.d.map((x) => -x); // door towards the land
  // Steamer landing in the basin, from the shore at v = 9.
  const [sx, sz] = f.at(0, 9);
  const shoreSide = planner.col(sx - f.d[0], sz - f.d[1]);
  const landing = measurePier(planner, [sx - f.d[0], sz - f.d[1]], f.d, Math.max(waterY + 1, shoreSide && !shoreSide.wet ? shoreSide.G : waterY + 1), { maxLen: 9, minLen: 5, boats: 0 });
  if (landing) landing.wood = 'spruce';
  const boats = [];
  for (const [u, v] of [[6, 6], [9, 12], [4, 13]]) {
    const c = col(u, v);
    if (c?.wet) boats.push([...f.at(u, v), [0, 90, 180, 270][(u + v) % 4]]);
  }
  const berth = landing ? [landing.start[0] + f.d[0] * (landing.bottoms.length - 1), landing.deckY + 1, landing.start[1] + f.d[1] * (landing.bottoms.length - 1)] : null;
  const [mx, mz] = f.at(14, 18);
  const b1 = f.at(3, 4), b2 = f.at(12, 13);
  return {
    wcell, from, waterY, mole, moleLamps, light, lightDoor, landing, boats,
    anchors: { mouth: [mx, waterY, mz], berth, basin: { x1: Math.min(b1[0], b2[0]), z1: Math.min(b1[1], b2[1]), x2: Math.max(b1[0], b2[0]), z2: Math.max(b1[1], b2[1]) }, light: light ? [lx, waterY + 13, lz] : null },
  };
}

/**
 * Plans the infrastructure around a freshly created plot. `on(id)` tells which features are enabled
 * ('waterfront', 'river-bridges', 'adaptive-terrain'); `hop` is { via, viaKind, from } when the plot was
 * reached over a steep cell or a river. Returns the new records.
 */
export function planAfterPlot({ planner, state, on, log }, plot, hop = null) {
  const T = terrainState(state);
  const made = [];
  const add = (...a) => {
    const rec = addRecord(state, ...a);
    made.push(rec);
    log?.(`Infra ${rec.id}: ${rec.type} at cell ${ckey(rec.cell)} (${rec.total} blocks)`);
    return rec;
  };
  const occupied = (c) => !!state.cells[ckey(c)] || !!T.reserved[ckey(c)];
  // The crossing that connected this plot.
  if (hop?.via) {
    const fromPlot = state.plots[ckey(hop.from)];
    if (fromPlot && !occupied(hop.via)) {
      if (hop.viaKind === 'bridge' && on('river-bridges')) {
        const p = bridgeParams(planner, hop.via, fromPlot, plot);
        if (p) add('bridge', hop.via, p, { reserve: hop.via });
      } else if (hop.viaKind === 'stairs' && on('adaptive-terrain')) {
        const p = laneParams(planner, hop.via, fromPlot, plot);
        if (p) add('lane', hop.via, p, { reserve: hop.via });
      }
    }
  }
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = [plot.cell[0] + dx, plot.cell[1] + dz];
    const side = sideOf([dx, dz]);
    const c = planner.cell(n);
    if (!c) continue;
    if (on('waterfront') && !hasInfra(state, (r) => r.type === 'quay' && r.params.plot === plot.key && r.params.side === side)) {
      const q = measureQuay(planner, plot, side);
      if (q) {
        const lake = c.cls === 'water' && c.waterType !== 'river';
        let pier = null;
        if (lake && !hasInfra(state, (r) => r.type === 'pier' && cheb(r.cell, n) <= 1)) {
          q.pierAt = q.steps ? 10 : 14;
          pier = measurePier(planner, q.row[q.pierAt], SIDES[side], plot.y);
          if (!pier) delete q.pierAt;
        }
        add('quay', plot.cell, q);
        if (pier) add('pier', n, pier);
      }
    }
    if (occupied(n)) continue;
    if (on('waterfront') && c.cls === 'shoreline' && !Number.isFinite(planner.houseCost(n))) {
      const m = measureShore(planner, n);
      if (m?.beach && !hasInfra(state, (r) => r.type === 'beach' && cheb(r.cell, n) <= 4)) {
        const p = beachParams(planner, n, m);
        // A lido gets a diving jetty.
        const out = p.umbrellas[0] ?? p.sand[0];
        if (out) {
          for (const [ddx, ddz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const jetty = measurePier(planner, [out[0], out[1]], [ddx, ddz], out[2] ?? m.waterY + 1, { maxLen: 9, minLen: 4, tower: true, boats: 0 });
            if (jetty) {
              add('pier', n, jetty);
              break;
            }
          }
        }
        add('beach', n, p, { reserve: n });
      } else if (m) add('promenade', n, promenadeParams(planner, n, m), { reserve: n });
    } else if (on('adaptive-terrain') && c.cls === 'cliff' && !hasInfra(state, (r) => r.type === 'viewpoint' && cheb(r.cell, n) <= 3)) {
      const p = viewpointParams(planner, n, plot, state);
      if (p) add('viewpoint', n, p, { reserve: n });
    }
  }
  planConnections({ planner, state, on }, add);
  if (on('waterfront')) made.push(...planHarbour({ planner, state, log }, add));
  return made;
}

/**
 * Connects town plots that face each other across one unbuildable cell: a bridge over a river cell, a
 * stair lane over a steep or cliff cell (only where the levels differ, else the plots are fine as they are).
 * Bridges keep 3 cells apart, lanes 2; at most `max` new crossings per call.
 */
function planConnections({ planner, state, on }, add, max = 2) {
  const T = terrainState(state);
  let made = 0;
  for (const a of Object.values(state.plots)) {
    for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      if (made >= max) return;
      const n = [a.cell[0] + dx, a.cell[1] + dz];
      const b = state.plots[state.cells[ckey([a.cell[0] + 2 * dx, a.cell[1] + 2 * dz])]];
      if (!b || state.cells[ckey(n)] || T.reserved[ckey(n)]) continue;
      if (a.key > b.key) continue; // each pair once
      const kind = planner.hop(n);
      if (kind === 'bridge' && on('river-bridges') && !hasInfra(state, (r) => r.type === 'bridge' && cheb(r.cell, n) <= 2)) {
        const p = bridgeParams(planner, n, a, b);
        if (p) {
          add('bridge', n, p, { reserve: n });
          made++;
        }
      } else if (kind === 'stairs' && on('adaptive-terrain') && Math.abs(a.y - b.y) >= 2 && !hasInfra(state, (r) => r.type === 'lane' && cheb(r.cell, n) <= 1)) {
        const p = laneParams(planner, n, a, b);
        if (p) {
          add('lane', n, p, { reserve: n });
          made++;
        }
      }
    }
  }
}

/** The harbour, once: at the best harbour site within 2 cells of the town (after a few plots). */
function planHarbour({ planner, state }, add) {
  const T = terrainState(state);
  if (hasInfra(state, (r) => r.type === 'harbour') || Object.keys(state.plots).length < 4) return [];
  const town = Object.values(state.plots).map((p) => p.cell);
  const sites = harbourSites(planner.cells, { count: 6, spacing: 3 }).filter((c) => town.some((t) => cheb(t, [c.i, c.j]) <= 2) && !T.reserved[ckey([c.i, c.j])]);
  for (const site of sites) {
    const p = harbourParams(planner, site, state);
    if (!p) continue;
    add('harbour', p.wcell, p, { reserve: p.wcell });
    return [];
  }
  return [];
}

/**
 * Additive migration for plots built before the terrain rules: wherever a plot's street edge meets the
 * water (the old 1:1 grass embankments), plan a quay (pitched bank with steps, railing, lamps, benches) and a
 * pier into open water, plus the harbour. Plots and houses are never touched; nothing is demolished.
 */
export function planShoreRenovation({ planner, state, log }, { dryRun = false } = {}) {
  const made = [];
  const shadow = dryRun ? structuredClone({ plots: state.plots, cells: state.cells, terrain: state.terrain ?? {}, city: state.city }) : state;
  const add = (type, cell, params, opts = {}) => {
    const rec = addRecord(shadow, type, cell, params, { ...opts, renovation: true });
    made.push(rec);
    log?.(`${dryRun ? '[dry run] ' : ''}Shore renovation ${rec.id}: ${type} at cell ${ckey(cell)} (${rec.total} blocks)`);
    return rec;
  };
  for (const plot of Object.values(shadow.plots)) {
    if (plot.terrain || !plot.done) continue; // new-rule plots plan their own quays
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const side = sideOf([dx, dz]);
      const n = [plot.cell[0] + dx, plot.cell[1] + dz];
      if (shadow.cells[ckey(n)]) continue; // a neighbouring plot, not the water
      if (hasInfra(shadow, (r) => r.type === 'quay' && r.params.plot === plot.key && r.params.side === side)) continue;
      const q = measureQuay(planner, plot, side);
      if (!q) continue;
      const c = planner.cell(n);
      let pier = null;
      if (c && c.cls === 'water' && c.waterType !== 'river' && !hasInfra(shadow, (r) => r.type === 'pier' && cheb(r.cell, n) <= 2)) {
        q.pierAt = q.steps ? 10 : 14;
        pier = measurePier(planner, q.row[q.pierAt], SIDES[side], plot.y);
        if (!pier) delete q.pierAt;
      }
      add('quay', plot.cell, q);
      if (pier) add('pier', n, pier);
    }
  }
  planHarbour({ planner, state: shadow }, add);
  if (!dryRun) terrainState(state).shoreRenovated = INFRA_VERSION;
  return made;
}

/** Anchor points for boats and steamers (see docs/world-anchors.md), rebuilt from finished records. */
export function updateAnchors(state) {
  const T = terrainState(state);
  const A = { harbours: [], piers: [], bridges: [], beaches: [] };
  for (const r of Object.values(T.infra)) {
    if (!r.done) continue;
    const p = r.params;
    if (r.type === 'harbour') A.harbours.push({ id: r.id, waterY: p.waterY, ...p.anchors });
    if (r.type === 'pier') {
      const n = p.bottoms.length - 1;
      A.piers.push({ id: r.id, head: [p.start[0] + p.dir[0] * n, p.deckY + 1, p.start[1] + p.dir[1] * n], dir: p.dir, waterY: p.waterY, lido: !!p.tower });
    }
    if (r.type === 'bridge') A.bridges.push({ id: r.id, kind: p.kind, deckY: p.deckY, rect: r.rect, waterY: p.waterY });
    if (r.type === 'beach') A.beaches.push({ id: r.id, waterY: p.waterY, rect: r.rect });
  }
  T.anchors = A;
  return A;
}

// ------------------------------------------------------------------ the crew

/**
 * Builds pending infra records a few blocks per tick (only while some chat works, like the renovation
 * crew), one record at a time, and re-applies finished ones additively when INFRA_VERSION changes.
 */
export class InfraWorks {
  /**
   * @param {object} d state(), cmd, log, save, chunks, releaseLater(owner), enabled(rec) -> bool,
   *   rate() -> blocks/s, announce(parts, x, y, z)
   */
  constructor(d) {
    this.d = d;
    this.credit = 0;
    this.current = null;
    this.stuck = 0;
  }

  pending() {
    const T = terrainState(this.d.state());
    return Object.values(T.infra)
      .filter((r) => (!r.done || r.v !== INFRA_VERSION) && this.d.enabled(r))
      .sort((a, b) => a.done - b.done || Number(a.id) - Number(b.id));
  }

  async step(dt, maxPerTick) {
    if (await this.d.chunks.verify?.()) this.d.log('Force-loaded chunks were dropped by someone else; held them again');
    const rec = this.current && !this.current.done && this.d.enabled(this.current) ? this.current : this.pending()[0];
    if (!rec) return;
    if (rec !== this.current) {
      if (this.current) this.d.releaseLater(`infra:${this.current.id}`);
      this.current = rec;
      if (rec.done) {
        rec.done = false; // renovation: walk the list again (unchanged blocks are no-ops, no clearing)
        rec.placed = 0;
        rec.pass = 'renovate';
      }
      if (rec.rect) await this.d.chunks.hold(`infra:${rec.id}`, { x1: rec.rect.x1 - 1, z1: rec.rect.z1 - 1, x2: rec.rect.x2 + 1, z2: rec.rect.z2 + 1 });
    }
    const list = infraList(rec);
    rec.total = list.length;
    this.credit = Math.min(this.credit + this.d.rate() * dt, 60);
    let n = Math.min(Math.floor(this.credit), maxPerTick);
    while (n-- > 0 && rec.placed < list.length) {
      const b = list[rec.placed];
      if (rec.pass === 'renovate' && (b.cmd || b.block.endsWith(':air'))) {
        rec.placed++; // additive: never clear again, never spawn a second boat
        n++;
        continue;
      }
      if (b.cmd) await this.d.cmd(b.cmd);
      else {
        const out = await this.d.cmd(`setblock ${b.x} ${b.y} ${b.z} ${b.block}`);
        if (out.includes('not loaded')) {
          // Still loading — or someone ran `forceload remove all`: after a while ask for the chunks again.
          if (++this.stuck % 40 === 0) await this.d.chunks.reassert?.(`infra:${rec.id}`);
          break;
        }
        this.stuck = 0;
        if (!/Changed|Could not set/.test(out) && !rec.warned) {
          rec.warned = true; // once per piece: an unexpected reply (bad block state?) must not stay silent
          this.d.log(`Infra ${rec.id} (${rec.type}): setblock ${b.x} ${b.y} ${b.z} ${b.block} -> ${out.slice(0, 120)}`);
        }
        if (rec.placed % 9 === 0 && !b.block.endsWith(':air')) await this.d.cmd(`particle minecraft:happy_villager ${b.x + 0.5} ${b.y + 0.7} ${b.z + 0.5} 0.3 0.3 0.3 0 2`);
      }
      rec.placed++;
      this.credit -= 1;
    }
    if (rec.placed >= list.length) {
      rec.done = true;
      rec.v = INFRA_VERSION;
      delete rec.pass;
      this.current = null;
      this.d.releaseLater(`infra:${rec.id}`);
      updateAnchors(this.d.state());
      this.d.log(`Infra ${rec.id} (${rec.type}) finished`);
      if (['harbour', 'bridge', 'beach'].includes(rec.type) && rec.rect && this.d.announce) {
        const x = Math.round((rec.rect.x1 + rec.rect.x2) / 2), z = Math.round((rec.rect.z1 + rec.rect.z2) / 2);
        await this.d.announce([{ text: t('infra.done', { what: infraLabel(rec) }) }], x, (rec.params.waterY ?? rec.params.deckY ?? 64) + 3, z);
      }
    }
    this.d.save();
  }

  reset() {
    this.current = null;
  }
}


// For dev scripts (.dev/terrain/*): planners that are otherwise internal.
export const _test = { bridgeParams, laneParams, viewpointParams, harbourParams, measurePier, measureQuay };
