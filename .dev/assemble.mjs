// Concatenates .dev/parts/*.mjs into bridge/buildings.mjs (dev workflow only).
import fs from 'node:fs';
const dir = new URL('./parts/', import.meta.url);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort();
const src = files.map((f) => fs.readFileSync(new URL(f, dir), 'utf8').replace(/\s+$/, '') + '\n').join('');
fs.writeFileSync(new URL('../bridge/buildings.mjs', import.meta.url), src);
console.log(`assembled ${files.join(', ')}`);
