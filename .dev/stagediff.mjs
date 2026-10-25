// What a growth-stage transition removes, grouped by block name and height. Usage: node .dev/stagediff.mjs <type> [seed] [from=1]
import { BUILDINGS } from '../bridge/buildings.mjs';
import { rngFrom } from '../bridge/blueprint.mjs';
const [type, seed = '0', fromArg = '1'] = process.argv.slice(2);
const from = Number(fromArg);
const L = (st) => BUILDINGS[type](rngFrom(`stage${seed}:${type}`), { stage: st }).toBuildList({ turns: 0, size: 21, offset: 2 });
const a = L(from), b = new Map(L(from + 1).map((x) => [`${x.x},${x.y},${x.z}`, x.block]));
const g = new Map();
for (const x of a) {
  const nb = b.get(`${x.x},${x.y},${x.z}`);
  if (nb === x.block) continue;
  const k = `${x.block.replace(/^minecraft:/, '').replace(/[[{].*/, '')} y=${x.y} -> ${nb ? nb.replace(/^minecraft:/, '').replace(/[[{].*/, '') : 'air'}`;
  g.set(k, (g.get(k) ?? 0) + 1);
}
const rows = [...g].sort((p, q) => q[1] - p[1]);
console.log(`${type} seed ${seed}: stage ${from} ${a.length} -> ${from + 1} ${b.size}; removed/changed ${rows.reduce((s, r) => s + r[1], 0)}`);
for (const [k, v] of rows.slice(0, 30)) console.log(String(v).padStart(5), k);
