// Terrain helpers: surface probing, choosing a valley for the city, terraced plot preparation
// and reference-counted chunk force-loading.

import { TerrainScanner, analyze, classifyCells, siteScoreAt, NONE, F } from './terrain-scan.mjs';
import { rngFrom } from './blueprint.mjs';

export const PLOT = 21; // plot size incl. its 2-block street ring
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ rectangles (inclusive block coords)

export const rect = (x1, z1, x2, z2) => ({ x1, z1, x2, z2 });
export const grow = (r, d) => rect(r.x1 - d, r.z1 - d, r.x2 + d, r.z2 + d);
const overlaps = (a, b) => a.x1 <= b.x2 && b.x1 <= a.x2 && a.z1 <= b.z2 && b.z1 <= a.z2;

/** Rectangles minus holes, as a list of disjoint rectangles. */
export function subtract(rects, holes) {
  let out = rects;
  for (const h of holes) {
    const next = [];
    for (const r of out) {
      if (!overlaps(r, h)) {
        next.push(r);
        continue;
      }
      if (r.z1 < h.z1) next.push(rect(r.x1, r.z1, r.x2, h.z1 - 1));
      if (r.z2 > h.z2) next.push(rect(r.x1, h.z2 + 1, r.x2, r.z2));
      const z1 = Math.max(r.z1, h.z1);
      const z2 = Math.min(r.z2, h.z2);
      if (r.x1 < h.x1) next.push(rect(r.x1, z1, h.x1 - 1, z2));
      if (r.x2 > h.x2) next.push(rect(h.x2 + 1, z1, r.x2, z2));
    }
    out = next;
  }
  return out;
}

/** The ring of cells at Chebyshev distance d around r, as four strips. */
function ring(r, d) {
  const o = grow(r, d);
  return [
    rect(o.x1, o.z1, o.x2, o.z1),
    rect(o.x1, o.z2, o.x2, o.z2),
    rect(o.x1, o.z1 + 1, o.x1, o.z2 - 1),
    rect(o.x2, o.z1 + 1, o.x2, o.z2 - 1),
  ];
}

// ------------------------------------------------------------------ chunk loading

/**
 * Force-loads chunks on behalf of named owners (a plot, a probe…). A chunk stays loaded while any owner
 * holds it, so finishing one plot never unloads a neighbour still being built, and holding or releasing
 * the same owner twice is harmless.
 */
export class ChunkLoader {
  constructor(cmd) {
    this.cmd = cmd;
    this.owners = new Map(); // owner -> Set of chunk keys
    this.counts = new Map(); // chunk key -> number of owners
  }

  static chunks(r) {
    const out = [];
    for (let cx = Math.floor(r.x1 / 16); cx <= Math.floor(r.x2 / 16); cx++)
      for (let cz = Math.floor(r.z1 / 16); cz <= Math.floor(r.z2 / 16); cz++) out.push(`${cx},${cz}`);
    return out;
  }

  /** Makes `owner` hold exactly the chunks covering `r` (replacing what it held before). */
  async hold(owner, r) {
    const want = new Set(ChunkLoader.chunks(r));
    const had = this.owners.get(owner) ?? new Set();
    this.owners.set(owner, want);
    for (const key of want) {
      if (had.has(key)) continue;
      const n = this.counts.get(key) ?? 0;
      this.counts.set(key, n + 1);
      if (n === 0) await this.#send('add', key);
    }
    for (const key of had) if (!want.has(key)) await this.#drop(key);
  }

  async release(owner) {
    const had = this.owners.get(owner);
    if (!had) return;
    this.owners.delete(owner);
    for (const key of had) await this.#drop(key);
  }

  async #drop(key) {
    const n = this.counts.get(key) ?? 0;
    if (n <= 1) {
      this.counts.delete(key);
      await this.#send('remove', key);
    } else this.counts.set(key, n - 1);
  }

  #send(op, key) {
    const [cx, cz] = key.split(',').map(Number);
    return this.cmd(`forceload ${op} ${cx * 16} ${cz * 16}`);
  }

  /**
   * Self-heal (at most every `everyMs`): if a chunk we hold is no longer force-loaded (someone ran
   * `forceload remove all`, e.g. another bridge on a shared test server), re-adds every held chunk.
   */
  async verify(everyMs = 30000) {
    const now = Date.now();
    if (now - (this.lastVerify ?? 0) < everyMs || !this.counts.size) return false;
    this.lastVerify = now;
    const [key] = this.counts.keys();
    const [cx, cz] = key.split(',').map(Number);
    if (!(await this.cmd(`forceload query ${cx * 16} ${cz * 16}`)).includes('not marked')) return false;
    for (const k of this.counts.keys()) await this.#send('add', k);
    return true;
  }

  /** Sends `forceload add` again for everything `owner` holds (after something outside wiped the force-loads). */
  async reassert(owner) {
    for (const key of this.owners.get(owner) ?? []) await this.#send('add', key);
  }

  /** Like hold(), for an explicit list of chunk keys ("cx,cz"). */
  async holdKeys(owner, keys) {
    const want = new Set(keys);
    const had = this.owners.get(owner) ?? new Set();
    this.owners.set(owner, want);
    for (const key of want) {
      if (had.has(key)) continue;
      const n = this.counts.get(key) ?? 0;
      this.counts.set(key, n + 1);
      if (n === 0) await this.#send('add', key);
    }
    for (const key of had) if (!want.has(key)) await this.#drop(key);
  }

  /** Forgets all holds; with `wipeWorld` also drops every force-load in the world. */
  async reset(wipeWorld) {
    this.owners.clear();
    this.counts.clear();
    if (wipeWorld) await this.cmd('forceload remove all');
  }
}

// ------------------------------------------------------------------ probing

export class Terrain {
  constructor(cmd, log, chunks) {
    this.cmd = cmd;
    this.log = log;
    this.chunks = chunks; // shared ChunkLoader, so probes never unload chunks a build still needs
  }

  /** Runs fn(probeAt) with a marker entity homed at (hx, hz); probeAt(x, z) -> {y, water, leaves} | null. */
  async withProbe(hx, hz, fn) {
    const { cmd, chunks } = this;
    const home = `probe-home:${hx},${hz}`;
    await chunks.hold(home, rect(hx, hz, hx, hz));
    const summon = async () => {
      await cmd('kill @e[tag=alps_probe]');
      for (let i = 0; i < 40; i++) {
        if ((await cmd(`summon minecraft:armor_stand ${hx} 320 ${hz} {Tags:["alps_probe"],Invisible:1b,Marker:1b,NoGravity:1b}`)).includes('Summoned')) return true;
        await sleep(250);
      }
      return false;
    };
    if (!(await summon())) {
      await chunks.release(home);
      return fn(async () => null);
    }
    const probeAt = async (x, z) => {
      // The target must be loaded, or the marker unloads together with its chunk right after landing.
      await chunks.hold('probe-area', rect(x - 6, z - 6, x + 6, z + 6));
      try {
        return await land(x, z);
      } finally {
        await chunks.release('probe-area');
      }
    };
    const land = async (x, z) => {
      const spread = await cmd(`spreadplayers ${x} ${z} 0 6 false @e[tag=alps_probe,limit=1]`);
      if (!spread.startsWith('Spread')) {
        if (spread.includes('No entity')) await summon();
        return null; // water or lava everywhere nearby
      }
      const pos = (await cmd('data get entity @e[tag=alps_probe,limit=1] Pos')).match(/\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/);
      const water = (await cmd('execute at @e[tag=alps_probe,limit=1] if block ~ ~-1 ~ minecraft:water')).includes('passed');
      const leaves = (await cmd('execute at @e[tag=alps_probe,limit=1] if block ~ ~-1 ~ #minecraft:leaves')).includes('passed');
      if ((await cmd(`tp @e[tag=alps_probe,limit=1] ${hx} 320 ${hz}`)).includes('No entity')) await summon();
      if (!pos) return null;
      return { y: Math.floor(Number(pos[2])) - 1, water, leaves };
    };
    try {
      return await fn(probeAt);
    } finally {
      await cmd('kill @e[tag=alps_probe]');
      await chunks.release(home);
    }
  }

  /** Ground for a plot: a low-ish sample of five points (ignoring tree tops) and the highest ground seen. */
  async plotGround(cx, cz, fallback) {
    return this.withProbe(cx, cz, async (probeAt) => {
      const hs = [];
      for (const [dx, dz] of [[0, 0], [-8, -8], [8, -8], [-8, 8], [8, 8], [-14, 0], [14, 0], [0, -14], [0, 14]]) {
        const p = await probeAt(cx + dx, cz + dz);
        if (p) hs.push(p.leaves ? p.y - 4 : p.y);
      }
      if (!hs.length) return { y: fallback, top: fallback };
      hs.sort((a, b) => a - b);
      return { y: hs[Math.min(1, hs.length - 1)], top: hs[hs.length - 1] };
    });
  }

  async plotHeight(cx, cz, fallback) {
    return (await this.plotGround(cx, cz, fallback)).y;
  }

  /**
   * Picks the city site: a flat, dry valley floor with high mountains around it.
   * Candidates come from `locate biome` (plains / meadow / sunflower plains) around the origin.
   */
  async findValley([sx, sz] = [0, 0]) {
    const { cmd, log } = this;
    const origins = [[sx, sz]];
    for (const r of [700, 1400]) for (let a = 0; a < 8; a++) origins.push([sx + Math.round(Math.cos((a * Math.PI) / 4) * r), sz + Math.round(Math.sin((a * Math.PI) / 4) * r)]);
    const candidates = [];
    for (const [ox, oz] of origins) {
      for (const biome of ['plains', 'meadow', 'sunflower_plains']) {
        const m = (await cmd(`execute positioned ${ox} 64 ${oz} run locate biome minecraft:${biome}`)).match(/at \[(-?\d+), [^,]+, (-?\d+)\]/);
        if (!m) continue;
        const [x, z] = [Number(m[1]), Number(m[2])];
        if (Math.hypot(x - sx, z - sz) > 2200) continue;
        if (candidates.some((c) => Math.hypot(c[0] - x, c[1] - z) < 200)) continue;
        candidates.push([x, z]);
      }
    }
    candidates.sort((a, b) => Math.hypot(a[0] - sx, a[1] - sz) - Math.hypot(b[0] - sx, b[1] - sz));
    const pool = candidates.slice(0, 14);
    log(`Surveying ${pool.length} valley candidates…`);

    let best = null;
    for (const [x, z] of pool) {
      const result = await this.withProbe(x, z, async (probeAt) => {
        const inner = [];
        let water = 0;
        const pts = [[0, 0]];
        for (let a = 0; a < 4; a++) pts.push([Math.cos((a * Math.PI) / 2) * 35, Math.sin((a * Math.PI) / 2) * 35]);
        for (let a = 0; a < 8; a++) pts.push([Math.cos((a * Math.PI) / 4 + 0.4) * 75, Math.sin((a * Math.PI) / 4 + 0.4) * 75]);
        for (const [dx, dz] of pts) {
          const p = await probeAt(Math.round(x + dx), Math.round(z + dz));
          if (!p) {
            water++;
            continue;
          }
          if (p.water) water++;
          inner.push(p.leaves ? p.y - 4 : p.y);
        }
        const outer = [];
        for (let a = 0; a < 8; a++) {
          const p = await probeAt(Math.round(x + Math.cos((a * Math.PI) / 4) * 230), Math.round(z + Math.sin((a * Math.PI) / 4) * 230));
          if (p) outer.push(p.y);
        }
        return { inner, outer, water };
      });
      if (result.inner.length < 8) continue;
      const sorted = [...result.inner].sort((a, b) => a - b);
      const median = sorted[sorted.length >> 1];
      const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
      const std = Math.sqrt(sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / sorted.length);
      const range = sorted[sorted.length - 2] - sorted[1];
      const peaks = result.outer.length ? Math.max(...result.outer) - median : 0;
      const score = std * 3 + range * 0.6 + result.water * 25 - Math.min(Math.max(peaks, 0), 70) * 0.35 + Math.hypot(x - sx, z - sz) / 500;
      log(`  site ${x},${z}: flat σ=${std.toFixed(1)} range=${range} water=${result.water} peaks=+${peaks} → score ${score.toFixed(1)}`);
      if (!best || score < best.score) best = { x, z, y: median, score };
    }
    if (!best) {
      const y = await this.plotHeight(sx, sz, 80);
      return { x: sx, z: sz, y };
    }
    return best;
  }

  // ---------------------------------------------------------------- shaping

  /**
   * Levels a plot to height y and blends it into the surroundings with grassy 1:1 terraces
   * (cut slopes above, embankments below) instead of vertical walls. Existing plots are never touched.
   */
  async preparePlot(r, y, { obstacles, street, margin = 4, top = y }) {
    const { cmd } = this;
    // Cut everything up to the highest ground nearby (plus headroom), in slabs that respect fill's 32768 limit.
    const ceiling = Math.max(y + 40, top + 8);
    const clearAir = async (a, from) => {
      const per = Math.max(1, Math.floor(32768 / ((a.x2 - a.x1 + 1) * (a.z2 - a.z1 + 1))));
      for (let y1 = from; y1 <= ceiling; y1 += per) await cmd(`fill ${a.x1} ${y1} ${a.z1} ${a.x2} ${Math.min(ceiling, y1 + per - 1)} ${a.z2} air`);
    };
    // Clear wild trees around the plot (persistent leaves belong to our own buildings and are kept).
    const around = subtract([grow(r, margin)], [r, ...obstacles]);
    const trees = ['oak_leaves[persistent=false]', 'birch_leaves[persistent=false]', 'spruce_leaves[persistent=false]', 'dark_oak_leaves[persistent=false]',
      'oak_log', 'birch_log', 'spruce_log', 'dark_oak_log', 'bee_nest'];
    for (const a of around) for (const t of trees) await cmd(`fill ${a.x1} ${y - 4} ${a.z1} ${a.x2} ${y + 34} ${a.z2} air replace minecraft:${t}`);
    for (const t of trees.slice(0, 4)) await cmd(`fill ${r.x1} ${y - 4} ${r.z1} ${r.x2} ${y + 34} ${r.z2} air replace minecraft:${t}`);

    // Terraces: at distance d the ground may be at most d blocks above or below the plot.
    for (let d = 1; d <= margin; d++) {
      for (const s of subtract(ring(r, d), obstacles)) {
        await clearAir(s, y + d + 1);
        await cmd(`fill ${s.x1} ${y + d} ${s.z1} ${s.x2} ${y + d} ${s.z2} grass_block replace #minecraft:dirt`);
        await cmd(`fill ${s.x1} ${y - d - 12} ${s.z1} ${s.x2} ${y - d - 1} ${s.z2} dirt replace minecraft:air`); // air only: lakes, rivers and the sea are never filled
        await cmd(`fill ${s.x1} ${y - d} ${s.z1} ${s.x2} ${y - d} ${s.z2} grass_block replace minecraft:air`);
      }
    }

    // The plot itself: clear above, solid ground below, street ring and lawn on top.
    await clearAir(r, y + 1);
    await cmd(`fill ${r.x1} ${y - 14} ${r.z1} ${r.x2} ${y - 4} ${r.z2} dirt replace #minecraft:replaceable`);
    await cmd(`fill ${r.x1} ${y - 3} ${r.z1} ${r.x2} ${y - 1} ${r.z2} dirt`);
    await cmd(`fill ${r.x1} ${y} ${r.z1} ${r.x2} ${y} ${r.z2} ${street.main}`);
    await cmd(`fill ${r.x1 + 2} ${y} ${r.z1 + 2} ${r.x2 - 2} ${y} ${r.z2 - 2} grass_block`);
    for (const [sx, sz, block] of street.texture) await cmd(`setblock ${sx} ${y} ${sz} ${block}`);
  }
}

// ------------------------------------------------------------------ adaptive planning (scan-driven)
//
// The planner reads the world from the region files (terrain-scan.mjs) instead of probing it, so it knows
// every column of a cell: natural ground, water, trees. With that it
//   - prices cells for nextCell (water and cliffs are never built on, steep land costs more),
//   - picks a plot's street level from the scan (no clamp to the neighbours or to the city base),
//   - prepares the lot within an earthwork budget: at most `budget` blocks of cut per column, deeper
//     fill becomes a terraced lot behind a stone retaining wall (with a cellar door), or a deck on posts,
//   - never fills water: lot columns over water become a deck on waterlogged posts, the lot edge a quay wall.
// See docs/terrain-adaptive-design.md.

const pctOf = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
export const MODE_COST = { level: 0, terrace: 0.8, walkout: 1.4, stilts: 2.4 };
export const SIDES = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] };
export const sideOf = ([dx, dz]) => (dx === 1 ? 'E' : dx === -1 ? 'W' : dz === 1 ? 'S' : 'N');
/** Kind of seam between two street levels |dy| apart (design §3.3). */
export const seamKind = (h) => (h <= 1 ? 'step' : h <= 4 ? 'stairs' : h <= 8 ? 'treppengasse' : 'wall');
// Extra cost of a street level that differs from a neighbouring plot's by d (in "columns of earthwork").
const seamPenalty = (d) => (d === 0 ? 0 : d === 1 ? 6 : d === 2 ? 16 : d <= 4 ? 30 + d * 6 : d <= 8 ? 80 + d * 6 : 160 + d * 6);
const NO_HOUSE = new Set(['water', 'cliff', 'unknown', 'built', 'river_crossing']);
// Rubble wall of a terraced lot (Trockenmauer): mostly stone bricks, some moss, cobble and cracks.
export const WALL_STONES = [['stone_bricks', 5], ['mossy_stone_bricks', 2], ['cobblestone', 2], ['mossy_cobblestone', 1], ['cracked_stone_bricks', 1]];

export class TerrainPlanner {
  /**
   * @param {object} o cmd(command) -> Promise<string>, log, chunks (shared ChunkLoader), worldDir (the
   *   server's world folder), budget (max cut per column), flushEveryMs (min time between `save-all flush`)
   */
  constructor({ cmd, log, chunks, worldDir, budget = 3, flushEveryMs = 120000 }) {
    Object.assign(this, { cmd, log, chunks, budget, flushEveryMs });
    this.scanner = new TerrainScanner(worldDir);
    this.origin = null;
    this.bounds = null; // scanned cells {i1, j1, i2, j2}
    this.cells = new Map(); // "i,j" -> classified cell (terrain-scan classifyCells)
    this.an = null;
    this.rect = null;
    this.version = 0;
    this.lastFlush = 0;
    this.planCache = new Map();
  }

  setOrigin(cx, cz) {
    if (this.origin && this.origin[0] === cx && this.origin[1] === cz) return;
    this.origin = [cx, cz];
    this.bounds = null;
    this.cells = new Map();
    this.an = null;
    this.rect = null;
  }

  cellRect([i, j]) {
    const x0 = this.origin[0] - 10 + i * PLOT;
    const z0 = this.origin[1] - 10 + j * PLOT;
    return rect(x0, z0, x0 + PLOT - 1, z0 + PLOT - 1);
  }

  cell([i, j]) {
    return this.cells.get(`${i},${j}`) ?? null;
  }

  /** Re-reads the scanned area from disk (cheap: only chunks whose region timestamp changed are decoded). */
  refresh(b = this.bounds) {
    if (!b || !this.origin) return;
    const a = this.cellRect([b.i1 - 1, b.j1 - 1]);
    const z = this.cellRect([b.i2 + 1, b.j2 + 1]);
    const r = rect(a.x1 - 3, a.z1 - 3, z.x2 + 3, z.z2 + 3);
    this.an = analyze(this.scanner.scan(r));
    this.cells = classifyCells(this.an, { origin: this.origin, budget: this.budget });
    this.rect = r;
    this.bounds = { ...b };
    this.version++;
    this.planCache.clear();
  }

  /** Grows the scanned area so it covers `list` ([i, j][]) with `margin` cells around, and rescans. */
  cover(list, margin = 2) {
    let next = this.bounds ? { ...this.bounds } : null;
    for (const [i, j] of list) {
      if (!next) next = { i1: i - margin, j1: j - margin, i2: i + margin, j2: j + margin };
      next = { i1: Math.min(next.i1, i - margin), j1: Math.min(next.j1, j - margin), i2: Math.max(next.i2, i + margin), j2: Math.max(next.j2, j + margin) };
    }
    if (next) this.refresh(next);
  }

  /** Column data at world (x, z) from the last scan, or null (outside / not generated). */
  col(x, z) {
    const r = this.rect;
    if (!r || x < r.x1 || x > r.x2 || z < r.z1 || z > r.z2) return null;
    const g = this.an.g;
    const i = (z - r.z1) * g.W + (x - r.x1);
    if (g.ground[i] === NONE) return null;
    return {
      G: g.ground[i], W: g.water[i], D: g.depth[i], C: g.canopy[i], flags: g.flags[i], kind: g.kind[i],
      wet: this.an.isWater(i), shore: this.an.shore[i], off: this.an.offshore[i], wtype: this.an.wtype[i], tree: !!(g.flags[i] & F.TREE),
    };
  }

  /** The water body (terrain-scan analyze()) a column belongs to, or null. */
  bodyAt(x, z) {
    const r = this.rect;
    if (!r || x < r.x1 || x > r.x2 || z < r.z1 || z > r.z2) return null;
    const b = this.an.body[(z - r.z1) * this.an.g.W + (x - r.x1)];
    return b >= 0 ? this.an.bodies[b] : null;
  }

  /**
   * Street level and earthwork mode of a lot (the whole 21x21 cell incl. its street ring), or null when it
   * cannot be built within the rules (mostly water, unknown, or a drop of more than 14 blocks).
   * `neighbours`: [{ y }] street levels of existing neighbouring plots (a matching level saves a seam).
   *   level    cut and fill <= budget                      terrace  drop <= 5: lot behind a retaining wall
   *   walkout  drop <= 8: retaining wall with a cellar     stilts   drop <= 14: deck on posts where deep
   */
  lotPlan(cell, neighbours = []) {
    const key = `${cell[0]},${cell[1]}|${neighbours.map((n) => n.y).join(',')}`;
    if (!this.planCache.has(key)) this.planCache.set(key, this.#lotPlan(cell, neighbours));
    return this.planCache.get(key);
  }

  #lotPlan(cell, neighbours) {
    if (!this.rect) return null;
    const r = this.cellRect(cell);
    const hs = [];
    let wet = 0, unknown = 0, wmax = -Infinity;
    for (let z = r.z1 - 3; z <= r.z2 + 3; z++)
      for (let x = r.x1 - 3; x <= r.x2 + 3; x++) {
        const inside = x >= r.x1 && x <= r.x2 && z >= r.z1 && z <= r.z2;
        const c = this.col(x, z);
        if (!c) {
          if (inside) unknown++;
          continue;
        }
        if (c.wet) {
          wmax = Math.max(wmax, c.W); // a lot next to water stays above it (and never lets a lake run in)
          if (inside) wet++;
          continue;
        }
        if (inside) hs.push(c.G);
      }
    const n = PLOT * PLOT;
    if (unknown > n * 0.1 || hs.length < n * 0.55) return null;
    hs.sort((a, b) => a - b);
    const lo = pctOf(hs, 0.02), hi = pctOf(hs, 0.98);
    const yMin = wmax > -Infinity ? wmax + 1 : -Infinity;
    const from = Math.max(lo, yMin);
    const to = Math.max(hi, from);
    const budget = this.budget;
    let best = null;
    for (let y = from; y <= to; y++) {
      let cut = 0, fill = 0, over = 0, deep = 0;
      for (const h of hs) {
        if (h > y) {
          cut += h - y;
          if (h - y > budget) over += h - y - budget;
        } else {
          fill += y - h;
          if (y - h > budget) deep += y - h - budget;
        }
      }
      let seam = 0;
      for (const nb of neighbours) seam += seamPenalty(Math.abs(y - nb.y));
      const cost = cut * 1.3 + fill + over * 25 + deep * 0.8 + seam;
      if (!best || cost < best.cost) best = { y, cost, cut, fill };
    }
    const drop = best.y - lo;
    const mode = drop <= budget ? 'level' : drop <= 5 ? 'terrace' : drop <= 8 ? 'walkout' : drop <= 14 ? 'stilts' : null;
    if (!mode) return null;
    const c = this.cell(cell);
    return {
      y: best.y, mode, drop, cutMax: Math.max(0, hi - best.y), cut: best.cut, fill: best.fill, wet, top: hs[hs.length - 1],
      waterY: wmax > -Infinity ? wmax : null, aspect: c?.aspect ?? 'S', waterSides: c?.edgesToWater ?? [], cls: c?.cls ?? null,
    };
  }

  /** Extra cost (0 = flat lot) of a house on `cell`, Infinity when it must not be built on. */
  houseCost(cell, neighbours = []) {
    const c = this.cell(cell);
    if (!c || NO_HOUSE.has(c.cls)) return Infinity;
    const p = this.lotPlan(cell, neighbours);
    if (!p) return Infinity;
    let k = MODE_COST[p.mode];
    if (c.cls === 'shoreline') k += p.wet ? 0.2 : -0.3; // the lake front is attractive, a lot half on a deck less so
    if (c.cls === 'forest') k += 1.2; // a house in a clearing; forests are the town's green wedges
    return k;
  }

  /** How a growing district may cross an unbuildable cell: a stair lane (steep / cliff) or a bridge (river). */
  hop(cell) {
    const c = this.cell(cell);
    if (!c) return null;
    if (c.cls === 'river_crossing') return 'bridge';
    if (c.cls === 'steep' || c.cls === 'cliff' || c.use === 'natural' || c.use === 'cliff-shore') return 'stairs';
    return null;
  }

  /**
   * Generates missing chunks around `cells` ([i, j][]) so they can be scanned: force-loads them (through the
   * shared ChunkLoader, in batches), waits until they are loaded, lets them go (Paper writes a chunk when it
   * unloads) and rescans. A `save-all flush` is only sent when that was not enough, and at most every
   * `flushEveryMs`. Returns the number of chunks still unknown.
   */
  async ensureGenerated(cells, margin = 4) {
    if (!cells.length || !this.origin) return 0;
    let r = null;
    for (const c of cells) {
      const q = this.cellRect(c);
      r = r ? rect(Math.min(r.x1, q.x1), Math.min(r.z1, q.z1), Math.max(r.x2, q.x2), Math.max(r.z2, q.z2)) : q;
    }
    return this.generateRect(grow(r, margin));
  }

  async generateRect(r) {
    let missing = this.scanner.unknownChunks(r);
    if (!missing.length) return 0;
    this.log(`Terrain: generating ${missing.length} chunks around ${r.x1},${r.z1}..${r.x2},${r.z2}`);
    for (let k = 0; k < missing.length; k += 160) {
      const batch = missing.slice(k, k + 160);
      const owner = 'terrain:generate';
      await this.chunks.holdKeys(owner, batch.map(([cx, cz]) => `${cx},${cz}`));
      const until = Date.now() + 45000;
      let pending = batch;
      while (pending.length && Date.now() < until) {
        const still = [];
        for (let q = 0; q < pending.length; q += 24) {
          const group = pending.slice(q, q + 24);
          const test = group.map(([cx, cz]) => `if loaded ${cx * 16 + 8} 0 ${cz * 16 + 8}`).join(' ');
          if (!(await this.cmd(`execute ${test}`)).includes('passed')) still.push(...group);
        }
        pending = still;
        if (pending.length) await sleep(400);
      }
      await this.chunks.release(owner);
    }
    await sleep(2500); // unloaded chunks are written asynchronously
    missing = this.scanner.unknownChunks(r);
    if (missing.length && Date.now() - this.lastFlush > this.flushEveryMs) {
      this.lastFlush = Date.now();
      await this.cmd('save-all flush');
      await sleep(300);
      missing = this.scanner.unknownChunks(r);
    }
    if (missing.length) this.log(`Terrain: ${missing.length} chunks still not on disk; those cells wait`);
    return missing.length;
  }

  /**
   * Phase 5 site selection: candidates from `locate biome` (valley floors and rivers) around `origin`, hills
   * nearby first; each candidate's neighbourhood is generated, scanned and scored with siteScoreAt (a
   * buildable core, a lake or river, hills around), trying centres up to 3 cells off the candidate.
   * Returns { x, z, score, parts } or null.
   */
  async findSite([sx, sz], { maxCandidates = 8 } = {}) {
    const origins = [[sx, sz]];
    for (const r of [700, 1400]) for (let a = 0; a < 8; a++) origins.push([sx + Math.round(Math.cos((a * Math.PI) / 4) * r), sz + Math.round(Math.sin((a * Math.PI) / 4) * r)]);
    const candidates = [];
    for (const [ox, oz] of origins)
      for (const biome of ['river', 'meadow', 'plains', 'sunflower_plains', 'cherry_grove']) {
        const m = (await this.cmd(`execute positioned ${ox} 64 ${oz} run locate biome minecraft:${biome}`)).match(/at \[(-?\d+), [^,]+, (-?\d+)\]/);
        if (!m) continue;
        const [x, z] = [Number(m[1]), Number(m[2])];
        if (Math.hypot(x - sx, z - sz) > 2200 || candidates.some((c) => Math.hypot(c[0] - x, c[1] - z) < 250)) continue;
        candidates.push([x, z, biome]);
      }
    // Mountains nearby make the Swiss look: candidates with hills close by are surveyed first.
    const scored = [];
    for (const c of candidates) {
      const m = (await this.cmd(`execute positioned ${c[0]} 64 ${c[1]} run locate biome #minecraft:is_mountain`)).match(/\((\d+) blocks away\)/);
      const w = (await this.cmd(`execute positioned ${c[0]} 64 ${c[1]} run locate biome minecraft:windswept_hills`)).match(/\((\d+) blocks away\)/);
      const hill = Math.min(m ? Number(m[1]) : 9999, w ? Number(w[1]) : 9999);
      scored.push({ c, pre: Math.hypot(c[0] - sx, c[1] - sz) / 400 + Math.min(hill, 1500) / 150 });
    }
    scored.sort((a, b) => a.pre - b.pre);
    const pool = scored.slice(0, maxCandidates).map((s) => s.c);
    this.log(`Surveying ${pool.length} sites (scan-based)…`);
    let best = null;
    for (const [x, z, biome] of pool) {
      const win = rect(x - 190, z - 190, x + 190, z + 190);
      if ((await this.generateRect(win)) > 40) continue;
      const an = analyze(this.scanner.scan(win));
      const cells = classifyCells(an, { origin: [x, z], budget: this.budget });
      let local = null;
      for (let di = -3; di <= 3; di++)
        for (let dj = -3; dj <= 3; dj++) {
          const s = siteScoreAt(cells, [di, dj], { radius: 6 });
          const total = s.score + Math.hypot(x + di * PLOT - sx, z + dj * PLOT - sz) / 600;
          if (!local || total < local.total) local = { total, di, dj, s };
        }
      if (!local) continue;
      const site = { x: x + local.di * PLOT, z: z + local.dj * PLOT, score: +local.total.toFixed(1), parts: local.s, biome };
      this.log(`  site ${site.x},${site.z} (${biome}): score ${site.score} ${JSON.stringify(local.s)}`);
      if (!best || site.score < best.score) best = site;
    }
    return best;
  }

  /**
   * What the old rules would have done on this cell (for comparison only): level = the second-lowest of
   * the 9 probe points (tree tops count 4 lower), clamped to +-1 of the neighbouring plots and +-12 of the
   * city base; earthwork = the whole 21x21 lot levelled + 1:1 grass terraces 4 blocks wide around it
   * (Phase 0 rules; the original apron was 8). Water columns count as fill. Uses the natural terrain scan.
   */
  legacyEarthwork(cell, neighbourYs, baseY, margin = 4) {
    const r = this.cellRect(cell);
    const cx = r.x1 + 10, cz = r.z1 + 10;
    const hs = [];
    for (const [dx, dz] of [[0, 0], [-8, -8], [8, -8], [-8, 8], [8, 8], [-14, 0], [14, 0], [0, -14], [0, 14]]) {
      const c = this.col(cx + dx, cz + dz);
      if (c) hs.push(c.wet ? c.W : c.tree && c.C !== NONE ? c.C - 4 : c.G);
    }
    if (!hs.length) return null;
    hs.sort((a, b) => a - b);
    let y = hs[Math.min(1, hs.length - 1)];
    if (neighbourYs.length) {
      const lo = Math.max(...neighbourYs) - 1, hi = Math.min(...neighbourYs) + 1;
      y = lo <= hi ? Math.min(Math.max(y, lo), hi) : Math.round((Math.max(...neighbourYs) + Math.min(...neighbourYs)) / 2);
    }
    y = Math.min(Math.max(y, baseY - 12), baseY + 12);
    let cut = 0, fill = 0, water = 0;
    for (let z = r.z1 - margin; z <= r.z2 + margin; z++)
      for (let x = r.x1 - margin; x <= r.x2 + margin; x++) {
        const c = this.col(x, z);
        if (!c) continue;
        const d = Math.max(r.x1 - x, x - r.x2, r.z1 - z, z - r.z2, 0); // 0 inside the lot
        const top = c.wet ? c.W : c.G;
        if (top > y + d) cut += top - y - d;
        else if (top < y - d) {
          const f = Math.min(y - d - top, d ? 12 : 14);
          fill += f;
          if (c.wet) water += Math.min(f, c.D);
        }
      }
    return { y, cut, fill, water };
  }

  // ---------------------------------------------------------------- shaping

  /**
   * Commands (and earthwork stats) that bring the 21x21 cell `r` to street level `plan.y` within the budget.
   * `holes`: rectangles never touched (other plots, infrastructure); `openSides`: sides without a
   * neighbouring plot (a lot that ends in a wall gets a railing there).
   */
  adaptiveOps(r, plan, { holes = [], street, openSides = ['N', 'S', 'E', 'W'], seed = '', cellar = true }) {
    const { y, mode } = plan;
    const budget = this.budget;
    const rng = rngFrom(`${seed}:terrain`);
    const stats = { cut: 0, fill: 0, wall: 0, posts: 0, deck: 0, cmds: 0 };
    const runs = new Map(); // "y1|y2|block|replace|z" -> [x...]
    const add = (x, z, y1, y2, block, replace = '') => {
      if (y2 < y1) return;
      const k = `${y1}|${y2}|${block}|${replace}|${z}`;
      if (!runs.has(k)) runs.set(k, []);
      runs.get(k).push(x);
    };
    const singles = []; // walls and decorations, in order
    const deck = [];
    const inHole = (x, z) => holes.some((h) => x >= h.x1 && x <= h.x2 && z >= h.z1 && z <= h.z2);
    const edge = (x, z) => Math.min(x - r.x1, r.x2 - x, z - r.z1, r.z2 - z);
    const sideAt = (x, z) => (z === r.z1 ? 'N' : z === r.z2 ? 'S' : x === r.x1 ? 'W' : x === r.x2 ? 'E' : null);
    const corner = (x, z) => (x === r.x1 || x === r.x2) && (z === r.z1 || z === r.z2);
    const wallStone = () => rng.weighted(WALL_STONES);
    const wallColumn = (x, z, y1, y2) => {
      let yy = y1;
      while (yy <= y2) {
        const len = Math.min(y2 - yy + 1, 1 + rng.int(0, 2));
        singles.push(len === 1 ? `setblock ${x} ${yy} ${z} ${wallStone()}` : `fill ${x} ${yy} ${z} ${x} ${yy + len - 1} ${z} ${wallStone()}`);
        yy += len;
      }
    };
    const railing = [];
    const wallRuns = []; // perimeter wall heights per column, for the cellar
    for (let z = r.z1; z <= r.z2; z++)
      for (let x = r.x1; x <= r.x2; x++) {
        const c = this.col(x, z);
        if (!c) continue;
        if (c.wet) {
          // Water is never filled: the outermost ring row becomes a quay wall, the rest a deck on posts.
          if (edge(x, z) === 0 && !corner(x, z) && y - c.W <= 4) {
            for (let yy = c.G + 1; yy <= y - 1; yy++) singles.push(`setblock ${x} ${yy} ${z} ${yy <= c.W - 2 ? 'cobblestone' : wallStone()}`);
            stats.wall += y - 1 - c.G;
          } else {
            deck.push([x, z]);
            stats.deck++;
            if ((x - r.x1) % 3 === 1 && (z - r.z1) % 3 === 1) {
              add(x, z, c.G + 1, c.W, 'spruce_fence[waterlogged=true]');
              add(x, z, c.W + 1, y - 1, 'spruce_fence');
              stats.posts++;
            }
          }
          continue;
        }
        const top = Math.max(c.G, c.tree && c.C !== NONE ? c.C : c.G);
        if (top > y) add(x, z, y + 1, top, 'air');
        if (c.G > y) stats.cut += c.G - y;
        const d = y - c.G;
        if (d <= 1) continue;
        if (mode === 'stilts' && d > budget && edge(x, z) > 0) {
          deck.push([x, z]);
          stats.deck++;
          if ((x - r.x1) % 4 === 2 && (z - r.z1) % 4 === 2) {
            add(x, z, c.G + 1, y - 1, 'spruce_log[axis=y]');
            stats.posts++;
          }
          continue;
        }
        if (edge(x, z) === 0 && d > 2) {
          wallColumn(x, z, c.G + 1, y - 1); // retaining wall on the lot edge
          stats.wall += d - 1;
          const side = sideAt(x, z);
          if (side && !corner(x, z)) {
            wallRuns.push({ x, z, side, h: d - 1, G: c.G });
            if (d >= 3 && openSides.includes(side)) railing.push([x, z]);
          }
          continue;
        }
        add(x, z, c.G + 1, y - 1, 'dirt', '#minecraft:replaceable');
        stats.fill += d - 1;
      }
    // Stilts lots: posts along the deck edge too, so the deck never ends in mid-air.
    if (mode === 'stilts')
      for (let z = r.z1 + 2; z <= r.z2 - 2; z += 4)
        for (const x of [r.x1 + 2, r.x2 - 2]) {
          const c = this.col(x, z);
          if (c && !c.wet && y - c.G > budget) add(x, z, c.G + 1, y - 1, 'spruce_log[axis=y]');
        }

    // The apron: up to 2 blocks around the lot are eased into the natural slope; a deeper cut gets a wall.
    for (let z = r.z1 - 2; z <= r.z2 + 2; z++)
      for (let x = r.x1 - 2; x <= r.x2 + 2; x++) {
        if (x >= r.x1 && x <= r.x2 && z >= r.z1 && z <= r.z2) continue;
        if (inHole(x, z)) continue;
        const c = this.col(x, z);
        if (!c || c.wet) continue;
        const a = Math.max(r.x1 - x, x - r.x2, r.z1 - z, z - r.z2);
        if (c.G > y + a) {
          if (c.G - y <= budget) {
            add(x, z, y + a + 1, c.G, 'air');
            add(x, z, y + a, y + a, 'grass_block', '#minecraft:dirt');
            stats.cut += c.G - y - a;
          } else if (a === 1) {
            wallColumn(x, z, y + 1, c.G);
            stats.wall += c.G - y;
            if (rng.chance(0.25)) singles.push(`setblock ${x} ${c.G + 1} ${z} ${rng.pick(['moss_carpet', 'fern', 'poppy', 'cornflower', 'oxeye_daisy'])} keep`);
          }
        } else if (c.G < y - a && y - c.G <= budget) {
          add(x, z, c.G + 1, y - a - 1, 'dirt', '#minecraft:replaceable');
          add(x, z, y - a, y - a, 'grass_block', '#minecraft:replaceable');
          stats.fill += y - a - c.G;
        }
      }

    const merged = [];
    for (const [k, xs] of runs) {
      const [y1, y2, block, replace, z] = k.split('|');
      xs.sort((a, b) => a - b);
      let s = xs[0], p = xs[0];
      for (const x of [...xs.slice(1), Infinity]) {
        if (x === p + 1) {
          p = x;
          continue;
        }
        merged.push({ air: block === 'air', cmd: `fill ${s} ${y1} ${z} ${p} ${y2} ${z} ${block}${replace ? ` replace ${replace}` : ''}` });
        s = p = x;
      }
    }
    const out = [];
    out.push(...merged.filter((m) => m.air).map((m) => m.cmd)); // clearing first, then supports
    out.push(...merged.filter((m) => !m.air).map((m) => m.cmd));
    out.push(...singles);
    out.push(`fill ${r.x1} ${y} ${r.z1} ${r.x2} ${y} ${r.z2} ${street.main}`);
    out.push(`fill ${r.x1 + 2} ${y} ${r.z1 + 2} ${r.x2 - 2} ${y} ${r.z2 - 2} grass_block`);
    for (const [sx, sz, block] of street.texture) out.push(`setblock ${sx} ${y} ${sz} ${block}`);
    for (const [x, z] of deck) out.push(`setblock ${x} ${y} ${z} ${edge(x, z) >= 2 && rng.chance(0.15) ? 'stripped_spruce_wood' : 'spruce_planks'}`);
    for (const [x, z] of railing) out.push(`setblock ${x} ${y + 1} ${z} stone_brick_wall`);
    // Walk-out fallback until the generators build their own: a cellar door in the downhill retaining wall.
    if (cellar && (mode === 'walkout' || mode === 'terrace')) out.push(...cellarOps(wallRuns, y, plan.aspect, rng));
    stats.cmds = out.length;
    return { cmds: out, stats };
  }
}

/** A cellar behind the retaining wall: door, barrels and a lantern (only where the wall is >= 5 high). */
function cellarOps(wallRuns, y, aspect, rng) {
  const bySide = {};
  for (const w of wallRuns) (bySide[w.side] ??= []).push(w);
  const side = bySide[aspect]?.length ? aspect : Object.keys(bySide).sort((a, b) => bySide[b].length - bySide[a].length)[0];
  const list = (bySide[side] ?? []).sort((a, b) => a.x - b.x || a.z - b.z);
  if (list.length < 3) return [];
  const [dx, dz] = SIDES[side];
  const order = [...list.keys()].sort((a, b) => Math.abs(a - list.length / 2) - Math.abs(b - list.length / 2)); // middle first
  for (const k of order) {
    const run = [list[k - 1], list[k], list[k + 1]];
    if (run.some((w) => !w || w.h < 5) || new Set(run.map((w) => w.G)).size > 1) continue;
    const { x, z, G } = list[k];
    if (y - 1 < G + 5) continue;
    const ax = dz !== 0 ? 1 : 0, az = dx !== 0 ? 1 : 0; // along the wall
    const ix = -dx, iz = -dz; // into the lot
    const out = [];
    const box = (u1, u2, v1, v2, h1, h2, block) => {
      const xs = [x + ax * u1 + ix * v1, x + ax * u2 + ix * v2], zs = [z + az * u1 + iz * v1, z + az * u2 + iz * v2];
      out.push(`fill ${Math.min(...xs)} ${h1} ${Math.min(...zs)} ${Math.max(...xs)} ${h2} ${Math.max(...zs)} ${block}`);
    };
    box(-2, 2, 1, 4, G, G + 4, 'cobblestone'); // vault shell
    box(-1, 1, 1, 3, G + 1, G + 3, 'air');
    box(-1, 1, 1, 3, G, G, 'spruce_planks');
    const facing = { N: 'north', S: 'south', E: 'east', W: 'west' }[side];
    out.push(`setblock ${x} ${G + 1} ${z} spruce_door[facing=${facing},half=lower,hinge=left,open=false]`);
    out.push(`setblock ${x} ${G + 2} ${z} spruce_door[facing=${facing},half=upper,hinge=left,open=false]`);
    out.push(`setblock ${x - ax + ix * 3} ${G + 1} ${z - az + iz * 3} barrel[facing=up]`);
    out.push(`setblock ${x + ax + ix * 3} ${G + 1} ${z + az + iz * 3} barrel[facing=up]`);
    out.push(`setblock ${x + ax + ix * 2} ${G + 1} ${z + az + iz * 2} barrel[facing=${facing}]`);
    out.push(`setblock ${x + ix * 2} ${G + 3} ${z + iz * 2} lantern[hanging=true]`);
    out.push(`setblock ${x + dx} ${G} ${z + dz} cobblestone`); // doorstep
    out.push(`setblock ${x + ax * 2 + dx} ${G + 1} ${z + az * 2 + dz} lantern keep`);
    if (rng.chance(0.6)) out.push(`setblock ${x - ax * 2 + dx} ${G + 1} ${z - az * 2 + dz} potted_red_tulip keep`);
    return out;
  }
  return [];
}
