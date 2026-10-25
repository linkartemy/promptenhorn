
// ================================================================ old town (Bern / Lucerne / Stein am Rhein)

const SHOPS = [
  ['UHREN', '& SCHMUCK'], ['KAESE', 'FROMAGERIE'], ['SCHOKOLADE', 'CHOCOLATIER'], ['BAECKEREI', 'BOULANGERIE'], ['APOTHEKE', ''],
  ['BUCHHANDLUNG', ''], ['METZGEREI', ''], ['WEINHANDLUNG', ''], ['SPIELWAREN', ''], ['HUTMACHER', ''], ['GOLDSCHMIED', ''],
];

function oldTownPalette(rng, style, plasterList = PLASTERS) {
  const plaster = style === 'fachwerk' ? rng.pick(['calcite', 'calcite', 'white_terracotta', 'mushroom_stem']) : rng.weighted(plasterList);
  let trimKey = style === 'lauben' ? rng.pick(['tuff', 'tuffb', 'sand', 'stone']) : rng.pick(['quartz', 'sand', 'andesite', 'diorite', 'quartz']);
  if (TRIMS[trimKey].block === plaster || (/calcite|mushroom/.test(plaster) && /quartz|diorite/.test(trimKey))) trimKey = rng.pick(['stone', 'andesite', 'tuff']);
  return {
    style,
    plaster,
    trim: TRIMS[trimKey],
    shutter: rng.chance(style === 'lauben' ? 0.45 : 0.85) ? rng.weighted(SHUTTERS) : null,
    roof: ROOFS[rng.weighted([['tile', 4], ['clay', 2], ['granite', 1.5], ['slate', 1.5], ['resin', 0.6]])],
    beam: WOOD(rng.pick(['dark_oak', 'dark_oak', 'spruce'])),
    eave: WOOD(rng.pick(['dark_oak', 'spruce'])),
    box: rng.pick(['spruce_trapdoor', 'dark_oak_trapdoor', 'mangrove_trapdoor']),
    inner: WOOD(rng.pick(['spruce', 'oak', 'birch', 'dark_oak'])),
  };
}

/** Front window columns for an old-town facade: [{x, w, sh}]. Shuttered windows get room for their shutters. */
function windowLayout(x1, x2, shutters) {
  const cx = (x1 + x2) >> 1;
  const W = x2 - x1 + 1;
  if (W >= 13) {
    if (shutters) return [cx - 4, cx, cx + 4].map((x) => ({ x, w: 1, sh: true }));
    return [cx - 4, cx - 2, cx, cx + 2, cx + 4].map((x) => ({ x, w: 1, sh: false }));
  }
  if (!shutters) return [cx - 3, cx, cx + 3].map((x) => ({ x, w: 1, sh: false }));
  return [{ x: cx - 3, w: 1, sh: true }, { x: cx, w: 1, sh: false }, { x: cx + 3, w: 1, sh: true }];
}

/** Small gable dormer on a roof slope descending towards +z; front wall at zf. */
function dormer(bp, at, x, zf, wallB, mat) {
  const c = at(x, zf);
  if (!c) return;
  const yb = c.y;
  bp.set(x - 1, yb, zf, wallB);
  bp.set(x + 1, yb, zf, wallB);
  bp.set(x, yb, zf, 'glass_pane');
  bp.set(x, yb + 1, zf, wallB);
  for (let z = zf - 1; z <= zf + 1; z++) {
    bp.set(x - 1, yb + 1, z, `${mat.stairs}[facing=east,half=bottom]`);
    bp.set(x + 1, yb + 1, z, `${mat.stairs}[facing=west,half=bottom]`);
    bp.set(x, yb + 2, z, `${mat.slab}[type=bottom]`);
  }
}

/**
 * Upper storeys, stair hall, flats and roof of an old-town house. The ground storey (rows 1..g) is drawn by the caller.
 * The stair hall runs along the back wall (two lanes), flights alternate; every upper floor is one flat:
 * kitchen-living along the facade, bedroom with bath behind, hall in front of the stairs; ladder to the attic.
 * Returns { at, wallTop, cx, hall, planes }.
 */
function oldTownBody(bp, rng, o) {
  const { x1, x2, z1, z2, floors, P, gableFront, oriel = false, boxes = true, noLow = false, g = 3 } = o;
  const winX = o.winX ?? windowLayout(x1, x2, !!P.shutter);
  const cx = (x1 + x2) >> 1;
  const ix1 = x1 + 1, ix2 = x2 - 1, iz1 = z1 + 1, iz2 = z2 - 1;
  const yb = (f) => g + 1 + 4 * f;
  const wallTop = g + 4 * floors;
  const planes = [0, ...Array.from({ length: floors }, (_, f) => yb(f))];
  const fach = P.style === 'fachwerk';
  const isCorner = (x, z) => (x === x1 || x === x2) && (z === z1 || z === z2);
  const posts = new Set([x1, x2]);
  for (let i = 1; i < winX.length; i++) posts.add((winX[i - 1].x + winX[i - 1].w + winX[i].x) >> 1);
  const zc = (z1 + z2) >> 1;
  // Growth stages: stage 1 has the first `f1` upper floors (one flat) under a provisional roof, stage 2 all of them.
  const f1 = Math.min(floors, o.stage1Floors ?? 1);
  const st = (f) => (f < f1 ? 1 : 2);
  const stage0 = bp.stage;
  const wallFn = (x, y, z) => {
    const row = (y - g - 1) % 4;
    const f = (y - g - 1) >> 2;
    const ax = z === z1 || z === z2 ? 'x' : 'z';
    if (fach) {
      if (isCorner(x, z)) return `${P.beam.log}[axis=y]`;
      if (row === 0) return `${P.beam.log}[axis=${ax}]`;
      if (ax === 'x' ? posts.has(x) : z === zc) return `${P.beam.log}[axis=y]`;
      return P.plaster;
    }
    if (row === 0 && f === 0) return P.trim.block;
    if (isCorner(x, z)) return P.style === 'lauben' || y % 2 === 0 ? P.trim.block : P.plaster;
    return P.plaster;
  };
  for (let f = 0; f < floors; f++) {
    bp.stage = st(f);
    bp.walls(x1, yb(f), z1, x2, yb(f) + 3, z2, wallFn);
    bp.stage = f <= f1 ? 1 : 2;
    bp.fill(ix1, yb(f), iz1, ix2, yb(f), iz2, P.inner.planks);
  }
  bp.stage = floors <= f1 ? 1 : 2;
  bp.fill(ix1, wallTop + 1, iz1, ix2, wallTop + 1, iz2, 'spruce_planks');
  bp.stage = stage0;

  // Stair hall along the back wall: lane B against the wall, lane A in front of it; ladder to the attic.
  const hall = stairHall(bp, { axis: 'x', laneA: [iz1 + 1], laneB: [iz1], u0: ix2, dir: -1, planes, wood: P.inner.name, stageOf: (i) => st(i) });
  const hallU = Math.min(...hall.cells.map(([x]) => x));
  const zp = iz1 + 3; // wall between hall/bedroom and the front living-kitchen
  const bw = hallU - 1; // bedroom wall
  const ladderX = cx;
  const ladderZ = zp - 1;

  // Windows.
  const oTop = oriel && floors >= 2 ? floors - 2 : -1;
  const lintel = (ax) => (fach ? `${P.beam.log}[axis=${ax}]` : P.trim.block);
  const sill = fach ? P.beam.stairs : undefined;
  const sideZ = [z1 + 2, z2 - 2];
  for (let f = 0; f < floors; f++) {
    const y = yb(f) + 1;
    bp.stage = st(f);
    for (const { x, w, sh } of winX) {
      const inOriel = oTop >= 0 && Math.abs(x - cx) <= 1 && f <= oTop + 1;
      const low = noLow && f === 0;
      win(bp, rng, x, y, z2, 'south', {
        w, h: 2, lintel: lintel('x'), shutters: inOriel || !sh ? null : P.shutter, frame: !fach && !sh && !inOriel && P.style === 'painted' && winX.length <= 3 ? P.trim.block : undefined,
        box: !inOriel && !low && boxes && f <= 1 ? P.box : undefined, sill: inOriel || low ? undefined : sill,
      });
      if (Math.abs(x - cx) >= 2 && Math.abs(x - bw) >= 1 && x + w - 1 !== bw && x + w < hallU - 1) win(bp, rng, x, y, z1, 'north', { w, h: 2, lintel: lintel('x'), shutters: sh ? P.shutter : null, sill });
    }
    for (const z of sideZ) {
      win(bp, rng, x1, y, z, 'west', { h: 2, lintel: lintel('z'), shutters: P.shutter, sill });
      win(bp, rng, x2, y, z, 'east', { h: 2, lintel: lintel('z'), shutters: P.shutter, sill });
    }
  }
  bp.stage = stage0;
  // Oriel (Erker): a glazed bay in front of the centre window.
  if (oTop >= 0) {
    for (let f = 0; f <= oTop; f++)
      for (let x = cx - 1; x <= cx + 1; x++) {
        bp.stage = st(f);
        bp.set(x, yb(f), z2 + 1, fach ? `${P.beam.log}[axis=x]` : P.trim.block);
        bp.set(x, yb(f) + 1, z2 + 1, x === cx ? 'glass_pane' : P.plaster);
        bp.set(x, yb(f) + 2, z2 + 1, x === cx ? 'glass_pane' : P.plaster);
        bp.set(x, yb(f) + 3, z2 + 1, fach ? `${P.beam.log}[axis=x]` : P.trim.block);
      }
    for (let f = 0; f <= oTop; f++) for (const y of [yb(f) + 1, yb(f) + 2]) bp.atStageDraw(st(f), () => bp.set(cx, y, z2, null));
    for (let x = cx - 1; x <= cx + 1; x++) {
      bp.stage = st(0);
      bp.set(x, yb(0) - 1, z2 + 1, x === cx ? `${P.trim.slab}[type=top]` : `${P.trim.stairs}[facing=north,half=top]`);
      bp.stage = st(oTop);
      bp.set(x, yb(oTop + 1), z2 + 1, `${ROOFS.copper.stairs}[facing=north,half=bottom]`);
    }
    bp.stage = stage0;
  }

  // Roof.
  bp.stage = floors <= f1 ? 1 : 2;
  const trim = { stairs: P.eave.stairs, slab: P.eave.slab };
  let at;
  if (!gableFront) {
    at = roof(bp, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 1, y: wallTop, mat: P.roof, w: INF, e: INF, trim, brackets: P.eave.stairs });
    closeUnder(bp, at, perimeter(x1, z1, x2, z2), wallTop + 1, fach ? (x, y, z) => (z === zc ? `${P.beam.log}[axis=y]` : P.plaster) : P.plaster, P.roof);
    const gz = zc === zp + 1 ? zc + 1 : zc;
    for (const x of [x1, x2]) if (at(x, gz).y - wallTop >= 4) win(bp, rng, x, wallTop + 2, gz, x === x1 ? 'west' : 'east', { h: 2, shutters: P.shutter });
    const dx = x2 - x1 >= 10 ? [cx - 3, cx + 3] : [cx];
    for (const x of dx) dormer(bp, at, x, z2 - 1, P.plaster, P.roof);
  } else {
    at = roof(bp, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 1, y: wallTop, mat: P.roof, n: INF, s: INF, trim, brackets: P.eave.stairs });
    closeUnder(bp, at, perimeter(x1, z1, x2, z2), wallTop + 1,
      fach ? (x, y, z) => (x === cx ? `${P.beam.log}[axis=y]` : y === wallTop + 3 ? `${P.beam.log}[axis=x]` : P.plaster) : P.plaster, P.roof);
    for (const z of [z1, z2]) {
      const face = z === z2 ? 'south' : 'north';
      for (const x of [cx - 2, cx + 2]) if (at(x, z).y - wallTop >= 4) win(bp, rng, x, wallTop + 2, z, face, { h: 2, shutters: P.shutter, lintel: lintel('x') });
      if (at(cx, z).y - wallTop >= 6) win(bp, rng, cx, wallTop + 4, z, face, { h: 1, lintel: lintel('x') });
    }
  }
  // Flats: kitchen stoves stacked under one chimney at the west wall.
  const stoveZ = zp + 1;
  for (let f = 0; f < floors; f++) {
    const F = yb(f);
    const y = F + 1;
    bp.stage = st(f);
    partition(bp, ix1, zp, ix2, zp, y, 3, P.inner.planks, [[ix1 + 2, zp, true], [ix2 - 1, zp, true]], P.inner.door);
    partition(bp, bw, iz1, bw, zp - 1, y, 3, P.inner.planks, [[bw, zp - 1]], P.inner.door);
    bp.set(ix1, y, stoveZ, 'smoker[facing=east,lit=true]');
    bp.set(ix1, y + 1, stoveZ, 'bricks');
    bp.set(ix1, y + 2, stoveZ, 'bricks');
    const keep = [...hall.cells, ...(hall.ends[F] ?? []), [ladderX, ladderZ], [ix1 + 2, zp - 1], [ix1 + 2, zp + 1], [ix2 - 1, zp - 1], [ix2 - 1, zp + 1], [bw - 1, zp - 1], [bw + 1, zp - 1], [ix1 + 1, stoveZ], [cx, iz2]];
    furnish(bp, rng, { x1: ix1, z1: zp + 1, x2: ix2, z2: iz2, y, h: 3 }, 'kitchen', keep, P.inner.name, { items: ['sink', 'counter', 'counter', 'crafting', 'sofa', 'bookshelf', 'plant', 'chest'], table: true });
    furnish(bp, rng, { x1: ix1, z1: iz1, x2: bw - 1, z2: zp - 1, y, h: 3 }, 'bedroom', keep, P.inner.name, { items: ['bed', 'tub', 'chest', 'toilet', 'wardrobe', 'plant'] });
    light(bp, { x1: bw + 1, z1: zp - 1, x2: ix2 - 1, z2: zp - 1, y, h: 3 });
  }
  bp.stage = floors <= f1 ? 1 : 2;
  ladderUp(bp, ladderX, ladderZ, 'north', planes[planes.length - 1] + 1, wallTop + 1);
  bp.fill(ix1, wallTop + 2, stoveZ, ix1, Math.max(wallTop + 2, at(ix1, stoveZ).y + 1), stoveZ, 'bricks');
  for (let f = 0; f < floors; f++) bp.atStageDraw(f === 0 ? 1 : bp.stage, () => bp.set(ix1, yb(f), stoveZ, 'bricks'));
  bp.set(ix1, wallTop + 1, stoveZ, 'bricks');
  bp.set(ix1, at(ix1, stoveZ).y + 2, stoveZ, rng.chance(0.6) ? 'campfire[lit=true,signal_fire=false]' : 'brick_slab[type=bottom]');
  // Attic storage.
  furnish(bp, rng, { x1: ix1 + 2, z1: iz1 + 1, x2: ix2 - 1, z2: iz2 - 1, y: wallTop + 2, h: 2 }, 'storage', [[ladderX, ladderZ], [ladderX - 1, ladderZ]], 'spruce', { items: ['barrel', 'chest', 'barrel'] });
  // Flag on the corner under the eaves.
  const [base, data] = rng.chance(0.5) ? ['red', SWISS_FLAG] : rng.pick(CANTONS);
  if (!bp.get(x1, wallTop - 1, z2 + 1) && !bp.get(x1, wallTop - 2, z2 + 1)) bp.set(x1, wallTop - 1, z2 + 1, `${base}_wall_banner[facing=south]${data}`);
  bp.stage = stage0;
  // Stage 1: the same roof (eaves or gable to the street) over the first floors; called by the generator at the end.
  const stage1Roof = () => {
    if (floors <= f1) return;
    const top1 = g + 4 * f1;
    bp.overlay(1, 1, (v) => {
      const at1 = roof(v, { x1: x1 - 1, x2: x2 + 1, z1: z1 - 1, z2: z2 + 1, y: top1, mat: P.roof, ...(gableFront ? { n: INF, s: INF } : { w: INF, e: INF }), trim, brackets: P.eave.stairs });
      closeUnder(v, at1, perimeter(x1, z1, x2, z2), top1 + 1, P.plaster, P.roof);
      v.fill(ix1, top1 + 1, stoveZ, ix1, at1(ix1, stoveZ).y + 1, stoveZ, 'bricks');
      v.set(ix1, at1(ix1, stoveZ).y + 2, stoveZ, 'campfire[lit=true,signal_fire=false]');
      ladderUp(v, ladderX, ladderZ, 'north', planes[f1] + 1, top1 + 1);
      if (!v.get(x1, top1 - 1, z2 + 1) && !v.get(x1, top1 - 2, z2 + 1)) v.set(x1, top1 - 1, z2 + 1, `${base}_wall_banner[facing=south]${data}`);
    });
  };
  return { at, wallTop, cx, hall, planes, ix1, ix2, iz1, iz2, stage1Roof, f1, zp, stoveZ };
}

// ---------------------------------------------------------------- townhouse

export function townhouse(rng, options = {}) {
  const bp = new Blueprint();
  const style = rng.weighted([['lauben', 4], ['painted', 4], ['fachwerk', 2]]);
  const P = oldTownPalette(rng, style);
  const x1 = 2;
  const x2 = 14;
  const cx = 8;
  const z1 = rng.pick([2, 3]);
  const z2 = 12;
  const ix1 = x1 + 1, ix2 = x2 - 1, iz1 = z1 + 1;
  const floors = rng.pick([2, 3, 3]);
  const gableFront = style !== 'lauben' && rng.chance(0.45);
  const isCorner = (x, z) => (x === x1 || x === x2) && (z === z1 || z === z2);
  const [shopA, shopB] = rng.pick(SHOPS);
  const wood = P.inner.name;

  bp.fill(x1, 0, z1, x2, 0, z2, 'polished_andesite');
  bp.fill(ix1, 0, iz1, ix2, 0, z2 - 1, `${wood}_planks`);
  let shopZ = z2;
  if (style === 'lauben') {
    // Arcade (Lauben): sandstone arches in front, shop front set back three blocks.
    shopZ = z2 - 3;
    bp.walls(x1, 1, z1, x2, 3, shopZ, P.trim.block);
    for (let z = shopZ + 1; z <= z2; z++) {
      bp.set(x1, 3, z, P.trim.block);
      bp.set(x2, 3, z, P.trim.block);
      for (let x = x1; x <= x2; x++) bp.set(x, 0, z, (x + z) % 2 ? 'polished_andesite' : 'stone_bricks');
    }
    bp.fill(x1, 1, z2, x1, 2, z2, P.trim.block);
    bp.fill(x2, 1, z2, x2, 2, z2, P.trim.block);
    bp.set(x1, 2, z2 - 1, `${P.trim.stairs}[facing=north,half=top]`);
    bp.set(x2, 2, z2 - 1, `${P.trim.stairs}[facing=north,half=top]`);
    bp.set(x1, 2, shopZ + 1, `${P.trim.stairs}[facing=south,half=top]`);
    bp.set(x2, 2, shopZ + 1, `${P.trim.stairs}[facing=south,half=top]`);
    bp.fill(x1, 3, z2, x2, 3, z2, P.trim.block);
    for (const p of [x1, cx - 2, cx + 2, x2]) {
      bp.fill(p, 1, z2, p, 2, z2, P.trim.block);
      if (p > x1) bp.set(p - 1, 2, z2, `${P.trim.stairs}[facing=east,half=top]`);
      if (p < x2) bp.set(p + 1, 2, z2, `${P.trim.stairs}[facing=west,half=top]`);
    }
    for (const x of [(x1 + cx - 2) >> 1, cx, (cx + 2 + x2) >> 1]) bp.set(x, 3, z2 - 1, 'lantern[hanging=true]');
    const [bb, bd] = rng.pick(CANTONS);
    bp.set(cx - 2, 2, z2 + 1, `${bb}_wall_banner[facing=south]${bd}`);
    // Shop front: framed display windows either side of the door.
    for (let x = ix1; x <= ix2; x++) bp.fill(x, 1, shopZ, x, 2, shopZ, Math.abs(x - cx) === 1 || x === cx - 4 || x === cx + 4 ? P.trim.block : 'glass_pane');
    bp.door(cx, 1, shopZ, wood, 'south');
    bp.set(cx + 2, 3, shopZ + 1, `${wood}_wall_sign[facing=south]${signData(['', shopA, shopB, ''])}`);
  } else {
    bp.walls(x1, 1, z1, x2, 3, z2, (x, y, z) => (isCorner(x, z) || y === 1 ? P.trim.block : style === 'fachwerk' && y === 3 ? `${P.beam.log}[axis=${z === z1 || z === z2 ? 'x' : 'z'}]` : P.plaster));
    const w = cx - 2 - (x1 + 1) + 1;
    win(bp, rng, x1 + 1, 2, z2, 'south', { w, h: 2 });
    win(bp, rng, cx + 2, 2, z2, 'south', { w, h: 2 });
    doorway(bp, cx, 1, z2, 'south', wood, { frame: P.trim.block, transom: 'glass_pane' });
    bp.set(cx, 0, z2 + 1, `${P.trim.slab}[type=top]`);
    bp.set(x2, 3, z2 + 1, `${wood}_wall_hanging_sign[facing=east]${signData([shopA, shopB, '', ''])}`);
    for (const x of [x1 + 1, x2 - 1]) bp.set(x, 1, z2 + 1, rng.pick(['barrel[facing=up]', 'decorated_pot[facing=south]', 'potted_azalea_bush']));
    win(bp, rng, x1, 2, z2 - 2, 'west', { h: 2, shutters: P.shutter });
    win(bp, rng, x2, 2, z2 - 2, 'east', { h: 2, shutters: P.shutter });
  }
  win(bp, rng, cx - 4, 2, z1, 'north', { h: 2, shutters: P.shutter });

  const body = oldTownBody(bp, rng, { x1, x2, z1, z2, floors, P, gableFront, oriel: floors >= 2 && rng.chance(0.55) });
  // Shop: counter, shelves, goods; keep the way to the stairs free.
  const keep = [...body.hall.cells, ...(body.hall.ends[0] ?? []), [cx, shopZ - 1], [ix2, iz1 + 2]];
  furnish(bp, rng, { x1: ix1, z1: iz1, x2: ix2, z2: shopZ - 1, y: 1, h: 3 }, 'shop', keep, wood);

  // Street in front: paving, planters, lamp.
  bp.fill(0, 0, z2 + 1, 16, 0, 16, paving(rng));
  if (style !== 'lauben') bp.set(cx, 0, z2 + 1, `${P.trim.slab}[type=top]`);
  planter(bp, 1, 15, wood);
  planter(bp, 15, 15, wood);
  if (rng.chance(0.6)) lamp(bp, rng.pick([4, 12]), 15, 3, 'simple');
  sprinkleFlowers(bp, rng, 0, 0, 16, z1 - 2, 0.1);
  const mirror = rng.chance(0.5);
  // Growth: stage 1 = shop and one flat under a provisional roof; stage 3 = the shop does well (awning,
  // goods and a bench on the street, a second flag) and the back yard gets beds and a bench.
  body.stage1Roof();
  terrainVariant(bp, rng, options.terrain, { x1, z1, x2, z2, wood: P.inner, mirror, modes: ['walkout'] });
  bp.stage = 3;
  if (style !== 'lauben') {
    const [ca, cb] = rng.pick([['red', 'white'], ['green', 'white'], ['blue', 'white'], ['brown', 'yellow'], ['orange', 'white']]);
    for (let x = x1; x <= x2; x++) {
      if (Math.abs(x - cx) <= 1 || bp.everSet(x, 3, z2 + 1)) continue;
      bp.set(x, 3, z2 + 1, `${wood}_trapdoor[facing=south,half=top]`);
      if (!bp.everSet(x, 4, z2 + 1)) bp.set(x, 4, z2 + 1, `${x % 2 ? ca : cb}_carpet`);
    }
  }
  for (const [x, z, back] of [[cx + 3, 15, 'south'], [cx - 4, 15, 'south']]) {
    if ([x - 1, x, x + 1, x + 2].every((xx) => !bp.everSet(xx, 1, z) && !bp.everSet(xx, 2, z) && !bp.everSet(xx, 3, z))) { bench(bp, x, z, back, 2, wood); break; }
  }
  for (const x of [x1 + 1, x2 - 1]) if (!bp.everSet(x, 1, z2 + 2) && !bp.everSet(x, 2, z2 + 2)) bp.set(x, 1, z2 + 2, rng.pick(['barrel[facing=up]', 'decorated_pot[facing=south]', 'potted_azalea_bush', 'composter[level=8]']));
  {
    const [b2, d2] = rng.pick(CANTONS);
    const y = body.wallTop - 1;
    if (!bp.everSet(x2, y, z2 + 1) && !bp.everSet(x2, y - 1, z2 + 1)) bp.set(x2, y, z2 + 1, `${b2}_wall_banner[facing=south]${d2}`);
  }
  growYard(bp, rng, { house: [x1, z1, x2, z2], wood: P.inner, roofMat: P.roof, prefer: ['beds', 'bench', 'woodpile'], max: 2 });
  bp.stage = 1;
  decorate(bp, rng);
  if (mirror) bp.mirrorX();
  return bp;
}

// ---------------------------------------------------------------- café / Konditorei

export function cafe(rng, options = {}) {
  const bp = new Blueprint();
  const style = rng.weighted([['painted', 5], ['fachwerk', 1.5]]);
  const P = oldTownPalette(rng, style, [['pink_terracotta', 3], ['white_terracotta', 3], ['calcite', 2], ['smooth_sandstone', 2], ['lime_terracotta', 1], ['light_blue_terracotta', 0.4], ['yellow_terracotta', 1.2]]);
  const W = 13;
  const x1 = (INNER - W) >> 1;
  const x2 = x1 + W - 1;
  const cx = 8;
  const z1 = 1;
  const z2 = 10;
  const ix1 = x1 + 1, ix2 = x2 - 1, iz1 = z1 + 1, iz2 = z2 - 1;
  const floors = rng.pick([1, 2, 2]);
  const wood = rng.pick(['spruce', 'dark_oak', 'cherry']);
  P.inner = WOOD(wood);
  const [colA, colB] = rng.pick([['red', 'white'], ['green', 'white'], ['pink', 'white'], ['blue', 'white'], ['yellow', 'white'], ['brown', 'yellow']]);
  const name = rng.pick(['CAFE', 'KONDITOREI', 'CONFISERIE', 'TEA ROOM']);
  const owner = rng.pick(['Spruengli', 'Bachmann', 'Huber', 'Steiner', 'Meier', 'Brunner', 'Keller', 'Frey']);
  const isCorner = (x, z) => (x === x1 || x === x2) && (z === z1 || z === z2);

  // Tall shop storey (4 rows) with big display windows.
  bp.fill(x1, 0, z1, x2, 0, z2, 'polished_andesite');
  bp.fill(ix1, 0, iz1, ix2, 0, iz2, (x, y, z) => ((x + z) % 2 ? 'white_concrete' : 'black_concrete'));
  bp.walls(x1, 1, z1, x2, 4, z2, (x, y, z) => (isCorner(x, z) || y === 1 ? P.trim.block : P.plaster));
  const w = cx - 2 - (x1 + 1) + 1;
  win(bp, rng, x1 + 1, 2, z2, 'south', { w, h: 2, lintel: P.trim.block });
  win(bp, rng, cx + 2, 2, z2, 'south', { w, h: 2, lintel: P.trim.block });
  doorway(bp, cx, 1, z2, 'south', wood, { frame: P.trim.block, transom: 'glass_pane' });
  bp.set(cx, 0, z2 + 1, `${P.trim.slab}[type=top]`);
  win(bp, rng, x1, 2, iz2 - 1, 'west', { h: 2, w: 2 });
  win(bp, rng, x2, 2, iz2 - 1, 'east', { h: 2, w: 2 });
  // Striped awnings over both windows; shop sign above the door.
  for (let x = x1; x <= x2; x++) {
    if (Math.abs(x - cx) <= 1) continue;
    const c = x % 2 ? colA : colB;
    bp.set(x, 4, z2 + 1, `${wood}_trapdoor[facing=south,half=top]`);
    bp.set(x, 5, z2 + 1, `${c}_carpet`);
    bp.set(x, 3, z2 + 2, `${wood}_trapdoor[facing=south,half=top]`);
    bp.set(x, 4, z2 + 2, `${c}_carpet`);
  }
  bp.set(cx, 4, z2 + 1, `${wood}_wall_sign[facing=south]${signData(['', name, owner, ''], 'brown')}`);
  wallLamp(bp, cx - 1, 4, z2, 'south', `${wood}_fence`);
  wallLamp(bp, cx + 1, 4, z2, 'south', `${wood}_fence`);

  const body = oldTownBody(bp, rng, { x1, x2, z1, z2, floors, P, gableFront: rng.chance(0.5), noLow: true, g: 4 });
  if (!bp.get(x1, 7, z2 + 1) && !bp.get(x1, 6, z2 + 1)) bp.set(x1, 7, z2 + 1, `${wood}_wall_hanging_sign[facing=west]${signData(['', name, '', ''])}`);
  // Café hall: cakes in the window, counter with cakes in front of the stairs, tables with chairs.
  const hallZ = Math.max(...body.hall.cells.map(([, z]) => z));
  const hallX1 = Math.min(...body.hall.cells.map(([x]) => x));
  for (let x = ix1; x <= ix2; x++) {
    if (Math.abs(x - cx) <= 1) continue;
    bp.set(x, 1, iz2, 'smooth_quartz_slab[type=top]');
    bp.set(x, 2, iz2, rng.chance(0.6) ? 'cake' : rng.pick(['candle[candles=3,lit=true]', 'potted_red_tulip', 'decorated_pot[facing=south]']));
  }
  for (let x = ix1; x < hallX1 - 1; x++) {
    bp.set(x, 1, iz1, x === ix1 ? 'smoker[facing=south,lit=true]' : 'smooth_quartz_slab[type=top]');
    if (x > ix1) bp.set(x, 2, iz1, rng.chance(0.6) ? 'cake' : 'candle[candles=2,lit=true]');
    bp.set(x, 1, iz1 + 1, x === ix1 + 1 ? 'water_cauldron[level=3]' : `${wood}_shelf[facing=south]`);
  }
  const tables = [];
  for (let x = ix1 + 1; x <= ix2 - 1; x += 4) tables.push([x, hallZ + 3]);
  for (const [tx, tz] of tables) {
    if (tz >= iz2 - 1 || bp.get(tx, 1, tz)) continue;
    bp.set(tx, 1, tz, `${wood}_fence`);
    bp.set(tx, 2, tz, 'white_carpet');
    for (const f of ['east', 'west']) bp.setIfEmpty(tx + DIR[f][0], 1, tz, `${wood}_stairs[facing=${f},half=bottom]`);
  }
  for (let x = ix1 + 2; x <= ix2 - 2; x += 4) light(bp, { x1: x, z1: hallZ + 4, x2: x, z2: hallZ + 4, y: 1, h: 4 });

  // Terrace with parasols.
  bp.fill(0, 0, z2 + 1, 16, 0, 16, (x, y, z) => ((x + z) % 3 === 0 ? 'polished_andesite' : 'stone_bricks'));
  bp.set(cx, 0, z2 + 1, `${P.trim.slab}[type=top]`);
  const terrace = [[2, 14], [14, 14], ...(W === 11 ? [[8, 15]] : [])];
  for (const [tx, tz] of terrace) {
    bp.fill(tx, 1, tz, tx, 3, tz, `${wood}_fence`);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const c = (dx + dz + 2) % 2 ? colA : colB;
        if (dx || dz) bp.set(tx + dx, 4, tz + dz, `${wood}_trapdoor[facing=south,half=top]`);
        else bp.set(tx, 4, tz, `${c}_wool`);
        bp.set(tx + dx, 5, tz + dz, `${c}_carpet`);
      }
    for (const f of ['east', 'west']) if (inPlot(tx + DIR[f][0], tz)) bp.setIfEmpty(tx + DIR[f][0], 1, tz, `${wood}_stairs[facing=${f},half=bottom]`);
  }
  bp.set(cx + 3, 1, z2 + 4, `${wood}_sign[rotation=0]${signData(['Kaffee', 'Kuchen', 'Torten', 'Glace'], 'brown')}`);
  for (const x of [1, 15]) for (let z = z2 + 3; z <= 15; z += 4) if (!bp.get(x, 1, z) && !bp.get(x, 4, z)) planter(bp, x, z, wood, rng.pick(['flowering_azalea', 'azalea']));
  sprinkleFlowers(bp, rng, 0, 0, 16, z1 - 2, 0.12);
  const mirror = rng.chance(0.5);
  // Growth: stage 1 = the café and one flat under a provisional roof; stage 3 = two more parasol tables on the
  // terrace and a Glace cart, the back yard gets a bench and a herb bed.
  body.stage1Roof();
  bp.stage = 3;
  for (const [tx, tz] of [[5, 15], [11, 15]]) {
    const cells = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) cells.push([tx + dx, tz + dz]);
    if (cells.some(([x, z]) => !inPlot(x, z) || [1, 2, 3, 4, 5].some((y) => bp.everSet(x, y, z)))) continue;
    bp.fill(tx, 1, tz, tx, 3, tz, `${wood}_fence`);
    for (const [x, z] of cells) {
      const c = (x + z) % 2 ? colA : colB;
      bp.set(x, 4, z, x === tx && z === tz ? `${c}_wool` : `${wood}_trapdoor[facing=south,half=top]`);
      bp.set(x, 5, z, `${c}_carpet`);
    }
    bp.set(tx - 1, 1, tz, `${wood}_stairs[facing=west,half=bottom]`);
    bp.set(tx + 1, 1, tz, `${wood}_stairs[facing=east,half=bottom]`);
    bp.mark('food_spot', tx, 2, tz, { data: { item: rng.pick(['cake', 'cookie', 'pumpkin_pie', 'sweet_berries']) } });
  }
  growYard(bp, rng, { house: [x1, z1, x2, z2], wood: P.inner, roofMat: P.roof, prefer: ['bench', 'beds', 'flag'], max: 2 });
  bp.stage = 1;
  decorate(bp, rng);
  if (mirror) bp.mirrorX();
  return bp;
}
