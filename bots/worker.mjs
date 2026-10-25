// One live builder: a Mineflayer player that walks to its chat's site and builds the bridge's build
// list by hand, in list order. The bridge stays the owner of the plan (plot.placed, credit); the worker
// only executes the job it was given and reports every index it finished:
//   free  - the block was already right (costs nothing, no walking: checked before moving)
//   hand  - placed with a real click and read back equal
//   rcon  - set with RCON while the bot looks at the spot and swings (NBT blocks, potted plants, filled
//           cauldrons, no support, or a click that came out wrong)
// Life around the work: it walks from the district plaza, carries the block it is about to place, waits
// at the door when the chat is idle, waves (crouch toggles) and looks at you when the chat waits for
// you, walks to its bed before it goes to sleep (the bridge then shows a sleeping mannequin there).
import { createRequire } from 'node:module';
import { Vec3 } from 'vec3';
import { parseBlock, itemFor, family, sameBlock, mismatch, TRICKY, DIRS, YAW, YAW_RULE, plans, supportDirs, NOT_A_REF } from './place.mjs';
import { isBotName } from '../bridge/builders/names.mjs';
import { fixPhysics } from './physics-patch.mjs';

const require = createRequire(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REACH = 4.5;
const key = (p) => `${p.x},${p.y},${p.z}`;

let mineflayer;
let pathfinderPlugin;
let Movements;
let goals;
let Item;
/** Loaded lazily (the runner starts quickly and reports problems over IPC first). */
export async function loadLibs() {
  mineflayer = require('mineflayer');
  ({ pathfinder: pathfinderPlugin, Movements, goals } = require('mineflayer-pathfinder'));
}

async function withTimeout(promise, ms) {
  let t;
  try {
    return await Promise.race([promise, new Promise((_, rej) => (t = setTimeout(() => rej(new Error('timeout')), ms)))]);
  } finally {
    clearTimeout(t);
  }
}

class Abort extends Error {}

export class BotWorker {
  /**
   * @param runner { cmd, send, log, options: { host, port, version, viewDistance, speed } }
   * @param spec   { sid, name, tag, team, prefix, at:[x,y,z], site: { key, front, look, top } }
   */
  constructor(runner, spec) {
    this.runner = runner;
    this.sid = spec.sid;
    this.name = spec.name;
    this.spec = spec;
    this.site = spec.site ?? null;
    this.at = spec.at ?? spec.site?.front ?? null;
    this.mood = 'idle';
    this.hand = null;
    this.job = null;
    this.gotoReq = null;
    this.parkReq = null;
    this.quitReq = null;
    this.bot = null;
    this.ready = false;
    this.closed = false;
    this.failures = 0;
    this.scaffold = new Set();
    this.tempBlocks = [];
    this.hotbar = new Array(9).fill(null);
    this.hotIdx = 0;
    this.myPlacing = false;
    this.yawRule = { ...YAW_RULE };
    this.wave = { since: 0, crouch: false, next: 0 };
    this.lastIdleLook = 0;
    this.stats = { free: 0, hand: 0, rcon: 0, rconTricky: 0, rconNoSupport: 0, rconWrong: 0, rconFar: 0, verifyFixed: 0, walk: 0, walkFail: 0, fly: 0, tp: 0, stuck: 0, scaffold: 0, reconnects: 0, deaths: 0 };
    this.placedAt = []; // timestamps of real placements (blocks/min)
    this.timing = { blockMs: 0, moveMs: 0 }; // time per placed block, of it moving into reach
  }

  log(...a) {
    this.runner.log(`[${this.name}]`, ...a);
  }
  cmd(c) {
    return this.runner.cmd(c);
  }
  report(msg) {
    this.runner.send({ sid: this.sid, ...msg });
  }
  get speed() {
    return this.runner.options.speed ?? 'normal';
  }

  // ------------------------------------------------------------------ connection

  start() {
    this.loop().catch((err) => this.log('loop crashed:', err.stack ?? err.message));
  }

  async connect() {
    const o = this.runner.options;
    this.report({ type: 'state', status: 'connecting' });
    const bot = mineflayer.createBot({ host: o.host, port: o.port, username: this.name, auth: 'offline', version: o.version, viewDistance: o.viewDistance ?? 4, hideErrors: true, logErrors: false });
    this.bot = bot;
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('spawn timeout')), 45000);
      bot.once('spawn', () => {
        clearTimeout(t);
        resolve();
      });
      bot.once('kicked', (r) => {
        clearTimeout(t);
        reject(new Error(`kicked: ${typeof r === 'string' ? r : JSON.stringify(r)}`.slice(0, 200)));
      });
      bot.once('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
      bot.once('end', () => {
        clearTimeout(t);
        reject(new Error('connection ended'));
      });
    });
    bot.loadPlugin(pathfinderPlugin);
    fixPhysics(bot); // no more server position resets at walls (see physics-patch.mjs)
    bot.on('end', (why) => this.onEnd(bot, why));
    bot.on('error', (e) => this.log('error:', e.message));
    bot.on('kicked', (r) => this.log('kicked:', typeof r === 'string' ? r : JSON.stringify(r).slice(0, 200)));
    bot.on('death', () => {
      this.stats.deaths++;
      this.log('died (creative should prevent this); respawning');
    });
    bot.on('respawn', () => {
      if (this.ready) this.afterRespawn().catch(() => {});
    });
    bot.on('forcedMove', () => {
      this.forced = (this.forced ?? 0) + 1;
    });
    bot.on('blockPlaced', (_old, nb) => {
      if (!this.myPlacing && nb && /dirt|cobblestone/.test(nb.name)) this.scaffold.add(key(nb.position));
    });
    const m = new Movements(bot);
    m.canDig = false;
    m.allow1by1towers = true;
    m.allowParkour = true;
    m.allowSprinting = true;
    m.canOpenDoors = false;
    m.scafoldingBlocks = [bot.registry.itemsByName.dirt.id];
    bot.pathfinder.setMovements(m);
    bot.pathfinder.thinkTimeout = 3000;
    Item ??= require('prismarine-item')(bot.registry);
    await this.setup();
  }

  /** Server-side set-up after every (re)connect: creative, tags, nametag team, advancements, position. */
  async setup() {
    const n = this.name;
    await this.cmd(`gamemode creative ${n}`);
    const tags = (await this.cmd(`tag ${n} list`)).match(/alps_b_[A-Za-z0-9_-]+/g) ?? [];
    for (const t of new Set(tags)) if (t !== this.spec.tag) await this.cmd(`tag ${n} remove ${t}`);
    await this.cmd(`tag ${n} add ${this.spec.tag}`);
    await this.cmd(`tag ${n} add alps_bot`);
    const team = this.spec.team;
    await this.cmd(`team add ${team}`);
    await this.cmd(`team modify ${team} color gray`);
    await this.cmd(`team modify ${team} collisionRule never`);
    await this.cmd(`team modify ${team} nametagVisibility always`);
    await this.cmd(`team modify ${team} friendlyFire false`);
    await this.applyLabel();
    await this.cmd(`team join ${team} ${n}`);
    // Vanilla advancements would be announced in chat ("Bauer_Kai has made the advancement…") whenever
    // the creative inventory hands the bot a new item: grant them all once, silently.
    if (!(await this.cmd(`tag ${n} list`)).includes('alps_botadv')) {
      const rule = /true/.test(await this.cmd('gamerule show_advancement_messages')); // 1.21.11 name of announceAdvancements
      if (rule) await this.cmd('gamerule show_advancement_messages false');
      await this.cmd(`advancement grant ${n} everything`);
      if (rule) await this.cmd('gamerule show_advancement_messages true');
      await this.cmd(`tag ${n} add alps_botadv`);
    }
    const at = this.at ?? this.site?.front;
    this.at = null; // after a reconnect it comes back at its site
    if (at) {
      await this.cmd(`tp ${n} ${at[0] + 0.5} ${at[1]} ${at[2] + 0.5}`);
      await this.bot.waitForTicks(4).catch(() => {});
      await withTimeout(this.bot.waitForChunksToLoad(), 15000).catch(() => {});
    }
    await this.cmd(`execute at ${n} run particle minecraft:poof ~ ~1 ~ 0.3 0.5 0.3 0.02 20`);
    // creative hotbar: slot 8 = dirt for scaffolding, slot 7 = what the bot shows in its hand when idle
    this.hotbar.fill(null);
    await this.bot.creative.setInventorySlot(44, new Item(this.bot.registry.itemsByName.dirt.id, 64)).catch(() => {});
    this.hotbar[8] = 'dirt';
    this.ready = true;
    this.failures = 0;
    this.report({ type: 'state', status: 'ready' });
    this.log(`ready at ${this.pos()}`);
  }

  async afterRespawn() {
    await this.cmd(`gamemode creative ${this.name}`);
    const f = this.site?.front;
    if (f) await this.cmd(`tp ${this.name} ${f[0] + 0.5} ${f[1]} ${f[2] + 0.5}`);
  }

  onEnd(bot, why) {
    if (bot !== this.bot) return;
    this.bot = null;
    this.ready = false;
    if (this.closed) return;
    this.log('disconnected:', String(why ?? '').slice(0, 120));
    this.report({ type: 'state', status: 'lost' });
  }

  pos() {
    const p = this.bot?.entity?.position;
    return p ? [Number(p.x.toFixed(2)), Number(p.y.toFixed(2)), Number(p.z.toFixed(2))] : null;
  }

  /** Nametag: chat name as team prefix, status as suffix (players have no description line). */
  async applyLabel() {
    const { team, prefix, prefixColor, suffix, suffixColor } = this.spec;
    const json = (text, color) => `{text:${JSON.stringify(String(text ?? ''))}${color ? `,color:"${color}"` : ''}}`;
    await this.cmd(`team modify ${team} prefix ${json(prefix ? `${prefix} ` : '', prefixColor ?? 'yellow')}`);
    await this.cmd(`team modify ${team} suffix ${json(suffix ? ` ${suffix}` : '', suffixColor ?? 'gray')}`);
  }

  // ------------------------------------------------------------------ commands from the bridge

  setSite(site) {
    this.site = site;
    this.abortWalk = true;
  }
  setJob(job) {
    // job: { id, siteKey, total, start, limit, blocks: [[i, x, y, z, block]], skip: [i], prev: [[i,x,y,z,block]] }
    const list = job.blocks.map(([i, x, y, z, block]) => ({ i, pos: new Vec3(x, y, z), block, t: parseBlock(block) }));
    const prev = (job.prev ?? []).map(([i, x, y, z, block]) => ({ i, pos: new Vec3(x, y, z), block, t: parseBlock(block) }));
    const all = [...prev, ...list];
    this.job = {
      id: job.id, siteKey: job.siteKey, total: job.total, start: job.start, list, prev, cursor: 0, limit: job.limit ?? 0, placed: 0, skip: new Set(job.skip ?? []),
      pending: new Set(list.map((b) => key(b.pos))), top: Math.max(0, ...all.map((b) => b.pos.y)), checkedPrev: false, verifyList: job.verify ?? null,
    };
    this.abortWalk = true;
  }
  setLimit(id, limit) {
    if (this.job?.id === id) this.job.limit = limit;
  }
  setMood(mood) {
    if (mood === this.mood) return;
    this.mood = mood;
    if (mood === 'waiting') this.wave = { since: Date.now(), crouch: false, next: 0 };
    else this.bot?.setControlState('sneak', false);
    this.abortWalk = mood !== 'working';
  }
  setLabel(fields) {
    Object.assign(this.spec, fields);
    if (this.ready) this.applyLabel().catch(() => {});
  }

  // ------------------------------------------------------------------ main loop

  async loop() {
    while (!this.closed) {
      try {
        if (this.quitReq) {
          await this.doQuit();
          return;
        }
        if (!this.bot) {
          try {
            await this.connect();
          } catch (err) {
            this.ready = false;
            try {
              this.bot?.quit();
            } catch {}
            this.bot = null;
            this.failures++;
            this.stats.reconnects++;
            this.log(`connect failed (${this.failures}): ${err.message}`);
            if (this.failures >= 12) {
              this.report({ type: 'state', status: 'failed', error: err.message });
              this.closed = true;
              return;
            }
            this.report({ type: 'state', status: 'lost' });
            await sleep(Math.min(30000, 2000 * 2 ** (this.failures - 1)));
          }
          continue;
        }
        if (!this.ready) {
          await sleep(200);
          continue;
        }
        await this.step();
      } catch (err) {
        if (err instanceof Abort || !this.bot) continue; // aborted walk, or the bot left meanwhile
        this.log('step error:', err.stack ?? err.message);
        await sleep(500);
      }
    }
  }

  async step() {
    this.abortWalk = false;
    if (Date.now() > (this.nextCheck ?? 0)) {
      // Every half minute: still tagged (the bridge finds its builder by the tag) and in creative?
      this.nextCheck = Date.now() + 30000;
      if (!(await this.cmd(`tag ${this.name} list`)).includes(this.spec.tag)) {
        await this.cmd(`tag ${this.name} add ${this.spec.tag}`);
        await this.cmd(`team join ${this.spec.team} ${this.name}`);
      }
      if (this.bot.game?.gameMode !== 'creative') await this.cmd(`gamemode creative ${this.name}`);
    }
    if (this.parkReq) return this.doPark();
    if (this.gotoReq) return this.doGoto();
    if (this.mood === 'waiting') return this.doWave();
    const job = this.job;
    if (job && job.siteKey === this.site?.key && this.mood === 'working' && job.cursor < job.list.length) {
      if (!job.checkedPrev) return this.checkPrev();
      return this.doBlock();
    }
    return this.doIdle();
  }

  // ------------------------------------------------------------------ building

  /** After a reconnect or restart the last blocks before plot.placed may be half done: fix them silently. */
  async checkPrev() {
    const job = this.job;
    job.checkedPrev = true;
    for (const b of job.prev) {
      const w = this.bot.blockAt(b.pos);
      if (w && !sameBlock(w, b.t)) await this.cmd(`setblock ${b.pos.x} ${b.pos.y} ${b.pos.z} ${b.block}`);
    }
  }

  async doBlock() {
    const job = this.job;
    const b = job.list[job.cursor];
    if (job.skip.has(b.i)) {
      await this.advance(job, b, null);
      return;
    }
    let world = this.bot.blockAt(b.pos);
    if (!world) {
      // chunk not here yet: get closer (the bot sees what a player at its spot would see)
      await this.travel(b.pos.offset(0.5, 1, 0.5), 6);
      world = this.bot.blockAt(b.pos);
      if (!world) {
        await sleep(300);
        return;
      }
    }
    if (sameBlock(world, b.t)) {
      this.stats.free++;
      await this.advance(job, b, 'free');
      return;
    }
    if (job.placed >= job.limit) {
      // out of credit: stand and look at the next block (the bridge raises the limit as the chat works)
      await this.bot.lookAt(b.pos.offset(0.5, 0.5, 0.5)).catch(() => {});
      await sleep(250);
      return;
    }
    const t0 = Date.now();
    const how = await this.place(b, job);
    this.timing.blockMs += Date.now() - t0;
    job.placed++;
    this.placedAt.push(Date.now());
    if (this.placedAt.length > 200) this.placedAt.shift();
    await this.advance(job, b, how);
    if (this.speed === 'calm') await sleep(250);
  }

  async advance(job, b, how) {
    job.pending.delete(key(b.pos));
    job.cursor++;
    if (job.cursor >= job.list.length) await this.finishJob(job).catch((err) => this.log('final check:', err.message));
    if (how && this.job === job) this.report({ type: 'placed', job: job.id, i: b.i, how });
  }

  /** End of a site: scaffolding down, then the whole list read back and anything off set by RCON. */
  async finishJob(job) {
    await this.clearScaffold();
    await this.bot?.waitForTicks(4).catch(() => {});
    const list = [...job.prev, ...job.list, ...(job.verifyList ?? []).map(([i, x, y, z, block]) => ({ i, pos: new Vec3(x, y, z), block, t: parseBlock(block) }))];
    let fixed = 0;
    for (const b of list) {
      if (job.skip.has(b.i)) continue;
      const w = this.bot?.blockAt(b.pos);
      if (w && !sameBlock(w, b.t)) {
        await this.cmd(`setblock ${b.pos.x} ${b.pos.y} ${b.pos.z} ${b.block}`);
        fixed++;
      }
    }
    this.stats.verifyFixed += fixed;
    if (fixed) this.log(`site ${job.siteKey}: fixed ${fixed} blocks at the final check`);
  }

  eye() {
    return this.bot.entity.position.offset(0, this.bot.entity.eyeHeight ?? 1.62, 0);
  }
  inReach(p) {
    return this.eye().distanceTo(p.offset(0.5, 0.5, 0.5)) <= REACH;
  }
  /** Standing on p (it is about to be dug out or replaced). */
  onTop(p, s = this.bot.entity.position) {
    return s.y >= p.y + 0.9 && s.y - p.y < 1.3 && Math.abs(s.x - (p.x + 0.5)) < 0.8 && Math.abs(s.z - (p.z + 0.5)) < 0.8;
  }
  occupies(p, s = this.bot.entity.position) {
    return s.x + 0.3 > p.x && s.x - 0.3 < p.x + 1 && s.z + 0.3 > p.z && s.z - 0.3 < p.z + 1 && s.y + 1.8 > p.y && s.y < p.y + 1;
  }
  free(p) {
    const b = this.bot.blockAt(p);
    return !b || b.boundingBox === 'empty';
  }
  solidRef(p) {
    const b = this.bot.blockAt(p);
    if (!b || b.boundingBox !== 'block' || NOT_A_REF.test(b.name)) return null;
    return b;
  }

  /** Where to stand for p: free 1x2 cell in reach, not a cell still to be built, preferring ground and spots covering the next blocks. */
  pickSpot(p) {
    const job = this.job;
    const cur = this.bot.entity.position;
    const upcoming = job ? job.list.slice(job.cursor, job.cursor + 40).map((b) => b.pos) : [];
    let best = null;
    for (let dx = -4; dx <= 4; dx++)
      for (let dz = -4; dz <= 4; dz++)
        for (const dy of [-2, -1, 0, 1]) {
          const c = new Vec3(p.x + dx, p.y + dy, p.z + dz);
          const s = c.offset(0.5, 0, 0.5);
          const e = s.offset(0, 1.62, 0);
          if (e.distanceTo(p.offset(0.5, 0.5, 0.5)) > REACH - 0.4) continue;
          if (this.occupies(p, s) || c.offset(0, -1, 0).equals(p)) continue;
          if (!this.free(c) || !this.free(c.offset(0, 1, 0))) continue;
          if (job?.pending.has(key(c)) || job?.pending.has(key(c.offset(0, 1, 0)))) continue;
          let score = 0;
          for (const q of upcoming) if (e.distanceTo(q.offset(0.5, 0.5, 0.5)) <= REACH - 0.2 && !this.occupies(q, s)) score++;
          const ground = !this.free(c.offset(0, -1, 0));
          score += ground ? 6 : 0;
          score -= 0.15 * s.distanceTo(cur);
          if (!best || score > best.score) best = { s, score, ground };
        }
    return best;
  }

  clearLine(a, b) {
    const n = Math.ceil(a.distanceTo(b) * 3) + 1;
    for (let i = 0; i <= n; i++) {
      const q = a.plus(b.minus(a).scaled(i / n));
      for (const [ox, oz] of [[-0.3, -0.3], [0.3, 0.3], [-0.3, 0.3], [0.3, -0.3]])
        for (const oy of [0.05, 0.9, 1.75]) if (!this.free(q.offset(ox, oy, oz).floored())) return false;
    }
    return true;
  }

  /** Creative-player hop: straight up, across above everything around, straight down. */
  async fly(s, top) {
    const bot = this.bot;
    const a = bot.entity.position.clone();
    const flyTo = (q) => withTimeout(bot.creative.flyTo(q), 4000 + a.distanceTo(q) * 150);
    if (this.clearLine(a, s)) return flyTo(s);
    const hy = Math.max(top + 2, a.y, s.y);
    const up = new Vec3(a.x, hy, a.z);
    const over = new Vec3(s.x, hy, s.z);
    if (!this.clearLine(a, up) || !this.clearLine(over, s)) throw new Error('no clear flight');
    await flyTo(up);
    await flyTo(over);
    await flyTo(s);
  }

  /**
   * pathfinder.goto with the work-around for the Paper 1.21.11 physics mismatch (see physics-patch.mjs):
   * a burst of forced moves means the server keeps resetting us; let go, hop, path again.
   */
  async walkTo(goal, { timeout = 15000, retries = 3 } = {}) {
    const bot = this.bot;
    const deadline = Date.now() + timeout;
    let forced = [];
    const onForced = () => forced.push(Date.now());
    bot.on('forcedMove', onForced);
    try {
      bot.creative.stopFlying();
      for (let attempt = 0; attempt <= retries; attempt++) {
        forced = [];
        let timer;
        const watch = new Promise((_, rej) => {
          timer = setInterval(() => {
            const now = Date.now();
            forced = forced.filter((t) => now - t < 600);
            if (forced.length >= 4) rej(Object.assign(new Error('server-stuck'), { stuck: true }));
            if (now > deadline) rej(new Error('timeout'));
            if (this.abortWalk || this.quitReq || this.closed) rej(new Abort('aborted'));
          }, 100);
        });
        try {
          await Promise.race([bot.pathfinder.goto(goal), watch]);
          return true;
        } catch (e) {
          bot.pathfinder.setGoal(null);
          bot.clearControlStates();
          if (e instanceof Abort) throw e;
          const retryable = e.stuck || /stopped|stuck/i.test(e.message);
          if (e.stuck) this.stats.stuck++;
          if (!retryable || Date.now() > deadline) return false;
          await bot.waitForTicks(12).catch(() => {});
          bot.setControlState('jump', true);
          await bot.waitForTicks(4).catch(() => {});
          bot.setControlState('jump', false);
        } finally {
          clearInterval(timer);
        }
      }
      return false;
    } finally {
      bot.off('forcedMove', onForced);
    }
  }

  /** Gets within `range` of `dest`: walk (short, on the ground), else fly, else teleport. */
  async travel(dest, range = 1.5, { top } = {}) {
    const bot = this.bot;
    const here = bot.entity.position;
    if (here.distanceTo(dest) <= range + 0.3) return true;
    const far = here.distanceTo(dest);
    const walkLimit = this.speed === 'calm' ? 64 : 48;
    if (far < walkLimit) {
      const ok = await this.walkTo(new goals.GoalNear(dest.x, dest.y, dest.z, Math.max(1, range)), { timeout: 6000 + far * 400, retries: 3 });
      if (ok || bot.entity.position.distanceTo(dest) <= range + 0.5) {
        this.stats.walk++;
        return true;
      }
      this.stats.walkFail++;
    }
    try {
      const t = top ?? Math.max(here.y, dest.y) + 12;
      await this.fly(dest, t);
      this.stats.fly++;
      if (bot.entity.position.distanceTo(dest) <= range + 1) {
        bot.creative.stopFlying();
        return true;
      }
    } catch {}
    await this.cmd(`tp ${this.name} ${dest.x} ${dest.y} ${dest.z}`);
    await bot.waitForTicks(3).catch(() => {});
    this.stats.tp++;
    return true;
  }

  /** Into reach of p, not standing in it. */
  async reach(p) {
    if (this.inReach(p) && !this.occupies(p) && !this.onTop(p)) return true;
    const t0 = Date.now();
    try {
      return await this.reachInner(p);
    } finally {
      this.timing.moveMs += Date.now() - t0;
    }
  }

  async reachInner(p) {
    const bot = this.bot;
    const spot = this.pickSpot(p);
    const top = this.job?.top ?? p.y;
    if (spot) {
      // Walk on the level (or a step up/down); climbing onto walls and roofs is what creative flight is for.
      const dist = bot.entity.position.distanceTo(spot.s);
      const level = Math.abs(spot.s.y - bot.entity.position.y) < 1.5 || (this.speed === 'calm' && spot.s.y - bot.entity.position.y < 3);
      if (spot.ground && level && dist < (this.speed === 'calm' ? 32 : 24)) {
        await this.walkTo(new goals.GoalBlock(spot.s.x, spot.s.y, spot.s.z), { timeout: 1500 + dist * 350, retries: 1 });
        if (this.inReach(p) && !this.occupies(p)) {
          this.stats.walk++;
          return true;
        }
        this.stats.walkFail++;
      }
      try {
        await this.fly(spot.s, top);
        if (this.inReach(p) && !this.occupies(p)) {
          this.stats.fly++;
          return true;
        }
      } catch {}
    }
    const s = spot?.s ?? p.offset(0.5, 2, 0.5);
    await this.cmd(`tp ${this.name} ${s.x} ${s.y} ${s.z}`);
    await bot.waitForTicks(3).catch(() => {});
    this.stats.tp++;
    return this.inReach(p) && !this.occupies(p);
  }

  /** Creative hotbar: the item appears in hand like for a creative player. */
  async hold(itemName, slotHint) {
    const bot = this.bot;
    const it = bot.registry.itemsByName[itemName];
    if (!it) return false;
    let slot = this.hotbar.indexOf(itemName);
    if (slot < 0) {
      slot = slotHint ?? this.hotIdx;
      if (slotHint == null) this.hotIdx = (this.hotIdx + 1) % 7; // 7 = idle hand item, 8 = dirt
      await bot.creative.setInventorySlot(36 + slot, new Item(it.id, 64));
      this.hotbar[slot] = itemName;
    }
    if (bot.quickBarSlot !== slot) {
      bot.setQuickBarSlot(slot);
      if (slot !== 7) this.shownHand = null;
      await bot.waitForTicks(1).catch(() => {});
    }
    return true;
  }

  async placeOnce(p, plan) {
    const bot = this.bot;
    const target = p.offset(0.5, 0.5, 0.5);
    const d = target.minus(this.eye());
    const yaw = plan.yaw ?? Math.atan2(-d.x, -d.z);
    const pitch = plan.pitch ?? Math.max(-0.7, Math.min(0.7, Math.atan2(d.y, Math.hypot(d.x, d.z))));
    await bot.look(yaw, pitch, true);
    await bot.waitForTicks(1);
    const f = plan.face;
    let delta;
    if (f.y === 0) {
      const cy = plan.cy ?? 0.5;
      const along = plan.cursor ?? 0.5;
      delta = new Vec3(f.x === 0 ? along : 0.5 + f.x * 0.5, cy, f.z === 0 ? along : 0.5 + f.z * 0.5);
    } else delta = new Vec3(plan.cursor ?? 0.5, 0.5 + f.y * 0.5, 0.5);
    this.myPlacing = true;
    try {
      await withTimeout(bot._placeBlockWithOptions(plan.ref, f, { forceLook: 'ignore', delta, swingArm: 'right' }), 2500);
    } finally {
      this.myPlacing = false;
    }
  }

  async clearCell(p) {
    const b = this.bot.blockAt(p);
    if (!b || /air$/.test(b.name) || b.name === 'water' || b.name === 'lava') return; // liquids are replaced by the placement itself
    try {
      await withTimeout(this.bot.dig(b, 'ignore'), 2000);
    } catch {
      await this.cmd(`setblock ${p.x} ${p.y} ${p.z} air`);
    }
  }

  async lookSwing(p) {
    const bot = this.bot;
    if (bot.entity.position.distanceTo(p) < 12) {
      await bot.lookAt(p.offset(0.5, 0.5, 0.5), true).catch(() => {});
      bot.swingArm('right');
    }
  }

  async rconPlace(b, why) {
    await this.lookSwing(b.pos);
    await this.cmd(`setblock ${b.pos.x} ${b.pos.y} ${b.pos.z} ${b.block}`);
    this.stats[why] = (this.stats[why] ?? 0) + 1;
    this.stats.rcon++;
    return 'rcon';
  }

  /** A throw-away dirt block beside p so the real block has something to be placed against; dug out right after. */
  async tempSupport(p, t) {
    for (const d of supportDirs(t)) {
      const q = p.minus(DIRS[d]);
      if (!this.free(q) || this.occupies(q) || this.job?.pending.has(key(q))) continue;
      for (const v of Object.values(DIRS)) {
        const refPos = q.minus(v);
        if (refPos.equals(p)) continue;
        const ref = this.solidRef(refPos);
        if (!ref) continue;
        await this.hold('dirt', 8);
        try {
          await this.placeOnce(q, { ref, face: v });
          await this.bot.waitForTicks(1);
          if (this.bot.blockAt(q)?.name === 'dirt') {
            this.tempBlocks.push(q);
            this.stats.scaffold++;
            return true;
          }
        } catch {}
      }
    }
    return false;
  }

  async dropTempSupport() {
    while (this.tempBlocks.length) {
      const q = this.tempBlocks.pop();
      if (this.bot.blockAt(q)?.name === 'dirt') await this.clearCell(q);
    }
  }

  /** Pathfinder towers (dirt) that are not part of the house come down at the end of a site. */
  async clearScaffold() {
    if (!this.bot) return;
    const want = new Map();
    for (const b of [...(this.job?.prev ?? []), ...(this.job?.list ?? [])]) want.set(key(b.pos), b);
    for (const k of [...this.scaffold].sort((a, b) => Number(b.split(',')[1]) - Number(a.split(',')[1]))) {
      this.scaffold.delete(k);
      const [x, y, z] = k.split(',').map(Number);
      const p = new Vec3(x, y, z);
      if (this.bot.blockAt(p)?.name !== 'dirt') continue;
      const b = want.get(k);
      if (b) {
        if (b.t.name !== 'dirt') await this.cmd(`setblock ${x} ${y} ${z} ${b.block}`);
        continue;
      }
      if (this.inReach(p)) await this.clearCell(p);
      else await this.cmd(`setblock ${x} ${y} ${z} air`);
    }
  }

  /** One block of the list; returns 'hand' or 'rcon'. */
  async place(b, job) {
    const bot = this.bot;
    const { pos: p, t } = b;
    const fam = family(t.name);
    const item = itemFor(t.name);
    const secondHalf = (fam === 'door' && t.props.half === 'upper') || (fam === 'bed' && t.props.part === 'head');
    if (TRICKY.test(t.name) || t.nbt || secondHalf || !bot.registry.itemsByName[item]) {
      if (secondHalf) {
        await bot.waitForTicks(1).catch(() => {});
        if (sameBlock(bot.blockAt(p), t)) {
          this.stats.free++;
          return 'free';
        }
      }
      if (bot.entity.position.distanceTo(p) > 7 && !(this.speed === 'fast' && bot.entity.position.distanceTo(p) < 12)) await this.travel(p.offset(0.5, 1, 0.5), 4, { top: job.top + 2 });
      if (bot.registry.itemsByName[item]) await this.hold(item).catch(() => {});
      return this.rconPlace(b, 'rconTricky');
    }
    // Hurry: far blocks with a big backlog are set from where the bot stands (it still looks and swings).
    if (this.speed === 'fast' && job.limit - job.placed > 20 && !this.inReach(p) && bot.entity.position.distanceTo(p) < 10) {
      await this.hold(item).catch(() => {});
      return this.rconPlace(b, 'rconFar');
    }
    await this.reach(p);
    const world = bot.blockAt(p);
    if (world && !/air$/.test(world.name)) await this.clearCell(p);
    let ps = plans(p, t, (q) => this.solidRef(q), this.yawRule);
    if (!ps.length && (await this.tempSupport(p, t))) ps = plans(p, t, (q) => this.solidRef(q), this.yawRule);
    if (!ps.length) {
      await this.hold(item).catch(() => {});
      return this.rconPlace(b, 'rconNoSupport');
    }
    await this.hold(item);
    const plan = ps[0];
    let ok = false;
    try {
      await this.placeOnce(p, plan);
      await bot.waitForTicks(1);
      let w = bot.blockAt(p);
      // stateful toggles a player does with a second click
      if (w?.name === t.name && 'open' in t.props && String(w.getProperties().open) !== t.props.open) {
        await withTimeout(bot.activateBlock(w), 1500).catch(() => {});
        await bot.waitForTicks(2).catch(() => {});
        w = bot.blockAt(p);
      }
      if (t.props.type === 'double' && w?.name === t.name && w.getProperties().type !== 'double') {
        await this.placeOnce(p, { ref: w, face: DIRS.up }).catch(() => {});
        await bot.waitForTicks(1).catch(() => {});
        w = bot.blockAt(p);
      }
      ok = sameBlock(w, t);
      if (ok && plan.yaw != null && t.props.facing in YAW && fam in this.yawRule) {
        this.yawRule[fam] = Math.abs(((plan.yaw - YAW[t.props.facing] + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) < 0.1 ? 1 : -1;
      } else if (!ok && plan.yaw != null && fam in this.yawRule && w?.name === t.name && /facing/.test(mismatch(w, t))) {
        this.yawRule[fam] *= -1; // learnt the wrong convention: flip it for next time
      }
    } catch {}
    await this.dropTempSupport();
    if (ok) {
      this.stats.hand++;
      return 'hand';
    }
    // No retries (they are the main loss of time): the server sets it right while the bot swings.
    return this.rconPlace(b, 'rconWrong');
  }

  // ------------------------------------------------------------------ life

  async doIdle() {
    const bot = this.bot;
    const f = this.site?.front;
    if (!f) {
      await sleep(400);
      return;
    }
    const front = new Vec3(f[0] + 0.5, f[1], f[2] + 0.5);
    if (bot.entity.position.distanceTo(front) > 2.2) {
      await this.clearScaffold();
      await this.travel(front, 1, { top: this.job?.top });
      return;
    }
    if (this.mood !== 'working' && this.hand !== undefined) await this.showHand();
    const now = Date.now();
    if (now > this.lastIdleLook) {
      // look at the house, now and then glance around
      this.lastIdleLook = now + 2500 + Math.random() * 4000;
      const [lx, lz] = this.site.look ?? [f[0], f[2] - 5];
      const glance = Math.random() < 0.3;
      const tgt = glance ? new Vec3(f[0] + (Math.random() * 16 - 8), f[1] + 1.5, f[2] + (Math.random() * 16 - 8)) : new Vec3(lx + 0.5, f[1] + 2, lz + 0.5);
      await bot.lookAt(tgt).catch(() => {});
    }
    await sleep(300);
  }

  async showHand() {
    const item = this.hand && this.hand !== 'air' ? this.hand.replace(/^minecraft:/, '') : null;
    if (this.shownHand === (item ?? 'none')) return;
    this.shownHand = item ?? 'none';
    if (item && this.bot.registry.itemsByName[item]) {
      this.hotbar[7] = null;
      await this.hold(item, 7).catch(() => {});
    } else {
      await this.bot.creative.setInventorySlot(43, null).catch(() => {});
      this.hotbar[7] = null;
      this.bot.setQuickBarSlot(7);
    }
  }

  /** Waiting for permission: stop, look at the nearest real player (or the house) and bob. */
  async doWave() {
    const bot = this.bot;
    const now = Date.now();
    const player = bot.nearestEntity((e) => e.type === 'player' && e.username && e.username !== bot.username && !isBotName(e.username) && e.position.distanceTo(bot.entity.position) < 32);
    if (player) await bot.lookAt(player.position.offset(0, 1.6, 0)).catch(() => {});
    if (now - this.wave.since < 120000 && now > this.wave.next) {
      this.wave.next = now + 500;
      this.wave.crouch = !this.wave.crouch;
      bot.setControlState('sneak', this.wave.crouch);
    } else if (now - this.wave.since >= 120000) bot.setControlState('sneak', false);
    await sleep(150);
  }

  /** Renovation helper: walk near the changes and swing at them while the crew sets the blocks. */
  async doGoto() {
    const { x, y, z } = this.gotoReq;
    this.gotoReq = null;
    this.stats.helped = (this.stats.helped ?? 0) + 1;
    const p = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
    if (this.bot.entity.position.distanceTo(p) > 5) await this.travel(p.offset(0.5, 0, 0.5), 3.5, { top: p.y + 2 }).catch(() => {});
    await this.lookSwing(p.offset(0, -1, 0));
  }

  /** Going to sleep: walk to the bed (or the door), then leave; the bridge shows a sleeping mannequin there. */
  async doPark() {
    const req = this.parkReq;
    this.parkReq = null;
    await this.clearScaffold().catch(() => {});
    const to = req.to;
    if (to) await this.travel(new Vec3(to[0] + 0.5, to[1], to[2] + 0.5), 1.8, { top: (this.job?.top ?? to[1]) + 2 }).catch(() => {});
    this.quitReq = { why: req.why ?? 'sleep' };
    await this.doQuit();
  }

  async doQuit() {
    this.closed = true;
    const why = this.quitReq?.why ?? 'quit';
    if (this.bot) {
      if (this.ready) await this.cmd(`tag ${this.name} remove ${this.spec.tag}`); // the bridge's selectors stop finding it right away
      try {
        this.bot.setControlState('sneak', false);
        await this.clearScaffold();
        await this.dropTempSupport();
      } catch {}
      const pos = this.pos();
      if (this.ready) await this.cmd(`execute at ${this.name} run particle minecraft:poof ~ ~1 ~ 0.3 0.5 0.3 0.02 20`);
      try {
        this.bot.quit('done');
      } catch {}
      this.bot = null;
      this.ready = false;
      this.report({ type: 'state', status: why === 'sleep' ? 'parked' : 'gone', pos });
      return;
    }
    this.report({ type: 'state', status: 'gone' });
  }

  info() {
    const now = Date.now();
    const recent = this.placedAt.filter((t) => now - t < 300000);
    const span = recent.length > 1 ? (now - recent[0]) / 60000 : 0;
    return { sid: this.sid, name: this.name, ready: this.ready, mood: this.mood, site: this.site?.key ?? null, job: this.job ? `${this.job.cursor}/${this.job.list.length}` : null, blocksPerMin: span > 0.2 ? Math.round(recent.length / span) : null, stats: this.stats, timing: this.timing };
  }
}
