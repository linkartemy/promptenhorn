// Builders engine "offline": the town keeps growing while the Minecraft server is not running.
//
// While RCON is unreachable the bridge still takes hook events (the heartbeat stays fresh). With
// builderMode "offline" each session then earns a *backlog* instead of placing blocks: blocksPerSecond
// while the chat works plus every tool burst, persisted in state.json (`session.backlog`) and capped at
// `offlineMaxBacklog` blocks per session. Actions, economy thresholds and queued renovations are counted
// as usual (they live in the state anyway). The web map shows the virtual progress (placed + backlog).
//
// When the server is back, the work loop pays the backlog off with the fast-mode builder, in list order,
// before (and on top of) normal work: plots that could not be created offline (terrain needs the server)
// are created as their turn comes, finished houses get their fireworks, villagers, next stage…
//   offlineCatchUp: "timelapse" (default) — spread over ~offlineTimelapseSeconds, the mannequin moves as usual
//   offlineCatchUp: "instant"             — 400 blocks per tick, no particles or sounds
// A session embodied by a bot (realistic mode) turns its backlog into ordinary credit instead.
//
// Writing blocks straight into the region files while the server is off was considered and left out:
// it would need correct heightmaps, lighting and block-entity data and must never race a running server.

const TICKS_PER_SECOND = 4; // the bridge ticks every 250 ms

export class OfflineEngine {
  /** @param d { config, rt, sessions(), save, log } */
  constructor(d) {
    this.d = d;
    this.lastAt = 0;
    this.wasOffline = false;
  }

  enabled() {
    return this.d.config.builderMode === 'offline';
  }

  cap() {
    return Math.max(0, Number(this.d.config.offlineMaxBacklog ?? 20000) || 0);
  }

  /** Called on every bridge tick while the server is unreachable. No RCON here. */
  accrue(now = Date.now()) {
    const dt = this.lastAt ? Math.min((now - this.lastAt) / 1000, 2) : 0;
    this.lastAt = now;
    if (!this.enabled()) return;
    const { config } = this.d;
    if (!this.wasOffline) {
      this.wasOffline = true;
      this.d.log('Server unreachable: offline engine collects the work as a backlog');
    }
    let changed = false;
    for (const s of this.d.sessions()) {
      const silentMin = (now - s.lastEvent) / 60000;
      if (s.active && silentMin > config.idleAfterMinutes) s.active = false;
      let add = s.active ? config.blocksPerSecond * dt : 0;
      // Tool bursts land in s.credit (onEvent); offline they become backlog too.
      if ((Number(s.credit) || 0) > 0) {
        add += Number(s.credit);
        s.credit = 0;
      }
      if (add > 0) {
        s.backlog = Math.min(this.cap(), (Number(s.backlog) || 0) + add);
        changed = true;
      }
    }
    if (changed) this.d.save();
  }

  /** The server is reachable again. */
  online() {
    this.lastAt = 0;
    if (this.wasOffline) {
      this.wasOffline = false;
      const owed = this.d.sessions().reduce((n, s) => n + Math.floor(Number(s.backlog) || 0), 0);
      if (owed) this.d.log(`Server back: catching up ${owed} blocks (${this.d.config.offlineCatchUp === 'instant' ? 'instant' : 'timelapse'})`);
    }
  }

  owes(session) {
    return (Number(session.backlog) || 0) >= 1;
  }

  /**
   * Places up to this tick's share of the backlog. `build(n, commit, opts)` is the fast-mode builder;
   * `commit` books an index and takes it from the backlog instead of the credit.
   */
  async catchUp(session, dt, build, commit) {
    const r = this.d.rt(session);
    if (r.body === 'bot') {
      // A live bot works the backlog off as ordinary credit, at its own pace.
      const take = Math.max(0, Math.min(session.backlog, 200 - (Number(session.credit) || 0)));
      session.credit = (Number(session.credit) || 0) + take;
      session.backlog -= take;
      if (session.backlog < 1) session.backlog = 0;
      return;
    }
    const instant = this.d.config.offlineCatchUp === 'instant';
    if (!r.catchUp) r.catchUp = { rate: Math.max(5, session.backlog / Math.max(10, Number(this.d.config.offlineTimelapseSeconds ?? 120))), credit: 0 };
    let n;
    if (instant) n = 400;
    else {
      r.catchUp.credit += r.catchUp.rate * dt;
      n = Math.floor(r.catchUp.credit);
      r.catchUp.credit -= n;
      n = Math.min(n, Math.ceil(r.catchUp.rate / TICKS_PER_SECOND) * 4);
    }
    n = Math.min(n, Math.floor(session.backlog));
    if (n > 0) await build(n, commit, { quiet: instant });
    if (session.backlog < 1) {
      session.backlog = 0;
      r.catchUp = null;
    }
  }

  info() {
    const sessions = this.d.sessions().filter((s) => this.owes(s));
    return { enabled: this.enabled(), catchUp: this.d.config.offlineCatchUp ?? 'timelapse', owed: sessions.reduce((n, s) => n + Math.floor(s.backlog), 0), sessions: sessions.length };
  }
}
