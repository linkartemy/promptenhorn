// A colonist: one survival bot driven by a utility AI (bots/wild/brain.mjs), no LLM.
//
// Reflex layer (every 250 ms): danger -> interrupt the current action; drowning -> surface; watchdog.
// Brain: candidate actions score their urgency (danger, health, hunger, inventory, tools, night, role);
// the best one runs for a bounded time, then everything is re-evaluated.
// Skills here: movement with stuck recovery, combat/flee/retreat, eating, death recovery, categorized
// storage and the market, a standard kit, crafting and the tool/armour ladder with durability care,
// smelting, the colonist's own mine, woodcutting, farming (wheat, bread), hunting (campfire cooking).
import { createRequire } from 'node:module';
import { Vec3 } from 'vec3';
import { makeBot, walkTo, sleep, Interrupted } from './net.mjs';
import { Combat } from './combat.mjs';
import { Mine } from './mine.mjs';
import { chooseUtility, chooseNaive, TOOL_RECIPE } from './brain.mjs';
import * as I from './items.mjs';
import { mobName } from '../../wild/lines.mjs';

const require = createRequire(import.meta.url);
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');

const DESPAWN_SAFE_MS = 270000; // dropped items vanish after 5 min; give up recovery a bit earlier
const CAUSES = [
  [/drown/, 'drown'], [/lava/, 'lava'], [/inFire|onFire|fire/, 'fire'], [/fall|fell/, 'fall'], [/explosion/, 'explosion'],
  [/starve/, 'starve'], [/inWall|cramming/, 'suffocate'], [/arrow|mob|player|sting/, 'mob'],
];

export class Colonist {
  /**
   * @param {object} o
   * @param {string} o.name ASCII username
   * @param {object} o.colony the colony orchestrator (base layout, chat, RCON, market, builder)
   */
  constructor({ name, colony, helper = false, chatName = '' }) {
    this.name = name;
    this.colony = colony;
    this.helper = helper;
    this.chatName = chatName;
    this.mode = 'work'; // work | home | leaving
    this.role = helper ? 'lumberjack' : 'lumberjack';
    this.task = 'connecting';
    this.stats = { deaths: 0, recovered: 0, kills: 0, logs: 0, stone: 0, ores: 0, crafted: 0, placedHand: 0, placedRcon: 0, deposits: 0, gifts: 0, meals: 0, slept: 0, fled: 0, wheat: 0, cooked: 0 };
    this.metrics = { connectedMs: 0, work: 0, survival: 0, idle: 0, social: 0, failedMs: 0, foodCriticalMs: 0, minFood: 20, samples: 0 };
    this.deathRecord = null;
    this.dead = false;
    this.running = false;
    this.interruptWhy = null;
    this.lastGreet = new Map();
    this.boost = 0; // productivity level from chat activity (haste is applied by the colony)
    this.mood = 0; // -3 .. +3 flavour
    this.seen = new Set(); // one-time announcements
  }

  log(...a) {
    this.colony.log(`[${this.name}]`, ...a);
  }

  dbg(...a) {
    if (this.colony.cfg.dev) this.log(...a);
  }

  say(key, vars = {}, opts = {}) {
    this.colony.say(this, key, vars, opts);
  }

  isDay() {
    const t = this.bot?.time?.timeOfDay ?? 0;
    return t < 12500 || t > 23400;
  }

  hasShield() {
    return this.bot?.inventory?.slots?.[45]?.name === 'shield' || !!I.find(this.bot, 'shield');
  }

  // ------------------------------------------------------------------ lifecycle

  async connect() {
    const cfg = this.colony.cfg;
    this.bot = await makeBot({ host: cfg.mcHost, port: cfg.mcPort, username: this.name, viewDistance: cfg.botViewDistance });
    const bot = this.bot;
    await this.colony.onSpawned?.(this); // far from the colony (old position): bring it home before anything bites
    bot.loadPlugin(pathfinder);
    this.combat = new Combat(this);
    this.mine = new Mine(this);
    this.setupMovements();
    bot.on('death', () => this.onDeath());
    bot.on('spawn', () => {
      if (this.dead) this.onRespawn();
    });
    bot.on('kicked', (r) => this.log('kicked', typeof r === 'string' ? r : JSON.stringify(r).slice(0, 200)));
    bot.on('end', (why) => {
      this.running = false;
      clearInterval(this.reflexTimer);
      this.log('disconnected', why ?? '');
      this.colony.onColonistGone(this);
    });
    bot.on('error', (e) => this.log('error', e.message));
    bot.on('message', (json) => this.onSystemMessage(json));
    bot.on('chat', (user, msg) => this.onChat(user, msg));
    bot.on('health', () => {
      if (bot.health < 8 && bot.health > 0 && !this._hurtSaid) {
        this._hurtSaid = true;
        this.say('hurt', { hp: Math.ceil(bot.health / 2) }, { urgent: true });
        setTimeout(() => (this._hurtSaid = false), 30000);
      }
    });
    bot.on('wake', () => {
      if (this.task === 'sleep') this.say('morning');
    });
    await bot.waitForChunksToLoad?.().catch(() => {});
    this.running = true;
    this.connectedAt = Date.now();
    this.lastTick = Date.now();
    this.reflexTimer = setInterval(() => this.reflex(), 250);
    this.loop();
    return this;
  }

  quit(reason = 'bye') {
    this.running = false;
    clearInterval(this.reflexTimer);
    try {
      this.bot?.quit(reason);
    } catch {}
  }

  setupMovements() {
    const bot = this.bot;
    const m = new Movements(bot);
    const reg = bot.registry;
    m.canDig = true;
    m.allowParkour = false;
    m.allowSprinting = true;
    m.maxDropDown = 3; // no fall damage
    m.allow1by1towers = true;
    m.liquidCost = 25;
    m.scafoldingBlocks = ['dirt', 'cobblestone', 'cobbled_deepslate', 'netherrack'].map((n) => reg.itemsByName[n]?.id).filter(Boolean);
    for (const n of ['ice', 'packed_ice', 'blue_ice', 'chest', 'furnace', 'crafting_table', 'campfire', 'barrel', 'lantern', 'torch', 'wall_torch', 'smoker', 'farmland', 'wheat', 'red_bed', 'white_bed', 'blue_bed', 'green_bed']) {
      const b = reg.blocksByName[n];
      if (b) m.blocksCantBreak.add(b.id);
    }
    // colonists walk around ponds instead of swimming (frozen ponds drown them), and never into lava
    for (const n of ['water', 'lava', 'powder_snow', 'magma_block', 'sweet_berry_bush', 'cactus']) if (reg.blocksByName[n]) m.blocksToAvoid.add(reg.blocksByName[n].id);
    const prot = (block) => (this.colony.isProtected(block.position) ? 100 : 0);
    m.exclusionAreasBreak = [prot];
    m.exclusionAreasPlace = [prot];
    bot.pathfinder.setMovements(m);
    bot.pathfinder.thinkTimeout = 10000;
    bot.pathfinder.tickTimeout = 20; // several bots share one event loop
    this.movements = m;
  }

  /** Stops whatever the bot is doing; the running action sees the interruption and returns. */
  interrupt(why) {
    if (this.interruptWhy) return;
    this.interruptWhy = why;
    const bot = this.bot;
    try {
      bot.pathfinder.setGoal(null);
      bot.stopDigging?.();
      bot.clearControlStates();
      bot.deactivateItem?.();
    } catch {}
  }

  check() {
    if (!this.running) throw new Interrupted('stopped');
    if (this.dead) throw new Interrupted('dead');
    if (this.interruptWhy) throw new Interrupted(this.interruptWhy);
  }

  reflex() {
    const bot = this.bot;
    const now = Date.now();
    const dt = now - (this.lastTick ?? now);
    this.lastTick = now;
    if (!this.running || !bot?.entity) return;
    this.metrics.connectedMs += dt;
    if (!this.dead) {
      if (bot.food <= 6) this.metrics.foodCriticalMs += dt;
      if (bot.food < this.metrics.minFood) this.metrics.minFood = bot.food;
    }
    if (this.dead) return;
    if (bot.entity.isInWater && (bot.oxygenLevel ?? 20) < 14 && this.task !== 'surface') return this.interrupt('drowning');
    if (this.taskStarted && now - this.taskStarted > 180000 && this.task !== 'sleep') {
      this.log(`watchdog: ${this.task} runs for ${Math.round((now - this.taskStarted) / 1000)} s at ${bot.entity.position.floored()}`);
      this.taskStarted = now;
      return this.interrupt('watchdog');
    }
    if (this.inCombat || this.task === 'sleep') return;
    const t = this.combat.threat(this.mode === 'home' ? 14 : 10);
    if (t) {
      this.pendingThreat = t;
      this.interrupt('combat');
    } else if (this.brain() === 'utility' && bot.health <= 6 && !/^flee|^retreat|^eat/.test(this.task) && I.bestFood(bot, { allowRaw: true })) {
      this.interrupt('hurt');
    }
  }

  brain() {
    return this.colony.cfg.brain === 'naive' ? 'naive' : 'utility';
  }

  /** The threat the reflex saw (if still around), else the current most dangerous hostile. */
  takeThreat() {
    const bot = this.bot;
    const p = this.pendingThreat;
    this.pendingThreat = null;
    if (p && p.isValid !== false && bot.entities[p.id]) return p;
    return this.combat.threat(10);
  }

  // ------------------------------------------------------------------ brain loop

  async loop() {
    while (this.running) {
      const bot = this.bot;
      if (this.dead || !bot.entity || !this.colony.ready) {
        await sleep(500);
        continue;
      }
      let step;
      const t0 = Date.now();
      try {
        step = this.brain() === 'naive' ? chooseNaive(this) : chooseUtility(this);
        if (this.colony.cfg.dev && step.name !== this.task) this.dbg(`→ ${step.name}${step.score != null ? ` (${step.score})` : ''}`);
        if (step.name !== this.task) this.taskStarted = Date.now();
        this.task = step.name;
        const res = await step.run();
        if (res && res.ok === false) this.metrics.failedMs += Date.now() - t0;
      } catch (e) {
        if (!e.interrupted) {
          this.metrics.failedMs += Date.now() - t0;
          this.log(`${this.task} failed: ${e.message}`);
          await sleep(1500);
        }
      } finally {
        if (step) this.metrics[step.cat ?? 'work'] += Date.now() - t0;
        this.interruptWhy = null;
        try {
          bot.clearControlStates();
        } catch {}
      }
      await sleep(50);
    }
  }

  // ------------------------------------------------------------------ movement

  async go(goal, opts = {}) {
    this.check();
    // leaving the own mine: walk its staircase out instead of asking A* to plan through rock
    if (!opts.inMine && this.mine && this.bot.entity.position.y < (this.mine.state()?.entrance?.y ?? -999) - 3) {
      const gy = goal.y ?? goal.entity?.position?.y;
      if (gy != null && gy > this.bot.entity.position.y + 3) await this.mine.exit().catch((e) => {
        if (e.interrupted) throw e;
      });
    }
    const res = await walkTo(this.bot, goal, { timeout: opts.timeout ?? 30000, retries: opts.retries ?? 3, shouldStop: () => !!this.interruptWhy || this.dead || !this.running, onStuck: () => this.unstick() });
    this.check();
    if (!res.ok) {
      this.walkFails = (this.walkFails ?? 0) + 1;
      this.dbg(`walk failed (${res.error}) from ${this.bot.entity.position.floored()} to ${goalText(goal)}`);
      // repeated failures from the same spot: boxed in -> last resort, the colony calls us home
      const here = this.bot.entity.position.floored().toString();
      if (this.lastFailSpot === here && (this.walkFails >= 5 || (res.stuck && this.walkFails >= 3))) {
        this.walkFails = 0;
        this.log(`stuck at ${here}; recalled home`);
        await this.colony.recall(this);
      }
      this.lastFailSpot = here;
    } else this.walkFails = 0;
    return res;
  }

  /** Re-centres the bot in its block cell by a server teleport (clears a client/server position fight). */
  async unstick() {
    const p = this.bot.entity.position;
    this.stats.unstuck = (this.stats.unstuck ?? 0) + 1;
    this.colony.stat('unstuck', 1);
    if (this.colony.cfg.dev) {
      const f = p.floored();
      const nb = [[0, 0, 0], [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].map(([x, y, z]) => this.bot.blockAt(f.offset(x, y, z))?.name ?? '?');
      this.dbg(`unstick at ${p.toString()} feet/head/below/E/W/S/N: ${nb.join(',')}`);
    }
    // the feet cell: on a path/slab the feet are slightly inside the block below's cell
    let y = Math.floor(p.y + 0.01);
    if (this.bot.blockAt(new Vec3(p.x, y, p.z))?.boundingBox === 'block') y++;
    await this.colony.rcon(`tp ${this.name} ${Math.floor(p.x) + 0.5} ${y} ${Math.floor(p.z) + 0.5}`);
    await sleep(300);
  }

  async goNear(pos, range = 2, opts) {
    return this.go(new goals.GoalNear(pos.x, pos.y, pos.z, range), opts);
  }

  async goHome(range = 4) {
    const h = this.colony.home();
    if (this.bot.entity.position.distanceTo(h) <= range + 1) return { ok: true };
    const r = await this.goNear(h, range, { timeout: 60000, retries: 4 });
    if (!r.ok && this.bot.entity.position.distanceTo(h) > 48) {
      this.log(`lost (${r.error}); recalled home`);
      await this.colony.recall(this);
    }
    return r;
  }

  // ------------------------------------------------------------------ combat & survival

  async fightTask(target, { naive = false } = {}) {
    this.inCombat = true;
    try {
      if (!this.seen.has(`warn:${target.id}`)) {
        this.seen.add(`warn:${target.id}`);
        if (target.name === 'creeper') this.say('creeper', {}, { urgent: true });
        else if (Math.random() < 0.4) this.say('mob', { mob: mobName(target.name) });
      }
      if (!naive && target.name === 'creeper' && !this.hasShield()) return this.flee(target, 9);
      const pos = target.position.clone();
      const res = await this.combat.fight(target, { retreatHp: naive ? 0 : this.helper ? 9 : 7 });
      this.dbg(`fight ${target.name}: ${res}`);
      if (res === 'killed') {
        this.stats.kills++;
        this.colony.stat('kills', 1);
        if (Math.random() < 0.35) this.say('killed', { mob: mobName(target.name) });
        await this.collectDrops(pos, 6, 6000).catch(() => {});
      } else if (res === 'retreat' && !naive) {
        this.say('help', {}, { urgent: true });
        this.colony.callForHelp(this, target);
        await this.retreat(target);
      }
    } finally {
      this.inCombat = false;
    }
  }

  /** In a tunnel, a creeper is stopped by a 2-high wall of cobblestone between us. */
  async wallOff(from) {
    const bot = this.bot;
    const me = bot.entity.position.floored();
    const d = from.position.minus(bot.entity.position);
    const dir = Math.abs(d.x) > Math.abs(d.z) ? new Vec3(Math.sign(d.x), 0, 0) : new Vec3(0, 0, Math.sign(d.z));
    const side = (q) => bot.blockAt(q)?.boundingBox === 'block';
    const cell = me.plus(dir);
    const perp = new Vec3(dir.z, 0, dir.x);
    const tunnel = side(me.plus(perp)) && side(me.minus(perp)) && side(me.offset(0, 2, 0));
    const blocks = I.find(bot, /^(cobblestone|cobbled_deepslate|dirt)$/);
    if (!tunnel || !blocks || I.count(bot, /^(cobblestone|cobbled_deepslate|dirt)$/) < 2) return false;
    try {
      for (const q of [cell, cell.offset(0, 1, 0)]) {
        const at = bot.blockAt(q);
        if (at && at.boundingBox === 'block') continue;
        const below = bot.blockAt(q.offset(0, -1, 0));
        await bot.equip(I.find(bot, /^(cobblestone|cobbled_deepslate|dirt)$/), 'hand');
        await bot.placeBlock(below, new Vec3(0, 1, 0));
      }
      this.stats.walls = (this.stats.walls ?? 0) + 1;
      await sleep(8000); // let it wander off or blow up behind the wall
      for (const q of [cell.offset(0, 1, 0), cell]) {
        const b = bot.blockAt(q);
        if (b && b.boundingBox === 'block') await bot.dig(b, true).catch(() => {});
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Keeps `dist` blocks between us and `from` (creepers: let them lose interest or blow up harmlessly). */
  async flee(from, dist = 9) {
    const bot = this.bot;
    if (from.name === 'creeper' && from.position.distanceTo(bot.entity.position) < 5 && (await this.wallOff(from))) return;
    this.stats.fled++;
    this.inCombat = true;
    try {
      const goal = new goals.GoalInvert(new goals.GoalFollow(from, dist));
      bot.pathfinder.setGoal(goal, true);
      const t0 = Date.now();
      while (Date.now() - t0 < 7000 && bot.entities[from.id] && from.position.distanceTo(bot.entity.position) < dist + 2) {
        if (this.dead || !this.running) break;
        await sleep(250);
      }
    } finally {
      bot.pathfinder.setGoal(null);
      bot.clearControlStates();
      this.inCombat = false;
    }
  }

  /** Low on health or outnumbered: back to the lit plaza, eat there, fight only when cornered. */
  async retreat(threat) {
    const bot = this.bot;
    this.stats.fled++;
    this.inCombat = true;
    try {
      const h = this.colony.home();
      await walkTo(bot, new goals.GoalNear(h.x, h.y, h.z, 3), { timeout: 30000, retries: 2, shouldStop: () => this.dead || !this.running, onStuck: () => this.unstick() });
      if (I.bestFood(bot, { allowRaw: true })) await this.eat({ force: true }).catch(() => {});
    } finally {
      this.inCombat = false;
    }
  }

  async eat({ force = false, golden = false } = {}) {
    const bot = this.bot;
    const food = golden ? I.find(bot, /^(enchanted_golden_apple|golden_apple)$/) : I.bestFood(bot, { allowRaw: force || bot.food < 8, allowBad: bot.food < 4 });
    if (!food) return;
    await bot.equip(food, 'hand');
    try {
      await bot.consume();
      this.stats.meals++;
      if (Math.random() < 0.12) this.say('eat', { item: I.ru(food.name) });
    } catch {}
  }

  /** Swim up (digging through ice above the head) and out to the nearest dry ground. */
  async surface() {
    const bot = this.bot;
    const t0 = Date.now();
    bot.pathfinder.setGoal(null);
    while (bot.entity.isInWater && Date.now() - t0 < 20000 && this.running && !this.dead) {
      const above = bot.blockAt(bot.entity.position.offset(0, 1.8, 0).floored());
      if (above && above.boundingBox === 'block') {
        await bot.dig(above, true).catch(() => {});
        continue;
      }
      const me = bot.entity.position.floored();
      let best = null;
      for (let dx = -8; dx <= 8; dx++)
        for (let dz = -8; dz <= 8; dz++)
          for (let dy = -2; dy <= 3; dy++) {
            const p = me.offset(dx, dy, dz);
            const b = bot.blockAt(p);
            const below = bot.blockAt(p.offset(0, -1, 0));
            const up = bot.blockAt(p.offset(0, 1, 0));
            if (!b || !below || !up || b.name !== 'air' || up.name !== 'air' || below.boundingBox !== 'block' || /water|ice/.test(below.name)) continue;
            const d = Math.abs(dx) + Math.abs(dz) + Math.abs(dy);
            if (!best || d < best.d) best = { p, d };
          }
      if (best) await bot.lookAt(best.p.offset(0.5, 1, 0.5), true);
      if ((bot.oxygenLevel ?? 20) <= 3 && !best) {
        this.log('drowning with no way up: rescued');
        this.colony.stat('rescues', 1);
        await this.colony.recall(this);
        break;
      }
      bot.setControlState('jump', true);
      bot.setControlState('forward', !!best);
      await bot.waitForTicks(4);
    }
    bot.clearControlStates();
  }

  onSystemMessage(json) {
    // death messages name the cause: "death.attack.drown", "death.attack.mob" (+ the mob) …
    try {
      const key = json?.translate ?? json?.json?.translate;
      if (typeof key !== 'string' || !key.startsWith('death.')) return;
      const who = JSON.stringify(json.with?.[0] ?? json.json?.with?.[0] ?? '');
      if (!who.includes(this.name)) return;
      const cause = CAUSES.find(([re]) => re.test(key))?.[1] ?? 'other';
      const killerRaw = json.with?.[1] ?? json.json?.with?.[1];
      const killer = killerRaw ? String(killerRaw.translate ?? killerRaw.text ?? '').replace(/^entity\.minecraft\./, '') : '';
      this.lastDeath = { key, cause, killer, at: Date.now() };
      if (this.deathRecord && !this.deathRecord.cause) {
        this.deathRecord.cause = cause;
        this.colony.onDeathCause(this, cause, killer, this.deathRecord.pos);
      }
    } catch {}
  }

  onDeath() {
    if (this.dead) return;
    const bot = this.bot;
    this.dead = true;
    this.inCombat = false;
    this.stats.deaths++;
    this.colony.stat('deaths', 1);
    const pos = bot.entity.position.clone();
    const items = I.itemsOf(bot).reduce((s, i) => s + i.count, 0) + [5, 6, 7, 8, 45].filter((s) => bot.inventory.slots[s]).length;
    const inLava = !!bot.entity.isInLava;
    const inWater = !!bot.entity.isInWater;
    this.deathRecord = { pos, at: Date.now(), items, inLava, inWater, unsafe: inLava, cause: null };
    this.log(`died at ${pos.floored()} with ${items} items`);
    this.say('died', {}, { urgent: true });
    this.colony.onDeath(this, pos);
    if (this.lastDeath && Date.now() - this.lastDeath.at < 3000) {
      this.deathRecord.cause = this.lastDeath.cause;
      this.colony.onDeathCause(this, this.lastDeath.cause, this.lastDeath.killer, pos);
    }
    setTimeout(() => {
      // no death message seen (e.g. chat off): log it without a cause
      if (this.deathRecord && !this.deathRecord.cause) {
        this.deathRecord.cause = inLava ? 'lava' : inWater ? 'drown' : 'other';
        this.colony.onDeathCause(this, this.deathRecord.cause, '', pos);
      }
    }, 2500);
  }

  async onRespawn() {
    this.dead = false;
    this.interruptWhy = null;
    await sleep(1500);
    if (this.deathRecord && !this.deathRecord.unsafe) {
      const p = this.deathRecord.pos;
      this.say('respawn', { x: Math.round(p.x), z: Math.round(p.z) }, { urgent: true });
    }
  }

  async recover() {
    const bot = this.bot;
    const rec = this.deathRecord;
    if (rec.inLava) {
      this.say('lostInLava', {}, { urgent: true });
      this.deathRecord = null;
      return;
    }
    // re-arm first when storage has a weapon (the place where we died may still be dangerous)
    if (I.toolTier(bot, 'sword') < 0 && this.colony.storageCount(/_sword$/) > 0 && bot.entity.position.distanceTo(this.colony.home()) < 24) {
      await this.fetchKit(this.kitGap() ?? { sword: 1 }).catch((e) => {
        if (e.interrupted) throw e;
      });
    }
    const before = I.itemsOf(bot).reduce((s, i) => s + i.count, 0);
    const left = DESPAWN_SAFE_MS - (Date.now() - rec.at);
    const r = await this.goNear(rec.pos, 2, { timeout: Math.max(5000, left), retries: 5 });
    if (!r.ok && r.stuck) rec.fails = (rec.fails ?? 0) + 1;
    if (rec.fails >= 3) {
      this.say('lostItems', {}, { urgent: true });
      this.deathRecord = null;
      return { ok: false };
    }
    if (!r.ok && bot.entity.position.distanceTo(rec.pos) > 6) {
      if (Date.now() - rec.at > DESPAWN_SAFE_MS - 10000) {
        this.say('lostItems', {}, { urgent: true });
        this.deathRecord = null;
      }
      return { ok: false };
    }
    await this.collectDrops(rec.pos, 10, 25000, { dry: rec.inWater });
    const got = Math.max(0, I.itemsOf(bot).reduce((s, i) => s + i.count, 0) - before);
    this.stats.recovered += got;
    this.colony.onRecovered(this, got, rec);
    this.say('retrieved', { n: got }, { urgent: true });
    this.deathRecord = null;
    await this.equipBest();
  }

  async collectDrops(center, radius = 6, maxMs = 8000, { dry = false } = {}) {
    const bot = this.bot;
    const t0 = Date.now();
    const wet = (p) => /water/.test(bot.blockAt(p.floored())?.name ?? '');
    for (let pass = 0; pass < 10 && Date.now() - t0 < maxMs; pass++) {
      const items = Object.values(bot.entities).filter((e) => e.name === 'item' && e.position.distanceTo(center) < radius && e.position.distanceTo(bot.entity.position) < 24 && !(wet(e.position) && (dry || e.position.distanceTo(bot.entity.position) > 3)));
      if (!items.length) break;
      items.sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
      const p = items[0].position;
      await walkTo(bot, new goals.GoalNear(p.x, p.y, p.z, 0.8), { timeout: 5000, retries: 1, shouldStop: () => !!this.interruptWhy || this.dead, onStuck: () => this.unstick() });
      this.check();
      await sleep(300);
    }
  }

  async equipBest() {
    const bot = this.bot;
    for (const it of I.itemsOf(bot)) {
      const part = I.armorPart(it.name);
      if (!part) continue;
      const slot = I.ARMOR_SLOTS[part];
      const cur = I.equipped(bot, slot);
      if (!cur || I.armorTier(it.name) > I.armorTier(cur.name)) await bot.equip(it, slot).catch(() => {});
    }
    const shield = I.find(bot, 'shield');
    if (shield && bot.inventory.slots[45]?.name !== 'shield') await bot.equip(shield, 'off-hand').catch(() => {});
  }

  // ------------------------------------------------------------------ day / night / home

  async doSleep() {
    const bot = this.bot;
    const bed = this.colony.bedFor(this);
    await this.goNear(bed, 2, { timeout: 60000 });
    const block = bot.blockAt(bed);
    if (!block || !/_bed$/.test(block.name)) return this.colony.bedMissing(this, bed);
    this.say('night', {});
    try {
      await bot.sleep(block);
      this.stats.slept++;
      this.task = 'sleep';
      for (let i = 0; i < 400 && bot.isSleeping && this.running; i++) await sleep(500);
    } catch (e) {
      if (/monsters/i.test(e.message)) this.say('cantSleep', {});
      await this.guard(8000);
    }
  }

  async doHome(night) {
    const bot = this.bot;
    const slot = `home:${night}:${Math.floor(Date.now() / 600000)}`;
    if (!this.seen.has(slot) && bot.entity.position.distanceTo(this.colony.home()) > 20) {
      this.seen.add(slot);
      this.say(night ? 'nightHome' : 'idleHome', {});
    }
    await this.goHome(6);
    if (I.freeSlots(bot) < 20 || this.hasSurplus()) await this.visitBase({ reason: 'home' });
    await this.colony.serviceFurnace(this).catch(() => {});
    if (!night && I.count(bot, /^(beef|porkchop|mutton|chicken|rabbit)$/) > 0) await this.cookAtCampfire().catch(() => {});
    await this.guard(night ? 15000 : 10000);
  }

  /** Walks around the plaza, looks at colleagues; the reflex handles intruders. */
  async guard(ms) {
    const bot = this.bot;
    const h = this.colony.home();
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      this.check();
      const p = h.offset(Math.round((Math.random() - 0.5) * 10), 0, Math.round((Math.random() - 0.5) * 10));
      await walkTo(bot, new goals.GoalNear(p.x, p.y, p.z, 1), { timeout: 6000, retries: 1, shouldStop: () => !!this.interruptWhy || this.dead, onStuck: () => this.unstick() });
      this.check();
      const mate = bot.nearestEntity((e) => e.type === 'player' && e !== bot.entity);
      if (mate) await bot.lookAt(mate.position.offset(0, 1.6, 0)).catch(() => {});
      await sleep(1500 + Math.random() * 2000);
    }
  }

  async doLeave() {
    await this.goHome(4).catch(() => {});
    await this.visitBase({ reason: 'leave', all: true }).catch(() => {});
    this.say(this.helper ? 'helperBye' : 'bye', {});
    await sleep(1500);
    this.colony.colonistLeft(this);
    this.quit('leaving');
    await sleep(1000);
  }

  // ------------------------------------------------------------------ social

  onChat(user, msg) {
    if (user === this.name) return;
    if (this.colony.isColonist(user)) return;
    // a real player says hello: a short answer now and then
    if (/hallo|hoi|grüezi|hello|привет|\bhi\b/i.test(msg) && Date.now() - (this.lastGreet.get(user) ?? 0) > 120000) {
      this.lastGreet.set(user, Date.now());
      setTimeout(() => this.say('greetPlayer', { other: user }), 1000 + Math.random() * 2000);
    }
  }

  /** Called by the colony when another colonist comes close after a while apart. */
  greet(other) {
    if (Date.now() - (this.lastGreet.get(other.name) ?? 0) < 300000) return;
    this.lastGreet.set(other.name, Date.now());
    other.lastGreet.set(this.name, Date.now());
    this.say('greet', { other: other.name });
    setTimeout(() => other.say('greetBack', { other: this.name }), 2000 + Math.random() * 1500);
  }

  async doShare() {
    const gift = this.colony.wantsGift(this);
    if (!gift) return;
    const { to, item } = gift;
    const bot = this.bot;
    const target = to.bot?.entity;
    if (!target) return this.colony.giftDone(this, gift, false);
    this.say('giftGo', { other: to.name, item: I.ru(item) });
    const r = await this.go(new goals.GoalFollow(target, 2), { timeout: 30000 });
    const it = I.find(bot, item);
    if (!it || target.position.distanceTo(bot.entity.position) > 4) {
      if (!r?.ok) this.colony.giftDone(this, gift, false);
      return;
    }
    await bot.lookAt(target.position.offset(0, 1.2, 0), true);
    await bot.toss(it.type, null, 1);
    this.stats.gifts++;
    this.colony.giftDone(this, gift, true);
    setTimeout(() => to.say('thanksGift', { other: this.name, item: I.ru(item) }, { urgent: true }), 1500);
  }

  // ------------------------------------------------------------------ kit, inventory, storage, market

  /** The standard kit: what is missing that storage might have ({kind: count}), or null. */
  kitGap() {
    const bot = this.bot;
    const gap = {};
    for (const kind of ['pickaxe', 'sword', 'axe']) if (I.toolTier(bot, kind) < 0) gap[kind] = 1;
    if (this.role === 'farmer' && I.toolTier(bot, 'hoe') < 0) gap.hoe = 1;
    if (I.foodCount(bot) < 4) gap.food = 8 - I.foodCount(bot);
    if (I.count(bot, 'torch') < 4) gap.torch = 8 - I.count(bot, 'torch');
    if (!this.hasShield()) gap.shield = 1;
    for (const s of ['head', 'torso', 'legs', 'feet']) if (!I.equipped(bot, s)) gap[`armor:${s}`] = 1;
    return Object.keys(gap).length ? gap : null;
  }

  async fetchKit(gap) {
    const c = this.colony;
    const want = {};
    for (const k of Object.keys(gap)) {
      if (['pickaxe', 'sword', 'axe', 'hoe'].includes(k)) want[`/_${k}$/`] = 1;
      else if (k === 'food') want['/^cooked_|^bread$|^baked_potato$|^apple$|^carrot$/'] = gap.food;
      else if (k === 'torch') want.torch = gap.torch;
      else if (k === 'shield') want.shield = 1;
      else if (k.startsWith('armor:')) {
        const part = { head: 'helmet', torso: 'chestplate', legs: 'leggings', feet: 'boots' }[k.slice(6)];
        want[`/_${part}$/`] = 1;
      }
    }
    await this.visitBase({ reason: 'kit', want });
    await this.equipBest();
    this.kitCheckedAt = Date.now();
  }

  /** How many of this item the colonist keeps for itself. */
  keepOf(item) {
    if (this.colony.builder === this && this.colony.isBuildItem(item.name)) return Infinity; // bought for the house
    if (this.role === 'farmer' && /^wheat_seeds$|_hoe$/.test(item.name)) return 32;
    for (const [re, n] of I.KEEP_PERSONAL) if (re.test(item.name)) return n;
    return 0;
  }

  hasSurplus() {
    const kept = new Map();
    for (const it of I.itemsOf(this.bot)) kept.set(it.name, (kept.get(it.name) ?? 0) + it.count);
    for (const [name, n] of kept) if (n > this.keepOf({ name }) + 8) return true;
    return false;
  }

  /**
   * Walks to the colony storage: surplus goes into the chest of its category up to the colony reserve,
   * the rest into the market chest where it is sold for credits; then `want` ({name|/regex/: count}) is
   * taken from the matching chests.
   */
  async visitBase({ reason = 'deposit', want = null, all = false } = {}) {
    const bot = this.bot;
    const c = this.colony;
    await this.goHome(6);
    this.lastDeposit = Date.now();
    for (const it of I.itemsOf(bot)) if (I.TRASH.test(it.name)) await bot.tossStack(it).catch(() => {});
    const totals = new Map();
    for (const it of I.itemsOf(bot)) totals.set(it.name, (totals.get(it.name) ?? 0) + it.count);
    // a worn duplicate tool is not "the best": keep only the best one of each kind
    const out = new Map();
    for (const [name, n] of totals) {
      const keep = all ? (c.builder === this && c.isBuildItem(name) ? Infinity : 0) : this.keepOf({ name });
      if (n > keep) out.set(name, n - keep);
    }
    const byChest = new Map(); // chest key -> Map(name -> n)
    const toMarket = new Map();
    for (const [name, n] of out) {
      const room = c.storageRoom(name);
      const s = Math.min(n, room);
      const put = (k, name2, m) => {
        if (!byChest.has(k)) byChest.set(k, new Map());
        byChest.get(k).set(name2, (byChest.get(k).get(name2) ?? 0) + m);
      };
      if (s > 0) put(c.storageCategory(name), name, s);
      if (n - s > 0) {
        if (c.sellable(name)) toMarket.set(name, n - s);
        else put(c.storageCategory(name), name, n - s);
      }
    }
    // withdrawals grouped by the chest that holds them
    const wantBy = new Map();
    for (const [key, n] of Object.entries(want ?? {})) {
      const cat = c.categoryForWant(key);
      if (!wantBy.has(cat)) wantBy.set(cat, {});
      wantBy.get(cat)[key] = n;
    }
    const cats = new Set([...byChest.keys(), ...wantBy.keys()]);
    let stored = 0;
    for (const cat of cats) {
      await this.useChest(c.storagePos(cat), byChest.get(cat), wantBy.get(cat));
      stored += [...(byChest.get(cat)?.values() ?? [])].reduce((a, b) => a + b, 0);
    }
    if (toMarket.size) {
      await this.useChest(c.base.market, toMarket, null, true);
      this.say('sold', { what: describe(toMarket) });
    }
    if (stored) {
      this.stats.deposits++;
      if (reason !== 'leave' && Math.random() < 0.4) this.say('deposit', { what: describe(new Map([...byChest.values()].flatMap((m) => [...m]))) });
    }
    await c.serviceFurnace(this).catch(() => {});
  }

  /** Opens a chest, deposits `put` (name -> count), withdraws `want` (name|/regex/ -> count). */
  async useChest(pos, put, want, market = false) {
    const bot = this.bot;
    const c = this.colony;
    const r = await this.go(new goals.GoalGetToBlock(pos.x, pos.y, pos.z), { timeout: 20000 });
    if (!r.ok && bot.entity.position.distanceTo(pos) > 4) throw new Error(`cannot reach chest ${pos}: ${r.error}`);
    const block = bot.blockAt(pos);
    if (!block || !/chest|barrel/.test(block.name)) throw new Error(`no chest at ${pos}`);
    const release = market ? await c.lockMarket(this) : () => {};
    let chest;
    try {
      chest = await bot.openContainer(block);
      for (const [name, n] of put ?? []) {
        let left = n;
        for (const it of I.itemsOf(bot).filter((i) => i.name === name)) {
          if (left <= 0) break;
          const k = Math.min(left, it.count);
          try {
            await chest.deposit(it.type, null, k);
            left -= k;
          } catch (e) {
            if (/full/i.test(e.message)) break;
            throw e;
          }
        }
      }
      const got = {};
      for (const [key, n] of Object.entries(want ?? {})) {
        let left = n;
        const re = key.startsWith('/') ? new RegExp(key.slice(1, -1)) : null;
        // tools/armour: the best tier first
        const items = chest.containerItems().filter((i) => (re ? re.test(i.name) : i.name === key)).sort((a, b) => I.tierOf(b.name) - I.tierOf(a.name) || I.armorTier(b.name) - I.armorTier(a.name));
        for (const it of items) {
          if (left <= 0) break;
          const k = Math.min(left, it.count);
          try {
            await chest.withdraw(it.type, null, k);
            left -= k;
            got[it.name] = (got[it.name] ?? 0) + k;
          } catch {
            break;
          }
        }
      }
      if (!market) c.noteStorage(pos, chest.containerItems());
      return got;
    } finally {
      try {
        chest?.close();
      } catch {}
      release();
    }
  }

  // ------------------------------------------------------------------ crafting, tools, smelting

  materialCount(kind) {
    const bot = this.bot;
    if (kind === 'planks') return I.count(bot, I.PLANKS);
    if (kind === 'stone') return I.count(bot, I.STONE_DROP);
    if (kind === 'logs') return I.count(bot, I.LOG);
    return I.count(bot, kind);
  }

  /** Raw shortfall for a recipe after converting what the colonist has (logs -> planks -> sticks). */
  shortfall(needs) {
    const bot = this.bot;
    const short = {};
    const planks = I.count(bot, I.PLANKS);
    const logs = I.count(bot, I.LOG);
    const sticks = I.count(bot, 'stick');
    let needPlanks = needs.planks ?? 0;
    const needSticks = needs.stick ?? 0;
    if (sticks < needSticks) needPlanks += Math.ceil((needSticks - sticks) / 4) * 2;
    if (planks < needPlanks) {
      const needLogs = Math.ceil((needPlanks - planks) / 4);
      if (logs < needLogs) short.logs = needLogs - logs;
    }
    if (needs.stone && this.materialCount('stone') < needs.stone) short.stone = needs.stone - this.materialCount('stone');
    if (needs.iron_ingot && I.count(bot, 'iron_ingot') < needs.iron_ingot) short.iron_ingot = needs.iron_ingot - I.count(bot, 'iron_ingot');
    if (needs.wheat && I.count(bot, 'wheat') < needs.wheat) short.wheat = needs.wheat - I.count(bot, 'wheat');
    return short;
  }

  /** Gets the materials for `needs` (storage, smelting, gathering) and crafts `item`. */
  async craftWithMaterials(item, needs, { table = true } = {}) {
    const bot = this.bot;
    const c = this.colony;
    let short = this.shortfall(needs);
    if (Object.keys(short).length && c.storageHas(short)) {
      const want = {};
      if (short.logs) want['/_log$/'] = short.logs + 2;
      if (short.stone) want['/^(cobblestone|cobbled_deepslate|blackstone)$/'] = short.stone;
      if (short.iron_ingot) want.iron_ingot = short.iron_ingot;
      await this.visitBase({ reason: 'fetch', want });
      short = this.shortfall(needs);
    }
    if (short.iron_ingot) {
      const raw = I.count(bot, 'raw_iron');
      if (raw < short.iron_ingot && c.storageCount('raw_iron') > 0) await this.visitBase({ reason: 'fetch', want: { raw_iron: short.iron_ingot - raw } });
      if (I.count(bot, 'raw_iron') > 0) {
        await this.smelt('raw_iron', Math.min(I.count(bot, 'raw_iron'), short.iron_ingot + 2));
        short = this.shortfall(needs);
      }
      if (short.iron_ingot) return this.gather('iron', { need: short.iron_ingot - I.count(bot, 'raw_iron') });
    }
    if (short.stone) return this.gather('stone', { need: short.stone });
    if (short.logs) return this.gather('wood', { need: short.logs });
    await this.craftPlanksAndSticks(needs);
    const tbl = table ? await this.reachTable() : null;
    await this.craft(item, 1, tbl);
    this.stats.crafted++;
    c.stat('crafted', 1);
    c.onCrafted(this, item);
    return { ok: true, crafted: item };
  }

  async doUpgrade(up) {
    const res = await this.craftWithMaterials(up.item, up.needs);
    if (res?.crafted) {
      if (up.wear || up.item === 'shield') await this.equipBest();
      if (up.place === 'furnace') await this.placeAtBase('furnace', this.colony.base.furnace);
    }
    return res;
  }

  /** A tool with < 12% durability left and no fresh spare: its replacement (same or better tier). */
  wornTool() {
    const bot = this.bot;
    for (const kind of ['pickaxe', 'sword', 'axe']) {
      const tools = I.itemsOf(bot).filter((i) => i.name.endsWith('_' + kind));
      if (!tools.length) continue;
      const fresh = tools.filter((t) => remaining(t) > 0.12);
      if (fresh.length) continue;
      const tier = Math.max(...tools.map((t) => I.tierOf(t.name)));
      if (tier < 0 || tier > 2) continue;
      return { kind, tier, ...TOOL_RECIPE[kind](tier) };
    }
    return null;
  }

  async replaceTool(worn) {
    if (!this.seen.has(`worn:${worn.item}:${Math.floor(Date.now() / 300000)}`)) {
      this.seen.add(`worn:${worn.item}:${Math.floor(Date.now() / 300000)}`);
      this.dbg(`${worn.item} is almost broken: making a new one`);
    }
    return this.craftWithMaterials(worn.item, worn.needs);
  }

  async craftPlanksAndSticks(needs) {
    const bot = this.bot;
    const needSticks = needs.stick ?? 0;
    let needPlanks = needs.planks ?? 0;
    if (I.count(bot, 'stick') < needSticks) needPlanks += Math.ceil((needSticks - I.count(bot, 'stick')) / 4) * 2;
    while (I.count(bot, I.PLANKS) < needPlanks) {
      const log = I.find(bot, I.LOG);
      if (!log) throw new Error('no logs for planks');
      await this.craft(log.name.replace(/_log$/, '_planks'), 1, null);
    }
    while (I.count(bot, 'stick') < needSticks) await this.craft('stick', 1, null);
  }

  async craft(name, times, table) {
    const bot = this.bot;
    const item = bot.registry.itemsByName[name];
    if (!item) throw new Error(`unknown item ${name}`);
    let recipes = bot.recipesFor(item.id, null, 1, table);
    if (!recipes.length) {
      await sleep(600); // the inventory update after the previous craft may still be on its way
      recipes = bot.recipesFor(item.id, null, 1, table);
    }
    if (!recipes.length) throw new Error(`no recipe for ${name}${table ? '' : ' (no table)'}`);
    try {
      await bot.craft(recipes[0], times, table ?? undefined);
    } catch (e) {
      if (!table || !/windowOpen/.test(e.message)) throw e;
      // the table window did not open (too far, lag): step right next to it and try once more
      await this.go(new goals.GoalGetToBlock(table.position.x, table.position.y, table.position.z), { timeout: 20000 });
      await bot.craft(recipes[0], times, bot.blockAt(table.position));
    }
    await sleep(250);
  }

  async reachTable() {
    const bot = this.bot;
    const c = this.colony;
    let table = c.tableBlock(bot);
    if (!table) {
      if (!I.find(bot, 'crafting_table')) {
        await this.craftPlanksAndSticks({ planks: 4 });
        await this.craft('crafting_table', 1, null);
      }
      await this.placeAtBase('crafting_table', c.base.table);
      table = c.tableBlock(bot);
      if (!table) throw new Error('no crafting table');
    }
    if (bot.entity.position.distanceTo(table.position) > 4) await this.go(new goals.GoalGetToBlock(table.position.x, table.position.y, table.position.z), { timeout: 40000 });
    if (bot.entity.position.distanceTo(table.position.offset(0.5, 0.5, 0.5)) > 5) {
      await this.goHome(3);
      throw new Error('cannot reach the crafting table');
    }
    return bot.blockAt(table.position);
  }

  /** Places a block from the inventory at a base spot (by hand; RCON if the spot is awkward). */
  async placeAtBase(itemName, spot) {
    const bot = this.bot;
    const it = I.find(bot, itemName);
    if (!it) return;
    await this.go(new goals.GoalNear(spot.x, spot.y, spot.z, 2), { timeout: 40000 });
    const below = bot.blockAt(spot.offset(0, -1, 0));
    const at = bot.blockAt(spot);
    if (at && at.name !== 'air' && at.boundingBox === 'empty') await bot.dig(at, true).catch(() => {});
    try {
      await bot.equip(it, 'hand');
      await bot.lookAt(spot.offset(0.5, 0.5, 0.5), true);
      await bot.placeBlock(below, new Vec3(0, 1, 0));
      this.stats.placedHand++;
    } catch {
      await bot.lookAt(spot.offset(0.5, 0.5, 0.5), true).catch(() => {});
      bot.swingArm('right');
      if (/_bed$/.test(itemName)) {
        await this.colony.rcon(`setblock ${spot.x} ${spot.y} ${spot.z - 1} ${itemName}[facing=north,part=head]`);
        await this.colony.rcon(`setblock ${spot.x} ${spot.y} ${spot.z} ${itemName}[facing=north,part=foot]`);
      } else await this.colony.rcon(`setblock ${spot.x} ${spot.y} ${spot.z} ${itemName}`);
      await this.colony.rcon(`clear ${this.name} ${itemName} 1`);
      this.stats.placedRcon++;
    }
    this.colony.onPlacedAtBase(this, itemName);
  }

  /** Smelts `n` of `input` at the colony furnace (waits next to it). */
  async smelt(input, n) {
    const bot = this.bot;
    const c = this.colony;
    let fb = c.furnaceBlock(bot);
    if (!fb) throw new Error('no furnace');
    await this.go(new goals.GoalGetToBlock(fb.position.x, fb.position.y, fb.position.z), { timeout: 40000 });
    fb = bot.blockAt(fb.position);
    const release = await c.lockFurnace(this);
    let f;
    try {
      f = await bot.openFurnace(fb);
      if (f.outputItem()) await f.takeOutput().catch(() => {});
      const inp = f.inputItem();
      if (inp && inp.name !== input) await f.takeInput().catch(() => {});
      const fuelNeed = Math.ceil(n / 8);
      const fuel = f.fuelItem();
      if (!fuel || fuel.count < fuelNeed) {
        const coal = I.find(bot, /^(coal|charcoal)$/);
        if (coal) await f.putFuel(coal.type, null, Math.min(coal.count, fuelNeed));
        else {
          const pl = I.find(bot, I.PLANKS) ?? I.find(bot, I.LOG);
          if (!pl) {
            f.close();
            f = null;
            await this.visitBase({ reason: 'fuel', want: { '/^(coal|charcoal)$/': fuelNeed, '/_log$/': Math.ceil(n / 1.5) } });
            return;
          }
          await f.putFuel(pl.type, null, Math.min(pl.count, Math.ceil(n / 1.5)));
        }
      }
      const it = I.find(bot, input);
      if (!it) return;
      const k = Math.min(n, I.count(bot, input), 64);
      await f.putInput(it.type, null, k);
      const slot = `smelt:${Math.floor(Date.now() / 300000)}`;
      if (k >= 3 && !this.seen.has(slot)) {
        this.seen.add(slot);
        this.say('smelting', { n: k, item: I.ru(input) });
      }
      let got = 0;
      const t0 = Date.now();
      while (got < k && Date.now() - t0 < k * 10500 + 8000) {
        this.check();
        await sleep(1500);
        if (f.outputItem()) {
          const o = f.outputItem().count;
          await f.takeOutput().catch(() => {});
          got += o;
        }
      }
      if (I.RAW_FOOD[input]) this.stats.cooked += got;
    } finally {
      try {
        f?.close();
      } catch {}
      release();
    }
  }

  // ------------------------------------------------------------------ gathering: mine, wood

  announceFind(kind) {
    const slot = `found:${kind}:${Math.floor(Date.now() / 600000)}`;
    if (this.seen.has(slot)) return;
    this.seen.add(slot);
    this.say(`found_${kind}`, {});
    this.colony.stat(`found_${kind}`, 1);
  }

  /**
   * One bounded gathering trip. kind: wood | stone | coal | iron | food.
   * Stone and ores come from the colonist's own mine (a staircase, then a flat tunnel at ore depth);
   * ores that are exposed close by on the surface are taken first.
   */
  async gather(kind, { need = 16, maxMs = 100000 } = {}) {
    const bot = this.bot;
    if (kind === 'food') return this.getFood();
    if (kind === 'wood') return this.chop(need, maxMs);
    const req = { stone: 0, coal: 0, iron: 1, copper: 1, gold: 2, diamond: 2 }[kind] ?? 0;
    if (I.toolTier(bot, 'pickaxe') < req) {
      if (I.toolTier(bot, 'pickaxe') < 0) return this.chop(4, maxMs); // the first pickaxe needs wood
      kind = 'stone';
    }
    const countNow = () => I.count(bot, I.STONE_DROP) + I.count(bot, /^(andesite|diorite|granite|tuff|coal|raw_iron|raw_copper|raw_gold|diamond|lapis_lazuli|redstone)$/);
    const start = countNow();
    // exposed ore within a short walk on the surface
    if (kind !== 'stone') {
      const ids = (I.ORES[kind] ?? []).map((n) => bot.registry.blocksByName[n]?.id).filter((x) => x != null);
      const p = this.findMineable(ids, 16, { exposedOnly: true });
      if (p && (await this.mineBlock(p))) {
        this.announceFind(kind);
        for (let k = 0; k < 6; k++) {
          const next = bot.findBlock({ matching: ids, maxDistance: 4, point: p });
          if (!next || !(await this.mineBlock(next.position))) break;
        }
      }
    }
    const steps = kind === 'stone' ? Math.max(3, Math.ceil(need / 3)) : 10;
    const res = await this.mine.work({ steps, maxMs });
    const got = countNow() - start;
    if (kind === 'stone') this.stats.stone += got;
    else this.stats.ores += got;
    this.colony.stat(kind === 'stone' ? 'stoneMined' : 'oreTrips', kind === 'stone' ? got : 1);
    return res;
  }

  /** Nearest block of `ids` that is safe to mine (no fluid next to it, not protected). */
  findMineable(ids, maxDistance, { exposedOnly = false } = {}) {
    const bot = this.bot;
    const c = this.colony;
    const me = bot.entity.position;
    let best = null;
    let bestScore = Infinity;
    for (const p of bot.findBlocks({ matching: ids, maxDistance, count: 40 })) {
      if (c.isProtected(p) || c.isBlacklisted(p) || c.outsideBorder(p) || this.nearFluid(p)) continue;
      const exposed = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]].some(([dx, dy, dz]) => /^(air|cave_air)$/.test(bot.blockAt(p.offset(dx, dy, dz))?.name ?? ''));
      if (exposedOnly && !exposed) continue;
      const score = p.distanceTo(me) + Math.abs(me.y - p.y) * 1.5 + (exposed ? 0 : 12);
      if (score < bestScore) {
        best = p;
        bestScore = score;
      }
    }
    return best;
  }

  /** A fluid touches this block: digging it would flood the tunnel. */
  nearFluid(pos) {
    const bot = this.bot;
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const b = bot.blockAt(pos.offset(dx, dy, dz));
      if (b && /water|lava|bubble_column/.test(b.name)) return true;
    }
    return false;
  }

  async mineBlock(pos) {
    const bot = this.bot;
    let block = bot.blockAt(pos);
    if (!block || block.name === 'air') return false;
    if (!bot.canDigBlock(block) || bot.entity.position.distanceTo(pos.offset(0.5, 0.5, 0.5)) > 4.2) {
      const r = await this.go(new goals.GoalGetToBlock(pos.x, pos.y, pos.z), { timeout: 20000, retries: 2 });
      if (!r.ok && bot.entity.position.distanceTo(pos.offset(0.5, 0.5, 0.5)) > 4.2) return false;
    }
    block = bot.blockAt(pos);
    if (!block || block.name === 'air') return true;
    if (this.colony.isProtected(pos) || this.nearFluid(pos)) return false;
    const tool = bot.pathfinder.bestHarvestTool(block);
    if (tool) await bot.equip(tool, 'hand');
    if (!block.canHarvest(bot.heldItem?.type ?? null) && block.harvestTools) return false;
    try {
      await bot.dig(block, true);
    } catch (e) {
      this.check();
      this.dbg(`dig ${block.name} at ${pos} failed: ${e.message}`);
      return false;
    }
    await sleep(150);
    await this.collectDrops(pos.offset(0.5, 0.5, 0.5), 4, 3000);
    return true;
  }

  async chop(need = 8, maxMs = 90000) {
    const bot = this.bot;
    const ids = Object.values(bot.registry.blocksByName).filter((b) => I.LOG.test(b.name)).map((b) => b.id);
    const t0 = Date.now();
    const start = I.count(bot, I.LOG);
    let fails = 0;
    while (I.count(bot, I.LOG) - start < need && Date.now() - t0 < maxMs && I.freeSlots(bot) > 2) {
      this.check();
      const me = bot.entity.position;
      const logs = bot.findBlocks({ matching: ids, maxDistance: 48, count: 80 }).filter((p) => !this.colony.isProtected(p) && !this.colony.isBlacklisted(p) && !this.colony.outsideBorder(p) && !this.nearFluid(p));
      // the trunk base: the lowest log of a column standing on ground, close and not high above us
      let best = null;
      let bestScore = Infinity;
      for (const p of logs) {
        const below = bot.blockAt(p.offset(0, -1, 0));
        const ground = below && /dirt|grass|podzol|mud|moss|snow|coarse/.test(below.name);
        const score = p.distanceTo(me) + (ground ? 0 : 6) + Math.max(0, p.y - me.y) * 2;
        if (score < bestScore) {
          best = p;
          bestScore = score;
        }
      }
      if (!best) {
        if (++fails > 1) return this.colony.noteScarce('wood');
        await this.explore('wood');
        continue;
      }
      if (!(await this.mineBlock(best))) {
        this.colony.blacklist(best);
        if (++fails > 6) return { ok: false };
        continue;
      }
      for (let dy = 1; dy <= 5; dy++) {
        const b = bot.blockAt(best.offset(0, dy, 0));
        if (!b || !I.LOG.test(b.name) || !bot.canDigBlock(b)) break;
        const tool = bot.pathfinder.bestHarvestTool(b);
        if (tool) await bot.equip(tool, 'hand');
        try {
          await bot.dig(b, true);
        } catch {
          this.check();
          break;
        }
      }
      await this.collectDrops(best.offset(0.5, 1, 0.5), 6, 5000);
    }
    const n = I.count(bot, I.LOG) - start;
    this.stats.logs += Math.max(0, n);
    this.colony.stat('logs', Math.max(0, n));
    if (n >= 8 && Math.random() < 0.3) this.say('wood', { n });
  }

  /** Walks ~40 blocks in a fresh direction (inside the border) so new chunks come into view. */
  async explore(kind) {
    const c = this.colony;
    const h = c.home();
    const ang = Math.random() * Math.PI * 2;
    const r = 30 + Math.random() * 40;
    const slot = `explore:${kind}:${Math.floor(Date.now() / 300000)}`;
    if (!this.seen.has(slot)) {
      this.seen.add(slot);
      this.say('explore', { what: c.t(`wild.what.${kind}`) });
    }
    await this.go(new goals.GoalNearXZ(Math.round(h.x + Math.cos(ang) * r), Math.round(h.z + Math.sin(ang) * r), 4), { timeout: 40000, retries: 2 });
  }

  // ------------------------------------------------------------------ food: storage, cooking, hunting, farming

  async getFood() {
    const bot = this.bot;
    const c = this.colony;
    if (c.storageCount(/^cooked_|^bread$|^baked_potato$|^apple$|^carrot$/) > 0) {
      await this.visitBase({ reason: 'food', want: { '/^cooked_|^bread$|^baked_potato$|^apple$|^carrot$/': 8 } });
      if (I.foodCount(bot) >= 4) return;
    }
    if (I.count(bot, /^(beef|porkchop|mutton|chicken|rabbit)$/) > 0) return this.cookAtCampfire();
    if (I.count(bot, 'wheat') >= 3) return this.bakeBread();
    if (await this.hunt({ quick: true })) return;
    if (await c.buyFood(this)) return;
    await this.explore('food');
  }

  /** Hunts the nearest farm animal (never the last two of a kind near the colony: they are the herd). */
  async hunt({ quick = false } = {}) {
    const bot = this.bot;
    const c = this.colony;
    const near = (name) => Object.values(bot.entities).filter((e) => e.name === name && e.position.distanceTo(bot.entity.position) < 48).length;
    const prey = bot.nearestEntity((e) => I.ANIMALS[e.name] && e.position.distanceTo(bot.entity.position) < 48 && !c.isProtected(e.position.floored()) && near(e.name) > 2);
    if (!prey) {
      if (!quick) await this.explore('food');
      return false;
    }
    const slot = `hunt:${Math.floor(Date.now() / 300000)}`;
    if (!this.seen.has(slot)) {
      this.seen.add(slot);
      this.say('hunt', { mob: mobName(prey.name) });
    }
    const pos = prey.position.clone();
    this.inCombat = true;
    try {
      await this.combat.fight(prey, { retreatHp: 6, maxMs: 25000 });
    } finally {
      this.inCombat = false;
    }
    await this.collectDrops(pos, 8, 6000);
    if (I.count(bot, /^(beef|porkchop|mutton|chicken|rabbit)$/) >= 3) await this.cookAtCampfire();
    return true;
  }

  /** Cooks raw meat on the plaza campfire (no fuel needed: 4 pieces, ~30 s), then picks it up. */
  async cookAtCampfire() {
    const bot = this.bot;
    const pos = this.colony.base.campfire;
    if (!pos) return;
    await this.goNear(pos, 2, { timeout: 40000 });
    let fire = bot.blockAt(pos);
    if (!fire || fire.name !== 'campfire') return;
    let put = 0;
    for (let i = 0; i < 4; i++) {
      const raw = I.itemsOf(bot).find((it) => I.RAW_FOOD[it.name] && it.name !== 'potato');
      if (!raw) break;
      await bot.equip(raw, 'hand');
      try {
        await bot.activateBlock(fire);
        put++;
      } catch {
        break;
      }
      await sleep(200);
      fire = bot.blockAt(pos);
    }
    if (!put) return;
    await this.guard(31000); // stay by the fire while it cooks
    await this.collectDrops(pos.offset(0.5, 0.5, 0.5), 3, 6000);
    this.stats.cooked += put;
    this.colony.stat('cooked', put);
  }

  async bakeBread() {
    const bot = this.bot;
    const n = Math.floor(I.count(bot, 'wheat') / 3);
    if (!n) return;
    const table = await this.reachTable();
    await this.craft('bread', n, table);
    this.colony.stat('bread', n);
  }

  /**
   * The colony field next to the plaza (hydrated by a water source in the middle): harvest ripe wheat,
   * till bare ground, plant seeds (seeds come from tall grass), bake bread from the harvest.
   */
  async farm() {
    const bot = this.bot;
    const c = this.colony;
    const f = c.base.farm;
    if (!f) return this.hunt();
    if (I.toolTier(bot, 'hoe') < 0) {
      const tier = I.count(bot, I.STONE_DROP) >= 2 ? 1 : 0;
      return this.craftWithMaterials(TOOL_RECIPE.hoe(tier).item, TOOL_RECIPE.hoe(tier).needs);
    }
    const cells = [];
    for (let x = f.x1; x <= f.x2; x++) for (let z = f.z1; z <= f.z2; z++) if (!(x === f.wx && z === f.wz)) cells.push(new Vec3(x, f.y, z));
    let did = 0;
    // 1. harvest
    for (const p of cells) {
      const crop = bot.blockAt(p.offset(0, 1, 0));
      if (crop?.name === 'wheat' && Number(crop.getProperties().age) >= 7) {
        await this.goNear(p, 2, { timeout: 15000 });
        await bot.dig(bot.blockAt(p.offset(0, 1, 0)), true).catch(() => {});
        did++;
      }
    }
    if (did) {
      await this.collectDrops(new Vec3((f.x1 + f.x2) / 2, f.y + 1, (f.z1 + f.z2) / 2), 7, 10000);
      this.stats.wheat += did;
      c.stat('wheat', did);
    }
    // 2. seeds: tall grass around the colony
    if (I.count(bot, 'wheat_seeds') < 4 && c.storageCount('wheat_seeds') < 4) {
      const grass = ['short_grass', 'tall_grass', 'fern'].map((n) => bot.registry.blocksByName[n]?.id).filter((x) => x != null);
      for (let k = 0; k < 12 && I.count(bot, 'wheat_seeds') < 6; k++) {
        const g = bot.findBlock({ matching: grass, maxDistance: 32, useExtraInfo: (b) => !c.isProtected(b.position) });
        if (!g) break;
        await this.mineBlock(g.position);
      }
    } else if (I.count(bot, 'wheat_seeds') < 4) await this.visitBase({ reason: 'seeds', want: { wheat_seeds: 16 } });
    // 3. till and plant
    const hoe = I.bestTool(bot, 'hoe');
    for (const p of cells) {
      this.check();
      const ground = bot.blockAt(p);
      const above = bot.blockAt(p.offset(0, 1, 0));
      if (!ground || !above || (above.name !== 'air' && above.boundingBox !== 'empty')) continue;
      if (/^(dirt|grass_block|coarse_dirt|dirt_path)$/.test(ground.name) && hoe) {
        await this.goNear(p, 3, { timeout: 15000 });
        if (above.name !== 'air') await bot.dig(above, true).catch(() => {});
        await bot.equip(hoe, 'hand');
        await bot.activateBlock(bot.blockAt(p)).catch(() => {});
        await sleep(150);
      }
      const seeds = I.find(bot, 'wheat_seeds');
      if (seeds && bot.blockAt(p)?.name === 'farmland' && bot.blockAt(p.offset(0, 1, 0))?.name === 'air') {
        await this.goNear(p, 3, { timeout: 15000 });
        await bot.equip(seeds, 'hand');
        await bot.placeBlock(bot.blockAt(p), new Vec3(0, 1, 0)).catch(() => {});
        did++;
      }
    }
    // 4. bread
    if (I.count(bot, 'wheat') >= 3) await this.bakeBread();
    if (!did) await this.hunt({ quick: true });
    return { ok: true };
  }
}

function remaining(item) {
  const max = item.maxDurability;
  if (!max) return 1;
  return Math.max(0, 1 - (item.durabilityUsed ?? 0) / max);
}

function goalText(g) {
  const x = g.x ?? g.entity?.position?.x;
  return x == null ? g.constructor.name : `${g.constructor.name}(${Math.round(x)}, ${Math.round(g.y ?? 0)}, ${Math.round(g.z ?? 0)})`;
}

function describe(map) {
  return [...map].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, k]) => `${k} ${I.ru(n)}`).join(', ');
}
