// ================================================================ growth stage 3: the yard grows
// Extensions are drawn after a generator's own decisions (rng and blocks), as stage 3, only on yard cells that are
// empty in every stage, so a renovation from stage 2 to 3 only adds blocks (and replaces a few meadow flowers).

const SOFT_PLANT = /^minecraft:(poppy|dandelion|cornflower|oxeye_daisy|azure_bluet|allium|blue_orchid|.*_tulip|lily_of_the_valley|short_grass|fern|torchflower)$/;
const LAWN = /^minecraft:(grass_block|moss_block|podzol|coarse_dirt)$/;

/** Column (x, z) is lawn (or unset ground) with nothing in any stage from y=1 to y=h (meadow flowers excepted). */
function yardFree(bp, x, z, h, ground = LAWN) {
  if (!inPlot(x, z, 1, 15)) return false;
  const g = bp.get(x, 0, z);
  if (g ? !ground.test(g) : bp.everSet(x, 0, z)) return false;
  for (let y = 1; y <= h; y++) {
    if (!bp.everSet(x, y, z)) continue;
    const b = bp.get(x, y, z);
    if (y === 1 && b && SOFT_PLANT.test(b)) continue;
    return false;
  }
  return true;
}

/** Yard extensions: footprint w x d (x by z), height h, side that needs free access, and how to draw them. */
const YARD_ITEMS = {
  // Village fountain (Brunnen): post with a spout over a two-basin trough, flowers on top.
  fountain: { w: 3, d: 1, h: 3, draw(bp, rng, x, z, o) {
    bp.fill(x, 1, z, x, 2, z, `${o.wood.log}[axis=y]`);
    bp.set(x, 3, z, rng.pick(['potted_red_tulip', 'potted_poppy', 'potted_flowering_azalea_bush']));
    bp.set(x + 1, 1, z, 'water_cauldron[level=3]');
    bp.set(x + 2, 1, z, 'water_cauldron[level=3]');
    bp.set(x + 1, 2, z, `${o.wood.trapdoor}[facing=east,half=top]`);
  } },
  // Bee house: two hives on a bench under a little roof.
  bees: { w: 2, d: 1, h: 3, access: 'south', draw(bp, rng, x, z, o) {
    for (let i = 0; i < 2; i++) {
      bp.set(x + i, 1, z, `beehive[facing=${o.face},honey_level=${rng.int(0, 3)}]`);
      bp.set(x + i, 2, z, `${o.wood.slab}[type=bottom]`);
    }
  } },
  // Greenhouse: glass box with a timber frame, crop beds either side of a path, lantern under a plank.
  greenhouse: { w: 5, d: 4, h: 4, access: 'south', draw(bp, rng, x, z, o) {
    const x2 = x + 4, z2 = z + 3;
    for (let xx = x; xx <= x2; xx++)
      for (let zz = z; zz <= z2; zz++) {
        const edge = xx === x || xx === x2 || zz === z || zz === z2;
        const corner = (xx === x || xx === x2) && (zz === z || zz === z2);
        for (let y = 1; y <= 3; y++) if (edge) bp.set(xx, y, zz, corner ? `${o.wood.log}[axis=y]` : 'glass');
        bp.set(xx, 4, zz, edge ? `${o.wood.slab}[type=bottom]` : 'glass');
        if (!edge) {
          const path = xx === x + 2;
          bp.set(xx, 0, zz, path ? 'dirt_path' : 'farmland[moisture=7]');
          if (!path) bp.set(xx, 1, zz, rng.pick(['carrots[age=7]', 'beetroots[age=3]', 'potatoes[age=7]', 'wheat[age=7]']));
        }
      }
    bp.set(x + 2, 4, z + 1, o.wood.planks);
    bp.set(x + 2, 3, z + 1, 'lantern[hanging=true]');
    const dz = o.face === 'south' ? z2 : z;
    bp.door(x + 2, 1, dz, o.wood.door, o.face);
    bp.set(x + 2, 0, dz + (o.face === 'south' ? 1 : -1), 'dirt_path');
  } },
  // Pergola with a climbing plant over a garden table.
  pergola: { w: 3, d: 3, h: 4, draw(bp, rng, x, z, o) {
    for (const [px, pz] of [[x, z], [x + 2, z], [x, z + 2], [x + 2, z + 2]]) bp.fill(px, 1, pz, px, 2, pz, o.wood.fence);
    for (let xx = x; xx <= x + 2; xx++)
      for (let zz = z; zz <= z + 2; zz++) {
        bp.set(xx, 3, zz, `${o.wood.slab}[type=bottom]`);
        if ((xx + zz) % 2 === 0 || rng.chance(0.4)) bp.set(xx, 4, zz, rng.pick(['flowering_azalea_leaves[persistent=true]', 'azalea_leaves[persistent=true]', 'oak_leaves[persistent=true]']));
      }
    bp.set(x + 1, 1, z + 1, o.wood.fence);
    bp.set(x + 1, 2, z + 1, 'white_carpet');
    bp.set(x, 1, z + 1, `${o.wood.stairs}[facing=west,half=bottom]`);
    bp.set(x + 2, 1, z + 1, `${o.wood.stairs}[facing=east,half=bottom]`);
    bp.mark('food_spot', x + 1, 2, z + 1, { data: { item: rng.pick(['bread', 'apple', 'cookie', 'pumpkin_pie', 'sweet_berries']) } });
  } },
  // Flag pole with the Swiss or a canton flag.
  flag: { w: 1, d: 1, h: 8, draw(bp, rng, x, z) {
    const [b, data] = rng.chance(0.5) ? ['red', SWISS_FLAG] : rng.pick(CANTONS);
    flagPole(bp, x, z, 7, `${b}_banner[rotation=0]${data}`);
  } },
  // Raised vegetable bed with a composter.
  beds: { w: 3, d: 2, h: 2, draw(bp, rng, x, z) {
    const crop = rng.pick(['carrots[age=7]', 'potatoes[age=7]', 'beetroots[age=3]', 'wheat[age=7]']);
    for (let xx = x; xx < x + 3; xx++)
      for (let zz = z; zz < z + 2; zz++) {
        if (xx === x + 2 && zz === z) { bp.set(xx, 1, zz, 'composter[level=3]'); continue; }
        bp.set(xx, 0, zz, 'farmland[moisture=7]');
        bp.set(xx, 1, zz, crop);
      }
  } },
  // Woodpile under a lean roof.
  woodpile: { w: 3, d: 1, h: 3, draw(bp, rng, x, z, o) {
    for (let i = 0; i < 3; i++) {
      bp.set(x + i, 1, z, `${rng.pick(['oak_log', 'birch_log', 'spruce_log'])}[axis=z]`);
      if (i !== 1 || rng.chance(0.7)) bp.set(x + i, 2, z, `${rng.pick(['oak_log', 'birch_log', 'spruce_log'])}[axis=z]`);
      bp.set(x + i, 3, z, `${o.roofMat?.slab ?? o.wood.slab}[type=bottom]`);
    }
  } },
  // Outhouse (Plumpsklo) with a heart in the door.
  outhouse: { w: 3, d: 3, h: 4, access: 'south', draw(bp, rng, x, z, o) {
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        if (i !== 1 || j === 0) bp.fill(x + i, 1, z + j, x + i, 3, z + j, o.wood.planks);
        bp.set(x + i, 4, z + j, `${o.wood.slab}[type=bottom]`);
      }
    bp.set(x + 1, 0, z + 1, o.wood.planks);
    bp.set(x + 1, 1, z + 1, 'smooth_quartz_slab[type=bottom]');
    bp.set(x + 1, 3, z + 1, o.wood.planks);
    bp.door(x + 1, 1, z + 2, o.wood.door, 'south');
    bp.set(x + 1, 3, z + 2, o.wood.planks);
  } },
  // Garden bench under a small tree.
  bench: { w: 4, d: 1, h: 2, draw(bp, rng, x, z, o) {
    bench(bp, x + 1, z, 'north', 2, o.wood.name);
  } },
};

/** Stage 1 of a house whose bedrooms are upstairs: a bed (and chest) in the first of `rooms` ([room, keep]) with space. */
function stage1Bed(v, rng, rooms, wood, items = ['bed', 'chest']) {
  for (const [r, keep] of rooms) if (furnish(v, rng, r, 'bedroom', keep, wood, { items, bare: true })) return true;
  return false;
}

const PASSABLE =/_door\b|fence_gate|carpet|pressure_plate|banner|sign|torch|button|^minecraft:(poppy|dandelion|cornflower|oxeye_daisy|azure_bluet|allium|blue_orchid|.*_tulip|lily_of_the_valley|short_grass|tall_grass|fern|large_fern|torchflower|wheat|carrots|potatoes|beetroots|.*_sapling|pink_petals|wildflowers)\b/;

/** Plot cells a person can reach at ground level (y=1, two blocks clear) from the street edge, with `blocked` cells walled. */
function yardReach(bp, blocked) {
  const ok = (x, z) => {
    if (x < 0 || z < 0 || x > 16 || z > 16 || blocked.has(`${x},${z}`)) return false;
    if (/water|lava/.test(bp.get(x, 0, z) ?? '')) return false;
    for (let y = 1; y <= 2; y++) {
      const b = bp.get(x, y, z);
      if (b && !PASSABLE.test(b)) return false;
    }
    return true;
  };
  const seen = new Set();
  const q = [];
  for (let x = 0; x <= 16; x++) if (ok(x, 16)) { seen.add(`${x},16`); q.push([x, 16]); }
  while (q.length) {
    const [x, z] = q.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${x + dx},${z + dz}`;
      if (!seen.has(k) && ok(x + dx, z + dz)) { seen.add(k); q.push([x + dx, z + dz]); }
    }
  }
  return seen;
}

/**
 * Stage-3 yard: places up to `max` items from `prefer` (in that order of preference) on free lawn.
 * o: { house: [x1, z1, x2, z2] kept clear (with margin), door: [x, z] (path from there to the street stays clear),
 * wood: WOOD(), roofMat, prefer: [...kinds], max, ground: regex of acceptable ground blocks }.
 * Returns the kinds placed.
 */
function growYard(bp, rng, o) {
  const { house, door, prefer, max = 3, ground = LAWN } = o;
  const [hx1, hz1, hx2, hz2] = house;
  const taken = new Set();
  const placed = [];
  const reserved = (x, z) => (x >= hx1 - 1 && x <= hx2 + 1 && z >= hz1 - 1 && z <= hz2 + 1) || (door && Math.abs(x - door[0]) <= 1 && z >= door[1]);
  for (const kind of prefer) {
    if (placed.length >= max) break;
    const it = YARD_ITEMS[kind];
    if (!it) continue;
    const spots = [];
    for (let x = 1; x + it.w - 1 <= 15; x++)
      for (let z = 1; z + it.d - 1 <= 15; z++) {
        let ok = true;
        for (let i = 0; i < it.w && ok; i++)
          for (let j = 0; j < it.d && ok; j++) {
            const cx = x + i, cz = z + j;
            if (reserved(cx, cz) || !yardFree(bp, cx, cz, it.h, ground)) ok = false;
            for (let a = -1; a <= 1 && ok; a++) for (let b = -1; b <= 1 && ok; b++) if (taken.has(`${cx + a},${cz + b}`)) ok = false;
          }
        if (!ok) continue;
        // Access: the row in front (south, towards the street) or behind must be walkable lawn.
        const rowFree = (zz) => [...Array(it.w)].every((_, i) => yardFree(bp, x + i, zz, 2, ground) && !taken.has(`${x + i},${zz}`));
        const face = rowFree(z + it.d) ? 'south' : !it.access && rowFree(z - 1) ? 'north' : null;
        if (!face) continue;
        spots.push([x, z, face]);
      }
    // Never cut a walkway: everything reachable before must stay reachable (the item's own cells excepted).
    const before = yardReach(bp, new Set());
    let spot = null;
    while (spots.length && !spot) {
      const i = Math.floor(rng.next() * spots.length);
      const [x, z] = spots[i];
      const blocked = new Set();
      for (let a = 0; a < it.w; a++) for (let b = 0; b < it.d; b++) blocked.add(`${x + a},${z + b}`);
      const after = yardReach(bp, blocked);
      if ([...before].every((k) => blocked.has(k) || after.has(k))) spot = spots[i];
      else spots.splice(i, 1);
    }
    if (!spot) continue;
    const [x, z, face] = spot;
    it.draw(bp, rng, x, z, { ...o, face });
    // Grass under a solid block turns to dirt in the game: say so in the list.
    for (let i = 0; i < it.w; i++)
      for (let j = 0; j < it.d; j++) {
        const above = bp.get(x + i, 1, z + j);
        if (bp.get(x + i, 0, z + j) === 'minecraft:grass_block' && above && !SOFT_PLANT.test(above) && !PASSABLE.test(above)) bp.set(x + i, 0, z + j, 'coarse_dirt');
      }
    for (let i = -1; i <= it.w; i++) for (let j = -1; j <= it.d; j++) taken.add(`${x + i},${z + j}`);
    placed.push(kind);
  }
  return placed;
}

/** Sizes of the yard items, for the economy's small forms: kind -> { w, d, h } (x by z by height). */
export const YARD_FORMS = Object.fromEntries(Object.entries(YARD_ITEMS).map(([k, v]) => [k, { w: v.w, d: v.d, h: v.h }]));

/**
 * One yard item on its own (fountain, bees, greenhouse, pergola, flag, beds, woodpile, outhouse, bench) as a small form:
 * blocks at x 0..w-1, z 0..d-1 (y = 0 ground, front towards +z), deterministic per seed.
 */
export function yardForm(kind, seed, wood = 'spruce') {
  const it = YARD_ITEMS[kind];
  if (!it) return null;
  const bp = new Blueprint();
  it.draw(bp, rngFrom(`${seed}:${kind}`), 0, 0, { wood: WOOD(wood), face: 'south', roofMat: ROOFS.spruce });
  return { bp, w: it.w, d: it.d, h: it.h };
}
