// Pure helpers for building by hand: parsing blueprint block strings, block families, what "the same
// block" means, and the candidate clicks (reference block + face + look direction) that give a block the
// right facing / half / axis. Ported from the spike (live-builder.mjs), where 96.5 % of a chalet came
// out right on the first click.
import { Vec3 } from 'vec3';

/** "minecraft:oak_stairs[facing=east,half=bottom]{nbt}" -> { name, props, nbt }. */
export function parseBlock(s) {
  const m = /^(?:minecraft:)?([a-z0-9_]+)(?:\[([^\]]*)\])?(\{.*\})?$/.exec(s);
  if (!m) return { name: s.replace(/^minecraft:/, ''), props: {}, nbt: '' };
  const props = {};
  if (m[2]) for (const kv of m[2].split(',')) {
    const [k, v] = kv.split('=');
    if (k) props[k.trim()] = String(v).trim();
  }
  return { name: m[1], props, nbt: m[3] ?? '' };
}

/** Item that places a block (mirrors bridge.mjs itemFor). */
export function itemFor(name) {
  if (name.startsWith('potted_')) return 'flower_pot';
  if (name === 'water_cauldron' || name === 'lava_cauldron' || name === 'powder_snow_cauldron') return 'cauldron';
  if (name === 'water') return 'water_bucket';
  return name.replace('_wall_banner', '_banner').replace('wall_torch', 'torch').replace('_wall_hanging_sign', '_hanging_sign').replace('_wall_sign', '_sign');
}

export function family(name) {
  for (const f of ['stairs', 'slab', 'trapdoor', 'door', 'fence_gate', 'bed', 'log', 'wall_torch', 'wall_sign', 'wall_banner', 'ladder', 'lantern', 'chest', 'barrel', 'furnace', 'smoker', 'campfire', 'button', 'carpet', 'pane', 'fence', 'wall'])
    if (name.endsWith(f) || name.includes(`_${f}`) || name === f) return f;
  return /_wood$|_stem$|^stripped_|basalt|pillar|hay_block|bone_block|chain$/.test(name) ? 'log' : 'block';
}

// Properties the world itself derives from the neighbours. `setblock` (the fast mode) derives them the
// same way (it runs updateFromNeighbourShapes), so they are not part of "the same block".
const SIDES = new Set(['north', 'south', 'east', 'west', 'up', 'down']);
const CONNECTS = /fence|_pane$|iron_bars|_wall$|redstone_wire|tripwire$|chorus_plant|mushroom_block|mushroom_stem|^glass_pane$/;
const DERIVED = new Set(['waterlogged', 'distance', 'snowy', 'powered', 'instrument', 'note', 'attached', 'in_wall', 'triggered', 'signal_fire', 'occupied', 'tip', 'thickness', 'bottom']);
function derived(name, key) {
  if (DERIVED.has(key)) return true;
  if (SIDES.has(key) && CONNECTS.test(name)) return true;
  if (key === 'shape' && name.endsWith('_stairs')) return true;
  if (key === 'type' && (name === 'chest' || name === 'trapped_chest')) return true; // single/left/right follows the neighbours
  return false;
}

/** Name and every non-derived property equal: what the fast mode would have left there. */
export function sameBlock(world, t) {
  if (!world || world.name !== t.name) return false;
  const wp = world.getProperties();
  for (const [k, v] of Object.entries(t.props)) {
    if (derived(t.name, k)) continue;
    if (k in wp && String(wp[k]) !== v) return false;
  }
  return true;
}

export function mismatch(world, t) {
  if (!world || world.name !== t.name) return `name:${world?.name}`;
  const wp = world.getProperties();
  return Object.entries(t.props).filter(([k, v]) => !derived(t.name, k) && k in wp && String(wp[k]) !== v).map(([k, v]) => `${k}=${wp[k]}!${v}`).join(',');
}

// Blocks a player cannot produce with one click: block entities with data, filled cauldrons, potted
// plants, liquids. These go by RCON while the bot looks at the spot and swings.
export const TRICKY = /^potted_|_banner$|_sign$|_hanging_sign$|^water|^lava|^bubble|^fire$|_cauldron$|^piston_head|^moving_piston|^tall_seagrass|^kelp_plant|^bell$|^candle|_candle$/;

export const DIRS = { north: new Vec3(0, 0, -1), south: new Vec3(0, 0, 1), west: new Vec3(-1, 0, 0), east: new Vec3(1, 0, 0), up: new Vec3(0, 1, 0), down: new Vec3(0, -1, 0) };
export const OPP = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };
export const YAW = { north: 0, west: Math.PI / 2, south: Math.PI, east: -Math.PI / 2 };

/** Yaw convention per family, learnt in the spike: +1 = look toward `facing`, -1 = look away from it. */
export const YAW_RULE = { stairs: 1, door: 1, bed: 1, fence_gate: 1, chest: -1, furnace: -1, smoker: -1, barrel: -1, campfire: -1, block: -1, trapdoor: -1 };

/**
 * Candidate clicks for target t at p: [{ ref, face, yaw?, pitch?, cy?, cursor? }], most likely first.
 * `solidRef(pos)` returns a block that can be clicked on, or null.
 */
export function plans(p, t, solidRef, yawRule = YAW_RULE) {
  const fam = family(t.name);
  const pr = t.props;
  const out = [];
  const refFor = (dirName) => {
    const ref = solidRef(p.minus(DIRS[dirName]));
    return ref ? { ref, face: DIRS[dirName] } : null;
  };
  const sides = ['north', 'south', 'east', 'west'];
  const halfTop = pr.half === 'top' || pr.type === 'top';
  const yawFor = (facing) => (facing in YAW ? YAW[(yawRule[fam] ?? 1) > 0 ? facing : OPP[facing]] : null);

  if (pr.axis) {
    const ds = pr.axis === 'y' ? ['up', 'down'] : pr.axis === 'x' ? ['east', 'west'] : ['north', 'south'];
    for (const d of ds) {
      const c = refFor(d);
      if (c) out.push(c);
    }
  } else if (fam === 'ladder' || /wall_torch|wall_head|wall_skull/.test(t.name)) {
    const c = pr.facing && refFor(pr.facing);
    if (c) out.push(c);
  } else if (fam === 'lantern') {
    const c = refFor(pr.hanging === 'true' ? 'down' : 'up');
    if (c) out.push(c);
  } else if (fam === 'door' || fam === 'bed') {
    const c = refFor('up');
    if (c) out.push({ ...c, yaw: yawFor(pr.facing), cursor: pr.hinge === 'right' ? 0.8 : 0.2 });
  } else if (fam === 'trapdoor') {
    // side click: facing = clicked face; vertical click: facing = opposite of the look direction
    const side = pr.facing && refFor(pr.facing);
    if (side) out.push({ ...side, cy: halfTop ? 0.8 : 0.2 });
    const v = refFor(halfTop ? 'down' : 'up');
    if (v && pr.facing) out.push({ ...v, yaw: YAW[OPP[pr.facing]] });
  } else if (fam === 'slab' || fam === 'stairs') {
    const v = refFor(halfTop ? 'down' : 'up');
    const yaw = pr.facing ? yawFor(pr.facing) : null;
    if (v) out.push({ ...v, yaw });
    for (const s of sides) {
      const c = refFor(s);
      if (c) out.push({ ...c, yaw, cy: halfTop ? 0.8 : 0.2 });
    }
  } else {
    const yaw = pr.facing && pr.facing in YAW ? yawFor(pr.facing) : null;
    const pitch = pr.facing === 'up' ? -Math.PI / 2.2 : pr.facing === 'down' ? Math.PI / 2.2 : null;
    for (const d of ['up', ...sides, 'down']) {
      const c = refFor(d);
      if (c) out.push({ ...c, yaw, pitch });
    }
  }
  return out;
}

/** Faces a temporary support block could go on so that `t` gets something to be placed against. */
export function supportDirs(t) {
  const fam = family(t.name);
  const pr = t.props;
  if (pr.axis) return pr.axis === 'y' ? ['up', 'down'] : pr.axis === 'x' ? ['east', 'west'] : ['north', 'south'];
  if (fam === 'lantern') return [pr.hanging === 'true' ? 'down' : 'up'];
  if (pr.half === 'top' || pr.type === 'top') return ['down', 'north', 'south', 'east', 'west'];
  if (fam === 'ladder' || /wall_/.test(t.name)) return pr.facing ? [pr.facing] : [];
  return ['up', 'north', 'south', 'east', 'west', 'down'];
}

/** Blocks a click must not land on (they would open, sit, ring…) or that cannot carry another block. */
export const NOT_A_REF = /door|trapdoor|chest|barrel|bed|sign|banner|cauldron|pot|campfire|lantern|pane|fence|carpet|ladder|bell|lectern|crafting|furnace|smoker|anvil|button|lever|candle|torch|flower|sapling|grass$|fern|bars|chain|rail|vine|scaffolding|water|lava/;
