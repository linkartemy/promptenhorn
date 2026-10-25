
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
