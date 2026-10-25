// Dev probe: why does Paper keep resetting a Mineflayer bot? Drops the bot at a few spots of a test course
// on the TEST server and logs every server correction. node physics-probe.mjs [--nopatch]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { fixPhysics } from './physics-patch.mjs';
import { Rcon } from '../bridge/rcon.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const props = Object.fromEntries(fs.readFileSync(path.join(here, '..', '.dev', 'test-server', 'server.properties'), 'utf8').split(/\r?\n/).filter((l) => /^[^#].*=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
if (props['server-port'] !== '25566') throw new Error('not the test server');
const patched = process.argv.includes('--nopatch') ? 'off' : 'half-width';
const require = createRequire(import.meta.url);
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const X = 41600;
const Z = 0;
const Y = 120;
const rcon = new Rcon({ port: Number(props['rcon.port']), password: props['rcon.password'] });
await rcon.connect();
const cmd = (c) => rcon.command(c);
await cmd(`forceload add ${X - 4} ${Z - 4} ${X + 20} ${Z + 8}`);
await sleep(1000);
await cmd(`fill ${X - 2} ${Y - 3} ${Z - 2} ${X + 16} ${Y + 4} ${Z + 6} air`);
await cmd(`fill ${X - 2} ${Y - 2} ${Z - 2} ${X + 16} ${Y - 1} ${Z + 6} stone`);
await cmd(`fill ${X + 8} ${Y - 1} ${Z - 2} ${X + 8} ${Y - 1} ${Z + 6} air`); // one dip at x+8

const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566, username: 'Polier_Test', auth: 'offline', version: '1.21.11', viewDistance: 3, hideErrors: true });
await new Promise((res, rej) => {
  bot.once('spawn', res);
  bot.once('kicked', rej);
  bot.once('error', rej);
});
await cmd('gamemode creative Polier_Test');
const hw = process.argv.includes('--hw') ? Number(process.argv[process.argv.indexOf('--hw') + 1]) : null;
if (hw) bot.physics.playerHalfWidth = hw;
else if (patched !== 'off') fixPhysics(bot);
console.log('halfWidth', bot.physics.playerHalfWidth);
let log = [];
bot._client.prependListener('position', (p) => {
  const c = bot.entity.position;
  sent.push(`  CORR server ${p.x},${p.y},${p.z}`);
  log.push(`  corr: client ${c.x.toFixed(2)},${c.y.toFixed(3)},${c.z.toFixed(2)} g=${bot.entity.onGround} vy=${bot.entity.velocity.y.toFixed(3)} -> server ${p.x.toFixed(2)},${p.y.toFixed(3)},${p.z.toFixed(2)} id=${p.teleportId}`);
});
const sent = [];
const origWrite = bot._client.write.bind(bot._client);
bot._client.write = (name, params) => {
  if (/position|teleport_confirm|flying|look/.test(name)) sent.push(`  send ${name} ${params.x},${params.y},${params.z} ${JSON.stringify(params.flags ?? params.teleportId ?? '')}`);
  return origWrite(name, params);
};

async function scenario(label, at, ms, act) {
  await cmd(`tp Polier_Test ${at[0]} ${at[1]} ${at[2]}`);
  await sleep(1200);
  log = [];
  sent.length = 0;
  act?.();
  await sleep(ms);
  console.log('  server', (await cmd('data get entity Polier_Test Pos')).replace(/.*data: /,''), (await cmd('data get entity Polier_Test OnGround')).replace(/.*data: /,''));
  bot.clearControlStates();
  const p = bot.entity.position;
  console.log('  client x exact', p.x, 'maxX', p.x + 0.3);
  console.log(`${label}: end client ${p.x.toFixed(2)},${p.y.toFixed(3)},${p.z.toFixed(2)} corrections=${log.length}`);
  console.log(log.slice(0, 6).join('\n'));
  if (process.argv.includes('--sent')) {
    const k = sent.findIndex((l) => l.includes('CORR'));
    console.log(sent.slice(Math.max(0, k - 8), k + 8).join('\n'));
  }
}

await scenario('drop on floor', [X + 2.5, Y + 2, Z + 2.5], 2000);
await scenario('drop into dip', [X + 8.5, Y + 1, Z + 2.5], 2000);
await scenario('walk +x over dip', [X + 4.5, Y, Z + 2.5], 3000, () => {
  bot.look(-Math.PI / 2, 0, true);
  bot.setControlState('forward', true);
});
await scenario('walk +x, let go over dip', [X + 4.5, Y, Z + 2.5], 3000, () => {
  bot.look(-Math.PI / 2, 0, true);
  bot.setControlState('forward', true);
  const iv = setInterval(() => { if (bot.entity.position.x > X + 8.2) { bot.setControlState('forward', false); clearInterval(iv); } }, 5);
});
await scenario('sprint +x over dip', [X + 4.5, Y, Z + 2.5], 3000, () => {
  bot.look(-Math.PI / 2, 0, true);
  bot.setControlState('forward', true);
  bot.setControlState('sprint', true);
});
console.log('patch', patched);
bot.quit();
await cmd(`fill ${X - 2} ${Y - 3} ${Z - 2} ${X + 16} ${Y + 4} ${Z + 6} air`);
await cmd(`forceload remove ${X - 4} ${Z - 4} ${X + 20} ${Z + 8}`);
rcon.close();
setTimeout(() => process.exit(0), 500);
