// Validates every block string produced by the building generators against the vanilla
// block-state report (.dev/out/reports/blocks.json, generated from the server jar).
// Usage: node tools/validate-blocks.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILDINGS, square, plaza } from '../bridge/buildings.mjs';
import { rngFrom } from '../bridge/blueprint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = path.join(ROOT, '.dev', 'out', 'reports', 'blocks.json');
if (!fs.existsSync(report)) {
  console.error(`Missing ${report}. Generate it with:\n  java -DbundlerMainClass=net.minecraft.data.Main -jar .dev/mojang.jar --reports --output .dev/out`);
  process.exit(2);
}
const blocks = JSON.parse(fs.readFileSync(report, 'utf8'));

const problems = new Map();
function check(block, where) {
  const m = block.match(/^([^[{]+)(?:\[([^\]]*)\])?(\{.*\})?$/);
  if (!m) return problems.set(block, `unparseable (${where})`);
  const def = blocks[m[1]];
  if (!def) return problems.set(block, `unknown block ${m[1]} (${where})`);
  if (!m[2]) return;
  for (const kv of m[2].split(',')) {
    const [k, v] = kv.split('=');
    const allowed = def.properties?.[k];
    if (!allowed) problems.set(block, `${m[1]} has no property "${k}" (${where})`);
    else if (!allowed.includes(v)) problems.set(block, `${m[1]}.${k}=${v} not in [${allowed}] (${where})`);
  }
}

let total = 0;
const generators = { ...BUILDINGS, square: (rng) => square(rng) };
if (typeof plaza === 'function') generators.plaza = (rng) => plaza(rng);
for (const [type, gen] of Object.entries(generators)) {
  for (let s = 0; s < 25; s++) {
    for (let turns = 0; turns < 4; turns++) {
      const list = gen(rngFrom(`validate:${type}:${s}`)).toBuildList({ turns, size: 21, offset: 2 });
      for (const b of list) {
        total++;
        check(b.block, `${type} seed ${s} turns ${turns}`);
        if (b.x < 0 || b.z < 0 || b.x > 20 || b.z > 20) problems.set(`${type}@${b.x},${b.z}`, `outside plot (${type} seed ${s})`);
      }
    }
  }
}
if (problems.size) {
  for (const [block, why] of problems) console.log(`✗ ${block}\n    ${why}`);
  console.log(`\n${problems.size} problem(s) in ${total} placements`);
  process.exit(1);
}
console.log(`✓ all ${total} placements valid (${Object.keys(generators).length} generators × 25 seeds × 4 rotations)`);
