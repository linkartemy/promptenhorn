import { makeBot, rcon, log } from './common.mjs';
const r = await rcon();
log(await r.command('list'));
const bot = await makeBot('Probe');
const p = bot.entity.position.floored();
log('spawn at', p, 'game', bot.game.gameMode, bot.game.dimension, 'version', bot.version);
await bot.waitForChunksToLoad();
// survey surface heights along +x and +z for 80 blocks
for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
  const row = [];
  for (let d = 0; d <= 80; d += 10) {
    const x = p.x + dx * d, z = p.z + dz * d;
    let y = 200, b;
    for (; y > -60; y--) { b = bot.blockAt(bot.entity.position.offset(x - p.x, y - bot.entity.position.y, z - p.z).floored()); if (b && b.name !== 'air' && b.name !== 'cave_air' && b.name !== 'void_air') break; }
    row.push(`${d}:${y}:${b?.name}`);
  }
  log(dx, dz, row.join(' '));
}
bot.quit(); r.close();
