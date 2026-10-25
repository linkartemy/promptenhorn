// Growth-stage report for the generators: blocks per stage, and what each stage transition removes / keeps / adds
// (the same position diff the bridge's renovation uses). Usage: node .dev/stages.mjs [type,...|all] [seeds=8]
import { BUILDINGS, STAGES } from '../bridge/buildings.mjs';
import { rngFrom } from '../bridge/blueprint.mjs';

const [typesArg, seedsArg = '8'] = process.argv.slice(2);
const types = !typesArg || typesArg === 'all' ? Object.keys(STAGES) : typesArg.split(',');
const seeds = Number(seedsArg);
const list = (type, s, stage) => BUILDINGS[type](rngFrom(`stage${s}:${type}`), { stage }).toBuildList({ turns: 0, size: 21, offset: 2 });
const key = (b) => `${b.x},${b.y},${b.z}`;
console.log('type        stages  blocks/stage (avg)        1->2 removed  kept%   added     2->3 removed  kept%  added');
for (const type of types) {
  const n = STAGES[type] ?? 1;
  const sizes = Array(n).fill(0);
  const tr = Array.from({ length: n - 1 }, () => ({ removed: 0, kept: 0, added: 0, base: 0, maxRemoved: 0 }));
  for (let s = 0; s < seeds; s++) {
    const lists = [...Array(n)].map((_, i) => list(type, s, i + 1));
    lists.forEach((l, i) => (sizes[i] += l.length));
    for (let i = 0; i + 1 < n; i++) {
      const a = new Map(lists[i].map((b) => [key(b), b.block]));
      const b = new Map(lists[i + 1].map((b) => [key(b), b.block]));
      let removed = 0, kept = 0, added = 0;
      for (const [k, v] of a) if (b.get(k) === v) kept++; else removed++;
      for (const [k, v] of b) if (a.get(k) !== v) added++;
      Object.assign(tr[i], { removed: tr[i].removed + removed, kept: tr[i].kept + kept, added: tr[i].added + added, base: tr[i].base + a.size, maxRemoved: Math.max(tr[i].maxRemoved, removed) });
    }
  }
  const avg = (v) => Math.round(v / seeds);
  const t = tr.map((x) => `${String(avg(x.removed)).padStart(6)} (max ${String(x.maxRemoved).padStart(3)}) ${((100 * x.kept) / x.base).toFixed(1).padStart(5)}% ${String(avg(x.added)).padStart(6)}`);
  console.log(`${type.padEnd(11)} ${String(n).padStart(6)}  ${sizes.map(avg).join(' / ').padEnd(24)} ${t.join('    ')}`);
}
