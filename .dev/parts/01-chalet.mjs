
// ================================================================ chalet (Bernese Oberland)

export function chalet(rng, options = {}) {
  const bp = new Blueprint();
  const W = rng.weighted([[11, 4], [13, 3]]);
  const D = rng.weighted([[9, 2], [11, 3]]);
  const x1 = (INNER - W) >> 1;
  const x2 = x1 + W - 1;
  const cx = 8;
  const z2 = 11;
  const z1 = z2 - D + 1;
  const ix1 = x1 + 1, ix2 = x2 - 1, iz1 = z1 + 1, iz2 = z2 - 1;
  const tw = WOOD(rng.weighted([['spruce', 5], ['dark_oak', 4], ['oak', 1]]));
  const trimW = WOOD(tw.name === 'dark_oak' ? rng.pick(['spruce', 'oak', 'birch']) : rng.pick(['dark_oak', 'spruce', 'birch']));
  const inner = WOOD(rng.pick(['spruce', 'oak', 'birch', 'spruce']));
  const logWalls = rng.chance(0.55);
  const isCorner = (x, z) => (x === x1 || x === x2) && (z === z1 || z === z2);
  const timber = (x, y, z) => (isCorner(x, z) ? `${tw.log}[axis=y]` : logWalls ? `${tw.stripped}[axis=${z === z1 || z === z2 ? 'x' : 'z'}]` : tw.planks);
  const stone = stoneMix(rng);
  const plasterBase = rng.chance(0.45);
  const plaster = rng.pick(['calcite', 'calcite', 'smooth_quartz', 'white_terracotta']);
  const nUp = rng.chance(0.45) ? 2 : 1;
  const steep = rng.chance(0.4);
  const roofMat = ROOFS[rng.weighted([['spruce', 3], ['dark_oak', 3], ['slate', 3], ['stone', 1]])];
  const shutter = rng.chance(0.75) ? rng.weighted(SHUTTERS) : null;
  const rail = rng.weighted([['board', 5], ['fence', 2]]);
  const leanTo = W === 11 && rng.chance(0.45);
  const sideDeck = !leanTo && W === 11 && rng.chance(0.4);
  const isHouse = (x, z) => x >= x1 && x <= x2 && z >= z1 && z <= z2;
  const planes = [0, 4, 8, 12].slice(0, nUp + 1);
  const yTop = 4 + 4 * nUp;

  // Foundation and ground floor (masonry or whitewashed plaster on a stone plinth).
  bp.fill(x1, 0, z1, x2, 0, z2, 'stone_bricks');
  bp.fill(ix1, 0, iz1, ix2, 0, iz2, inner.planks);
  bp.walls(x1, 1, z1, x2, 3, z2, (x, y, z) => (!plasterBase || y === 1 || isCorner(x, z) ? stone() : plaster));
  // Growth stages: 1 = this ground floor under a provisional roof (drawn at the end), 2 = the full chalet.
  for (let u = 0; u < nUp; u++) {
    const yb = 4 + 4 * u;
    bp.stage = u === 0 ? 1 : 2;
    bp.fill(ix1, yb, iz1, ix2, yb, iz2, inner.planks);
    logRing(bp, x1, z1, x2, z2, yb, tw.log);
    bp.stage = 2;
    bp.walls(x1, yb + 1, z1, x2, yb + 3, z2, timber);
  }
  bp.fill(ix1, yTop, iz1, ix2, yTop, iz2, inner.planks);
  logRing(bp, x1, z1, x2, z2, yTop, tw.log);
  bp.stage = 1;

  // ---- windows and doors
  const gx = W === 11 ? [[cx - 3, 1], [cx + 3, 1]] : [[cx - 4, 2], [cx + 3, 2]];
  for (const [x, w] of gx) win(bp, rng, x, 2, z2, 'south', { w, h: 2, shutters: shutter });
  for (const x of [cx - 3, cx + 2]) win(bp, rng, x, 2, z1, 'north', { w: 2, h: 2, shutters: shutter });
  const groups = W === 13 ? [[2, 3], [5, 5]] : [[2, 3]];
  const leanZ = [z1 + 1, Math.min(z2 - 2, z1 + 5)];
  const inLean = (z) => leanTo && z >= leanZ[0] - 1 && z <= leanZ[1] + 1;
  const sideZ = [];
  for (let z = z1 + 2; z <= z2 - 2; z += 3) sideZ.push(z);
  bp.stage = 2;
  for (let u = 0; u < nUp; u++) {
    const yb = 4 + 4 * u;
    for (const [a, b] of groups)
      for (const sgn of [-1, 1]) win(bp, rng, sgn > 0 ? cx + a : cx - b, yb + 1, z2, 'south', { w: b - a + 1, h: 2, shutters: shutter });
    bp.door(cx, yb + 1, z2, tw.door, 'south');
    win(bp, rng, cx + 2, yb + 1, z1, 'north', { w: 2, h: 2, shutters: shutter, box: trimW.trapdoor });
  }
  for (const z of sideZ) {
    bp.stage = 1;
    win(bp, rng, x1, 2, z, 'west', { h: 2, shutters: shutter });
    if (!inLean(z)) win(bp, rng, x2, 2, z, 'east', { h: 2, shutters: shutter });
    bp.stage = 2;
    for (let u = 0; u < nUp; u++) {
      const yb = 4 + 4 * u;
      win(bp, rng, x1, yb + 1, z, 'west', { h: 2, shutters: shutter, box: trimW.trapdoor });
      if (u === 0 && inLean(z)) continue;
      win(bp, rng, x2, yb + 1, z, 'east', { h: 2, shutters: sideDeck && u === 0 ? undefined : shutter, box: sideDeck && u === 0 ? undefined : trimW.trapdoor });
    }
  }
  bp.stage = 1;
  bp.door(cx, 1, z2, tw.door, 'south');
  bp.set(cx, 0, z2 + 1, 'stone_brick_slab[type=top]');
  wallLamp(bp, cx + 1, 3, z2, 'south', trimW.fence);
  wallLamp(bp, cx - 1, 3, z2, 'south', trimW.fence);

  // ---- staircase along the east wall, rooms, chimney above the kitchen stove
  bp.stage = 2;
  const hall = stairHall(bp, { axis: 'z', laneA: [ix2 - 1], laneB: [ix2], u0: iz2, dir: -1, planes, wood: inner.name });
  let zp = (iz1 + iz2) >> 1;
  if (sideZ.includes(zp)) zp++;
  const roomX2 = ix2 - 2;
  const sx = ix1;
  for (const F of planes) {
    bp.stage = F === 0 ? 1 : 2;
    const panel = (x, y, z) => (y === F + 1 ? inner.planks : `${inner.stripped}[axis=x]`);
    partition(bp, ix1, zp, roomX2, zp, F + 1, 3, panel, [[F === 0 ? cx - 1 : cx, zp]], inner.door);
  }
  // Kitchen stove with its chimney breast running up through every floor and out of the roof.
  bp.stage = 1;
  bp.set(sx, 1, iz1, 'smoker[facing=south,lit=true]');
  bp.stage = 2;
  // ---- roof: wide overhang, gable to the street, decorative barge boards
  const R = { x1: x1 - 2, x2: x2 + 2, z1: z1 - 1, z2: z2 + 3 };
  const at = roof(bp, { ...R, y: steep ? yTop - 1 : yTop, mat: roofMat, kind: steep ? 'stairs' : 'slabs', n: INF, s: INF, trim: { stairs: trimW.stairs, slab: trimW.slab } });
  closeUnder(bp, at, perimeter(x1, z1, x2, z2), yTop + 1, tw.planks, roofMat);
  const chim = rng.pick(['cobblestone', 'stone_bricks', 'bricks']);
  bp.atStageDraw(1, () => bp.fill(sx, 2, iz1, sx, 3, iz1, chim));
  bp.fill(sx, 4, iz1, sx, at(sx, iz1).y + 1, iz1, chim);
  bp.set(sx, at(sx, iz1).y + 2, iz1, 'campfire[lit=true,signal_fire=false]');
  for (const x of [x1, x2, x1 + 2, x2 - 2]) {
    const c = at(x, z2 + 1);
    bp.setIfEmpty(x, c.y - 1, z2 + 1, `${trimW.stairs}[facing=north,half=top]`);
  }
  // Attic: ladder up from the top storey against the back wall.
  ladderUp(bp, cx, iz1, 'south', planes[nUp] + 1, yTop);
  // Gable: windows, attic balcony on steep roofs, Swiss flag under the ridge.
  const room = (x) => at(x, z2).y - (yTop + 1);
  if (steep && room(cx) >= 4) {
    const cells = [];
    for (let x = x1 + 2; x <= x2 - 2; x++) if (room(x) >= 3) cells.push([x, z2 + 1], [x, z2 + 2]);
    deck(bp, rng, cells, yTop, { floor: `${trimW.slab}[type=top]`, rail, wood: trimW.name, isHouse, flowers: 0.6 });
    bp.door(cx, yTop + 1, z2, tw.door, 'south');
    for (const x of [cx - 2, cx + 2]) if (room(x) >= 3) win(bp, rng, x, yTop + 1, z2, 'south', { h: 2 });
    if (room(cx) >= 5) bp.set(cx, yTop + 4, z2 + 1, `red_wall_banner[facing=south]${SWISS_FLAG}`);
  } else {
    bp.set(cx, yTop + 2, z2 + 1, `red_wall_banner[facing=south]${SWISS_FLAG}`);
    for (const x of [cx - 2, cx + 2]) if (room(x) >= 1) win(bp, rng, x, yTop + 1, z2, 'south', { h: Math.min(2, room(x)) });
  }

  // ---- balconies
  for (let u = 0; u < nUp; u++) {
    const yb = 4 + 4 * u;
    const inset = u === 1 ? 1 : 0;
    const cells = [];
    for (let x = x1 - 1 + inset; x <= x2 + 1 - inset; x++) for (let k = 1; k <= 2; k++) cells.push([x, z2 + k]);
    if (sideDeck && u === 0) {
      for (let z = z1 + 1; z <= z2; z++) for (let x = x2 + 1; x <= x2 + 2; x++) cells.push([x, z]);
      cells.push([x2 + 2, z2 + 1], [x2 + 2, z2 + 2]);
    }
    deck(bp, rng, cells, yb, { floor: `${trimW.slab}[type=top]`, rail, wood: trimW.name, isHouse, bracket: trimW.stairs, flowers: 0.75 });
  }

  // ---- lean-to woodshed (Schopf) on the east side
  bp.stage = 1;
  if (leanTo) {
    const [za, zb] = leanZ;
    const xa = x2 + 1;
    const xb = Math.min(16, x2 + 3);
    for (let z = za; z <= zb; z++) {
      bp.fill(xb, 1, z, xb, 3, z, z === zb ? `${tw.log}[axis=y]` : `${tw.stripped}[axis=y]`);
      for (let x = xa; x <= xb; x++) {
        const d = xb - x;
        bp.set(x, d === 2 ? 5 : 4, z, d === 1 ? `${roofMat.stairs}[facing=west,half=bottom]` : `${roofMat.slab}[type=bottom]`);
      }
    }
    for (let x = xa; x < xb; x++) bp.fill(x, 1, za, x, 3, za, `${tw.stripped}[axis=y]`);
    for (let x = xa; x < xb; x++)
      for (let z = za + 1; z <= zb; z++)
        for (let y = 1; y <= 2; y++) bp.set(x, y, z, `${rng.pick(['oak_log', 'birch_log', 'spruce_log'])}[axis=z]`);
  }

  // ---- interiors: Stube + kitchen downstairs, bedrooms + bath upstairs, storage in the attic
  const keepOn = (F) => [...hall.cells, ...(hall.ends[F] ?? []), [cx, iz2], [cx, iz1], [cx - 1, zp - 1], [cx - 1, zp + 1], [cx, zp - 1], [cx, zp + 1]];
  const front = (F) => ({ x1: ix1, z1: zp + 1, x2: roomX2, z2: iz2, y: F + 1, h: 3 });
  const back = (F) => ({ x1: ix1, z1: iz1, x2: roomX2, z2: zp - 1, y: F + 1, h: 3 });
  furnish(bp, rng, front(0), 'stube', keepOn(0), inner.name);
  furnish(bp, rng, back(0), 'kitchen', [...keepOn(0), [sx, iz1 + 1]], inner.name, { table: false });
  bp.stage = 2;
  for (let u = 1; u <= nUp; u++) {
    const F = planes[u];
    const keep = [...keepOn(F), [cx, iz1 + 1], [cx, iz1]];
    furnish(bp, rng, front(F), u === 1 ? 'bedroom' : 'twin', keep, inner.name);
    furnish(bp, rng, back(F), u === 1 ? 'bath' : 'office', keep, inner.name);
  }
  bp.atStageDraw(1, () => light(bp, { x1: ix2 - 1, z1: iz1, x2: ix2, z2: iz2, y: 1, h: 3 }));
  furnish(bp, rng, { x1: ix1 + 1, z1: iz1, x2: ix2 - 1, z2: iz2, y: yTop + 1, h: 2 }, 'storage', [[cx, iz1], [cx, iz1 + 1], [cx, iz2], [cx, iz2 - 1]], inner.name, { items: ['barrel', 'chest', 'barrel'] });

  // ---- garden
  bp.stage = 1;
  const pathKind = rng.pick(['dirt_path', 'gravel', 'stones']);
  for (let z = z2 + 2; z <= 16; z++) bp.set(cx, 0, z, pathKind === 'stones' ? (z % 2 ? 'cobblestone' : 'mossy_cobblestone') : pathKind);
  bench(bp, cx + 2, z2 + 1, 'north', 2, trimW.name);
  for (let x = x1; x <= cx - 2; x++) bp.setIfEmpty(x, 1, z2 + 1, rng.pick(BOX_FLOWERS));
  const fenceStyle = rng.weighted([['picket', 5], ['none', 2], ['stone', 1.5]]);
  if (fenceStyle === 'picket') plotFence(bp, [cx], trimW.fence, trimW.gate, { back: false, fromZ: z2 - 2 });
  if (fenceStyle === 'stone') for (let x = 0; x <= 16; x++) if (x !== cx) bp.setIfEmpty(x, 1, 16, 'cobblestone_wall');
  for (let z = z1 + 1; z <= z2 - 1; z++) {
    bp.setIfEmpty(x1 - 1, 1, z, `${rng.pick(['oak_log', 'birch_log', 'spruce_log'])}[axis=x]`);
    if (rng.chance(0.7) && !/glass/.test(bp.get(x1, 2, z) ?? '')) bp.setIfEmpty(x1 - 1, 2, z, `${rng.pick(['oak_log', 'birch_log', 'spruce_log'])}[axis=x]`);
  }
  if (rng.chance(0.6)) flagPole(bp, rng.chance(0.5) ? 1 : 15, 15, 6);
  if (x1 >= 3 && !leanTo && !sideDeck) spruce(bp, 15, z1 + 1, rng.int(6, 8), 1);
  if (rng.chance(0.6)) {
    const crop = rng.pick(['carrots[age=7]', 'potatoes[age=7]', 'wheat[age=7]', 'beetroots[age=3]']);
    for (let z = z2 + 4; z <= 15; z++)
      for (let x = 1; x <= 2; x++)
        if (!bp.get(x, 1, z)) {
          bp.set(x, 0, z, 'farmland[moisture=7]');
          bp.set(x, 1, z, crop);
        }
  }
  sprinkleFlowers(bp, rng, 1, z2 + 4, 15, 15, 0.15);
  const mirror = rng.chance(0.5);
  // Everything below uses rng only after the last decision of the original generator (renovation stays a diff).

  // ---- growth stage 1: the ground floor alone under a provisional roof, with a bed and a washtub in the Stube
  bp.overlay(1, 1, (v) => {
    const skip = leanTo ? (x, z) => x > x2 && z >= leanZ[0] - 1 && z <= leanZ[1] + 1 : undefined;
    const at1 = roof(v, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 1, y: 4, mat: roofMat, kind: steep ? 'stairs' : 'slabs', n: INF, s: INF, trim: { stairs: trimW.stairs, slab: trimW.slab }, skip });
    closeUnder(v, at1, perimeter(x1, z1, x2, z2), 5, timber, roofMat);
    v.fill(sx, 4, iz1, sx, at1(sx, iz1).y + 1, iz1, chim);
    v.set(sx, at1(sx, iz1).y + 2, iz1, 'campfire[lit=true,signal_fire=false]');
    if (at1(cx, z2).y - 5 >= 2) v.set(cx, at1(cx, z2).y - 1, z2 + 1, `red_wall_banner[facing=south]${SWISS_FLAG}`);
    ladderUp(v, cx, iz1, 'south', 1, 4);
    furnish(v, rng, front(0), 'stube', keepOn(0), inner.name, { items: ['bed', 'chest'], bare: true });
    furnish(v, rng, back(0), 'kitchen', [...keepOn(0), [sx, iz1 + 1], [cx, iz1 + 1]], inner.name, { items: ['tub'], bare: true });
  });
  // ---- growth stage 3: the yard grows (fountain, bee house, greenhouse or pergola, flag)
  bp.stage = 3;
  growYard(bp, rng, { house: [x1 - 1, z1, x2 + 1, z2 + 2], wood: trimW, roofMat, door: [cx, z2 + 1], prefer: ['fountain', 'bees', 'greenhouse', 'flag'] });
  bp.stage = 1;
  if (mirror) bp.mirrorX();
  return bp;
}
