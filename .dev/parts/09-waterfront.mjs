// ================================================================ waterfront (zone 'shore')
// Shore types are drawn with the water on their local north (the back): the bridge turns a shore lot so that its
// water side is local north (localSide(waterSide, turns) === 'north'). They bring their own water where they need
// it (slip, pool) and dig the lot fill with explicit air, so they also stand on a dry lot.

/** Octagon test: |dx|, |dz| <= r without the four corner cells. */
const octo = (dx, dz, r) => Math.abs(dx) <= r && Math.abs(dz) <= r && !(Math.abs(dx) === r && Math.abs(dz) === r);

/** Mooring bollard: andesite post with a chain. */
function bollard(bp, x, z) {
  bp.set(x, 1, z, 'andesite_wall');
  bp.set(x, 2, z, 'iron_chain[axis=x]');
}

// ---------------------------------------------------------------- lighthouse (Leuchtturm, Romanshorn / Brunnen)

export function lighthouse(rng) {
  const bp = new Blueprint();
  const cx = 8, cz = 8;
  const H = rng.pick([13, 14, 16]);
  const red = rng.pick(['red_concrete', 'red_terracotta', 'red_concrete']);
  const white = rng.pick(['white_concrete', 'calcite', 'white_concrete']);
  const stone = stoneMix(rng);
  // Pier head: a round stone platform with a low wall, bollards and a lamp; steps up from the street.
  for (let x = 0; x <= 16; x++)
    for (let z = 0; z <= 16; z++) {
      const d = Math.hypot(x - cx, z - cz);
      if (d <= 6.4) bp.set(x, 0, z, d > 5.4 ? 'stone_bricks' : (x + z) % 3 ? 'polished_andesite' : 'andesite');
      if (d > 5.4 && d <= 6.4 && !(Math.abs(x - cx) <= 1 && z > cz)) bp.set(x, 1, z, 'stone_brick_wall');
    }
  for (let z = 15; z <= 16; z++) for (let x = cx - 1; x <= cx + 1; x++) bp.set(x, 0, z, 'stone_bricks');
  for (const [x, z] of [[3, 5], [13, 5], [4, 12], [12, 12]]) if (!bp.get(x, 1, z)) bollard(bp, x, z);
  // Tower: octagon 5 wide, red and white bands on a stone base, door to the street.
  const band = (y) => (y <= 2 ? stone() : Math.floor((y - 3) / 3) % 2 ? red : white);
  for (let dx = -2; dx <= 2; dx++)
    for (let dz = -2; dz <= 2; dz++) {
      if (!octo(dx, dz, 2)) continue;
      const ring = Math.abs(dx) === 2 || Math.abs(dz) === 2;
      bp.set(cx + dx, 0, cz + dz, 'polished_andesite');
      if (ring) for (let y = 1; y <= H; y++) bp.set(cx + dx, y, cz + dz, band(y));
    }
  bp.door(cx, 1, cz + 2, 'spruce', 'south');
  bp.set(cx, 3, cz + 2, `${white === 'calcite' ? 'polished_andesite' : stone()}`);
  // Floors with a ladder along the north wall, porthole windows.
  const floors = [5, 10].filter((y) => y < H - 2);
  for (const y of floors) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) bp.set(cx + dx, y, cz + dz, 'spruce_planks');
  for (let y = 1; y <= H + 1; y++) bp.set(cx, y, cz - 1, 'ladder[facing=south]');
  for (const y of [...floors.map((f) => f + 2), 3]) {
    if (y >= H) continue;
    bp.set(cx - 2, y, cz, 'glass_pane');
    bp.set(cx + 2, y, cz, 'glass_pane');
  }
  bp.set(cx + 1, 7, cz - 2, 'glass');
  bp.set(cx + 1, 1, cz - 1, 'barrel[facing=up]');
  bp.set(cx - 1, 1, cz - 1, 'chest[facing=south]');
  bp.set(cx - 1, 1, cz + 1, 'potted_red_tulip');
  for (const y of [4, ...floors.map((f) => f + 4)]) if (y < H) bp.set(cx + 1, y, cz + 1, 'lantern[hanging=true]');
  if (floors[0]) bp.set(cx + 1, floors[0] + 1, cz, 'barrel[facing=up]');
  // Gallery: a deck all round on corbels, iron railing; lantern room of glass with the lamp; copper cap.
  const G = H + 1;
  for (let dx = -4; dx <= 4; dx++)
    for (let dz = -4; dz <= 4; dz++) {
      if (!octo(dx, dz, 4)) continue;
      const x = cx + dx, z = cz + dz;
      if (!(dx === 0 && dz === -1)) bp.set(x, G, z, 'polished_andesite');
      if (!octo(dx, dz, 3)) bp.set(x, G + 1, z, 'iron_bars');
      if (octo(dx, dz, 3) && !octo(dx, dz, 2)) {
        const f = Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 'west' : 'east') : dz > 0 ? 'north' : 'south';
        bp.set(x, G - 1, z, `stone_brick_stairs[facing=${f},half=top]`);
      }
    }
  bp.set(cx, G, cz - 1, 'ladder[facing=south]');
  for (let dx = -2; dx <= 2; dx++)
    for (let dz = -2; dz <= 2; dz++) {
      if (!octo(dx, dz, 2) || (Math.abs(dx) <= 1 && Math.abs(dz) <= 1)) continue;
      for (let y = G + 1; y <= G + 3; y++) bp.set(cx + dx, y, cz + dz, y === G + 3 ? red : 'glass');
    }
  bp.door(cx, G + 1, cz + 2, 'iron', 'south');
  bp.set(cx, G + 1, cz, 'polished_andesite');
  bp.set(cx, G + 2, cz, 'sea_lantern');
  bp.mark('light', cx, G + 2, cz, { data: { beacon: true } });
  const cap = roof(bp, { x1: cx - 2, x2: cx + 2, z1: cz - 2, z2: cz + 2, y: G + 4, mat: ROOFS.copper, kind: 'stairs' });
  bp.set(cx, cap(cx, cz).y + 1, cz, 'waxed_oxidized_lightning_rod[facing=up]');
  // A bench and a lamp on the pier head; a life ring (red/white banner) on the wall.
  bench(bp, cx + 3, cz + 4, 'north', 2, 'spruce');
  lamp(bp, cx - 4, cz + 3, 3, 'simple');
  bp.set(cx - 3, 2, cz + 1, `white_wall_banner[facing=west]${pattern([['circle', 'red'], ['border', 'red']])}`);
  return bp;
}

// ---------------------------------------------------------------- boathouse (Bootshaus)

export function boathouse(rng) {
  const bp = new Blueprint();
  const x1 = 3, x2 = 13, z1 = 1, z2 = 12, cx = 8;
  const tw = WOOD(rng.pick(['spruce', 'dark_oak', 'spruce']));
  const roofMat = ROOFS[rng.weighted([['spruce', 2], ['dark_oak', 2], ['slate', 1], ['tile', 1]])];
  const sx1 = 6, sx2 = 10, sz2 = 8; // slip
  const boards = (x, y, z) => ((x === x1 || x === x2) && (z === z1 || z === z2) ? `${tw.log}[axis=y]` : `${tw.stripped}[axis=y]`);
  // Stone plinth, plank walkways, the slip with its own water down to y=-2.
  for (let x = x1; x <= x2; x++)
    for (let z = z1; z <= z2; z++) {
      const slip = x >= sx1 && x <= sx2 && z <= sz2;
      if (slip) {
        bp.set(x, -3, z, 'gravel');
        bp.set(x, -2, z, 'water');
        bp.set(x, -1, z, 'water');
        bp.set(x, 0, z, 'air');
      } else bp.set(x, 0, z, x === x1 || x === x2 || z === z1 || z === z2 ? 'stone_bricks' : tw.planks);
      if (!slip && (x === sx1 - 1 || x === sx2 + 1) && z <= sz2) for (let y = -3; y <= -1; y++) bp.set(x, y, z, 'stone_bricks');
    }
  for (let x = sx1; x <= sx2; x++) {
    bp.set(x, -3, z1 - 1, 'gravel');
    bp.set(x, -2, z1 - 1, 'water');
    bp.set(x, -1, z1 - 1, 'water');
    bp.set(x, 0, z1 - 1, 'air');
    for (let y = -3; y <= -1; y++) bp.set(x, y, sz2 + 1, 'stone_bricks');
  }
  for (const x of [sx1 - 1, sx2 + 1]) for (let y = -3; y <= -1; y++) bp.set(x, y, z1 - 1, 'stone_bricks');
  // Walls (boarded), the water gate (an open arch on the lake side), windows, the door to the street.
  bp.walls(x1, 1, z1, x2, 4, z2, boards);
  for (let x = sx1; x <= sx2; x++) for (let y = 1; y <= 3; y++) bp.set(x, y, z1, null);
  for (let x = sx1 - 1; x <= sx2 + 1; x++) bp.set(x, 4, z1, `${tw.log}[axis=x]`);
  for (const z of [4, 8]) {
    win(bp, rng, x1, 2, z, 'west', { h: 1, w: 2 });
    win(bp, rng, x2, 2, z, 'east', { h: 1, w: 2 });
  }
  bp.door(cx, 1, z2, tw.door, 'south');
  win(bp, rng, cx - 3, 2, z2, 'south', { w: 2, h: 2, shutters: rng.weighted(SHUTTERS) });
  win(bp, rng, cx + 2, 2, z2, 'south', { w: 2, h: 2, shutters: rng.weighted(SHUTTERS) });
  bp.set(cx, 0, z2 + 1, 'stone_brick_slab[type=top]');
  // Loft over the workshop at the back of the slip, by ladder.
  bp.fill(x1 + 1, 5, sz2 + 1, x2 - 1, 5, z2 - 1, tw.planks);
  ladderUp(bp, cx + 1, z2 - 1, 'north', 1, 5);
  // Roof: gable to the water, wide overhang, barge boards.
  const at = roof(bp, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 2, z2: z2 + 1, y: 5, mat: roofMat, n: INF, s: INF, trim: { stairs: tw.stairs, slab: tw.slab } });
  closeUnder(bp, at, perimeter(x1, z1, x2, z2), 5, `${tw.stripped}[axis=y]`, roofMat);
  for (let x = sx1; x <= sx2; x++) bp.set(x, 5, z1, `${tw.log}[axis=x]`);
  win(bp, rng, cx, 7, z1, 'north', { h: 1 });
  win(bp, rng, cx, 7, z2, 'south', { h: 1 });
  // Inside: oars and nets along the walkways, workbench and store at the back, lanterns over the slip.
  for (const [x, z] of [[x1 + 1, 3], [x2 - 1, 3], [x1 + 1, 6], [x2 - 1, 6]]) bp.set(x, 1, z, rng.pick(['barrel[facing=up]', 'chest[facing=east]', 'composter[level=0]']));
  for (const z of [2, 6]) bp.set(x1 + 1, 3, z, `${tw.trapdoor}[facing=east,half=top,open=true]`);
  bp.set(x2 - 1, 1, z2 - 1, 'crafting_table');
  bp.set(x2 - 2, 1, z2 - 1, 'smithing_table');
  bp.set(x2 - 1, 2, z2 - 1, 'lantern[hanging=false]');
  for (const z of [3, 7]) bp.set(cx, 4, z, 'lantern[hanging=true]');
  furnish(bp, rng, { x1: x1 + 2, z1: sz2 + 1, x2: x2 - 2, z2: z2 - 1, y: 6, h: 2 }, 'storage', [[cx + 1, z2 - 1], [cx, z2 - 1], [cx + 2, z2 - 1], [cx + 1, z2 - 2]], tw.name, { items: ['barrel', 'chest', 'barrel'] });
  bp.mark('boat_spot', cx, -1, 4, { facing: 'north', data: { kind: rng.pick(['spruce_boat', 'oak_boat', 'birch_boat']) } });
  bp.mark('boat_spot', cx, -1, -1, { facing: 'north', data: { kind: 'oak_boat', outside: true } });
  bp.mark('workstation', x2 - 1, 1, z2 - 1, { data: { profession: 'fisherman' } });
  // Front: path, bench, a canoe rack, flowers.
  for (let z = z2 + 2; z <= 16; z++) bp.set(cx, 0, z, rng.pick(['gravel', 'dirt_path']));
  bench(bp, cx + 3, z2 + 2, 'north', 2, tw.name);
  for (let x = x1; x <= cx - 2; x++) bp.setIfEmpty(x, 1, z2 + 1, rng.pick(BOX_FLOWERS));
  sprinkleFlowers(bp, rng, 0, z2 + 2, 16, 16, 0.12);
  return bp;
}

// ---------------------------------------------------------------- Schiffstation (steamer landing with waiting room)

export function schiffstation(rng) {
  const bp = new Blueprint();
  const x1 = 3, x2 = 13, z1 = 5, z2 = 11, cx = 8;
  const plaster = rng.pick(['calcite', 'white_terracotta', 'smooth_sandstone']);
  const trim = rng.pick([TRIMS.stone, TRIMS.andesite, TRIMS.sand]);
  const roofMat = ROOFS[rng.pick(['copper', 'copperW', 'slate'])];
  const wood = rng.pick(['spruce', 'dark_oak']);
  const place = rng.pick(['LUZERN', 'BRUNNEN', 'VITZNAU', 'WEGGIS', 'FLUELEN', 'SPIEZ', 'THUN', 'MONTREUX', 'ROMANSHORN', 'RAPPERSWIL']);
  // Quay: stone paving, the landing stage on the lake side with bollards, steps; benches on the street side.
  bp.fill(0, 0, 0, 16, 0, 16, (x, y, z) => (z <= 1 ? 'stone_bricks' : (x + z) % 3 ? 'polished_andesite' : 'stone_bricks'));
  for (let x = 1; x <= 15; x++) bp.set(x, 1, 0, x % 4 === 1 ? 'andesite_wall' : null);
  for (const x of [1, 5, 11, 15]) bp.set(x, 2, 0, 'iron_chain[axis=x]');
  bp.mark('ship_spot', cx, -1, -3, { facing: 'east', data: { kind: 'steamer' } });
  // Pavilion: tall single storey, trim plinth and cornice, big windows, doors on both sides.
  bp.walls(x1, 1, z1, x2, 4, z2, (x, y, z) => ((x === x1 || x === x2) && (z === z1 || z === z2) ? trim.block : y === 1 || y === 4 ? trim.block : plaster));
  bp.fill(x1 + 1, 0, z1 + 1, x2 - 1, 0, z2 - 1, (x, y, z) => ((x + z) % 2 ? 'white_concrete' : 'black_concrete'));
  for (const x of [x1 + 2, x2 - 3]) {
    win(bp, rng, x, 2, z2, 'south', { w: 2, h: 2 });
    win(bp, rng, x, 2, z1, 'north', { w: 2, h: 2 });
  }
  for (const z of [z1 + 2]) {
    win(bp, rng, x1, 2, z, 'west', { w: 3, h: 2 });
    win(bp, rng, x2, 2, z, 'east', { w: 3, h: 2 });
  }
  doorway(bp, cx, 1, z2, 'south', wood, { double: false, transom: 'glass_pane' });
  doorway(bp, cx, 1, z1, 'north', wood, { double: false, transom: 'glass_pane' });
  // Hipped copper roof with the station clock in a dormer over the street door, the name on a sign.
  const at = roof(bp, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 1, y: 5, mat: roofMat, kind: 'stairs', brackets: `${wood}_stairs` });
  closeUnder(bp, at, perimeter(x1, z1, x2, z2), 5, plaster, roofMat);
  clockFace(bp, cx, 6, z2, 'south');
  bp.set(cx, 4, z2 + 1, `${wood}_wall_sign[facing=south]${signData(['SCHIFFSTATION', place, '', ''], 'black')}`);
  // Canopy over the landing on slim posts.
  for (let x = x1; x <= x2; x++)
    for (let z = 1; z < z1; z++) {
      if ((x === x1 || x === x2 || x === cx) && z === 1) bp.fill(x, 1, z, x, 3, z, `${wood}_fence`);
      bp.set(x, 4, z, `${roofMat.slab}[type=bottom]`);
    }
  for (const x of [x1 + 2, x2 - 2]) bp.set(x, 3, 2, 'lantern[hanging=true]');
  // Inside: ticket counter, timetable, benches back to back, plants; a flag on the street side.
  for (let x = x2 - 3; x <= x2 - 1; x++) bp.set(x, 1, z1 + 1, x === x2 - 1 ? `${wood}_planks` : `${wood}_slab[type=top]`);
  bp.set(x2 - 2, 2, z1 + 1, 'bell[attachment=floor,facing=south]');
  bp.set(x2 - 1, 2, z1 + 1, 'lectern[facing=south,has_book=true]');
  bp.set(x1 + 1, 2, z1 + 1, `${wood}_wall_sign[facing=south]${signData(['ABFAHRT', '10:15 Weggis', '11:40 Brunnen', '13:05 Flueelen'], 'black')}`);
  bench(bp, x1 + 2, z1 + 3, 'south', 3, wood);
  bench(bp, x1 + 2, z2 - 2, 'north', 3, wood);
  for (const [x, z] of [[x1 + 1, z2 - 1], [x2 - 1, z2 - 1]]) bp.set(x, 1, z, rng.pick(HOUSE_PLANTS));
  for (const x of [x1 + 3, x2 - 3]) light(bp, { x1: x, z1: z1 + 3, x2: x, z2: z1 + 3, y: 1 });
  flagPole(bp, 15, 14, 7);
  bench(bp, 2, 14, 'south', 2, wood);
  lamp(bp, 1, 12, 3, 'double');
  planter(bp, 12, 14, wood);
  return bp;
}

// ---------------------------------------------------------------- lido (Strandbad / Badi)

export function lido(rng) {
  const bp = new Blueprint();
  const wood = rng.pick(['spruce', 'birch', 'spruce']);
  const [ca, cb] = rng.pick([['red', 'white'], ['blue', 'white'], ['green', 'white'], ['yellow', 'white']]);
  // Beach towards the water, lawn towards the street, a boardwalk between.
  for (let x = 0; x <= 16; x++)
    for (let z = 0; z <= 16; z++) bp.set(x, 0, z, z <= 7 ? 'sand' : z === 8 ? `${wood}_planks` : 'grass_block');
  // Bathing jetty with a diving tower over the water side.
  for (let z = -2; z <= 2; z++) for (let x = 7; x <= 9; x++) bp.set(x, 0, z, `${wood}_planks`);
  for (const [x, z] of [[7, -2], [9, -2]]) bp.fill(x, -3, z, x, -1, z, `stripped_${wood}_log[axis=y]`);
  bp.fill(10, 1, 1, 10, 3, 1, `stripped_${wood}_log[axis=y]`);
  for (let y = 1; y <= 3; y++) bp.set(9, y, 1, 'ladder[facing=west]');
  bp.set(9, 0, 1, 'ladder[facing=west]');
  bp.fill(8, 4, 0, 10, 4, 2, `${wood}_planks`);
  bp.set(9, 4, 1, 'ladder[facing=west]');
  for (const [x, z] of [[8, 0], [10, 0], [8, 2], [10, 2]]) bp.set(x, 5, z, `${wood}_fence`);
  bp.set(9, 4, -1, `${wood}_slab[type=top]`);
  bp.set(9, 4, -2, `${wood}_slab[type=top]`);
  // Changing cabins along the west side, striped doors.
  for (let i = 0; i < 5; i++) {
    const z = 4 + i * 2;
    bp.fill(0, 1, z - 1, 2, 3, z - 1, `stripped_${wood}_log[axis=y]`);
    bp.set(0, 1, z, `stripped_${wood}_log[axis=y]`);
    bp.set(0, 2, z, `stripped_${wood}_log[axis=y]`);
    bp.set(0, 3, z, `stripped_${wood}_log[axis=y]`);
    bp.set(1, 0, z, `${wood}_planks`);
    bp.set(1, 3, z, `stripped_${wood}_log[axis=y]`);
    bp.door(2, 1, z, wood, 'east');
    bp.set(2, 3, z, `${i % 2 ? ca : cb}_wool`);
    bp.set(1, 1, z, `${wood}_slab[type=bottom]`);
    for (let zz = z - 1; zz <= z; zz++) for (let x = 0; x <= 2; x++) bp.set(x, 4, zz, `${wood}_slab[type=bottom]`);
  }
  bp.fill(0, 1, 13, 2, 3, 13, `stripped_${wood}_log[axis=y]`);
  for (let x = 0; x <= 2; x++) bp.set(x, 4, 13, `${wood}_slab[type=bottom]`);
  // Kiosk with a serving hatch, menu and parasol tables.
  const kx1 = 11, kx2 = 15, kz1 = 10, kz2 = 13;
  bp.walls(kx1, 1, kz1, kx2, 3, kz2, (x, y, z) => ((x === kx1 || x === kx2) && (z === kz1 || z === kz2) ? `stripped_${wood}_log[axis=y]` : `${wood}_planks`));
  bp.fill(kx1 + 1, 0, kz1 + 1, kx2 - 1, 0, kz2 - 1, `${wood}_planks`);
  for (let x = kx1 + 1; x <= kx2 - 1; x++) {
    bp.set(x, 2, kz1, null);
    bp.set(x, 1, kz1, `${wood}_slab[type=top]`);
  }
  for (let x = kx1; x <= kx2; x++) {
    bp.set(x, 3, kz1 - 1, `${wood}_trapdoor[facing=south,half=top]`);
    bp.set(x, 4, kz1 - 1, `${x % 2 ? ca : cb}_carpet`);
  }
  for (let x = kx1 - 1; x <= kx2 + 1; x++) for (let z = kz1; z <= kz2 + 1; z++) bp.set(x, 4, z, `${wood}_slab[type=bottom]`);
  bp.set(kx1 + 2, 2, kz1 - 0, null);
  bp.door(kx1 + 2, 1, kz2, wood, 'south');
  bp.set(kx1 + 1, 1, kz1 + 1, 'smoker[facing=south,lit=true]');
  bp.set(kx2 - 1, 1, kz1 + 1, 'water_cauldron[level=3]');
  bp.set(kx1 + 3, 2, kz1, 'cake');
  bp.set(kx1 + 1, 2, kz1, 'candle[candles=2,lit=true]');
  bp.set(kx1 + 2, 3, kz2 - 1, 'lantern[hanging=true]');
  bp.set(kx2 + 1, 2, kz1 + 1, `${wood}_wall_sign[facing=east]${signData(['BADI KIOSK', 'Glace', 'Pommes frites', 'Sirup'], 'black')}`);
  for (const [tx, tz] of [[8, 11], [5, 14]]) {
    bp.fill(tx, 1, tz, tx, 3, tz, `${wood}_fence`);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        bp.set(tx + dx, 4, tz + dz, dx || dz ? `${wood}_trapdoor[facing=south,half=top]` : `${ca}_wool`);
        bp.set(tx + dx, 5, tz + dz, `${(dx + dz + 2) % 2 ? ca : cb}_carpet`);
      }
    bp.set(tx - 1, 1, tz, `${wood}_stairs[facing=west,half=bottom]`);
    bp.set(tx + 1, 1, tz, `${wood}_stairs[facing=east,half=bottom]`);
    bp.mark('food_spot', tx, 2, tz, { data: { item: rng.pick(['cookie', 'melon_slice', 'sweet_berries']) } });
  }
  // Loungers and parasols on the sand, towels, a life-guard chair.
  for (const [x, z] of [[4, 3], [6, 3], [12, 3], [14, 3]]) {
    bp.set(x, 1, z, 'white_bed[facing=north,part=head]');
    bp.set(x, 1, z + 1, 'white_bed[facing=north,part=foot]');
  }
  for (const [x, z] of [[5, 5], [13, 5]]) {
    bp.fill(x, 1, z, x, 2, z, `${wood}_fence`);
    bp.set(x, 3, z, `${rng.pick([ca, cb])}_wool`);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) bp.set(x + dx, 3, z + dz, `${rng.pick([ca, cb])}_carpet`);
  }
  for (const [x, z] of [[11, 6], [12, 6]]) bp.set(x, 1, z, `${rng.pick(['red', 'blue', 'yellow', 'lime'])}_carpet`);
  bp.fill(15, 1, 1, 15, 2, 1, `stripped_${wood}_log[axis=y]`);
  bp.set(15, 3, 1, `${wood}_stairs[facing=south,half=bottom]`);
  bp.set(15, 1, 2, `${wood}_slab[type=bottom]`);
  bp.set(16, 4, 1, `red_banner[rotation=4]${SWISS_FLAG}`);
  // Entrance gate from the street, a lawn with a linden and a fence; flag.
  plotFence(bp, [8], `${wood}_fence`, `${wood}_fence_gate`, { back: false, sides: false });
  broadTree(bp, 3, 15, 5, 2, 'oak');
  flagPole(bp, 15, 15, 7);
  bp.mark('pool_spot', 8, 0, -4, { data: { swimmers: 3 } });
  // Grass under a solid block turns to dirt in the game.
  for (let x = 0; x <= 16; x++)
    for (let z = 0; z <= 16; z++) {
      const above = bp.get(x, 1, z);
      if (bp.get(x, 0, z) === 'minecraft:grass_block' && above && !PASSABLE.test(above) && !SOFT_PLANT.test(above)) bp.set(x, 0, z, 'coarse_dirt');
    }
  return bp;
}
