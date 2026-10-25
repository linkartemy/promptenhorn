// Effects queue: every cosmetic command (sounds, particles, display entities, status text…) goes through
// here instead of straight to RCON. The bridge has one serialized RCON connection, so an effect costs
// the same as a setblock; a per-tick budget keeps effects from ever starving the build loop, and keys
// de-duplicate bursts (ten status changes in one second become one `data merge`).

export class Effects {
  constructor(cmd, log) {
    this.cmd = cmd;
    this.log = log;
    this.items = new Map(); // key -> { run, cost, at }
    this.seq = 0;
    this.dropped = 0;
  }

  /**
   * Queues an effect. `run` is a command string, a list of commands, or async (cmd) => {}.
   * The same key replaces a pending effect (keeping its place in line), so pass a stable key for
   * "latest state wins" updates and omit it for one-off effects.
   */
  push(run, { key, cost, delay = 0 } = {}) {
    const k = key ?? `#${this.seq++}`;
    const list = typeof run === 'string' ? [run] : Array.isArray(run) ? run : null;
    const item = {
      run: list ? async (cmd) => { for (const c of list) await cmd(c); } : run,
      cost: cost ?? (list ? list.length : 1),
      at: Date.now() + delay,
    };
    // A runaway feature must not grow the queue forever: drop the oldest one-off effects.
    if (this.items.size > 2000 && !this.items.has(k)) {
      for (const old of this.items.keys()) {
        if (old.startsWith('#')) {
          this.items.delete(old);
          this.dropped++;
          break;
        }
      }
    }
    this.items.set(k, item);
    return k;
  }

  /** Queues an effect after `ms` milliseconds. */
  later(ms, run, opts = {}) {
    return this.push(run, { ...opts, delay: ms });
  }

  cancel(key) {
    this.items.delete(key);
  }

  /** Cancels every pending effect whose key starts with `prefix`. */
  cancelPrefix(prefix) {
    for (const k of [...this.items.keys()]) if (k.startsWith(prefix)) this.items.delete(k);
  }

  has(key) {
    return this.items.has(key);
  }

  /** Runs due effects in queue order until `budget` commands are spent. */
  async drain(budget) {
    const now = Date.now();
    let spent = 0;
    for (const [k, item] of [...this.items]) {
      if (spent >= budget) break;
      if (item.at > now) continue;
      if (this.items.get(k) !== item) continue; // replaced or cancelled meanwhile
      this.items.delete(k);
      spent += item.cost;
      try {
        await item.run(this.cmd);
      } catch (err) {
        if (err?.name === 'RconDisconnected') throw err;
        this.log(`effect ${k}: ${err.message}`);
      }
    }
    return spent;
  }

  /** Forgets everything (after a reconnect the world state the effects assumed may be gone). */
  clear() {
    this.items.clear();
  }
}

// Temporary display entities and mobs get these tags. A sweep kills fx entities older than ~2 minutes
// by their time-bucket tag, which also catches ones left in a chunk that unloaded before their kill ran.
const BUCKET_MS = 60000;
export const fxBucket = (now = Date.now()) => Math.floor(now / BUCKET_MS) % 100000;
export const fxTags = (...extra) => ['alps', 'alps_fx', `alps_fx_t${fxBucket()}`, ...extra];
export const fxTagsSnbt = (...extra) => `Tags:[${fxTags(...extra).map((t) => `"${t}"`).join(',')}]`;
export const sweepCommand = () => {
  const b = fxBucket();
  return `kill @e[tag=alps_fx,tag=!alps_fx_t${b},tag=!alps_fx_t${b - 1},tag=!alps_fx_t${b - 2}]`;
};
