// Mode B spike ("Дикий"): two survival bots near a shared chest.
//   gather wood -> craft table/pickaxe -> mine stone -> craft stone tools -> armor from the shared chest
//   -> fight a zombie (summoned via RCON) -> eat -> die (/kill) -> respawn -> walk back and pick up the drops
//   -> deposit into the shared chest -> the other bot takes some of it and thanks; templated chat throughout.
//
//   node wild.mjs [--bots Heidi,Ueli] [--skip-death]
import { createRequire } from 'node:module';
import { Vec3 } from 'vec3';
import { loader as autoEat } from 'mineflayer-auto-eat';
import { makeBot, rcon, sleep, log, walkTo } from './common.mjs';

const require = createRequire(import.meta.url);
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const collectBlock = require('mineflayer-collectblock').plugin;
const pvp = require('mineflayer-pvp').plugin;
const armorManager = require('mineflayer-armor-manager');

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] ?? true : d);
const NAMES = String(opt('bots', 'Heidi,Ueli')).split(',');
const SKIP_DEATH = argv.includes('--skip-death');

// ------------------------------------------------------------------ chat templates (no LLM, zero tokens)
const LINES = {
  greet: ['Grüezi, {other}! Пойду за деревом.', 'Hoi {other}! Сегодня строим.', 'Salü {other}, как дела?'],
  greetBack: ['Grüezi {other}! Всё хорошо, иду в лес.', 'Hoi {other}! Встретимся у сундука.'],
  wood: ['Нарубил {n} брёвен.', '{n} брёвен есть, дальше верстак.'],
  craft: ['Сделал {item}.', 'Готово: {item}.'],
  stone: ['Накопал {n} булыжника.', 'Камень есть: {n} шт.'],
  armor: ['Надел броню из общего сундука.', 'Броня на мне, спасибо сундуку.'],
  zombie: ['Зомби! {other}, держись рядом.', 'Вижу зомби, иду драться.'],
  killed: ['Зомби повержен.', 'Одним зомби меньше.'],
  hurt: ['Ай! {hp} сердец осталось.'],
  eat: ['Перекус: {item}.', 'Ем {item}, силы нужны.'],
  died: ['Ой… я погиб. Вернусь за вещами.', 'Не повезло. Иду обратно за вещами.'],
  respawn: ['Я снова здесь. Иду к месту, где погиб ({x}, {z}).'],
  retrieved: ['Подобрал {n} из {m} вещей.', 'Вещи собраны: {n}/{m}.'],
  deposit: ['Положил в общий сундук: {what}.', 'В сундук: {what}. Пользуйтесь!'],
  thanks: ['Danke, {other}! Взял {n} булыжника из сундука.', 'Merci {other}, камень пригодится.'],
};
const pick = (a, seed) => a[Math.abs(seed) % a.length];
let lineSeed = 0;
function say(bot, key, vars = {}) {
  const text = pick(LINES[key], lineSeed++).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  bot.chat(text);
  log(`[${bot.username}] ${text}`);
}

// ------------------------------------------------------------------ setup
const r = await rcon();
const cmd = (c) => r.command(c);
await cmd('difficulty normal');
await cmd('gamerule advance_time false');
await cmd('time set 1000');
await cmd('gamerule keep_inventory false');
await cmd('gamerule mob_griefing false');
await cmd('weather clear');
for (const n of NAMES) {
  await cmd(`clear ${n}`).catch(() => {});
  await cmd(`gamemode survival ${n}`).catch(() => {});
}

const results = {};
const bots = [];
for (const name of NAMES) {
  const bot = await makeBot(name);
  bot.loadPlugin(pathfinder);
  bot.loadPlugin(collectBlock);
  bot.loadPlugin(pvp);
  bot.loadPlugin(armorManager);
  bot.loadPlugin(autoEat);
  bots.push(bot);
  results[name] = { phases: {} };
  await sleep(1000);
}
for (const bot of bots) {
  await cmd(`gamemode survival ${bot.username}`);
  await cmd(`clear ${bot.username}`);
  await cmd(`effect clear ${bot.username}`);
  const sp = bot.spawnPoint;
  await cmd(`tp ${bot.username} ${sp.x + 0.5 + bots.indexOf(bot)} ${sp.y} ${sp.z + 0.5}`);
}
await sleep(2000);

// shared chest next to the spawn, stocked with 2 armor sets and bread
const base = bots[0].spawnPoint.clone();
function groundAt(bot, x, z) {
  for (let y = base.y + 10; y > base.y - 10; y--) {
    const b = bot.blockAt(new Vec3(x, y, z));
    if (b && b.boundingBox === 'block' && !/leaves/.test(b.name)) return y + 1;
  }
  return base.y;
}
const chestPos = new Vec3(base.x + 3, groundAt(bots[0], base.x + 3, base.z), base.z);
await cmd(`setblock ${chestPos.x} ${chestPos.y} ${chestPos.z} chest[facing=west]`);
const stock = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'bread 16'];
for (const [i, it] of stock.entries()) {
  const [id, n = 1] = it.split(' ');
  await cmd(`item replace block ${chestPos.x} ${chestPos.y} ${chestPos.z} container.${i} with ${id} ${n}`);
}
log(`shared chest at ${chestPos}`);

// ------------------------------------------------------------------ helpers
function setupMovements(bot) {
  const m = new Movements(bot);
  m.allowParkour = true;
  m.allowSprinting = true;
  m.canDig = true; // survival bots may dig through dirt to reach stone
  bot.pathfinder.setMovements(m);
  bot.pathfinder.thinkTimeout = 4000;
  // auto-eat
  bot.autoEat.setOpts({ minHunger: 15, bannedFood: ['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish', 'chicken'] });
  bot.autoEat.enableAuto();
  bot.autoEat.on('eatStart', (o) => say(bot, 'eat', { item: o.food?.name }));
  // anti-stuck: on a burst of server position resets, cancel the current path so the task retries
  let forced = [];
  bot.on('forcedMove', () => {
    const now = Date.now();
    forced = forced.filter((t) => now - t < 600);
    forced.push(now);
    if (forced.length >= 4 && bot.pathfinder.isMoving()) {
      forced = [];
      bot.pathfinder.setGoal(null);
      bot.clearControlStates();
      bot.walkStuckCount = (bot.walkStuckCount ?? 0) + 1;
    }
  });
}

async function phase(bot, name, fn, timeoutMs = 120000) {
  const t0 = Date.now();
  let t;
  try {
    const out = await Promise.race([fn(), new Promise((_, rej) => (t = setTimeout(() => rej(new Error('phase timeout')), timeoutMs)))]);
    results[bot.username].phases[name] = { ok: true, sec: +((Date.now() - t0) / 1000).toFixed(1), ...(out ?? {}) };
  } catch (e) {
    results[bot.username].phases[name] = { ok: false, sec: +((Date.now() - t0) / 1000).toFixed(1), error: e.message.slice(0, 120) };
    log(`[${bot.username}] phase ${name} failed: ${e.message}`);
    bot.pathfinder.setGoal(null);
    bot.pvp?.forceStop?.();
  } finally {
    clearTimeout(t);
  }
}

const count = (bot, re) => bot.inventory.items().filter((i) => re.test(i.name)).reduce((s, i) => s + i.count, 0);
const itemOf = (bot, re) => bot.inventory.items().find((i) => re.test(i.name));

async function retry(n, fn) {
  let last;
  for (let i = 0; i < n; i++) {
    try {
      return await fn(i);
    } catch (e) {
      last = e;
      await sleep(500);
    }
  }
  throw last;
}

async function collectN(bot, matcher, n, maxDistance = 48) {
  const ids = Object.values(bot.registry.blocksByName).filter((b) => matcher(b.name)).map((b) => b.id);
  let got = 0;
  for (let guard = 0; got < n && guard < n * 3; guard++) {
    const positions = bot.findBlocks({ matching: ids, maxDistance, count: 8 });
    if (!positions.length) throw new Error(`nothing to collect within ${maxDistance}`);
    const blk = bot.blockAt(positions[0]);
    const before = bot.inventory.items().reduce((s, i) => s + i.count, 0);
    try {
      await bot.collectBlock.collect(blk, { ignoreNoPath: true });
    } catch (e) {
      bot.pathfinder.setGoal(null);
    }
    got += Math.max(0, bot.inventory.items().reduce((s, i) => s + i.count, 0) - before);
  }
  return got;
}

async function craft(bot, name, times = 1, table = null) {
  const item = bot.registry.itemsByName[name];
  const recipes = bot.recipesFor(item.id, null, 1, table);
  if (!recipes.length) throw new Error(`no recipe for ${name}${table ? '' : ' (without table)'}`);
  await bot.craft(recipes[0], times, table);
}

async function placeTable(bot) {
  await bot.equip(itemOf(bot, /^crafting_table$/), 'hand');
  const p = bot.entity.position.floored();
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2]]) {
    const target = p.offset(dx, 0, dz);
    const below = bot.blockAt(target.offset(0, -1, 0));
    const at = bot.blockAt(target);
    if (below?.boundingBox === 'block' && at?.boundingBox === 'empty') {
      try {
        await bot.placeBlock(below, new Vec3(0, 1, 0));
        return bot.blockAt(target);
      } catch {}
    }
  }
  throw new Error('no spot for the crafting table');
}

async function withTable(bot, fn) {
  let table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 4 });
  if (!table) {
    if (!itemOf(bot, /^crafting_table$/)) await craft(bot, 'crafting_table');
    table = await placeTable(bot);
  }
  await fn(table);
  // take the table along (like a player would)
  try {
    await bot.collectBlock.collect(table);
  } catch {}
}

async function goNear(bot, pos, range = 2, timeout = 40000) {
  const res = await walkTo(bot, new goals.GoalNear(pos.x, pos.y, pos.z, range), { timeout, retries: 8 });
  if (!res.ok) throw new Error(`walk: ${res.error}`);
}

// ------------------------------------------------------------------ scenario
async function scenario(bot, other, { first }) {
  const R = results[bot.username];
  setupMovements(bot);
  bot.on('health', () => {
    if (bot.health < 8 && bot.health > 0 && !bot._hurtSaid) {
      bot._hurtSaid = true;
      say(bot, 'hurt', { hp: Math.ceil(bot.health / 2) });
      setTimeout(() => (bot._hurtSaid = false), 10000);
    }
  });

  await phase(bot, 'greet', async () => {
    const heard = new Promise((res) => {
      const on = (user, msg) => {
        if (user === other.username && msg.includes(bot.username)) {
          bot.off('chat', on);
          res();
        }
      };
      bot.on('chat', on);
    });
    if (first) say(bot, 'greet', { other: other.username });
    await Promise.race([heard, sleep(15000)]);
    if (!first) say(bot, 'greetBack', { other: other.username });
  }, 20000);

  await phase(bot, 'wood', async () => {
    const n = await collectN(bot, (s) => /_log$/.test(s) && !/stripped/.test(s), 4);
    say(bot, 'wood', { n: count(bot, /_log$/) });
    return { logs: count(bot, /_log$/) };
  }, 180000);

  await phase(bot, 'craftWood', async () => {
    const log = itemOf(bot, /_log$/);
    const planks = log.name.replace(/_log$/, '_planks');
    await craft(bot, planks, Math.min(4, count(bot, /_log$/)));
    await craft(bot, 'stick', 2);
    await withTable(bot, async (table) => {
      await craft(bot, 'wooden_pickaxe', 1, table);
    });
    say(bot, 'craft', { item: 'деревянная кирка' });
    return { planks: count(bot, /_planks$/), sticks: count(bot, /^stick$/) };
  }, 60000);

  await phase(bot, 'stone', async () => {
    const n = await collectN(bot, (s) => s === 'stone' || s === 'cobblestone' || s === 'andesite' || s === 'diorite' || s === 'granite', 5, 40);
    say(bot, 'stone', { n: count(bot, /^cobblestone$|^andesite$|^diorite$|^granite$|^cobbled/) });
    return { cobble: count(bot, /^cobblestone$/) };
  }, 240000);

  await phase(bot, 'craftStone', async () => {
    if (count(bot, /^stick$/) < 3) await craft(bot, 'stick', 1);
    await withTable(bot, async (table) => {
      await craft(bot, 'stone_pickaxe', 1, table);
      if (count(bot, /^cobblestone$/) >= 2) await craft(bot, 'stone_sword', 1, table);
      else await craft(bot, 'wooden_sword', 1, table);
    });
    say(bot, 'craft', { item: itemOf(bot, /stone_sword/) ? 'каменный меч и кирка' : 'кирка и деревянный меч' });
  }, 60000);

  await phase(bot, 'armor', async () => {
    await goNear(bot, chestPos, 2);
    const chest = await bot.openContainer(bot.blockAt(chestPos));
    for (const n of ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots']) {
      const it = chest.containerItems().find((i) => i.name === n);
      if (it) await chest.withdraw(it.type, null, 1);
    }
    const bread = chest.containerItems().find((i) => i.name === 'bread');
    if (bread) await chest.withdraw(bread.type, null, Math.min(6, bread.count));
    chest.close();
    await bot.armorManager.equipAll();
    await sleep(500);
    say(bot, 'armor');
    return { armor: [5, 6, 7, 8].map((s) => bot.inventory.slots[s]?.name ?? '-') };
  }, 60000);

  await phase(bot, 'fight', async () => {
    const p = bot.entity.position;
    await cmd(`summon zombie ${p.x + 5} ${p.y + 1} ${p.z} {equipment:{head:{id:"minecraft:leather_helmet",count:1}},Tags:["spike"],PersistenceRequired:1b}`);
    await sleep(800);
    const z = bot.nearestEntity((e) => e.name === 'zombie' && e.position.distanceTo(bot.entity.position) < 12);
    if (!z) throw new Error('zombie not found');
    say(bot, 'zombie', { other: other.username });
    const sword = itemOf(bot, /_sword$/);
    if (sword) await bot.equip(sword, 'hand');
    const dead = new Promise((res) => {
      const on = (e) => {
        if (e.id === z.id) {
          bot.off('entityDead', on);
          res();
        }
      };
      bot.on('entityDead', on);
    });
    const hp0 = bot.health;
    bot.pvp.attack(z);
    await Promise.race([dead, sleep(45000).then(() => { throw new Error('zombie still alive'); })]);
    bot.pvp.stop();
    say(bot, 'killed');
    return { hpLost: +(hp0 - bot.health).toFixed(1) };
  }, 60000);

  await phase(bot, 'eat', async () => {
    // burn hunger quickly so auto-eat has to kick in
    await cmd(`effect give ${bot.username} minecraft:hunger 20 120 true`);
    const t0 = Date.now();
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error(`not eaten, food=${bot.food}`)), 50000);
      bot.autoEat.once('eatFinish', () => {
        clearTimeout(to);
        res();
      });
    });
    await cmd(`effect clear ${bot.username} minecraft:hunger`);
    return { food: bot.food, waitedSec: +((Date.now() - t0) / 1000).toFixed(1) };
  }, 60000);

  if (!SKIP_DEATH) {
    await phase(bot, 'deathAndRetrieve', async () => {
      const deathPos = bot.entity.position.clone();
      const before = bot.inventory.items().reduce((s, i) => s + i.count, 0) + [5, 6, 7, 8].filter((s) => bot.inventory.slots[s]).length;
      const died = new Promise((res) => bot.once('death', res));
      const spawned = new Promise((res) => bot.once('death', () => bot.once('spawn', res)));
      await cmd(`kill ${bot.username}`);
      await died;
      say(bot, 'died');
      await spawned;
      await sleep(1500);
      say(bot, 'respawn', { x: Math.round(deathPos.x), z: Math.round(deathPos.z) });
      const tWalk = Date.now();
      await goNear(bot, deathPos, 1, 60000);
      // pick up everything lying around
      let picked = 0;
      bot.on('playerCollect', (collector) => collector === bot.entity && picked++);
      for (let pass = 0; pass < 6; pass++) {
        const items = Object.values(bot.entities).filter((e) => e.name === 'item' && e.position.distanceTo(deathPos) < 10);
        if (!items.length) break;
        for (const it of items) {
          await walkTo(bot, new goals.GoalBlock(Math.floor(it.position.x), Math.floor(it.position.y), Math.floor(it.position.z)), { timeout: 8000, retries: 2 });
          await sleep(200);
        }
      }
      await sleep(1000);
      await bot.armorManager.equipAll().catch(() => {});
      const after = bot.inventory.items().reduce((s, i) => s + i.count, 0) + [5, 6, 7, 8].filter((s) => bot.inventory.slots[s]).length;
      say(bot, 'retrieved', { n: after, m: before });
      return { itemsBefore: before, itemsAfter: after, pickups: picked, walkBackSec: +((Date.now() - tWalk) / 1000).toFixed(1) };
    }, 120000);
  }

  await phase(bot, 'deposit', async () => {
    await goNear(bot, chestPos, 2);
    const chest = await bot.openContainer(bot.blockAt(chestPos));
    const put = [];
    for (const it of bot.inventory.items()) {
      if (/cobblestone|_log$|_planks$|andesite|diorite|granite|rotten_flesh|dirt/.test(it.name)) {
        await chest.deposit(it.type, null, it.count);
        put.push(`${it.count}×${it.name}`);
      }
    }
    chest.close();
    say(bot, 'deposit', { what: put.join(', ') || 'ничего' });
    bot.emit('deposited');
    return { deposited: put };
  }, 60000);

  // sharing: the second bot waits for the first one's deposit and takes some cobblestone
  if (!first) {
    await phase(bot, 'share', async () => {
      await new Promise((res) => (other._deposited ? res() : other.once('deposited', res)));
      await goNear(bot, chestPos, 2);
      const chest = await bot.openContainer(bot.blockAt(chestPos));
      const cob = chest.containerItems().find((i) => i.name === 'cobblestone');
      const n = cob ? Math.min(3, cob.count) : 0;
      if (cob) await chest.withdraw(cob.type, null, n);
      chest.close();
      say(bot, 'thanks', { other: other.username, n });
      return { took: n };
    }, 120000);
  } else bot._deposited = true;
  R.stuckRecoveries = bot.walkStuckCount ?? 0;
}

const t0 = Date.now();
const cpu0 = process.cpuUsage();
const memSamples = [];
const memTimer = setInterval(() => memSamples.push(process.memoryUsage().rss), 2000);
const [a, b] = bots;
if (b) {
  a.once('deposited', () => (a._deposited = true));
  await Promise.all([scenario(a, b, { first: true }), sleep(3000).then(() => scenario(b, a, { first: false }))]);
} else await scenario(a, a, { first: true });
clearInterval(memTimer);
const cpu = process.cpuUsage(cpu0);
const wall = (Date.now() - t0) / 1000;
console.log('RESULT ' + JSON.stringify({
  bots: NAMES.length, wallSec: +wall.toFixed(0), cpuSec: +((cpu.user + cpu.system) / 1e6).toFixed(1),
  cpuPctOfOneCore: +((100 * (cpu.user + cpu.system)) / 1e6 / wall).toFixed(1),
  rssMaxMB: Math.round(Math.max(...memSamples) / 1e6), results,
}, null, 1));
await cmd('kill @e[type=zombie,tag=spike]');
for (const bot of bots) bot.quit();
r.close();
process.exit(0);
