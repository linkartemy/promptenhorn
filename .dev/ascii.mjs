// ASCII floor slices for debugging walkcheck: node .dev/ascii.mjs <type> <seed> <turns> <y> [y2...]
import { BUILDINGS } from '../bridge/buildings.mjs';
import { rngFrom, blockName, blockProps } from '../bridge/blueprint.mjs';
import { analyse } from '../tools/walkcheck.mjs';

const [type, seed, turns, ...ys] = process.argv.slice(2);
const list = BUILDINGS[type](rngFrom(`${seed}:${type}`)).toBuildList({ turns: Number(turns), size: 21, offset: 2 });
const map = new Map(list.map((b) => [`${b.x},${b.y},${b.z}`, b.block]));
const res = analyse(list, { turns: Number(turns) });
const unreach = new Set(res.levels.flatMap((l) => l.unreachable.map(([x, z]) => `${x},${l.y},${z}`)));
const sym = (b) => {
  if (!b) return '.';
  const n = blockName(b);
  const p = blockProps(b);
  if (/stairs/.test(n)) return { north: '^', south: 'v', east: '>', west: '<' }[p.facing];
  if (/_door/.test(n)) return 'D';
  if (/ladder/.test(n)) return 'H';
  if (/pane|glass/.test(n)) return '=';
  if (/_bed/.test(n)) return 'B';
  if (/fence/.test(n)) return 'f';
  if (/carpet|pressure/.test(n)) return '_';
  if (/lantern/.test(n)) return '*';
  if (/trapdoor/.test(n)) return 't';
  if (/slab/.test(n)) return p.type === 'bottom' ? 's' : 'S';
  if (/chest|barrel|cauldron|smoker|furnace|crafting|bookshelf|terracotta/.test(n)) return 'o';
  return '#';
};
for (const y of ys.map(Number)) {
  console.log(`--- y=${y} (feet level; lowercase u = interior unreachable)   rows=z, cols=x`);
  for (let z = 0; z < 21; z++) {
    let row = '';
    for (let x = 0; x < 21; x++) {
      const b = map.get(`${x},${y},${z}`);
      let c = sym(b);
      if (c === '.' && unreach.has(`${x},${y},${z}`)) c = 'u';
      if (c === '.' && !map.get(`${x},${y - 1},${z}`) && y > 1) c = ' ';
      row += c;
    }
    console.log(String(z).padStart(2) + ' ' + row);
  }
}
