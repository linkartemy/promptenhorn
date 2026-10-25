// Terrain helpers: surface probing, choosing a valley for the city, terraced plot preparation
// and reference-counted chunk force-loading.

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
