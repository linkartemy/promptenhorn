// Bot runner for the realistic builder mode: one Node process holding every live builder (Mineflayer
// bots share minecraft-data and the registry, so an extra bot costs far less than an extra process).
//
// Started by the bridge with child_process.fork() and driven only over the IPC channel: no port is
// opened, nothing outside the bridge can talk to it. It exits when the bridge goes away (the IPC
// channel closes), so a restarted bridge always starts from a clean slate. It has its own RCON
// connection for what a player cannot do (creative set-up, team nametags, NBT blocks).
//
// Messages (bridge -> runner): init, spawn, site, job, limit, mood, hand, label, goto, park, quit, speed
// Messages (runner -> bridge): hello, state, placed, positions, stats, log
import { BotWorker, loadLibs } from './worker.mjs';
import { Rcon } from '../bridge/rcon.mjs';

if (!process.send) {
  console.error('bots/runner.mjs is started by the bridge (builder mode "realistic"), not by hand.');
  process.exit(2);
}

const send = (msg) => {
  try {
    process.send(msg);
  } catch {}
};
const log = (...a) => send({ type: 'log', text: a.map(String).join(' ') });

await loadLibs();

const runner = {
  options: {},
  rcon: null,
  connecting: null,
  send,
  log,
  /** (Re)connects once; concurrent callers share the attempt instead of losing their command. */
  async connect() {
    if (this.rcon?.connected) return true;
    this.connecting ??= (async () => {
      for (let i = 0; i < 5; i++) {
        try {
          this.rcon?.close();
          this.rcon = new Rcon({ host: this.options.host, port: this.options.rconPort, password: this.options.rconPassword });
          await this.rcon.connect();
          return true;
        } catch {
          await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
        }
      }
      return false;
    })().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  },
  async cmd(c) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!(await this.connect())) return '';
      try {
        return await this.rcon.command(c);
      } catch {
        // connection dropped (server restart): reconnect and send once more
      }
    }
    return '';
  },
};

const workers = new Map(); // sid -> BotWorker

function worker(sid) {
  const w = workers.get(sid);
  return w && !w.closed ? w : null;
}

process.on('message', (m) => {
  try {
    handle(m);
  } catch (err) {
    log('message error:', err.stack ?? err.message);
  }
});

function handle(m) {
  switch (m.type) {
    case 'init':
      runner.options = m.options;
      log(`runner ready (pid ${process.pid}, view distance ${m.options.viewDistance})`);
      break;
    case 'speed':
      runner.options.speed = m.speed;
      break;
    case 'spawn': {
      const old = workers.get(m.sid);
      if (old && !old.closed) {
        old.setSite(m.site);
        old.setLabel({ prefix: m.prefix });
        break;
      }
      const w = new BotWorker(runner, m);
      workers.set(m.sid, w);
      w.start();
      break;
    }
    case 'site':
      worker(m.sid)?.setSite(m.site);
      break;
    case 'job':
      worker(m.sid)?.setJob(m.job);
      break;
    case 'limit':
      worker(m.sid)?.setLimit(m.job, m.limit);
      break;
    case 'mood':
      worker(m.sid)?.setMood(m.mood);
      break;
    case 'hand': {
      const w = worker(m.sid);
      if (w) w.hand = m.item;
      break;
    }
    case 'say': {
      const w = worker(m.sid);
      if (w?.ready && m.text) w.bot?.chat(String(m.text).slice(0, 200));
      break;
    }
    case 'label':
      worker(m.sid)?.setLabel(m.fields);
      break;
    case 'goto': {
      const w = worker(m.sid);
      if (w) w.gotoReq = m;
      break;
    }
    case 'park': {
      const w = worker(m.sid);
      if (w) w.parkReq = { to: m.to, why: 'sleep' };
      else send({ type: 'state', sid: m.sid, status: 'parked', pos: null });
      break;
    }
    case 'quit': {
      const w = worker(m.sid);
      if (w) {
        w.quitReq = { why: m.why ?? 'quit' };
        w.abortWalk = true;
        if (!w.ready) {
          try {
            w.bot?.quit(); // still connecting: abort, the worker loop then reports 'gone'
          } catch {}
        }
      } else send({ type: 'state', sid: m.sid, status: 'gone' });
      break;
    }
    case 'shutdown':
      shutdown();
      break;
  }
}

// Positions for the web map, and load figures for the bridge's /status.
setInterval(() => {
  const list = [];
  for (const w of workers.values()) {
    if (w.closed) continue;
    const p = w.ready ? w.pos() : null;
    if (p) list.push([w.sid, ...p]);
  }
  if (list.length) send({ type: 'positions', list });
}, 1000);

let cpu0 = process.cpuUsage();
let t0 = Date.now();
setInterval(() => {
  const cpu = process.cpuUsage(cpu0);
  const ms = Date.now() - t0;
  cpu0 = process.cpuUsage();
  t0 = Date.now();
  for (const [sid, w] of workers) if (w.closed && !w.bot) workers.delete(sid);
  send({
    type: 'stats',
    rssMB: Math.round(process.memoryUsage().rss / 1e6),
    cpuPct: Math.round(((cpu.user + cpu.system) / 1000 / ms) * 1000) / 10,
    bots: [...workers.values()].map((w) => w.info()),
  });
}, 10000);

function shutdown() {
  for (const w of workers.values()) {
    w.closed = true;
    try {
      w.bot?.quit('bridge stopped');
    } catch {}
  }
  setTimeout(() => process.exit(0), 300);
}
// The bridge is gone (closed, crashed, restarted): take every bot off the server with it.
process.on('disconnect', shutdown);
process.on('SIGINT', () => {}); // Ctrl+C in the bridge console reaches us too: the bridge decides
send({ type: 'hello', pid: process.pid });
