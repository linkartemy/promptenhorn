// Life agent: a headless test player on the SHARED TEST server (25566 only) to check join messages,
// chat clicks and triggers. Prints every chat/system message it receives.
// Usage: node .dev/life-player.mjs <seconds> [name] ["/cmd1" "/cmd2" …]  (commands run 6 s after spawn, 2 s apart;
//        "@x,y,z" teleports the player there via chat command, "!activate x y z" right-clicks the block,
//        "!entity <x> <y> <z>" right-clicks the nearest entity to that point)
import { createRequire } from 'node:module';
const require = createRequire(new URL('../bots/package.json', import.meta.url));
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const [secs = 20, name = 'LifeTester', ...cmds] = process.argv.slice(2);
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566, username: name, auth: 'offline', version: '1.21.11' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
bot.on('message', (m, pos) => console.log(`[${pos}]`, m.toString()));
bot.on('kicked', (r) => console.log('kicked', r));
bot.on('error', (e) => console.log('error', e.message));
bot.once('spawn', async () => {
  console.log('spawned at', bot.entity.position.toString());
  await sleep(6000);
  for (const c of cmds) {
    if (c.startsWith('@')) bot.chat(`/tp @s ${c.slice(1).split(',').join(' ')}`);
    else if (c.startsWith('!activate')) {
      const [x, y, z] = c.split(' ').slice(1).map(Number);
      const b = bot.blockAt(new Vec3(x, y, z));
      console.log('activate', b?.name);
      if (b) await bot.activateBlock(b).catch((e) => console.log('activate failed', e.message));
    } else if (c.startsWith('!entity')) {
      const p = new Vec3(...c.split(' ').slice(1).map(Number));
      const e = Object.values(bot.entities).filter((x) => x !== bot.entity).sort((a, b) => a.position.distanceTo(p) - b.position.distanceTo(p))[0];
      console.log('entity', e?.name, e?.position?.toString());
      if (e) bot.activateEntity(e);
    } else bot.chat(c);
    await sleep(2000);
  }
  await sleep(Number(secs) * 1000);
  bot.quit();
  setTimeout(() => process.exit(0), 500);
});
