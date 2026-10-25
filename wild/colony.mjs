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
import { loadConfig, ROOT, DEFAULTS } from './config.mjs';
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
// Settings shared with the city bridge, re-read every 15 s (so a new cap applies without a restart).
// The colonist cap: `colonistsMax` (or the older `maxColonists`) in wild-config.json wins, else
// `colonistsMax` in the town's config.json (written by the settings page and tools/tune.mjs), else 3.
// Also: language, colonistsCaretaker, chatter (feature toggle), chatterFrequency.
const settingsNow = { colonistsMax: cfg.colonistsMax ?? cfg.maxColonists, caretaker: false, chatter: true, frequency: 'normal', language: 'en' };
function readSharedSettings() {
  const readJson = (f) => {
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch {
      return null;
    }
  };
  const city = readJson(path.join(ROOT, 'config.json')) ?? {};
  const wild = readJson(cfg.configFile) ?? cfg.userConfig ?? {};
  const pick = (k, d) => wild[k] ?? city[k] ?? d;
  const cap = wild.colonistsMax ?? wild.maxColonists ?? city.colonistsMax ?? DEFAULTS.maxColonists;
  const prevCap = settingsNow.colonistsMax;
  settingsNow.colonistsMax = Math.max(0, Math.min(16, Number(cap) || 0));
  if (prevCap !== settingsNow.colonistsMax && logRing.length) log(`colonist cap: ${prevCap} -> ${settingsNow.colonistsMax}`);
  settingsNow.caretaker = pick('colonistsCaretaker', 'off') === 'on' || pick('colonistsCaretaker', false) === true;
  settingsNow.chatter = wild.chatter ?? city.features?.chatter ?? city.chatter ?? true;
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
const lootTargets = new Map(); // "x,y,z" -> { pos, place, by }

/** What a found chest belongs to, from the blocks around it. */
function placeKind(bot, p) {
  const names = [];
  for (let dx = -4; dx <= 4; dx++) for (let dy = -3; dy <= 3; dy++) for (let dz = -4; dz <= 4; dz++) names.push(bot.blockAt(p.offset(dx, dy, dz))?.name ?? '');
  const has = (re) => names.some((n) => re.test(n));
  if (has(/^spawner$|^trial_spawner$|^vault$/)) return 'dungeon';
  if (has(/obsidian|netherrack|magma_block/)) return 'portal';
  if (has(/^rail$|cobweb/)) return 'mineshaft';
  if (has(/^water$/) && has(/_planks$|_log$|_stairs$/)) return 'shipwreck';
  if (has(/^bell$|hay_block|composter|_bed$/)) return 'village';
  return 'ruin';
}

/** Door, outside and inside cells of a finished cabin. */
function houseCells(h) {
  const o = h.origin;
  return { id: h.id, door: V({ x: o.x + 5, y: o.y + 1, z: o.z + 2 }), outside: V({ x: o.x + 5, y: o.y + 1, z: o.z + 0 }), inside: V({ x: o.x + 5, y: o.y + 1, z: o.z + 5 }), bed: V({ x: o.x + 7, y: o.y + 1, z: o.z + 7 }) };
}

/** The house bed assigned to a colonist (cabins: bed foot at origin + (7, 1, 7), door at + (5, 1, 2)). */
function houseBedOf(c) {
  const col = state.colony;
  if (!col) return null;
  col.bedOwners ??= {};
  const houses = state.projects.filter((p) => p.done && p.type === 'cabin');
  if (!houses.length) return null;
  const online = new Set([...colonists.values()].filter((x) => x.running).map((x) => x.name));
  let mine = houses.find((h) => col.bedOwners[h.id] === c.name);
  if (!mine && !c.helper) {
    mine = houses.find((h) => !col.bedOwners[h.id] || !online.has(col.bedOwners[h.id]));
    if (mine) {
      col.bedOwners[mine.id] = c.name;
      save();
    }
  }
  if (!mine) return null;
  return houseCells(mine);
}
const badCells = new Set(); // cells where the server keeps rejecting moves
let marketLock = null;
let furnaceLock = null;
const storageSnap = new Map(); // "x,y,z" -> [{name,count}]
const chestSlots = new Map(); // "x,y,z" -> container size seen when it was last opened (27 or 54)
const storageWanted = {}; // category -> { since, who, announced, retryAt }: a full chest waits for a second half
// sold for nothing when storage is full (the market takes them; better than carrying them forever)
const JUNK = /^(dirt|coarse_dirt|gravel|sand|cobblestone|cobbled_deepslate|andesite|diorite|granite|tuff|calcite|netherrack|rotten_flesh|spider_eye|poisonous_potato|wheat_seeds|beetroot_seeds|pumpkin_seeds|melon_seeds|.*_sapling|stick|bone|string|feather|arrow|flint|.*_flower|dandelion|poppy|kelp|seagrass)$/;
function noteFull(cat) {
  if (state.colony?.storageExtra?.[cat] || storageWanted[cat]) return;
  storageWanted[cat] = { since: Date.now() };
  log(`storage: the ${cat} chest is full`);
}
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
  markBadCell(p) {
    badCells.add(`${p.x},${p.y},${p.z}`);
    log(`bad cell ${p}: paths avoid it`);
  },
  colonistsList: () => [...colonists.values()],
  isInHouse(p) {
    for (const pr of state.projects) {
      if (!pr.done || !pr.box) continue;
      const b = pr.box;
      if (p.x >= b[0] + 2 && p.x <= b[3] - 2 && p.z >= b[2] + 2 && p.z <= b[5] - 2 && p.y > b[1] + 1 && p.y < b[4]) return true;
    }
    return false;
  },
  isBadCell(p) {
    return badCells.size > 0 && (badCells.has(`${p.x},${p.y},${p.z}`) || badCells.has(`${p.x},${p.y - 1},${p.z}`));
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
  noteStorage(pos, items, slots = 27) {
    const key = `${pos.x},${pos.y},${pos.z}`;
    storageSnap.set(key, items.map((i) => ({ name: i.name, count: i.count })));
    chestSlots.set(key, slots);
  },
  /** Free slots of a storage chest as last seen (unknown: assume room). */
  chestFree(pos) {
    const key = `${pos.x},${pos.y},${pos.z}`;
    const items = storageSnap.get(key);
    if (!items || !chestSlots.has(key)) return 27;
    return Math.max(0, chestSlots.get(key) - items.length);
  },
  /** Does the chest at pos still take (some of) this item: a free slot, or a partial stack of it. */
  chestTakes(pos, name) {
    if (this.chestFree(pos) > 0) return true;
    return (storageSnap.get(`${pos.x},${pos.y},${pos.z}`) ?? []).some((i) => i.name === name && i.count < 64 && !/_(pickaxe|axe|sword|shovel|hoe|helmet|chestplate|leggings|boots)$|^shield$|_bed$/.test(name));
  },
  /**
   * Where an item goes into storage: its category chest, else (that one is full) misc, else any
   * storage chest that still has room; null when all storage is full. A full category chest asks
   * for a new chest (storageJob).
   */
  depositTarget(name) {
    const st = this.base.storage;
    const cat = this.storageCategory(name);
    const own = st[cat] ?? st.misc;
    if (this.chestTakes(own, name)) return own;
    noteFull(cat);
    for (const k of ['misc', 'stone', 'wood', 'food', 'ores']) if (st[k] && k !== cat && this.chestFree(st[k]) > 2) return st[k];
    return null;
  },
  /** Low-value things the market takes off the colonists' hands (for nothing) when storage is full. */
  isJunk: (name) => JUNK.test(name),
  /** A storage chest is full: whoever has wood makes a new chest and puts it next to it (a double chest). */
  storageJob(c) {
    const col = state.colony;
    const want = Object.keys(storageWanted).find((cat) => !col.storageExtra?.[cat]);
    if (!want) return null;
    const j = storageWanted[want];
    if (j.who && j.who !== c.name && colonists.get(j.who)?.running && Date.now() - j.claimedAt < 90000) return null;
    if (Date.now() < (j.retryAt ?? 0)) return null;
    const planks = I.count(c.bot, I.PLANKS) + 4 * I.count(c.bot, I.LOG);
    if (!I.find(c.bot, 'chest') && planks < 8) return null;
    if (j.who !== c.name) {
      j.who = c.name;
      j.claimedAt = Date.now();
    }
    const p = col.storage[want];
    return { cat: want, spot: V({ x: p.x + 1, y: p.y, z: p.z }), main: V(p), first: !j.announced };
  },
  /** The new chest is down (or the attempt failed): make sure it pairs with the old one. */
  async storageChestPlaced(c, job, ok) {
    const j = storageWanted[job.cat];
    if (!j) return;
    j.announced = true;
    const q = job.spot;
    const placed = /passed/i.test(await cmd(`execute if block ${q.x} ${q.y} ${q.z} chest`).catch(() => ''));
    if (placed) {
      // a hand-placed chest may face the wrong way and stay single: turn it (it is still empty)
      if (!/passed/i.test(await cmd(`execute if block ${job.main.x} ${job.main.y} ${job.main.z} chest[type=right]`).catch(() => ''))) await cmd(`setblock ${q.x} ${q.y} ${q.z} chest[facing=south,type=left]`);
      if (/passed/i.test(await cmd(`execute if block ${job.main.x} ${job.main.y} ${job.main.z} chest[type=right]`).catch(() => ''))) {
        state.colony.storageExtra ??= {};
        state.colony.storageExtra[job.cat] = { x: q.x, y: q.y, z: q.z };
        chestSlots.set(`${job.main.x},${job.main.y},${job.main.z}`, 54);
        delete storageWanted[job.cat];
        log(`storage: ${c.name} made the ${job.cat} chest a double chest${ok ? '' : ' (with help)'}`);
        event('wild.ev.chest', { name: c.name });
        save();
        return;
      }
    }
    j.who = null;
    j.retryAt = Date.now() + 60000;
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
  /**
   * The colonist's bed: its own bed in a finished house (assigned once, reassigned when the owner is
   * gone), else a camp bed by the fire (only until there are enough house beds).
   */
  bedFor(c) {
    if (!c.bot || !state.colony) return null;
    const own = houseBedOf(c);
    if (own) return own.bed;
    const beds = state.colony.bedsPlaced ?? [];
    if (!beds.length) return null;
    const idx = [...colonists.keys()].indexOf(c.name) % beds.length;
    return V(beds[idx]);
  },
  houseOf: (c) => houseBedOf(c),
  /**
   * Why the colonist should sleep tonight, or null (then it works a safe night shift):
   *   'insomnia' — two nights or more without sleep (phantoms would come; not when they are off),
   *   'skip'     — the night is dangerous around the colony's work and everyone agrees to sleep it
   *                through (only when no real player is awake: they would have to sleep too),
   *   'hurt'     — low health.
   */
  sleepNeed(c) {
    if (!c.bot?.time) return null;
    if (c.bot.health <= 8) return 'hurt';
    if (nightPlan.skip === nightOf(c.bot)) return 'skip';
    if (phantomsOn && this.nightsAwake(c) >= 2) return 'insomnia';
    return null;
  },
  nightsAwake(c) {
    const day = nightOf(c.bot);
    state.colony.slept ??= {};
    const last = state.colony.slept[c.name] ?? (state.colony.slept[c.name] = day); // a newcomer starts rested
    return day - last;
  },
  noteSlept(c) {
    state.colony.slept ??= {};
    state.colony.slept[c.name] = nightOf(c.bot);
    save();
  },
  /** A camp bed by the fire (fallback when the house bed cannot be reached tonight). */
  campBed(c) {
    const beds = state.colony?.bedsPlaced ?? [];
    if (!beds.length) return null;
    const idx = [...colonists.keys()].indexOf(c.name) % beds.length;
    return V(beds[idx]);
  },
  /** The finished house whose inside (incl. the attic) contains p, or null. */
  houseAt(p) {
    for (const h of state.projects) {
      if (!h.done || h.type !== 'cabin') continue;
      const o = h.origin;
      if (p.x >= o.x + 2 && p.x < o.x + 9 && p.z >= o.z + 2 && p.z < o.z + 11 && p.y >= o.y + 1 && p.y < o.y + 9) return houseCells(h);
    }
    return null;
  },
  /** A camp bed nobody needs any more (everyone online has a house bed): dismantle it. */
  tidyJob(c) {
    const camp = state.colony?.bedsPlaced ?? [];
    // two camp beds stay by the fire: the fallback when a house bed cannot be reached
    if (camp.length <= 2 || !houseBedOf(c)) return null;
    const online = [...colonists.values()].filter((x) => x.running && !x.helper);
    if (online.some((x) => !houseBedOf(x))) return null;
    return { spot: V(camp[0]), done: () => this.bedMissing(c, V(camp[0])) };
  },
  // looting chests of structures around the colony (ruined portals, mineshafts, villages, wrecks)
  noteChests(c) {
    if (!state.colony || !c.bot?.entity) return;
    const bot = c.bot;
    const ids = ['chest', 'barrel', 'trapped_chest'].map((n) => bot.registry.blocksByName[n]?.id).filter((x) => x != null);
    const ours = new Set([...Object.values(state.colony.storage), ...Object.values(state.colony.storageExtra ?? {}), state.colony.market].map((p) => `${p.x},${p.y},${p.z}`));
    const home = this.home();
    state.looted ??= {};
    const extra = Object.values(state.colony.storageExtra ?? {}).map((p) => `${p.x},${p.y},${p.z}`);
    for (const p of bot.findBlocks({ matching: ids, maxDistance: 64, count: 16 })) {
      const key = `${p.x},${p.y},${p.z}`;
      const old = state.looted[key];
      // done, or given up for good (dungeon, lava, too deep); "unreachable" is tried again later, twice
      if (old && (old.reason !== 'unreachable' || (old.tries ?? 1) >= 3 || Date.now() - old.t < 900000)) continue;
      if (ours.has(key) || extra.includes(key) || this.isProtected(p) || p.distanceTo(home) > 96) continue;
      if (lootTargets.has(key)) continue;
      const place = placeKind(bot, p);
      // structures on the surface only: a chest deep in the rock (or by a spawner) is not worth digging to
      const surface = p.y >= home.y - 12;
      if (place === 'dungeon' || !surface) {
        state.looted[key] = { t: Date.now(), by: null, place, items: 0, reason: place === 'dungeon' ? 'dungeon' : 'deep' };
        log(`chest at ${key} (${place}) skipped: ${state.looted[key].reason}`);
        save();
        continue;
      }
      lootTargets.set(key, { pos: p, place, by: null, tries: (old?.tries ?? 0) });
      log(`chest found at ${key} (${place})`);
    }
  },
  lootJob(c) {
    let best = null;
    for (const [key, tgt] of lootTargets) {
      if (tgt.by && tgt.by !== c.name && colonists.get(tgt.by)?.running) continue;
      const d = tgt.pos.distanceTo(c.bot.entity.position);
      if (!best || d < best.d) best = { key, tgt, d };
    }
    if (!best) return null;
    best.tgt.by = c.name;
    return { ...best.tgt, key: best.key };
  },
  lootDone(c, job, items, reason) {
    lootTargets.delete(job.key);
    state.looted ??= {};
    state.looted[job.key] = { t: Date.now(), by: c.name, place: job.place, items: items.length, reason, tries: (job.tries ?? 0) + 1 };
    if (items.length) {
      this.stat('chestsLooted', 1);
      event('wild.ev.loot', { name: c.name, place: job.place, what: items.slice(0, 4) });
    }
    save();
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
  /**
   * Fallback when a leaving colonist could not deposit everything (stuck, far away, chests full):
   * every item it still carries (armour and off-hand too) is moved server-side, unchanged (durability,
   * enchantments), into a free slot of a storage chest — its category first — or into the bag of a
   * colonist who stays. Returns how many stacks are still left on the colonist.
   */
  async handOver(c) {
    const bot = c.bot;
    if (!bot?.entity || c.dead || !state.colony || c.handingOver) return -1;
    c.handingOver = true;
    try {
      const slotName = (i) => ({ 5: 'armor.head', 6: 'armor.chest', 7: 'armor.legs', 8: 'armor.feet', 45: 'weapon.offhand' })[i] ?? `container.${i >= 36 ? i - 36 : i}`;
      const carried = bot.inventory.slots.map((it, i) => (it && i >= 5 && i <= 45 ? { it, i } : null)).filter(Boolean);
      if (!carried.length) return 0;
      const free = new Map(); // "x y z" -> [free slot numbers]
      const freeIn = async (p) => {
        const key = `${p.x} ${p.y} ${p.z}`;
        if (!free.has(key)) {
          const probe = await cmd(`data get block ${key}`).catch(() => '');
          if (!/following block data/.test(probe) || !/chest|barrel/.test(c.bot.blockAt(new Vec3(p.x, p.y, p.z))?.name ?? 'chest')) free.set(key, []);
          else {
            const used = new Set((await readChest(p)).map((x) => x.slot));
            free.set(key, [...Array(27).keys()].filter((k) => !used.has(k)));
          }
        }
        return free.get(key);
      };
      const stayers = [...colonists.values()].filter((x) => x !== c && x.running && !x.dead && x.mode !== 'leaving' && x.bot?.entity);
      const ok = (out) => /replaced|applied|modified/i.test(out ?? '') && !/no |not |error|unknown|invalid/i.test(out ?? '');
      let moved = 0;
      let left = 0;
      for (const { it, i } of carried) {
        const from = `from entity ${c.name} ${slotName(i)}`;
        const cats = [this.storageCategory(it.name), 'misc', 'stone', 'wood', 'food', 'ores'];
        let done = false;
        const chests = [...new Set(cats)].flatMap((cat) => [state.colony.storage[cat], state.colony.storageExtra?.[cat]]).filter(Boolean);
        for (const p of chests) {
          const slots = await freeIn(p);
          if (!slots.length) continue;
          const k = slots.shift();
          if (ok(await cmd(`item replace block ${p.x} ${p.y} ${p.z} container.${k} ${from}`).catch((e) => e.message))) {
            done = true;
            break;
          }
        }
        for (const o of done ? [] : stayers) {
          const k = o.bot.inventory.slots.findIndex((x, j) => j >= 9 && j <= 44 && !x && !o.reservedSlots?.has(j));
          if (k < 0) continue;
          (o.reservedSlots ??= new Set()).add(k);
          setTimeout(() => o.reservedSlots?.delete(k), 5000);
          if (ok(await cmd(`item replace entity ${o.name} ${slotName(k)} ${from}`).catch((e) => e.message))) {
            done = true;
            break;
          }
        }
        if (done) {
          await cmd(`item replace entity ${c.name} ${slotName(i)} with air`).catch(() => {});
          moved++;
        } else left++;
      }
      if (moved) {
        log(`${c.name} handed over ${moved} stack(s) by RCON${left ? `, ${left} left (no room)` : ''}`);
        this.stat('handedOver', moved);
        for (const p of Object.values(state.colony.storage)) {
          const items = await readChest(p);
          storageSnap.set(`${p.x},${p.y},${p.z}`, items.map((x) => ({ name: x.id, count: x.count })));
        }
      }
      return left;
    } finally {
      c.handingOver = false;
    }
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
    state.credits = Math.round((state.credits - price * 6) * 100) / 100; // reserved now: no overspending
    state.spent += price * 6;
    try {
      await c.goHome(4);
      await c.goNear(this.base.market, 2, { timeout: 20000 });
    } catch (e) {
      state.credits += price * 6;
      state.spent -= price * 6;
      throw e;
    }
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
  const now = Date.now();
  const active = (sid) => {
    const s = state.sessions[sid];
    return s && !s.ended && now - s.lastEvent < cfg.leaveAfterMinutes * 60000;
  };
  // names of chats that are over go back to the pool
  for (const [sid, n] of Object.entries(state.names)) if (sid !== sessionId && !active(sid) && !colonists.has(n)) delete state.names[sid];
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

/**
 * A storage chest that is nearly full becomes a double chest (a second half placed east of it; the
 * old half keeps its items). Without room, deposits fail and colonists would carry things forever.
 */
async function expandStorage() {
  const col = state.colony;
  if (!col) return;
  col.storageExtra ??= {};
  for (const [cat, p] of Object.entries(col.storage)) {
    if (col.storageExtra[cat]) continue;
    const used = storageSnap.get(`${p.x},${p.y},${p.z}`)?.length ?? 0;
    if (used >= 24) noteFull(cat);
    // a colonist with wood makes the chest (storageJob); the colony steps in after 3 minutes
    if (!storageWanted[cat] || Date.now() - storageWanted[cat].since < 180000) continue;
    const q = { x: p.x + 1, y: p.y, z: p.z };
    const free = await cmd(`execute if block ${q.x} ${q.y} ${q.z} air`).catch(() => '');
    if (!/passed/i.test(free)) continue;
    await cmd(`setblock ${q.x} ${q.y} ${q.z} chest[facing=south,type=left]`);
    const ok = await cmd(`execute if block ${p.x} ${p.y} ${p.z} chest[type=right]`).catch(() => '');
    if (!/passed/i.test(ok)) {
      await cmd(`setblock ${q.x} ${q.y} ${q.z} air`).catch(() => {});
      continue;
    }
    col.storageExtra[cat] = q;
    chestSlots.set(`${p.x},${p.y},${p.z}`, 54);
    delete storageWanted[cat];
    log(`storage: the ${cat} chest is now a double chest (placed by the colony)`);
    save();
  }
}

// ------------------------------------------------------------------ night
// Sleep is a need, not a schedule: by default colonists work a safe night shift (mines, smelting,
// the lit farm, guarding the plaza) and sleep when insomnia nears, when hurt, or when the whole colony
// agrees to skip a dangerous night. players_sleeping_percentage is 100, so the night only passes when
// every player sleeps — a real player who is awake (not a spectator) keeps it, and then nobody tries.
let phantomsOn = true;
const nightPlan = { skip: -1, checked: -1 };
/** Day number of the current (or last) night: the evening and the following early morning share it. */
const nightOf = (bot) => Math.floor(((bot?.time?.time ?? 0) - 12000) / 24000);

async function planNight() {
  const list = [...colonists.values()].filter((c) => c.running && !c.dead && c.bot?.entity && c.mode !== 'leaving');
  const bot = list[0]?.bot;
  if (!bot?.time) return;
  const tod = bot.time.timeOfDay;
  const night = !(tod < 12500 || tod > 23400);
  const n = nightOf(bot);
  if (!night || nightPlan.skip === n || tod > 21000) return;
  // danger near the colony's work: hostiles within 16 blocks of the colonists (each counted once)
  const seen = new Set();
  for (const c of list)
    for (const e of Object.values(c.bot.entities)) {
      if (e === c.bot.entity || !c.combat?.isHostile(e) || seen.has(e.id)) continue;
      if (e.position.distanceTo(c.bot.entity.position) < 16) seen.add(e.id);
    }
  const awake = (await onlinePlayers()).filter((p) => (bot.players[p]?.gamemode ?? 0) !== 3);
  const dangerous = seen.size >= Math.max(3, list.length);
  if (nightPlan.checked !== n) {
    nightPlan.checked = n;
    log(`night ${n}: ${seen.size} hostiles around, ${awake.length} real player(s) awake; sleepers: ${list.filter((c) => colony.sleepNeed(c)).map((c) => `${c.name} (${colony.sleepNeed(c)})`).join(', ') || 'none'}`);
    if (!dangerous) chatter.say(list[Math.floor(Math.random() * list.length)], 'nightShift', {});
  }
  if (dangerous && !awake.length && list.length) {
    nightPlan.skip = n;
    log(`night ${n}: ${seen.size} hostiles around the colony — everyone sleeps it through`);
    const c = list.find((x) => !x.helper) ?? list[0];
    chatter.say(c, 'nightVote', {}, { urgent: true });
    event('wild.ev.nightSkip', { n: seen.size });
  }
}

/** Sends a colonist home for good: it deposits everything it carries, then disconnects (doLeave). */
function retire(c, why) {
  if (c.mode === 'leaving') return;
  c.mode = 'leaving';
  c.leavingSince = Date.now();
  if (colony.builder === c) colony.builder = null;
  log(`${c.name} retires (${why}): deposits its things, then leaves`);
  c.interrupt?.('leaving');
}

/**
 * The pool shrank (lower cap, fewer active chats): the surplus colonists retire — helpers first, then
 * the colonists of the chats idle the longest; the builder last.
 */
function trimPool() {
  const staying = [...colonists.values()].filter((c) => c.mode !== 'leaving' && !spawning.has(c.name));
  const extra = staying.length - settingsNow.colonistsMax;
  if (extra <= 0) return;
  const last = (c) => state.sessions[c.sessionId]?.lastEvent ?? 0;
  staying.sort((a, b) => b.helper - a.helper || (a === colony.builder) - (b === colony.builder) || (b.mode === 'home') - (a.mode === 'home') || last(a) - last(b));
  for (const c of staying.slice(0, extra)) retire(c, `cap ${settingsNow.colonistsMax}`);
}

/** A leaving colonist that has not managed to leave in 4 minutes: hand its things over by RCON, disconnect. */
async function leaveWatchdog() {
  const now = Date.now();
  for (const c of colonists.values()) {
    if (c.mode !== 'leaving' || !c.running) continue;
    c.leavingSince ??= now;
    if (now - c.leavingSince < 240000 || c.forcedOut) continue;
    c.forcedOut = true;
    log(`${c.name} did not get home to leave: things handed over by RCON`);
    await colony.handOver(c).catch((e) => log('hand over failed', e.message));
    colony.colonistLeft(c);
    c.quit('leaving');
  }
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
  if ([...colonists.values()].filter((x) => x.mode !== 'leaving').length >= poolCap()) {
    // free a slot: the colonist of the chat that has been idle the longest goes to the tavern
    const idle = [...colonists.values()].filter((x) => x.mode === 'home' && !x.helper).sort((a, b) => (state.sessions[a.sessionId]?.lastEvent ?? 0) - (state.sessions[b.sessionId]?.lastEvent ?? 0))[0];
    const helper = [...colonists.values()].find((x) => x.helper);
    const victim = helper ?? idle;
    if (!victim) return;
    retire(victim, 'slot for an active chat');
    return;
  }
  spawning.add(name);
  try {
    await spawnColonist({ name, session: s });
  } finally {
    spawning.delete(name);
  }
}

async function spawnColonist({ name, session, helper = false, parent = null, leaving = false }) {
  const c = new Colonist({ name, colony, helper, chatName: session.chatName ?? '' });
  c.sessionId = session.id;
  if (leaving) {
    c.mode = 'leaving'; // a retiree: deposits, then disconnects
    c.leavingSince = Date.now();
  }
  if (helper) {
    c.parentSession = session.id;
    c.parentName = parent;
  }
  colonists.set(name, c);
  try {
    await c.connect();
  } catch (e) {
    colonists.delete(name);
    throw e;
  }
  log(`${name} joined${helper ? ` (helper of ${parent})` : ''}${leaving ? ' to hand in its things' : ''} for chat ${session.chatName ?? session.id.slice(0, 8)}`);
  await cmd(`gamemode survival ${name}`);
  await setNametag(c, helper ? t('wild.tag.helper', { parent }) : session.chatName ?? t('wild.tag.chat', { id: session.id.slice(0, 4) }));
  if (!state.colony) {
    await found(c);
  } else if (c.bot.entity.position.distanceTo(colony.home()) > 64) {
    const h = colony.home();
    await cmd(`tp ${name} ${h.x} ${h.y} ${h.z}`);
  }
  colony.ready = true;
  if (!leaving) {
    chatter.say(c, helper ? 'helperJoin' : 'hello', { name, parent }, { urgent: true });
    event(helper ? 'wild.ev.joinedHelper' : 'wild.ev.joined', { name, parent });
  }
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
    const items = await readChest(m);
    if (!items.length) return;
    let total = 0;
    const what = [];
    for (const it of items) {
      const price = sellPrice(it.id, cfg.creditMultiplier);
      if (price <= 0) {
        // junk handed in because storage is full: Märt takes it away for nothing
        if (JUNK.test(it.id)) {
          await cmd(`item replace block ${m.x} ${m.y} ${m.z} container.${it.slot} with air`);
          state.stats.junkTakenAway = (state.stats.junkTakenAway ?? 0) + it.count;
        }
        continue;
      }
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

/**
 * Items of a container block, one RCON call per entry: `data get ... Items` shortens long lists ("..."),
 * so the whole list would lose everything after the first entries. [{slot, id, count}]
 */
async function readChest(p) {
  const items = [];
  for (let i = 0; i < 54; i++) {
    const out = await cmd(`data get block ${p.x} ${p.y} ${p.z} Items[${i}]`).catch(() => '');
    const it = parseItems(`[${out.slice(out.indexOf('{'))}]`)[0];
    if (!it || !/following block data/.test(out)) break;
    items.push(it);
  }
  return items;
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
    // the watcher(s): `spectators` in wild-config.json, or (empty) every real player — the server only
    // listens on 127.0.0.1, so whoever joins is the owner
    if (!cfg.spectators?.length || cfg.spectators.includes(n)) {
      await cmd(`op ${n}`);
      state.tpDone ??= {};
      if (state.colony && !state.tpDone[n]) {
        state.tpDone[n] = true; // once ever (saved); afterwards only the player's own [tp]/[follow] clicks move them
        save();
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
    parts.push({ text: ` · ${ROLE_ICON[c.role] ?? ''} ${t(`wild.role.${c.role}`)} · ${taskText(c.task)} `, color: 'gray' });
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

// Tab list: each colonist's team suffix carries chat name, role, health and task (updated on change).
// Sidebar: the colony's economy panel (day, food, wood, stone, iron, till, deaths today, construction).
const ROLE_ICON = { miner: '⛏', lumberjack: '🪓', farmer: '🌾', hunter: '🏹', guard: '🛡', builder: '🔨' };
const tabSuffix = new Map();
async function updateTab() {
  for (const c of colonists.values()) {
    if (!c.running || !c.bot?.entity) continue;
    const s = state.sessions[c.sessionId];
    const chat = c.helper ? t('wild.tag.helper', { parent: c.parentName ?? '' }) : s?.chatName ?? t('wild.tag.chat', { id: (c.sessionId ?? '').slice(0, 4) });
    const hp = c.dead ? '☠' : `❤${Math.round(c.bot.health ?? 0)}`;
    const text = ` · ${chat} · ${ROLE_ICON[c.role] ?? ''} ${t(`wild.role.${c.role}`)} ${hp} · ${taskText(c.task)}`;
    if (tabSuffix.get(c.name) === text) continue;
    tabSuffix.set(c.name, text);
    const team = `w_${c.name}`.slice(0, 16);
    await cmd(`team modify ${team} suffix ${JSON.stringify({ text, color: 'gray' })}`).catch(() => {});
  }
}

/** Short localized description of an action id ("mine:iron" -> "mining iron"). */
function taskText(task) {
  const [kind, arg] = String(task ?? '').split(':');
  const what = arg ? (t(`wild.what.${arg}`) !== `wild.what.${arg}` ? t(`wild.what.${arg}`) : itemName(arg)) : '';
  const key = `wild.task.${kind}`;
  const s = t(key, { what });
  return s === key ? kind : s;
}

const panelLines = new Map();
let panelReady = false;
async function updatePanel() {
  if (!panelReady) {
    await cmd(`scoreboard objectives add colony dummy ${JSON.stringify({ text: t('wild.sidebar.title'), color: 'gold' })}`).catch(() => {});
    await cmd('scoreboard objectives add colony_list trigger').catch(() => {});
    panelReady = true;
  }
  // re-applied every time: cheap, and survives a server-side reset of the display slot
  await cmd(`scoreboard objectives modify colony displayname ${JSON.stringify({ text: t('wild.sidebar.title'), color: 'gold' })}`);
  await cmd('scoreboard objectives setdisplay sidebar colony');
  await cmd('scoreboard objectives modify colony numberformat blank');
  const anyBot = [...colonists.values()].find((c) => c.running && c.bot?.time)?.bot;
  const day = anyBot ? Math.floor((anyBot.time.age ?? 0) / 24000) + 1 : 1;
  const night = anyBot ? !(anyBot.time.timeOfDay < 12500 || anyBot.time.timeOfDay > 23400) : false;
  const food = colony.storageCount(/^cooked_|^bread$|^baked_potato$|^apple$|^carrot$/) + [...colonists.values()].reduce((n, c) => n + (c.bot?.entity ? I.foodCount(c.bot) : 0), 0);
  const today = deathLog.filter((d) => Date.now() - d.t < 20 * 60000).length; // a Minecraft day is 20 minutes
  const pr = state.projects.find((x) => !x.done);
  const done = state.projects.filter((x) => x.done).length;
  const rows = [
    ['day', 'gold', { day, n: colonists.size }],
    night ? ['night', 'aqua', {}] : null,
    ['food', 'white', { n: food }],
    ['wood', 'white', { n: colony.storageCount(I.LOG) + Math.floor(colony.storageCount(I.PLANKS) / 4) }],
    ['stone', 'white', { n: colony.storageCount(I.STONE_DROP) }],
    ['iron', 'white', { n: colony.storageCount(/^iron_ingot$/) + colony.storageCount(/^raw_iron$/) }],
    ['coal', 'white', { n: colony.storageCount(/^coal$|^charcoal$/) }],
    ['till', 'yellow', { credits: state.credits.toFixed(0) }],
    ['deaths', today ? 'red' : 'gray', { n: today }],
    pr ? ['building', 'green', { house: t(`wild.house.${pr.type}`), pct: Math.floor((100 * pr.placed) / pr.total) }] : null,
    ['houses', 'gray', { n: done }],
  ].filter(Boolean);
  const want = new Map();
  rows.forEach(([key, color, params], i) => want.set(`wild_p${String(i).padStart(2, '0')}`, { score: 50 - i, text: { text: t(`wild.panel.${key}`, params), color } }));
  for (const [holder, line] of want) {
    const k = JSON.stringify(line);
    if (panelLines.get(holder) === k) continue;
    panelLines.set(holder, k);
    await cmd(`scoreboard players set ${holder} colony ${line.score}`);
    await cmd(`scoreboard players display name ${holder} colony ${JSON.stringify(line.text)}`);
  }
  for (const holder of [...panelLines.keys()]) {
    if (want.has(holder)) continue;
    panelLines.delete(holder);
    await cmd(`scoreboard players reset ${holder} colony`);
  }
  // [refresh list] trigger
  for (const n of await onlinePlayers()) {
    const out = await cmd(`scoreboard players get ${n} colony_list`).catch(() => '');
    const m = out.match(/has (\d+)/);
    if (m && Number(m[1]) > 0) {
      await cmd(`scoreboard players set ${n} colony_list 0`);
      await cmd(`scoreboard players enable ${n} colony_list`);
      await sendList(n);
    }
  }
}

async function buyBeds() {
  const col = state.colony;
  if (!col) return;
  const placed = (col.bedsPlaced ?? []).length + (col.placeJobs ?? []).filter((j) => /_bed$/.test(j.item)).length;
  const homeless = [...colonists.values()].filter((x) => x.running && !x.helper && !houseBedOf(x)).length;
  const want = Math.min(homeless, col.beds.length);
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
  if (typeof p.place === 'string') p.place = t(`wild.place.${p.place}`);
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
  'gamerule players_sleeping_percentage 100', 'gamerule send_command_feedback false', 'gamerule advance_time true',
  'gamerule spawn_monsters true', 'gamerule show_death_messages true',
]) {
  const out = await cmd(c).catch((e) => e.message);
  if (/unknown|incorrect|invalid/i.test(out)) log(`${c}: ${out}`);
}
{
  // phantoms (insomnia) on? Then colonists must sleep at least every third night.
  const out = (await cmd('gamerule spawn_phantoms').catch(() => '')) || '';
  const legacy = /unknown|incorrect|invalid/i.test(out) ? await cmd('gamerule doInsomnia').catch(() => '') : out;
  phantomsOn = !/false/i.test(legacy);
  log(`phantoms ${phantomsOn ? 'on' : 'off'} (${legacy.trim()})`);
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
  const back = recent.slice(0, settingsNow.colonistsMax);
  // colonists that were online before the restart but no longer fit under the cap come back once
  // to put what they carry into storage, then leave
  const keep = new Set(back.map((s) => state.names[s.id]));
  const retirees = (state.online ?? []).filter((o) => o.name && !keep.has(o.name) && state.sessions[o.session] && state.names[o.session] === o.name);
  (async () => {
    for (const s of back) await ensureColonist(s).catch((e) => log('respawn failed', e.message));
    for (const o of retirees) {
      if (colonists.has(o.name)) continue;
      await spawnColonist({ name: o.name, session: state.sessions[o.session], leaving: true }).catch((e) => log(`retiree ${o.name} failed`, e.message));
    }
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
    if (tickN % 3 === 2) await updatePanel();
    if (tickN % 3 === 0) await updateTab();
    if (tickN % 180 === 90) for (const n of await onlinePlayers()) await sendList(n);
    if (tickN % 5 === 2) await buyBeds();
    if (tickN % 5 === 4) await builder.tick();
    if (tickN % 5 === 3) assignRoles();
    if (tickN % 15 === 7) for (const c of colonists.values()) if (c.running && !c.dead) colony.noteChests(c);
    if (tickN % 5 === 1) await caretaker();
    if (tickN % 5 === 0 && colony.ready) trimPool();
    if (tickN % 5 === 0) await leaveWatchdog();
    if (tickN % 15 === 11) await expandStorage();
    if (tickN % 5 === 3) await planNight();
    if (tickN % 15 === 0) {
      // who is online (and carries the colony's things): a restart with a lower cap lets the extra ones retire
      const online = [...colonists.values()].filter((c) => c.running && !c.helper && c.mode !== 'leaving').map((c) => ({ name: c.name, session: c.sessionId }));
      if (JSON.stringify(online) !== JSON.stringify(state.online ?? [])) {
        state.online = online;
        save();
      }
    }
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
