
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
  return bp;
}

// ================================================================ cooperative apartment block (Genossenschaft)

export function apartment(rng) {
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
  bp.fill(x1, 0, z1, x2, 0, z2, 'smooth_stone');
  bp.walls(x1, 1, z1, x2, top, z2, cell);
  for (let s = 1; s <= n; s++) bp.fill(x1 + 1, 3 * s, z1 + 1, x2 - 1, 3 * s, z2 - 1, s === n ? concrete : `${wood}_planks`);
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
  const core = stairHall(bp, { axis: 'x', laneA: [5], laneB: [4], u0: 10, dir: -1, planes, wood });
  const balconies = (s) => {
    const ranges = s % 2 ? [[x1 + 1, cx - 1]] : [[cx + 1, x2 - 1]];
    if (n <= 5 || s === n - 1) ranges.push(s % 2 ? [cx + 2, x2 - 1] : [x1 + 1, cx - 2]);
    return ranges;
  };
  for (let s = 0; s < n; s++) {
    const y = 3 * s + 1;
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
  if (rng.chance(0.5)) bp.mirrorX();
  return bp;
}

// ================================================================ Emmental farmhouse

export function farmhouse(rng) {
  const bp = new Blueprint();
  const X1 = 1, X2 = 11, Z1 = 1, Z2 = 13, cx = 6;
  const zb = 6; // wall between the barn (behind) and the living part (front)
  const tw = WOOD(rng.pick(['spruce', 'spruce', 'dark_oak', 'oak']));
  const rw = WOOD(tw.name === 'oak' ? 'spruce' : rng.pick(['oak', 'birch', 'spruce']));
  const roofMat = ROOFS[rng.weighted([['tile', 3], ['spruce', 3], ['dark_oak', 2], ['clay', 1.5]])];
  const back = rng.pick([0, 2]);
  const y0 = 4;
  const board = `${tw.stripped}[axis=y]`;

  bp.fill(X1, 0, Z1, X2, 0, Z2, 'cobblestone');
  bp.fill(X1 + 1, 0, zb + 1, X2 - 1, 0, Z2 - 1, tw.planks);
  bp.fill(X1 + 1, 0, Z1 + 1, X2 - 1, 0, zb - 1, (x, y, z) => ((x * 7 + z * 3) % 5 ? 'coarse_dirt' : 'packed_mud'));
  // Living part: stone plinth, horizontal log walls. Barn: vertical boards.
  bp.walls(X1, 1, zb, X2, 4, Z2, (x, y, z) => (y === 1 ? 'stone_bricks' : (x === X1 || x === X2) && (z === zb || z === Z2) ? `${tw.log}[axis=y]` : `${y === 4 ? tw.log : tw.stripped}[axis=${z === Z2 || z === zb ? 'x' : 'z'}]`));
  bp.walls(X1, 1, Z1, X2, 4, zb, (x, y, z) => (z === zb ? bp.get(x, y, z) ?? board : board));
  bp.fill(X1 + 1, 4, zb + 1, X2 - 1, 4, Z2 - 1, tw.planks);
  bp.fill(X1 + 1, 5, Z1 + 1, X2 - 1, 5, zb - 2, tw.planks);
  // Huge half-hipped roof reaching low.
  const at = roof(bp, { x1: 0, x2: 12, z1: Z1 - 1, z2: Z2 + 2, y: y0, mat: roofMat, s: 4, n: back });
  closeUnder(bp, at, perimeter(X1, Z1, X2, Z2), 5, (x, y, z) => (z === Z2 ? tw.planks : board), roofMat);
  closeUnder(bp, at, [...Array(X2 - X1 - 1)].map((_, i) => [X1 + 1 + i, zb]), 5, tw.planks, roofMat);
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
  for (const x of [9, 10]) {
    bp.set(x, 1, 16, `${tw.slab}[type=top]`);
    bp.set(x, 2, 16, 'hay_block[axis=x]');
    bp.set(x, 1, 15, 'dark_oak_trapdoor[facing=north,open=true,half=bottom]');
  }
  bp.set(11, 1, 16, tw.fence);
  bp.set(2, 1, 16, 'composter[level=0]');
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
  sprinkleFlowers(bp, rng, 14, 2, 15, 11, 0.3, ['dandelion', 'oxeye_daisy', 'short_grass', 'short_grass', 'azure_bluet']);
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
  if (rng.chance(0.5)) bp.mirrorX();
  return bp;
}

// ================================================================ alpine hut (SAC-Hütte)

export function hut(rng) {
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
  bp.walls(x1, 5, z1, x2, 7, z2, (x, y, z) => ((x === x1 || x === x2) && (z === z1 || z === z2) ? `${tw.log}[axis=y]` : tw.planks));
  logRing(bp, x1, z1, x2, z2, 8, tw.log);
  const at = roof(bp, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 2, y: 8, mat: roofMat, kind: 'slabs', n: INF, s: INF, trim: { stairs: tw.stairs, slab: tw.slab } });
  closeUnder(bp, at, perimeter(x1, z1, x2, z2), 9, tw.planks, roofMat);
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
    shutterPair(x, 5, z2, 'south');
    shutterPair(x, 5, z1, 'north');
  }
  shutterPair(cx - 2, 2, z1, 'north');
  shutterPair(x1, 2, 7, 'west');
  shutterPair(x1, 5, 7, 'west');
  shutterPair(x2, 5, 6, 'east');
  bp.door(cx, 1, z2, tw.door, 'south');
  bp.set(cx, 3, z2 + 1, `${tw.sign}[facing=south]${signData(['', 'SAC', 'Berghuette', ''], 'red')}`);
  if (at(cx, z2).y - 9 >= 2) bp.set(cx, 9, z2, 'glass_pane');
  // Kitchen stove under the chimney, common room with long tables, stairs to the dormitory.
  const hall = stairHall(bp, { axis: 'z', laneA: [ix2 - 1], laneB: [ix2], u0: iz2, dir: -1, planes: [0, 4], wood: tw.name });
  bp.set(ix1, 1, iz1, 'smoker[facing=south,lit=true]');
  bp.set(ix1 + 1, 1, iz1, 'water_cauldron[level=3]');
  bp.set(ix1 + 2, 1, iz1, 'barrel[facing=up]');
  bp.set(ix1 + 3, 1, iz1, 'crafting_table');
  const ch = at(ix1, iz1);
  bp.fill(ix1, 2, iz1, ix1, ch.y + 1, iz1, 'cobblestone');
  bp.set(ix1, ch.y + 2, iz1, 'campfire[lit=true,signal_fire=false]');
  for (const tz of [iz1 + 2, iz1 + 4]) {
    for (let x = ix1 + 1; x <= ix1 + 4; x++) {
      bp.set(x, 1, tz, `${tw.slab}[type=top]`);
      bp.set(x, 1, tz - 1, `${tw.stairs}[facing=north,half=bottom]`);
    }
    bp.set(ix1 + 2, 2, tz, rng.pick(['candle[candles=3,lit=true]', 'potted_dandelion', 'lantern[hanging=false]']));
  }
  light(bp, { x1: ix1 + 1, z1: iz1 + 1, x2: ix1 + 4, z2: iz2, y: 1 });
  furnish(bp, rng, { x1: ix1, z1: iz1 + 1, x2: ix2 - 2, z2: iz2, y: 1, h: 3 }, 'common', [...hall.cells, ...(hall.ends[0] ?? []), [cx, iz2]], tw.name, { items: ['chest', 'clock', 'barrel', 'chiseled'], table: false });
  furnish(bp, rng, { x1: ix1, z1: iz1, x2: ix2 - 2, z2: iz2, y: 5, h: 3 }, 'dorm', [...hall.cells, ...(hall.ends[4] ?? [])], tw.name, { items: ['bunk', 'bunk2', 'bunk', 'chest', 'chest', 'barrel', 'sink'] });
  light(bp, { x1: ix1 + 2, z1: iz1 + 1, x2: ix2 - 3, z2: iz2 - 1, y: 5 });
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
  if (rng.chance(0.5)) bp.mirrorX();
  return bp;
}
