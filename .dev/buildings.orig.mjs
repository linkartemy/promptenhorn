// Swiss-style procedural buildings. Each generator draws into a 17x17 local frame
// (x, z in 0..16; y = 0 is the ground surface, the street is at z > 16 — the front faces +z / south).
import { Blueprint, rngFrom } from './blueprint.mjs';

export const INNER = 17;

const FLOWERS_POTTED = ['potted_red_tulip', 'potted_poppy', 'potted_red_tulip', 'potted_pink_tulip', 'potted_white_tulip', 'potted_azure_bluet'];
const FLOWERS = ['poppy', 'cornflower', 'oxeye_daisy', 'azure_bluet', 'dandelion', 'allium', 'red_tulip', 'white_tulip'];
const SWISS_FLAG = '{patterns:[{pattern:"minecraft:straight_cross",color:"white"},{pattern:"minecraft:border",color:"red"}]}';

const stoneMix = (rng) => () =>
  rng.weighted([
    ['stone_bricks', 6],
    ['mossy_stone_bricks', 1.2],
    ['cracked_stone_bricks', 0.8],
    ['cobblestone', 1],
    ['andesite', 0.6],
  ]);

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

function sprinkleFlowers(bp, rng, x1, z1, x2, z2, density = 0.18) {
  for (let x = x1; x <= x2; x++)
    for (let z = z1; z <= z2; z++) {
      if (bp.get(x, 0, z) || bp.get(x, 1, z)) continue;
      if (rng.chance(density)) bp.set(x, 1, z, rng.pick(FLOWERS));
    }
}

function picketFence(bp, gateX, wood = 'spruce') {
  for (let i = 0; i <= 16; i++) {
    if (i !== gateX) bp.set(i, 1, 16, `${wood}_fence`);
    bp.set(0, 1, i, `${wood}_fence`);
    bp.set(16, 1, i, `${wood}_fence`);
    bp.set(i, 1, 0, `${wood}_fence`);
  }
  bp.set(gateX, 1, 16, `${wood}_fence_gate[facing=south]`);
}

function lampPost(bp, x, z, height = 3) {
  for (let y = 1; y <= height; y++) bp.set(x, y, z, 'spruce_fence');
  bp.set(x, height + 1, z, 'lantern[hanging=false]');
}

// ---------------------------------------------------------------- chalet

export function chalet(rng) {
  const bp = new Blueprint();
  const W = rng.pick([9, 11]);
  const D = rng.pick([9, 11]);
  const x1 = (INNER - W) >> 1;
  const x2 = x1 + W - 1;
  const z1 = 2;
  const z2 = z1 + D - 1;
  const cx = (x1 + x2) >> 1;

  const wood = rng.pick(['spruce', 'spruce', 'dark_oak']);
  const plank = `${wood}_planks`;
  const log = `stripped_${wood}_log`;
  const ground = rng.chance(0.65) ? stoneMix(rng) : 'calcite';
  const roofStairs = rng.pick(['dark_oak_stairs', 'spruce_stairs', 'deepslate_tile_stairs']);
  const ridge = `${roofStairs.replace('_stairs', '_slab')}[type=bottom]`;
  const shutter = rng.pick(['spruce_trapdoor', 'dark_oak_trapdoor', 'mangrove_trapdoor', 'warped_trapdoor']);
  const flower = () => rng.pick(FLOWERS_POTTED);

  // Ground floor (stone or white plaster).
  bp.fill(x1, 0, z1, x2, 0, z2, 'stone_bricks');
  bp.fill(x1 + 1, 0, z1 + 1, x2 - 1, 0, z2 - 1, plank);
  bp.walls(x1, 1, z1, x2, 3, z2, ground);
  // Upper floor (timber).
  bp.fill(x1, 4, z1, x2, 4, z2, plank);
  logRing(bp, x1, z1, x2, z2, 4, log);
  bp.walls(x1, 5, z1, x2, 7, z2, plank);
  for (const [x, z] of [[x1, z1], [x2, z1], [x1, z2], [x2, z2]]) bp.fill(x, 5, z, x, 7, z, `${log}[axis=y]`);

  // Windows.
  for (const x of [x1 + 2, x2 - 2]) {
    bp.window(x, 2, z2, 'south', { shutter, flowers: flower() });
    bp.window(x, 2, z1, 'north', { shutter });
    bp.window(x, 5, z1, 'north', { shutter, tall: 2 });
  }
  for (let z = z1 + 2; z <= z2 - 2; z += 3) {
    bp.window(x1, 2, z, 'west', { shutter, flowers: flower() });
    bp.window(x2, 2, z, 'east', { shutter, flowers: flower() });
    bp.window(x1, 5, z, 'west', { shutter, tall: 2 });
    bp.window(x2, 5, z, 'east', { shutter, tall: 2 });
  }
  for (const x of [x1 + 2, x2 - 2]) bp.window(x, 5, z2, 'south', { tall: 2 });

  // Doors: front door and balcony door.
  bp.door(cx, 1, z2, wood, 'south');
  bp.door(cx, 5, z2, wood, 'south');

  // Balcony across the front, two deep, on carved posts.
  for (let x = x1; x <= x2; x++) {
    bp.set(x, 4, z2 + 1, `${wood}_slab[type=top]`);
    bp.set(x, 4, z2 + 2, `${wood}_slab[type=top]`);
    bp.set(x, 5, z2 + 2, `${wood}_fence`);
    if ((x - x1) % 2 === 1) bp.set(x, 6, z2 + 2, flower());
  }
  bp.set(x1, 5, z2 + 1, `${wood}_fence`);
  bp.set(x2, 5, z2 + 1, `${wood}_fence`);
  for (const x of [x1, x2]) {
    bp.fill(x, 1, z2 + 2, x, 3, z2 + 2, `${log}[axis=y]`);
    bp.set(x, 3, z2 + 1, `${wood}_stairs[facing=north,half=top]`);
  }

  // Wide overhanging gable roof, gable facing the street.
  const top = bp.gableRoof({
    x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 3, y: 8, ridge: 'z',
    stairs: roofStairs, ridgeBlock: ridge, gableFill: plank, wall: { x1, x2, z1, z2 },
  });
  // Gable decoration: window and crossed beams.
  bp.window(cx, 9, z2, 'south', { tall: 2 });
  bp.set(cx - 1, 9, z2, `${log}[axis=y]`);
  bp.set(cx + 1, 9, z2, `${log}[axis=y]`);
  bp.set(cx, 8, z2, `${log}[axis=x]`);
  // Chimney with smoke.
  const chx = x2 - 2;
  const chz = z1 + 2;
  bp.fill(chx, 8, chz, chx, top + 1, chz, 'cobblestone');
  bp.set(chx, top + 2, chz, 'campfire[lit=true,signal_fire=false]');
  // Inside light.
  bp.set(cx, 3, (z1 + z2) >> 1, 'lantern[hanging=true]');
  bp.set(cx, 7, (z1 + z2) >> 1, 'lantern[hanging=true]');

  // Garden.
  for (let z = z2 + 1; z <= 16; z++) bp.set(cx, 0, z, 'dirt_path');
  picketFence(bp, cx, wood === 'dark_oak' ? 'dark_oak' : 'spruce');
  lampPost(bp, cx - 2, 15, 2);
  lampPost(bp, cx + 2, 15, 2);
  if (x1 >= 4) {
    bp.fir(2, 1, 2, rng.int(5, 7));
    bp.fir(14, 1, 3, rng.int(5, 7));
  }
  // Woodpile against the side wall.
  if (rng.chance(0.6)) bp.fill(x2 + 1, 1, z1 + 1, x2 + 1, 2, z1 + 3, 'oak_log[axis=z]');
  sprinkleFlowers(bp, rng, 1, z2 + 3, 15, 15);
  return bp;
}

// ---------------------------------------------------------------- old-town house

export function townhouse(rng) {
  const bp = new Blueprint();
  const W = rng.pick([9, 11]);
  const D = 11;
  const x1 = (INNER - W) >> 1;
  const x2 = x1 + W - 1;
  const z1 = 3;
  const z2 = z1 + D - 1; // arcade front line
  const cx = (x1 + x2) >> 1;
  const floors = rng.int(3, 4);

  const plaster = rng.weighted([
    ['calcite', 3], ['white_terracotta', 3], ['smooth_sandstone', 2],
    ['light_gray_terracotta', 1], ['yellow_terracotta', 1], ['light_blue_terracotta', 1],
  ]);
  const roofStairs = rng.pick(['brick_stairs', 'brick_stairs', 'deepslate_tile_stairs', 'mud_brick_stairs']);
  const ridge = `${roofStairs.replace('_stairs', '_slab')}[type=bottom]`;
  const shutter = rng.pick(['spruce_trapdoor', 'mangrove_trapdoor', 'warped_trapdoor', 'dark_oak_trapdoor', 'birch_trapdoor']);
  const stone = stoneMix(rng);
  const flower = () => rng.pick(FLOWERS_POTTED);

  // Ground floor with arcade (Lauben): shop front set back two blocks.
  bp.fill(x1, 0, z1, x2, 0, z2, 'polished_andesite');
  const shop = z2 - 2;
  bp.walls(x1, 1, z1, x2, 3, shop, stone);
  for (let z = shop + 1; z <= z2; z++) {
    bp.fill(x1, 1, z, x1, 3, z, stone);
    bp.fill(x2, 1, z, x2, 3, z, stone);
  }
  for (let x = x1 + 1; x < x2; x++) {
    if (x === cx) continue;
    bp.fill(x, 1, shop, x, 2, shop, 'glass_pane');
  }
  bp.door(cx, 1, shop, 'spruce', 'south');
  // Arcade front: pillars and arches.
  bp.fill(x1, 3, z2, x2, 3, z2, 'stone_bricks');
  for (const p of [x1, cx, x2]) {
    bp.fill(p, 1, z2, p, 2, z2, 'stone_bricks');
    if (p > x1) bp.set(p - 1, 2, z2, 'stone_brick_stairs[facing=east,half=top]');
    if (p < x2) bp.set(p + 1, 2, z2, 'stone_brick_stairs[facing=west,half=top]');
  }
  bp.set(cx, 3, z2 - 1, 'lantern[hanging=true]');

  // Upper floors.
  let y = 4;
  for (let f = 0; f < floors; f++, y += 3) {
    bp.fill(x1, y, z1, x2, y, z2, 'spruce_planks');
    bp.walls(x1, y, z1, x2, y, z2, 'stone_bricks');
    bp.walls(x1, y + 1, z1, x2, y + 2, z2, plaster);
    for (let x = x1 + 2; x <= x2 - 2; x += 2) {
      bp.window(x, y + 1, z2, 'south', { shutter, tall: 2, flowers: f === 0 ? flower() : undefined });
      bp.window(x, y + 1, z1, 'north', { shutter, tall: 2 });
    }
    bp.window(x1, y + 1, (z1 + z2) >> 1, 'west', { tall: 2 });
    bp.window(x2, y + 1, (z1 + z2) >> 1, 'east', { tall: 2 });
  }
  const roofY = y;

  // Oriel (Erker) on the second floor.
  if (floors >= 3 && rng.chance(0.7)) {
    const oy = 7;
    for (let x = cx - 1; x <= cx + 1; x++) {
      bp.set(x, oy, z2 + 1, 'stone_brick_stairs[facing=north,half=top]');
      bp.fill(x, oy + 1, z2 + 1, x, oy + 2, z2 + 1, 'glass_pane');
      bp.set(x, oy + 3, z2 + 1, `${roofStairs.replace('_stairs', '_slab')}[type=bottom]`);
    }
  }
  // Swiss flag on the corner.
  bp.set(x1, roofY - 1, z2 + 1, `red_wall_banner[facing=south]${SWISS_FLAG}`);

  // Steep roof, ridge parallel to the street.
  const top = bp.gableRoof({
    x1: x1, x2: x2, z1: z1 - 1, z2: z2 + 1, y: roofY, ridge: 'x',
    stairs: roofStairs, ridgeBlock: ridge, gableFill: plaster, wall: { x1, x2, z1, z2 },
  });
  // Dormer on the street side.
  const dy = roofY + 2;
  const dz = z2 - 1;
  bp.set(cx - 1, dy, dz, plaster);
  bp.set(cx + 1, dy, dz, plaster);
  bp.set(cx, dy, dz, 'glass_pane');
  for (let x = cx - 1; x <= cx + 1; x++) bp.set(x, dy + 1, dz, ridge);
  // Chimney.
  bp.fill(x2 - 1, roofY, z1 + 2, x2 - 1, top + 1, z1 + 2, 'bricks');
  if (rng.chance(0.5)) bp.set(x2 - 1, top + 2, z1 + 2, 'campfire[lit=true,signal_fire=false]');

  // Paved forecourt.
  bp.fill(0, 0, z2 + 1, 16, 0, 16, () => rng.weighted([['stone_bricks', 3], ['polished_andesite', 2], ['andesite', 1]]));
  bp.fill(0, 0, 0, 16, 0, z1 - 1, () => rng.weighted([['grass_block', 5], ['coarse_dirt', 1]]));
  bp.set(1, 1, 15, 'flowering_azalea');
  bp.set(15, 1, 15, 'flowering_azalea');
  lampPost(bp, 3, 15, 2);
  lampPost(bp, 13, 15, 2);
  return bp;
}

// ---------------------------------------------------------------- church

export function church(rng) {
  const bp = new Blueprint();
  const x1 = 5;
  const x2 = 11;
  const z1 = 1;
  const z2 = 11;
  const cx = 8;
  const wall = (x, y, z) => ((x === x1 || x === x2) && (z === z1 || z === z2) ? 'stone_bricks' : y === 1 ? 'stone_bricks' : 'calcite');

  // Nave.
  bp.fill(x1, 0, z1, x2, 0, z2, 'polished_andesite');
  bp.walls(x1, 1, z1, x2, 6, z2, wall);
  for (let z = z1 + 2; z <= z2 - 2; z += 2) {
    bp.fill(x1, 2, z, x1, 4, z, 'white_stained_glass_pane');
    bp.fill(x2, 2, z, x2, 4, z, 'white_stained_glass_pane');
    bp.set(x1, 5, z, 'stone_brick_stairs[facing=east,half=top]');
    bp.set(x2, 5, z, 'stone_brick_stairs[facing=west,half=top]');
  }
  bp.fill(cx - 1, 3, z1, cx + 1, 4, z1, 'yellow_stained_glass_pane');
  bp.gableRoof({
    x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2, y: 7, ridge: 'z',
    stairs: 'deepslate_tile_stairs', ridgeBlock: 'deepslate_tile_slab[type=bottom]', gableFill: 'calcite', wall: { x1, x2, z1, z2 },
  });
  for (let z = z1 + 1; z < z2; z += 3) bp.set(cx, 6, z, 'lantern[hanging=true]');

  // Bell tower in front of the nave.
  const tx1 = 6, tx2 = 10, tz1 = 11, tz2 = 15;
  const towerWall = (x, y, z) => ((x === tx1 || x === tx2) && (z === tz1 || z === tz2) ? 'stone_bricks' : y <= 1 ? 'stone_bricks' : 'calcite');
  bp.fill(tx1, 0, tz1, tx2, 0, tz2, 'polished_andesite');
  bp.walls(tx1, 1, tz1, tx2, 16, tz2, towerWall);
  bp.fill(tx1 + 1, 1, tz1, tx2 - 1, 6, tz1, null); // open into the nave
  bp.door(cx, 1, tz2, 'dark_oak', 'south');
  bp.fill(cx, 5, tz2, cx, 7, tz2, 'white_stained_glass_pane');
  // Clock faces (Zytglogge colours).
  for (const [fx, fz, axis] of [[cx, tz2 + 0, 'z'], [tx1, 13, 'x'], [tx2, 13, 'x']]) {
    for (let a = -1; a <= 1; a++)
      for (let b = 9; b <= 11; b++) {
        const block = a === 0 && b === 10 ? 'gold_block' : 'blue_concrete';
        if (axis === 'z') bp.set(fx + a, b, fz, block);
        else bp.set(fx, b, fz + a, block);
      }
  }
  // Belfry.
  bp.fill(tx1 + 1, 12, tz1 + 1, tx2 - 1, 12, tz2 - 1, 'spruce_planks');
  for (const [x, z] of [[cx, tz1], [cx, tz2], [tx1, 13], [tx2, 13]]) bp.fill(x, 13, z, x, 14, z, null);
  bp.set(cx, 13, 13, 'bell[attachment=floor,facing=south]');
  // Copper spire.
  const copper = 'waxed_oxidized_cut_copper';
  const st = (f) => `waxed_oxidized_cut_copper_stairs[facing=${f},half=bottom]`;
  bp.fill(tx1, 17, tz1, tx2, 17, tz2, copper);
  for (let x = tx1; x <= tx2; x++) bp.set(x, 17, tz1, st('south')), bp.set(x, 17, tz2, st('north'));
  for (let z = tz1 + 1; z < tz2; z++) bp.set(tx1, 17, z, st('east')), bp.set(tx2, 17, z, st('west'));
  bp.fill(tx1 + 1, 18, tz1 + 1, tx2 - 1, 20, tz2 - 1, copper);
  for (const [x, z, f] of [[cx, tz1 + 1, 'south'], [cx, tz2 - 1, 'north'], [tx1 + 1, 13, 'east'], [tx2 - 1, 13, 'west']]) bp.set(x, 20, z, st(f));
  bp.fill(cx, 21, 13, cx, 23, 13, copper);
  bp.set(cx, 24, 13, 'lightning_rod');

  // Churchyard.
  for (let i = 0; i <= 16; i++) {
    if (i !== cx) bp.set(i, 1, 16, 'cobblestone_wall');
    bp.set(0, 1, i, 'cobblestone_wall');
    bp.set(16, 1, i, 'cobblestone_wall');
  }
  for (let z = 15; z <= 16; z++) bp.set(cx, 0, z, 'gravel');
  bp.fir(2, 1, 3, 7);
  bp.fir(14, 1, 3, 7);
  bp.fir(2, 1, 11, 5);
  bp.fir(14, 1, 11, 5);
  sprinkleFlowers(bp, rng, 1, 1, 15, 15, 0.08);
  return bp;
}

// ---------------------------------------------------------------- contemporary Swiss house

export function modern(rng) {
  const bp = new Blueprint();
  const x1 = 2, x2 = 14, z1 = 2, z2 = 10;
  const cladding = rng.pick(['stripped_oak_log[axis=y]', 'stripped_spruce_log[axis=y]', 'stripped_birch_log[axis=y]']);
  const concrete = rng.pick(['white_concrete', 'white_concrete', 'light_gray_concrete', 'smooth_quartz']);

  // Glass ground floor around a concrete core.
  bp.fill(x1, 0, z1, x2, 0, z2, 'smooth_stone');
  bp.walls(x1, 1, z1, x2, 3, z2 - 1, 'glass');
  bp.walls(x1, 1, z1, x1 + 4, 3, z2 - 1, concrete);
  for (const x of [x2]) for (const z of [z1, z2 - 1]) bp.fill(x, 1, z, x, 3, z, concrete);
  bp.door(x1 + 6, 1, z2 - 1, 'birch', 'south');
  // Cantilevered upper volume.
  bp.fill(x1 - 1, 4, z1, x2, 4, z2 + 1, concrete);
  bp.walls(x1 - 1, 5, z1, x2, 7, z2 + 1, cladding);
  bp.fill(x1, 5, z2 + 1, x2 - 1, 6, z2 + 1, 'glass');
  bp.fill(x1 - 1, 5, z1 + 2, x1 - 1, 6, z2 - 1, 'glass');
  bp.fill(x1 - 1, 8, z1, x2, 8, z2 + 1, concrete);
  // Optional set-back top floor with terrace.
  let roof = 8;
  if (rng.chance(0.6)) {
    bp.walls(x1 + 3, 9, z1, x2 - 1, 11, z2 - 2, 'glass');
    for (const [x, z] of [[x1 + 3, z1], [x2 - 1, z1], [x1 + 3, z2 - 2], [x2 - 1, z2 - 2]]) bp.fill(x, 9, z, x, 11, z, concrete);
    bp.fill(x1 + 3, 12, z1, x2 - 1, 12, z2 - 2, concrete);
    for (let x = x1 - 1; x <= x2; x++) bp.set(x, 9, z2 + 1, 'glass_pane');
    for (let z = z1; z <= z2 + 1; z++) bp.set(x1 - 1, 9, z, 'glass_pane');
    roof = 12;
  }
  // Green roof and solar panels.
  for (let x = x1 + 4; x <= x2 - 2; x++)
    for (let z = z1 + 1; z <= z2 - 3; z++) bp.set(x, roof + 1, z, (x + z) % 3 === 0 ? 'moss_block' : 'daylight_detector');

  // Pool, stepping-stone path and lawn.
  bp.fill(10, 0, 12, 15, 0, 15, 'smooth_quartz');
  bp.fill(11, 0, 13, 14, 0, 14, 'water');
  for (let z = z2; z <= 16; z++) bp.set(x1 + 6, 0, z, 'smooth_stone_slab[type=double]');
  bp.set(1, 1, 1, 'flowering_azalea');
  bp.set(15, 1, 1, 'azalea');
  bp.set(15, 1, 16, 'flowering_azalea');
  bp.fir(2, 1, 14, 5);
  return bp;
}

// ---------------------------------------------------------------- grand hotel (Belle Époque)

export function hotel(rng) {
  const bp = new Blueprint();
  const x1 = 1, x2 = 15, z1 = 2, z2 = 12;
  const cx = 8;
  const plaster = rng.pick(['calcite', 'white_terracotta', 'smooth_sandstone']);
  const stone = stoneMix(rng);

  // Rusticated plinth.
  bp.fill(x1, 0, z1, x2, 0, z2, 'polished_andesite');
  bp.walls(x1, 1, z1, x2, 3, z2, stone);
  for (let x = x1 + 2; x <= x2 - 2; x += 2) {
    if (x === cx) continue;
    bp.fill(x, 1, z2, x, 2, z2, 'glass_pane');
    bp.set(x, 3, z2 + 1, 'stone_brick_stairs[facing=north,half=top]');
  }
  bp.door(cx, 1, z2, 'dark_oak', 'south');
  // Entrance canopy.
  for (let x = cx - 1; x <= cx + 1; x++) for (let z = z2 + 1; z <= z2 + 2; z++) bp.set(x, 4, z, 'dark_oak_slab[type=top]');
  bp.fill(cx - 1, 1, z2 + 2, cx - 1, 3, z2 + 2, 'dark_oak_fence');
  bp.fill(cx + 1, 1, z2 + 2, cx + 1, 3, z2 + 2, 'dark_oak_fence');
  bp.set(cx, 3, z2 + 1, 'lantern[hanging=true]');

  // Four guest floors with balconies.
  let y = 4;
  for (let f = 0; f < 4; f++, y += 3) {
    bp.walls(x1, y, z1, x2, y, z2, f === 0 ? 'stone_bricks' : 'smooth_stone');
    bp.walls(x1, y + 1, z1, x2, y + 2, z2, plaster);
    for (let x = x1 + 2; x <= x2 - 2; x += 2) {
      bp.fill(x, y + 1, z2, x, y + 2, z2, 'glass_pane');
      bp.fill(x, y + 1, z1, x, y + 2, z1, 'glass_pane');
      if (f < 3 && (x - x1) % 4 === 2) {
        bp.set(x, y, z2 + 1, 'smooth_stone_slab[type=top]');
        bp.set(x, y + 1, z2 + 1, 'iron_bars');
      }
    }
    for (let z = z1 + 2; z <= z2 - 2; z += 2) {
      bp.fill(x1, y + 1, z, x1, y + 2, z, 'glass_pane');
      bp.fill(x2, y + 1, z, x2, y + 2, z, 'glass_pane');
    }
  }
  // Cornice and mansard roof.
  const ry = y;
  for (let x = x1 - 1; x <= x2 + 1; x++) bp.set(x, ry, z1 - 1, 'smooth_stone_slab[type=bottom]'), bp.set(x, ry, z2 + 1, 'smooth_stone_slab[type=bottom]');
  for (let z = z1; z <= z2; z++) bp.set(x1 - 1, ry, z, 'smooth_stone_slab[type=bottom]'), bp.set(x2 + 1, ry, z, 'smooth_stone_slab[type=bottom]');
  bp.fill(x1, ry, z1, x2, ry, z2, 'deepslate_tiles');
  bp.walls(x1 + 1, ry + 1, z1 + 1, x2 - 1, ry + 2, z2 - 1, 'deepslate_tiles');
  for (let x = x1 + 3; x <= x2 - 3; x += 3) {
    bp.set(x, ry + 1, z2 - 1, 'glass_pane');
    bp.set(x, ry + 1, z1 + 1, 'glass_pane');
  }
  bp.fill(x1 + 1, ry + 3, z1 + 1, x2 - 1, ry + 3, z2 - 1, 'deepslate_tile_slab[type=bottom]');
  // Flagpoles with Swiss flags.
  for (const x of [x1 + 2, x2 - 2]) {
    bp.fill(x, ry + 4, 7, x, ry + 7, 7, 'spruce_fence');
    bp.set(x, ry + 8, 7, `red_banner[rotation=0]${SWISS_FLAG}`);
  }

  // Forecourt with red carpet.
  bp.fill(0, 0, z2 + 1, 16, 0, 16, 'stone_bricks');
  for (let z = z2 + 1; z <= 16; z++) bp.set(cx, 1, z, 'red_carpet');
  lampPost(bp, cx - 3, 15, 3);
  lampPost(bp, cx + 3, 15, 3);
  bp.set(1, 1, 15, 'flowering_azalea');
  bp.set(15, 1, 15, 'flowering_azalea');
  return bp;
}

// ---------------------------------------------------------------- town square (settlement centre)

export function square(rng, { withFountain = true } = {}) {
  const bp = new Blueprint();
  bp.fill(-2, 0, -2, 18, 0, 18, (x, y, z) =>
    (x + z) % 4 === 0 ? 'polished_andesite' : rng.weighted([['stone_bricks', 4], ['andesite', 1], ['cobblestone', 1]]));
  const c = 8;
  if (withFountain) {
    bp.walls(c - 3, 1, c - 3, c + 3, 1, c + 3, 'stone_bricks');
    bp.fill(c - 2, 0, c - 2, c + 2, 0, c + 2, 'water');
    bp.fill(c - 2, -1, c - 2, c + 2, -1, c + 2, 'stone_bricks');
    bp.fill(c, 0, c, c, 2, c, 'chiseled_stone_bricks');
    bp.set(c, 3, c, 'stone_brick_wall');
    bp.set(c, 4, c, 'lantern[hanging=false]');
  }
  // Flagpole with the Swiss flag.
  bp.fill(c, 1, c + 6, c, 6, c + 6, 'spruce_fence');
  bp.set(c, 1, c + 6, 'chiseled_stone_bricks');
  bp.set(c, 7, c + 6, `red_banner[rotation=0]${SWISS_FLAG}`);
  // Benches facing the fountain.
  for (const [x, z, f] of [[c - 5, c, 'west'], [c + 5, c, 'east'], [c, c - 5, 'north']]) {
    for (let a = -1; a <= 1; a++) {
      const bx = f === 'north' ? x + a : x;
      const bz = f === 'north' ? z : z + a;
      bp.set(bx, 1, bz, `spruce_stairs[facing=${f},half=bottom]`);
    }
  }
  for (const [x, z] of [[1, 1], [15, 1], [1, 15], [15, 15]]) lampPost(bp, x, z, 3);
  return bp;
}

// ---------------------------------------------------------------- selection

export const BUILDINGS = { chalet, townhouse, church, modern, hotel };

export const LABELS = {
  chalet: 'Шале',
  townhouse: 'Дом в старом городе',
  church: 'Церковь',
  modern: 'Современный дом',
  hotel: 'Гранд-отель',
};

/** Picks the next building type for a settlement: village first, then town, then city. */
export function chooseBuilding(settlement, seed) {
  const rng = rngFrom(`${seed}:type`);
  const n = settlement.buildingsStarted;
  const has = (t) => (settlement.typeCounts?.[t] ?? 0) > 0;
  if (n === 0) return 'chalet';
  if (n === 4 && !has('church')) return 'church';
  if (n < 6) return rng.weighted([['chalet', 8], ['townhouse', 2]]);
  if (n < 16) {
    if (!has('hotel') && n >= 10) return 'hotel';
    return rng.weighted([['townhouse', 6], ['chalet', 2], ['modern', 1.5], ['hotel', 0.5]]);
  }
  return rng.weighted([['townhouse', 4], ['modern', 3], ['hotel', 1.5], ['chalet', 1], ['church', 0.3]]);
}

export function generate(type, seed) {
  const rng = rngFrom(`${seed}:${type}`);
  return BUILDINGS[type](rng);
}

/** Small district plaza (placeholder: square without fountain). */
export function plaza(rng) {
  return square(rng, { withFountain: false });
}
