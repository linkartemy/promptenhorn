// Mode A spike ("Реалистичный"): a real player bot walks to a plot and builds a project blueprint by hand.
//
//   node live-builder.mjs --mode hand   --type chalet --seed spike-1 [--limit 400] [--name Builder]
//   node live-builder.mjs --mode hybrid --type chalet --seed spike-2
//
// hand:   every block is placed with a real block_place packet (look + swing + use-item-on), the bot walks
//         (pathfinder, may tower with dirt scaffolding), falls back to creative flight, then to /tp.
//         Block states are steered via yaw / clicked face / cursor; the result is read back and compared
//         to the blueprint. Wrong or impossible blocks are fixed with RCON setblock (counted separately).
// hybrid: the bot walks around the site and swings at each block while RCON setblock places it.
import { createRequire } from 'node:module';
import { Vec3 } from 'vec3';
import { generate } from '../bridge/buildings.mjs';
import { makeBot, rcon, sleep, log, parseBlock, itemFor } from './common.mjs';

const require = createRequire(import.meta.url);
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const INTERACTABLE = new Set(require('mineflayer-pathfinder/lib/interactable.json'));

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : acc), []),
);
const MODE = args.mode ?? 'hand';
const TYPE = args.type ?? 'chalet';
const SEED = args.seed ?? 'spike-1';
const NAME = args.name ?? (MODE === 'hand' ? 'Builder' : 'Hybrid');
const LIMIT = Number(args.limit ?? Infinity);
const PLOT_DX = Number(args.dx ?? -10); // plot origin relative to the bot's spawn
const PLOT_DZ = Number(args.dz ?? 50);
const REACH = 4.5;
const HYBRID_RATE = Number(args.rate ?? 0); // blocks per second cap in hybrid mode (0 = as fast as possible)

const r = await rcon();
const cmd = (c) => r.command(c);
await cmd('difficulty peaceful');
await cmd('gamerule advance_time false');
await cmd('time set 1000');
await cmd('gamerule send_command_feedback false');

const bot = await makeBot(NAME);
bot.loadPlugin(pathfinder);
for (const ev of ['respawn', 'death', 'mount', 'forcedMove', 'game']) bot.on(ev, () => process.env.DEBUG && log('event', ev, bot.entity.position.toString()));
await cmd(`op ${NAME}`);
await cmd(`gamemode creative ${NAME}`);
await sleep(500);
const registry = bot.registry;
const sp = bot.spawnPoint;
await cmd(`tp ${NAME} ${sp.x + 0.5} ${sp.y} ${sp.z + 0.5}`);
await sleep(1500);
const start = bot.entity.position.clone();
log(`${NAME} spawned at ${start.floored()} mode=${MODE}`);

// ------------------------------------------------------------- plot preparation (the bridge does this today)
const x0 = Math.floor(start.x) + PLOT_DX;
const z0 = Math.floor(start.z) + PLOT_DZ;
async function surfaceY(x, z) {
  for (let i = 0; i < 100; i++) {
    const col = bot.blockAt(new Vec3(x, 0, z));
    if (col) break;
    await sleep(200);
  }
  for (let y = 140; y > -60; y--) {
    const b = bot.blockAt(new Vec3(x, y, z));
    if (b && !/air|snow$|short_grass|tall_grass|fern|dead_bush|flower|sweet_berry/.test(b.name) && b.boundingBox === 'block') return y + 1;
  }
  return 64;
}
const y0 = await surfaceY(x0 + 10, z0 + 10);
log(`plot origin ${x0} ${y0} ${z0} (distance ${Math.round(start.distanceTo(new Vec3(x0 + 10, y0, z0 + 10)))} blocks)`);
await cmd(`fill ${x0 - 3} ${y0} ${z0 - 3} ${x0 + 23} ${y0 + 26} ${z0 + 23} air`);
await cmd(`fill ${x0 - 3} ${y0 - 4} ${z0 - 3} ${x0 + 23} ${y0 - 2} ${z0 + 23} dirt`);
await cmd(`fill ${x0 - 3} ${y0 - 1} ${z0 - 3} ${x0 + 23} ${y0 - 1} ${z0 + 23} grass_block`);
await sleep(1500);

// blueprint -> world list (plot-local y=0 is the ground layer, as in the bridge)
const local = generate(TYPE, SEED).toBuildList({ turns: 0, size: 21, offset: 2, clipMin: 0, clipMax: 20 });
const list = local.slice(0, LIMIT).map((b) => ({ ...b, pos: new Vec3(x0 + b.x, y0 - 1 + b.y, z0 + b.z), t: parseBlock(b.block) }));
const targetAt = new Map(list.map((b) => [b.pos.toString(), b]));
log(`${TYPE}/${SEED}: ${list.length} blocks`);

// ------------------------------------------------------------- movement
const movements = new Movements(bot);
movements.canDig = false;
movements.allow1by1towers = true;
movements.allowParkour = true;
movements.scafoldingBlocks = [registry.itemsByName.dirt.id];
bot.pathfinder.setMovements(movements);
bot.pathfinder.thinkTimeout = 3000;

const stats = { hand: 0, handFixed: 0, rconTricky: 0, rconNoSupport: 0, rconWrong: 0, already: 0, retries: 0, walk: 0, walkFail: 0, fly: 0, tp: 0, scaffold: 0, digs: 0 };
const failures = {}; // family -> reasons
const note = (fam, why) => ((failures[fam] ??= {})[why] = (failures[fam][why] ?? 0) + 1);
const scaffold = new Set();
let myPlacing = false;
bot.on('blockPlaced', (_old, nb) => {
  if (!myPlacing && nb?.name === 'dirt') scaffold.add(nb.position.toString());
});

const eye = () => bot.entity.position.offset(0, bot.entity.eyeHeight ?? 1.62, 0);
const inReach = (p) => eye().distanceTo(p.offset(0.5, 0.5, 0.5)) <= REACH;
function occupies(p) {
  const e = bot.entity.position;
  return e.x + 0.3 > p.x && e.x - 0.3 < p.x + 1 && e.z + 0.3 > p.z && e.z - 0.3 < p.z + 1 && e.y + 1.8 > p.y && e.y < p.y + 1;
}
const free = (p) => {
  const b = bot.blockAt(p);
  return !b || b.boundingBox === 'empty';
};

async function withTimeout(promise, ms, onTimeout) {
  let t;
  const timer = new Promise((_, rej) => (t = setTimeout(() => rej(new Error('timeout')), ms)));
  try {
    return await Promise.race([promise, timer]);
  } catch (e) {
    onTimeout?.();
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/** A spot outside the target cell, on the plot's outer side of p, where the bot can hover/stand. */
function outsideSpot(p) {
  const c = new Vec3(x0 + 10, p.y, z0 + 10);
  let dx = p.x - c.x;
  let dz = p.z - c.z;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  for (const d of [2, 3, 1.5, 4]) {
    const s = new Vec3(Math.floor(p.x + dx * d) + 0.5, p.y - 1, Math.floor(p.z + dz * d) + 0.5);
    if (free(s.floored()) && free(s.floored().offset(0, 1, 0)) && !occupiesAt(s, p)) return s;
  }
  return new Vec3(p.x + 0.5, p.y + 2, p.z + 0.5); // above it
}
function occupiesAt(s, p) {
  return s.x + 0.3 > p.x && s.x - 0.3 < p.x + 1 && s.z + 0.3 > p.z && s.z - 0.3 < p.z + 1 && s.y + 1.8 > p.y && s.y < p.y + 1;
}

async function reach(p) {
  if (inReach(p) && !occupies(p)) return true;
  // 1. walk (pathfinder; may pillar up with dirt scaffolding)
  if (bot.entity.position.distanceTo(p) < 40) {
    try {
      bot.creative.stopFlying();
      await withTimeout(bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 3)), 8000, () => bot.pathfinder.stop());
      if (inReach(p) && !occupies(p)) {
        stats.walk++;
        return true;
      }
    } catch {}
    stats.walkFail++;
  }
  // 2. creative flight to a spot just outside the wall
  try {
    await withTimeout(bot.creative.flyTo(outsideSpot(p)), 6000);
    if (inReach(p) && !occupies(p)) {
      stats.fly++;
      return true;
    }
  } catch {}
  // 3. teleport (hybrid crutch)
  const s = outsideSpot(p);
  await cmd(`tp ${NAME} ${s.x} ${s.y} ${s.z}`);
  await bot.waitForTicks(3);
  stats.tp++;
  return inReach(p) && !occupies(p);
}

// ------------------------------------------------------------- placement planning
const DIRS = { north: new Vec3(0, 0, -1), south: new Vec3(0, 0, 1), west: new Vec3(-1, 0, 0), east: new Vec3(1, 0, 0), up: new Vec3(0, 1, 0), down: new Vec3(0, -1, 0) };
const OPP = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };
const YAW = { north: 0, west: Math.PI / 2, south: Math.PI, east: -Math.PI / 2 };
const IGNORE = new Set(['north', 'south', 'east', 'west', 'up', 'down', 'waterlogged', 'distance', 'shape', 'power', 'powered', 'occupied', 'attached', 'in_wall', 'snowy', 'signal_fire', 'lit', 'note', 'instrument', 'triggered', 'has_book', 'bottom', 'age', 'stage', 'level', 'candles', 'leaves', 'flower_amount', 'persistent', 'tip', 'thickness', 'segment_amount', 'moisture', 'hatch', 'eggs', 'pickles', 'rotation']);
const TRICKY = /^potted_|_banner$|_sign$|_hanging_sign$|^water|^lava|^bubble|^fire$|_cauldron$|^piston_head|^moving_piston|^tall_seagrass|^kelp_plant/;

function family(name) {
  for (const f of ['stairs', 'slab', 'trapdoor', 'door', 'fence_gate', 'bed', 'log', 'wall_torch', 'wall_sign', 'wall_banner', 'ladder', 'lantern', 'chest', 'barrel', 'furnace', 'smoker', 'campfire', 'button', 'carpet', 'pane', 'fence', 'wall'])
    if (name.endsWith(f) || name.includes(`_${f}`) || name === f) return f;
  return /_wood$|_stem$|^stripped_|basalt|pillar|hay_block|bone_block|chain$/.test(name) ? 'log' : 'block';
}

function matches(world, t) {
  if (!world || world.name !== t.name) return false;
  const wp = world.getProperties();
  for (const [k, v] of Object.entries(t.props)) {
    if (IGNORE.has(k)) continue;
    if (k in wp && String(wp[k]) !== String(v)) return false;
  }
  return true;
}
function mismatch(world, t) {
  if (!world || world.name !== t.name) return `name:${world?.name}`;
  const wp = world.getProperties();
  return Object.entries(t.props).filter(([k, v]) => !IGNORE.has(k) && k in wp && String(wp[k]) !== String(v)).map(([k, v]) => `${k}=${wp[k]}!${v}`).join(',');
}

const solidRef = (p) => {
  const b = bot.blockAt(p);
  if (!b || b.boundingBox !== 'block' || INTERACTABLE.has(b.name) || /door|trapdoor|chest|barrel|bed|sign|banner|cauldron|pot|campfire|lantern|pane|fence|carpet|ladder/.test(b.name)) return null;
  return b;
};

/** learned yaw rule per family: +1 = yaw toward `facing`, -1 = yaw opposite */
const yawRule = { stairs: 1, door: 1, bed: 1, fence_gate: 1, chest: -1, furnace: -1, smoker: -1, barrel: -1, campfire: -1, block: -1, trapdoor: -1 };

/**
 * Candidate placements for target t at p: [{ face: dir from reference to p, ref, yaw, pitch, cursor }].
 * Ordered by how likely they produce the right state.
 */
function plans(p, t) {
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
  } else if (fam === 'ladder' || /wall_torch|wall_sign|wall_banner|wall_head|wall_skull/.test(t.name) || (fam === 'trapdoor' && pr.facing && false)) {
    const c = refFor(pr.facing);
    if (c) out.push(c);
  } else if (fam === 'lantern') {
    const c = refFor(pr.hanging === 'true' ? 'down' : 'up');
    if (c) out.push(c);
  } else if (fam === 'door' || fam === 'bed') {
    const c = refFor('up');
    if (c) out.push({ ...c, yaw: yawFor(pr.facing), cursor: pr.hinge === 'right' ? 0.8 : 0.2 });
  } else if (fam === 'trapdoor') {
    // side click: facing = clicked face (no yaw needed); vertical click: facing = opposite of look
    const side = refFor(pr.facing);
    if (side) out.push({ ...side, cy: halfTop ? 0.8 : 0.2 });
    const v = refFor(halfTop ? 'down' : 'up');
    if (v) out.push({ ...v, yaw: YAW[OPP[pr.facing]] });
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

// hotbar management (creative inventory: items appear from nothing, like a creative player)
const hotbar = new Array(9).fill(null);
let hotIdx = 0;
async function hold(itemName) {
  const it = registry.itemsByName[itemName];
  if (!it) return false;
  let slot = hotbar.indexOf(itemName);
  if (slot < 0) {
    slot = hotIdx;
    hotIdx = (hotIdx + 1) % 8; // slot 8 keeps dirt for scaffolding
    const Item = require('prismarine-item')(registry);
    await bot.creative.setInventorySlot(36 + slot, new Item(it.id, 64));
    hotbar[slot] = itemName;
  }
  if (bot.quickBarSlot !== slot) {
    bot.setQuickBarSlot(slot);
    await bot.waitForTicks(1);
  }
  return true;
}

async function placeOnce(p, t, plan) {
  const look = eye();
  const target = p.offset(0.5, 0.5, 0.5);
  const d = target.minus(look);
  let yaw = plan.yaw ?? Math.atan2(-d.x, -d.z);
  let pitch = plan.pitch ?? Math.max(-0.7, Math.min(0.7, Math.atan2(d.y, Math.hypot(d.x, d.z))));
  await bot.look(yaw, pitch, true);
  await bot.waitForTicks(1);
  const f = plan.face;
  let delta;
  if (f.y === 0) {
    const cy = plan.cy ?? 0.5;
    const along = plan.cursor ?? 0.5;
    delta = new Vec3(f.x === 0 ? along : 0.5 + f.x * 0.5, cy, f.z === 0 ? along : 0.5 + f.z * 0.5);
  } else {
    delta = new Vec3(plan.cursor ?? 0.5, 0.5 + f.y * 0.5, 0.5);
  }
  myPlacing = true;
  try {
    await bot._placeBlockWithOptions(plan.ref, f, { forceLook: 'ignore', delta, swingArm: 'right' });
  } finally {
    myPlacing = false;
  }
}

async function clearCell(p) {
  const b = bot.blockAt(p);
  if (!b || b.boundingBox === 'empty' || b.name.includes('air')) return;
  try {
    await bot.dig(b, 'ignore');
    stats.digs++;
  } catch {
    await cmd(`setblock ${p.x} ${p.y} ${p.z} air`);
  }
}

async function rconPlace(b, why) {
  // "pretend": look at the block and swing while the server places it
  if (inReach(b.pos) || bot.entity.position.distanceTo(b.pos) < 8) {
    await bot.lookAt(b.pos.offset(0.5, 0.5, 0.5), true);
    bot.swingArm('right');
  }
  await cmd(`setblock ${b.pos.x} ${b.pos.y} ${b.pos.z} ${b.block}`);
  stats[why]++;
}

/**
 * Like a player: put a throw-away dirt block next to p (on the side the block needs to attach to),
 * so the real block has something to be placed against. The dirt is dug out right after.
 */
const tempBlocks = [];
async function tempSupport(p, t) {
  const fam = family(t.name);
  const pr = t.props;
  let dirs;
  if (pr.axis) dirs = pr.axis === 'y' ? ['up', 'down'] : pr.axis === 'x' ? ['east', 'west'] : ['north', 'south'];
  else if (fam === 'lantern') dirs = [pr.hanging === 'true' ? 'down' : 'up'];
  else if (pr.half === 'top' || pr.type === 'top') dirs = ['down', 'north', 'south', 'east', 'west'];
  else if (fam === 'ladder' || /wall_/.test(t.name)) dirs = [pr.facing];
  else dirs = ['up', 'north', 'south', 'east', 'west', 'down'];
  for (const d of dirs) {
    const q = p.minus(DIRS[d]); // cell the support goes into
    if (!free(q) || occupies(q)) continue;
    // q itself needs a neighbour to be placed against (not p)
    for (const [dn, v] of Object.entries(DIRS)) {
      const refPos = q.minus(v);
      if (refPos.equals(p)) continue;
      const ref = solidRef(refPos);
      if (!ref) continue;
      await hold('dirt');
      try {
        await placeOnce(q, { name: 'dirt', props: {} }, { ref, face: v });
        await bot.waitForTicks(1);
        if (bot.blockAt(q)?.name === 'dirt') {
          tempBlocks.push(q);
          stats.scaffold++;
          await hold(itemFor(t.name));
          return true;
        }
      } catch {}
    }
  }
  await hold(itemFor(t.name));
  return false;
}

async function dropTempSupport() {
  while (tempBlocks.length) {
    const q = tempBlocks.pop();
    if (targetAt.has(q.toString()) && targetAt.get(q.toString()).t.name === 'dirt') continue;
    if (bot.blockAt(q)?.name === 'dirt') await clearCell(q);
  }
}

async function placeByHand(b) {
  const { pos: p, t } = b;
  const fam = family(t.name);
  let world = bot.blockAt(p);
  if (matches(world, t)) return stats.already++;
  if (TRICKY.test(t.name) || t.nbt || (fam === 'door' && t.props.half === 'upper') || (fam === 'bed' && t.props.part === 'head')) {
    if (fam === 'door' || fam === 'bed') {
      // second half normally appears by itself; if not, fix it
      await sleep(50);
      if (matches(bot.blockAt(p), t)) return stats.already++;
    }
    await reach(p);
    note(fam, TRICKY.test(t.name) ? 'tricky-block' : 'nbt');
    return rconPlace(b, 'rconTricky');
  }
  const item = itemFor(t.name);
  if (!registry.itemsByName[item]) {
    note(fam, 'no-item');
    return rconPlace(b, 'rconTricky');
  }
  await reach(p);
  if (world && world.boundingBox !== 'empty' && !/air/.test(world.name)) await clearCell(p);
  let ps = plans(p, t);
  if (!ps.length && (await tempSupport(p, t))) ps = plans(p, t);
  if (!ps.length) {
    note(fam, 'no-support');
    return rconPlace(b, 'rconNoSupport');
  }
  await hold(item);
  for (let attempt = 0; attempt < Math.min(3, ps.length + 1); attempt++) {
    let plan = ps[Math.min(attempt, ps.length - 1)];
    if (attempt > 0 && plan.yaw != null && ps.length <= attempt) plan = { ...plan, yaw: plan.yaw + Math.PI }; // flip
    try {
      await placeOnce(p, t, plan);
    } catch (e) {
      note(fam, `refused`);
      continue;
    }
    await bot.waitForTicks(1);
    // stateful toggles a player would do with a second click
    world = bot.blockAt(p);
    if (world?.name === t.name && 'open' in t.props && String(world.getProperties().open) !== t.props.open) {
      try {
        await bot.activateBlock(world);
        await bot.waitForTicks(2);
      } catch {}
      world = bot.blockAt(p);
    }
    if (t.props.type === 'double' && world?.name === t.name && world.getProperties().type !== 'double') {
      try {
        await placeOnce(p, t, { ref: world, face: DIRS.up });
        await bot.waitForTicks(1);
      } catch {}
      world = bot.blockAt(p);
    }
    if (matches(world, t)) {
      if (attempt === 0) stats.hand++;
      else stats.handFixed++;
      // learn the yaw convention of this family from a success
      if (plan.yaw != null && t.props.facing in YAW && fam in yawRule) yawRule[fam] = Math.abs(((plan.yaw - YAW[t.props.facing] + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) < 0.1 ? 1 : -1;
      return;
    }
    note(fam, `wrong:${mismatch(world, t)}`.slice(0, 60));
    stats.retries++;
    // flip the learned rule once and retry
    if (plan.yaw != null && fam in yawRule) yawRule[fam] *= -1;
    await clearCell(p);
    ps.splice(0, ps.length, ...plans(p, t));
    if (!ps.length) break;
  }
  await rconPlace(b, 'rconWrong');
}

async function placeHybrid(b) {
  const p = b.pos;
  if (bot.entity.position.distanceTo(p) > 6) {
    try {
      await withTimeout(bot.pathfinder.goto(new goals.GoalNear(p.x, Math.max(y0, p.y - 4), p.z, 4)), 6000, () => bot.pathfinder.stop());
      stats.walk++;
    } catch {
      stats.walkFail++;
    }
  }
  await bot.lookAt(p.offset(0.5, 0.5, 0.5), true);
  bot.swingArm('right');
  await cmd(`setblock ${p.x} ${p.y} ${p.z} ${b.block}`);
  stats.rconTricky++;
  if (HYBRID_RATE) await sleep(1000 / HYBRID_RATE);
}

// ------------------------------------------------------------- run
const proc0 = process.cpuUsage();
const t0 = Date.now();
await hold('dirt');
const Item = require('prismarine-item')(registry);
await bot.creative.setInventorySlot(44, new Item(registry.itemsByName.dirt.id, 64));
hotbar[8] = 'dirt';
log('walking to the plot…');
const onPath = (rr) => log('  path', rr.status, rr.path.length, rr.path.at(-1) ? `${rr.path.at(-1).x},${rr.path.at(-1).y},${rr.path.at(-1).z}` : '');
const onReset = (why) => { const p = bot.entity.position; log('  reset', why, p.toString(), 'ground', bot.entity.onGround, [-1,0,1,2].map(dy => bot.blockAt(p.offset(0,dy,0))?.name + '/' + bot.blockAt(p.offset(0,dy,1))?.name).join(' '), 'ctrl', JSON.stringify(bot.controlState)); };
bot.on('path_update', onPath);
bot.on('path_reset', onReset);
try {
  await withTimeout(bot.pathfinder.goto(new goals.GoalNear(x0 + 10, y0, z0 + 22, 2)), 90000, () => bot.pathfinder.stop());
} catch (e) {
  log('walk failed:', e.message);
}
bot.off('path_update', onPath);
bot.off('path_reset', onReset);
const walkSec = (Date.now() - t0) / 1000;
log(`arrived after ${walkSec.toFixed(1)} s at ${bot.entity.position.floored()}`);

const t1 = Date.now();
let i = 0;
for (const b of list) {
  if (b.t.name === 'air') continue;
  try {
    if (MODE === 'hybrid') await placeHybrid(b);
    else {
      await placeByHand(b);
      await dropTempSupport();
    }
  } catch (e) {
    note('error', e.message.slice(0, 50));
    await cmd(`setblock ${b.pos.x} ${b.pos.y} ${b.pos.z} ${b.block}`);
    stats.rconWrong++;
  }
  if (++i % 100 === 0) log(`${i}/${list.length}`, JSON.stringify(stats), `${((i / (Date.now() - t1)) * 60000).toFixed(0)} blocks/min`);
}
const buildSec = (Date.now() - t1) / 1000;

// remove pathfinder scaffolding that is not part of the house
let cleaned = 0;
for (const key of scaffold) {
  if (targetAt.has(key)) continue;
  const [x, y, z] = key.split(',').map((s) => Number(s.replace(/[()\s]/g, '')));
  const p = new Vec3(x, y, z);
  if (bot.blockAt(p)?.name !== 'dirt') continue;
  await reach(p);
  await clearCell(p);
  cleaned++;
}

// final verification of the whole blueprint against the world
await sleep(1500);
let ok = 0;
const wrong = {};
for (const b of list) {
  if (matches(bot.blockAt(b.pos), b.t)) ok++;
  else wrong[family(b.t.name)] = (wrong[family(b.t.name)] ?? 0) + 1;
}
const cpu = process.cpuUsage(proc0);
const res = {
  mode: MODE, type: TYPE, seed: SEED, blocks: list.length, walkSec: +walkSec.toFixed(1), buildSec: +buildSec.toFixed(1),
  blocksPerMin: +((list.length / buildSec) * 60).toFixed(0), stats, scaffoldPlaced: scaffold.size, scaffoldCleaned: cleaned,
  handCorrectPct: +((100 * (stats.hand + stats.handFixed)) / list.length).toFixed(1),
  alreadyPct: +((100 * stats.already) / list.length).toFixed(1),
  finalMatchPct: +((100 * ok) / list.length).toFixed(1), finalWrong: wrong, yawRule, failures,
  cpuSec: +((cpu.user + cpu.system) / 1e6).toFixed(1), rssMB: Math.round(process.memoryUsage().rss / 1e6),
};
console.log('RESULT ' + JSON.stringify(res, null, 1));
bot.quit();
r.close();
process.exit(0);
