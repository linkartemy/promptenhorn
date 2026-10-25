
// ================================================================ interiors: stairs, ladders, partitions, furniture

const isWalkable = (b) => !b || /carpet|pressure_plate/.test(b);

/**
 * Switch-back staircase in a two-lane shaft (works for any storey heights).
 * axis: 'z' (flights run along z) or 'x'. laneA / laneB: lists of cross coordinates (1 or 2 wide each).
 * u0: approach cell of the first flight along the axis, dir: +1 / -1 ascent direction of the first flight.
 * planes: floor block levels [F0, F1, ...]; flight i climbs from planes[i] to planes[i+1] in lane A (even) or B (odd).
 * Returns { cells: footprint [[x, z]] reserved on every floor, ends: approach/exit cells per plane }.
 */
function stairHall(bp, { axis, laneA, laneB, u0, dir, planes, wood = 'spruce', under = `${wood}_planks`, stageOf }) {
  // stageOf(i): growth stage of flight i (the flight that arrives at planes[i + 1]); default: the current stage.
  const stage0 = bp.stage;
  const xz = (u, v) => (axis === 'z' ? [v, u] : [u, v]);
  const facingOf = (d) => (axis === 'z' ? (d < 0 ? 'north' : 'south') : d < 0 ? 'west' : 'east');
  const us = new Set();
  const ends = {};
  let a = u0;
  let d = dir;
  for (let i = 0; i + 1 < planes.length; i++) {
    if (stageOf) bp.stage = stageOf(i);
    const F0 = planes[i];
    const R = planes[i + 1] - F0;
    const lane = i % 2 ? laneB : laneA;
    us.add(a);
    // A climbing player needs three clear blocks above every step it leaves (the hitbox rises mid-step),
    // so the floor above is opened over the approach and all but the last step.
    for (let k = -1; k < R; k++) {
      const u = a + d * (1 + k);
      us.add(u);
      for (const v of lane) {
        const [x, z] = xz(u, v);
        if (k >= 0) bp.set(x, F0 + 1 + k, z, `${wood}_stairs[facing=${facingOf(d)},half=bottom]`);
        if (under && k > 0 && !nextToPane(bp, x, F0 + k, z, 1, 'stone')) bp.set(x, F0 + k, z, under);
        const feet = F0 + 2 + k;
        for (let yy = feet; yy <= feet + (k < R - 1 ? 2 : 1); yy++) bp.set(x, yy, z, null);
      }
    }
    const e = a + d * (R + 1);
    us.add(e);
    (ends[F0] ??= []).push(...lane.map((v) => xz(a, v)));
    (ends[planes[i + 1]] ??= []).push(...lane.map((v) => xz(e, v)));
    a = e;
    d = -d;
  }
  // The far end of the next flight's lane is a dead pocket on each landing (cut off by holes and steps):
  // fill it as a pillar that carries the next landing.
  {
    let a2 = u0;
    let d2 = dir;
    for (let i = 0; i + 1 < planes.length; i++) {
      if (stageOf) bp.stage = stageOf(i);
      const R = planes[i + 1] - planes[i];
      const e = a2 + d2 * (R + 1);
      if (i >= 1) {
        const lane = i % 2 ? laneB : laneA;
        const ePrevNext = a2 + d2 * (R + 1);
        for (const v of lane) {
          const [x, z] = xz(ePrevNext, v);
          for (let y = planes[i] + 1; y < planes[i + 1]; y++) if (!nextToPane(bp, x, y, z, 1, 'stone')) bp.set(x, y, z, under ?? `${wood}_planks`);
        }
      }
      a2 = e;
      d2 = -d2;
    }
  }
  bp.stage = stage0;
  const cells = [];
  for (const u of us) for (const v of [...laneA, ...laneB]) cells.push(xz(u, v));
  return { cells, ends };
}

/** Ladder against a wall: ladder cells from y0 up to y1 (inclusive) at (x, z), facing away from the wall. */
function ladderUp(bp, x, z, facing, y0, y1) {
  for (let y = y0; y <= y1; y++) bp.set(x, y, z, `ladder[facing=${facing}]`);
  bp.set(x, y1 + 1, z, null);
  bp.set(x, y1 + 2, z, null);
}

/** Interior wall from (x1, z1) to (x2, z2) (one of them equal), rows y0..y0+h-1, with doors. */
function partition(bp, x1, z1, x2, z2, y0, h, block, doors = [], wood = 'spruce') {
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++)
    for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++)
      for (let y = y0; y < y0 + h; y++) bp.set(x, y, z, typeof block === 'function' ? block(x, y, z) : block);
  for (const [dx, dz, open] of doors) {
    for (let y = y0; y < y0 + Math.min(h, 2); y++) bp.set(dx, y, dz, null);
    if (open) continue;
    const facing = z1 === z2 ? 'south' : 'east';
    bp.door(dx, y0, dz, wood, facing, 'left');
  }
}

/** True if placing a sturdy item at (x, y..y+hh-1, z) would bend a neighbouring glass pane. */
function nextToPane(bp, x, y, z, hh, block) {
  for (let i = 0; i < hh; i++)
    for (const [f, [dx, dz]] of Object.entries(DIR)) {
      const nb = bp.get(x + dx, y + i, z + dz);
      if (nb && isPaneLike(blockName(nb)) && sturdyToward(typeof block === 'function' ? block(OPP[f], i) : block, f)) return true;
    }
  return false;
}

const KACHELOFEN = ['green_terracotta', 'cyan_terracotta', 'white_terracotta', 'lime_terracotta', 'light_blue_terracotta'];

/**
 * Furnishes a room r = {x1, z1, x2, z2, y (feet level), h (clear height)} without blocking it:
 * items stand along the walls, never on `keep` cells, never next to window panes, and every free floor cell
 * must stay reachable from the room's entries (keep cells inside the room). Returns placed light count.
 */
function furnish(bp, rng, r, kind, keep = [], wood = 'spruce', o = {}) {
  const { x1, z1, x2, z2, y } = r;
  const h = r.h ?? 3;
  if (x2 < x1 || z2 < z1) return 0;
  const inRoom = (x, z) => x >= x1 && x <= x2 && z >= z1 && z <= z2;
  const keepSet = new Set(keep.map(([x, z]) => `${x},${z}`));
  const walk = (x, z) => isWalkable(bp.get(x, y, z)) && isWalkable(bp.get(x, y + 1, z));
  const entries = keep.filter(([x, z]) => inRoom(x, z));
  // Door cells in the room's walls are entries too.
  for (let x = x1 - 1; x <= x2 + 1; x++)
    for (let z = z1 - 1; z <= z2 + 1; z++) {
      if (inRoom(x, z)) continue;
      const b = bp.get(x, y, z);
      if (b && /_door\b|fence_gate/.test(b)) for (const [dx, dz] of Object.values(DIR)) if (inRoom(x + dx, z + dz)) entries.push([x + dx, z + dz]);
      if (!b && walk(x, z) && bp.get(x, y - 1, z)) for (const [dx, dz] of Object.values(DIR)) if (inRoom(x + dx, z + dz)) entries.push([x + dx, z + dz]);
    }
  // Only entries that are walkable to begin with (a ladder or stove on a keep cell is not a way in).
  for (let i = entries.length - 1; i >= 0; i--) if (!walk(...entries[i])) entries.splice(i, 1);
  const connected = () => {
    const free = [];
    for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) if (walk(x, z)) free.push(`${x},${z}`);
    if (!free.length) return true;
    const fs = new Set(free);
    const roots = [...new Set(entries.map(([x, z]) => `${x},${z}`))].filter((k) => fs.has(k));
    if (entries.length && roots.length < new Set(entries.map(([x, z]) => `${x},${z}`)).size) return false;
    const seen = new Set([roots.length ? roots[0] : free[0]]);
    const q = [...seen];
    while (q.length) {
      const [x, z] = q.pop().split(',').map(Number);
      for (const [dx, dz] of Object.values(DIR)) {
        const k = `${x + dx},${z + dz}`;
        if (fs.has(k) && !seen.has(k)) { seen.add(k); q.push(k); }
      }
    }
    return seen.size === fs.size;
  };
  const tryPlace = (cells) => {
    // cells: [[x, y, z, block]]
    for (const [x, yy, z, b] of cells) {
      if (!inRoom(x, z) || keepSet.has(`${x},${z}`) || bp.get(x, yy, z)) return false;
      if (bp.get(x, y - 1, z) == null) return false;
      if (nextToPane(bp, x, yy, z, 1, b)) return false;
    }
    const had = cells.map(([x, yy, z]) => bp.everSet(x, yy, z));
    for (const [x, yy, z, b] of cells) bp.set(x, yy, z, b);
    if (connected()) return true;
    cells.forEach(([x, yy, z], i) => {
      bp.set(x, yy, z, null);
      if (!had[i]) bp.ever.delete(`${x},${yy},${z}`); // a tried and withdrawn piece leaves no trace for everSet()
    });
    return false;
  };
  const slots = [];
  for (let x = x1; x <= x2; x++) slots.push([x, z1, 'south'], [x, z2, 'north']);
  for (let z = z1 + 1; z < z2; z++) slots.push([x1, z, 'east'], [x2, z, 'west']);
  const shuffled = slots.map((s) => [rng.next(), s]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
  const place = (fn) => shuffled.some(([x, z, f]) => fn(x, z, f));
  const one = (block, hh = 1) => (x, z, f) => tryPlace([...Array(hh)].map((_, i) => [x, y + i, z, typeof block === 'function' ? block(f, i) : block]));
  const bed = (color, bunk = false) => (x, z, f) => {
    const fx = x + DIR[f][0];
    const fz = z + DIR[f][1];
    const cells = [[x, y, z, `${color}_bed[facing=${OPP[f]},part=head]`], [fx, y, fz, `${color}_bed[facing=${OPP[f]},part=foot]`]];
    if (bunk) cells.push([x, y + 2, z, `${color}_bed[facing=${OPP[f]},part=head]`], [fx, y + 2, fz, `${color}_bed[facing=${OPP[f]},part=foot]`], [x, y + 1, z, `${wood}_fence`]);
    if (!tryPlace(cells)) return false;
    o.marks?.push(['bed', x, y, z]);
    return true;
  };
  const sofa = (x, z, f) => {
    const [ax, az] = along(f);
    return tryPlace([[x, y, z, `quartz_stairs[facing=${OPP[f]},half=bottom]`], [x + ax, y, z + az, `quartz_stairs[facing=${OPP[f]},half=bottom]`]]);
  };
  const toilet = (x, z, f) => tryPlace([[x, y, z, 'smooth_quartz'], [x, y + 1, z, 'birch_trapdoor[facing=south,half=bottom]']]);
  const tub = (x, z, f) => {
    const [ax, az] = along(f);
    return tryPlace([[x, y, z, 'water_cauldron[level=3]'], [x + ax, y, z + az, 'water_cauldron[level=3]']]);
  };
  const items = {
    bed: bed(rng.pick(['red', 'red', 'white', 'light_gray', 'green', 'blue'])),
    bed2: bed(rng.pick(['red', 'white', 'yellow', 'cyan'])),
    bunk: bed(rng.pick(['red', 'blue', 'green', 'brown']), true),
    bunk2: bed(rng.pick(['red', 'blue', 'green', 'brown']), true),
    bookshelf: one('bookshelf', Math.min(2, h - 1)),
    chiseled: one((f) => `chiseled_bookshelf[facing=${f},slot_0_occupied=true,slot_1_occupied=true,slot_3_occupied=true,slot_4_occupied=true]`),
    chest: one((f) => `chest[facing=${f}]`),
    barrel: one('barrel[facing=up]'),
    counter: one((f) => `barrel[facing=${f}]`),
    furnace: one((f) => `furnace[facing=${f},lit=false]`),
    smoker: one((f) => `smoker[facing=${f},lit=true]`),
    sink: one('water_cauldron[level=3]'),
    crafting: one('crafting_table'),
    stove: one(rng.pick(KACHELOFEN), 2),
    plant: one(() => rng.pick(HOUSE_PLANTS)),
    armchair: one((f) => `${wood}_stairs[facing=${OPP[f]},half=bottom]`),
    lectern: one((f) => `lectern[facing=${f}]`),
    loom: one((f) => `loom[facing=${f}]`),
    pot: one((f) => `decorated_pot[facing=${f}]`),
    clock: one((f, i) => (i === 0 ? `${wood}_planks` : `${wood}_trapdoor[facing=${OPP[f]},open=true,half=bottom]`), 2),
    wardrobe: one((f, i) => `${wood}_planks`, 2),
    shelf: (x, z, f) => tryPlace([[x, y + 1, z, `${wood}_shelf[facing=${f}]`]]) && true,
    sofa,
    toilet,
    tub,
    hay: one('hay_block[axis=y]'),
    composter: one('composter[level=4]'),
  };
  const lists = {
    stube: ['stove', 'armchair', 'clock', 'bookshelf', 'plant', 'chest'],
    kitchen: ['sink', 'counter', 'crafting', 'counter', 'chest', 'barrel'],
    bedroom: ['bed', 'chest', 'wardrobe', 'plant', 'barrel'],
    twin: ['bed', 'bed2', 'chest', 'wardrobe', 'plant'],
    bath: ['tub', 'toilet', 'sink', 'chest'],
    living: ['sofa', 'bookshelf', 'plant', 'armchair', 'chest', 'plant'],
    shop: ['counter', 'barrel', 'chest', 'chiseled', 'pot', 'barrel', 'counter'],
    office: ['lectern', 'bookshelf', 'chiseled', 'chest', 'plant'],
    lobby: ['plant', 'armchair', 'plant', 'sofa', 'chiseled', 'plant'],
    dorm: ['bunk', 'bunk2', 'chest', 'chest', 'barrel'],
    common: ['stove', 'chest', 'barrel', 'chiseled', 'clock'],
    storage: ['barrel', 'barrel', 'chest', 'barrel', 'hay', 'composter'],
    guest: ['bed', 'chest', 'plant'],
  };
  let placedN = 0;
  for (const it of o.items ?? lists[kind] ?? lists.living) if (place(items[it])) placedN++;
  // Rooms are remembered for the props pass (decorate) that runs after the generator's own decisions.
  if (!o.bare) (bp.rooms ??= []).push({ ...r, h, kind, wood, keep, stage: bp.stage });
  if (o.bare) return placedN;
  // Dining table with chairs (and table cloth) in the middle.
  const cx = (x1 + x2) >> 1;
  const cz = (z1 + z2) >> 1;
  if (o.table ?? ['stube', 'kitchen', 'common', 'living'].includes(kind)) {
    const ok = tryPlace([[cx, y, cz, `${wood}_fence`], [cx, y + 1, cz, rng.pick(['white_carpet', `${wood}_pressure_plate`, 'red_carpet'])]]);
    if (ok) for (const f of Object.keys(DIR)) if (rng.chance(0.85)) {
      if (tryPlace([[cx + DIR[f][0], y, cz + DIR[f][1], `${wood}_stairs[facing=${f},half=bottom]`]])) o.marks?.push(['seat', cx + DIR[f][0], y, cz + DIR[f][1], { facing: OPP[f] }]);
    }
  }
  // A blank stretch of wall for a painting.
  if (['stube', 'living', 'lobby', 'bedroom', 'twin', 'guest', 'common', 'office'].includes(kind))
    for (const [x, z, f] of shuffled) {
      const wall = bp.get(x - DIR[f][0], y + 1, z - DIR[f][1]);
      if (!bp.get(x, y + 1, z) && wall && !/glass|pane|door|ladder/.test(wall) && !keepSet.has(`${x},${z}`)) {
        const p = wallPatch(bp, x, y + 1, z, f, inRoom, h - 1);
        bp.mark('painting_spot', x, y + 1, z, { facing: f, data: p ?? { w: 1, h: 1, dir: alongDir(f) } });
        break;
      }
    }
  // Rug.
  if (['bedroom', 'twin', 'living', 'lobby', 'guest'].includes(kind)) {
    const rug = kind === 'lobby' ? 'red_carpet' : rng.pick(['red_carpet', 'white_carpet', 'light_gray_carpet', 'brown_carpet', 'green_carpet']);
    for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++) if (inRoom(x, z) && !bp.get(x, y, z) && bp.get(x, y - 1, z) && !keepSet.has(`${x},${z}`)) bp.set(x, y, z, rug);
  }
  return light(bp, r);
}

/** Hanging lantern from the ceiling of room r (centre first; works under sloped roofs too). Returns 1 if placed. */
function light(bp, r) {
  const { x1, z1, x2, z2, y } = r;
  const cx = (x1 + x2) >> 1;
  const cz = (z1 + z2) >> 1;
  const cand = [[cx, cz], [cx + 1, cz], [cx, cz + 1], [cx - 1, cz], [cx, cz - 1], [x1 + 1, z1 + 1], [x2 - 1, z2 - 1], [x1 + 1, z2 - 1], [x2 - 1, z1 + 1], [x1, z1], [x2, z2]];
  for (const [x, z] of cand) {
    if (x < x1 || x > x2 || z < z1 || z > z2) continue;
    if (bp.get(x, y, z) || bp.get(x, y + 1, z) || bp.get(x, y + 2, z)) continue;
    let top = y + 3;
    while (top < y + 10 && !bp.get(x, top, z)) top++;
    const ceil = bp.get(x, top, z);
    if (!ceil || top === y + 10) continue;
    if (/slab\[type=top|half=top|trapdoor|glass|pane|leaves|fence|ladder|lantern|_bed|door|carpet|chain|_rod|banner|sign/.test(ceil)) continue;
    bp.set(x, top - 1, z, 'lantern[hanging=true]');
    return 1;
  }
  // Low room: a lantern standing on a sturdy piece of furniture.
  for (let x = x1; x <= x2; x++)
    for (let z = z1; z <= z2; z++) {
      const b = bp.get(x, y, z);
      if (b && /barrel|chest|crafting|bookshelf|planks/.test(b) && !bp.get(x, y + 1, z)) {
        bp.set(x, y + 1, z, 'lantern[hanging=false]');
        return 1;
      }
    }
  return 0;
}
