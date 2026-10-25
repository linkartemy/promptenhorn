// Development: what colonists carry and what the colony chests hold (wild server RCON only).
//   WILD_CONFIG=.dev/wild-config.json node .dev/wild-inv.mjs Heidi Ueli ...
import { Rcon } from '../bridge/rcon.mjs';
import { loadConfig } from '../wild/config.mjs';
import fs from 'node:fs';
const cfg = loadConfig();
const st = JSON.parse(fs.readFileSync(cfg.stateFile, 'utf8'));
const r = new Rcon({ host: '127.0.0.1', port: cfg.rconPort, password: cfg.rconPassword });
await r.connect();
function parseItems(out) {
  return [...out.matchAll(/\{Slot: (\d+)b, id: "minecraft:([a-z0-9_]+)"(?:, count: (\d+))?/g)].map((m) => ({ slot: Number(m[1]), id: m[2], count: Number(m[3] ?? 1) }));
}
async function list(target, pathName) {
  const items = [];
  for (let i = 0; i < 60; i++) {
    const out = await r.command(`data get ${target} ${pathName}[${i}]`);
    const it = parseItems(`[${out.slice(out.indexOf('{'))}]`)[0];
    if (!it || !/following/.test(out)) break;
    items.push(it);
  }
  return items;
}
let tot = 0;
for (const n of process.argv.slice(2)) {
  const inv = await list(`entity ${n}`, 'Inventory');
  const eq = await r.command(`data get entity ${n} equipment`);
  const e = (eq.match(/id: "/g) ?? []).length;
  tot += inv.length + e;
  console.log(`${n}: ${inv.length} stacks (${inv.reduce((a, b) => a + b.count, 0)} items), worn ${e}`);
}
if (process.argv.length > 2) console.log('carried stacks total', tot);
for (const [cat, p] of Object.entries(st.colony.storage).concat([['market', st.colony.market]])) {
  const c = await list(`block ${p.x} ${p.y} ${p.z}`, 'Items');
  console.log(`chest ${cat}: ${c.length}/27 slots, ${c.reduce((a, b) => a + b.count, 0)} items`);
}
r.close();
