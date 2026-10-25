// Load test: N creative "builder" bots doing builder-like work (walk short hops, place + dig blocks),
// measuring server MSPT/TPS, loaded chunks, java RSS/CPU, and node CPU/RSS per bot.
//
//   node load-test.mjs --bots 0,1,3,6 [--layout cluster|spread] [--view 8] [--sec 60]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { Vec3 } from 'vec3';
import { makeBot, rcon, sleep, log, walkTo, PORT } from './common.mjs';

const require = createRequire(import.meta.url);
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const Item = require('prismarine-item');

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const COUNTS = String(opt('bots', '0,1,3,6')).split(',').map(Number);
const LAYOUT = opt('layout', 'cluster');
const VIEW = Number(opt('view', 8));
const SEC = Number(opt('sec', 60));

const r = await rcon();
const cmd = (c) => r.command(c);
await cmd('difficulty peaceful');
await cmd('gamerule advance_time false');
await cmd('gamerule send_command_feedback false');

function javaPid() {
  const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
  const line = out.split(/\r?\n/).find((l) => l.includes(`127.0.0.1:${PORT}`) && /LISTENING/.test(l));
  return Number(line.trim().split(/\s+/).at(-1));
}
const PID = javaPid();
function javaStats() {
  const out = execSync(`powershell -NoProfile -Command "$p=Get-Process -Id ${PID}; '{0} {1}' -f $p.WorkingSet64,$p.TotalProcessorTime.TotalSeconds"`, { encoding: 'utf8' }).trim();
  const [ws, cpu] = out.split(/\s+/).map(Number);
  return { rssMB: Math.round(ws / 1e6), cpuSec: cpu };
}
async function mspt() {
  // Paper: "Server tick times (avg/min/max) from last 5s, 10s, 1m:\n◴ 1.2/0.8/4.0, ..."
  const out = (await cmd('mspt')).replace(/§./g, '');
  const num = (x) => Number(x.replace(',', '.'));
  const nums = [...out.matchAll(/(\d+[.,]\d+)\/(\d+[.,]\d+)\/(\d+[.,]\d+)/g)].map((m) => m.slice(1).map(num));
  return { avg5s: nums[0]?.[0], max5s: nums[0]?.[2], avg10s: nums[1]?.[0], avg1m: nums[2]?.[0] };
}
async function tps() {
  const out = (await cmd('tps')).replace(/§./g, '');
  const m = /:\s*\*?(\d+[.,]\d+)/.exec(out);
  return m ? Number(m[1].replace(',', '.')) : null;
}
async function chunks() {
  const out = (await cmd('paper chunkinfo world')).replace(/§./g, '');
  const m = /Total:\s*(\d+).*?Full:\s*(\d+).*?Entity Ticking:\s*(\d+)/is.exec(out);
  return m ? { total: Number(m[1]), full: Number(m[2]), entityTicking: Number(m[3]) } : out.slice(0, 80);
}

const live = [];
let stop = false;
async function work(bot, origin, idx) {
  const m = new Movements(bot);
  m.canDig = false;
  bot.pathfinder.setMovements(m);
  const I = Item(bot.registry);
  await bot.creative.setInventorySlot(36, new I(bot.registry.itemsByName.oak_planks.id, 64));
  bot.setQuickBarSlot(0);
  let placed = 0;
  const mine = [];
  while (!stop) {
    // hop somewhere within 8 blocks of the bot's own site
    const tx = origin.x + Math.round((Math.random() - 0.5) * 16);
    const tz = origin.z + Math.round((Math.random() - 0.5) * 16);
    await walkTo(bot, new goals.GoalNearXZ(tx, tz, 1), { timeout: 6000, retries: 1 });
    // place a few blocks around, like a builder does (~3 blocks/s, same as the bridge default)
    for (let k = 0; k < 6 && !stop; k++) {
      const p = bot.entity.position.floored();
      const ref = bot.blockAt(p.offset(1 + (k % 2), -1, (k % 3) - 1));
      const above = ref && bot.blockAt(ref.position.offset(0, 1, 0));
      if (ref && ref.boundingBox === 'block' && above?.name === 'air') {
        try {
          await bot.lookAt(above.position.offset(0.5, 0.5, 0.5), true);
          await bot._placeBlockWithOptions(ref, new Vec3(0, 1, 0), { swingArm: 'right', forceLook: 'ignore' });
          mine.push(above.position.clone());
          placed++;
        } catch {}
      }
      await sleep(330);
    }
    // tidy up so the site does not fill up
    while (mine.length > 12) {
      const q = mine.shift();
      const b = bot.blockAt(q);
      if (b?.name === 'oak_planks' && bot.entity.position.distanceTo(q) < 5) await bot.dig(b, 'ignore').catch(() => {});
      else await cmd(`setblock ${q.x} ${q.y} ${q.z} air`);
    }
  }
  return placed;
}

async function spawnBots(n) {
  while (live.length < n) {
    const i = live.length;
    const name = `Load${i}`;
    const bot = await makeBot(name, { viewDistance: VIEW });
    bot.loadPlugin(pathfinder);
    await cmd(`gamemode creative ${name}`);
    const sp = bot.spawnPoint;
    const origin = LAYOUT === 'spread' ? new Vec3(sp.x + 160 * (i % 3) - 160, sp.y, sp.z + 160 * Math.floor(i / 3) + 160) : new Vec3(sp.x + (i % 3) * 6 - 6, sp.y, sp.z + Math.floor(i / 3) * 6 + 30);
    // a flat little site for each bot
    const gy = sp.y - 1;
    await cmd(`forceload add ${origin.x} ${origin.z}`);
    await sleep(300);
    await cmd(`fill ${origin.x - 9} ${gy} ${origin.z - 9} ${origin.x + 9} ${gy} ${origin.z + 9} grass_block`);
    await cmd(`fill ${origin.x - 9} ${gy + 1} ${origin.z - 9} ${origin.x + 9} ${gy + 12} ${origin.z + 9} air`);
    await cmd(`forceload remove ${origin.x} ${origin.z}`);
    await cmd(`tp ${name} ${origin.x + 0.5} ${gy + 1} ${origin.z + 0.5}`);
    await sleep(1500);
    live.push({ bot, done: work(bot, origin, i) });
  }
}

const rows = [];
for (const n of COUNTS) {
  await spawnBots(n);
  log(`--- ${n} bots (${LAYOUT}, view ${VIEW}) warming up`);
  await sleep(10000);
  const j0 = javaStats();
  const c0 = process.cpuUsage();
  const t0 = Date.now();
  const samples = [];
  while (Date.now() - t0 < SEC * 1000) {
    await sleep(5000);
    samples.push(await mspt());
  }
  const wall = (Date.now() - t0) / 1000;
  const j1 = javaStats();
  const c1 = process.cpuUsage(c0);
  const avg = (k) => +(samples.reduce((s, x) => s + (x[k] ?? 0), 0) / samples.length).toFixed(2);
  const row = {
    bots: n, layout: LAYOUT, view: VIEW,
    msptAvg: avg('avg5s'), msptMax: Math.max(...samples.map((s) => s.max5s ?? 0)), tps: await tps(), chunks: await chunks(),
    javaRssMB: j1.rssMB, javaCpuPct: +((100 * (j1.cpuSec - j0.cpuSec)) / wall).toFixed(1),
    nodeCpuPct: +((100 * (c1.user + c1.system)) / 1e6 / wall).toFixed(1), nodeRssMB: Math.round(process.memoryUsage().rss / 1e6),
  };
  rows.push(row);
  log(JSON.stringify(row));
}
stop = true;
await sleep(3000);
console.log('RESULT ' + JSON.stringify(rows));
for (const { bot } of live) bot.quit();
r.close();
process.exit(0);
