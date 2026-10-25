
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
