import { BUILDINGS, square, plaza, CATALOG, LABELS } from '../bridge/buildings.mjs';
import { rngFrom } from '../bridge/blueprint.mjs';
const gens = { ...BUILDINGS, square, plaza };
for (const [t, g] of Object.entries(gens)) {
  const ns = [];
  let maxY = 0;
  for (let s = 0; s < 40; s++) {
    const bp = t === 'square' || t === 'plaza' ? g(rngFrom(`st${s}`)) : g(rngFrom(`st${s}:${t}`));
    const l = bp.toBuildList({ size: 21, offset: 2 });
    ns.push(l.length);
    maxY = Math.max(maxY, ...l.map((b) => b.y));
  }
  console.log(t.padEnd(11), 'blocks', Math.min(...ns), '-', Math.max(...ns), ' maxY', maxY, ' ', JSON.stringify(CATALOG[t] ?? LABELS[t]));
}
