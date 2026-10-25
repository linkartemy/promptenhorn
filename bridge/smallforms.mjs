// Small forms: benches, trees, flower beds, wells, lamps, fountain basins, bike stands — what a short
// chat leaves behind on its district's plaza or park instead of a whole house, and what public works
// fill parks and slopes with. Also the park lot, the summit viewpoint and the stage-3 yard extras.
// These are bridge-side blueprints (not part of the versioned generators in buildings.mjs), kept tiny
// and self-contained: each returns a build list {x, y, z, block, decor} in its own footprint frame,
// y = 0 being the ground layer and y >= 1 above it.
import { rngFrom, rotateBlock } from './blueprint.mjs';

const DECOR = /lantern|torch|flower|tulip|poppy|daisy|cornflower|allium|bluet|orchid|dandelion|lily|fern|bush|grass\b|short_grass|sapling|leaves|_bars|lightning_rod|button|trapdoor|banner|carpet|chain|water|campfire|candle|pot/;

class Form {
  constructor(size) {
    this.size = size; // square footprint (size x size); rotation turns inside it
    this.blocks = new Map();
  }

  set(x, y, z, block) {
    this.blocks.set(`${x},${y},${z}`, block.startsWith('minecraft:') ? block : `minecraft:${block}`);
  }

  list(turns = 0) {
    const out = [];
    for (const [k, block] of this.blocks) {
      let [x, y, z] = k.split(',').map(Number);
      for (let i = 0; i < turns % 4; i++) [x, z] = [this.size - 1 - z, x];
      out.push({ x, y, z, block: rotateBlock(block, turns), decor: DECOR.test(block) });
    }
    return out.sort((a, b) => a.decor - b.decor || a.y - b.y || a.x - b.x || a.z - b.z);
  }
}

const FLOWERS = ['poppy', 'cornflower', 'oxeye_daisy', 'azure_bluet', 'red_tulip', 'white_tulip', 'pink_tulip', 'allium', 'dandelion', 'lily_of_the_valley'];

function bench(rng) {
  const f = new Form(3);
  const wood = rng.pick(['spruce', 'oak', 'dark_oak']);
  for (let x = 0; x < 3; x++) f.set(x, 1, 1, `${wood}_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]`);
  f.set(0, 1, 0, `${wood}_trapdoor[facing=west,half=bottom,open=true,powered=false,waterlogged=false]`);
  f.set(2, 1, 0, `${wood}_trapdoor[facing=east,half=bottom,open=true,powered=false,waterlogged=false]`);
  return f;
}

function linden(rng) {
  const f = new Form(5);
  const h = rng.int(3, 4);
  for (let y = 1; y <= h; y++) f.set(2, y, 2, 'oak_log[axis=y]');
  const leaves = rng.chance(0.3) ? 'birch_leaves[distance=1,persistent=true,waterlogged=false]' : 'oak_leaves[distance=1,persistent=true,waterlogged=false]';
  for (let y = h; y <= h + 2; y++)
    for (let x = 0; x < 5; x++)
      for (let z = 0; z < 5; z++) {
        const d = Math.abs(x - 2) + Math.abs(z - 2) + (y === h + 2 ? 2 : 0);
        if (d <= 3 && !(x === 2 && z === 2 && y < h + 1)) f.set(x, y, z, leaves);
      }
  return f;
}

function fir(rng) {
  const f = new Form(5);
  const h = rng.int(5, 7);
  for (let y = 1; y <= h; y++) f.set(2, y, 2, 'spruce_log[axis=y]');
  const leaves = 'spruce_leaves[distance=1,persistent=true,waterlogged=false]';
  for (let i = 3; i <= h + 1; i++) {
    const r = Math.max(0, Math.floor((h + 1 - i) / 2));
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > r + (r > 1 ? 1 : 0) || (!dx && !dz && i <= h)) continue;
        f.set(2 + dx, i, 2 + dz, leaves);
      }
  }
  f.set(2, h + 1, 2, leaves);
  return f;
}

function flowerbed(rng) {
  const f = new Form(3);
  for (let x = 0; x < 3; x++)
    for (let z = 0; z < 3; z++) {
      f.set(x, 0, z, x === 1 && z === 1 ? 'moss_block' : 'grass_block[snowy=false]');
      f.set(x, 1, z, x === 1 && z === 1 ? rng.pick(['azalea', 'flowering_azalea']) : rng.pick(FLOWERS));
    }
  return f;
}

function well() {
  const f = new Form(3);
  for (let x = 0; x < 3; x++)
    for (let z = 0; z < 3; z++) {
      if (x === 1 && z === 1) {
        f.set(x, 0, z, 'water');
        f.set(x, -1, z, 'cobblestone');
        continue;
      }
      f.set(x, 1, z, x !== 1 && z !== 1 ? 'mossy_cobblestone' : 'cobblestone_wall[east=none,north=none,south=none,west=none,up=true,waterlogged=false]');
      f.set(x, 0, z, 'cobblestone');
    }
  for (const [x, z] of [[0, 0], [2, 2]]) for (let y = 2; y <= 3; y++) f.set(x, y, z, 'spruce_fence[east=false,north=false,south=false,west=false,waterlogged=false]');
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) f.set(x, 4, z, 'spruce_slab[type=bottom,waterlogged=false]');
  f.set(1, 3, 1, 'iron_chain[axis=y,waterlogged=false]');
  return f;
}

function lamp() {
  const f = new Form(1);
  f.set(0, 1, 0, 'stone_brick_wall[east=none,north=none,south=none,west=none,up=true,waterlogged=false]');
  f.set(0, 2, 0, 'dark_oak_fence[east=false,north=false,south=false,west=false,waterlogged=false]');
  f.set(0, 3, 0, 'dark_oak_fence[east=false,north=false,south=false,west=false,waterlogged=false]');
  f.set(0, 4, 0, 'lantern[hanging=false,waterlogged=false]');
  return f;
}

function fountain() {
  const f = new Form(3);
  for (let x = 0; x < 3; x++)
    for (let z = 0; z < 3; z++) {
      f.set(x, 0, z, 'polished_andesite');
      if (x === 1 && z === 1) f.set(x, 1, z, 'water');
      else f.set(x, 1, z, 'stone_brick_slab[type=bottom,waterlogged=false]');
    }
  // A slab rim cannot hold water: the centre sits one lower, in a stone bowl.
  f.set(1, 0, 1, 'water');
  f.set(1, -1, 1, 'stone_bricks');
  f.blocks.delete('1,1,1');
  return f;
}

function bikestand() {
  const f = new Form(3);
  for (let x = 0; x < 3; x++) {
    f.set(x, 0, 1, 'smooth_stone');
    f.set(x, 1, 1, 'iron_bars[east=false,north=false,south=false,west=false,waterlogged=false]');
  }
  return f;
}

export const FORMS = {
  bench: { label: 'Скамейка', make: bench, w: 3 },
  linden: { label: 'Липа', make: linden, w: 3 },
  fir: { label: 'Ель', make: fir, w: 3 },
  flowerbed: { label: 'Клумба', make: flowerbed, w: 3 },
  well: { label: 'Колодец', make: well, w: 3 },
  lamp: { label: 'Фонарь', make: lamp, w: 1 },
  fountain: { label: 'Фонтанчик', make: fountain, w: 3 },
  bikestand: { label: 'Велопарковка', make: bikestand, w: 3 },
};

/** A form's build list (footprint-local) for a seed and rotation. */
export function formList(type, seed, turns = 0) {
  return FORMS[type].make(rngFrom(`${seed}:${type}`)).list(turns);
}

/** Footprint size of a form (its rotation box). */
export const formSize = (type) => FORMS[type].make(rngFrom('size')).size;

/** Park lot: lawn, a gravel cross of paths and a low hedge with openings. Plot-local (21 x 21). */
export function parkList(seed) {
  const rng = rngFrom(`${seed}:park`);
  const out = [];
  const hedge = rng.pick(['oak', 'spruce', 'birch']);
  for (let x = 2; x <= 18; x++)
    for (let z = 2; z <= 18; z++) {
      const path = x === 10 || z === 10 || x === 9 || z === 9;
      out.push({ x, y: 0, z, block: path ? 'minecraft:dirt_path' : 'minecraft:grass_block[snowy=false]', decor: false });
      const border = x === 2 || x === 18 || z === 2 || z === 18;
      if (border && !path) out.push({ x, y: 1, z, block: `minecraft:${hedge}_leaves[distance=1,persistent=true,waterlogged=false]`, decor: true });
    }
  return out.sort((a, b) => a.decor - b.decor || a.y - b.y);
}

/** Viewpoint on the summit: a tiny shelter with a bench and a Swiss cross. Footprint 5 x 5. */
export function summitList() {
  const f = new Form(5);
  for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) f.set(x, 0, z, 'stone_bricks');
  for (const [x, z] of [[0, 0], [4, 0], [0, 4], [4, 4]]) for (let y = 1; y <= 3; y++) f.set(x, y, z, 'spruce_log[axis=y]');
  for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) f.set(x, 4, z, 'spruce_slab[type=bottom,waterlogged=false]');
  for (let x = 1; x <= 3; x++) f.set(x, 1, 3, 'spruce_stairs[facing=south,half=bottom,shape=straight,waterlogged=false]');
  // Summit cross beside the shelter.
  for (let y = 1; y <= 6; y++) f.set(2, y + 4, 2, 'spruce_fence[east=false,north=false,south=false,west=false,waterlogged=false]');
  f.set(1, 9, 2, 'spruce_planks');
  f.set(3, 9, 2, 'spruce_planks');
  f.set(2, 11, 2, 'lantern[hanging=false,waterlogged=false]');
  return f.list(0);
}

/**
 * Yard extras for the last stage when a generator has no stages of its own: a flag pole with a Swiss
 * banner and a couple of flower beds / a bench on free lawn cells. `free(x, z)` says whether a
 * plot-local lawn cell (and the air above it) is unused by the house.
 */
export function yardExtras(seed, free) {
  const rng = rngFrom(`${seed}:yard`);
  const out = [];
  const cells = [];
  for (let x = 3; x <= 17; x++) for (let z = 3; z <= 17; z++) if (free(x, z) && free(x - 1, z) && free(x + 1, z) && free(x, z - 1) && free(x, z + 1)) cells.push([x, z]);
  if (!cells.length) return out;
  const taken = new Set();
  const take = (x, z) => {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) taken.add(`${x + a},${z + b}`);
  };
  const pick = () => {
    for (let n = 0; n < 40; n++) {
      const [x, z] = cells[rng.int(0, cells.length - 1)];
      if (!taken.has(`${x},${z}`)) {
        take(x, z);
        return [x, z];
      }
    }
    return null;
  };
  const pole = pick();
  if (pole) {
    const [x, z] = pole;
    for (let y = 1; y <= 5; y++) out.push({ x, y, z, block: 'minecraft:spruce_fence[east=false,north=false,south=false,west=false,waterlogged=false]', decor: false });
    out.push({ x, y: 6, z, block: 'minecraft:red_banner[rotation=0]{patterns:[{pattern:"minecraft:straight_cross",color:"white"},{pattern:"minecraft:border",color:"red"}]}', decor: true });
  }
  for (let k = 0; k < 3; k++) {
    const c = pick();
    if (!c) break;
    const [x, z] = c;
    out.push({ x, y: 1, z, block: `minecraft:${rng.pick(FLOWERS)}`, decor: true });
    if (rng.chance(0.5)) out.push({ x: x + 1, y: 1, z, block: `minecraft:${rng.pick(FLOWERS)}`, decor: true });
  }
  return out;
}
