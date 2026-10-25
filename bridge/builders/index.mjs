// Builder backends and the router between them. The bridge's session / work loop (bridge.mjs) owns the
// plan — sites, build lists, plot.placed, credit, poses — and talks to "the builder" only through a
// backend:
//
//   ensure(session, site, opts)          make the builder exist at the site
//   toFront(session, site)               stand at the door, facing the house (idle)
//   setPose(session, pose)               standing | sleeping | crouching
//   setHand(session, item)               what it holds
//   leave(session, oldSite)              it moves on to another site
//   remove(session)                      it goes away (house done in classic mode, chat over)
//   build(session, site, built, n, commit)   place up to n blocks from rec.placed on; commit('placed'|'skip') per index
//   sync?(session, site, built, commit)  book asynchronous progress (bots)
//
// Backends: mannequin.mjs (Builders "fast": a mannequin entity + RCON setblock), bot.mjs (Builders
// "realistic": a Mineflayer player that builds by hand). The Colonists (survival colony) are a separate
// product on their own server (wild/, setting `colonists`) and do not use these backends.
//
// Engine "offline" (offline.mjs): with the server down, sessions earn a backlog that is caught up when it
// is back (instant or timelapse); otherwise it builds like fast.
//
// Settings: builderMode fast|realistic|offline, offlineCatchUp, builderBotsMax (bots at most; the rest of the chats keep a
// mannequin), botSpeed calm|normal|fast, feature smoothBuilders (fast mode: gliding mannequins).
import { MannequinBackend } from './mannequin.mjs';
import { BotBackend, poolSize } from './bot.mjs';
import { OfflineEngine } from './offline.mjs';
import { isBotName } from './names.mjs';

export { isBotName };

export const MODES = ['fast', 'realistic', 'offline'];
export const CATCH_UP = ['timelapse', 'instant'];
export const SPEEDS = ['calm', 'normal', 'fast'];

export class Builders {
  /**
   * @param d { root, config, props, log, cmd, rt, save, builderTag, builderUuid, textJson, itemFor, soundFor, setHand,
   *            smooth(), handItem(s, b), onSpawn(s, site), sessions(), session(id), siteOf(key), plazaFront(s), bedSpot(s), sleeping(s) }
   */
  constructor(d) {
    this.d = d;
    this.mannequin = new MannequinBackend(d);
    this.bot = new BotBackend({ ...d, mannequin: this.mannequin });
    this.offline = new OfflineEngine(d);
    this.lastTick = 0;
    this.lastSpeed = d.config.botSpeed;
    // Nobody (yet): while a chat waits a few seconds for the starting runner, nothing builds and nothing is summoned.
    const noop = async () => {};
    this.none = { id: 'none', ensure: noop, setPose: noop, setHand: noop, toFront: noop, leave: noop, remove: noop, build: noop };
    this.lastSmooth = null;
  }

  /** The city's builder mode: only 'realistic' uses bots; 'offline' (and anything else) builds like 'fast'. */
  mode() {
    const m = this.d.config.builderMode;
    return m === 'realistic' ? 'realistic' : 'fast';
  }

  /** The backend currently embodying the session. */
  of(session) {
    const r = this.d.rt(session);
    if (r.body === 'bot') return this.bot;
    if (r.awaitBotUntil > Date.now() && this.bot.starting()) return this.none;
    return this.mannequin;
  }

  /** Before a builder is made at a site: in the realistic mode a free bot takes the job (it walks over from the plaza). */
  async claim(session, site) {
    const r = this.d.rt(session);
    if (this.mode() !== 'realistic' || r.body === 'bot' || session.retired || this.d.sleeping(session)) return;
    if (this.bot.canAcquire(session)) {
      await this.bot.acquire(session, site, { from: r.freshSite === site.key ? 'plaza' : 'here' });
      return 'bot';
    }
    // The runner is still starting (bridge just started): no mannequin flash, the bot comes in a few seconds.
    if (this.bot.starting() && this.bot.count() < poolSize(this.d.config)) {
      r.awaitBotUntil = Date.now() + 30000;
      return 'wait';
    }
  }

  /** Pool upkeep (every couple of seconds): hand bots to waiting chats, park sleepers, follow the mode. */
  async tick(now = Date.now()) {
    if (now - this.lastTick < 2000) return;
    this.lastTick = now;
    const { config, rt } = this.d;
    if (config.botSpeed !== this.lastSpeed) {
      this.lastSpeed = config.botSpeed;
      this.bot.setSpeed(config.botSpeed);
    }
    const smooth = !!this.d.smooth();
    if (smooth !== this.lastSmooth) {
      if (this.lastSmooth && !smooth) await this.mannequin.dropVehicles(this.d.sessions());
      this.lastSmooth = smooth;
    }
    this.bot.tick();
    for (const s of this.d.sessions()) {
      const r = rt(s);
      if (r.awaitBotUntil && r.body !== 'bot' && !(r.awaitBotUntil > now && this.bot.starting())) {
        r.awaitBotUntil = 0;
        s.pose = null; // no bot after all: the build loop puts the mannequin up
      }
    }
    const sessions = this.d.sessions();
    const realistic = this.mode() === 'realistic';
    const pool = poolSize(config);
    let live = 0;
    for (const s of sessions) {
      const r = rt(s);
      if (r.body !== 'bot') continue;
      if (!realistic) this.bot.fallback(s, 'mode');
      else if (this.d.sleeping(s)) {
        if (r.bot?.status !== 'leaving') this.bot.park(s);
      } else if (!s.at) {
        /* between sites: keeps its bot */
      } else live++;
    }
    if (!realistic) return;
    this.bot.ensureRunner(); // started ahead, so a new chat's first builder can already be a bot
    // The pool shrank in the settings: the quietest bots hand back first.
    if (live > pool) {
      const extra = sessions.filter((s) => rt(s).body === 'bot' && rt(s).bot?.status !== 'leaving').sort((a, b) => a.lastEvent - b.lastEvent).slice(0, live - pool);
      for (const s of extra) this.bot.fallback(s, 'pool');
    }
    // Chats with a mannequin (overflow, woken up, mode just switched on) get a bot as soon as one is free.
    const waiting = sessions.filter((s) => rt(s).body !== 'bot' && s.at && !s.retired && !this.d.sleeping(s)).sort((a, b) => b.lastEvent - a.lastEvent);
    for (const s of waiting) {
      if (!this.bot.canAcquire(s)) break;
      const site = this.d.siteOf(s.at);
      if (site) await this.bot.acquire(s, site, { from: rt(s).freshSite === site.key ? 'plaza' : 'here' });
    }
  }

  // ------------------------------------------------------------------ offline engine (offline.mjs)

  /** Bridge tick while the server is unreachable. */
  offlineTick(now) {
    this.offline.accrue(now);
  }

  /** Bridge tick with the server reachable. */
  onlineTick() {
    this.offline.online();
  }

  /** Blocks earned while the server was off are still to be placed. */
  owes(session) {
    return this.offline.owes(session);
  }

  async catchUp(session, site, built, dt, commit) {
    await this.offline.catchUp(session, dt, (n, c, opts) => this.mannequin.build(session, site, built, n, c, opts), commit);
  }

  /** RCON commands features aim at the builder entity, translated for bot players (null = run as is). */
  intercept(command) {
    if (!this.bot.byTag.size || !command.includes('alps_b_')) return null;
    return this.bot.intercept(command);
  }

  /** World set-up after (re)connecting to the server. */
  async setup() {
    if (!this.d.smooth()) await this.d.cmd('kill @e[type=minecraft:item_display,tag=alps_bv]');
    for (const s of this.d.sessions()) this.d.rt(s).mounted = false;
  }

  shutdown() {
    this.bot.stopRunner();
  }

  info() {
    return { mode: this.d.config.builderMode ?? 'fast', smooth: !!this.d.smooth(), speed: this.d.config.botSpeed ?? 'normal', offline: this.offline.info(), ...this.bot.info() };
  }
}
