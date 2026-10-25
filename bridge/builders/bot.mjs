// Builder backend for mode 2 "Realistic": the builder is a real player (a Mineflayer bot in the bot runner
// process, bots/runner.mjs) that walks to the site and places the blocks by hand. The bridge keeps the
// plan: it sends the bot the site's build list from plot.placed on (a "job") plus a placement limit that
// follows the chat's credit, and books every index the bot reports back, in list order, exactly like
// the fast mode books a setblock. So progress %, renovation, migrations and stages work unchanged.
//
// The runner is a child of the bridge (fork + IPC: no port, nothing else can talk to it). It is started
// when the realistic mode needs it, restarted with a back-off if it dies, and stopped when the mode is
// switched back. Every failure path ends in the mannequin: a session whose bot cannot connect, a full
// pool, too little free memory — those chats simply keep a mannequin.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { botNameFor } from './names.mjs';
import { say as chatterSay } from '../features/chatter.mjs';

/** Most bots at once: `builderBotsMax` (set from the machine's capacity; `botPool` is the old name). */
export const poolSize = (config) => Math.max(0, Number(config.builderBotsMax ?? config.botPool ?? 3) || 0);

const LOST_GRACE_MS = 90000; // a bot that lost its connection gets this long to come back
const RETRY_AFTER_FAIL_MS = 5 * 60000;

/** The SNBT/JSON text component `{text:"…",color:"…"}` the features send -> [text, color]. */
function parseText(snbt) {
  const text = /text:("(?:[^"\\]|\\.)*")/.exec(snbt);
  const color = /color:"([a-z_]+)"/.exec(snbt);
  try {
    return [text ? JSON.parse(text[1]) : '', color?.[1] ?? null];
  } catch {
    return ['', null];
  }
}

export class BotBackend {
  /**
   * @param d { root, config, props, log, cmd, rt, builderTag, mannequin, onSpawn(s, site), sessions(), session(id),
   *            siteOf(key), plazaFront(session), bedSpot(session) }
   */
  constructor(d) {
    this.d = d;
    this.id = 'bot';
    this.child = null;
    this.ready = false;
    this.retryAt = 0;
    this.failures = 0;
    this.unavailable = null; // why bots cannot run right now (shown in /status)
    this.byTag = new Map(); // builder tag -> session id, for every session embodied by a bot
    this.stats = null;
    this.idleSince = 0;
  }

  log(...a) {
    this.d.log(...a);
  }
  send(msg) {
    if (!this.child?.connected) return false;
    try {
      this.child.send(msg);
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------ runner process

  runnerPath() {
    return path.join(this.d.root, 'bots', 'runner.mjs');
  }

  /** Runner process started less than 30 s ago and not ready yet. */
  starting() {
    return !!this.child && !this.ready && Date.now() - this.startedAt < 30000;
  }

  ensureRunner() {
    if (this.child || Date.now() < this.retryAt) return;
    const bots = path.join(this.d.root, 'bots');
    if (!fs.existsSync(path.join(bots, 'node_modules', 'mineflayer', 'package.json'))) {
      if (this.unavailable !== 'not installed') this.log('Realistic builders need their libraries: run `npm install` in bots/ (falling back to mannequins)');
      this.unavailable = 'not installed';
      this.retryAt = Date.now() + 60000;
      return;
    }
    const { config, props } = this.d;
    this.unavailable = 'starting';
    this.ready = false;
    this.startedAt = Date.now();
    const child = fork(this.runnerPath(), [], { cwd: bots, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], execArgv: [`--max-old-space-size=${config.botRunnerMaxHeapMB ?? 768}`] });
    this.child = child;
    const lines = (stream) => {
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', (c) => {
        buf += c;
        let k;
        while ((k = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, k).trimEnd();
          buf = buf.slice(k + 1);
          if (line) this.log(`[bots] ${line}`);
        }
      });
    };
    lines(child.stdout);
    lines(child.stderr);
    child.on('message', (m) => {
      try {
        this.onMessage(m);
      } catch (err) {
        this.log('bot message error:', err.stack ?? err.message);
      }
    });
    child.on('error', (err) => this.log('bot runner error:', err.message));
    child.on('exit', (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      this.ready = false;
      const planned = this.stopping;
      this.stopping = false;
      if (!planned) {
        this.failures++;
        this.retryAt = Date.now() + Math.min(5 * 60000, 5000 * 2 ** Math.min(this.failures, 6));
        this.unavailable = `runner exited (${signal ?? code})`;
        this.log(`Bot runner exited (${signal ?? code}); bots fall back to mannequins, retry in ${Math.round((this.retryAt - Date.now()) / 1000)} s`);
      } else this.unavailable = null;
      for (const s of this.d.sessions()) if (this.d.rt(s).body === 'bot') this.fallback(s, 'runner gone');
    });
    child.send({
      type: 'init',
      options: {
        host: props['server-ip'] || '127.0.0.1',
        port: Number(props['server-port'] || 25565),
        version: config.botVersion ?? '1.21.11',
        rconPort: Number(props['rcon.port'] || 25575),
        rconPassword: props['rcon.password'],
        viewDistance: config.botViewDistance ?? 4,
        speed: config.botSpeed ?? 'normal',
      },
    });
  }

  stopRunner() {
    if (!this.child) return;
    this.stopping = true;
    this.send({ type: 'shutdown' });
    const child = this.child;
    setTimeout(() => {
      if (child.exitCode == null) child.kill();
    }, 3000);
  }

  setSpeed(speed) {
    this.send({ type: 'speed', speed });
  }

  // ------------------------------------------------------------------ messages from the runner

  onMessage(m) {
    if (m.type === 'hello') {
      this.ready = true;
      this.failures = 0;
      this.unavailable = null;
      return;
    }
    if (m.type === 'log') return this.log(`[bots] ${m.text}`);
    if (m.type === 'stats') {
      this.stats = { rssMB: m.rssMB, cpuPct: m.cpuPct, bots: m.bots, at: Date.now() };
      return;
    }
    if (m.type === 'positions') {
      for (const [sid, x, y, z] of m.list) {
        const s = this.d.session(sid);
        const r = s && this.d.rt(s);
        if (r?.body === 'bot') Object.assign(r, { pos: [x, y, z], posAt: r.bot?.site ?? s.at }); // for the web map
      }
      return;
    }
    const s = this.d.session(m.sid);
    if (!s) return;
    const r = this.d.rt(s);
    const b = r.bot;
    if (!b || r.body !== 'bot') {
      if (m.type === 'state' && m.status === 'parked') this.parked(s, m.pos);
      return;
    }
    if (m.type === 'placed') {
      if (b.job?.id === m.job) b.done.set(m.i, m.how);
      return;
    }
    if (m.type === 'state') {
      if (m.status === 'ready') {
        const first = b.status !== 'ready' && !b.announced;
        b.status = 'ready';
        b.lostAt = 0;
        b.job = null; // (re)send the job: a reconnected bot starts from what the world shows
        b.mood = null;
        r.hand = null;
        const site = this.d.siteOf(s.at);
        if (site) {
          b.site = null;
          this.ensure(s, site);
        }
        if (first) {
          b.announced = true;
          this.d.onSpawn(s, site).catch?.(() => {});
        }
      } else if (m.status === 'lost') {
        b.status = 'lost';
        b.lostAt ||= Date.now();
      } else if (m.status === 'failed') {
        this.log(`Bot ${b.name} could not join (${m.error ?? '?'}); ${s.name} keeps a mannequin`);
        r.botRetryAt = Date.now() + RETRY_AFTER_FAIL_MS;
        this.fallback(s, 'failed');
      } else if (m.status === 'parked') this.parked(s, m.pos);
      else if (m.status === 'gone' && b.status !== 'leaving') this.fallback(s, 'gone');
    }
  }

  // ------------------------------------------------------------------ pool

  /** Live bots (spawning, ready, reconnecting or walking off to sleep). */
  count() {
    return this.d.sessions().filter((s) => this.d.rt(s).body === 'bot').length;
  }

  /** Whether one more bot may be started now (runner up, pool and memory allow). */
  canAcquire(session) {
    const { config } = this.d;
    if (Date.now() < (this.d.rt(session).botRetryAt ?? 0)) return false;
    this.ensureRunner();
    if (!this.ready) return false;
    if (this.count() >= poolSize(config)) return false;
    const freeMB = os.freemem() / 1e6;
    if (freeMB < Number(config.botMinFreeMemMB ?? 600)) {
      if (this.unavailable !== 'low memory') this.log(`Only ${Math.round(freeMB)} MB free: no new live builder (mannequin instead)`);
      this.unavailable = 'low memory';
      return false;
    }
    if (this.unavailable === 'low memory') this.unavailable = null;
    return true;
  }

  siteInfo(site) {
    return { key: site.key, front: site.front, look: site.look, top: site.front[1] + 30 };
  }

  /**
   * Gives the session a bot: the mannequin (if any) steps away and the bot appears at the district plaza
   * (a new chat) or where the mannequin stood (a waking or upgraded chat) and walks to the site.
   */
  async acquire(session, site, { from = 'here' } = {}) {
    const { cmd, rt, builderTag, mannequin } = this.d;
    const r = rt(session);
    const tag = builderTag(session);
    const taken = new Set(this.d.sessions().filter((x) => x !== session && rt(x).bot?.name).map((x) => rt(x).bot.name));
    const name = botNameFor(session, taken);
    let at = null;
    if (from === 'plaza') at = this.d.plazaFront(session);
    if (!at) {
      const pos = (await cmd(`data get entity @e[type=minecraft:mannequin,tag=${tag},limit=1] Pos`)).match(/\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/);
      at = pos && !String(session.pose).includes('sleeping') ? [Math.floor(Number(pos[1])), Math.floor(Number(pos[2]) + 0.01), Math.floor(Number(pos[3]))] : site.front;
    }
    await mannequin.leave(session);
    r.freshSite = null;
    r.awaitBotUntil = 0;
    r.body = 'bot';
    r.bot = { name, status: 'spawning', since: Date.now(), site: undefined, job: null, done: new Map(), mood: null, seq: (r.bot?.seq ?? 0) + 1 };
    r.hand = null;
    session.pose = null;
    this.byTag.set(tag, session.id);
    this.idleSince = 0;
    this.send({
      type: 'spawn', sid: session.id, name, tag, team: `alps_bt_${session.id.slice(0, 8)}`, prefix: session.name,
      at, site: this.siteInfo(site),
    });
    this.log(`Live builder ${name} for ${session.name} (${this.count()}/${poolSize(this.d.config)})`);
    return true;
  }

  /** Back to the mannequin: the bot leaves (poof), the build loop puts the mannequin up at the site. */
  fallback(session, why) {
    const r = this.d.rt(session);
    if (r.body !== 'bot') return;
    if (why !== 'runner gone' && why !== 'gone') this.send({ type: 'quit', sid: session.id, why });
    // The mannequin carries on from where this bot started: it re-checks the bot's part of the list by
    // setblock (blocks that are already right cost nothing), so a house finished after a switch is exact too.
    const site = r.bot?.job && this.d.siteOf(session.at);
    if (site?.rec && !site.rec.done && r.bot.job.key.startsWith(`${site.key}#`) && r.bot.job.start < site.rec.placed) site.rec.recheck = Math.min(site.rec.recheck ?? Infinity, r.bot.job.start);
    this.byTag.delete(this.d.builderTag(session));
    r.body = 'mannequin';
    r.bot = null;
    r.hand = null;
    session.pose = null; // work() re-creates the builder at the site
  }

  /** The chat went to sleep: the bot walks to the door and goes in; a sleeping mannequin lies in the bed. */
  park(session) {
    const r = this.d.rt(session);
    const site = this.d.siteOf(session.at);
    if (!r.bot || !site) return this.fallback(session, 'sleep');
    r.bot.status = 'leaving';
    session.pose = 'idle-sleeping'; // the build loop must not move the sleeper back to the door
    this.send({ type: 'park', sid: session.id, to: site.front });
  }

  async parked(session, pos) {
    const { rt, mannequin, builderTag } = this.d;
    const r = rt(session);
    if (r.body === 'bot' && r.bot?.status !== 'leaving') return;
    this.byTag.delete(builderTag(session));
    r.body = 'mannequin';
    r.bot = null;
    r.hand = null;
    const site = this.d.siteOf(session.at);
    if (!site || session.retired) return;
    const bed = this.d.bedSpot(session);
    try {
      await mannequin.ensure(session, site, bed ? { at: bed, pose: 'sleeping' } : { pose: 'sleeping' });
      session.pose = 'idle-sleeping';
    } catch (err) {
      session.pose = null;
    }
  }

  /** Called by the router every few seconds: reconnect timeouts. */
  tick() {
    const now = Date.now();
    for (const s of this.d.sessions()) {
      const b = this.d.rt(s).bot;
      if (this.d.rt(s).body === 'bot' && b?.status === 'lost' && now - b.lostAt > LOST_GRACE_MS) {
        this.log(`Bot ${b.name} did not come back; ${s.name} keeps a mannequin for now`);
        this.d.rt(s).botRetryAt = now + 60000;
        this.fallback(s, 'lost');
      }
    }
    // The mode was switched back and every bot has left: stop the runner (frees ~200 MB).
    if (this.child && !this.count() && this.d.config.builderMode !== 'realistic') {
      this.idleSince ||= now;
      if (now - this.idleSince > 5000) this.stopRunner();
    } else this.idleSince = 0;
  }

  // ------------------------------------------------------------------ backend interface

  async ensure(session, site) {
    const b = this.d.rt(session).bot;
    if (!b || b.site === site.key) return;
    b.site = site.key;
    b.job = null;
    this.send({ type: 'site', sid: session.id, site: this.siteInfo(site) });
    if (site.plot && !site.obj && !site.rec.done && b.saidSite !== site.key && b.status === 'ready') {
      b.saidSite = site.key;
      // A bot walking over to a house it takes on announces it (shared chatter: rate limits, feature switch).
      chatterSay(session, site.kind === 'public' ? 'start.public' : 'start.house', { what: site.label }, { priority: 1 });
    }
  }

  async setPose(session, pose) {
    // Standing / sleeping are what the bot does (park() handles sleep); nothing to set on a player.
  }

  async setHand(session, item) {
    this.send({ type: 'hand', sid: session.id, item });
  }

  async toFront(session, site) {
    await this.ensure(session, site);
    this.mood(session, 'idle');
  }

  async leave(session) {
    // A bot walks to the next site by itself (ensure() tells it where).
    const b = this.d.rt(session).bot;
    if (b) b.job = null;
  }

  /** 'home': house done (classic mode) — the bot strolls to the district plaza and waits for its next plot. 'retire': it leaves. */
  async remove(session, why = 'retire') {
    const r = this.d.rt(session);
    const plaza = why === 'home' && this.d.plazaFront(session);
    if (plaza && r.bot) {
      r.bot.site = null;
      r.bot.job = null;
      this.send({ type: 'site', sid: session.id, site: { key: 'plaza', front: plaza, look: [plaza[0], plaza[2] - 5], top: plaza[1] + 30 } });
      return;
    }
    this.byTag.delete(this.d.builderTag(session));
    if (r.body === 'bot') this.send({ type: 'quit', sid: session.id, why });
    r.body = null;
    r.bot = null;
  }

  mood(session, mood) {
    const b = this.d.rt(session).bot;
    if (!b || b.mood === mood) return;
    b.mood = mood;
    this.send({ type: 'mood', sid: session.id, mood });
  }

  jobKey(site, built) {
    return `${site.key}#${built.hash ?? built.list.length}`;
  }

  /** Books what the bot reported, in list order (free blocks and migrated ones cost no credit). */
  async sync(session, site, built, commit) {
    const b = this.d.rt(session).bot;
    if (!b?.job || b.job.key !== this.jobKey(site, built)) return;
    const { list, skip } = built;
    const rec = site.rec;
    while (rec.placed < list.length) {
      const i = rec.placed;
      if (skip?.has(i)) {
        commit('skip');
        continue;
      }
      const how = b.done.get(i);
      if (!how) break;
      b.done.delete(i);
      if (how === 'free') commit('skip');
      else {
        commit('placed');
        b.job.acked++;
      }
    }
  }

  /** Keeps the bot's job and placement limit in step with the site and the chat's credit. */
  async build(session, site, built, n, commit) {
    const r = this.d.rt(session);
    const b = r.bot;
    if (!b || b.status !== 'ready') return;
    await this.ensure(session, site);
    const w = r.waiting;
    const calling = w && (w.kind === 'permission' || w.kind === 'question');
    this.mood(session, calling ? 'waiting' : 'working');
    const rec = site.rec;
    const key = this.jobKey(site, built);
    if (!b.job || b.job.key !== key || rec.placed < b.job.start) {
      const { list, skip } = built;
      const start = rec.placed;
      const id = `${b.seq}.${(b.jobN = (b.jobN ?? 0) + 1)}`;
      const row = (x, i) => [i, x.x, x.y, x.z, x.block];
      b.job = { id, key, start, acked: 0, limit: -1 };
      b.done = new Map();
      this.send({
        type: 'job', sid: session.id,
        job: {
          id, siteKey: site.key, total: list.length, start,
          blocks: list.slice(start).map((x, k) => row(x, start + k)),
          prev: list.slice(Math.max(0, start - 20), start).map((x, k) => row(x, Math.max(0, start - 20) + k)),
          // a resumed job re-checks everything placed before it at the end of the site
          verify: start > 20 ? list.slice(0, start - 20).map((x, i) => row(x, i)) : [],
          skip: skip ? [...skip].filter((i) => i >= start) : [],
          limit: 0,
        },
      });
    }
    await this.sync(session, site, built, commit);
    const limit = b.job.acked + (n > 0 ? Math.max(0, Math.floor(session.credit)) : 0);
    if (limit !== b.job.limit) {
      b.job.limit = limit;
      this.send({ type: 'limit', sid: session.id, job: b.job.id, limit });
    }
  }

  // ------------------------------------------------------------------ feature commands aimed at the builder

  /**
   * Features talk to the builder entity with RCON (`data merge entity`, `item replace`, `tp`, `ride`).
   * A player cannot be changed that way, so for bot-embodied sessions those commands are translated:
   * name -> team prefix, status line -> team suffix, item in hand -> the bot holds it, teleports
   * (renovation helper) -> the bot walks there and swings. Returns the fake RCON output, or null to run
   * the command as it is (`execute at @e[tag=…]` effects work on players unchanged).
   */
  intercept(command) {
    if (command.startsWith('ride ')) {
      // something wants to ride the builder (the callout "!"): players cannot be ridden, it stays where it was summoned
      const t = /mount @e\[[^\]]*tag=(alps_b_[A-Za-z0-9_-]+)/.exec(command)?.[1];
      return t && this.byTag.has(t) ? 'ok' : null;
    }
    const m = /^(data merge entity|item replace entity|tp|kill) (@e\[[^\]]*\])/.exec(command);
    if (!m) return null;
    const tag = /tag=(alps_b_[A-Za-z0-9_-]+)/.exec(m[2])?.[1];
    const sid = tag && this.byTag.get(tag);
    if (!sid) return null;
    const s = this.d.session(sid);
    if (!s || this.d.rt(s).body !== 'bot') return null;
    const rest = command.slice(m[0].length);
    switch (m[1]) {
      case 'data merge entity': {
        if (rest.includes('CustomName:')) this.send({ type: 'label', sid, fields: { prefix: s.name } });
        if (rest.includes('hide_description:1b')) this.send({ type: 'label', sid, fields: { suffix: '' } });
        else if (rest.includes('description:')) {
          const [text, color] = parseText(rest.slice(rest.indexOf('description:')));
          this.send({ type: 'label', sid, fields: { suffix: text, suffixColor: color ?? 'gray' } });
        }
        return 'Modified entity data';
      }
      case 'item replace entity': {
        const item = / weapon\.mainhand with (\S+)/.exec(rest)?.[1];
        if (!item) return null; // helmets etc. work on players as they are
        this.send({ type: 'hand', sid, item });
        return 'Replaced a slot';
      }
      case 'tp': {
        const c = rest.trim().split(/\s+/).map(Number);
        if (c.length >= 3 && c.slice(0, 3).every(Number.isFinite)) this.send({ type: 'goto', sid, x: c[0], y: c[1], z: c[2] });
        return 'Teleported';
      }
      case 'kill':
        return 'No entity was found'; // never kill a bot player through the mannequin's selector
    }
    return null;
  }

  info() {
    return {
      runner: this.child ? (this.ready ? 'running' : 'starting') : 'stopped',
      unavailable: this.unavailable,
      pool: poolSize(this.d.config),
      live: this.d.sessions().filter((s) => this.d.rt(s).body === 'bot').map((s) => ({ session: s.name, bot: this.d.rt(s).bot?.name, status: this.d.rt(s).bot?.status })),
      stats: this.stats,
    };
  }
}
