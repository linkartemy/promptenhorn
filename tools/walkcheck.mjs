// Livability checker for the building generators (docs/building-standards.md, sections 2, 3, 4).
// Simulates a player (2 blocks tall) walking in from the street in front of the plot, on the rotated build list.
// Usage: node tools/walkcheck.mjs [type,type,...|all] [seeds=12] [--verbose] [--json out.json]
import fs from 'node:fs';
import { BUILDINGS } from '../bridge/buildings.mjs';
import { rngFrom, blockName, blockProps, isPaneLike } from '../bridge/blueprint.mjs';

// Per-type expectations. residential: dwelling markers; perFloor: a dwelling on every upper floor;
// public: 2-wide passages and tall ground hall; minLevels: residential floors with >= 36 cells; tower: ladders ok.
export const SPEC = {
  chalet: { residential: true, minLevels: 2 },
  townhouse: { residential: true, minLevels: 2, perFloor: 'upper' },
  cafe: { residential: true, minLevels: 2, public: true },
  church: { public: true, tower: true },
  clocktower: { tower: true, noFootprint: true },
  hotel: { public: true, minLevels: 3 },
  modern: { residential: true, minLevels: 2 },
  apartment: { residential: true, minLevels: 4, perFloor: 'upper' },
  farmhouse: { residential: true, minLevels: 1 },
  hut: { residential: true, minLevels: 1 },
};

// ---------------------------------------------------------------- block classes
const LOW = /carpet$|pressure_plate$|_trapdoor$|^snow$|lily_pad$|daylight_detector$|petals$|wildflowers$|leaf_litter$|candle$|^moss_carpet$/;
const NOCOLLIDE = /^(air|water|short_grass|tall_grass|fern|large_fern|poppy|dandelion|cornflower|oxeye_daisy|azure_bluet|allium|blue_orchid|.*_tulip|lily_of_the_valley|torchflower|rose_bush|lilac|peony|sunflower|bush|firefly_bush|sweet_berry_bush|wheat|carrots|potatoes|beetroots|.*_sapling|.*sign|.*banner|.*torch|.*button|lever|ladder|vine|rail|redstone_wire|tripwire|light)$/;
const STEP = /_stairs$|_bed$/;
const DOORLIKE = /_door$|_fence_gate$/;
const FURNITURE = /moss_block|quartz_slab|trapdoor|barrel|chest|bookshelf|crafting|furnace|smoker|cauldron|lectern|loom|composter|_bed$|_stairs$|fence|_wall$|pane|_bars$|leaves|hay_block|pumpkin|melon|statue|campfire|anvil|cake|potted|flower_pot|decorated_pot|shelf|bell|lantern|_log$|_wood$|wool$|stonecutter|grindstone|cartography|smithing|fletching|jukebox|note_block|beehive|terracotta$/;
const LIGHT = /lantern|sea_lantern|glowstone|campfire|candle|torch|shroomlight|froglight|redstone_lamp\[lit=true|copper_bulb\[lit=true/;
const THIN = /leaves|fence|_wall$|pane|_bars$|banner|lantern|chain|sign|_rod$|carpet|trapdoor|potted|flower_pot|^(poppy|dandelion|.*_tulip|short_grass|fern)$|wool$/;

function classify(block) {
  if (!block) return 'air';
  const n = blockName(block);
  const p = blockProps(block);
  if (DOORLIKE.test(n)) return 'door';
  if (n === 'ladder') return 'ladder';
  if (n === 'water') return 'water';
  if (NOCOLLIDE.test(n)) return 'air';
  if (/_trapdoor$/.test(n)) return p.open === 'true' ? 'air' : p.half === 'top' ? 'solid' : 'low';
  if (LOW.test(n)) return 'low';
  if (/_slab$/.test(n)) return p.type === 'bottom' ? 'step' : 'solid';
  if (STEP.test(n)) return 'step';
  return 'solid';
}

// ---------------------------------------------------------------- one building
export function analyse(list, { turns = 0, size = 21, spec = {} } = {}) {
  const map = new Map(list.map((b) => [`${b.x},${b.y},${b.z}`, b.block]));
  const get = (x, y, z) => map.get(`${x},${y},${z}`) ?? (y <= 0 ? 'minecraft:grass_block' : undefined);
  const cls = (x, y, z) => classify(get(x, y, z));
  const body = (x, y, z) => ['air', 'door', 'ladder', 'water', 'low'].includes(cls(x, y, z));
  const supportBelow = (x, y, z) => {
    const c = cls(x, y - 1, z);
    return c === 'solid' || c === 'step' || c === 'low';
  };
  // A position is (x, y, z) = feet cell. Low blocks (carpets, closed bottom trapdoors) count as part of the floor.
  const standable = (x, y, z) => {
    if (!body(x, y, z) || !body(x, y + 1, z)) return false;
    if (cls(x, y, z) === 'ladder') return true;
    if (cls(x, y, z) === 'low') return true;
    return ['solid', 'step'].includes(cls(x, y - 1, z)) || cls(x, y - 1, z) === 'water';
  };
  const inFrame = (x, z) => x >= 0 && z >= 0 && x < size && z < size;
  const rot = (x, z) => {
    for (let i = 0; i < ((turns % 4) + 4) % 4; i++) [x, z] = [size - 1 - z, x];
    return [x, z];
  };

  // Street in front of the plot (local z = 17..18 before rotation).
  const starts = [];
  for (let lx = -2; lx <= 18; lx++) for (const lz of [17, 18]) {
    const [x, z] = rot(lx + 2, lz + 2);
    for (let y = 1; y <= 3; y++) if (standable(x, y, z)) { starts.push([x, y, z]); break; }
  }

  const bfs = ({ ladders }) => {
    const seen = new Set();
    const q = [];
    for (const s of starts) { const k = s.join(','); if (!seen.has(k)) { seen.add(k); q.push(s); } }
    const push = (x, y, z) => {
      const k = `${x},${y},${z}`;
      if (!seen.has(k)) { seen.add(k); q.push([x, y, z]); }
    };
    while (q.length) {
      const [x, y, z] = q.pop();
      const onLadder = cls(x, y, z) === 'ladder';
      if (ladders && onLadder) {
        if (body(x, y + 1, z) && body(x, y + 2, z)) push(x, y + 1, z);
        if (y > 1 && (cls(x, y - 1, z) === 'ladder' || standable(x, y - 1, z))) push(x, y - 1, z);
      }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (!inFrame(nx, nz)) continue;
        if (cls(nx, y, nz) === 'ladder' && !ladders) continue;
        // Same level or fall.
        if (body(nx, y, nz) && body(nx, y + 1, nz)) {
          let yy = y;
          while (yy > y - 3 && !standable(nx, yy, nz) && body(nx, yy - 1, nz) && cls(nx, yy, nz) !== 'ladder') yy--;
          if (standable(nx, yy, nz)) push(nx, yy, nz);
        }
        // Step up one block via stairs / bottom slabs / beds (no jumping onto full blocks), or off a ladder.
        const below = cls(nx, y, nz);
        if ((below === 'step' || (onLadder && ladders && below === 'solid')) && body(x, y + 2, z) && standable(nx, y + 1, nz)) push(nx, y + 1, nz);
      }
    }
    return seen;
  };
  const reach = bfs({ ladders: true });
  const reachSetExport = reach;
  const reachNoLadder = bfs({ ladders: false });

  // Interior floor cells: standable, covered from above, supported by a floor (not furniture), inside the plot.
  const covered = (x, y, z) => {
    for (let yy = y + 2; yy <= y + 14; yy++) {
      const b = get(x, yy, z);
      if (b && !/leaves|banner|lantern|chain|sign/.test(b)) return true;
    }
    return false;
  };
  const [px1, pz1] = [2, 2];
  const plotCell = (x, z) => {
    // plot is 2..18 in the frame regardless of rotation (square)
    return x >= px1 && z >= pz1 && x <= 18 && z <= 18;
  };
  const clear = (x, y, z) => {
    let h = 0;
    while (h < 9 && body(x, y + h, z) && !(h > 0 && cls(x, y + h, z) === 'low')) h++;
    return h;
  };
  const levels = new Map();
  const ys = [...new Set(list.map((b) => b.y))];
  const maxY = Math.max(...ys) + 2;
  for (let x = 0; x < size; x++)
    for (let z = 0; z < size; z++) {
      if (!plotCell(x, z)) continue;
      for (let y = 1; y <= maxY; y++) {
        if (!standable(x, y, z) || cls(x, y, z) === 'ladder') continue;
        const sup = get(x, y - 1, z);
        const supName = blockName(cls(x, y, z) === 'low' ? get(x, y - 1, z) : sup);
        if (FURNITURE.test(supName) || cls(x, y - 1, z) === 'step' || cls(x, y - 1, z) === 'water') continue;
        // A top slab standing on something is a table or counter, not a floor.
        if (/_slab$/.test(supName) && blockProps(sup).type === 'top' && get(x, y - 2, z) && y > 1) continue;
        if (!covered(x, y, z)) continue;
        if (!levels.has(y)) levels.set(y, []);
        levels.get(y).push([x, z]);
      }
    }
  const res = { levels: [], problems: [], notes: [], reachSet: reachSetExport };
  const groundY = 1;
  let total = 0, ok = 0;
  const levelYs = [...levels.keys()].sort((a, b) => a - b).filter((y) => levels.get(y).length >= 6);
  const groundArea = levels.get(groundY)?.length ?? 0;
  for (const y of levelYs) {
    const cells = levels.get(y);
    const r = cells.filter(([x, z]) => reach.has(`${x},${y},${z}`));
    const rs = cells.filter(([x, z]) => reachNoLadder.has(`${x},${y},${z}`));
    const heights = cells.map(([x, z]) => clear(x, y, z));
    const mode = [...heights.reduce((m, h) => m.set(h, (m.get(h) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1])[0][0];
    const tall = heights.filter((h) => h >= 3).length / heights.length;
    // 2x2 coverage of reachable cells (passage width)
    // Passage width is judged inside the building only (cells walled in on all four sides).
    const enclosed = ([x, z]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => {
      for (let k = 1; k <= 15; k++) if (!body(x + dx * k, y + 1, z + dz * k)) return true;
      return false;
    });
    const rset = new Set(r.map(([x, z]) => `${x},${z}`));
    const seat = ([x, z]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => cls(x + dx, y, z + dz) === 'step');
    const rin = r.filter((c) => enclosed(c) && !seat(c));
    const wide = rin.filter(([x, z]) => [[0, 0], [-1, 0], [0, -1], [-1, -1]].some(([ox, oz]) => [[0, 0], [1, 0], [0, 1], [1, 1]].every(([a, b]) => rset.has(`${x + ox + a},${z + oz + b}`)))).length;
    // Rooms under a sloping roof (attic storeys) have no single storey height.
    const ceil = cells.map(([x, z]) => get(x, y + clear(x, y, z), z) ?? '');
    const sloped = ceil.filter((b) => /_stairs|_slab/.test(b)).length >= ceil.length * 0.5;
    const lv = {
      y, area: cells.length, sloped, reach: r.length / cells.length, viaStairs: rs.length / cells.length, minClear: Math.min(...heights), mode, tall,
      wide: rin.length ? wide / rin.length : 1, unreachable: cells.filter(([x, z]) => !reach.has(`${x},${y},${z}`)),
    };
    res.levels.push(lv);
    total += cells.length;
    ok += r.length;
  }
  res.reach = total ? ok / total : 0;
  // Footprint (4.5): plot columns with massing (roof, walls) at y >= 3.
  const cols = new Set();
  for (const b of list) if (b.y >= 3 && plotCell(b.x, b.z) && !THIN.test(blockName(b.block))) cols.add(`${b.x},${b.z}`);
  res.footprint = cols.size;
  // Roof holes (4.3): uncovered floor cells mostly surrounded by covered interior.
  const interior = new Set(levelYs.flatMap((y) => levels.get(y).map(([x, z]) => `${x},${y},${z}`)));
  let holes = 0;
  for (const y of levelYs.filter((y) => y > 1))
    for (let x = 0; x < size; x++)
      for (let z = 0; z < size; z++) {
        if (interior.has(`${x},${y},${z}`) || !standable(x, y, z) || covered(x, y, z)) continue;
        const sup = blockName(get(x, y - 1, z));
        if (FURNITURE.test(sup)) continue;
        const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => interior.has(`${x + dx},${y},${z + dz}`)).length;
        if (n >= 3) holes++;
      }
  res.holes = holes;
  // Entrance door reachable (2.3).
  res.door = list.some((b) => /_door\b/.test(b.block) && b.y <= 2 && /half=lower/.test(b.block) && reach.has(`${b.x},${b.y},${b.z}`));
  // Household markers (3.x) per level band.
  const at = (y1, y2, re) => list.filter((b) => b.y >= y1 && b.y <= y2 && re.test(b.block) && plotCell(b.x, b.z));
  const levelInfo = res.levels.map((lv) => {
    const top = lv.y + Math.max(2, Math.min(lv.mode, 4)) - 1;
    return {
      y: lv.y,
      light: at(lv.y, top + 1, LIGHT).length > 0,
      window: at(lv.y, top, /glass/).length > 0,
      kitchen: at(lv.y, top, /smoker|furnace|campfire/).length > 0 && at(lv.y, top, /water_cauldron/).length > 0,
      bed: at(lv.y, top, /_bed\[.*part=head/).length > 0,
      storage: at(lv.y, top, /chest|barrel/).length > 0,
      bath: at(lv.y, top, /water_cauldron/).length >= 2 || (at(lv.y, top, /water_cauldron/).length >= 1 && at(lv.y, top, /quartz/).length > 0),
    };
  });
  res.levelInfo = levelInfo;
  // Pane lint (1.4 look): window panes (something above) that are posts, halves or T/crosses.
  const lint = { post: 0, half: 0, tee: 0, where: [] };
  for (const b of list) {
    const n = blockName(b.block);
    if (!isPaneLike(n) || /_bars$/.test(n)) continue;
    if (!map.get(`${b.x},${b.y + 1},${b.z}`)) continue;
    const p = blockProps(b.block);
    const c = ['north', 'east', 'south', 'west'].filter((d) => p[d] === 'true');
    const ns = c.includes('north') || c.includes('south');
    const ew = c.includes('east') || c.includes('west');
    const nb = () => [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dz]) => blockName(map.get(`${b.x + dx},${b.y},${b.z + dz}`)) || '-').join('/');
    if (c.length === 0) { lint.post++; (lint.where ??= []).push(`post@${b.x},${b.y},${b.z} N/E/S/W=${nb()}`); }
    else if (c.length === 1) { lint.half++; (lint.where ??= []).push(`half@${b.x},${b.y},${b.z} N/E/S/W=${nb()}`); }
    else if (ns && ew) { lint.tee++; (lint.where ??= []).push(`tee@${b.x},${b.y},${b.z} N/E/S/W=${nb()}`); }
  }
  res.lint = lint;
  return res;
}

// ---------------------------------------------------------------- verdict per spec
export function verdict(type, res, spec = SPEC[type] ?? {}) {
  const fails = [];
  const lv = res.levels;
  const bigLevels = lv.filter((l) => l.area >= 6);
  for (const l of bigLevels) if (l.reach < 0.9) fails.push(`2.1 level y=${l.y} only ${(l.reach * 100).toFixed(0)}% reachable`);
  if (res.reach < 0.95) fails.push(`2.2 interior reach ${(res.reach * 100).toFixed(1)}%`);
  if (!res.door) fails.push('2.3 no reachable entrance door');
  const ground = lv.find((l) => l.y === 1) ?? lv[0];
  for (const l of bigLevels) {
    if (l.y === 1) continue;
    const ladderOk = spec.tower || l.area < (ground?.area ?? 0) * 0.6 || l === bigLevels[bigLevels.length - 1];
    if (l.viaStairs < 0.9 * l.reach && !ladderOk) fails.push(`2.4 level y=${l.y} needs a ladder (no staircase)`);
  }
  if (spec.public && ground && ground.wide < 0.8) fails.push(`2.5 ground passages: only ${(ground.wide * 100).toFixed(0)}% of floor in 2-wide areas`);
  for (const l of bigLevels) if (l.minClear < 2) fails.push(`2.6 level y=${l.y} clear height ${l.minClear}`);
  if (spec.public && ground && ground.tall < 0.8) fails.push(`2.6 hall y=${ground.y} only ${(ground.tall * 100).toFixed(0)}% >= 3 high`);
  if (spec.residential) {
    const living = bigLevels.filter((l) => l.area >= 36);
    if (living.length < (spec.minLevels ?? 1)) fails.push(`4.1 only ${living.length} floors >= 6x6 (need ${spec.minLevels})`);
    // Attics and lofts reached only by ladder are storage, not rooms.
    const info = res.levelInfo.filter((i) => bigLevels.find((l) => l.y === i.y && l.area >= 20 && !(l.viaStairs < 0.5 && l.reach > 0.5)));
    const any = (k) => info.some((i) => i[k]);
    for (const k of ['kitchen', 'bed', 'storage', 'bath']) if (!any(k)) fails.push(`3 missing ${k}`);
    for (const i of info) if (!i.light) fails.push(`3.6 no light on level y=${i.y}`);
    for (const i of info) if (!i.window) fails.push(`3.7 no window on level y=${i.y}`);
    if (spec.perFloor === 'upper') {
      const ups = info.filter((i) => i.y > 1 && bigLevels.find((l) => l.y === i.y && l.area >= 36));
      for (const i of ups) for (const k of ['kitchen', 'bed', 'light']) if (!i[k]) fails.push(`3 floor y=${i.y} dwelling lacks ${k}`);
    }
  }
  for (const l of bigLevels) {
    if (spec.tower || spec.public) continue;
    const isTop = l === bigLevels[bigLevels.length - 1] && bigLevels.length > 1;
    if (!isTop && !l.sloped && (l.mode < 2 || l.mode > 3) && l.area >= 20) fails.push(`4.2 level y=${l.y} storey clear height ${l.mode}`);
  }
  if (spec.minLevels >= 3 && bigLevels.filter((l) => l.area >= 36).length < spec.minLevels) fails.push(`4.1 only ${bigLevels.filter((l) => l.area >= 36).length} floors`);
  if (res.holes > 0) fails.push(`4.3 ${res.holes} roof holes over floors`);
  if (!spec.noFootprint && res.footprint < 101) fails.push(`4.5 footprint ${res.footprint} < 101 (35% of 17x17)`);
  if (res.lint.post + res.lint.half + res.lint.tee > 0) fails.push(`1.4 window panes: ${res.lint.post} posts, ${res.lint.half} halves, ${res.lint.tee} T/cross`);
  return fails;
}

// ---------------------------------------------------------------- CLI
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/').replace(/^\//, '')}` || process.argv[1]?.endsWith('walkcheck.mjs')) {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
  const pos = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--json');
  const types = !pos[0] || pos[0] === 'all' ? Object.keys(BUILDINGS) : pos[0].split(',');
  const seeds = Number(pos[1] ?? 12);
  const table = [];
  let failed = 0;
  for (const type of types) {
    let runs = 0, bad = 0, minReach = 1, minClear = 9, levelsMin = 99, levelsMax = 0, fpMin = 999;
    const issues = new Map();
    for (let s = 0; s < seeds; s++)
      for (let turns = 0; turns < 4; turns++) {
        const bp = BUILDINGS[type](rngFrom(`walk${s}:${type}`));
        const list = bp.toBuildList({ turns, size: 21, offset: 2 });
        const res = analyse(list, { turns });
        const fails = verdict(type, res);
        runs++;
        if (fails.length) bad++;
        for (const f of fails) issues.set(f.replace(/y=\d+/, 'y=*').replace(/\d+(\.\d+)?%/, '*%'), (issues.get(f) ?? []).concat(`s${s}t${turns}`));
        minReach = Math.min(minReach, res.reach);
        const big = res.levels.filter((l) => l.area >= 6);
        levelsMin = Math.min(levelsMin, big.length);
        levelsMax = Math.max(levelsMax, big.length);
        minClear = Math.min(minClear, ...big.map((l) => l.minClear));
        fpMin = Math.min(fpMin, res.footprint);
        if (verbose && fails.length) {
          console.log(`  ${type} s${s} t${turns}: ${fails.join('; ')}`);
          for (const w of (res.lint.where ?? []).slice(0, 6)) console.log(`     ${w}`);
          for (const l of res.levels) if (l.unreachable.length) console.log(`     y=${l.y} unreachable: ${l.unreachable.slice(0, 12).map((c) => c.join(',')).join(' ')}`);
        }
      }
    failed += bad;
    table.push({ type, runs, pass: runs - bad, minReach: +(minReach * 100).toFixed(1), levels: `${levelsMin}-${levelsMax}`, minClear, footprint: fpMin, issues: [...issues].map(([k, v]) => `${k} (${v.length}x)`) });
  }
  console.log('type        runs  pass  minReach  levels  minClear  footprint');
  for (const r of table) {
    console.log(`${r.type.padEnd(11)} ${String(r.runs).padStart(4)} ${String(r.pass).padStart(5)} ${String(r.minReach).padStart(8)}% ${r.levels.padStart(7)} ${String(r.minClear).padStart(9)} ${String(r.footprint).padStart(10)}`);
    for (const i of r.issues.slice(0, 8)) console.log(`    ✗ ${i}`);
  }
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(table, null, 2));
  console.log(failed ? `\n✗ ${failed} failing builds` : '\n✓ all builds pass');
  process.exit(failed ? 1 : 0);
}
