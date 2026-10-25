// Connection + walking helpers for colonists (adapted from bots/common.mjs, which is owned by the bots agent).
import './physics-patch.mjs'; // must run before mineflayer is loaded
import mineflayer from 'mineflayer';

const FORBIDDEN_PORTS = new Set([25565, 25566]);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Creates a survival bot and resolves once it has spawned. */
export function makeBot({ host, port, username, viewDistance = 4 }) {
  if (FORBIDDEN_PORTS.has(port)) throw new Error(`Refusing to connect to ${port}: city / test server`);
  return new Promise((resolve, reject) => {
    const bot = mineflayer.createBot({ host, port, username, auth: 'offline', version: '1.21.11', viewDistance, checkTimeoutInterval: 60000 });
    const t = setTimeout(() => {
      bot.end?.();
      reject(new Error(`${username}: spawn timeout`));
    }, 60000);
    bot.once('spawn', () => {
      clearTimeout(t);
      resolve(bot);
    });
    bot.once('kicked', (r) => {
      clearTimeout(t);
      reject(new Error(`${username} kicked: ${typeof r === 'string' ? r : JSON.stringify(r)}`));
    });
    bot.once('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

export class Interrupted extends Error {
  constructor(why = 'interrupted') {
    super(why);
    this.interrupted = true;
  }
}

/**
 * pathfinder.goto with the stuck work-around from the spike: a burst of server position resets means the
 * client and server disagree about where the bot is; release the controls, hop and plan again.
 * `shouldStop()` is polled so a combat reflex can abort a walk.
 */
export async function walkTo(bot, goal, { timeout = 30000, retries = 4, shouldStop = () => false, onStuck = null } = {}) {
  const deadline = Date.now() + timeout;
  let forced = [];
  const onForced = () => forced.push(Date.now());
  bot.on('forcedMove', onForced);
  try {
    let lastError = '';
    let unstuckOnce = false;
    for (let attempt = 0; attempt <= retries; attempt++) {
      forced = [];
      let timer;
      const watch = new Promise((_, rej) => {
        timer = setInterval(() => {
          const now = Date.now();
          forced = forced.filter((t) => now - t < 600);
          if (shouldStop()) rej(new Interrupted('walk interrupted'));
          else if (forced.length >= 4) rej(Object.assign(new Error('server-stuck'), { stuck: true }));
          else if (now > deadline) rej(new Error('timeout'));
        }, 100);
      });
      try {
        await Promise.race([bot.pathfinder.goto(goal), watch]);
        return { ok: true, attempts: attempt + 1 };
      } catch (e) {
        bot.pathfinder.setGoal(null);
        bot.clearControlStates();
        if (e.interrupted) throw e;
        const retryable = e.stuck || /stopped|stuck|Timeout|took to long|No path/i.test(e.message);
        if (!retryable || Date.now() > deadline) return { ok: false, error: e.message, attempts: attempt + 1 };
        if (/No path/i.test(e.message) && attempt >= 1) return { ok: false, error: e.message, attempts: attempt + 1 };
        await bot.waitForTicks(8).catch(() => {});
        // the server keeps resetting us (seen when the bot stands flush against a block edge):
        // let the caller re-centre the bot in its cell (RCON tp), which clears the disagreement
        if (e.stuck && onStuck && !unstuckOnce) {
          unstuckOnce = true;
          await onStuck().catch(() => {});
        } else if (e.stuck && unstuckOnce) return { ok: false, error: 'server-stuck', stuck: true, attempts: attempt + 1 };
        bot.setControlState('jump', true);
        await bot.waitForTicks(4).catch(() => {});
        bot.setControlState('jump', false);
        bot.walkStuckCount = (bot.walkStuckCount ?? 0) + 1;
        lastError = e.message;
      } finally {
        clearInterval(timer);
      }
    }
    return { ok: false, error: `retries: ${lastError}`, attempts: retries + 1 };
  } finally {
    bot.off('forcedMove', onForced);
  }
}
