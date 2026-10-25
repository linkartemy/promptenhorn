#!/usr/bin/env node
// Terrain classification report: reads an area from the region files (bridge/terrain-scan.mjs), classifies
// the 21x21 plot cells and renders an overlay PNG + prints stats. Read-only; never writes to the world.
//
//   node tools/terrain-report.mjs --world <worldDir> (--rect x1,z1,x2,z2 | --center X,Z [--radius R]) [options]
//
// Options:
//   --origin X,Z          city centre the cell grid is aligned to (cell 0,0 = X-10..X+10); default: --state's city, else area centre
//   --state FILE          bridge state.json: grid origin from its city, existing plots outlined in white
//   --out FILE.png        output image (default terrain_<x>_<z>.png in cwd)
//   --scale N             px per block (default 2)
//   --view cells|slope|plan  cells: classes + suggested use (default); slope: per-column slope & water types;
//                         plan: simulated terrain-aware growth of --plots N houses from the origin (planner prototype)
//   --plots N             houses for --view plan (default 60)
//   --budget N            earthwork budget per column for platform plans (default 3)
//   --json FILE           write the classified cells as JSON
//   --server-dir DIR      server root (world + RCON settings from server.properties)
//   --rcon-port P         run `save-all flush` over RCON first (127.0.0.1); --rcon-password PW
//   --bench               scan twice and report the cached re-scan time
//   --migrate             with --state: dry run of the shore renovation (bridge/infra.mjs) for that city — which
//                         quays, jetties and which harbour would be added where existing plots meet the water.
//                         Read-only (region files + state file); planned pieces are drawn over the map.
//   --earthwork           with --state: earthwork of the adaptive plots vs what the old rules would have moved
//   --infra               with --state: draw the infrastructure already planned in the state (state.terrain.infra)
import fs from 'node:fs';
import path from 'node:path';
import { TerrainScanner, analyze, classifyCells, summarize, siteScore, harbourSites, simulateGrowth, seamSteps, compareEarthworks, WT, KIND, F } from '../bridge/terrain-scan.mjs';
import { Raster } from './lib/png.mjs';
import { TerrainPlanner } from '../bridge/terrain.mjs';
import { planShoreRenovation, infraList } from '../bridge/infra.mjs';

const NONE = -32768;

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
    const key = a.slice(2);
    if (['help', 'bench', 'migrate', 'earthwork', 'infra'].includes(key)) { o[key] = true; continue; }
    const v = argv[++i];
    if (v === undefined) throw new Error(`missing value for ${a}`);
    o[key] = v;
  }
  return o;
}
const nums = (s, n, what) => {
  const r = String(s).split(',').map((t) => Number(t.trim()));
  if (r.length !== n || r.some((x) => !Number.isFinite(x))) throw new Error(`${what}: expected ${n} numbers, got "${s}"`);
  return r.map(Math.floor);
};
const readProps = (file) => Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));

async function saveAll(port, password) {
  const { Rcon } = await import('../bridge/rcon.mjs');
  const r = new Rcon({ host: '127.0.0.1', port, password });
  await r.connect();
  try {
    console.log(`rcon :${port} save-all flush -> ${String(await r.command('save-all flush')).trim()}`);
  } finally {
    r.close();
  }
  await new Promise((res) => setTimeout(res, 300));
}

// ------------------------------------------------------------------ colours

const CLASS_COLOR = {
  unknown: [128, 128, 128], built: [255, 255, 255], flat: [110, 230, 110], gentle: [235, 225, 70], steep: [245, 140, 40], cliff: [230, 40, 40],
  water: [70, 130, 255], shoreline: [255, 240, 180], river_crossing: [210, 90, 255], forest: [30, 140, 50],
};
const CLASS_CODE = { unknown: '', built: 'u', flat: 'f', gentle: 'g', steep: 's', cliff: 'c', water: 'w', shoreline: 'b', river_crossing: 'x', forest: 't' };
const USE_CODE = {
  level: 'lv', terrace2: 't2', terrace3: 't3', walkout: 'wo', stilts: 'st', natural: 'na', none: '', beach: 'be', waterfront: 'wf',
  riverside: 'rs', occupied: '', viaduct: 'vi', 'cliff-shore': 'cs', bridge: 'br', park: 'pk', 'open-water': 'ow', shallows: 'sh', river: 'rv', 'scan-again': '',
};
const WATER_COLOR = { ocean: [28, 55, 150], river: [45, 125, 215], lake: [25, 145, 160], pond: [90, 180, 190], swamp: [70, 110, 80] };
const KIND_COLOR = {
  unknown: [60, 60, 66], grass: [105, 150, 70], dirt: [134, 100, 70], sand: [218, 205, 155], gravel: [140, 136, 132], stone: [128, 128, 128],
  snow: [240, 245, 250], clay: [160, 165, 178], mud: [85, 72, 62], ice: [165, 195, 245], built: [176, 160, 150], lava: [220, 90, 20],
};
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function slopeColor(s) {
  // 0 green .. 0.3 yellow .. 0.7 orange .. >=1.2 red
  const stops = [[0, [70, 170, 70]], [0.15, [170, 210, 80]], [0.35, [240, 220, 70]], [0.7, [240, 140, 40]], [1.2, [220, 40, 40]], [3, [110, 0, 0]]];
  for (let k = 1; k < stops.length; k++) if (s <= stops[k][0]) return mix(stops[k - 1][1], stops[k][1], (s - stops[k - 1][0]) / (stops[k][0] - stops[k - 1][0]));
  return stops[stops.length - 1][1];
}

// ------------------------------------------------------------------ render

const ROLE_COLOR = {
  level: [110, 230, 110], walkout: [235, 225, 70], terrace2: [245, 170, 60], terrace3: [245, 120, 40], stilts: [170, 110, 60],
  waterfront: [255, 235, 170], harbour: [0, 230, 255], pier: [200, 230, 255], bridge: [210, 90, 255], viaduct: [150, 60, 200],
  viewpoint: [230, 40, 40], park: [30, 140, 50], stairs: [255, 255, 255],
};
const roleKey = (p) => (p.role === 'house' ? p.mode : p.role);

const INFRA_COLOR = { quay: [255, 80, 200], pier: [255, 200, 40], promenade: [255, 140, 60], beach: [255, 230, 120], harbour: [0, 255, 255], lane: [255, 255, 255], viewpoint: [255, 40, 40], bridge: [200, 90, 255] };

function render(an, cells, { scale, view, plots, title, harbours, plan, infra = [] }) {
  const { g, smooth, slope, wtype, isWater } = an;
  const { W, D, ground, flags, kind, depth } = g;
  const fs1 = 2;
  const L = 6, T = 5 * fs1 + 8;
  const legendRows = view === 'slope' ? 3 : 6;
  const B = 8 + legendRows * (5 * fs1 + 6) + 4;
  const img = new Raster(L + W * scale + 6, T + D * scale + B, [24, 24, 28]);
  const px = (x, z, c) => {
    for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) img.set(L + x * scale + a, T + z * scale + b, clamp(Math.round(c[0]), 0, 255), clamp(Math.round(c[1]), 0, 255), clamp(Math.round(c[2]), 0, 255));
  };
  for (let z = 0; z < D; z++)
    for (let x = 0; x < W; x++) {
      const i = z * W + x;
      if (ground[i] === NONE) { px(x, z, ((x >> 3) + (z >> 3)) & 1 ? [48, 48, 52] : [62, 62, 68]); continue; }
      let c;
      if (isWater(i)) {
        c = WATER_COLOR[WT[wtype[i]]] ?? [40, 80, 200];
        c = c.map((v) => v * (1 - Math.min(0.45, depth[i] * 0.03)));
        if (flags[i] & F.FROZEN) c = mix(c, [200, 220, 250], 0.35);
      } else if (view === 'slope') {
        c = slopeColor(slope[i]);
      } else {
        c = flags[i] & F.TREE ? [52, 100, 42] : KIND_COLOR[KIND[kind[i]]] ?? [120, 120, 120];
        if (flags[i] & F.SNOW) c = mix(c, [245, 248, 252], 0.6);
      }
      // hillshade from the NW
      const h = smooth[i];
      const hn = z > 0 && !Number.isNaN(smooth[i - W]) ? smooth[i - W] : h;
      const hw = x > 0 && !Number.isNaN(smooth[i - 1]) ? smooth[i - 1] : h;
      if (!isWater(i)) c = c.map((v) => v * (1 + clamp(((h - hn) + (h - hw)) * 0.18, -0.4, 0.3)));
      // contours every 5 blocks
      if (view !== 'slope' && !isWater(i) && x > 0 && z > 0) {
        const k = Math.floor(ground[i] / 5);
        if (Math.floor(ground[i - 1] / 5) !== k || Math.floor(ground[i - W] / 5) !== k) c = c.map((v) => v * 0.62);
      }
      px(x, z, c);
    }

  if (view === 'cells') {
    for (const c of cells.values()) {
      const col = CLASS_COLOR[c.cls];
      const x0 = L + (c.x1 - g.rect.x1) * scale, z0 = T + (c.z1 - g.rect.z1) * scale, n = 21 * scale;
      for (let a = 0; a < n; a++)
        for (let b = 0; b < n; b++) {
          const edge = a === 0 || b === 0 || a === n - 1 || b === n - 1;
          img.blend(x0 + a, z0 + b, col, edge ? 0.95 : 0.28);
        }
      if (harbours.includes(c)) {
        for (let a = 2; a < n - 2; a++)
          for (const b of [2, 3, 4, n - 3, n - 4, n - 5]) { img.set(x0 + a, z0 + b, 0, 230, 255); img.set(x0 + b, z0 + a, 0, 230, 255); }
      }
      const label = `${CLASS_CODE[c.cls]}${USE_CODE[c.use] ? ' ' + USE_CODE[c.use] : ''}`;
      const fsz = scale >= 2 ? 2 : 1;
      const tw = Raster.textWidth(label, fsz);
      img.fill(x0 + 2, z0 + 2, tw + 3, 5 * fsz + 3, [20, 20, 20]);
      img.text(x0 + 3, z0 + 3, label, col, fsz);
      if (c.relief != null && !['water', 'unknown', 'built'].includes(c.cls)) {
        const r = `r${c.relief}`;
        img.text(x0 + 3, z0 + 3 + 5 * fsz + 4, r, [235, 235, 235], fsz, [0, 0, 0]);
      }
    }
    for (const p of plots) {
      const x0 = L + (p.x1 - g.rect.x1) * scale, z0 = T + (p.z1 - g.rect.z1) * scale, n = 21 * scale;
      for (let a = 0; a < n; a++) for (const b of [1, n - 2]) { img.set(x0 + a, z0 + b, 255, 255, 255); img.set(x0 + b, z0 + a, 255, 255, 255); }
    }
  }

  if (view === 'plan') {
    for (const [k, p] of plan) {
      const c = cells.get(k);
      const col = ROLE_COLOR[roleKey(p)] ?? [255, 255, 255];
      const x0 = L + (c.x1 - g.rect.x1) * scale, z0 = T + (c.z1 - g.rect.z1) * scale, n = 21 * scale;
      const outline = p.role === 'viewpoint' || p.role === 'park' || p.role === 'pier' || p.role === 'stairs';
      for (let a = 0; a < n; a++)
        for (let b = 0; b < n; b++) {
          const edge = a < 2 || b < 2 || a >= n - 2 || b >= n - 2;
          if (outline && !edge) continue;
          img.blend(x0 + a, z0 + b, col, edge ? 0.95 : 0.5);
        }
      const fsz = scale >= 2 ? 2 : 1;
      const label = p.order ? String(p.order) : { viewpoint: 'vp', park: 'pk', pier: 'pi', stairs: 'st' }[p.role] ?? '';
      if (label) {
        img.fill(x0 + 3, z0 + 3, Raster.textWidth(label, fsz) + 3, 5 * fsz + 3, [20, 20, 20]);
        img.text(x0 + 4, z0 + 4, label, col, fsz);
      }
      if (p.y != null) img.text(x0 + 4, z0 + 4 + 5 * fsz + 4, String(p.y), [255, 255, 255], fsz, [0, 0, 0]);
    }
  }

  // planned / built infrastructure (block footprints)
  for (const { type, list } of infra) {
    const col = INFRA_COLOR[type] ?? [255, 255, 255];
    for (const b of list) {
      if (b.cmd || b.block.endsWith(':air')) continue;
      const x = b.x - g.rect.x1, z = b.z - g.rect.z1;
      if (x < 0 || z < 0 || x >= W || z >= D) continue;
      for (let a = 0; a < scale; a++) for (let c = 0; c < scale; c++) img.blend(L + x * scale + a, T + z * scale + c, col, 0.85);
    }
  }

  // title + legend
  img.text(L, 3, title, [230, 230, 230], fs1);
  let ly = T + D * scale + 8;
  const sw = (x, y, c, text) => {
    img.fill(x, y, 5 * fs1, 5 * fs1, c);
    return x + 5 * fs1 + 4 + img.text(x + 5 * fs1 + 4, y, text, [220, 220, 220], fs1) + 12;
  };
  const row = (items) => {
    let x = L;
    for (const [c, t] of items) x = sw(x, ly, c, t);
    ly += 5 * fs1 + 6;
  };
  row(Object.entries(WATER_COLOR).map(([k, c]) => [c, k]));
  if (view === 'cells') {
    row(['flat', 'gentle', 'steep', 'cliff', 'forest'].map((k) => [CLASS_COLOR[k], `${CLASS_CODE[k]} ${k}`]));
    row(['water', 'shoreline', 'river_crossing'].map((k) => [CLASS_COLOR[k], `${CLASS_CODE[k]} ${k.replace('_', ' ')}`]).concat([[[0, 230, 255], 'harbour site']]));
    row([[[255, 255, 255], 'u built / plot'], [[52, 100, 42], 'trees'], [KIND_COLOR.sand, 'sand'], [KIND_COLOR.stone, 'stone'], [KIND_COLOR.built, 'built']]);
    img.text(L, ly, 'use: lv level  t2/t3 terraces  wo walkout  st stilts  na natural  be beach  wf waterfront', [200, 200, 200], fs1);
    ly += 5 * fs1 + 6;
    img.text(L, ly, '     rs riverside  cs cliff shore  br bridge  pk park  ow open water  sh shallows   r = relief', [200, 200, 200], fs1);
  } else if (view === 'plan') {
    row(['level', 'walkout', 'terrace2', 'terrace3', 'stilts'].map((k) => [ROLE_COLOR[k], k]));
    row(['waterfront', 'harbour', 'pier', 'bridge', 'viaduct'].map((k) => [ROLE_COLOR[k], k]));
    row(['viewpoint', 'park', 'stairs'].map((k) => [ROLE_COLOR[k], k + ' (outline)']));
    img.text(L, ly, 'top: growth order, below: platform height y', [200, 200, 200], fs1);
  } else {
    row([[slopeColor(0), 'slope 0'], [slopeColor(0.15), '0.15'], [slopeColor(0.35), '0.35'], [slopeColor(0.7), '0.7'], [slopeColor(1.2), '1.2'], [slopeColor(2.5), '2.5+']]);
    img.text(L, ly, 'hillshaded; slope = height change per block on a 3x3-smoothed surface', [200, 200, 200], fs1);
  }
  return img;
}

// ------------------------------------------------------------------ main

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || (!o.rect && !o.center)) {
    const src = fs.readFileSync(new URL(import.meta.url), 'utf8');
    console.log(src.split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
    process.exit(o.help ? 0 : 1);
  }
  let props = null;
  if (o['server-dir']) props = readProps(path.join(o['server-dir'], 'server.properties'));
  const world = o.world ?? (o['server-dir'] ? path.join(o['server-dir'], props?.['level-name'] || 'world') : null);
  if (!world || !fs.existsSync(world)) throw new Error(`world not found: ${world}`);
  if (o['rcon-port'] || (props && props['enable-rcon'] === 'true')) {
    const port = Number(o['rcon-port'] ?? props['rcon.port']);
    const pw = o['rcon-password'] ?? props?.['rcon.password'];
    try {
      await saveAll(port, pw);
    } catch (err) {
      console.warn(`warning: save-all failed (${err.message}); using what is on disk`);
    }
  }

  let rect;
  if (o.rect) {
    const [x1, z1, x2, z2] = nums(o.rect, 4, '--rect');
    rect = { x1: Math.min(x1, x2), z1: Math.min(z1, z2), x2: Math.max(x1, x2), z2: Math.max(z1, z2) };
  } else {
    const [x, z] = nums(o.center, 2, '--center');
    const r = Number(o.radius ?? 160);
    rect = { x1: x - r, z1: z - r, x2: x + r, z2: z + r };
  }
  let state = null;
  if (o.state) state = JSON.parse(fs.readFileSync(o.state, 'utf8'));
  const origin = o.origin ? nums(o.origin, 2, '--origin') : state?.city ? [state.city.cx, state.city.cz] : [Math.round((rect.x1 + rect.x2) / 2), Math.round((rect.z1 + rect.z2) / 2)];
  const plots = state?.plots ? Object.values(state.plots).map((p) => ({ x1: p.x0, z1: p.z0 })) : [];

  const scanner = new TerrainScanner(world);
  const t0 = Date.now();
  const grid = scanner.scan(rect);
  const first = { ...scanner.stats };
  const tScan = Date.now() - t0;
  const an = analyze(grid);
  const cells = classifyCells(an, { origin, budget: Number(o.budget ?? 3) });
  const tAll = Date.now() - t0;
  let tRescan = null;
  if (o.bench) {
    const t1 = Date.now();
    scanner.scan(rect);
    tRescan = Date.now() - t1;
  }

  const view = o.view ?? 'cells';
  const out = o.out ?? `terrain_${rect.x1}_${rect.z1}${view === 'slope' ? '_slope' : ''}.png`;
  const title = `${view}  x ${rect.x1}..${rect.x2}  z ${rect.z1}..${rect.z2}  origin ${origin.join(',')}`;
  const harbours = harbourSites(cells, { count: 4 });
  const plan = simulateGrowth(cells, { count: Number(o.plots ?? 60), start: [0, 0], harbours });
  // Shore renovation dry run / existing infra.
  const infra = [];
  let migration = null;
  if ((o.migrate || o.infra) && !state?.city) throw new Error('--migrate / --infra need --state with a city');
  if (o.infra) for (const r of Object.values(state.terrain?.infra ?? {})) infra.push({ type: r.type, list: infraList(r) });
  if (o.migrate) {
    const planner = new TerrainPlanner({ cmd: async () => '', log: () => {}, chunks: null, worldDir: world, budget: Number(o.budget ?? 3) });
    planner.setOrigin(state.city.cx, state.city.cz);
    planner.cover(Object.values(state.plots).map((p) => p.cell), 2);
    migration = planShoreRenovation({ planner, state, log: () => {} }, { dryRun: true });
    for (const r of migration) infra.push({ type: r.type, list: infraList(r) });
  }
  const img = render(an, cells, { harbours, plan, scale: Math.max(1, Number(o.scale ?? 2) | 0), view, plots, title, infra });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, img.toPNG());

  // ---- stats
  const st = first;
  console.log(`wrote ${path.resolve(out)} (${img.w}x${img.h})`);
  console.log(`scan ${rect.x2 - rect.x1 + 1}x${rect.z2 - rect.z1 + 1}: ${st.decoded} chunks decoded, ${st.cached} cached, ${st.missing} missing, ${st.proto} proto (not full), ${st.failed} failed; ` +
    `scan ${tScan} ms, scan+analysis ${tAll} ms${tRescan != null ? `, cached re-scan ${tRescan} ms` : ''}`);
  const sum = summarize(cells);
  console.log(`cells: ${sum.cells}`);
  console.log(`  by class: ${Object.entries(sum.byClass).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  by use:   ${Object.entries(sum.byUse).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const land = [...cells.values()].filter((c) => c.plan?.maxCut != null);
  const avg = (f) => (land.length ? (land.reduce((s, c) => s + f(c), 0) / land.length).toFixed(1) : '-');
  console.log(`  land cells with a plan: ${land.length}; mean relief ${avg((c) => c.relief)}, mean slope ${avg((c) => c.slope * 100)}%`);
  const bodies = an.bodies.filter((b) => b.area >= 20).sort((a, b) => b.area - a.area);
  console.log(`water bodies (>=20 columns): ${bodies.length}`);
  for (const b of bodies.slice(0, 8))
    console.log(`  ${b.type.padEnd(6)} area ${String(b.area).padStart(6)}  surface y ${b.minY}${b.maxY !== b.minY ? '..' + b.maxY : ''}  max depth ${b.maxDepth}  ~width ${b.halfWidth * 2}  centre ${b.cx},${b.cz}${b.edge ? '  (continues beyond the area)' : ''}${b.frozen ? `  frozen ${b.frozen}` : ''}`);
  const cand = [...cells.values()].filter((c) => (c.harbourScore ?? 0) >= 3).length;
  console.log(`harbour: ${cand} candidate cells; sites ${harbours.map((c) => `[${c.i},${c.j}] (x ${c.x1 + 10}, z ${c.z1 + 10}) score ${c.harbourScore}`).join(', ') || 'none'}`);
  const biomes = {};
  for (let i = 0; i < grid.W * grid.D; i++) if (grid.ground[i] !== NONE) biomes[grid.biomes[grid.biome[i]]] = (biomes[grid.biomes[grid.biome[i]]] ?? 0) + 1;
  const n = grid.W * grid.D;
  console.log(`biomes: ${Object.entries(biomes).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${((v / n) * 100).toFixed(0)}%`).join(', ')}`);
  const site = siteScore(cells, { radius: 6 });
  console.log(`site score around origin (radius 6 cells, lower = better): ${JSON.stringify(site)}`);
  if (view === 'plan') {
    const roles = {};
    for (const p of plan.values()) roles[roleKey(p)] = (roles[roleKey(p)] ?? 0) + 1;
    console.log(`plan: ${Object.entries(roles).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    console.log(`plan seam steps |dy| between neighbouring plots: ${JSON.stringify(seamSteps(plan, cells))}`);
    const ew = compareEarthworks(plan, cells);
    console.log(`earthworks on ${ew.plots} lots (17x17 interior): today cut ${ew.today.cut} / fill ${ew.today.fill} blocks, max cut ${ew.today.maxCut}, max fill ${ew.today.maxFill}`);
    console.log(`                              adaptive cut ${ew.adaptive.cut} / fill ${ew.adaptive.fill} blocks, max cut ${ew.adaptive.maxCut}, max fill ${ew.adaptive.maxFill} (stilts/walk-out: posts & basements instead)`);
  }
  if (migration) {
    const byType = {};
    for (const r of migration) byType[r.type] = (byType[r.type] ?? 0) + 1;
    console.log(`shore renovation (dry run, nothing written): ${migration.length} pieces ${JSON.stringify(byType)}`);
    for (const r of migration) {
      const c = r.rect ? [Math.round((r.rect.x1 + r.rect.x2) / 2), Math.round((r.rect.z1 + r.rect.z2) / 2)] : ['?', '?'];
      const p = r.params;
      const what = r.type === 'quay' ? `plot ${p.plot} ${p.side} side, street y=${p.y}, water y=${p.waterY}, ${p.steps ? 'stepped bank to the water' : 'quay wall + ladder'}${p.pierAt ? ', gap for the jetty' : ''}`
        : r.type === 'pier' ? `${p.bottoms.length} long, deck y=${p.deckY}${p.steps ? `, ${p.steps} steps down from the quay` : ''}`
        : r.type === 'harbour' ? `breakwater ${p.mole.length} columns, lighthouse ${p.light ? 'yes' : 'no'}, landing ${p.landing ? p.landing.bottoms.length + ' long' : 'no'}`
        : '';
      console.log(`  ${r.type.padEnd(9)} cell [${r.cell}] around x ${c[0]}, z ${c[1]}: ${r.total} blocks${what ? ' — ' + what : ''}`);
    }
  }
  if (o.earthwork) {
    const ps = Object.values(state?.plots ?? {}).filter((p) => p.terrain?.legacy);
    const sum = (f) => ps.reduce((a, p) => a + (f(p) ?? 0), 0);
    const modes = {};
    for (const p of ps) modes[p.terrain.mode] = (modes[p.terrain.mode] ?? 0) + 1;
    console.log(`earthwork on ${ps.length} adaptive plots (lot + apron), modes ${JSON.stringify(modes)}:`);
    console.log(`  adaptive:  cut ${sum((p) => p.terrain.cut)}, fill ${sum((p) => p.terrain.fill)} (dirt), retaining walls ${sum((p) => p.terrain.wall)}, posts ${sum((p) => p.terrain.posts)}, deck ${sum((p) => p.terrain.deck)} columns, water filled 0`);
    console.log(`  old rules: cut ${sum((p) => p.terrain.legacy.cut)}, fill ${sum((p) => p.terrain.legacy.fill)} (of it into water ${sum((p) => p.terrain.legacy.water)}), terraces 4 wide`);
    const hd = ps.map((p) => Math.abs(p.y - p.terrain.legacy.y));
    console.log(`  street level differs from the old rule by ${hd.length ? (hd.reduce((a, b) => a + b, 0) / hd.length).toFixed(1) : '-'} blocks on average (max ${Math.max(0, ...hd)})`);
  }
  if (o.json) {
    fs.writeFileSync(o.json, JSON.stringify({ rect, origin, cells: [...cells.values()], bodies: an.bodies.filter((b) => b.area >= 20) }, null, 1));
    console.log(`cells -> ${path.resolve(o.json)}`);
  }
}

main().catch((err) => {
  console.error(`error: ${err.stack || err.message}`);
  process.exit(1);
});
