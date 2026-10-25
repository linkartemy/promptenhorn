// Dev check for the client physics patch (physics-patch.mjs): a bot walks a course of 1-block dips on
// the TEST server and counts how often the server resets its position (forcedMove).
//   node physics-test.mjs [--nopatch] [--runs 3] [--x 41500 --z 0]
// Talks only to the test server (.dev/test-server, game port 25566); refuses anything else.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { fixPhysics } from './physics-patch.mjs';
import { Rcon } from '../bridge/rcon.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const props = Object.fromEntries(fs.readFileSync(path.join(here, '..', '.dev', 'test-server', 'server.properties'), 'utf8').split(/\r?\n/).filter((l) => /^[^#].*=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
if (props['server-port'] !== '25566') throw new Error('not the test server');
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const patched = args.includes('--nopatch') ? 'off' : 'half-width';
const require = createRequire(import.meta.url);
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const X = Number(opt('x', 41500));
const Z = Number(opt('z', 0));
const Y = 120;
const rcon = new Rcon({ port: Number(props['rcon.port']), password: props['rcon.password'] });
await rcon.connect();
const cmd = (c) => rcon.command(c);
await cmd(`forceload add ${X - 4} ${Z - 4} ${X + 44} ${Z + 8}`);
await sleep(1500);
await cmd(`fill ${X - 2} ${Y} ${Z - 2} ${X + 42} ${Y + 4} ${Z + 6} air`);
await cmd(`fill ${X - 2} ${Y - 1} ${Z - 2} ${X + 42} ${Y - 1} ${Z + 6} stone`);
await cmd(`fill ${X - 2} ${Y - 2} ${Z - 2} ${X + 42} ${Y - 2} ${Z + 6} stone`);
for (let x = X + 3; x < X + 40; x += 4) await cmd(`fill ${x} ${Y - 1} ${Z - 2} ${x} ${Y - 1} ${Z + 6} air`); // 1-deep dips across the path

const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566, username: 'Polier_Test', auth: 'offline', version: '1.21.11', viewDistance: 3, hideErrors: true });
await new Promise((res, rej) => {
  bot.once('spawn', res);
  bot.once('kicked', rej);
  bot.once('error', rej);
});
bot.loadPlugin(pathfinder);
if (patched !== 'off') fixPhysics(bot);
const m = new Movements(bot);
m.canDig = false;
m.allowParkour = true;
m.allowSprinting = true;
bot.pathfinder.setMovements(m);
await cmd('gamemode creative Polier_Test');
let forced = 0;
bot.on('forcedMove', () => forced++);
const samples = [];
bot._client.prependListener('position', (p) => {
  const c = bot.entity.position;
  if (samples.length < 25) samples.push(`cl ${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)} g=${bot.entity.onGround} v=${bot.entity.velocity.y.toFixed(2)} -> sv ${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)} flags=${JSON.stringify(p.flags)}`);
});
const results = [];
for (let run = 0; run < Number(opt('runs', 3)); run++) {
  await cmd(`tp Polier_Test ${X + 0.5} ${Y} ${Z + 2.5}`);
  await sleep(1500);
  await bot.waitForChunksToLoad();
  forced = 0;
  const t0 = Date.now();
  let ok = true;
  try {
    await Promise.race([bot.pathfinder.goto(new goals.GoalBlock(X + 40, Y, Z + 2)), sleep(40000).then(() => Promise.reject(new Error('timeout')))]);
  } catch (e) {
    ok = false;
  }
  bot.pathfinder.setGoal(null);
  results.push({ run, ok, sec: (Date.now() - t0) / 1000, forced, end: bot.entity.position.floored().toString() });
}
console.log(JSON.stringify({ patch: patched, halfWidth: bot.physics.playerHalfWidth, results }));
if (args.includes('--debug')) console.log(samples.join('\n'));
bot.quit();
await cmd(`fill ${X - 2} ${Y - 2} ${Z - 2} ${X + 42} ${Y + 4} ${Z + 6} air`);
await cmd(`forceload remove ${X - 4} ${Z - 4} ${X + 44} ${Z + 8}`);
rcon.close();
setTimeout(() => process.exit(0), 500);
