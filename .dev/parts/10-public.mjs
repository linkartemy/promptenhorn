// ================================================================ public works (built by chats for their district)
// None of these is picked as a chat's home (CATALOG zones are empty): the economy decides when a district gets one.

const PLACES = ['GRINDELWALD', 'MEIRINGEN', 'ANDERMATT', 'BRIENZ', 'KANDERSTEG', 'SAMEDAN', 'ZERMATT', 'SPIEZ', 'GOLDAU', 'FLUELEN', 'ENGELBERG', 'LAUTERBRUNNEN'];

// ---------------------------------------------------------------- school (Schulhaus with a bell turret)

export function school(rng) {
  const bp = new Blueprint();
  const x1 = 1, x2 = 15, z1 = 2, z2 = 10, cx = 8;
  const plaster = rng.pick(['calcite', 'white_terracotta', 'smooth_sandstone', 'pink_terracotta']);
  const trim = rng.pick([TRIMS.stone, TRIMS.sand, TRIMS.tuff, TRIMS.andesite]);
  const roofMat = ROOFS[rng.pick(['tile', 'slate', 'clay', 'tile'])];
  const wood = rng.pick(['spruce', 'oak', 'birch']);
  const shutter = rng.weighted(SHUTTERS);
  const planes = [0, 5];
  const top = 9;
  // Shell: plinth, two storeys, cornice band; tall windows in a regular rhythm, a central portal with steps.
  bp.fill(x1, 0, z1, x2, 0, z2, 'polished_andesite');
  bp.fill(x1 + 1, 0, z1 + 1, x2 - 1, 0, z2 - 1, `${wood}_planks`);
  bp.walls(x1, 1, z1, x2, top, z2, (x, y, z) => ((x === x1 || x === x2) && (z === z1 || z === z2) ? trim.block : y === 1 || y === 5 ? trim.block : plaster));
  bp.fill(x1 + 1, 5, z1 + 1, x2 - 1, 5, z2 - 1, `${wood}_planks`);
  for (const y of [2, 6]) {
    for (const x of [x1 + 1, x1 + 4, x2 - 5, x2 - 2]) win(bp, rng, x, y, z2, 'south', { w: 2, h: 2, lintel: trim.block, shutters: shutter });
    for (const x of [x1 + 1, x1 + 4, x2 - 5, x2 - 2]) if (y === 6 || x < cx) win(bp, rng, x, y, z1, 'north', { w: 2, h: 2, lintel: trim.block });
    win(bp, rng, x1, y, z1 + 4, 'west', { w: 2, h: 2, lintel: trim.block });
    win(bp, rng, x2, y, z1 + 4, 'east', { w: 2, h: 2, lintel: trim.block });
  }
  doorway(bp, cx, 1, z2, 'south', wood, { frame: trim.block, transom: 'glass_pane' });
  for (let x = cx - 1; x <= cx + 1; x++) bp.set(x, 0, z2 + 1, `${trim.slab}[type=top]`);
  bp.set(cx, 4, z2 + 1, `${wood}_wall_sign[facing=south]${signData(['', 'SCHULHAUS', '', ''], 'black')}`);
  // Roof: hipped, with a bell turret (Dachreiter) on the ridge: open belfry, clock faces, spire.
  const at = roof(bp, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 1, y: top, mat: roofMat, brackets: `${wood}_stairs` });
  closeUnder(bp, at, perimeter(x1, z1, x2, z2), top + 1, plaster, roofMat);
  const ry = at(cx, (z1 + z2) >> 1).y;
  const tz = (z1 + z2) >> 1;
  bp.walls(cx - 1, ry, tz - 1, cx + 1, ry + 2, tz + 1, (x, y, z) => ((x === cx || z === tz) && y === ry + 1 ? null : `${wood}_planks`));
  for (const [x, z] of [[cx, tz - 1], [cx, tz + 1], [cx - 1, tz], [cx + 1, tz]]) bp.set(x, ry + 1, z, null);
  bp.set(cx, ry + 3, tz, `${wood}_planks`);
  bp.set(cx, ry + 2, tz, 'bell[attachment=ceiling,facing=south]');
  const tr = roof(bp, { x1: cx - 1, x2: cx + 1, z1: tz - 1, z2: tz + 1, y: ry + 3, mat: ROOFS.copper, kind: 'steep', pitch: 2 });
  bp.set(cx, tr(cx, tz).y + 1, tz, 'waxed_oxidized_lightning_rod[facing=up]');
  clockFace(bp, cx, ry - 2 >= top + 2 ? ry - 2 : top + 2, z2, 'south');
  // Inside: corridor along the back with the staircase, classrooms facing the street on both floors.
  const hall = stairHall(bp, { axis: 'x', laneA: [z1 + 2], laneB: [z1 + 1], u0: x2 - 1, dir: -1, planes, wood });
  for (const F of planes) {
    const y = F + 1;
    const panel = (x, yy, z) => (yy === y ? `${wood}_planks` : plaster);
    const doors = F === 0 ? [[x1 + 3, z1 + 3], [x2 - 1, z1 + 3], [cx, z1 + 3, true]] : [[x1 + 4, z1 + 3], [cx + 1, z1 + 3]];
    partition(bp, x1 + 1, z1 + 3, x2 - 1, z1 + 3, y, 3, panel, doors, wood);
    partition(bp, F === 0 ? cx - 1 : cx, z1 + 4, F === 0 ? cx - 1 : cx, z2 - 1, y, 3, panel, [], wood);
    if (F === 0) partition(bp, cx + 1, z1 + 4, cx + 1, z2 - 1, y, 3, panel, [], wood);
    const west = { x1: x1 + 1, z1: z1 + 5, x2: (F === 0 ? cx - 2 : cx - 1), z2: z2 - 1, y, wood };
    const east = { x1: F === 0 ? cx + 2 : cx + 1, z1: z1 + 5, x2: x2 - 1, z2: z2 - 1, y, wood };
    for (const r of [west, east]) {
      for (let x = r.x1; x <= r.x2; x++) if (!doors.some(([dx]) => dx === x)) bp.set(x, y + 1, z1 + 3, 'black_concrete');
      const dx = doors.find(([d]) => d >= r.x1 && d <= r.x2)?.[0] ?? r.x1;
      bp.set(dx - r.x1 <= r.x2 - dx ? r.x2 : r.x1, y, z1 + 4, 'lectern[facing=south,has_book=true]');
      for (let x = r.x1 + 1; x + 1 <= r.x2; x += 3) {
        for (let z = r.z1; z + 1 <= r.z2; z += 2) {
          bp.set(x, y, z, `${wood}_slab[type=top]`);
          bp.set(x, y, z + 1, `${wood}_stairs[facing=south,half=bottom]`);
        }
      }
      light(bp, { x1: r.x1, z1: r.z1, x2: r.x2, z2: r.z2, y, h: 3 });
      (bp.rooms ??= []).push({ x1: r.x1, z1: z1 + 4, x2: r.x2, z2: r.z2, y, h: 3, kind: 'office', wood, keep: [], stage: 1 });
    }
    // Corridor: coat hooks and a plant; light.
    for (let x = x1 + 1; x <= x1 + 6; x++) if (!bp.get(x, y + 1, z1 + 1) && FULL_WALL(bp.get(x, y + 1, z1))) bp.set(x, y + 1, z1 + 1, 'tripwire_hook[facing=south,attached=false,powered=false]');
    light(bp, { x1: x1 + 1, z1: z1 + 1, x2: x1 + 6, z2: z1 + 2, y, h: 3 });
  }
  // Upper rooms are open to the roof: partitions run up to it (no attic floor).
  closeUnder(bp, at, [...Array(x2 - x1 - 1)].map((_, i) => [x1 + 1 + i, z1 + 3]), 9, plaster);
  closeUnder(bp, at, [...Array(z2 - z1 - 4)].map((_, i) => [cx, z1 + 4 + i]), 9, plaster);
  // Ground floor centre: the entrance hall between the two classrooms.
  light(bp, { x1: cx, z1: z1 + 4, x2: cx, z2: z2 - 1, y: 1, h: 3 });
  // Playground: linden, benches, a fountain, hopscotch, flag.
  bp.fill(0, 0, z2 + 2, 16, 0, 16, (x, y, z) => ((x + z) % 4 === 0 ? 'stone_bricks' : 'polished_andesite'));
  for (let x = cx; x <= cx + 1; x++) bp.set(x, 0, z2 + 1, 'polished_andesite');
  broadTree(bp, 2, 14, 5, 2, 'oak');
  bench(bp, 5, 15, 'south', 2, wood);
  YARD_ITEMS.fountain.draw(bp, rng, 11, 15, { wood: WOOD(wood) });
  for (const [i, x] of [11, 12, 13].entries()) bp.set(x, 1, 13, `${['red', 'yellow', 'blue'][i]}_carpet`);
  flagPole(bp, 15, 12, 7);
  bp.mark('bell', cx, ry + 2, tz);
  return bp;
}

// ---------------------------------------------------------------- market hall (Markthalle / Kornhaus)

export function markethall(rng) {
  const bp = new Blueprint();
  const x1 = 1, x2 = 15, z1 = 2, z2 = 13, cx = 8;
  const pillar = rng.pick(['stone_bricks', 'polished_andesite', 'tuff_bricks', 'smooth_sandstone']);
  const tw = WOOD(rng.pick(['dark_oak', 'spruce']));
  const roofMat = ROOFS[rng.pick(['tile', 'clay', 'slate', 'tile'])];
  const [ca, cb] = rng.pick([['red', 'white'], ['green', 'white'], ['yellow', 'red'], ['blue', 'white']]);
  bp.fill(0, 0, 0, 16, 0, 16, (x, y, z) => ((x + z) % 3 === 0 ? 'stone_bricks' : 'polished_andesite'));
  bp.fill(x1, 0, z1, x2, 0, z2, (x, y, z) => ((x + z) % 2 ? 'smooth_stone' : 'polished_andesite'));
  // Pillars on a 3-block grid round the edge, timber beams on top, cross beams to hang lanterns from.
  for (const [x, z] of perimeter(x1, z1, x2, z2)) {
    const p = (x - x1) % 3 === 0 && (z - z1) % 3 === 0 || ((x === x1 || x === x2) && (z - z1) % 3 === 0) || ((z === z1 || z === z2) && (x - x1) % 3 === 0);
    if (p) bp.fill(x, 1, z, x, 4, z, pillar);
    bp.set(x, 5, z, `${tw.log}[axis=${z === z1 || z === z2 ? 'x' : 'z'}]`);
  }
  for (let x = x1 + 3; x < x2; x += 3) for (let z = z1 + 1; z < z2; z++) bp.set(x, 5, z, `${tw.log}[axis=z]`);
  // Big hipped roof with a gable to the street carrying a clock.
  const at = roof(bp, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 1, y: 6, mat: roofMat, s: 3, brackets: tw.stairs });
  closeUnder(bp, at, perimeter(x1, z1, x2, z2).filter(([x, z]) => z === z2), 6, tw.planks, roofMat);
  if (at(cx, z2).y - 6 >= 4) clockFace(bp, cx, 8, z2, 'south');
  // Stalls: counters with goods, a cheese stall, flowers, bread; lanterns from the beams.
  const stall = (x, z, goods) => {
    for (let i = 0; i < 3; i++) {
      bp.set(x + i, 1, z, `${tw.slab}[type=top]`);
      bp.set(x + i, 2, z, rng.pick(goods));
    }
    bp.set(x + 1, 1, z - 1, `${tw.stairs}[facing=south,half=bottom]`);
  };
  const GOODS = {
    veg: ['carved_pumpkin[facing=south]', 'melon', 'pumpkin', 'hay_block[axis=x]'],
    cheese: ['yellow_terracotta', 'yellow_concrete', 'cake'],
    flowers: ['potted_red_tulip', 'potted_white_tulip', 'potted_flowering_azalea_bush', 'potted_poppy'],
    bread: ['cake', 'decorated_pot[facing=south]', 'candle[candles=3,lit=true]'],
  };
  const kinds = Object.keys(GOODS).sort(() => rng.next() - 0.5);
  stall(x1 + 2, z1 + 3, GOODS[kinds[0]]);
  stall(x2 - 4, z1 + 3, GOODS[kinds[1]]);
  stall(x1 + 2, z2 - 3, GOODS[kinds[2]]);
  stall(x2 - 4, z2 - 3, GOODS[kinds[3]]);
  for (const [x, z] of [[x1 + 2, z1 + 2], [x2 - 4, z1 + 2], [x1 + 2, z2 - 4], [x2 - 4, z2 - 4]]) bp.set(x + 1, 1, z, `${tw.stairs}[facing=north,half=bottom]`);
  for (let x = x1 + 3; x < x2; x += 3) for (const z of [z1 + 3, z2 - 3]) bp.set(x, 4, z, 'lantern[hanging=true]');
  for (let x = x1; x <= x2; x++) if (x % 2 === 0) bp.set(x, 4, z2 + 1, `${x % 4 ? ca : cb}_wall_banner[facing=south]`);
  bp.mark('workstation', x1 + 3, 1, z1 + 3, { data: { profession: 'farmer' } });
  bp.mark('workstation', x2 - 3, 1, z2 - 3, { data: { profession: 'butcher' } });
  // Fountain and benches outside.
  bench(bp, 2, 15, 'south', 2, tw.name);
  bench(bp, 12, 15, 'south', 2, tw.name);
  lamp(bp, cx, 15, 3, 'double');
  return bp;
}

// ---------------------------------------------------------------- railway station (Bahnhof)

export function station(rng) {
  const bp = new Blueprint();
  const x1 = 3, x2 = 13, z1 = 7, z2 = 13, cx = 8;
  const tw = WOOD(rng.pick(['spruce', 'dark_oak']));
  const plaster = rng.pick(['calcite', 'smooth_sandstone', 'white_terracotta', 'yellow_terracotta']);
  const roofMat = ROOFS[rng.pick(['tile', 'slate', 'dark_oak', 'spruce'])];
  const place = rng.pick(PLACES);
  // Track along the back (east-west), ballast, platform edge with a white line, canopy on iron columns.
  for (let x = 0; x <= 16; x++) {
    bp.set(x, 0, 0, 'gravel');
    bp.set(x, 0, 1, 'gravel');
    bp.set(x, 1, 1, 'rail[shape=east_west]');
    bp.set(x, 0, 2, 'gravel');
    bp.set(x, 0, 3, 'smooth_stone');
    for (let z = 4; z <= 6; z++) bp.set(x, 0, z, (x + z) % 2 ? 'polished_andesite' : 'smooth_stone');
  }
  for (let x = 0; x <= 16; x++) bp.set(x, 0, 3, 'white_concrete');
  bp.mark('rail_track', -2, 1, 1, { facing: 'east', data: { to: [18, 1, 1] } });
  for (let x = 1; x <= 15; x++)
    for (let z = 4; z <= 6; z++) {
      if (z === 4 && x % 4 === 1) bp.fill(x, 1, z, x, 3, z, 'polished_blackstone_wall');
      bp.set(x, 4, z, `${tw.slab}[type=bottom]`);
    }
  for (let x = 1; x <= 15; x++) bp.set(x, 4, 3, `${tw.trapdoor}[facing=north,half=top]`);
  // The SBB clock on its post, benches, a departure board.
  bp.set(cx, 1, 5, 'polished_blackstone_wall');
  bp.set(cx, 2, 5, 'polished_blackstone_wall');
  clockFace(bp, cx, 3, 5, 'north');
  bench(bp, 3, 5, 'south', 2, tw.name);
  bench(bp, 12, 5, 'south', 2, tw.name);
  // Station building: tall waiting hall, ticket counter, timber gable roof with a wide overhang.
  bp.fill(x1, 0, z1, x2, 0, z2, 'polished_andesite');
  bp.fill(x1 + 1, 0, z1 + 1, x2 - 1, 0, z2 - 1, (x, y, z) => ((x + z) % 2 ? 'smooth_stone' : 'polished_andesite'));
  bp.walls(x1, 1, z1, x2, 4, z2, (x, y, z) => ((x === x1 || x === x2) && (z === z1 || z === z2) ? 'stone_bricks' : y === 1 ? 'stone_bricks' : plaster));
  for (const x of [x1 + 2, x2 - 3]) {
    win(bp, rng, x, 2, z1, 'north', { w: 2, h: 2 });
    win(bp, rng, x, 2, z2, 'south', { w: 2, h: 2 });
  }
  win(bp, rng, x1, 2, z1 + 3, 'west', { h: 2 });
  win(bp, rng, x2, 2, z1 + 3, 'east', { h: 2 });
  doorway(bp, cx, 1, z1, 'north', tw.door, { transom: 'glass_pane' });
  doorway(bp, cx, 1, z2, 'south', tw.door, { transom: 'glass_pane' });
  const at = roof(bp, { x1: x1 - 2, x2: x2 + 2, z1: z1 - 1, z2: z2 + 1, y: 5, mat: roofMat, w: INF, e: INF, trim: { stairs: tw.stairs, slab: tw.slab }, brackets: tw.stairs });
  closeUnder(bp, at, perimeter(x1, z1, x2, z2), 5, tw.planks, roofMat);
  bp.set(cx, 4, z1 - 1, `${tw.sign}[facing=north]${signData(['', place, '', ''], 'black')}`);
  bp.set(cx + 2, 4, z2 + 1, `${tw.sign}[facing=south]${signData(['', place, 'SBB CFF FFS', ''], 'black')}`);
  for (let x = x2 - 3; x <= x2 - 1; x++) bp.set(x, 1, z1 + 1, x === x2 - 1 ? tw.planks : `${tw.slab}[type=top]`);
  bp.set(x2 - 2, 2, z1 + 1, 'bell[attachment=floor,facing=south]');
  bp.set(x1 + 1, 2, z1 + 1, `${tw.sign}[facing=south]${signData(['ABFAHRT', '08:12 Bern', '08:47 Luzern', '09:03 Chur'], 'black')}`);
  bench(bp, x1 + 2, z2 - 1, 'north', 3, tw.name);
  for (const x of [x1 + 3, x2 - 3]) light(bp, { x1: x, z1: z1 + 3, x2: x, z2: z1 + 3, y: 1 });
  bp.set(x2 - 1, 1, z2 - 1, rng.pick(HOUSE_PLANTS));
  // Forecourt: PostAuto stop, bike stand, lamp.
  for (let z = z2 + 1; z <= 16; z++) for (let x = 0; x <= 16; x++) bp.set(x, 0, z, (x + z) % 3 ? 'polished_andesite' : 'stone_bricks');
  bp.fill(1, 1, 15, 1, 2, 15, 'polished_blackstone_wall');
  bp.set(1, 3, 15, 'yellow_concrete');
  bp.set(2, 3, 15, `${tw.sign}[facing=east]${signData(['PostAuto', '', '', ''], 'black')}`);
  for (let x = 12; x <= 14; x++) bp.set(x, 1, 15, 'iron_bars');
  lamp(bp, 6, 15, 3, 'simple');
  return bp;
}

// ---------------------------------------------------------------- funicular stations (Standseilbahn)

/** Inclined track: rails ascending northwards from (x, y0, zFrom) to zTo, on a stone bed (or a dug trench). */
function funicularTrack(bp, x, y0, zFrom, zTo, { bed = 'stone_bricks', dig = false }) {
  let y = y0;
  for (let z = zFrom; z >= zTo; z--) {
    for (const dx of [0, 1]) {
      bp.set(x + dx, y - 1, z, bed);
      // One rail lane on a two-wide bed: parallel rails would bend towards each other when placed.
      if (dx === 0) bp.set(x + dx, y, z, z === zFrom ? 'rail[shape=north_south]' : 'rail[shape=ascending_north]');
      if (dig) for (let yy = y + 1; yy <= Math.max(y + 3, 0); yy++) bp.set(x + dx, yy, z, yy <= 0 ? 'air' : null);
    }
    y++;
  }
  return y - 1;
}

function funicularStation(rng, top) {
  const bp = new Blueprint();
  const x1 = 3, x2 = 13, z1 = 4, z2 = 12, cx = 8;
  const tw = WOOD(rng.pick(['spruce', 'dark_oak']));
  const roofMat = ROOFS[rng.pick(['slate', 'tile', 'copper'])];
  const plaster = rng.pick(['calcite', 'smooth_sandstone', 'white_terracotta']);
  const tx = cx; // track lanes tx, tx + 1
  bp.fill(0, 0, z2 + 1, 16, 0, 16, (x, y, z) => ((x + z) % 3 ? 'polished_andesite' : 'stone_bricks'));
  // Hall: platform steps beside the track, the track leaves through a portal in the back wall.
  bp.fill(x1, 0, z1, x2, 0, z2, 'polished_andesite');
  bp.walls(x1, 1, z1, x2, 8, z2, (x, y, z) => ((x === x1 || x === x2) && (z === z1 || z === z2) ? 'stone_bricks' : y <= 1 ? 'stone_bricks' : plaster));
  for (const x of [x1 + 1, x2 - 1]) {
    win(bp, rng, x, 2, z2, 'south', { h: 3 });
    win(bp, rng, x1, 3, z1 + 3, 'west', { h: 2, w: 3 });
    win(bp, rng, x2, 3, z1 + 3, 'east', { h: 2, w: 3 });
  }
  doorway(bp, cx - 2, 1, z2, 'south', tw.door, { transom: 'glass_pane' });
  // Track: at the bottom station it climbs out through the back wall on piers; at the top it comes up from below.
  if (!top) {
    const yEnd = funicularTrack(bp, tx, 1, z2 - 1, -2, {});
    for (let z = z2 - 1; z >= -2; z--) {
      const yy = 1 + (z2 - 1 - z);
      for (const dx of [0, 1]) {
        if (z >= z1) for (let y = 1; y <= yy - 2; y++) bp.set(tx + dx, y, z, 'stone_bricks'); // ramp inside the hall
        else if ((z1 - z) % 3 === 1) bp.fill(tx + dx, 0, z, tx + dx, yy - 2, z, 'stone_bricks'); // piers outside
      }
    }
    const yp = 1 + (z2 - 1 - z1);
    for (const x of [tx, tx + 1]) for (let y = yp + 1; y <= yp + 3; y++) bp.set(x, y, z1, null);
    bp.mark('funicular', tx, 1, z2 - 1, { facing: 'north', data: { end: 'bottom', top: [tx, yEnd, -2] } });
  } else {
    let y = 1;
    for (let z = z2 - 1; z >= -2; z--) {
      for (const dx of [0, 1]) {
        bp.set(tx + dx, y - 1, z, 'stone_bricks');
        if (dx === 0) bp.set(tx + dx, y, z, z === z2 - 1 ? 'rail[shape=north_south]' : 'rail[shape=ascending_south]');
        else if (y <= 0) bp.set(tx + dx, y, z, 'air');
        for (let yy = y + 1; yy <= 0; yy++) bp.set(tx + dx, yy, z, 'air');
      }
      if (y <= 0) for (const dx of [-1, 2]) for (let yy = y - 1; yy <= 0; yy++) bp.set(tx + dx, yy, z, 'stone_bricks');
      y--;
    }
    bp.mark('funicular', tx, 1, z2 - 1, { facing: 'south', data: { end: 'top', bottom: [tx, y + 1, -2] } });
  }
  // Platform: stepped slabs beside the track, a railing to the track, benches, ticket gate, clock.
  for (let z = z1 + 1; z <= z2 - 1; z++) bp.set(tx + 2, 1, z, 'iron_bars');
  for (let z = z1 + 1; z <= z2 - 1; z++) bp.set(tx - 1, 1, z, 'iron_bars');
  bp.set(tx + 2, 1, z2 - 1, null);
  bp.set(tx - 1, 1, z2 - 1, null);
  bench(bp, x1 + 1, z1 + 3, 'west', 3, tw.name);
  for (let x = x1 + 1; x <= x1 + 2; x++) bp.set(x, 1, z1 + 1, `${tw.slab}[type=top]`);
  bp.set(x1 + 1, 2, z1 + 1, 'bell[attachment=floor,facing=east]');
  clockFace(bp, cx + 3, 5, z2, 'south');
  const at = roof(bp, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 1, y: 9, mat: roofMat, n: INF, s: INF, trim: { stairs: tw.stairs, slab: tw.slab } });
  closeUnder(bp, at, perimeter(x1, z1, x2, z2), 9, plaster, roofMat);
  if (!top) { const yp = 1 + (z2 - 1 - z1); for (const x of [tx, tx + 1]) for (let y = yp + 1; y <= yp + 3; y++) bp.set(x, y, z1, null); }
  bp.set(cx - 2, 4, z2 + 1, `${tw.sign}[facing=south]${signData(['STANDSEILBAHN', top ? 'Bergstation' : 'Talstation', rng.pick(PLACES), ''], 'black')}`);
  for (const x of [x1 + 2, x2 - 2]) light(bp, { x1: x, z1: (z1 + z2) >> 1, x2: x, z2: (z1 + z2) >> 1, y: 1, h: 3 });
  lamp(bp, 2, 15, 3, 'double');
  bench(bp, 12, 15, 'south', 2, tw.name);
  if (top) flagPole(bp, 15, 14, 8);
  return bp;
}

export function funicular_bottom(rng) {
  return funicularStation(rng, false);
}

export function funicular_top(rng) {
  return funicularStation(rng, true);
}

// ---------------------------------------------------------------- viewpoint shelter (Aussichtspunkt)

export function viewpoint(rng) {
  const bp = new Blueprint();
  const tw = WOOD(rng.pick(['spruce', 'dark_oak', 'oak']));
  const roofMat = ROOFS[rng.pick(['spruce', 'slate', 'dark_oak'])];
  const cx = 8, cz = 7;
  // Stone terrace towards the view (north) with a railing, a path from the street.
  for (let x = 2; x <= 14; x++) for (let z = 1; z <= 11; z++) bp.set(x, 0, z, (x + z) % 3 ? 'stone_bricks' : 'mossy_stone_bricks');
  for (let x = 2; x <= 14; x++) bp.set(x, 1, 1, tw.fence);
  for (let z = 1; z <= 11; z++) for (const x of [2, 14]) bp.set(x, 1, z, tw.fence);
  for (let z = 12; z <= 16; z++) bp.set(cx, 0, z, rng.pick(['dirt_path', 'gravel']));
  // Open shelter: four posts, a pyramid roof, benches facing the view.
  for (const [x, z] of [[cx - 2, cz - 2], [cx + 2, cz - 2], [cx - 2, cz + 2], [cx + 2, cz + 2]]) bp.fill(x, 1, z, x, 3, z, `${tw.log}[axis=y]`);
  for (let x = cx - 2; x <= cx + 2; x++) for (const z of [cz - 2, cz + 2]) bp.set(x, 4, z, `${tw.log}[axis=x]`);
  for (let z = cz - 1; z <= cz + 1; z++) for (const x of [cx - 2, cx + 2]) bp.set(x, 4, z, `${tw.log}[axis=z]`);
  roof(bp, { x1: cx - 3, x2: cx + 3, z1: cz - 3, z2: cz + 3, y: 4, mat: roofMat, trim: { stairs: tw.stairs, slab: tw.slab } });
  bp.set(cx, 4, cz, 'lantern[hanging=true]');
  bp.set(cx, 3, cz, null);
  bp.set(cx, 4, cz, tw.planks);
  bp.set(cx, 3, cz, 'lantern[hanging=true]');
  bench(bp, cx - 1, cz - 1, 'south', 3, tw.name);
  bench(bp, cx - 1, cz + 1, 'south', 3, tw.name);
  bp.mark('spyglass_spot', cx + 3, 2, 2, { facing: 'north', data: { item: 'spyglass' } });
  bp.set(cx + 3, 1, 2, 'andesite_wall');
  bp.set(cx - 3, 1, 2, `${tw.sign.replace('_wall_sign', '_sign')}[rotation=8]${signData(['AUSSICHT', 'Eiger  3967', 'Moench 4107', 'Jungfrau 4158'], 'black')}`);
  flagPole(bp, 13, 10, 6);
  for (const [x, z] of [[4, 10], [12, 4]]) bp.set(x, 1, z, rng.pick(['flowering_azalea', 'azalea']));
  sprinkleFlowers(bp, rng, 0, 12, 16, 16, 0.25, ['azure_bluet', 'cornflower', 'dandelion', 'oxeye_daisy', 'short_grass', 'allium']);
  spruce(bp, 1, 14, rng.int(6, 8), 1);
  spruce(bp, 15, 14, rng.int(5, 7), 1);
  return bp;
}

// ---------------------------------------------------------------- fire station (Feuerwehrdepot with hose tower)

export function firestation(rng) {
  const bp = new Blueprint();
  const x1 = 1, x2 = 11, z1 = 3, z2 = 12;
  const plaster = rng.pick(['calcite', 'white_terracotta', 'smooth_sandstone']);
  const roofMat = ROOFS[rng.pick(['tile', 'slate', 'clay'])];
  const wood = rng.pick(['spruce', 'dark_oak']);
  // Garage hall with two red gates, crew room above, hose tower at the side.
  bp.fill(x1, 0, z1, x2, 0, z2, 'smooth_stone');
  bp.walls(x1, 1, z1, x2, 8, z2, (x, y, z) => ((x === x1 || x === x2) && (z === z1 || z === z2) ? 'stone_bricks' : y <= 1 ? 'stone_bricks' : y === 5 ? 'red_terracotta' : plaster));
  bp.fill(x1 + 1, 5, z1 + 1, x2 - 1, 5, z2 - 1, `${wood}_planks`);
  for (const gx of [x1 + 1, x1 + 5]) {
    for (let x = gx; x <= gx + 2; x++) for (let y = 1; y <= 3; y++) bp.set(x, y, z2, y === 3 ? 'red_concrete' : 'red_terracotta');
    for (let x = gx - 1; x <= gx + 3; x++) bp.set(x, 4, z2, 'stone_bricks');
    bp.set(gx + 1, 2, z2 + 1, 'stone_button[face=wall,facing=south]');
  }
  bp.door(x2 - 1, 1, z2, wood, 'south');
  bp.set(x2 - 1, 3, z2, 'glass');
  for (const x of [x1 + 2, x1 + 5, x1 + 8]) win(bp, rng, x, 6, z2, 'south', { w: 2, h: 2 });
  win(bp, rng, x1, 2, z1 + 3, 'west', { w: 3, h: 2 });
  win(bp, rng, x1, 6, z1 + 3, 'west', { w: 3, h: 2 });
  bp.set(x1 + 5, 5, z2 + 1, `${wood}_wall_sign[facing=south]${signData(['', 'FEUERWEHR', '118', ''], 'red')}`);
  const at = roof(bp, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 1, y: 9, mat: roofMat, n: INF, s: INF, brackets: `${wood}_stairs` });
  closeUnder(bp, at, perimeter(x1, z1, x2, z2), 9, plaster, roofMat);
  // Two engines (block models: red body, white stripe, black wheels) and kit along the walls.
  for (const gx of [x1 + 1, x1 + 5]) {
    for (let z = z1 + 3; z <= z1 + 7; z++) {
      bp.set(gx, 1, z, z === z1 + 3 || z === z1 + 7 ? 'black_terracotta' : 'red_terracotta');
      bp.set(gx + 2, 1, z, z === z1 + 3 || z === z1 + 7 ? 'black_terracotta' : 'red_terracotta');
      bp.set(gx + 1, 1, z, 'red_terracotta');
      bp.set(gx + 1, 2, z, z >= z1 + 6 ? 'light_gray_stained_glass' : z === z1 + 5 ? 'white_terracotta' : 'red_terracotta');
    }
    bp.set(gx + 1, 3, z1 + 6, 'blue_stained_glass');
    bp.mark('vehicle_spot', gx + 1, 1, z1 + 5, { facing: 'south', data: { kind: 'fire_engine' } });
  }
  for (let x = x1 + 1; x <= x1 + 7; x += 2) bp.set(x, 2, z1 + 1, 'tripwire_hook[facing=south,attached=false,powered=false]');
  bp.set(x1 + 1, 1, z1 + 1, 'barrel[facing=up]');
  bp.set(x1 + 2, 1, z1 + 1, 'chest[facing=south]');
  for (const [x, z] of [[x1 + 3, z1 + 5], [x1 + 7, z1 + 5], [x2 - 2, z2 - 2]]) bp.set(x, 4, z, 'lantern[hanging=true]');
  // Hose tower (Schlauchturm) at the east side: ladder to the top room with the alarm bell.
  const tx1 = x2, tz1 = z1 + 1, tx2 = x2 + 2, tz2 = z1 + 3, H = 15;
  bp.fill(tx1, 0, tz1, tx2, 0, tz2, 'stone_bricks');
  bp.walls(tx1, 1, tz1, tx2, H, tz2, (x, y, z) => ((x === tx1 || x === tx2) && (z === tz1 || z === tz2) ? 'stone_bricks' : y <= 1 ? 'stone_bricks' : plaster));
  bp.door(x2, 1, tz1 + 1, wood, 'east');
  for (let y = 1; y <= H - 2; y++) bp.set(tx1 + 1, y, tz1 + 1, 'ladder[facing=north]');
  for (const [x, z, f] of [[tx1 + 1, tz1, 'north'], [tx2, tz1 + 1, 'east'], [tx1 + 1, tz2, 'south']]) bp.set(x, H - 1, z, 'glass_pane');
  bp.set(tx1 + 1, H - 1, tz1 + 1, 'bell[attachment=ceiling,facing=south]');
  bp.set(tx1 + 1, H, tz1 + 1, `${wood}_planks`);
  for (let y = 4; y < H - 4; y += 4) bp.set(tx2, y, tz1 + 1, 'glass_pane');
  const tr = roof(bp, { x1: tx1, x2: tx2, z1: tz1, z2: tz2, y: H + 1, mat: roofMat, kind: 'steep', pitch: 2 });
  bp.set(tx1 + 1, tr(tx1 + 1, tz1 + 1).y + 1, tz1 + 1, 'waxed_oxidized_lightning_rod[facing=up]');
  // Crew room upstairs by stairs from the garage.
  const hall = stairHall(bp, { axis: 'z', laneA: [x2 - 2], laneB: [x2 - 1], u0: z2 - 2, dir: -1, planes: [0, 5], wood });
  furnish(bp, rng, { x1: x1 + 1, z1: z1 + 1, x2: x2 - 3, z2: z2 - 1, y: 6, h: 3 }, 'common', [...hall.cells, ...(hall.ends[5] ?? [])], wood, { items: ['chest', 'barrel', 'chiseled', 'clock'], table: true });
  // Apron: hydrant, flag.
  bp.fill(x1, 0, z2 + 1, x2, 0, 16, 'smooth_stone');
  bp.set(14, 1, 14, 'red_concrete');
  bp.set(14, 2, 14, 'red_terracotta');
  flagPole(bp, 15, 16, 7);
  return bp;
}

// ---------------------------------------------------------------- post office (Post, PTT yellow)

export function postoffice(rng) {
  const bp = new Blueprint();
  const x1 = 2, x2 = 14, z1 = 4, z2 = 11, cx = 8;
  const plaster = rng.pick(['calcite', 'smooth_sandstone', 'white_terracotta', 'light_gray_terracotta']);
  const trim = rng.pick([TRIMS.stone, TRIMS.andesite, TRIMS.tuff]);
  const roofMat = ROOFS[rng.pick(['tile', 'slate', 'clay', 'deepslate'])];
  const wood = rng.pick(['spruce', 'oak', 'dark_oak']);
  const planes = [0, 5];
  bp.fill(x1, 0, z1, x2, 0, z2, 'polished_andesite');
  bp.fill(x1 + 1, 0, z1 + 1, x2 - 1, 0, z2 - 1, (x, y, z) => ((x + z) % 2 ? 'smooth_stone' : 'polished_andesite'));
  bp.walls(x1, 1, z1, x2, 8, z2, (x, y, z) => ((x === x1 || x === x2) && (z === z1 || z === z2) ? trim.block : y === 1 || y === 5 ? trim.block : plaster));
  bp.fill(x1 + 1, 5, z1 + 1, x2 - 1, 5, z2 - 1, `${wood}_planks`);
  for (const x of [x1 + 2, x2 - 3]) {
    win(bp, rng, x, 2, z2, 'south', { w: 2, h: 2, lintel: trim.block });
    win(bp, rng, x, 6, z2, 'south', { w: 2, h: 2, lintel: trim.block, box: `${wood}_trapdoor` });
  }
  win(bp, rng, cx - 1, 6, z2, 'south', { w: 3, h: 2, lintel: trim.block });
  for (const z of [z1 + 5]) {
    win(bp, rng, x1, 2, z, 'west', { w: 2, h: 2 });
    win(bp, rng, x1, 6, z, 'west', { w: 2, h: 2 });
    win(bp, rng, x2, 6, z, 'east', { w: 2, h: 2 });
  }
  doorway(bp, cx, 1, z2, 'south', wood, { double: true, frame: trim.block, transom: 'glass_pane' });
  // The yellow POST band with the post horn, a mailbox, the PostAuto stop.
  for (let x = x1 + 1; x <= x2 - 1; x++) bp.set(x, 4, z2 + 1, 'yellow_wall_banner[facing=south]');
  bp.set(cx, 4, z2 + 1, `yellow_wall_banner[facing=south]${pattern([['circle', 'black'], ['half_horizontal_bottom', 'yellow'], ['border', 'black']])}`);
  bp.set(cx + 2, 4, z2 + 1, `${wood}_wall_sign[facing=south]${signData(['', 'POST', 'PTT', ''], 'black')}`);
  bp.set(x2 - 1, 1, z2 + 1, 'yellow_concrete');
  bp.set(x2 - 1, 2, z2 + 1, 'yellow_terracotta');
  const at = roof(bp, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 1, y: 9, mat: roofMat, w: INF, e: INF, brackets: `${wood}_stairs` });
  closeUnder(bp, at, perimeter(x1, z1, x2, z2), 9, plaster, roofMat);
  // Counter hall: three counters with bells, parcel shelves, a bench; stairs to the postmaster's flat.
  const hall = stairHall(bp, { axis: 'x', laneA: [z1 + 2], laneB: [z1 + 1], u0: x2 - 1, dir: -1, planes, wood });
  for (let x = x1 + 1; x <= x1 + 7; x++) {
    bp.set(x, 1, z1 + 4, x % 2 ? `${wood}_slab[type=top]` : 'yellow_terracotta');
    if (x % 2) bp.set(x, 2, z1 + 4, x === x1 + 3 ? 'bell[attachment=floor,facing=south]' : 'candle[candles=1,lit=true]');
  }
  for (let x = x1 + 1; x <= x1 + 6; x++) bp.set(x, 1, z1 + 1, 'barrel[facing=south]');
  bench(bp, x2 - 4, z2 - 1, 'north', 3, wood);
  for (const x of [x1 + 3, x2 - 4]) light(bp, { x1: x, z1: z1 + 5, x2: x, z2: z1 + 6, y: 1, h: 3 });
  bp.mark('workstation', x1 + 3, 1, z1 + 4, { data: { profession: 'cartographer' } });
  const keep = [...hall.cells, ...(hall.ends[5] ?? [])];
  partition(bp, x1 + 1, z1 + 3, x2 - 1, z1 + 3, 6, 3, plaster, [[x2 - 4, z1 + 3], [x1 + 3, z1 + 3]], wood);
  bp.set(x1 + 1, 6, z1 + 4, 'smoker[facing=south,lit=true]');
  bp.set(x1 + 2, 6, z1 + 4, 'water_cauldron[level=3]');
  furnish(bp, rng, { x1: x1 + 1, z1: z1 + 4, x2: cx + 1, z2: z2 - 1, y: 6, h: 3 }, 'kitchen', [...keep, [x1 + 3, z1 + 4], [cx + 1, z1 + 5]], wood, { items: ['counter', 'crafting', 'chest'], table: true });
  partition(bp, cx + 2, z1 + 4, cx + 2, z2 - 1, 6, 3, plaster, [[cx + 2, z1 + 5]], wood);
  furnish(bp, rng, { x1: cx + 3, z1: z1 + 4, x2: x2 - 1, z2: z2 - 1, y: 6, h: 3 }, 'bedroom', [[cx + 3, z1 + 5], ...keep], wood, { items: ['bed', 'chest', 'tub', 'plant', 'toilet'] });
  closeUnder(bp, at, [...Array(x2 - x1 - 1)].map((_, i) => [x1 + 1 + i, z1 + 3]), 9, plaster);
  closeUnder(bp, at, [...Array(z2 - z1 - 4)].map((_, i) => [cx + 2, z1 + 4 + i]), 9, plaster);
  light(bp, { x1: x1 + 4, z1: z1 + 1, x2: x1 + 8, z2: z1 + 2, y: 6 });
  // Forecourt with the PostAuto stop.
  bp.fill(0, 0, z2 + 1, 16, 0, 16, (x, y, z) => ((x + z) % 3 ? 'polished_andesite' : 'stone_bricks'));
  bp.fill(2, 1, 15, 2, 2, 15, 'polished_blackstone_wall');
  bp.set(2, 3, 15, 'yellow_concrete');
  bp.set(3, 3, 15, `${wood}_wall_sign[facing=east]${signData(['PostAuto', 'Haltestelle', '', ''], 'black')}`);
  bench(bp, 4, 16, 'south', 2, wood);
  planter(bp, 14, 15, wood);
  return bp;
}
