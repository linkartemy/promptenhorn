// Promptenhorn wild mode ("Дикий"): a survival colony on its own Paper server, driven by Claude Code chats.
//
//   node wild/colony.mjs                         (production: wild-server/, wild-state.json, port 7785)
//   WILD_CONFIG=.dev/wild-config.json node wild/colony.mjs   (development)
//
// Receives the same (privacy-reduced) hook events as the city bridge — the bridge forwards them here when
// the setting "Дикий режим" is on — and maps each active chat to a colonist bot. Colonists are scripted
// (bots/wild/colonist.mjs); this process keeps the shared state: base layout, storage snapshot, market
// and credits, construction projects, chat rate limits. Zero LLM tokens.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { Rcon, RconDisconnected } from '../bridge/rcon.mjs';
import path from 'node:path';
import { loadConfig, ROOT } from './config.mjs';
import { Chatter } from './lines.mjs';
import { sellPrice, buyPrice, itemFor } from './economy.mjs';
import { Colonist } from '../bots/wild/colonist.mjs';
import { Builder, planProject, PROJECT_LABEL } from '../bots/wild/builder.mjs';
import { statusPage } from './page.mjs';
import * as I from '../bots/wild/items.mjs';
import { t, setLanguage } from '../bridge/i18n.mjs';
import { itemName, mobName } from './lines.mjs';

// npm packages live in bots/node_modules (installed by `npm install` in bots/)
const { Vec3 } = createRequire(new URL('../bots/package.json', import.meta.url))('vec3');

const cfg = loadConfig();
const log = (...a) => {
  const line = `${new Date().toLocaleTimeString()} ${a.join(' ')}`;
  console.log(line);
  logRing.push(line);
  if (logRing.length > 200) logRing.shift();
};
const logRing = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Colonist names: ASCII (Minecraft usernames), Swiss flavour. A chat keeps its name across restarts.
const NAMES = ['Heidi', 'Ueli', 'Vreni', 'Sepp', 'Beat', 'Urs', 'Reto', 'Anneli', 'Housi', 'Mia', 'Luca', 'Noemi', 'Fritz', 'Trudi', 'Koebi', 'Jonas'];

// ------------------------------------------------------------------ state

const fresh = () => ({ version: 1, colony: null, credits: 0, earned: 0, spent: 0, sold: {}, bought: {}, stats: {}, projects: [], sessions: {}, names: {}, events: [] });
let state = fresh();
if (fs.existsSync(cfg.stateFile)) state = { ...fresh(), ...JSON.parse(fs.readFileSync(cfg.stateFile, 'utf8')) };
let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeState();
  }, 2000);
}
function writeState() {
  try {
    fs.writeFileSync(cfg.stateFile + '.tmp', JSON.stringify(state, null, 1));
    fs.renameSync(cfg.stateFile + '.tmp', cfg.stateFile);
  } catch (e) {
    log('state save failed', e.message);
  }
}
function event(key, params = {}) {
  state.events.push({ t: Date.now(), key, params });
  if (state.events.length > 80) state.events.shift();
  save();
}

// ------------------------------------------------------------------ RCON

const rcon = new Rcon({ host: '127.0.0.1', port: cfg.rconPort, password: cfg.rconPassword });
async function ensureRcon() {
  while (!rcon.connected) {
    try {
      await rcon.connect();
      log(`RCON connected (port ${cfg.rconPort})`);
    } catch (e) {
      log(`waiting for the wild server (RCON ${cfg.rconPort}): ${e.message}`);
      await sleep(5000);
    }
  }
}
async function cmd(c) {
  try {
    if (!rcon.connected) await ensureRcon();
    return await rcon.command(c);
  } catch (e) {
    if (e instanceof RconDisconnected) {
      await ensureRcon();
      return rcon.command(c);
    }
    throw e;
  }
}

// ------------------------------------------------------------------ colony object (what colonists see)

const V = (o) => (o ? new Vec3(o.x, o.y, o.z) : null);
const deathLog = [];
// Settings shared with the city bridge (config.json, read-only here; wild-config.json wins):
// language, colonistsMax, colonistsCaretaker, chatter (feature toggle), chatterFrequency.
const settingsNow = { colonistsMax: cfg.colonistsMax ?? cfg.maxColonists, caretaker: false, chatter: true, frequency: 'normal', language: 'en' };
function readSharedSettings() {
  let city = {};
  try {
    city = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  } catch {}
  const pick = (k, d) => cfg[k] ?? city[k] ?? d;
  settingsNow.colonistsMax = Math.max(0, Math.min(16, Number(pick('colonistsMax', cfg.maxColonists)) || 0));
  settingsNow.caretaker = pick('colonistsCaretaker', 'off') === 'on' || pick('colonistsCaretaker', false) === true;
  settingsNow.chatter = cfg.chatter ?? city.features?.chatter ?? city.chatter ?? true;
  settingsNow.frequency = pick('chatterFrequency', 'normal');
  settingsNow.language = pick('language', 'en');
  setLanguage(settingsNow.language);
  const mult = { rare: 3, normal: 1, often: 0.5 }[settingsNow.frequency] ?? 1;
  chatter.globalGapMs = cfg.chatCooldownSec * 1000 * mult;
  chatter.colonistGapMs = cfg.colonistCooldownSec * 1000 * mult;
  chatter.enabled = settingsNow.chatter !== false;
}

const chatter = new Chatter({
  globalGapMs: cfg.chatCooldownSec * 1000,
  colonistGapMs: cfg.colonistCooldownSec * 1000,
  send: (c, text) => {
    if (c?.bot && c.running && !c.dead) c.bot.chat(text);
    else cmd(`tellraw @a ${JSON.stringify({ text: `<Märt> ${text}`, color: 'gold' })}`).catch(() => {});
    log(`💬 ${c?.name ?? 'Märt'}: ${text}`);
  },
});

const colonists = new Map(); // name -> Colonist
const blacklist = new Map(); // "x,y,z" -> until
let marketLock = null;
let furnaceLock = null;
const storageSnap = new Map(); // "x,y,z" -> [{name,count}]
const gifts = new Map(); // giver name -> gift
const scarce = new Map(); // kind -> until

const colony = {
  cfg,
  log,
  ready: false,
  builder: null,
  get base() {
    const col = state.colony;
    return col && {
      center: V(col.center), storage: Object.fromEntries(Object.entries(col.storage).map(([k, v]) => [k, V(v)])), market: V(col.market), table: V(col.table),
      furnace: V(col.furnace), beds: col.beds.map(V), campfire: V(col.campfire), farm: col.farm ?? null,
    };
  },
  t: (key, params) => t(key, params),
  rcon: (c) => cmd(c),
  say: (c, key, vars, opts) => chatter.say(c, key, vars, opts),
  stat(key, n) {
    state.stats[key] = (state.stats[key] ?? 0) + n;
    save();
  },
  home() {
    return V(state.colony.center).offset(0.5, 1, 3.5); // south of the campfire, never on it
  },
  isColonist: (name) => colonists.has(name),
  isProtected(p) {
    for (const b of protectedBoxes()) if (p.x >= b[0] && p.x <= b[3] && p.y >= b[1] && p.y <= b[4] && p.z >= b[2] && p.z <= b[5]) return true;
    return false;
  },
  outsideBorder(p) {
    const c = state.colony?.center;
    if (!c) return false;
    const r = cfg.worldBorder / 2 - 8;
    return Math.abs(p.x - c.x) > r || Math.abs(p.z - c.z) > r;
  },
  blacklist(p) {
    blacklist.set(`${p.x},${p.y},${p.z}`, Date.now() + 120000);
  },
  isBlacklisted(p) {
    return (blacklist.get(`${p.x},${p.y},${p.z}`) ?? 0) > Date.now();
  },
  noteScarce(kind) {
    scarce.set(kind, Date.now() + 180000);
  },

  // mines: each colonist has its own staircase mine, remembered across restarts
  mineState(c) {
    return state.colony?.mines?.[c.name] ?? null;
  },
  setMineState(c, m) {
    state.colony.mines ??= {};
    if (m) state.colony.mines[c.name] = m;
    else delete state.colony.mines[c.name];
    save();
  },
  mineEntrances(c) {
    return Object.entries(state.colony?.mines ?? {}).filter(([n]) => n !== c.name).map(([, m]) => m.entrance);
  },
  mineIndex(c) {
    state.colony.mineOrder ??= [];
    if (!state.colony.mineOrder.includes(c.name)) state.colony.mineOrder.push(c.name);
    return state.colony.mineOrder.indexOf(c.name);
  },
  /** What the miner digs for now: iron while gear is missing, coal for torches and smelting, else stone. */
  mineTarget(c) {
    const pick = I.toolTier(c.bot, 'pickaxe');
    if (pick < 1) return 'stone';
    const coal = this.storageCount(/^coal$|^charcoal$/) + I.count(c.bot, /^coal$/);
    if (coal < 8) return 'coal';
    if (colonyNeedsIron() || this.storageCount(/^raw_iron$|^iron_ingot$/) < 16) return 'iron';
    return Math.random() < 0.5 ? 'iron' : 'stone';
  },

  // storage ------------------------------------------------------------
  /** Chests by category: ores, food, wood, stone, misc. */
  storagePos(cat) {
    const st = this.base.storage;
    return st[cat] ?? st.misc;
  },
  storageCategory(name) {
    if (/^raw_|_ingot$|^coal$|^charcoal$|^diamond$|^emerald$|^lapis_lazuli$|^redstone$|^quartz$|_nugget$/.test(name)) return 'ores';
    if (I.FOOD[name] || /^wheat$|^wheat_seeds$|^egg$|^sugar$|^bone_meal$|^golden_apple$/.test(name)) return 'food';
    if (I.LOG.test(name) || I.PLANKS.test(name) || /^stick$|_sapling$|_wood$/.test(name)) return 'wood';
    if (I.STONE_DROP.test(name) || /^(stone|andesite|diorite|granite|tuff|deepslate|dirt|gravel|sand|flint|calcite)$/.test(name)) return 'stone';
    return 'misc';
  },
  categoryForWant(key) {
    if (!key.startsWith('/')) return this.storageCategory(key);
    const re = new RegExp(key.slice(1, -1));
    const sample = ['oak_log', 'cobblestone', 'iron_ingot', 'raw_iron', 'coal', 'bread', 'cooked_beef', 'wheat_seeds', 'stone_pickaxe', 'stone_sword', 'stone_axe', 'stone_hoe', 'torch', 'shield', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'].find((n) => re.test(n));
    return sample ? this.storageCategory(sample) : 'misc';
  },
  /** Can storage fill some of this kit gap? */
  storageCanFill(gap) {
    for (const k of Object.keys(gap)) {
      if (['pickaxe', 'sword', 'axe', 'hoe'].includes(k) && this.storageCount(new RegExp(`_${k}$`)) > 0) return true;
      if (k === 'food' && this.storageCount(/^cooked_|^bread$|^baked_potato$|^apple$|^carrot$/) > 0) return true;
      if (k === 'torch' && this.storageCount('torch') > 0) return true;
      if (k === 'shield' && this.storageCount('shield') > 0) return true;
      if (k.startsWith('armor:')) {
        const part = { head: 'helmet', torso: 'chestplate', legs: 'leggings', feet: 'boots' }[k.slice(6)];
        if (this.storageCount(new RegExp(`_${part}$`)) > 0) return true;
      }
    }
    return false;
  },
  noteStorage(pos, items) {
    storageSnap.set(`${pos.x},${pos.y},${pos.z}`, items.map((i) => ({ name: i.name, count: i.count })));
  },
  storageCount(re) {
    let n = 0;
    for (const items of storageSnap.values()) for (const i of items) if (typeof re === 'string' ? i.name === re : re.test(i.name)) n += i.count;
    return n;
  },
  storageHas(short) {
    if (short.logs && this.storageCount(I.LOG) >= short.logs) return true;
    if (short.stone && this.storageCount(I.STONE_DROP) >= short.stone) return true;
    if (short.iron_ingot && this.storageCount('iron_ingot') >= 1) return true;
    return false;
  },
  /** How many of `name` the storage still wants before surplus is sold. */
  storageRoom(name) {
    for (const [re, n] of I.STORAGE_RESERVE) {
      if (!re.test(name)) continue;
      // iron is not sold while colonists still lack iron gear
      if (/iron/.test(name) && colonyNeedsIron()) return Infinity;
      return Math.max(0, n - this.storageCount(re));
    }
    return sellPrice(name) > 0 ? 0 : 64; // unknown, unsellable stuff is kept in storage
  },
  sellable: (name) => sellPrice(name) > 0,
  async lockMarket(c) {
    while (marketLock && marketLock !== c.name) await sleep(300);
    marketLock = c.name;
    return () => {
      if (marketLock === c.name) marketLock = null;
    };
  },
  async lockFurnace(c) {
    const t0 = Date.now();
    while (furnaceLock && furnaceLock !== c.name && Date.now() - t0 < 60000) await sleep(500);
    furnaceLock = c.name;
    return () => {
      if (furnaceLock === c.name) furnaceLock = null;
    };
  },
  furnaceBlock(bot) {
    const p = this.base.furnace;
    const b = bot.blockAt(p);
    if (b && b.name === 'furnace') return b;
    return bot.findBlock({ matching: bot.registry.blocksByName.furnace.id, maxDistance: 12, point: this.base.center }) ?? null;
  },
  tableBlock(bot) {
    const p = this.base.table;
    const b = bot.blockAt(p);
    if (b && b.name === 'crafting_table') return b;
    return bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 12, point: this.base.center }) ?? null;
  },
  /** Whoever is at base: empties the furnace output into the bag (it is deposited with the rest). */
  async serviceFurnace(c) {
    const bot = c.bot;
    const fb = this.furnaceBlock(bot);
    if (!fb || bot.entity.position.distanceTo(fb.position) > 12 || furnaceLock) return;
    const release = await this.lockFurnace(c);
    let f;
    try {
      if (bot.entity.position.distanceTo(fb.position) > 4) await c.goNear(fb.position, 2, { timeout: 10000 });
      f = await bot.openFurnace(bot.blockAt(fb.position));
      if (f.outputItem()) await f.takeOutput();
      // cook raw food we carry while we are here
      const raw = I.itemsOf(bot).find((i) => I.RAW_FOOD[i.name]);
      if (raw && !f.inputItem()) {
        const coal = I.find(bot, /^(coal|charcoal)$/) ?? I.find(bot, I.PLANKS);
        if (!f.fuelItem() && coal) await f.putFuel(coal.type, null, 1);
        if (f.fuelItem() || coal) await f.putInput(raw.type, null, raw.count);
      }
    } finally {
      try {
        f?.close();
      } catch {}
      release();
    }
  },

  // beds ------------------------------------------------------------------
  bedFor(c) {
    const beds = state.colony?.bedsPlaced ?? [];
    if (!beds.length || !c.bot) return null;
    const idx = [...colonists.keys()].indexOf(c.name) % beds.length;
    const p = V(beds[idx]);
    return p;
  },
  bedMissing(c, p) {
    state.colony.bedsPlaced = (state.colony.bedsPlaced ?? []).filter((b) => !(b.x === p.x && b.y === p.y && b.z === p.z));
    save();
  },
  placeJob(c) {
    const j = state.colony?.placeJobs?.find((x) => x.who === c.name);
    if (!j) return null;
    if (!I.find(c.bot, j.item)) {
      state.colony.placeJobs = state.colony.placeJobs.filter((x) => x !== j);
      return null;
    }
    return { item: j.item, spot: V(j.spot), done: () => (state.colony.placeJobs = state.colony.placeJobs.filter((x) => x !== j)) };
  },
  onPlacedAtBase(c, item) {
    if (/_bed$/.test(item)) {
      const j = state.colony.placeJobs?.find((x) => x.who === c.name && x.item === item);
      if (j) {
        state.colony.bedsPlaced = [...(state.colony.bedsPlaced ?? []), j.spot];
        state.colony.placeJobs = state.colony.placeJobs.filter((x) => x !== j);
        chatter.say(c, 'bedPlaced', {});
        event('wild.ev.bed', { name: c.name });
      }
    }
    if (item === 'furnace') {
      chatter.say(c, 'furnace', {});
      event('wild.ev.furnace', { name: c.name });
    }
    save();
  },

  // social ------------------------------------------------------------------
  wantsGift(giver) {
    const g = gifts.get(giver.name);
    if (g && Date.now() - g.at < 60000) return g;
    if (g) gifts.delete(giver.name);
    if (giver.helper || giver.mode !== 'work') return null;
    for (const other of colonists.values()) {
      if (other === giver || !other.running || other.dead || !other.bot?.entity) continue;
      if (other.bot.entity.position.distanceTo(giver.bot.entity.position) > 48) continue;
      for (const kind of ['pickaxe', 'sword', 'axe']) {
        if (I.toolTier(other.bot, kind) >= 0) continue;
        const mine = I.itemsOf(giver.bot).filter((i) => i.name.endsWith('_' + kind));
        if (mine.length < 2) continue;
        mine.sort((a, b) => I.tierOf(a.name) - I.tierOf(b.name));
        const gift = { to: other, item: mine[0].name, at: Date.now() };
        gifts.set(giver.name, gift);
        return gift;
      }
    }
    return null;
  },
  giftDone(giver, gift, ok) {
    gifts.delete(giver.name);
    if (ok) {
      this.stat('gifts', 1);
      event('wild.ev.gift', { name: giver.name, other: gift.to.name, item: gift.item });
    }
  },
  colleagueLacks(self, kind) {
    for (const o of colonists.values()) if (o !== self && o.running && !o.dead && o.bot?.entity && I.toolTier(o.bot, kind) < 0) return true;
    return false;
  },
  callForHelp(victim, target) {
    let best = null;
    for (const o of colonists.values()) {
      if (o === victim || !o.running || o.dead || o.inCombat || o.retreating || !o.bot?.entity) continue;
      const d = o.bot.entity.position.distanceTo(victim.bot.entity.position);
      if (d < 40 && (!best || d < best.d)) best = { o, d };
    }
    if (!best) return;
    chatter.say(best.o, 'comeHelp', { other: victim.name }, { urgent: true });
    best.o.pendingThreat = target;
    best.o.interrupt('combat');
  },
  async recall(c) {
    const h = this.home();
    await cmd(`tp ${c.name} ${h.x} ${h.y} ${h.z}`);
    this.stat('recalls', 1);
  },
  onDeath(c, pos) {
    deathLog.push({ t: Date.now(), name: c.name, pos: pos.floored().toArray(), cause: null });
  },
  onDeathCause(c, cause, killer, pos) {
    const d = [...deathLog].reverse().find((x) => x.name === c.name && !x.cause);
    if (d) {
      d.cause = cause;
      d.killer = killer || null;
    }
    state.stats[`death_${cause}`] = (state.stats[`death_${cause}`] ?? 0) + 1;
    event('wild.ev.diedCause', { name: c.name, cause, killer: killer || '', x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) });
  },
  onRecovered(c, n, rec) {
    event('wild.ev.recovered', { name: c.name, n, sec: Math.round((Date.now() - rec.at) / 1000) });
    this.stat('recoveries', 1);
  },
  onCrafted(c, item) {
    event('wild.ev.crafted', { name: c.name, item });
    const iron = /^iron_/.test(item);
    chatter.say(c, iron ? 'craftedIron' : 'crafted', { item: I.ru(item) }, { keyCooldownMs: 5000 });
    if (iron && ['head', 'torso', 'legs', 'feet'].every((s) => I.armorTier(I.equipped(c.bot, s)?.name ?? '') >= 3)) chatter.say(c, 'armorDone', {}, { urgent: true });
    save();
  },
  async onSpawned(c) {
    if (!state.colony || !c.bot?.entity) return;
    if (c.bot.entity.position.distanceTo(this.home()) > 64) {
      const h = this.home();
      await cmd(`tp ${c.name} ${h.x} ${h.y} ${h.z}`);
    }
  },
  onColonistGone(c) {
    if (colonists.get(c.name) === c) {
      colonists.delete(c.name);
      gone.push({ name: c.name, m: { ...c.metrics }, stats: { ...c.stats } });
    }
    if (this.builder === c) this.builder = null;
  },
  colonistLeft(c) {
    event('wild.ev.left', { name: c.name });
  },

  // economy ------------------------------------------------------------------
  gatherTarget(c) {
    const bot = c.bot;
    const pick = I.toolTier(bot, 'pickaxe');
    if (pick < 0) return 'wood';
    const now = Date.now();
    const ok = (k) => (scarce.get(k) ?? 0) < now;
    const logs = this.storageCount(I.LOG);
    if (c.helper) return logs < 24 || pick < 0 ? 'wood' : 'stone';
    const coal = this.storageCount(/^coal$|^charcoal$/) + I.count(bot, /^coal$/);
    const iron = this.storageCount(/^raw_iron$|^iron_ingot$/);
    if (logs < 12 && ok('wood')) return 'wood';
    if (pick >= 1 && coal < 6 && ok('coal')) return 'coal';
    if (pick >= 1 && (colonyNeedsIron() || iron < 12) && ok('iron')) return 'iron';
    // the house needs money: the job that pays best per minute
    const pref = c.jobPreference ?? 'any';
    if (pref === 'wood' && ok('wood')) return 'wood';
    if (pick >= 1 && ok('iron') && Math.random() < 0.5) return 'iron';
    if (pick >= 0 && ok('coal') && Math.random() < 0.4) return 'coal';
    return ok('wood') && Math.random() < 0.6 ? 'wood' : 'stone';
  },
  async buyFood(c) {
    const price = buyPriceFood();
    if (state.credits < price * 6) return false;
    await c.goHome(4);
    await c.goNear(this.base.market, 2, { timeout: 20000 });
    state.credits -= price * 6;
    state.spent += price * 6;
    state.bought.bread = (state.bought.bread ?? 0) + 6;
    await cmd(`give ${c.name} bread 6`);
    chatter.say(c, 'bought', { what: t('wild.what.bread', { n: 6 }), price: (price * 6).toFixed(1) });
    save();
    return true;
  },
  isBuildItem: (name) => !!builder?.carrying(name),
  projectReady: () => !!builder?.ready(),
  runBuild: (c) => builder.run(c),
};

function buyPriceFood() {
  return 1.0; // bread from the valley
}

function colonyNeedsIron() {
  for (const c of colonists.values()) {
    if (c.helper || !c.bot?.entity) continue;
    if (I.toolTier(c.bot, 'pickaxe') < 2 || I.toolTier(c.bot, 'sword') < 2) return true;
    for (const s of ['head', 'torso', 'legs', 'feet']) if (I.armorTier(I.equipped(c.bot, s)?.name ?? '') < 3) return true;
  }
  return false;
}

function protectedBoxes() {
  const out = [];
  const col = state.colony;
  if (!col) return out;
  const c = col.center;
  out.push([c.x - 9, c.y - 3, c.z - 9, c.x + 9, c.y + 24, c.z + 9]);
  if (col.farm) out.push([col.farm.x1 - 1, col.farm.y - 2, col.farm.z1 - 1, col.farm.x2 + 1, col.farm.y + 6, col.farm.z2 + 1]);
  for (const p of state.projects) if (p.box) out.push(p.box);
  return out;
}

// ------------------------------------------------------------------ founding the colony

async function locateSite() {
  if (cfg.seedSite) return { x: cfg.seedSite[0], z: cfg.seedSite[1] };
  for (const biome of ['taiga', 'plains', 'forest', 'meadow', 'birch_forest', 'snowy_taiga', 'old_growth_spruce_taiga']) {
    const out = await cmd(`locate biome minecraft:${biome}`);
    const m = out.match(/at \[(-?\d+), [~\d-]+, (-?\d+)\] \((\d+) blocks away\)/);
    if (m && Number(m[3]) < 800) {
      log(`colony site: ${biome} at ${m[1]}, ${m[2]}`);
      return { x: Number(m[1]), z: Number(m[2]), biome };
    }
  }
  return { x: 0, z: 0 };
}

function surfaceAt(bot, x, z, yTop, yBottom) {
  for (let y = yTop; y > yBottom; y--) {
    const b = bot.blockAt(new Vec3(x, y, z));
    if (!b) return null;
    if (/water|lava/.test(b.name)) return { y, water: true };
    if (b.boundingBox !== 'block' || /leaves|_log$|snow$|^snow$|vine|bamboo|mushroom_block/.test(b.name)) continue;
    return { y, water: false };
  }
  return null;
}

async function found(first) {
  const site = await locateSite();
  const bot = first.bot;
  // the surveyor flies in as a spectator (no falls, no mobs while the site is chosen)
  await cmd(`gamemode spectator ${first.name}`);
  await cmd(`time set 1000`);
  await cmd(`spreadplayers ${site.x} ${site.z} 0 1 false ${first.name}`);
  await sleep(3000);
  await bot.waitForChunksToLoad?.().catch(() => {});
  await sleep(1500);
  const p0 = bot.entity.position.floored();
  // choose the flattest dry 17x17 square near the landing point
  let best = null;
  for (let dx = -24; dx <= 24; dx += 4)
    for (let dz = -24; dz <= 24; dz += 4) {
      const cx = p0.x + dx;
      const cz = p0.z + dz;
      const ys = [];
      let water = 0;
      let missing = false;
      for (let x = -8; x <= 8; x += 2)
        for (let z = -8; z <= 8; z += 2) {
          const s = surfaceAt(bot, cx + x, cz + z, p0.y + 24, p0.y - 24);
          if (!s) {
            missing = true;
            break;
          }
          ys.push(s.y);
          if (s.water) water++;
        }
      if (missing || !ys.length) continue;
      ys.sort((a, b) => a - b);
      const spread = ys[ys.length - 1] - ys[0];
      const score = spread + water * 3 + Math.hypot(dx, dz) / 8;
      if (!best || score < best.score) best = { cx, cz, y: ys[Math.floor(ys.length / 2)], score, spread, water };
    }
  if (!best) best = { cx: p0.x, cz: p0.z, y: p0.y - 1, score: 0 };
  const { cx, cz, y: G } = best;
  log(`founding the colony at ${cx} ${G} ${cz} (height spread ${best.spread}, water ${best.water})`);
  const f = async (c) => {
    const out = await cmd(c);
    if (/error|unknown|incorrect|expected/i.test(out)) log(`  ${c} -> ${out}`);
  };
  // plaza: clear trees, level the ground, a cobblestone square with a campfire in the middle
  await f(`fill ${cx - 9} ${G + 1} ${cz - 9} ${cx + 9} ${G + 22} ${cz + 9} air`);
  await f(`fill ${cx - 9} ${G - 3} ${cz - 9} ${cx + 9} ${G - 1} ${cz + 9} dirt`);
  await f(`fill ${cx - 9} ${G} ${cz - 9} ${cx + 9} ${G} ${cz + 9} grass_block`);
  await f(`fill ${cx - 3} ${G} ${cz - 3} ${cx + 3} ${G} ${cz + 3} cobblestone`);
  await f(`fill ${cx - 8} ${G} ${cz - 8} ${cx + 9} ${G} ${cz - 6} dirt_path`);
  const Y = G + 1;
  await f(`setblock ${cx} ${Y} ${cz} campfire[lit=true]`);
  const row = (dx) => ({ x: cx + dx, y: Y, z: cz - 7 });
  const layout = {
    version: 2,
    center: { x: cx, y: G, z: cz },
    storage: { ores: row(-7), food: row(-5), wood: row(-3), stone: row(-1), misc: row(1) },
    table: row(3),
    furnace: row(4),
    market: row(7),
    campfire: { x: cx, y: Y, z: cz },
    beds: [-5, -3, -1, 1, 3, 5].map((dx) => ({ x: cx + dx, y: Y, z: cz + 7 })),
    bedsPlaced: [],
    placeJobs: [],
    plots: [[-14, 12], [-3, 12], [8, 12], [-14, 26], [-3, 26], [8, 26]].map(([dx, dz]) => ({ x: cx + dx, y: G, z: cz + dz })),
    farm: { x1: cx + 12, x2: cx + 20, z1: cz - 4, z2: cz + 4, y: G, wx: cx + 16, wz: cz },
    mines: {},
    biome: site.biome ?? null,
    foundedAt: Date.now(),
  };
  // chests by category, each with a marker block behind it (iron, hay, log, cobblestone, bookshelf)
  const MARK = { ores: 'iron_block', food: 'hay_block', wood: 'oak_log', stone: 'cobblestone', misc: 'bookshelf' };
  for (const [cat, s] of Object.entries(layout.storage)) {
    await f(`setblock ${s.x} ${s.y} ${s.z} chest[facing=south]`);
    await f(`setblock ${s.x} ${s.y} ${s.z - 1} ${MARK[cat]}`);
  }
  await f(`setblock ${layout.table.x} ${layout.table.y} ${layout.table.z} crafting_table`);
  await f(`setblock ${layout.market.x} ${layout.market.y} ${layout.market.z} chest[facing=south]`);
  await f(`setblock ${layout.market.x + 1} ${Y} ${layout.market.z} barrel[facing=up]`);
  await f(`setblock ${layout.market.x - 1} ${Y} ${layout.market.z} barrel[facing=up]`);
  await f(`fill ${layout.market.x - 1} ${Y + 2} ${layout.market.z - 1} ${layout.market.x + 1} ${Y + 2} ${layout.market.z + 1} red_wool`);
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) await f(`fill ${layout.market.x + dx} ${Y} ${layout.market.z + dz} ${layout.market.x + dx} ${Y + 1} ${layout.market.z + dz} spruce_fence`.replace(`${layout.market.z + dz} ${layout.market.x + dx} ${Y}`, `${layout.market.z + dz} ${layout.market.x + dx} ${Y + 1}`));
  await f(`kill @e[type=villager,tag=wild_market]`);
  await f(`summon villager ${layout.market.x + 0.5} ${Y} ${layout.market.z + 1.5} {NoAI:1b,Invulnerable:1b,Silent:1b,PersistenceRequired:1b,CustomName:"Märt",CustomNameVisible:1b,Rotation:[180f,0f],VillagerData:{profession:"minecraft:mason",level:5,type:"minecraft:taiga"},Tags:["wild_market"]}`);
  // light posts against night spawns on the plaza
  for (const [dx, dz] of [[-8, -8], [8, -8], [-8, 8], [8, 8], [0, -9], [0, 9]]) {
    await f(`fill ${cx + dx} ${Y} ${cz + dz} ${cx + dx} ${Y + 1} ${cz + dz} spruce_fence`);
    await f(`setblock ${cx + dx} ${Y + 2} ${cz + dz} lantern`);
  }
  await f(`setworldspawn ${cx} ${Y} ${cz + 3}`);
  await f(`worldborder center ${cx} ${cz}`);
  await f(`worldborder set ${cfg.worldBorder}`);
  state.colony = layout;
  await drain();
  await makeFarm();
  await cmd(`tp ${first.name} ${cx + 0.5} ${Y} ${cz + 2.5}`);
  await cmd(`gamemode survival ${first.name}`);
  event('wild.ev.founded');
  writeState();
}

/** The colony field east of the plaza: 9x9 ground, a water source in the middle, a fence with a gate. */
async function makeFarm() {
  const fm = state.colony.farm;
  const f = (c) => cmd(c);
  await f(`fill ${fm.x1 - 1} ${fm.y + 1} ${fm.z1 - 1} ${fm.x2 + 1} ${fm.y + 12} ${fm.z2 + 1} air`);
  await f(`fill ${fm.x1 - 1} ${fm.y - 2} ${fm.z1 - 1} ${fm.x2 + 1} ${fm.y - 1} ${fm.z2 + 1} dirt`);
  await f(`fill ${fm.x1} ${fm.y} ${fm.z1} ${fm.x2} ${fm.y} ${fm.z2} dirt`);
  await f(`setblock ${fm.wx} ${fm.y} ${fm.wz} water`);
  await f(`setblock ${fm.wx} ${fm.y - 1} ${fm.wz} stone`);
  for (const [x1, z1, x2, z2] of [[fm.x1 - 1, fm.z1 - 1, fm.x2 + 1, fm.z1 - 1], [fm.x1 - 1, fm.z2 + 1, fm.x2 + 1, fm.z2 + 1], [fm.x2 + 1, fm.z1 - 1, fm.x2 + 1, fm.z2 + 1], [fm.x1 - 1, fm.z1 - 1, fm.x1 - 1, fm.z2 + 1]]) {
    await f(`fill ${x1} ${fm.y} ${z1} ${x2} ${fm.y} ${z2} grass_block`);
    await f(`fill ${x1} ${fm.y + 1} ${z1} ${x2} ${fm.y + 1} ${z2} spruce_fence`);
  }
  await f(`setblock ${fm.x1 - 1} ${fm.y + 1} ${fm.wz} spruce_fence_gate[facing=east,open=true]`);
  await f(`setblock ${fm.x1 - 1} ${fm.y + 2} ${fm.z1 - 1} lantern`);
  await f(`setblock ${fm.x1 - 1} ${fm.y + 2} ${fm.z2 + 1} lantern`);
}

/** Fills ponds and frozen pools around the colony (colonists drown under ice): water -> dirt, ice -> grass. */
async function drain() {
  const c = state.colony.center;
  const R = 28;
  for (let x = c.x - R; x <= c.x + R; x += 28)
    for (let z = c.z - R; z <= c.z + R; z += 28) {
      const x2 = Math.min(x + 27, c.x + R);
      const z2 = Math.min(z + 27, c.z + R);
      await cmd(`fill ${x} ${c.y - 6} ${z} ${x2} ${c.y + 1} ${z2} dirt replace water`);
      await cmd(`fill ${x} ${c.y - 6} ${z} ${x2} ${c.y + 2} ${z2} grass_block replace ice`);
    }
  state.colony.drained = true;
  save();
}

// ------------------------------------------------------------------ sessions and the colonist pool

const SESSION_ID = /^[\w-]{8,80}$/;
const WORD = /^[\w.:-]{1,48}$/;

function chatNameFrom(prompt) {
  const raw = String(prompt ?? '').replace(/<[^>]+>/g, ' ').replace(/[^\p{L}\p{N}\s.,!?-]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!raw || /^(caveat|system|\[)/i.test(raw)) return null;
  const words = raw.split(' ').slice(0, 3).join(' ');
  return words.length > 22 ? words.slice(0, 21) + '…' : words;
}

function nameFor(sessionId, helperOf = null) {
  if (helperOf) return `${helperOf.slice(0, 12)}Jr`;
  if (state.names[sessionId]) return state.names[sessionId];
  const used = new Set(Object.values(state.names));
  let h = 0;
  for (const ch of sessionId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  for (let i = 0; i < NAMES.length; i++) {
    const n = NAMES[(h + i) % NAMES.length];
    if (!used.has(n)) {
      state.names[sessionId] = n;
      return n;
    }
  }
  const n = `Siedler${Object.keys(state.names).length + 1}`;
  state.names[sessionId] = n;
  return n;
}

const TOOL_JOB = { Edit: 'build', MultiEdit: 'build', Write: 'build', NotebookEdit: 'build', Bash: 'mine', PowerShell: 'mine', Read: 'wood', Grep: 'wood', Glob: 'wood', WebSearch: 'hunt', WebFetch: 'hunt' };

function onEvent(raw) {
  const id = raw?.session_id;
  if (typeof id !== 'string' || !SESSION_ID.test(id)) return;
  const kind = raw.hook_event_name;
  const now = Date.now();
  let s = state.sessions[id];
  if (!s) s = state.sessions[id] = { id, chatName: null, firstSeen: now, lastEvent: now, events: 0, tools: {}, recent: [], fails: 0, ended: false };
  s.lastEvent = now;
  s.events++;
  s.ended = false;
  s.recent = (s.recent ?? []).filter((t) => now - t < 60000);
  if (kind === 'UserPromptSubmit' && !s.chatName) s.chatName = chatNameFrom(raw.prompt);
  const tool = typeof raw.tool === 'string' && WORD.test(raw.tool) ? raw.tool : null;
  if (kind === 'PostToolUse' || kind === 'PostToolUseFailure') {
    s.recent.push(now);
    if (tool) s.tools[tool] = (s.tools[tool] ?? 0) + 1;
  }
  const c = colonistOf(s);
  const kinds = Array.isArray(raw.kinds) ? raw.kinds : [];
  if (kind === 'SessionEnd') {
    s.ended = true;
    if (c) c.mode = 'leaving';
    for (const h of colonists.values()) if (h.helper && h.parentSession === id) h.mode = 'leaving';
  } else if (kind === 'SubagentStart' && cfg.helperColonists) {
    spawnHelper(s).catch((e) => log('helper failed', e.message));
  } else if (kind === 'SubagentStop') {
    for (const h of colonists.values()) if (h.helper && h.parentSession === id) h.mode = 'leaving';
  } else if (kind !== 'Stop' && kind !== 'Notification') {
    ensureColonist(s).catch((e) => log('spawn failed', e.message));
  }
  if (c) {
    if (kinds.includes('test')) {
      if (raw.ok === false || (typeof raw.exit === 'number' && raw.exit !== 0)) {
        s.fails = (s.fails ?? 0) + 1;
        c.mood = Math.max(-3, c.mood - 1);
        chatter.say(c, 'badluck', {});
        cmd(`effect give ${c.name} minecraft:unluck 60 0 true`).catch(() => {});
        cmd(`effect give ${c.name} minecraft:slowness 8 0 true`).catch(() => {});
        cmd(`execute at ${c.name} run particle minecraft:angry_villager ~ ~2.2 ~ 0.3 0.2 0.3 0 5`).catch(() => {});
      } else {
        if (s.fails > 0) chatter.say(c, 'testsGreen', {});
        s.fails = 0;
        c.mood = Math.min(3, c.mood + 1);
        cmd(`effect clear ${c.name} minecraft:unluck`).catch(() => {});
      }
    }
    if (kinds.includes('commit')) celebrate(c, 'commit');
    else if (kinds.includes('push')) celebrate(c, 'push');
    if (tool && TOOL_JOB[tool]) c.lastJobHint = TOOL_JOB[tool];
  }
  save();
}

function colonistOf(s) {
  const n = state.names[s.id];
  return n ? colonists.get(n) : null;
}

/** How many colonists may be online: colonistsMax (setting), and never more than free RAM allows. */
function poolCap() {
  const freeMB = os.freemem() / 1048576;
  const spare = Math.floor((freeMB - cfg.reserveFreeMB) / cfg.perBotMB);
  return Math.min(settingsNow.colonistsMax, colonists.size + Math.max(0, spare));
}

const spawning = new Set();
async function ensureColonist(s) {
  const name = nameFor(s.id);
  const c = colonists.get(name);
  if (c) {
    if (c.mode === 'leaving' && c.running) return;
    c.mode = 'work';
    return;
  }
  if (spawning.has(name) || !colony.ready && colonists.size > 0) return;
  if (colonists.size >= poolCap()) {
    // free a slot: the colonist of the chat that has been idle the longest goes to the tavern
    const idle = [...colonists.values()].filter((x) => x.mode === 'home' && !x.helper).sort((a, b) => (state.sessions[a.sessionId]?.lastEvent ?? 0) - (state.sessions[b.sessionId]?.lastEvent ?? 0))[0];
    const helper = [...colonists.values()].find((x) => x.helper);
    const victim = helper ?? idle;
    if (!victim) return;
    victim.mode = 'leaving';
    return;
  }
  spawning.add(name);
  try {
    await spawnColonist({ name, session: s });
  } finally {
    spawning.delete(name);
  }
}

async function spawnColonist({ name, session, helper = false, parent = null }) {
  const c = new Colonist({ name, colony, helper, chatName: session.chatName ?? '' });
  c.sessionId = session.id;
  if (helper) c.parentSession = session.id;
  colonists.set(name, c);
  try {
    await c.connect();
  } catch (e) {
    colonists.delete(name);
    throw e;
  }
  log(`${name} joined${helper ? ` (helper of ${parent})` : ''} for chat ${session.chatName ?? session.id.slice(0, 8)}`);
  await cmd(`gamemode survival ${name}`);
  await setNametag(c, helper ? t('wild.tag.helper', { parent }) : session.chatName ?? t('wild.tag.chat', { id: session.id.slice(0, 4) }));
  if (!state.colony) {
    await found(c);
  } else if (c.bot.entity.position.distanceTo(colony.home()) > 64) {
    const h = colony.home();
    await cmd(`tp ${name} ${h.x} ${h.y} ${h.z}`);
  }
  colony.ready = true;
  chatter.say(c, helper ? 'helperJoin' : 'hello', { name, parent }, { urgent: true });
  event(helper ? 'wild.ev.joinedHelper' : 'wild.ev.joined', { name, parent });
  return c;
}

async function spawnHelper(s) {
  const parent = colonistOf(s);
  if (!parent || !colony.ready) return;
  if ([...colonists.values()].some((x) => x.helper && x.parentSession === s.id)) return;
  if (colonists.size >= poolCap()) return;
  const name = nameFor(s.id, parent.name);
  if (spawning.has(name)) return;
  spawning.add(name);
  try {
    await spawnColonist({ name, session: s, helper: true, parent: parent.name });
  } finally {
    spawning.delete(name);
  }
}

/** Optional: one caretaker colonist keeps the colony alive while no chat is active (off by default). */
async function caretaker() {
  const id = 'caretaker-colony';
  const care = colonists.get('Hauswart');
  const real = [...colonists.values()].filter((c) => c.sessionId !== id);
  if (!settingsNow.caretaker || real.length) {
    if (care && care.mode !== 'leaving') care.mode = 'leaving';
    return;
  }
  if (care || spawning.has('Hauswart') || !state.colony) return;
  const s = (state.sessions[id] ??= { id, chatName: t('wild.tag.caretaker'), firstSeen: Date.now(), lastEvent: Date.now(), events: 0, tools: {}, recent: [], caretaker: true });
  s.lastEvent = Date.now();
  state.names[id] = 'Hauswart';
  spawning.add('Hauswart');
  try {
    await spawnColonist({ name: 'Hauswart', session: s });
  } catch (e) {
    log('caretaker failed', e.message);
  } finally {
    spawning.delete('Hauswart');
  }
}

async function setNametag(c, label) {
  const team = `w_${c.name}`.slice(0, 16);
  await cmd(`team add ${team}`).catch(() => {});
  await cmd(`team modify ${team} suffix ${JSON.stringify({ text: ` · ${label}`, color: 'gray' })}`);
  await cmd(`team modify ${team} color ${c.helper ? 'aqua' : 'yellow'}`);
  await cmd(`team join ${team} ${c.name}`);
}

async function celebrate(c, kind) {
  chatter.say(c, kind, {}, { urgent: true });
  const bonus = kind === 'commit' ? 5 : 2;
  state.credits += bonus;
  state.earned += bonus;
  event(kind === 'commit' ? 'wild.ev.commit' : 'wild.ev.push', { name: c.name, bonus });
  await cmd(`execute at ${c.name} run summon firework_rocket ~ ~1 ~ {LifeTime:25,FireworksItem:{id:"minecraft:firework_rocket",count:1,components:{"minecraft:fireworks":{flight_duration:1,explosions:[{shape:"star",colors:[I;16711680,16777215],has_trail:true}]}}}}`).catch(() => {});
  try {
    for (let i = 0; i < 3; i++) {
      c.bot.setControlState('jump', true);
      await sleep(350);
      c.bot.setControlState('jump', false);
      await sleep(250);
    }
  } catch {}
}

// ------------------------------------------------------------------ periodic work

async function scanMarket() {
  const m = state.colony?.market;
  if (!m || marketLock) return;
  marketLock = 'market';
  try {
    const out = await cmd(`data get block ${m.x} ${m.y} ${m.z} Items`);
    const items = parseItems(out);
    if (!items.length) return;
    let total = 0;
    const what = [];
    for (const it of items) {
      const price = sellPrice(it.id, cfg.creditMultiplier);
      if (price <= 0) continue;
      await cmd(`item replace block ${m.x} ${m.y} ${m.z} container.${it.slot} with air`);
      total += price * it.count;
      state.sold[it.id] = (state.sold[it.id] ?? 0) + it.count;
      what.push([it.count, it.id]);
    }
    if (total > 0) {
      total = Math.round(total * 100) / 100;
      state.credits = Math.round((state.credits + total) * 100) / 100;
      state.earned = Math.round((state.earned + total) * 100) / 100;
      log(`market: +${total} Fr. for ${what.map(([n, id]) => `${n} ${id}`).join(', ')} (treasury ${state.credits})`);
      event('wild.ev.sold', { what: what.slice(0, 4), amount: total });
      if (total >= 3) cmd(`tellraw @a ${JSON.stringify([{ text: '<Märt> ', color: 'gold' }, { text: t('wild.market.thanks', { amount: total.toFixed(1), total: state.credits.toFixed(1) }), color: 'yellow' }])}`).catch(() => {});
      save();
    }
  } catch (e) {
    log('market scan failed', e.message);
  } finally {
    marketLock = null;
  }
}

/** Parses `data get block ... Items` output into [{slot, id, count}]. */
export function parseItems(out) {
  const start = out.indexOf('[');
  if (start < 0) return [];
  const items = [];
  let depth = 0;
  let cur = '';
  for (const ch of out.slice(start + 1)) {
    if (ch === '{') depth++;
    if (depth > 0) cur += ch;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        const id = cur.match(/id: "minecraft:([a-z0-9_]+)"/)?.[1];
        const count = Number(cur.match(/count: (\d+)/)?.[1] ?? 1);
        const slot = Number(cur.match(/Slot: (\d+)b/)?.[1] ?? -1);
        if (id && slot >= 0) items.push({ id, count, slot });
        cur = '';
      }
    }
  }
  return items;
}

let lastBoost = 0;
async function updateActivity() {
  const now = Date.now();
  for (const c of colonists.values()) {
    if (c.helper) continue;
    const s = state.sessions[c.sessionId];
    if (!s) continue;
    if (s.caretaker) {
      if (c.mode !== 'leaving') c.mode = 'work';
      continue;
    }
    const idleMin = (now - s.lastEvent) / 60000;
    if (c.mode !== 'leaving') {
      if (s.ended || idleMin > cfg.leaveAfterMinutes) c.mode = 'leaving';
      else c.mode = idleMin < cfg.activeMinutes ? 'work' : 'home';
    }
    const rate = (s.recent ?? []).filter((t) => now - t < 60000).length;
    const level = rate >= 12 ? 2 : rate >= 4 ? 1 : 0;
    if (level !== c.boost) {
      if (level > c.boost && level >= 1) chatter.say(c, 'boost', {}, { keyCooldownMs: 120000 });
      c.boost = level;
    }
    // job preference from what the chat does (Edit/Write -> builder, Bash -> miner, Read/Grep -> woodcutter)
    const tools = s.tools ?? {};
    const score = (job) => Object.entries(tools).filter(([t]) => TOOL_JOB[t] === job).reduce((n, [, k]) => n + k, 0);
    c.jobPreference = ['build', 'mine', 'wood'].sort((a, b) => score(b) - score(a))[0];
  }
  if (now - lastBoost > 20000) {
    lastBoost = now;
    for (const c of colonists.values()) {
      if (c.boost > 0 && c.running && !c.dead) await cmd(`effect give ${c.name} minecraft:haste 25 ${c.boost - 1} true`).catch(() => {});
    }
  }
}

/**
 * Roles from the colony's needs (re-evaluated every 10 s): one builder while a house is affordable,
 * a farmer and a hunter when food runs short, lumberjacks when wood is short, miners otherwise.
 * The chat's own work style breaks ties (Edit/Write -> builder, Bash -> miner, Read/Grep -> lumberjack).
 */
function assignRoles() {
  const list = [...colonists.values()].filter((c) => c.running && !c.dead && c.bot?.entity && c.mode !== 'leaving');
  const workers = list.filter((c) => !c.helper);
  for (const h of list.filter((c) => c.helper)) h.role = 'lumberjack';
  if (!workers.length) return;
  const food = colony.storageCount(/^cooked_|^bread$|^baked_potato$|^apple$|^carrot$/) + workers.reduce((n, c) => n + I.foodCount(c.bot), 0);
  const logs = colony.storageCount(I.LOG);
  const n = workers.length;
  const want = [];
  if (colony.builder && workers.includes(colony.builder)) want.push(['builder', colony.builder]);
  if (food < 6 * n && n >= 2) want.push(['farmer']);
  if (food < 3 * n && n >= 3) want.push(['hunter']);
  const free = workers.filter((c) => !want.some(([, who]) => who === c));
  const roles = new Map(want.filter(([, who]) => who).map(([r, who]) => [who, r]));
  const open = want.filter(([, who]) => !who).map(([r]) => r);
  const prefer = { farmer: 'hunt', hunter: 'hunt' };
  for (const r of open) {
    const pick = free.find((c) => !roles.has(c) && c.jobPreference === prefer[r]) ?? free.find((c) => !roles.has(c) && I.toolTier(c.bot, 'pickaxe') >= 0);
    if (pick) roles.set(pick, r);
  }
  let lumber = [...roles.values()].filter((r) => r === 'lumberjack').length;
  for (const c of free) {
    if (roles.has(c)) continue;
    if (I.toolTier(c.bot, 'pickaxe') < 1) roles.set(c, c.jobPreference === 'mine' ? 'miner' : 'lumberjack');
    else if ((logs < 24 && lumber === 0) || c.jobPreference === 'wood') {
      roles.set(c, 'lumberjack');
      lumber++;
    } else roles.set(c, 'miner');
  }
  for (const [c, r] of roles) {
    if (c.role !== r) log(`role: ${c.name} -> ${r}`);
    c.role = r;
  }
}

function chooseBuilder() {
  if (colony.builder && (!colony.builder.running || colony.builder.mode === 'leaving' || colony.builder.helper)) colony.builder = null;
  if (colony.builder) return;
  const ready = [...colonists.values()].filter((c) => !c.helper && c.running && c.mode === 'work' && c.bot?.entity && I.toolTier(c.bot, 'pickaxe') >= 1 && I.toolTier(c.bot, 'sword') >= 1);
  if (!ready.length) return;
  ready.sort((a, b) => (b.jobPreference === 'build') - (a.jobPreference === 'build'));
  colony.builder = ready[0];
  log(`builder: ${ready[0].name}`);
}

const met = new Map();
function greetings() {
  const list = [...colonists.values()].filter((c) => c.running && !c.dead && c.bot?.entity && !c.inCombat);
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const key = `${a.name}|${b.name}`;
      const near = a.bot.entity.position.distanceTo(b.bot.entity.position) < 6;
      const was = met.get(key) ?? { near: false, apartSince: 0 };
      if (near && !was.near && Date.now() - was.apartSince > 180000) a.greet(b);
      met.set(key, { near, apartSince: near ? was.apartSince : was.near ? Date.now() : was.apartSince || 1 });
    }
}

const welcomed = new Set();
/** Real players online (usernames; `list` would show team suffixes). */
async function onlinePlayers() {
  const bot = [...colonists.values()].find((c) => c.running && c.bot?.players)?.bot;
  if (bot) return Object.keys(bot.players).filter((n) => !colonists.has(n));
  const out = await cmd('list');
  return (out.split(':')[1] ?? '').split(',').map((x) => x.trim().split(' ')[0]).filter((n) => n && !colonists.has(n));
}

async function watchPlayers() {
  const names = await onlinePlayers();
  for (const n of names) {
    if (welcomed.has(n)) continue;
    welcomed.add(n);
    if ((cfg.spectators ?? []).includes(n)) {
      await cmd(`op ${n}`);
      if (state.colony) {
        const h = colony.home();
        await cmd(`tp ${n} ${h.x} ${h.y + 12} ${h.z + 14}`);
      }
    }
    await cmd(`tellraw ${n} ${JSON.stringify([{ text: t('wild.join.title'), color: 'gold' }, { text: t('wild.join.info', { count: colonists.size, credits: state.credits.toFixed(1), url: `http://127.0.0.1:${cfg.port}/` }), color: 'gray' }])}`);
    await sendList(n);
    const c = [...colonists.values()].find((x) => x.running && !x.dead);
    if (c) setTimeout(() => chatter.say(c, 'greetPlayer', { other: n }), 2500);
  }
  for (const n of welcomed) if (!names.includes(n)) welcomed.delete(n);
}

/** Clickable list for a player: every colonist with [tp] and [follow] (spectator camera). */
async function sendList(player) {
  const parts = [{ text: t('wild.list.header') + '\n', color: 'gold' }];
  for (const c of colonists.values()) {
    if (!c.running) continue;
    parts.push({ text: `  ${c.name}`, color: c.helper ? 'aqua' : 'yellow' });
    parts.push({ text: ` · ${t(`wild.role.${c.role}`)} · ${c.task} `, color: 'gray' });
    parts.push({ text: t('wild.list.tp'), color: 'green', click_event: { action: 'run_command', command: `/tp @s ${c.name}` }, hover_event: { action: 'show_text', value: t('wild.list.tpHover', { name: c.name }) } });
    parts.push({ text: ' ' });
    parts.push({ text: t('wild.list.follow'), color: 'aqua', click_event: { action: 'run_command', command: `/spectate ${c.name} @s` }, hover_event: { action: 'show_text', value: t('wild.list.followHover', { name: c.name }) } });
    parts.push({ text: '\n' });
  }
  parts.push({ text: t('wild.list.spectator'), color: 'light_purple', click_event: { action: 'run_command', command: '/gamemode spectator' } });
  parts.push({ text: '  ' });
  parts.push({ text: t('wild.list.creative'), color: 'light_purple', click_event: { action: 'run_command', command: '/gamemode creative' } });
  parts.push({ text: '  ' });
  parts.push({ text: t('wild.list.refresh'), color: 'gray', click_event: { action: 'run_command', command: '/trigger colony_list' } });
  await cmd(`tellraw ${player} ${JSON.stringify(parts)}`);
  await cmd(`scoreboard players enable ${player} colony_list`).catch(() => {});
}

// sidebar: one line per colonist (name, role, health, food, task), refreshed when it changes
const sidebarLines = new Map();
async function updateSidebar() {
  if (!sidebarReady) {
    await cmd(`scoreboard objectives add colony dummy ${JSON.stringify({ text: t('wild.sidebar.title'), color: 'gold' })}`).catch(() => {});
    await cmd(`scoreboard objectives modify colony displayname ${JSON.stringify({ text: t('wild.sidebar.title'), color: 'gold' })}`).catch(() => {});
    await cmd('scoreboard objectives setdisplay sidebar colony');
    await cmd('scoreboard objectives modify colony numberformat blank');
    await cmd('scoreboard objectives add colony_list trigger').catch(() => {});
    await cmd('scoreboard players enable @a colony_list').catch(() => {});
    sidebarReady = true;
  }
  const list = [...colonists.values()].filter((c) => c.running);
  const header = `#till`;
  const want = new Map();
  want.set(header, { score: 99, text: [{ text: t('wild.sidebar.till', { credits: state.credits.toFixed(0) }), color: 'gold' }] });
  list.forEach((c, i) => {
    const b = c.bot;
    const hp = c.dead ? '☠' : `❤${Math.round(b?.health ?? 0)}`;
    const food = `🍗${b?.food ?? 0}`;
    want.set(`#c${i}`, { score: 90 - i, text: [{ text: c.name, color: c.helper ? 'aqua' : 'yellow' }, { text: ` ${t(`wild.role.${c.role}`)} `, color: 'gray' }, { text: `${hp} ${food} `, color: 'white' }, { text: shortTask(c.task), color: 'dark_gray' }] });
  });
  for (const [holder, line] of want) {
    const key = JSON.stringify(line);
    if (sidebarLines.get(holder) === key) continue;
    sidebarLines.set(holder, key);
    await cmd(`scoreboard players set ${holder} colony ${line.score}`);
    await cmd(`scoreboard players display name ${holder} colony ${JSON.stringify(line.text)}`);
  }
  for (const holder of [...sidebarLines.keys()]) {
    if (want.has(holder)) continue;
    sidebarLines.delete(holder);
    await cmd(`scoreboard players reset ${holder} colony`);
  }
  // [list] trigger: a player clicked "refresh"
  for (const n of await onlinePlayers()) {
    const out = await cmd(`scoreboard players get ${n} colony_list`).catch(() => '');
    if (/has (\d+)/.test(out) && Number(out.match(/has (\d+)/)[1]) > 0) {
      await cmd(`scoreboard players set ${n} colony_list 0`);
      await cmd(`scoreboard players enable ${n} colony_list`);
      await sendList(n);
    }
  }
}
let sidebarReady = false;
const shortTask = (task) => String(task ?? '').replace(/^upgrade:/, '↑').replace(/^gather:/, '').replace(/^mine:/, '⛏').slice(0, 14);

async function buyBeds() {
  const col = state.colony;
  if (!col) return;
  const placed = (col.bedsPlaced ?? []).length + (col.placeJobs ?? []).filter((j) => /_bed$/.test(j.item)).length;
  const want = Math.min(colonists.size, col.beds.length);
  if (placed >= want) return;
  const price = buyPrice('red_bed');
  // beds come after the first house batch is affordable: keep a reserve for construction
  if (state.credits < price + 6) return;
  const c = [...colonists.values()].find((x) => x.running && !x.dead && x.mode !== 'leaving' && !x.helper && x.bot?.entity && x.bot.entity.position.distanceTo(colony.home()) < 16 && !(col.placeJobs ?? []).some((j) => j.who === x.name));
  if (!c) return;
  const used = new Set([...(col.bedsPlaced ?? []), ...(col.placeJobs ?? []).map((j) => j.spot)].map((p) => `${p.x},${p.z}`));
  const spot = col.beds.find((p) => !used.has(`${p.x},${p.z}`));
  if (!spot) return;
  state.credits = Math.round((state.credits - price) * 100) / 100;
  state.spent += price;
  state.bought.red_bed = (state.bought.red_bed ?? 0) + 1;
  await cmd(`give ${c.name} red_bed 1`);
  col.placeJobs = [...(col.placeJobs ?? []), { who: c.name, item: 'red_bed', spot }];
  chatter.say(c, 'bought', { what: t('wild.what.bed'), price: price.toFixed(1) });
  event('wild.ev.bedBought', { price });
  save();
}

// ------------------------------------------------------------------ construction

const builder = new Builder({ colony, state, cmd, log, save, event, chatter, cfg });

// ------------------------------------------------------------------ HTTP

const runStart = { t: Date.now(), stats: { ...state.stats }, earned: state.earned };
const gone = []; // metrics of colonists that left during this run
/** Survival quality for this run: deaths per colonist-hour, food security, uptime, resources per hour. */
function metrics() {
  const all = [...colonists.values()].map((c) => ({ name: c.name, m: c.metrics, stats: c.stats })).concat(gone);
  const sum = (k) => all.reduce((n, x) => n + (x.m[k] ?? 0), 0);
  const conn = sum('connectedMs');
  const hours = Math.max(1e-6, conn / 3.6e6);
  const wallH = Math.max(1e-6, (Date.now() - runStart.t) / 3.6e6);
  const delta = (k) => (state.stats[k] ?? 0) - (runStart.stats[k] ?? 0);
  const pct = (x) => (conn ? +((100 * x) / conn).toFixed(1) : 0);
  return {
    brain: cfg.brain === 'naive' ? 'naive' : 'utility',
    runMinutes: +((Date.now() - runStart.t) / 60000).toFixed(1),
    colonistHours: +hours.toFixed(2),
    deaths: delta('deaths'),
    deathsPerHour: +(delta('deaths') / hours).toFixed(2),
    deathCauses: Object.fromEntries(Object.entries(state.stats).filter(([k]) => k.startsWith('death_')).map(([k, v]) => [k.slice(6), v - (runStart.stats[k] ?? 0)]).filter(([, v]) => v > 0)),
    foodCriticalPct: pct(sum('foodCriticalMs')),
    minFood: all.length ? Math.min(...all.map((x) => x.m.minFood ?? 20)) : null,
    uptimePct: conn ? +(100 - pct(sum('failedMs'))).toFixed(1) : 0,
    timePct: { work: pct(sum('work')), survival: pct(sum('survival')), idle: pct(sum('idle')), social: pct(sum('social')) },
    perHour: {
      logs: +(delta('logs') / wallH).toFixed(0), stone: +(delta('stoneMined') / wallH).toFixed(0), credits: +((state.earned - runStart.earned) / wallH).toFixed(0),
      kills: +(delta('kills') / wallH).toFixed(1), crafted: +(delta('crafted') / wallH).toFixed(1), wheat: +(delta('wheat') / wallH).toFixed(1), cooked: +(delta('cooked') / wallH).toFixed(1),
    },
    unstuck: delta('unstuck'), recalls: delta('recalls'), rescues: delta('rescues'),
  };
}

function renderEvent(e) {
  if (!e.key) return { t: e.t, text: e.text };
  const p = { ...e.params };
  if (typeof p.item === 'string') p.item = itemName(p.item);
  if (Array.isArray(p.what)) p.what = p.what.map(([n, id]) => `${n} ${itemName(id)}`).join(', ');
  if (typeof p.house === 'string') p.house = t(`wild.house.${p.house}`);
  if (typeof p.cause === 'string') p.cause = t(`wild.cause.${p.cause}`, { mob: p.killer ? mobName(p.killer) : '?' });
  return { t: e.t, text: t(e.key, p) };
}

function snapshot() {
  const now = Date.now();
  return {
    server: { port: cfg.mcPort, rcon: rcon.connected },
    colony: state.colony && { center: state.colony.center, beds: (state.colony.bedsPlaced ?? []).length, biome: state.colony.biome },
    treasury: { credits: state.credits, earned: state.earned, spent: state.spent, sold: state.sold, bought: state.bought },
    stats: state.stats,
    poolCap: poolCap(),
    freeMemMB: Math.round(os.freemem() / 1048576),
    nodeRssMB: Math.round(process.memoryUsage().rss / 1048576),
    builder: colony.builder?.name ?? null,
    projects: state.projects.map((p) => ({ type: p.type, label: PROJECT_LABEL[p.type] ?? p.type, placed: p.placed, total: p.total, done: !!p.done, hand: p.hand ?? 0, rcon: p.rcon ?? 0, credits: p.creditsSpent ?? 0, origin: p.origin })),
    colonists: [...colonists.values()].map((c) => {
      const b = c.bot;
      const s = state.sessions[c.sessionId];
      return {
        name: c.name, chat: s?.chatName ?? null, helper: c.helper, mode: c.mode, role: c.role, task: c.task, metrics: c.metrics, dead: c.dead, boost: c.boost, mood: c.mood,
        hp: b?.health != null ? Math.round(b.health) : null, food: b?.food ?? null, pos: b?.entity ? b.entity.position.floored().toArray() : null,
        tools: b?.entity ? ['pickaxe', 'sword', 'axe'].map((k) => I.bestTool(b, k)?.name ?? '-') : [],
        armor: b?.entity ? ['head', 'torso', 'legs', 'feet'].map((s2) => I.equipped(b, s2)?.name ?? '-') : [],
        shield: b?.inventory?.slots?.[45]?.name === 'shield', stats: c.stats, idleMin: s ? +((now - s.lastEvent) / 60000).toFixed(1) : null,
      };
    }),
    metrics: metrics(),
    deaths: deathLog.slice(-20),
    events: state.events.slice(-30).map(renderEvent),
    chat: chatter.recent.slice(-20),
    log: logRing.slice(-40),
  };
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const hosts = [`127.0.0.1:${cfg.port}`, `localhost:${cfg.port}`];
  if (!hosts.includes(String(req.headers.host))) {
    res.writeHead(403).end();
    req.resume();
    return;
  }
  if (req.method === 'POST' && url === '/event') {
    if (req.headers.origin || !String(req.headers['content-type']).startsWith('application/json')) {
      res.writeHead(403).end();
      req.resume();
      return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      body += c;
      if (body.length > 64 * 1024) req.destroy();
    });
    req.on('end', () => {
      res.writeHead(204).end();
      try {
        onEvent(JSON.parse(body));
      } catch (e) {
        if (!(e instanceof SyntaxError)) log('event error', e.stack ?? e.message);
      }
    });
    return;
  }
  if (req.method === 'POST' && url === '/api/stop') {
    // local tools only (no Origin): node wild/stop.mjs
    if (req.headers.origin) {
      res.writeHead(403).end();
      req.resume();
      return;
    }
    res.writeHead(204).end();
    req.resume();
    shutdown();
    return;
  }
  if (req.method === 'GET' && (url === '/status' || url === '/wild/status')) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(snapshot(), null, 1));
    return;
  }
  if (req.method === 'GET' && url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'" });
    res.end(statusPage());
    return;
  }
  res.writeHead(404).end();
});

// ------------------------------------------------------------------ main

readSharedSettings();
setInterval(readSharedSettings, 15000);

await ensureRcon();
for (const c of [
  'difficulty normal', 'gamerule mob_griefing false', 'gamerule keep_inventory false', 'gamerule respawn_radius 0',
  'gamerule players_sleeping_percentage 50', 'gamerule send_command_feedback false', 'gamerule advance_time true',
  'gamerule spawn_monsters true', 'gamerule show_death_messages true',
]) {
  const out = await cmd(c).catch((e) => e.message);
  if (/unknown|incorrect|invalid/i.test(out)) log(`${c}: ${out}`);
}
if (state.colony) {
  if (!state.colony.drained) await drain();
  colony.ready = true;
  log(`colony at ${state.colony.center.x} ${state.colony.center.y} ${state.colony.center.z}, treasury ${state.credits} Fr.`);
}
const beat = () => {
  try {
    fs.writeFileSync(cfg.heartbeatFile, String(Date.now()));
  } catch {}
};
server.listen(cfg.port, '127.0.0.1', () => {
  log(`wild colony listening on http://127.0.0.1:${cfg.port}/ (server 127.0.0.1:${cfg.mcPort})`);
  beat();
  setInterval(beat, 3000);
});

// chats that were active before a restart get their colonists back
setTimeout(() => {
  const recent = Object.values(state.sessions).filter((s) => !s.ended && Date.now() - s.lastEvent < cfg.leaveAfterMinutes * 60000).sort((a, b) => b.lastEvent - a.lastEvent);
  (async () => {
    for (const s of recent.slice(0, cfg.maxColonists)) await ensureColonist(s).catch((e) => log('respawn failed', e.message));
  })();
}, 1500);

let tickN = 0;
setInterval(async () => {
  tickN++;
  try {
    await updateActivity();
    chooseBuilder();
    greetings();
    if (tickN % 3 === 0) await scanMarket();
    if (tickN % 3 === 1) await watchPlayers();
    if (tickN % 3 === 2) await updateSidebar();
    if (tickN % 180 === 90) for (const n of await onlinePlayers()) await sendList(n);
    if (tickN % 5 === 2) await buyBeds();
    if (tickN % 5 === 4) await builder.tick();
    if (tickN % 5 === 3) assignRoles();
    if (tickN % 5 === 1) await caretaker();
    for (const c of colonists.values()) {
      if (c.mode === 'leaving' && !c.running) colonists.delete(c.name);
    }
  } catch (e) {
    log('tick error', e.stack ?? e.message);
  }
}, 2000);

function shutdown() {
  log('shutting down: colonists leave');
  for (const c of colonists.values()) c.quit('colony stopped');
  writeState();
  try {
    fs.unlinkSync(cfg.heartbeatFile);
  } catch {}
  setTimeout(() => process.exit(0), 800);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGBREAK', shutdown);
process.on('uncaughtException', (e) => log('uncaught', e.stack ?? e.message));
process.on('unhandledRejection', (e) => log('unhandled', e?.stack ?? String(e)));
