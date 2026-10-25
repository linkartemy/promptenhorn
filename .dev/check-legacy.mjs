// Checks that the archived legacy generators reproduce the blueprint hash of every plot in a state file.
import fs from 'node:fs';
import path from 'node:path';
import { Generators, stagedList } from '../bridge/generators.mjs';
const state = JSON.parse(fs.readFileSync(process.argv[2] ?? '.dev/live-state-copy.json', 'utf8'));
const gens = new Generators({ sourceDir: path.resolve('bridge'), archiveDir: path.resolve('bridge/archive'), log: console.log, archive: false });
await gens.init();
const hashList = (list) => { let h = 2166136261; for (const b of list) { const s = `${b.x},${b.y},${b.z},${b.block};`; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); } return (h >>> 0).toString(36) + ':' + list.length; };
const mod = await gens.load(gens.legacy);
let ok = 0, bad = 0;
for (const p of Object.values(state.plots)) {
  const h = hashList(stagedList(mod, { ...p, stage: 2 }, { size: 21 }));
  if (h === p.bp) ok++; else { bad++; console.log('mismatch', p.key, p.type, p.bp, h); }
}
console.log(`legacy ${gens.legacy}, current ${gens.current}: ${ok} plots reproduce, ${bad} do not`);
