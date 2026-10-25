import { BUILDINGS } from '../bridge/buildings.mjs';
import { rngFrom } from '../bridge/blueprint.mjs';
import { analyse } from '../tools/walkcheck.mjs';
const [type, seed, turns, ...cells] = process.argv.slice(2);
const list = BUILDINGS[type](rngFrom(`${seed}:${type}`)).toBuildList({ turns: Number(turns), size: 21, offset: 2 });
const res = analyse(list, { turns: Number(turns), debug: true });
for (const c of cells) console.log(c, res.reachSet.has(c));
