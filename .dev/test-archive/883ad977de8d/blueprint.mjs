// Blueprint: a sparse 3D block map with drawing helpers, rotation and build ordering.

/** Deterministic PRNG (mulberry32) seeded from a string. */
export function rngFrom(seedText) {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) {
    h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    /** Picks from [[value, weight], ...]. */
    weighted: (entries) => {
      const total = entries.reduce((s, [, w]) => s + w, 0);
      let roll = next() * total;
      for (const [value, weight] of entries) {
        roll -= weight;
        if (roll <= 0) return value;
      }
      return entries[entries.length - 1][0];
    },
  };
}

// Blocks that need support or attach to neighbours: placed in a second pass,
// after every structural block, so nothing pops off while the house goes up.
const DECOR =
  /lantern|torch|flower_pot|potted_|_door\b|trapdoor|banner|sign|vine|leaves|carpet|button|lever|bell|candle|campfire|lightning_rod|chain|pressure_plate|_bed\b|cake|ladder|lily_pad|azalea\b|rose_bush|lilac|peony|sunflower|large_fern|tall_grass|short_grass|bush|petals|wildflowers|leaf_litter|wheat|carrots|potatoes|beetroots|sapling|snow\b|golem_statue|end_rod|_shelf\b|_bars\b|^minecraft:(poppy|dandelion|cornflower|oxeye_daisy|azure_bluet|allium|blue_orchid|red_tulip|white_tulip|pink_tulip|orange_tulip|lily_of_the_valley|fern|torchflower|water|daylight_detector|iron_bars)\b/;

const CW_FACING = { north: 'east', east: 'south', south: 'west', west: 'north' };

/** Rotates a block string `name[props]{nbt}` by `turns` clockwise quarter turns. */
export function rotateBlock(block, turns) {
  turns = ((turns % 4) + 4) % 4;
  if (turns === 0) return block;
  const m = block.match(/^([^[{]+)(\[[^\]]*\])?(\{.*\})?$/);
  if (!m || !m[2]) return block;
  const props = m[2]
    .slice(1, -1)
    .split(',')
    .map((p) => {
      const [k, v] = p.split('=');
      if (k === 'facing' && CW_FACING[v]) {
        let f = v;
        for (let i = 0; i < turns; i++) f = CW_FACING[f];
        return `${k}=${f}`;
      }
      if (k === 'axis' && turns % 2 === 1 && (v === 'x' || v === 'z')) return `axis=${v === 'x' ? 'z' : 'x'}`;
      if (k === 'rotation') return `rotation=${(Number(v) + 4 * turns) % 16}`;
      return p;
    });
  return `${m[1]}[${props.join(',')}]${m[3] ?? ''}`;
}

const MIRROR_X = { east: 'west', west: 'east', left: 'right', right: 'left', inner_left: 'inner_right', inner_right: 'inner_left', outer_left: 'outer_right', outer_right: 'outer_left' };

/** Mirrors a block string across the x axis (east <-> west), fixing facing, hinge, shape, rotation and chest sides. */
export function mirrorBlock(block) {
  const m = block.match(/^([^[{]+)(\[[^\]]*\])?(\{.*\})?$/);
  if (!m || !m[2]) return block;
  const props = m[2]
    .slice(1, -1)
    .split(',')
    .map((p) => {
      const [k, v] = p.split('=');
      if (k === 'facing' || k === 'hinge' || k === 'shape' || k === 'type' || k === 'side_chain') return MIRROR_X[v] ? `${k}=${MIRROR_X[v]}` : p;
      if (k === 'rotation') return `rotation=${(16 - Number(v)) % 16}`;
      if (k === 'east') return `west=${v}`;
      if (k === 'west') return `east=${v}`;
      return p;
    });
  return `${m[1]}[${props.join(',')}]${m[3] ?? ''}`;
}

// ------------------------------------------------------------------ connection states
// Glass panes, bars and fences connect to their horizontal neighbours. setblock recomputes this from the
// neighbours present at that moment, so the build list carries the final state explicitly (computed from the
// finished blueprint, after rotation) and the order of placement no longer matters.

const DIRS4 = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' };
export const blockName = (b) => (b ?? '').replace(/^minecraft:/, '').replace(/[[{].*$/, '');
export function blockProps(b) {
  const m = (b ?? '').match(/\[([^\]]*)\]/);
  return Object.fromEntries((m?.[1] ?? '').split(',').filter(Boolean).map((p) => p.split('=')));
}
export const isPaneLike = (n) => /(^|_)glass_pane$|_bars$/.test(n);
export const isWoodFence = (n) => /_fence$/.test(n) && n !== 'nether_brick_fence';
export const isWallBlock = (n) => /_wall$/.test(n) && !/_wall_(sign|banner|hanging_sign|torch|head|skull|fan)$/.test(n) && !/wall_(sign|banner)/.test(n);
const CONNECT_EXCEPTION = /leaves$|^barrier$|pumpkin$|^melon$|jack_o_lantern|shulker_box$/;
// Blocks whose horizontal faces are never full (so nothing connects to them).
const NOT_STURDY = new RegExp([
  '_slab$', 'fence', '_wall$', 'glass_pane$', '_bars$', '_door$', 'sign$', 'banner$', 'carpet$', 'pressure_plate$', '_bed$', 'chest$',
  'lantern$', '^potted_', '^flower_pot$', 'candle', 'cake$', 'campfire$', 'daylight_detector$', 'lectern$', 'hopper$', 'bell$', '_rod$',
  'chain$', 'button$', 'torch', 'ladder$', 'shelf$', 'statue$', 'decorated_pot$', '^azalea$', '^flowering_azalea$', 'grindstone$',
  'brewing_stand$', 'enchanting_table$', 'anvil$', 'scaffolding$', '^snow$', '^water$', '^lava$', 'rail$', 'lily_pad$', 'leaves$',
  '^(poppy|dandelion|cornflower|oxeye_daisy|azure_bluet|allium|blue_orchid|.*_tulip|lily_of_the_valley|fern|short_grass|tall_grass|large_fern|torchflower|rose_bush|lilac|peony|sunflower|bush|firefly_bush|sweet_berry_bush|wheat|carrots|potatoes|beetroots|pink_petals|wildflowers|leaf_litter)$',
].join('|'));

/** Is the face of `block` that points towards `dir` a full, sturdy face? (approximation of vanilla isFaceSturdy) */
export function sturdyToward(block, dir) {
  if (!block) return false;
  const n = blockName(block);
  const p = blockProps(block);
  if (/_stairs$/.test(n)) return p.facing === dir && (p.shape ?? 'straight') === 'straight';
  if (/_slab$/.test(n)) return p.type === 'double';
  if (/_trapdoor$/.test(n)) return p.open === 'true' && OPPOSITE[p.facing] === dir;
  if (NOT_STURDY.test(n)) return false;
  return true;
}

/** Connection of a pane/bars/fence at `self` towards `dir`, given the neighbour block there. */
export function connectsTo(selfName, neighbour, dir) {
  if (!neighbour) return false;
  const n = blockName(neighbour);
  if (CONNECT_EXCEPTION.test(n)) return false;
  const sturdy = sturdyToward(neighbour, OPPOSITE[dir]);
  if (isPaneLike(selfName)) return isPaneLike(n) || isWallBlock(n) || sturdy;
  if (isWoodFence(selfName)) {
    if (isWoodFence(n)) return true;
    if (/_fence_gate$/.test(n)) {
      const f = blockProps(neighbour).facing;
      return (f === 'north' || f === 'south') === (dir === 'east' || dir === 'west');
    }
    return sturdy;
  }
  return false;
}

/** Rewrites pane/bars/fence entries of a build list with explicit north/east/south/west states. */
export function withConnections(list) {
  const map = new Map(list.map((b) => [`${b.x},${b.y},${b.z}`, b.block]));
  for (const b of list) {
    const n = blockName(b.block);
    if (!isPaneLike(n) && !isWoodFence(n)) continue;
    const props = blockProps(b.block);
    for (const [d, [dx, dz]] of Object.entries(DIRS4)) props[d] = String(connectsTo(n, map.get(`${b.x + dx},${b.y},${b.z + dz}`), d));
    const nbt = b.block.match(/\{.*\}$/)?.[0] ?? '';
    b.block = `minecraft:${n}[${Object.entries(props).map(([k, v]) => `${k}=${v}`).join(',')}]${nbt}`;
  }
  return list;
}

const ns = (b) => (/^[a-z0-9_.-]+:/.test(b) ? b : `minecraft:${b}`);

export class Blueprint {
  constructor() {
    this.blocks = new Map();
  }

  set(x, y, z, block) {
    const key = `${x},${y},${z}`;
    if (block == null) this.blocks.delete(key);
    else this.blocks.set(key, ns(block));
  }

  get(x, y, z) {
    return this.blocks.get(`${x},${y},${z}`);
  }

  /** Sets a block only where nothing has been placed yet. */
  setIfEmpty(x, y, z, block) {
    if (!this.blocks.has(`${x},${y},${z}`)) this.set(x, y, z, block);
  }

  /** Mirrors the whole blueprint in place across the plane x = axis / 2 (default: the plot centre line x = 8). */
  mirrorX(axis = 16) {
    const next = new Map();
    for (const [key, block] of this.blocks) {
      const [x, y, z] = key.split(',').map(Number);
      next.set(`${axis - x},${y},${z}`, mirrorBlock(block));
    }
    this.blocks = next;
    return this;
  }

  /** Solid box. `block` may be a function (x, y, z) => block for textured fills. */
  fill(x1, y1, z1, x2, y2, z2, block) {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++)
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
        for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++)
          this.set(x, y, z, typeof block === 'function' ? block(x, y, z) : block);
  }

  /** Four vertical walls of a box (no floor or ceiling). */
  walls(x1, y1, z1, x2, y2, z2, block) {
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        this.set(x, y, z1, typeof block === 'function' ? block(x, y, z1) : block);
        this.set(x, y, z2, typeof block === 'function' ? block(x, y, z2) : block);
      }
      for (let z = z1; z <= z2; z++) {
        this.set(x1, y, z, typeof block === 'function' ? block(x1, y, z) : block);
        this.set(x2, y, z, typeof block === 'function' ? block(x2, y, z) : block);
      }
    }
  }

  /**
   * Gable roof over [x1..x2] x [z1..z2] starting at height y.
   * ridge 'z': ridge runs along z, gables face north/south. ridge 'x': gables face east/west.
   * gableFill: block for the triangular end walls (inside the wall rectangle wx1..wx2 / wz1..wz2).
   */
  gableRoof({ x1, x2, z1, z2, y, ridge, stairs, ridgeBlock, gableFill, wall }) {
    const along = ridge === 'z';
    const lo = along ? x1 : z1;
    const hi = along ? x2 : z2;
    const runFrom = along ? z1 : x1;
    const runTo = along ? z2 : x2;
    const put = (across, h, run, block) => (along ? this.set(across, h, run, block) : this.set(run, h, across, block));
    let k = 0;
    for (; lo + k < hi - k; k++) {
      for (let r = runFrom; r <= runTo; r++) {
        put(lo + k, y + k, r, `${stairs}[facing=${along ? 'east' : 'south'},half=bottom]`);
        put(hi - k, y + k, r, `${stairs}[facing=${along ? 'west' : 'north'},half=bottom]`);
      }
      if (gableFill && wall) {
        // Triangle under this roof layer on both end walls.
        for (let a = lo + k + 1; a <= hi - k - 1; a++) {
          if (along) {
            if (a < wall.x1 || a > wall.x2) continue;
            this.set(a, y + k, wall.z1, gableFill);
            this.set(a, y + k, wall.z2, gableFill);
          } else {
            if (a < wall.z1 || a > wall.z2) continue;
            this.set(wall.x1, y + k, a, gableFill);
            this.set(wall.x2, y + k, a, gableFill);
          }
        }
      }
    }
    if (lo + k === hi - k) {
      for (let r = runFrom; r <= runTo; r++) put(lo + k, y + k, r, ridgeBlock);
    }
    return y + k; // top y of the ridge
  }

  /** Window (glass pane) on a wall face with optional shutters and flower sill. face = outward direction. */
  window(x, y, z, face, { shutter, flowers, tall = 1 } = {}) {
    for (let i = 0; i < tall; i++) this.set(x, y + i, z, 'glass_pane');
    const [dx, dz] = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[face];
    const ox = x + dx;
    const oz = z + dz;
    if (shutter) {
      const [sx, sz] = dx === 0 ? [1, 0] : [0, 1];
      for (let i = 0; i < tall; i++) {
        this.set(ox - sx, y + i, oz - sz, `${shutter}[facing=${face},open=true,half=bottom]`);
        this.set(ox + sx, y + i, oz + sz, `${shutter}[facing=${face},open=true,half=bottom]`);
      }
    }
    if (flowers) {
      this.set(ox, y - 1, oz, `spruce_trapdoor[facing=${face},open=false,half=top]`);
      this.set(ox, y, oz, flowers);
    }
  }

  /** Door (two halves). facing = direction a player looks when walking out. */
  door(x, y, z, wood, facing, hinge = 'left') {
    this.set(x, y, z, `${wood}_door[facing=${facing},half=lower,hinge=${hinge}]`);
    this.set(x, y + 1, z, `${wood}_door[facing=${facing},half=upper,hinge=${hinge}]`);
  }

  /** Small alpine fir. */
  fir(x, y, z, height = 6) {
    for (let i = 0; i < height; i++) this.set(x, y + i, z, 'spruce_log[axis=y]');
    const leaves = 'spruce_leaves[persistent=true]';
    for (let i = 2; i <= height; i++) {
      const r = Math.max(0, Math.floor((height - i) / 2));
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) + Math.abs(dz) > r + (r > 1 ? 1 : 0)) continue;
          if (dx === 0 && dz === 0 && i < height) continue;
          if (!this.get(x + dx, y + i, z + dz)) this.set(x + dx, y + i, z + dz, leaves);
        }
    }
    this.set(x, y + height, z, leaves);
  }

  /**
   * Returns the ordered build list. Coordinates are mapped from the building's local frame
   * into a square plot of `size` blocks, offset by `offset`, then rotated `turns` times clockwise.
   * Structure goes first (bottom-up, sweeping along the walls), decorations last.
   */
  toBuildList({ turns = 0, size, offset = 0, clipMin = -Infinity, clipMax = Infinity }) {
    const out = [];
    for (const [key, block] of this.blocks) {
      let [x, y, z] = key.split(',').map(Number);
      x += offset;
      z += offset;
      if (x < clipMin || z < clipMin || x > clipMax || z > clipMax) continue;
      for (let i = 0; i < ((turns % 4) + 4) % 4; i++) [x, z] = [size - 1 - z, x];
      out.push({ x, y, z, block: rotateBlock(block, turns), decor: DECOR.test(block) });
    }
    withConnections(out);
    const c = (size - 1) / 2;
    const angle = (b) => Math.atan2(b.z - c, b.x - c);
    out.sort((a, b) => a.decor - b.decor || a.y - b.y || angle(a) - angle(b));
    return out;
  }
}
