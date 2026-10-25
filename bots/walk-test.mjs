// Debug helper: walk a bot to a point and log pathfinder status.
import { createRequire } from 'node:module';
import { makeBot, rcon, log, sleep } from './common.mjs';
const require = createRequire(import.meta.url);
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const [dx = -0, dz = 60] = process.argv.slice(2).map(Number);
const r = await rcon();
const bot = await makeBot('Walker');
bot.loadPlugin(pathfinder);
await r.command('gamemode creative Walker');
await sleep(1000);
const s = bot.entity.position.clone();
const m = new Movements(bot); m.canDig = false; m.scafoldingBlocks = [bot.registry.itemsByName.dirt.id];
bot.pathfinder.setMovements(m);
bot.on('path_update', (rr) => log('path_update', rr.status, rr.path.length, 'visited', rr.visitedNodes, rr.time?.toFixed?.(0)));
bot.on('goal_reached', () => log('goal reached'));
bot.on('path_reset', (why) => log('reset', why, bot.entity.position.toString(), bot.entity.onGround));
const t0 = Date.now();
const goal = process.env.GY ? new goals.GoalNear(s.x + dx, Number(process.env.GY), s.z + dz, 2) : new goals.GoalNearXZ(s.x + dx, s.z + dz, 2); if (process.env.TP) { await r.command('tp Walker -115.5 64 -326.5'); await sleep(1500); }
try { await Promise.race([bot.pathfinder.goto(goal), sleep(90000).then(() => { throw new Error('90s'); })]); } catch (e) { log('err', e.message); }
log('done in', (Date.now() - t0) / 1000, 's, at', bot.entity.position.floored(), 'dist', bot.entity.position.distanceTo(s).toFixed(1));
bot.quit(); r.close(); process.exit(0);
