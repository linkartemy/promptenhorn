// ================================================================ props: the small things that make rooms lived in
// decorate() runs at the very end of a generator (after its last rng decision), over the rooms furnish() recorded:
// candles, cakes, pots and plants on furniture, a tapestry on a blank wall, coat hooks by the front door, and markers
// for entity props the bridge may add (paintings with their size, wall clocks, coat-rack armor stands, food on tables).
// Every prop belongs to the growth stage of its room.

/** Furniture with a full, sturdy top (candles and cakes need one; pots don't but look right there). */
const PROP_BASE = /^minecraft:(barrel|crafting_table|bookshelf|chiseled_bookshelf|[a-z_]+_planks|smooth_quartz|cartography_table|fletching_table|smithing_table|loom|composter)\b/;
const FULL_WALL = (b) => b && !/glass|pane|_door|ladder|trapdoor|_stairs|_slab|fence|_wall\b|_bars|leaves|banner|sign|lantern|torch|carpet|_bed|chest|cauldron|campfire|smoker|furnace|lectern|potted|flower_pot|decorated_pot|cake|candle|shelf|hay_block|composter|barrel|crafting|bookshelf/.test(b);

const TAPESTRIES = [
  ['red', pattern([['straight_cross', 'white'], ['border', 'red']])],
  ['green', pattern([['flower', 'white'], ['border', 'white']])],
  ['white', pattern([['rhombus', 'red'], ['border', 'red']])],
  ['blue', pattern([['stripe_center', 'white'], ['stripe_middle', 'white'], ['curly_border', 'blue']])],
  ['brown', pattern([['triangles_bottom', 'white'], ['flower', 'yellow']])],
  ['white', pattern([['stripe_top', 'red'], ['stripe_bottom', 'red'], ['circle', 'red']])],
  ['cyan', pattern([['gradient', 'white'], ['flower', 'white']])],
];

const PROPS_BY_KIND = {
  kitchen: { n: 2, list: [['cake', 2], ['potted_fern', 1], ['candle[candles=2,lit=true]', 1], ['decorated_pot[facing=south]', 1]] },
  stube: { n: 2, list: [['candle[candles=3,lit=true]', 2], ['potted_red_tulip', 1.5], ['potted_flowering_azalea_bush', 1], ['decorated_pot[facing=south]', 1]] },
  living: { n: 2, list: [['candle[candles=2,lit=true]', 1.5], ['potted_azalea_bush', 1.5], ['potted_bamboo', 1], ['decorated_pot[facing=south]', 1]] },
  common: { n: 2, list: [['candle[candles=3,lit=true]', 2], ['potted_dandelion', 1], ['decorated_pot[facing=south]', 1]] },
  lobby: { n: 2, list: [['potted_flowering_azalea_bush', 2], ['candle[candles=4,lit=true]', 1]] },
  office: { n: 2, list: [['candle[candles=1,lit=true]', 2], ['potted_fern', 1], ['decorated_pot[facing=south]', 0.6]] },
  shop: { n: 3, list: [['decorated_pot[facing=south]', 2], ['candle[candles=3,lit=true]', 1], ['potted_red_tulip', 1], ['cake', 0.6]] },
  bedroom: { n: 1, list: [['candle[candles=1,lit=true]', 1.5], ['potted_white_tulip', 1], ['potted_pink_tulip', 1]] },
  twin: { n: 1, list: [['candle[candles=1,lit=true]', 1.5], ['potted_lily_of_the_valley', 1]] },
  guest: { n: 1, list: [['potted_red_tulip', 1], ['candle[candles=1,lit=true]', 1]] },
  bath: { n: 1, list: [['potted_fern', 1], ['candle[candles=2,lit=true]', 1]] },
  dorm: { n: 1, list: [['candle[candles=1,lit=true]', 1]] },
};
const TAPESTRY_ROOMS = new Set(['stube', 'living', 'lobby', 'common', 'office', 'guest', 'bedroom', 'twin']);
const CLOCK_ROOMS = new Set(['stube', 'kitchen', 'living', 'common', 'lobby', 'office']);
const FOODS = ['bread', 'apple', 'baked_potato', 'cookie', 'pumpkin_pie', 'cake', 'sweet_berries', 'honey_bottle', 'mushroom_stew', 'cooked_chicken'];

/** Size of a blank wall patch for a painting at slot (x, y, z) facing f: { w (1..2, extending `dir`), h (1..2) }. */
function wallPatch(bp, x, y, z, f, inRoom, maxH = 2) {
  const [dx, dz] = DIR[f];
  const blank = (cx, cy, cz) => inRoom(cx, cz) && !bp.everSet(cx, cy, cz) && FULL_WALL(bp.get(cx - dx, cy, cz - dz));
  if (!blank(x, y, z)) return null;
  const [ax, az] = along(f);
  const dir = alongDir(f);
  const w = blank(x + ax, y, z + az) ? 2 : 1;
  const h = maxH >= 2 && blank(x, y + 1, z) && (w === 1 || blank(x + ax, y + 1, z + az)) ? 2 : 1;
  return { w, h, dir };
}

function decorate(bp, rng) {
  const stage0 = bp.stage;
  const marked = (kind, x, y, z) => bp.markers.some((m) => m.kind === kind && m.x === x && m.y === y && m.z === z);
  let clocks = 0;
  for (const r of bp.rooms ?? []) {
    bp.stage = r.stage ?? 1;
    const { x1, z1, x2, z2, y, kind } = r;
    const h = r.h ?? 3;
    const inRoom = (x, z) => x >= x1 && x <= x2 && z >= z1 && z <= z2;
    const keep = new Set((r.keep ?? []).map(([x, z]) => `${x},${z}`));
    // Things on furniture.
    const spec = PROPS_BY_KIND[kind];
    if (spec) {
      const tops = [];
      for (let x = x1; x <= x2; x++)
        for (let z = z1; z <= z2; z++) {
          const b = bp.get(x, y, z);
          if (b && PROP_BASE.test(b) && !bp.everSet(x, y + 1, z) && h >= 2) tops.push([x, z]);
        }
      for (let i = 0; i < spec.n && tops.length; i++) {
        const [x, z] = tops.splice(Math.floor(rng.next() * tops.length), 1)[0];
        if (rng.chance(0.25)) continue;
        bp.set(x, y + 1, z, rng.weighted(spec.list));
      }
    }
    // Food on dining tables (fence leg with a cloth or plate on top): a spot for an item display.
    for (let x = x1; x <= x2; x++)
      for (let z = z1; z <= z2; z++)
        if (/_fence$/.test(blockName(bp.get(x, y, z))) && /carpet|pressure_plate/.test(bp.get(x, y + 1, z) ?? '') && !marked('food_spot', x, y + 1, z))
          bp.mark('food_spot', x, y + 1, z, { data: { item: rng.pick(FOODS) } });
    // Slots along the walls, in a random order.
    const slots = [];
    for (let x = x1; x <= x2; x++) slots.push([x, z1, 'south'], [x, z2, 'north']);
    for (let z = z1 + 1; z < z2; z++) slots.push([x1, z, 'east'], [x2, z, 'west']);
    const order = slots.map((s) => [rng.next(), s]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
    // A tapestry (wall banner hanging from y+2) on a blank wall.
    if (TAPESTRY_ROOMS.has(kind) && h >= 3 && rng.chance(0.55)) {
      for (const [x, z, f] of order) {
        if (keep.has(`${x},${z}`) || marked('painting_spot', x, y + 1, z)) continue;
        const p = wallPatch(bp, x, y + 1, z, f, inRoom);
        if (!p || p.h < 2) continue;
        const [base, data] = rng.pick(TAPESTRIES);
        bp.set(x, y + 2, z, `${base}_wall_banner[facing=${f}]${data}`);
        break;
      }
    }
    // A wall clock (item frame / display with a clock) at eye height, one per floor's kitchen or Stube.
    if (CLOCK_ROOMS.has(kind) && h >= 3 && clocks < 6) {
      for (const [x, z, f] of order) {
        if (marked('painting_spot', x, y + 1, z) || bp.everSet(x, y + 2, z)) continue;
        const [dx, dz] = DIR[f];
        if (!FULL_WALL(bp.get(x - dx, y + 2, z - dz))) continue;
        bp.mark('wall_clock', x, y + 2, z, { facing: f });
        clocks++;
        break;
      }
    }
  }
  // Coat hooks and a coat-rack spot inside the main entrance.
  const base = bp.atStage(1);
  const doors = [...base.blocks].filter(([k, b]) => /_door\b/.test(b) && /half=lower/.test(b) && Number(k.split(',')[1]) <= 2);
  doors.sort((a, b) => Number(b[0].split(',')[2]) - Number(a[0].split(',')[2]));
  const d = doors[0];
  if (d) {
    const [x, y, z] = d[0].split(',').map(Number);
    const f = blockProps(d[1]).facing;
    if (DIR[f]) {
      bp.stage = 1;
      const [dx, dz] = DIR[f];
      const [ax, az] = along(f);
      const ix = x - dx, iz = z - dz;
      let hooks = 0;
      for (const s of [1, -1, 2, -2]) {
        const cx = ix + ax * s, cz = iz + az * s;
        const wall = base.get(cx + dx, y + 1, cz + dz);
        if (bp.everSet(cx, y + 1, cz) || !FULL_WALL(wall) || bp.get(cx + dx, y + 1, cz + dz) !== wall || base.get(cx, y - 1, cz) == null) continue;
        bp.set(cx, y + 1, cz, `tripwire_hook[facing=${OPP[f]},attached=false,powered=false]`);
        if (!hooks && !bp.everSet(cx, y, cz)) bp.mark('coat_rack', cx, y, cz, { facing: OPP[f] });
        if (++hooks >= 2) break;
      }
    }
  }
  bp.stage = stage0;
  return bp;
}
