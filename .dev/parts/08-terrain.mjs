// ================================================================ terrain variants (docs/generator-contract.md §7)
// The bridge levels every lot to the street level (plot.y) and builds retaining walls and post decks at the lot
// edge. A generator that knows the lot sits on a slope adds what belongs to the house itself:
//   walkout: a stone cellar storey under the house (workshop / store), a ladder hatch from the ground floor and,
//            where the yard on the downhill side has room, a sunken court with steps, the cellar door and windows;
//   stilts:  Valais Stadel posts with stone "mushroom" plates (or a rubble plinth) under the house, down to the drop.
// Blocks below y = 0 dig into the lot fill: the court and the cellar are cleared with explicit `air`.

/** Local side of a world side (N/E/S/W or north/east/...) for a plot rotated `turns` times clockwise. */
export function localSide(world, turns = 0) {
  const full = { N: 'north', E: 'east', S: 'south', W: 'west' }[world] ?? world;
  const order = ['north', 'east', 'south', 'west'];
  const i = order.indexOf(full);
  if (i < 0) return null;
  return order[(((i - turns) % 4) + 4) % 4];
}

const SWAP_X = { east: 'west', west: 'east', north: 'north', south: 'south' };

/**
 * Applies options.terrain to a finished house. house: { x1, z1, x2, z2 } outer walls of the part that gets the
 * cellar / posts, wood: WOOD(), mirror: the generator will mirror the blueprint afterwards (sides are swapped here).
 */
function terrainVariant(bp, rng, terrain, o) {
  if (!terrain?.mode) return null;
  const allowed = o.modes ?? ['walkout', 'stilts'];
  const mode = terrain.mode;
  if (!allowed.includes(mode)) return null;
  const drop = Math.max(0, Math.min(16, Math.round(Number(terrain.drop) || 0)));
  // Downhill in the local frame: terrain.downhill (local), or the world aspect turned back by the plot's turns.
  const local = terrain.downhill ?? (terrain.aspect && terrain.turns != null ? localSide(terrain.aspect, terrain.turns) : 'north');
  const side = o.mirror ? SWAP_X[local] ?? 'north' : local;
  const stage0 = bp.stage;
  bp.stage = 1;
  if (mode === 'walkout') walkoutCellar(bp, rng, { ...o, side });
  if (mode === 'stilts' && drop >= 2) underpin(bp, rng, { ...o, drop, kind: o.plinth ? 'plinth' : 'stadel' });
  bp.stage = stage0;
  return mode;
}

function walkoutCellar(bp, rng, o) {
  const { x1, z1, x2, z2, side, wood } = o;
  const stone = stoneMix(rng);
  const yF = -4;
  const inside = (x, z) => x > x1 && x < x2 && z > z1 && z < z2;
  // Shell: floor, walls, and the hatch with a ladder from the ground floor.
  for (let x = x1; x <= x2; x++)
    for (let z = z1; z <= z2; z++) {
      bp.set(x, yF, z, inside(x, z) ? 'stone_bricks' : stone());
      if (!inside(x, z)) for (let y = yF + 1; y <= -1; y++) bp.set(x, y, z, stone());
    }
  // The hatch goes in a ground-floor cell against an outer wall that is free in every stage, reachable from the
  // front door, and whose removal (it is a hole in the floor) cuts no one off.
  const free = (x, z) => inside(x, z) && [1, 2].every((y) => !bp.everSet(x, y, z) || PASSABLE.test(bp.get(x, y, z) ?? 'x')) && !!bp.get(x, 0, z);
  const flood = (start, without) => {
    const seen = new Set();
    const q = start.filter(([x, z]) => free(x, z) && `${x},${z}` !== without);
    for (const [x, z] of q) seen.add(`${x},${z}`);
    while (q.length) {
      const [x, z] = q.pop();
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${x + a},${z + b}`;
        if (!seen.has(k) && k !== without && free(x + a, z + b)) { seen.add(k); q.push([x + a, z + b]); }
      }
    }
    return seen;
  };
  const doors = [];
  let front = -Infinity;
  for (let x = x1; x <= x2; x++)
    for (let z = z1; z <= z2; z++) {
      const b = bp.get(x, 1, z);
      if (!b || !/_door\b/.test(b) || /trapdoor/.test(b)) continue;
      front = Math.max(front, z);
      for (const [a, c] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inside(x + a, z + c)) doors.push([x + a, z + c]);
    }
  const reach = flood(doors);
  let hatch = null;
  for (const f of [side, ...Object.keys(DIR).filter((d) => d !== side)]) {
    const [dx, dz] = DIR[f];
    for (const k of reach) {
      const [x, z] = k.split(',').map(Number);
      if (z >= front || inside(x + dx, z + dz) || doors.some(([a, b]) => Math.abs(a - x) + Math.abs(b - z) <= 1)) continue;
      if (flood(doors, k).size !== reach.size - 1) continue;
      hatch = { x, z, f };
      break;
    }
    if (hatch) break;
  }
  if (hatch) {
    for (let y = yF + 1; y <= 0; y++) bp.set(hatch.x, y, hatch.z, `ladder[facing=${OPP[hatch.f]}]`);
    bp.set(hatch.x, 1, hatch.z, `${wood.trapdoor}[facing=${OPP[hatch.f]},half=bottom,open=true]`);
  }
  // Sunken court on the downhill side: facade span u in [a1, a2], depth v = 1..D away from the wall.
  const [ox, oz] = DIR[side];
  const ns = side === 'north' || side === 'south';
  const wallC = { north: z1, south: z2, west: x1, east: x2 }[side];
  const [a1, a2] = ns ? [x1 + 1, x2 - 1] : [z1 + 1, z2 - 1];
  const XZ = (u, v) => (ns ? [u, wallC + oz * v] : [wallC + ox * v, u]);
  const okCell = (u, v, h = 3) => {
    const [x, z] = XZ(u, v);
    if (x < 0 || z < 0 || x > 16 || z > 16) return false;
    for (let y = 1; y <= h; y++) {
      if (!bp.everSet(x, y, z)) continue;
      const b = bp.get(x, y, z);
      if (!(y === 1 && b && SOFT_PLANT.test(b))) return false;
    }
    return true;
  };
  let D = 0;
  while (D < 3 && [...Array(a2 - a1 + 3)].every((_, i) => okCell(a1 - 1 + i, D + 1) && okCell(a1 - 1 + i, D + 2, 2))) D++;
  const span = a2 - a1 + 1;
  const cellar = { x1: x1 + 1, z1: z1 + 1, x2: x2 - 1, z2: z2 - 1, y: yF + 1, h: 3 };
  let door = null;
  if (D >= 1 && span >= 6 && side !== 'south') {
    const put = (u, v, y, b) => { const [x, z] = XZ(u, v); bp.set(x, y, z, b); };
    for (let u = a1; u <= a2; u++)
      for (let v = 1; v <= D; v++) {
        put(u, v, yF, rng.chance(0.7) ? 'gravel' : 'coarse_dirt');
        for (let y = yF + 1; y <= 0; y++) put(u, v, y, 'air');
      }
    for (let v = 1; v <= D + 1; v++)
      for (const u of v <= D ? [a1 - 1, a2 + 1] : [...Array(span + 2)].map((_, i) => a1 - 1 + i)) {
        for (let y = yF; y <= 0; y++) put(u, v, y, stone());
      }
    // Steps down along the outer row, from the yard at u = a2 down towards a1.
    const along = ns ? 'east' : 'south';
    for (let k = 0; k < 4; k++) {
      const u = a2 - k;
      put(u, D, -k, `stone_brick_stairs[facing=${along},half=bottom]`);
      for (let y = yF; y < -k; y++) put(u, D, y, 'stone_bricks');
    }
    // Railing on the rim, open where the steps start.
    for (let v = 1; v <= D + 1; v++)
      for (const u of v <= D ? [a1 - 1, a2 + 1] : [...Array(span + 2)].map((_, i) => a1 - 1 + i)) {
        if (v === D + 1 && u === a2) continue;
        if (v === D && u === a2 + 1) continue;
        put(u, v, 1, wood.fence);
      }
    // Facade: door, windows, lamp.
    const du = D >= 2 ? (a1 + a2 - 4) >> 1 : a1 + 1;
    const [dxx, dzz] = XZ(du, 0);
    bp.door(dxx, yF + 1, dzz, wood.door, side);
    for (const u of [du - 2, du + 2]) if (u >= a1 && u <= a2 - (D >= 2 ? 0 : 4)) { const [wx, wz] = XZ(u, 0); bp.set(wx, yF + 2, wz, 'glass_pane'); }
    const [lx, lz] = XZ(du + 1, 1);
    if (!bp.get(lx, yF + 2, lz)) bp.set(lx, yF + 2, lz, 'lantern[hanging=false]') ;
    door = [dxx - ox, dzz - oz];
  }
  // Workshop and store inside; then clear the rest of the cellar.
  const keep = [...(hatch ? [[hatch.x, hatch.z]] : []), ...(door ? [door] : [])];
  if (hatch) for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) keep.push([hatch.x + a, hatch.z + b]);
  furnish(bp, rng, cellar, 'storage', keep, wood.name, { items: ['barrel', 'barrel', 'chest', 'crafting', 'barrel', 'composter'] });
  light(bp, cellar);
  for (let x = cellar.x1; x <= cellar.x2; x++)
    for (let z = cellar.z1; z <= cellar.z2; z++)
      for (let y = yF + 1; y <= -1; y++) if (!bp.get(x, y, z)) bp.set(x, y, z, 'air');
  bp.mark('workstation', cellar.x1, cellar.y, cellar.z1, { data: { profession: 'toolsmith', cellar: true } });
}

function underpin(bp, rng, o) {
  const { x1, z1, x2, z2, drop, kind, wood } = o;
  const low = -Math.min(drop, 14);
  if (kind === 'plinth') {
    const r = rubble(rng);
    for (const [x, z] of perimeter(x1, z1, x2, z2)) for (let y = low; y <= -1; y++) bp.set(x, y, z, r());
    return;
  }
  const posts = new Set();
  for (const [x, z] of perimeter(x1, z1, x2, z2)) {
    const corner = (x === x1 || x === x2) && (z === z1 || z === z2);
    if (corner || ((x - x1) % 3 === 0 && (z === z1 || z === z2)) || ((z - z1) % 3 === 0 && (x === x1 || x === x2))) posts.add(`${x},${z}`);
  }
  for (let x = x1 + 3; x < x2 - 1; x += 3) for (let z = z1 + 3; z < z2 - 1; z += 3) posts.add(`${x},${z}`);
  for (const k of posts) {
    const [x, z] = k.split(',').map(Number);
    for (let y = low; y <= -2; y++) bp.set(x, y, z, `${wood.log}[axis=y]`);
    bp.set(x, -1, z, 'smooth_stone_slab[type=top]');
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!bp.get(x + a, -1, z + b)) bp.set(x + a, -1, z + b, 'smooth_stone_slab[type=top]');
  }
}

/**
 * Terrain modes each type builds itself (docs/generator-contract.md §7): the bridge passes options.terrain only for
 * these and then skips its own fallback (the cellar in the retaining wall). Other modes stay with the bridge.
 */
export const TERRAIN_VARIANTS = { chalet: ['walkout', 'stilts'], townhouse: ['walkout'], farmhouse: ['walkout'], hut: ['stilts'] };
const VARIANTS = TERRAIN_VARIANTS;
