#!/usr/bin/env node
// Render a Minecraft Java (1.18+ / 1.21.x) world area straight from its Anvil region files to PNG.
// Dependency-free. Top-down map (default) or isometric view (--iso).
//
//   node tools/map.mjs --world <worldDir> --rect x1,z1,x2,z2 [options]
//
// Options:
//   --out file.png          output path (default: map_<rect>[_iso_<from>].png in cwd)
//   --scale N               top-down: N px per block (default 1)
//   --height                top-down: colour by height (ramp) instead of block colour
//   --range LO,HI           top-down --height: y range of the colour ramp (default p2..p85 of surface heights)
//   --grid N                top-down: overlay grid lines every N blocks ...
//   --grid-origin X,Z       ... aligned to this block (default 0,0)
//   --mark X,Z[;X,Z...]     draw a magenta cross at these columns (both views)
//   --no-labels             top-down: no coordinate ruler / footer
//   --iso                   isometric view instead of top-down
//   --from se|sw|ne|nw      iso: viewing direction (default se = looking north-west)
//   --cube N                iso: block size in px (half tile width; default 4, auto-shrunk to keep < ~3000px)
//   --ymin Y --ymax Y       vertical range (iso default: surface p1 - 5 .. min(max top, surface max + 35))
//   --no-checker            iso: no alternating block shading on top faces
//   --region-dir DIR        read r.X.Z.mca from DIR instead of <world>/region
//   --server-dir DIR        server root: world defaults to DIR/<level-name>; RCON password/port from server.properties
//   --rcon-port P           run `save-all flush` over RCON first (127.0.0.1, or --rcon-host)
//   --rcon-password PW      RCON password (default: rcon.password from --server-dir/server.properties)
//   --probe X,Y,Z[;...]     print the block state at these positions (as read from disk) and exit
//   --column X,Z            print the non-air blocks of this column (top-down) and exit
import fs from 'node:fs';
import path from 'node:path';
import { World, chunkGet } from './lib/anvil.mjs';
import { renderTopDown, renderIso } from './lib/render.mjs';

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
    const key = a.slice(2);
    if (['iso', 'height', 'no-labels', 'no-checker', 'help'].includes(key)) { o[key] = true; continue; }
    const v = argv[++i];
    if (v === undefined) throw new Error(`missing value for ${a}`);
    o[key] = v;
  }
  return o;
}
const nums = (s, n, what) => {
  const r = String(s).split(',').map((t) => Number(t.trim()));
  if (r.length !== n || r.some((x) => !Number.isFinite(x))) throw new Error(`${what}: expected ${n} comma-separated numbers, got "${s}"`);
  return r.map(Math.floor);
};
const pointList = (s, n, what) => String(s).split(/[;\s]+/).filter(Boolean).map((p) => nums(p, n, what));

function readProps(file) {
  const props = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*)$/);
    if (m) props[m[1]] = m[2].trim();
  }
  return props;
}

async function saveAll({ host, port, password }) {
  const { Rcon } = await import('../bridge/rcon.mjs');
  const r = new Rcon({ host, port, password });
  const t0 = Date.now();
  await r.connect();
  try {
    const out = await r.command('save-all flush');
    console.log(`rcon ${host}:${port} save-all flush -> ${String(out).trim() || '(no output)'} (${Date.now() - t0} ms)`);
  } finally {
    r.close();
  }
  await new Promise((res) => setTimeout(res, 300));
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || (!o.rect && !o.probe && !o.column)) {
    const src = fs.readFileSync(new URL(import.meta.url), 'utf8');
    console.log(src.split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
    process.exit(o.help ? 0 : 1);
  }

  let serverProps = null;
  if (o['server-dir']) {
    const pf = path.join(o['server-dir'], 'server.properties');
    if (fs.existsSync(pf)) serverProps = readProps(pf);
  }
  const world = o.world ?? (o['server-dir'] ? path.join(o['server-dir'], serverProps?.['level-name'] || 'world') : null);
  const regionDir = o['region-dir'] ?? (world ? path.join(world, 'region') : null);
  if (!regionDir || !fs.existsSync(regionDir)) throw new Error(`region dir not found: ${regionDir} (use --world or --server-dir)`);

  // Flush the server's chunk cache to disk first if asked.
  if (o['rcon-port'] || o['server-dir']) {
    const port = Number(o['rcon-port'] ?? serverProps?.['rcon.port'] ?? 25575);
    const password = o['rcon-password'] ?? serverProps?.['rcon.password'];
    const enabled = o['rcon-port'] || serverProps?.['enable-rcon'] === 'true';
    if (enabled && password) {
      try {
        await saveAll({ host: o['rcon-host'] ?? '127.0.0.1', port, password });
      } catch (err) {
        console.warn(`warning: RCON save-all failed (${err.message}); rendering what is on disk`);
      }
    } else if (o['rcon-port']) {
      console.warn('warning: --rcon-port given but no password (use --rcon-password or --server-dir)');
    }
  }

  const w = new World(regionDir);

  if (o.probe) {
    for (const [x, y, z] of pointList(o.probe, 3, '--probe')) {
      w.loadRect(x, z, x, z);
      const id = w.getId(x, y, z);
      console.log(`${x} ${y} ${z}  ${id < 0 ? '(chunk not generated/unreadable)' : 'minecraft:' + w.info(id).key.replace(/^minecraft:/, '')}`);
    }
    return;
  }
  if (o.column) {
    const [x, z] = nums(o.column, 2, '--column');
    w.loadRect(x, z, x, z);
    const ch = w.chunkAt(x, z);
    if (!ch) { console.log('chunk not generated/unreadable'); return; }
    let prev = null, runStart = null;
    const flush = (yEnd) => { if (prev) console.log(`  y ${runStart === yEnd ? runStart : `${yEnd}..${runStart}`}  ${prev}`); };
    for (let y = (ch.maxSy + 1) * 16 - 1; y >= ch.minSy * 16; y--) {
      const id = chunkGet(ch, x & 15, y, z & 15);
      const k = id === 0 ? null : w.info(id).key.replace(/^minecraft:/, '');
      if (k !== prev) { flush(y + 1); prev = k; runStart = y; }
    }
    flush(ch.minSy * 16);
    return;
  }

  let [x1, z1, x2, z2] = nums(o.rect, 4, '--rect');
  [x1, x2] = [Math.min(x1, x2), Math.max(x1, x2)];
  [z1, z2] = [Math.min(z1, z2), Math.max(z1, z2)];
  const rect = { x1, z1, x2, z2 };
  const marks = o.mark ? pointList(o.mark, 2, '--mark') : [];
  const from = (o.from ?? 'se').toLowerCase();

  const t0 = Date.now();
  // iso faces at the rect edge look one block outside; load exactly the rect (outside = cut-away).
  w.loadRect(x1, z1, x2, z2);
  const tLoad = Date.now() - t0;

  let res, kind;
  if (o.iso) {
    res = renderIso(w, rect, {
      from, cube: o.cube != null ? Number(o.cube) : undefined, marks,
      ymin: o.ymin != null ? Number(o.ymin) : undefined, ymax: o.ymax != null ? Number(o.ymax) : undefined,
      checker: !o['no-checker'],
    });
    kind = `iso view from ${from}, y ${res.ymin}..${res.ymax}, cube ${res.cube}px, ${res.drawn} blocks drawn`;
  } else {
    res = renderTopDown(w, rect, {
      scale: Number(o.scale ?? 1), heightMode: !!o.height, marks, labels: !o['no-labels'],
      grid: o.grid ? Number(o.grid) : 0, gridOrigin: o['grid-origin'] ? nums(o['grid-origin'], 2, '--grid-origin') : [0, 0],
      ymax: o.ymax != null ? Number(o.ymax) : undefined,
      range: o.range ? nums(o.range, 2, '--range') : undefined,
    });
    kind = `top-down${o.height ? ' height map' : ''}, scale ${o.scale ?? 1}, surface y ${Math.round(res.hlo)}..${Math.round(res.hhi)}`;
  }

  const out = o.out ?? `map_${x1}_${z1}_${x2}_${z2}${o.iso ? `_iso_${from}` : o.height ? '_height' : ''}.png`;
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const png = res.img.toPNG();
  fs.writeFileSync(out, png);

  const st = w.stats;
  console.log(`wrote ${path.resolve(out)} (${res.img.w}x${res.img.h}, ${(png.length / 1024).toFixed(0)} KiB) — ${kind}`);
  console.log(`chunks: ${st.loaded} loaded, ${st.missing} not generated, ${st.failed} unreadable${st.notFull ? `, ${st.notFull} not fully generated` : ''}; ` +
    `${w.states.length} block states; load ${tLoad} ms, total ${Date.now() - t0} ms`);
  for (const f of st.failures.slice(0, 10)) console.log(`  skipped ${f}`);
  const unknown = [...new Set(w.states.filter((s) => s.unknown).map((s) => s.name))];
  if (unknown.length) console.log(`fallback colours for: ${unknown.join(', ')}`);
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
