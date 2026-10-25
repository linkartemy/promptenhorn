// Terrain analysis straight from Anvil region files (prototype, read-only).
//
// The bridge today learns the ground by probing with spreadplayers (a few RCON round trips per point).
// This module reads the world from disk instead: per column it knows the natural ground height (ignoring
// trees, plants, snow layers and our own streets), water depth and type (ocean / river / lake / pond /
// swamp), trees, ground material and biome. On top of that it classifies plot cells (21x21, aligned to the
// city grid) as flat / gentle / steep / cliff / water / shoreline / river crossing / forest and proposes
// how a cell could be built without shaving the mountain off (level, terraces, walk-out, stilts, pier…).
//
//   import { TerrainScanner, analyze, classifyCells } from './terrain-scan.mjs';
//   const scanner = new TerrainScanner(worldDir);           // keep one: it caches decoded chunks
//   const grid = scanner.scan({ x1, z1, x2, z2 });          // per-column data
//   const an = analyze(grid);                               // slope, water bodies, distances
//   const cells = classifyCells(an, { origin: [cx, cz] });  // per plot cell
//
// Robust to a server writing the region files concurrently: only the 8 KiB header and the sectors of the
// wanted chunks are read; a chunk that fails to decode is re-read up to 3 times and otherwise the last good
// copy (or "unknown") is used. Chunks are cached by the per-chunk timestamp in the region header, so
// re-scanning an area after `save-all` only decodes what actually changed.
import fs from 'node:fs';
import path from 'node:path';
import { readChunkBuffer } from '../tools/lib/anvil.mjs';
import { parseNBT } from '../tools/lib/nbt.mjs';

export const PLOT = 21;
const NONE = -32768;

// ------------------------------------------------------------------ block categories

export const CAT = { AIR: 0, PLANT: 1, LEAVES: 2, LOG: 3, WATER: 4, ICE: 5, GROUND: 6, BUILT: 7, LAVA: 8 };
// Ground material of a column (what the surface is made of).
export const KIND = ['unknown', 'grass', 'dirt', 'sand', 'gravel', 'stone', 'snow', 'clay', 'mud', 'ice', 'built', 'lava'];
const K = Object.fromEntries(KIND.map((k, i) => [k, i]));

const AIRS = new Set(['air', 'cave_air', 'void_air', 'light', 'structure_void']);
const WATERS = new Set(['water', 'bubble_column', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant']);
const PLANTS = new Set(['short_grass', 'grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'dandelion', 'poppy', 'blue_orchid',
  'allium', 'azure_bluet', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose', 'sunflower', 'lilac', 'rose_bush', 'peony',
  'torchflower', 'pitcher_plant', 'pink_petals', 'wildflowers', 'leaf_litter', 'bush', 'firefly_bush', 'short_dry_grass', 'tall_dry_grass',
  'cactus', 'cactus_flower', 'sweet_berry_bush', 'sugar_cane', 'bamboo', 'bamboo_sapling', 'vine', 'glow_lichen', 'moss_carpet',
  'pale_moss_carpet', 'pale_hanging_moss', 'snow', 'brown_mushroom', 'red_mushroom', 'lily_pad', 'cave_vines', 'cave_vines_plant',
  'hanging_roots', 'spore_blossom', 'big_dripleaf', 'big_dripleaf_stem', 'small_dripleaf', 'azalea', 'flowering_azalea', 'cocoa',
  'pumpkin', 'melon', 'sea_pickle', 'mangrove_roots', 'twisting_vines', 'weeping_vines', 'closed_eyeblossom', 'open_eyeblossom',
  'eyeblossom', 'creaking_heart', 'bee_nest', 'resin_clump', 'pointed_dripstone']);
const TREE_RE = /(_log|_wood|_stem|_hyphae|mushroom_block|mushroom_stem)$/;
const PLANT_RE = /(_sapling|_tulip|_propagule|coral|coral_fan|_flower|_vines)$/;
const GROUND = {
  grass: ['grass_block', 'moss_block', 'pale_moss_block', 'podzol', 'mycelium'],
  dirt: ['dirt', 'coarse_dirt', 'rooted_dirt', 'farmland', 'dirt_path'],
  sand: ['sand', 'red_sand', 'suspicious_sand', 'sandstone', 'red_sandstone'],
  gravel: ['gravel', 'suspicious_gravel'],
  stone: ['stone', 'granite', 'diorite', 'andesite', 'deepslate', 'tuff', 'calcite', 'dripstone_block', 'smooth_basalt', 'basalt',
    'bedrock', 'obsidian', 'magma_block', 'amethyst_block', 'budding_amethyst', 'terracotta', 'sculk', 'infested_stone', 'raw_iron_block',
    'raw_copper_block'],
  snow: ['snow_block', 'powder_snow'],
  clay: ['clay'],
  mud: ['mud', 'muddy_mangrove_roots', 'packed_mud'],
  ice: ['packed_ice', 'blue_ice'],
};
const GROUND_KIND = new Map();
for (const [kind, names] of Object.entries(GROUND)) for (const n of names) GROUND_KIND.set(n, K[kind]);

/** Category and ground kind of a block state (names without the minecraft: prefix). */
export function blockCategory(name, props = {}) {
  if (AIRS.has(name)) return [CAT.AIR, 0];
  if (WATERS.has(name)) return [CAT.WATER, 0];
  if (name === 'lava') return [CAT.LAVA, K.lava];
  if (name === 'ice' || name === 'frosted_ice') return [CAT.ICE, K.ice];
  if (name.endsWith('_leaves')) return [CAT.LEAVES, 0];
  if (TREE_RE.test(name) && !name.startsWith('stripped_')) return [CAT.LOG, 0];
  if (PLANTS.has(name) || PLANT_RE.test(name)) return [props.waterlogged === 'true' ? CAT.WATER : CAT.PLANT, name === 'snow' ? K.snow : 0];
  const g = GROUND_KIND.get(name) ?? (/_ore$/.test(name) || /_terracotta$/.test(name) && !name.includes('glazed') ? K.stone : undefined);
  if (g !== undefined) return [CAT.GROUND, g];
  return [CAT.BUILT, K.built];
}

// Biome groups.
export const isOceanBiome = (b) => b.includes('ocean');
export const isRiverBiome = (b) => b.includes('river');
export const isSwampBiome = (b) => b.includes('swamp');
export const isBeachBiome = (b) => b.includes('beach') || b === 'stony_shore';

// Chunk generation statuses in order; terrain heights are valid from `noise` on, trees from `features`.
const STATUS = ['empty', 'structure_starts', 'structure_references', 'biomes', 'noise', 'surface', 'carvers', 'features',
  'initialize_light', 'light', 'spawn', 'full'];
const statusRank = (s) => STATUS.indexOf(String(s ?? '').replace(/^minecraft:/, ''));
const RANK_NOISE = STATUS.indexOf('noise');
const RANK_FEATURES = STATUS.indexOf('features');

// ------------------------------------------------------------------ chunk decoding

// Column flags.
export const F = { TREE: 1, BUILT: 2, FROZEN: 4, SNOW: 8, PROTO: 16, NO_TREES_YET: 32, LAVA: 64 };

function bitsFor(paletteLen, dataLen, min) {
  let bits = Math.max(min, Math.ceil(Math.log2(paletteLen)));
  if (Math.ceil(4096 / Math.floor(64 / bits)) !== dataLen && min === 4) {
    for (let b = 1; b <= 32; b++) if (Math.ceil(4096 / Math.floor(64 / b)) === dataLen && (1 << b) >= paletteLen) return b;
  }
  return bits;
}

function unpack(longs, bits, count) {
  const out = new Uint16Array(count);
  const epl = Math.floor(64 / bits);
  const mask = bits >= 32 ? 0xffffffff : (1 << bits) - 1;
  let i = 0;
  for (let li = 0; li < longs.length && i < count; li++) {
    const hi = longs.hi(li), lo = longs.lo(li);
    for (let k = 0; k < epl && i < count; k++, i++) {
      const off = k * bits;
      out[i] = off + bits <= 32 ? (lo >>> off) & mask : off >= 32 ? (hi >>> (off - 32)) & mask : ((lo >>> off) | (hi << (32 - off))) & mask;
    }
  }
  return out;
}

/**
 * Per-chunk column summary (256 columns, index lz*16+lx):
 *   ground  natural ground height (top of the first solid non-tree, non-plant block; streets count as ground)
 *   water   y of the water surface or NONE; depth = water blocks above the ground
 *   canopy  highest tree block (leaves/log) or NONE
 *   kind    ground material (KIND index), biome (index into scanner.biomes), flags (F)
 */
class ChunkSummary {
  constructor() {
    this.ground = new Int16Array(256).fill(NONE);
    this.water = new Int16Array(256).fill(NONE);
    this.depth = new Uint8Array(256);
    this.canopy = new Int16Array(256).fill(NONE);
    this.kind = new Uint8Array(256);
    this.biome = new Uint8Array(256);
    this.flags = new Uint8Array(256);
    this.valid = false;
  }
}

export class TerrainScanner {
  /** worldDir: the world folder (containing region/), or the region folder itself. */
  constructor(worldDir, { retries = 3 } = {}) {
    const region = path.join(worldDir, 'region');
    this.regionDir = fs.existsSync(region) ? region : worldDir;
    this.retries = retries;
    this.cache = new Map(); // "cx,cz" -> { stamp, summary }
    this.states = new Map(); // block state key -> [cat, kind]
    this.biomes = []; // index -> name
    this.biomeIndex = new Map();
    this.stats = { decoded: 0, cached: 0, missing: 0, proto: 0, failed: 0, ms: 0 };
  }

  #biome(name) {
    const short = name.replace(/^minecraft:/, '');
    let i = this.biomeIndex.get(short);
    if (i === undefined) {
      i = this.biomes.length;
      this.biomes.push(short);
      this.biomeIndex.set(short, i);
    }
    return i;
  }

  #state(e) {
    const name = e.Name.replace(/^minecraft:/, '');
    const wl = e.Properties?.waterlogged === 'true';
    const key = wl ? name + '~wl' : name;
    let v = this.states.get(key);
    if (!v) {
      v = blockCategory(name, e.Properties ?? {});
      this.states.set(key, v);
    }
    return v;
  }

  /** Reads one region's header + the chunks in `list` ([cx, cz][]) and refreshes the cache. */
  #loadRegion(rx, rz, list) {
    const file = path.join(this.regionDir, `r.${rx}.${rz}.mca`);
    let fd;
    try {
      fd = fs.openSync(file, 'r');
    } catch {
      for (const [cx, cz] of list) this.#put(cx, cz, 0, null);
      return;
    }
    try {
      for (const [cx, cz] of list) {
        let summary = null;
        let stamp = 0;
        for (let attempt = 0; attempt <= this.retries; attempt++) {
          try {
            const head = Buffer.alloc(8192);
            if (fs.readSync(fd, head, 0, 8192, 0) < 8192) break; // empty / fresh region file
            const idx = ((cx & 31) + (cz & 31) * 32) * 4;
            const loc = head.readUInt32BE(idx);
            stamp = head.readUInt32BE(4096 + idx);
            if (!loc) break; // chunk not generated
            const old = this.cache.get(`${cx},${cz}`);
            if (old && old.stamp === stamp && old.loc === loc) {
              this.stats.cached++;
              summary = old.summary;
              break;
            }
            const sectors = loc & 0xff;
            const data = Buffer.alloc(sectors * 4096);
            fs.readSync(fd, data, 0, data.length, (loc >>> 8) * 4096);
            // Re-wrap as a tiny one-chunk region so anvil.mjs handles every compression type (and .mcc files).
            const synth = Buffer.alloc(8192 + data.length);
            synth.writeUInt32BE((2 << 8) | sectors, idx);
            data.copy(synth, 8192);
            summary = this.#decode(parseNBT(readChunkBuffer(synth, this.regionDir, cx, cz)));
            this.stats.decoded++;
            this.cache.set(`${cx},${cz}`, { stamp, loc, summary });
            break;
          } catch (err) {
            if (attempt === this.retries) {
              this.stats.failed++;
              summary = this.cache.get(`${cx},${cz}`)?.summary ?? null; // keep the last good copy
            } else {
              const until = Date.now() + 40 * (attempt + 1);
              while (Date.now() < until); // the server is mid-write; give it a moment (sync on purpose)
            }
          }
        }
        if (!summary) this.stats.missing++;
        if (!this.cache.has(`${cx},${cz}`)) this.cache.set(`${cx},${cz}`, { stamp, loc: 0, summary });
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  #put(cx, cz, stamp, summary) {
    if (!summary) this.stats.missing++;
    this.cache.set(`${cx},${cz}`, { stamp, loc: 0, summary });
  }

  #decode(nbt) {
    const root = nbt.Level && !nbt.sections ? nbt.Level : nbt;
    const rank = statusRank(root.Status);
    const s = new ChunkSummary();
    if (rank >= 0 && rank < RANK_NOISE) return s; // no terrain yet: all unknown
    if (rank >= 0 && rank < STATUS.indexOf('full')) this.stats.proto++;
    const protoFlags = (rank >= 0 && rank < STATUS.indexOf('full') ? F.PROTO : 0) | (rank >= 0 && rank < RANK_FEATURES ? F.NO_TREES_YET : 0);
    // Sections, top to bottom: block palette -> [cat, kind], data unpacked lazily.
    const secs = [];
    for (const sec of root.sections ?? root.Sections ?? []) {
      const bs = sec.block_states;
      if (!bs?.palette?.length) continue;
      const pal = bs.palette.map((e) => this.#state(e));
      const bio = sec.biomes;
      let bioPal = null, bioIdx = null;
      if (bio?.palette?.length) {
        bioPal = bio.palette.map((b) => this.#biome(typeof b === 'string' ? b : String(b)));
        if (bio.palette.length > 1 && bio.data?.length) bioIdx = unpack(bio.data, Math.ceil(Math.log2(bio.palette.length)), 64);
      }
      secs.push({ y: sec.Y, pal, bs, idx: null, bioPal, bioIdx });
    }
    secs.sort((a, b) => b.y - a.y);
    const blockAt = (sec, i) => {
      if (sec.pal.length === 1 || !sec.bs.data?.length) return sec.pal[0];
      if (!sec.idx) sec.idx = unpack(sec.bs.data, bitsFor(sec.pal.length, sec.bs.data.length, 4), 4096);
      return sec.pal[sec.idx[i]] ?? sec.pal[0];
    };
    const biomeAt = (lx, y, lz) => {
      const sy = y >> 4;
      const sec = secs.find((q) => q.y === sy && q.bioPal) ?? secs.find((q) => q.bioPal);
      if (!sec) return this.#biome('unknown');
      if (!sec.bioIdx) return sec.bioPal[0];
      return sec.bioPal[sec.bioIdx[(((y & 15) >> 2) << 4) | ((lz >> 2) << 2) | (lx >> 2)]] ?? sec.bioPal[0];
    };
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const c = lz * 16 + lx;
        let flags = protoFlags;
        let ground = NONE, water = NONE, depth = 0, canopy = NONE, kind = K.unknown, builtTop = NONE;
        scan: for (const sec of secs) {
          if (sec.pal.length === 1 && sec.pal[0][0] === CAT.AIR) continue;
          for (let ly = 15; ly >= 0; ly--) {
            const y = sec.y * 16 + ly;
            const [cat, k] = blockAt(sec, (ly << 8) | (lz << 4) | lx);
            switch (cat) {
              case CAT.AIR:
                if (water !== NONE && depth > 0) break scan; // air under water: an overhang; stop at the water
                continue;
              case CAT.PLANT: // flowers, grass, snow layers…: not ground
                if (k === K.snow) flags |= F.SNOW;
                continue;
              case CAT.LEAVES:
              case CAT.LOG:
                if (canopy === NONE) canopy = y;
                flags |= F.TREE;
                continue;
              case CAT.WATER:
                if (water === NONE) water = y;
                depth++;
                continue;
              case CAT.ICE:
                flags |= F.FROZEN;
                if (water === NONE) water = y;
                depth++;
                continue;
              case CAT.LAVA:
                flags |= F.LAVA;
                ground = y;
                kind = K.lava;
                break scan;
              case CAT.BUILT:
                // Our own streets / houses: remember them, but keep looking for natural ground a little lower.
                flags |= F.BUILT;
                if (builtTop === NONE) builtTop = y;
                if (builtTop - y > 24) {
                  ground = builtTop;
                  kind = K.built;
                  break scan;
                }
                continue;
              default: // GROUND
                ground = y;
                kind = k;
                break scan;
            }
          }
        }
        if (ground === NONE && builtTop !== NONE) [ground, kind] = [builtTop, K.built];
        if (flags & F.BUILT && builtTop !== NONE && builtTop - ground <= 2) {
          // A street or floor sitting on the ground: the paving is the surface.
          ground = builtTop;
          kind = K.built;
        }
        if (water !== NONE && ground === NONE) ground = water - depth;
        if (canopy !== NONE && water !== NONE) canopy = canopy > water ? canopy : NONE;
        s.ground[c] = ground;
        s.water[c] = water;
        s.depth[c] = Math.min(255, depth);
        s.canopy[c] = canopy;
        s.kind[c] = kind;
        if (ground !== NONE) {
          s.biome[c] = biomeAt(lx, (water !== NONE ? water : ground), lz);
        }
        s.flags[c] = flags;
      }
    }
    s.valid = true;
    return s;
  }

  /** Makes sure all chunks covering the rect are decoded (or known missing). */
  load(r) {
    const t0 = Date.now();
    const byRegion = new Map();
    for (let cx = r.x1 >> 4; cx <= r.x2 >> 4; cx++)
      for (let cz = r.z1 >> 4; cz <= r.z2 >> 4; cz++) {
        const rk = `${cx >> 5},${cz >> 5}`;
        if (!byRegion.has(rk)) byRegion.set(rk, []);
        byRegion.get(rk).push([cx, cz]);
      }
    for (const [rk, list] of byRegion) {
      const [rx, rz] = rk.split(',').map(Number);
      this.#loadRegion(rx, rz, list);
    }
    this.stats.ms += Date.now() - t0;
  }

  /** Per-column grid for a rect (inclusive block coords). Re-reads region headers, decodes changed chunks only. */
  scan(r) {
    this.load(r);
    const W = r.x2 - r.x1 + 1, D = r.z2 - r.z1 + 1, n = W * D;
    const g = {
      rect: { ...r }, W, D, biomes: this.biomes,
      ground: new Int16Array(n).fill(NONE), water: new Int16Array(n).fill(NONE), depth: new Uint8Array(n),
      canopy: new Int16Array(n).fill(NONE), kind: new Uint8Array(n), biome: new Uint8Array(n), flags: new Uint8Array(n),
    };
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        const wx = r.x1 + x, wz = r.z1 + z;
        const s = this.cache.get(`${wx >> 4},${wz >> 4}`)?.summary;
        if (!s?.valid) continue;
        const c = (wz & 15) * 16 + (wx & 15), i = z * W + x;
        g.ground[i] = s.ground[c];
        g.water[i] = s.water[c];
        g.depth[i] = s.depth[c];
        g.canopy[i] = s.canopy[c];
        g.kind[i] = s.kind[c];
        g.biome[i] = s.biome[c];
        g.flags[i] = s.flags[c];
      }
    }
    return g;
  }
}

// ------------------------------------------------------------------ column analysis

export const WT = ['none', 'ocean', 'river', 'lake', 'pond', 'swamp'];
const W_ = Object.fromEntries(WT.map((k, i) => [k, i]));

/** BFS distance (Chebyshev, capped) from every column in `src` over columns where `walk` is true. */
function distance(W, D, isSrc, walk, cap = 64) {
  const dist = new Uint8Array(W * D).fill(255);
  let q = [];
  for (let i = 0; i < W * D; i++) if (isSrc(i)) { dist[i] = 0; q.push(i); }
  for (let d = 1; d <= cap && q.length; d++) {
    const next = [];
    for (const i of q) {
      const x = i % W, z = (i / W) | 0;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= W || nz >= D) continue;
          const j = nz * W + nx;
          if (dist[j] !== 255 || !walk(j)) continue;
          dist[j] = d;
          next.push(j);
        }
    }
    q = next;
  }
  return dist;
}

/**
 * Derived per-column layers: smoothed height, slope, max step to a neighbour, water bodies with types,
 * distance from land to water (`shore`) and from water to land (`offshore`, i.e. half the local width).
 */
export function analyze(g, { pondMax = 80 } = {}) {
  const { W, D, ground, water, depth, flags, biome, biomes } = g;
  const n = W * D;
  const known = (i) => ground[i] !== NONE;
  // Water held by our own blocks (fountains, basins) is not a water body.
  const isWater = (i) => water[i] !== NONE && depth[i] > 0 && g.kind[i] !== K.built;
  // Surface height: water surface where wet, ground elsewhere.
  const surf = new Float32Array(n).fill(NaN);
  for (let i = 0; i < n; i++) if (known(i)) surf[i] = isWater(i) ? water[i] : ground[i];

  // Slope on a 3x3-smoothed surface (central differences); step = largest drop to a 4-neighbour (raw ground).
  const smooth = new Float32Array(n).fill(NaN);
  for (let z = 0; z < D; z++)
    for (let x = 0; x < W; x++) {
      let s = 0, c = 0;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= W || nz >= D) continue;
          const v = surf[nz * W + nx];
          if (!Number.isNaN(v)) { s += v; c++; }
        }
      if (c && !Number.isNaN(surf[z * W + x])) smooth[z * W + x] = s / c;
    }
  const slope = new Float32Array(n).fill(NaN);
  const step = new Uint8Array(n);
  const at = (arr, x, z, fb) => (x < 0 || z < 0 || x >= W || z >= D || Number.isNaN(arr[z * W + x]) ? fb : arr[z * W + x]);
  for (let z = 0; z < D; z++)
    for (let x = 0; x < W; x++) {
      const i = z * W + x;
      const h = smooth[i];
      if (Number.isNaN(h)) continue;
      const gx = (at(smooth, x + 1, z, h) - at(smooth, x - 1, z, h)) / 2;
      const gz = (at(smooth, x, z + 1, h) - at(smooth, x, z - 1, h)) / 2;
      slope[i] = Math.hypot(gx, gz);
      const hs = surf[i];
      let m = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) m = Math.max(m, Math.abs(at(surf, x + dx, z + dz, hs) - hs));
      step[i] = Math.min(255, m);
    }

  // Water bodies: 4-connected components of wet columns.
  const body = new Int32Array(n).fill(-1);
  const bodies = [];
  for (let i0 = 0; i0 < n; i0++) {
    if (!isWater(i0) || body[i0] >= 0) continue;
    const id = bodies.length;
    const b = { id, area: 0, ocean: 0, river: 0, swamp: 0, minY: Infinity, maxY: -Infinity, maxDepth: 0, sx: 0, sz: 0, x1: W, z1: D, x2: 0, z2: 0, edge: false, frozen: 0 };
    const stack = [i0];
    body[i0] = id;
    while (stack.length) {
      const i = stack.pop();
      const x = i % W, z = (i / W) | 0;
      b.area++;
      const bn = biomes[biome[i]] ?? '';
      if (isOceanBiome(bn)) b.ocean++;
      else if (isRiverBiome(bn)) b.river++;
      else if (isSwampBiome(bn)) b.swamp++;
      if (flags[i] & F.FROZEN) b.frozen++;
      b.minY = Math.min(b.minY, water[i]);
      b.maxY = Math.max(b.maxY, water[i]);
      b.maxDepth = Math.max(b.maxDepth, depth[i]);
      b.sx += x; b.sz += z;
      b.x1 = Math.min(b.x1, x); b.x2 = Math.max(b.x2, x); b.z1 = Math.min(b.z1, z); b.z2 = Math.max(b.z2, z);
      if (x === 0 || z === 0 || x === W - 1 || z === D - 1) b.edge = true;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= D) continue;
        const j = nz * W + nx;
        if (body[j] < 0 && isWater(j)) { body[j] = id; stack.push(j); }
      }
    }
    b.type = b.ocean / b.area >= 0.3 ? 'ocean' : b.river / b.area >= 0.3 ? 'river' : b.swamp / b.area >= 0.5 ? 'swamp' : b.area > pondMax || b.edge ? 'lake' : 'pond';
    bodies.push(b);
  }
  // Column water type: its own biome first (an ocean bay joined to a river stays ocean near the coast), then the body.
  const wtype = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (body[i] < 0) continue;
    const bn = biomes[biome[i]] ?? '';
    const b = bodies[body[i]];
    wtype[i] = isOceanBiome(bn) ? W_.ocean : isRiverBiome(bn) && b.type !== 'ocean' ? W_.river : W_[b.type];
  }
  const shore = distance(W, D, (i) => isWater(i), (i) => known(i) && !isWater(i), 48); // land -> nearest water
  const offshore = distance(W, D, (i) => known(i) && !isWater(i), (i) => isWater(i), 48); // water -> nearest land
  for (const b of bodies) {
    b.cx = g.rect.x1 + Math.round(b.sx / b.area);
    b.cz = g.rect.z1 + Math.round(b.sz / b.area);
    b.bbox = [g.rect.x1 + b.x1, g.rect.z1 + b.z1, g.rect.x1 + b.x2, g.rect.z1 + b.z2];
    let wmax = 0;
    for (let i = 0; i < n; i++) if (body[i] === b.id && offshore[i] !== 255) wmax = Math.max(wmax, offshore[i]);
    b.halfWidth = wmax; // ~ half of the widest place
  }
  return { g, surf, smooth, slope, step, body, bodies, wtype, shore, offshore, isWater };
}

// ------------------------------------------------------------------ cells

export const CLASSES = ['unknown', 'built', 'flat', 'gentle', 'steep', 'cliff', 'water', 'shoreline', 'river_crossing', 'forest'];

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];

/** Least-squares plane h = a + b*x + c*z over points [x, z, h]; returns {b, c, slope, rms}. */
function planeFit(pts) {
  let sx = 0, sz = 0, sh = 0, sxx = 0, szz = 0, sxz = 0, sxh = 0, szh = 0;
  const m = pts.length;
  for (const [x, z, h] of pts) { sx += x; sz += z; sh += h; sxx += x * x; szz += z * z; sxz += x * z; sxh += x * h; szh += z * h; }
  const mx = sx / m, mz = sz / m, mh = sh / m;
  const cxx = sxx / m - mx * mx, czz = szz / m - mz * mz, cxz = sxz / m - mx * mz, cxh = sxh / m - mx * mh, czh = szh / m - mz * mh;
  const det = cxx * czz - cxz * cxz;
  const b = det ? (cxh * czz - czh * cxz) / det : 0;
  const c = det ? (czh * cxx - cxh * cxz) / det : 0;
  let r2 = 0;
  for (const [x, z, h] of pts) r2 += (h - (mh + b * (x - mx) + c * (z - mz))) ** 2;
  return { b, c, slope: Math.hypot(b, c), rms: Math.sqrt(r2 / m) };
}

const aspectOf = (b, c) => (Math.abs(b) >= Math.abs(c) ? (b > 0 ? 'W' : 'E') : c > 0 ? 'N' : 'S'); // downhill direction

/**
 * How a lot could be built within the earthwork budget (max cut / max fill per column, blocks):
 *   level     one platform                          terrace2/3  2-3 platforms stepped along the slope
 *   walkout   one platform uphill + exposed basement downhill (relief up to 2*budget+4)
 *   stilts    floor near the top, posts down to the ground (fill would exceed budget, cut stays small)
 *   natural   leave it alone (path, viewpoint, meadow)
 * `hs` is the land height list of the lot interior as [x, z, h] in lot coordinates (0..n-1).
 */
export function platformPlan(pts, n, aspect, { budget = 3, stiltMax = 9 } = {}) {
  if (pts.length < n * n * 0.6) return { mode: 'natural', reason: 'not enough land' };
  const level = (list) => {
    const hs = list.map((p) => p[2]).sort((a, b) => a - b);
    const lo = pct(hs, 0.02), hi = pct(hs, 0.98);
    const y = Math.round((lo + hi) / 2);
    let cut = 0, fill = 0;
    for (const h of hs) { if (h > y) cut += h - y; else fill += y - h; }
    return { y, maxCut: hi - y, maxFill: y - lo, cut, fill, relief: hi - lo };
  };
  const one = level(pts);
  if (one.maxCut <= budget && one.maxFill <= budget) return { mode: 'level', levels: [one.y], ...one };
  // Bands across the slope: coordinate along the downhill axis.
  const along = (p) => (aspect === 'E' ? p[0] : aspect === 'W' ? n - 1 - p[0] : aspect === 'S' ? p[1] : n - 1 - p[1]);
  for (const k of [2, 3]) {
    const bands = Array.from({ length: k }, () => []);
    for (const p of pts) bands[Math.min(k - 1, Math.floor((along(p) * k) / n))].push(p);
    if (bands.some((b) => b.length < 10)) continue;
    const lv = bands.map(level);
    if (lv.every((l) => l.maxCut <= budget && l.maxFill <= budget)) {
      const steps = lv.slice(1).map((l, i) => lv[i].y - l.y);
      if (steps.every((s) => Math.abs(s) <= 6))
        return { mode: `terrace${k}`, levels: lv.map((l) => l.y), steps, maxCut: Math.max(...lv.map((l) => l.maxCut)), maxFill: Math.max(...lv.map((l) => l.maxFill)), cut: lv.reduce((s, l) => s + l.cut, 0), fill: lv.reduce((s, l) => s + l.fill, 0), relief: one.relief };
    }
  }
  if (one.relief <= 2 * budget + 4) return { mode: 'walkout', levels: [one.y + 2, one.y - 2], maxCut: Math.max(0, one.maxCut - 2), maxFill: Math.max(0, one.maxFill - 2), cut: one.cut, fill: one.fill, relief: one.relief };
  const hs = pts.map((p) => p[2]).sort((a, b) => a - b);
  const top = pct(hs, 0.85);
  if (top - hs[0] <= stiltMax) return { mode: 'stilts', levels: [top], maxCut: pct(hs, 0.98) - top, maxFill: 0, posts: top - hs[0], relief: one.relief };
  return { mode: 'natural', reason: 'too steep for budget', relief: one.relief };
}

/**
 * Classifies the plot cells covering the scanned area. origin = city centre [cx, cz] (cell [0,0] spans
 * cx-10..cx+10, like plotRect in city.mjs). Returns a Map "i,j" -> cell info.
 */
export function classifyCells(an, { origin, plot = PLOT, budget = 3, ring = 2 } = {}) {
  const { g, surf, slope, step, wtype, shore, offshore, isWater } = an;
  const { W, D, ground, flags, kind, canopy } = g;
  const [ox, oz] = origin ?? [g.rect.x1 + 10, g.rect.z1 + 10];
  const i1 = Math.ceil((g.rect.x1 - (ox - 10)) / plot), i2 = Math.floor((g.rect.x2 - (ox - 10) - plot + 1) / plot);
  const j1 = Math.ceil((g.rect.z1 - (oz - 10)) / plot), j2 = Math.floor((g.rect.z2 - (oz - 10) - plot + 1) / plot);
  const cells = new Map();
  for (let j = j1; j <= j2; j++)
    for (let i = i1; i <= i2; i++) {
      const x0 = ox - 10 + i * plot - g.rect.x1, z0 = oz - 10 + j * plot - g.rect.z1;
      const c = { i, j, x1: x0 + g.rect.x1, z1: z0 + g.rect.z1, x2: x0 + g.rect.x1 + plot - 1, z2: z0 + g.rect.z1 + plot - 1 };
      let unknown = 0, wet = 0, trees = 0, built = 0, steepCols = 0, cliffCols = 0, shoreCols = 0, sand = 0, snow = 0, proto = 0;
      const wcount = new Array(WT.length).fill(0);
      let maxDepth = 0, maxOff = 0, riverMaxOff = 0;
      const land = [], inner = [];
      const edgeWater = { N: 0, S: 0, E: 0, W: 0 };
      const edgeLand = { N: 0, S: 0, E: 0, W: 0 };
      for (let dz = 0; dz < plot; dz++)
        for (let dx = 0; dx < plot; dx++) {
          const x = x0 + dx, z = z0 + dz;
          const idx = z * W + x;
          if (ground[idx] === NONE) { unknown++; continue; }
          if (flags[idx] & F.PROTO) proto++;
          const edges = [dz === 0 && 'N', dz === plot - 1 && 'S', dx === 0 && 'W', dx === plot - 1 && 'E'].filter(Boolean);
          if (isWater(idx)) {
            wet++;
            wcount[wtype[idx]]++;
            maxDepth = Math.max(maxDepth, g.depth[idx]);
            if (offshore[idx] !== 255) maxOff = Math.max(maxOff, offshore[idx]);
            if (WT[wtype[idx]] === 'river' && offshore[idx] !== 255) riverMaxOff = Math.max(riverMaxOff, offshore[idx]);
            for (const e of edges) edgeWater[e]++;
            continue;
          }
          for (const e of edges) edgeLand[e]++;
          land.push([dx, dz, ground[idx]]);
          if (dx >= ring && dz >= ring && dx < plot - ring && dz < plot - ring) inner.push([dx - ring, dz - ring, ground[idx]]);
          if (flags[idx] & F.TREE) trees++;
          if (flags[idx] & F.BUILT || kind[idx] === K.built) built++;
          if (kind[idx] === K.sand) sand++;
          if (kind[idx] === K.snow || flags[idx] & F.SNOW) snow++;
          if (slope[idx] >= 1) steepCols++;
          if (step[idx] >= 3) cliffCols++;
          if (shore[idx] <= 3) shoreCols++;
        }
      const N = plot * plot;
      const known = N - unknown;
      c.unknownFrac = unknown / N;
      c.waterFrac = known ? wet / known : 0;
      c.water = Object.fromEntries(WT.map((t, k) => [t, wcount[k]]).filter(([t, v]) => t !== 'none' && v));
      c.waterType = wet ? WT[wcount.indexOf(Math.max(...wcount.slice(1)))] : null;
      c.maxDepth = maxDepth;
      c.forestFrac = land.length ? trees / land.length : 0;
      c.builtFrac = land.length ? built / land.length : 0;
      c.sandFrac = land.length ? sand / land.length : 0;
      c.snowFrac = land.length ? snow / land.length : 0;
      c.protoFrac = known ? proto / known : 0;
      c.shoreFrac = known ? shoreCols / known : 0;
      c.edgesToWater = Object.keys(edgeWater).filter((e) => edgeWater[e] >= plot / 3);
      if (land.length >= 12) {
        const hs = land.map((p) => p[2]).sort((a, b) => a - b);
        const fit = planeFit(land);
        c.hMin = hs[0]; c.hMax = hs[hs.length - 1]; c.hMed = pct(hs, 0.5);
        c.relief = pct(hs, 0.95) - pct(hs, 0.05);
        c.slope = +fit.slope.toFixed(3);
        c.rough = +fit.rms.toFixed(2);
        c.aspect = aspectOf(fit.b, fit.c);
        c.steepFrac = steepCols / land.length;
        c.cliffFrac = cliffCols / land.length;
        c.plan = platformPlan(inner, plot - 2 * ring, c.aspect, { budget });
        // Raw lot heights for comparisons (not enumerable: keeps --json small).
        Object.defineProperty(c, 'lotHeights', { value: Int16Array.from(inner.map((p) => p[2])), enumerable: false });
      } else {
        c.plan = { mode: 'none' };
      }
      // ---- class
      const riverish = wcount[W_.river] >= 12 && riverMaxOff <= 8;
      // The river flows through the cell (enters and leaves on opposite edges) with banks on the other two edges.
      const across = (a, b, l1, l2) => edgeWater[a] >= 3 && edgeWater[b] >= 3 && edgeLand[l1] >= 3 && edgeLand[l2] >= 3;
      const opposite = across('W', 'E', 'N', 'S') || across('N', 'S', 'W', 'E');
      let cls;
      if (c.unknownFrac > 0.3) cls = 'unknown';
      else if (c.builtFrac >= 0.35 && c.waterFrac < 0.5) cls = 'built'; // already ours (heights there are roofs and walls)
      else if (riverish && opposite && c.waterFrac < 0.75) cls = 'river_crossing';
      else if (c.waterFrac >= 0.65) cls = 'water';
      else if (c.waterFrac >= 0.06 || c.shoreFrac >= 0.08) cls = 'shoreline';
      else if (c.cliffFrac >= 0.08 || c.relief >= 14) cls = 'cliff';
      else if (c.slope >= 0.33 || c.relief >= 9 || c.steepFrac >= 0.2) cls = 'steep';
      else if (c.slope >= 0.1 || c.relief >= 4) cls = 'gentle';
      else cls = 'flat';
      c.terrain = cls; // the terrain class before the forest overlay
      if ((cls === 'flat' || cls === 'gentle') && c.forestFrac >= 0.45) cls = 'forest';
      c.cls = cls;
      c.built = c.builtFrac >= 0.5;
      c.use = suggestUse(c);
      cells.set(`${i},${j}`, c);
    }
  // Neighbour pass: land cells next to water cells are shoreline too; harbour candidates; a narrow river that
  // fills a whole cell is still a crossing when the cells on both sides are land.
  const landish = (c) => c && !['water', 'unknown'].includes(c.cls);
  for (const c of cells.values()) {
    if (c.cls === 'water' && c.waterType === 'river') {
      const at = (a, b) => cells.get(`${c.i + a},${c.j + b}`);
      if ((landish(at(1, 0)) && landish(at(-1, 0))) || (landish(at(0, 1)) && landish(at(0, -1)))) {
        c.cls = 'river_crossing';
        c.use = suggestUse(c);
      }
    }
    if (['flat', 'gentle', 'forest'].includes(c.cls)) {
      const nWater = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a, b]) => cells.get(`${c.i + a},${c.j + b}`)?.cls === 'water');
      if (nWater.length && c.shoreFrac > 0) {
        c.cls = 'shoreline';
        c.use = suggestUse(c);
      }
    }
    if (c.cls === 'shoreline') {
      // Deep water next door: a harbour can go here (breakwater + quay need depth >= 3 and room to manoeuvre).
      let best = 0;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]]) {
        const n = cells.get(`${c.i + a},${c.j + b}`);
        if (n && n.waterType && n.waterType !== 'river' && n.waterType !== 'pond' && n.maxDepth >= 3) best = Math.max(best, Math.min(n.maxDepth, 8) * (n.waterFrac + 0.2));
      }
      c.harbourScore = +best.toFixed(2);
    }
  }
  return cells;
}

/** What the cell is good for (input for the planner and for the architect's variant choice). */
export function suggestUse(c) {
  const p = c.plan ?? {};
  switch (c.cls) {
    case 'unknown': return 'scan-again';
    case 'built': return 'occupied';
    case 'water':
      return c.waterType === 'river' ? 'river' : c.maxDepth >= 3 ? 'open-water' : 'shallows';
    case 'river_crossing': return (c.relief ?? 0) >= 12 ? 'viaduct' : 'bridge'; // a gorge gets a tall stone viaduct
    case 'shoreline':
      if (c.sandFrac >= 0.25 && (c.slope ?? 0) < 0.2) return 'beach';
      if ((c.relief ?? 0) >= 8) return 'cliff-shore';
      return c.waterType === 'river' ? 'riverside' : 'waterfront';
    case 'cliff': return 'natural';
    case 'forest': return 'park';
    default:
      return p.mode ?? 'natural';
  }
}

/**
 * Harbour sites: shoreline cells with deep, open water next door, greedily picked best-first with at least
 * `spacing` cells between them; candidates near the city centre (cell 0,0) and on gentle land win ties.
 */
export function harbourSites(cells, { count = 3, spacing = 5, minScore = 3 } = {}) {
  const cand = [...cells.values()]
    .filter((c) => c.cls === 'shoreline' && (c.harbourScore ?? 0) >= minScore && c.use !== 'cliff-shore')
    .map((c) => ({ c, s: c.harbourScore - Math.hypot(c.i, c.j) * 0.25 - (c.relief ?? 0) * 0.15 }))
    .sort((a, b) => b.s - a.s);
  const out = [];
  for (const { c } of cand) {
    if (out.some((o) => Math.max(Math.abs(o.i - c.i), Math.abs(o.j - c.j)) < spacing)) continue;
    out.push(c);
    if (out.length >= count) break;
  }
  return out;
}

/** Cheap summary of a classified area: counts per class and per suggested use. */
export function summarize(cells) {
  const byClass = {}, byUse = {};
  for (const c of cells.values()) {
    byClass[c.cls] = (byClass[c.cls] ?? 0) + 1;
    byUse[c.use] = (byUse[c.use] ?? 0) + 1;
  }
  return { cells: cells.size, byClass, byUse };
}

/**
 * Site score for a city centred on cell [0,0] (lower is better, like findValley): wants enough buildable
 * cells near the centre, some water (lake/river/sea) within the city radius, and hills around for the
 * terraced look — but not a sea of cliffs.
 */
export function siteScore(cells, { radius = 6 } = {}) {
  let buildable = 0, terraced = 0, water = 0, shore = 0, cliffs = 0, total = 0, harbour = 0, unknown = 0;
  for (const c of cells.values()) {
    const r = Math.max(Math.abs(c.i), Math.abs(c.j));
    if (r > radius) continue;
    total++;
    const w = r <= 2 ? 2 : 1; // the core matters most
    if (c.cls === 'unknown') unknown++;
    if (['level'].includes(c.use) || (c.cls === 'flat')) buildable += w;
    if (['terrace2', 'terrace3', 'walkout', 'stilts'].includes(c.use)) terraced += w;
    if (c.cls === 'water') water++;
    if (c.cls === 'shoreline' || c.cls === 'river_crossing') shore++;
    if (c.cls === 'cliff') cliffs++;
    if ((c.harbourScore ?? 0) >= 3) harbour++;
  }
  const coreWater = [...cells.values()].filter((c) => Math.max(Math.abs(c.i), Math.abs(c.j)) <= 1 && c.cls === 'water').length;
  const score =
    -buildable * 1.0 - terraced * 0.7 - Math.min(shore, 14) * 1.2 - Math.min(harbour, 3) * 2 - (water > 0 ? 6 : 0)
    + Math.max(0, water - total * 0.45) * 1.5 + cliffs * 0.6 + coreWater * 15 + unknown * 2;
  return { score: +score.toFixed(1), total, buildable, terraced, water, shore, cliffs, harbour, unknown };
}

// ------------------------------------------------------------------ growth simulation (planner prototype)

// Extra cost of building a house with each earthwork plan (0 = as cheap as a flat lot).
const PLAN_COST = { level: 0, walkout: 0.8, terrace2: 1.2, terrace3: 2, stilts: 2.5 };

/**
 * Prototype of a terrain-aware nextCell(): grows a town of `count` house plots from `start` over the
 * classified cells, best-first by (distance from the centre + earthwork cost). Water, cliffs, unknown and
 * occupied cells are never built on; river crossings become bridges (and let the town continue on the other
 * bank); cliffs next to the town become viewpoints, forests next to it become parks; shoreline cells host
 * waterfront houses, and the water in front of them gets piers, with one harbour at the best site.
 * Returns Map "i,j" -> { role, order, mode?, y? }.
 */
export function simulateGrowth(cells, { count = 60, start = [0, 0], harbours = [] } = {}) {
  const key = (i, j) => `${i},${j}`;
  const out = new Map();
  const houseCost = (c) => {
    if (!c) return Infinity;
    // Shore cells are attractive, steep shores too (terraced waterfront à la Lavaux / Vitznau) when a plan fits.
    if (c.cls === 'shoreline') return c.plan && PLAN_COST[c.plan.mode] != null ? 0.4 + PLAN_COST[c.plan.mode] * 0.8 : Infinity;
    if (c.use === 'bridge' || c.use === 'viaduct') return 3; // cross only when this bank gets expensive
    // Forest: a house in a clearing (trees outside the footprint stay), a bit dearer than open land.
    if (c.cls === 'forest') return c.plan && PLAN_COST[c.plan.mode] != null ? 1.5 + PLAN_COST[c.plan.mode] : Infinity;
    return PLAN_COST[c.use] ?? Infinity;
  };
  let s0 = cells.get(key(...start));
  if (!Number.isFinite(houseCost(s0))) {
    // nearest buildable cell to the requested centre
    s0 = [...cells.values()].filter((c) => Number.isFinite(houseCost(c)) && c.use !== 'bridge' && c.use !== 'viaduct')
      .sort((a, b) => Math.hypot(a.i - start[0], a.j - start[1]) - Math.hypot(b.i - start[0], b.j - start[1]))[0];
  }
  if (!s0) return out;
  const [ci, cj] = [s0.i, s0.j];
  const frontier = new Map([[key(ci, cj), { s: 0 }]]);
  const passable = (n) => n && (n.cls === 'cliff' || n.cls === 'steep' || n.use === 'natural' || n.use === 'cliff-shore') && n.cls !== 'water';
  let order = 0, houses = 0;
  while (houses < count && frontier.size) {
    let bestK = null, best = null;
    for (const [k, f] of frontier) if (!best || f.s < best.s) [bestK, best] = [k, f];
    frontier.delete(bestK);
    const c = cells.get(bestK);
    if (best.via && !out.has(best.via)) out.set(best.via, { role: 'stairs' }); // switchback path over the steep cell
    const role = c.use === 'bridge' || c.use === 'viaduct' ? c.use : c.cls === 'shoreline' ? 'waterfront' : 'house';
    out.set(bestK, { role, order: ++order, mode: PLAN_COST[c.use] != null ? c.use : c.plan?.mode ?? c.use, forest: c.cls === 'forest' || undefined, y: c.plan?.levels?.[0] });
    if (role !== 'bridge' && role !== 'viaduct') houses++;
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nk = key(c.i + a, c.j + b);
      if (out.has(nk)) continue;
      const n = cells.get(nk);
      const hc = houseCost(n);
      if (!Number.isFinite(hc)) {
        // Too steep to build: a stair path may cross it to buildable land right behind it.
        if (!passable(n)) continue;
        const mk = key(c.i + 2 * a, c.j + 2 * b);
        const m = cells.get(mk);
        const mc = houseCost(m);
        if (out.has(mk) || !Number.isFinite(mc)) continue;
        const s = Math.hypot(m.i - ci, m.j - cj) + mc * 1.6 + 4;
        if (!frontier.has(mk) || frontier.get(mk).s > s) frontier.set(mk, { s, via: nk });
        continue;
      }
      const s = Math.hypot(n.i - ci, n.j - cj) + hc * 1.6;
      if (!frontier.has(nk) || frontier.get(nk).s > s) frontier.set(nk, { s });
    }
  }
  // Decorations around the town: piers, harbour, viewpoints, parks.
  const town = [...out.entries()];
  for (const [k, p] of town) {
    const c = cells.get(k);
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nk = key(c.i + a, c.j + b);
      if (out.has(nk)) continue;
      const n = cells.get(nk);
      if (!n) continue;
      if (p.role === 'stairs') continue;
      if (n.cls === 'water' && p.role === 'waterfront' && n.maxDepth >= 2 && n.waterType !== 'river') out.set(nk, { role: 'pier' });
      else if (n.cls === 'cliff') out.set(nk, { role: 'viewpoint' });
      else if (n.cls === 'forest' && p.role !== 'park') out.set(nk, { role: 'park' });
    }
  }
  const h = harbours.find((c) => out.get(key(c.i, c.j))?.role === 'waterfront');
  if (h) out.set(key(h.i, h.j), { ...out.get(key(h.i, h.j)), role: 'harbour' });
  return out;
}

/** Height steps between neighbouring planned plots (|dy| histogram) — what stitchSeam would have to bridge. */
export function seamSteps(plan, cells) {
  const hist = {};
  for (const [k, p] of plan) {
    if (p.y == null) continue;
    const [i, j] = k.split(',').map(Number);
    for (const [a, b] of [[1, 0], [0, 1]]) {
      const q = plan.get(`${i + a},${j + b}`);
      if (q?.y == null) continue;
      const d = Math.abs(p.y - q.y);
      const bucket = d <= 1 ? '0-1' : d <= 2 ? '2' : d <= 4 ? '3-4' : d <= 8 ? '5-8' : '9+';
      hist[bucket] = (hist[bucket] ?? 0) + 1;
    }
  }
  return hist;
}

/**
 * Earthworks of a simulated town: today's rule (one height per plot = a low sample of the ground, clamped to
 * ±1 of the neighbouring plots and ±12 of the city base) versus the plans above. Counted on the lot interior
 * only (17x17); today's 8-block terrace apron around each plot comes on top of that.
 */
export function compareEarthworks(plan, cells) {
  const today = { cut: 0, fill: 0, maxCut: 0, maxFill: 0 }, adaptive = { cut: 0, fill: 0, maxCut: 0, maxFill: 0 };
  const ys = new Map();
  let base = null;
  const order = [...plan.entries()].filter(([, p]) => p.order && (p.role === 'house' || p.role === 'waterfront' || p.role === 'harbour')).sort((a, b) => a[1].order - b[1].order);
  for (const [k, p] of order) {
    const c = cells.get(k);
    const hs = c.lotHeights;
    if (!hs?.length) continue;
    const sorted = Array.from(hs).sort((a, b) => a - b);
    let y = sorted[Math.floor(sorted.length * 0.15)];
    if (base == null) base = y;
    const nb = [];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if ((a || b) && ys.has(`${c.i + a},${c.j + b}`)) nb.push(ys.get(`${c.i + a},${c.j + b}`));
    if (nb.length) {
      const lo = Math.max(...nb) - 1, hi = Math.min(...nb) + 1;
      y = lo <= hi ? Math.min(Math.max(y, lo), hi) : Math.round((Math.max(...nb) + Math.min(...nb)) / 2);
    }
    y = Math.min(Math.max(y, base - 12), base + 12);
    ys.set(k, y);
    for (const h of hs) {
      if (h > y) { today.cut += h - y; today.maxCut = Math.max(today.maxCut, h - y); } else { today.fill += y - h; today.maxFill = Math.max(today.maxFill, y - h); }
    }
    const pl = c.plan ?? {};
    adaptive.cut += pl.cut ?? 0;
    adaptive.fill += pl.fill ?? 0;
    adaptive.maxCut = Math.max(adaptive.maxCut, pl.maxCut ?? 0);
    adaptive.maxFill = Math.max(adaptive.maxFill, pl.maxFill ?? 0);
  }
  return { plots: order.length, today, adaptive };
}
