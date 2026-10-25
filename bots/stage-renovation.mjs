// Dev: stages a real renovation on the bots agent's TEST city — rebuilds a finished plot with an older
// archived generator version and records that version in the state, so the bridge's renovation crew
// (and an idle live builder helping it) has actual blocks to change. Stop the test bridge first.
//   node bots/stage-renovation.mjs <plotKey> <oldGenVersion> [--config .dev/test-config-bots.json]
import fs from 'node:fs';
import path from 'node:path';
import { Rcon } from '../bridge/rcon.mjs';
import { Generators, stagedList } from '../bridge/generators.mjs';

const args = process.argv.slice(2);
const cfgPath = args.includes('--config') ? args[args.indexOf('--config') + 1] : '.dev/test-config-bots.json';
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
if (!/test-server/.test(cfg.serverDir) || cfg.port === 7777) throw new Error('test bridges only');
const [key, oldGen] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--config');
const state = JSON.parse(fs.readFileSync(cfg.stateFile, 'utf8'));
const plot = state.plots[key];
if (!plot?.done) throw new Error(`plot ${key} is not a finished plot`);
const props = fs.readFileSync(path.join(cfg.serverDir, 'server.properties'), 'utf8');
const gens = new Generators({ sourceDir: path.resolve('bridge'), archiveDir: cfg.archiveDir, log: () => {}, archive: false });
await gens.init();
const mod = await gens.load(oldGen);
if (!mod) throw new Error(`generator ${oldGen} not archived in ${cfg.archiveDir}`);
const list = stagedList(mod, plot, { size: 21 });
let h = 2166136261;
for (const b of list) {
  const s = `${b.x},${b.y},${b.z},${b.block};`;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
}
const hash = (h >>> 0).toString(36) + ':' + list.length;
const rcon = new Rcon({ port: Number(props.match(/rcon\.port=(\d+)/)[1]), password: props.match(/rcon\.password=(.*)/)[1].trim() });
await rcon.connect();
await rcon.command(`forceload add ${plot.x0} ${plot.z0} ${plot.x0 + 20} ${plot.z0 + 20}`);
await new Promise((r) => setTimeout(r, 1500));
await rcon.command(`fill ${plot.x0 + 1} ${plot.y + 1} ${plot.z0 + 1} ${plot.x0 + 19} ${plot.y + 40} ${plot.z0 + 19} air`);
for (const b of list) await rcon.command(`setblock ${plot.x0 + b.x} ${plot.y + b.y} ${plot.z0 + b.z} ${b.block}`);
await rcon.command(`forceload remove ${plot.x0} ${plot.z0} ${plot.x0 + 20} ${plot.z0 + 20}`);
rcon.close();
plot.gen = oldGen;
plot.bp = hash;
plot.total = list.length;
plot.placed = list.length;
fs.writeFileSync(cfg.stateFile, JSON.stringify(state, null, 1));
console.log(`plot ${key}: rebuilt with ${oldGen} (${list.length} blocks), state points at it now`);
process.exit(0);
