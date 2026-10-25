// Ideas 2, 3, 4, 5 — what Claude's shell work means in the world. The hook classifies Bash commands
// itself (test / commit / push / pr) and sends only {kinds, ok}; nothing of the command line leaves it.
//   tests:   green sparkles and a rising chime when they pass; smoke and a grumpy "no" when they fail,
//            a red flag on the lamp post, and after three failures in a row a little rain cloud over the house.
//   commits: the district church bell rings once and "+1 commit" floats up from the house.
//   push:    a yellow PostAuto bus drives from the house to the district plaza (client-side interpolation).
//   pr:      a new canton banner is hoisted on the district plaza's flagpole.
import { fxTagsSnbt } from '../fx.mjs';

let popSeq = 0;
const flagTag = (plot) => `alps_flag_${plot.key.replace(',', '_')}`;
const ROT0 = 'left_rotation:[0f,0f,0f,1f],right_rotation:[0f,0f,0f,1f]';

/** The site's plot when the builder is working on a building (flags and clouds belong to buildings). */
const plotOf = (site) => (site && !site.obj ? site.plot : null);

/** Where the district's bell hangs: a finished church or clock tower of the district, else the plaza. */
function districtBell(ctx, districtKey) {
  let best = null;
  for (const p of Object.values(ctx.state.plots)) {
    if (p.district !== districtKey || !p.done || !['church', 'clocktower'].includes(p.type)) continue;
    const bell = ctx.meta(p).bells[0];
    if (bell) best = { x: p.x0 + bell.x + 0.5, y: p.y + bell.y, z: p.z0 + bell.z + 0.5 };
    if (p.type === 'church' && best) break;
  }
  if (best) return best;
  const plaza = ctx.plazaOf(ctx.district(districtKey));
  return plaza ? { x: plaza.x0 + 10.5, y: plaza.y + 4, z: plaza.z0 + 10.5 } : null;
}

/** A floating label that rises and shrinks away (one summon, one interpolated merge, one kill). */
function popText(ctx, s, text, color) {
  const tag = `alps_pop_${popSeq++ % 1000}`;
  const sel = `@e[type=minecraft:text_display,tag=${tag},limit=1]`;
  ctx.fx.push(`execute at ${ctx.builderSel(s)} run summon minecraft:text_display ~ ~2.7 ~ {${fxTagsSnbt(tag)},billboard:"center",shadow:1b,text:${ctx.textJson(text, color)},transformation:{${ROT0},translation:[0f,0f,0f],scale:[1.2f,1.2f,1.2f]}}`);
  // The client needs to have seen the start state before the interpolation target arrives.
  ctx.fx.later(150, `data merge entity ${sel} {start_interpolation:0,interpolation_duration:40,transformation:{${ROT0},translation:[0f,1.6f,0f],scale:[0.2f,0.2f,0.2f]}}`);
  ctx.fx.later(2400, `kill ${sel}`);
}

async function setFlag(ctx, plot, color) {
  const tag = flagTag(plot);
  const block = `minecraft:${color}_wool`;
  const out = await ctx.cmd(`data merge entity @e[type=minecraft:block_display,tag=${tag},limit=1] {block_state:{Name:"${block}"}}`);
  if (!out.includes('Modified')) {
    await ctx.cmd(`summon minecraft:block_display ${plot.x0 + 0.5} ${plot.y + 2.4} ${plot.z0 + 0.5} {Tags:["alps","alps_flag","${tag}"],block_state:{Name:"${block}"},transformation:{${ROT0},translation:[0.08f,0f,-0.03f],scale:[0.8f,0.5f,0.06f]}}`);
  }
}

const tests = {
  id: 'tests',
  group: 'claude',
  label: 'Tests: sparks and a rain cloud',
  description: 'Tests passed: green sparks and a chime; failed: smoke and a red flag on the lamp post; three failures in a row: a little rain cloud over the house.',
  presets: ['basic'],
  always: ['onFinish', 'onRetire'],
  onEvent(ctx, s, ev) {
    if (!ev.kinds.includes('test') || (ev.kind !== 'PostToolUse' && ev.kind !== 'PostToolUseFailure')) return;
    const site = ctx.siteOf(s.job);
    const ok = ev.kind === 'PostToolUse' && ev.ok;
    const sel = ctx.builderSel(s);
    const plot = plotOf(site);
    const r = ctx.rt(s);
    if (ok) {
      [0.8, 1.0, 1.26].forEach((p, i) => ctx.fx.later(i * 160, `execute at ${sel} run playsound minecraft:block.note_block.chime player @a ~ ~ ~ 1 ${p}`));
      ctx.fx.push(`execute at ${sel} run particle minecraft:happy_villager ~ ~1.2 ~ 0.7 0.7 0.7 0 25`);
      r.cloudUntil = 0;
    } else {
      ctx.fx.push([`execute at ${sel} run particle minecraft:large_smoke ~ ~1.5 ~ 0.4 0.4 0.4 0.01 12`, `execute at ${sel} run playsound minecraft:entity.villager.no player @a ~ ~ ~ 1 1`]);
      if ((s.testFailStreak ?? 0) >= 3 && plot) r.cloudUntil = Date.now() + 90000;
    }
    if (plot) ctx.fx.push(() => setFlag(ctx, plot, ok ? 'lime' : 'red'), { key: `flag:${plot.key}`, cost: 2 });
  },
  onWork(ctx, s, site) {
    const r = ctx.rt(s);
    const plot = plotOf(site);
    if (!plot || !(r.cloudUntil > Date.now()) || Date.now() < (r.cloudNext ?? 0)) return;
    r.cloudNext = Date.now() + 1000;
    const meta = ctx.meta(plot);
    const x = plot.x0 + (meta.struct.x1 + meta.struct.x2) / 2 + 0.5;
    const z = plot.z0 + (meta.struct.z1 + meta.struct.z2) / 2 + 0.5;
    const y = plot.y + Math.min(meta.struct.ymax, 30) + 4;
    ctx.fx.push([`particle minecraft:cloud ${x} ${y} ${z} 1.6 0.25 1.6 0 14`, `particle minecraft:falling_water ${x} ${y - 0.4} ${z} 1.4 0.1 1.4 0 16`], { key: `cloud:${s.id}` });
  },
  async onFinish(ctx, s, plot) {
    ctx.rt(s).cloudUntil = 0;
    await ctx.cmd(`kill @e[type=minecraft:block_display,tag=${flagTag(plot)}]`);
  },
  async onRetire(ctx, s, plot) {
    ctx.rt(s).cloudUntil = 0;
    if (plot) await ctx.cmd(`kill @e[type=minecraft:block_display,tag=${flagTag(plot)}]`);
  },
  async onDisable(ctx) {
    for (const s of ctx.sessions()) ctx.rt(s).cloudUntil = 0;
    await ctx.cmd('kill @e[type=minecraft:block_display,tag=alps_flag]');
  },
};

const commits = {
  id: 'commits',
  group: 'claude',
  label: 'Commit = church bell',
  description: 'A successful git commit: one strike of the district church bell (or on the square) and a "+1 commit" fading above the builder.',
  presets: ['basic'],
  onEvent(ctx, s, ev) {
    if (ev.kind !== 'PostToolUse' || !ev.ok || !ev.kinds.includes('commit')) return;
    const bell = districtBell(ctx, s.districtKey);
    if (bell) ctx.fx.push(`playsound minecraft:block.bell.use block @a ${bell.x} ${bell.y} ${bell.z} 3 1`);
    popText(ctx, s, '+1 commit', 'gold');
  },
};

// --- PostAuto: drives along the street grid (plot boundaries), so it never cuts through houses.

function busRoute(ctx, from, to) {
  const { city } = ctx.state;
  const P = ctx.PLOT;
  const lineX = (i) => city.cx - 10 + i * P; // street centre lines between plot columns
  const lineZ = (j) => city.cz - 10 + j * P;
  const yAt = (x, z) => {
    let best = null;
    for (const p of Object.values(ctx.state.plots)) {
      const d = Math.hypot(p.x0 + 10 - x, p.z0 + 10 - z);
      if (!best || d < best.d) best = { d, y: p.y };
    }
    return (best?.y ?? city.baseY) + 1;
  };
  // Up or down the street column beside the house, then along the street row bordering the plaza,
  // stopping on the street at the plaza's middle. Every leg runs on plot boundaries.
  const [fi, fj] = from.cell;
  const [ti, tj] = to.cell;
  const sx = lineX(fi + (ti > fi ? 1 : 0));
  const sz = lineZ(fj + 0.5);
  const rowZ = lineZ(tj + (tj > fj ? 0 : 1));
  const ex = lineX(ti + 0.5);
  const pts = [[sx, sz]];
  const stepZ = Math.sign(rowZ - sz) * P;
  for (let z = sz + stepZ; stepZ && Math.sign(rowZ - z) === Math.sign(stepZ); z += stepZ) pts.push([sx, z]);
  pts.push([sx, rowZ]);
  const stepX = Math.sign(ex - sx) * P;
  for (let x = sx + stepX; stepX && Math.sign(ex - x) === Math.sign(stepX); x += stepX) pts.push([x, rowZ]);
  pts.push([ex, rowZ]);
  return pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]).map(([x, z]) => [x, yAt(x, z), z]);
}

let busSeq = 0;
const push = {
  id: 'push',
  group: 'claude',
  label: 'Push = PostAuto',
  description: 'git push: the yellow PostAuto bus drives through the streets from the house to the district square, with its three-tone horn.',
  presets: [],
  onEvent(ctx, s, ev) {
    if (ev.kind !== 'PostToolUse' || !ev.ok || !ev.kinds.includes('push')) return;
    const r = ctx.rt(s);
    if (Date.now() < (r.busUntil ?? 0)) return; // one bus at a time per chat
    const site = ctx.siteOf(s.job);
    const from = site?.plot ?? ctx.sessionPlot(s);
    const to = ctx.plazaOf(ctx.district(s.districtKey)) ?? ctx.square();
    if (!from || !to || from.key === to.key) return;
    const pts = busRoute(ctx, from, to);
    const tag = `alps_bus_${busSeq++ % 100}`;
    const [x0, y0, z0] = pts[0];
    const horn = (at, [x, y, z]) => [0.84, 1.0, 1.26].forEach((p, i) => ctx.fx.later(at + i * 250, `playsound minecraft:block.note_block.flute neutral @a ${x} ${y} ${z} 2 ${p}`));
    const body = (block, t, sc) => `summon minecraft:block_display ${x0} ${y0} ${z0} {${fxTagsSnbt(tag)},teleport_duration:59,block_state:{Name:"minecraft:${block}"},transformation:{${ROT0},translation:${t},scale:${sc}}}`;
    ctx.fx.push([
      body('yellow_concrete', '[-0.7f,0.15f,-1.5f]', '[1.4f,1.2f,3f]'),
      body('black_stained_glass', '[-0.72f,0.75f,-1.3f]', '[1.44f,0.38f,2.4f]'),
      body('gray_concrete', '[-0.6f,0f,-1.2f]', '[1.2f,0.2f,2.4f]'),
    ]);
    horn(0, pts[0]);
    let t = 300;
    for (let i = 1; i < pts.length; i++) {
      const [x, y, z] = pts[i];
      const [px, , pz] = pts[i - 1];
      const yaw = Math.round((Math.atan2(-(x - px), z - pz) * 180) / Math.PI);
      const dist = Math.hypot(x - px, z - pz);
      const ticks = Math.min(59, Math.max(8, Math.round((dist / 9) * 20)));
      ctx.fx.later(t, [`data merge entity @e[tag=${tag},limit=3] {teleport_duration:${ticks}}`, `tp @e[tag=${tag}] ${x} ${y} ${z} ${yaw} 0`], { cost: 2 });
      t += ticks * 50 + 100;
    }
    horn(t, pts[pts.length - 1]);
    ctx.fx.later(t + 1200, [`execute at @e[tag=${tag},limit=1] run particle minecraft:poof ~ ~1 ~ 1 0.5 1 0.02 20`, `kill @e[tag=${tag}]`]);
    r.busUntil = Date.now() + t + 1500;
  },
};

// Canton banners (simplified): base colour + patterns.
const CANTONS = [
  ['white', [['diagonal_right', 'blue']]], // Zürich
  ['red', [['stripe_downright', 'yellow']]], // Bern
  ['white', [['half_horizontal', 'blue']]], // Luzern
  ['red', [['square_top_left', 'white']]], // Schwyz
  ['white', [['half_horizontal', 'red']]], // Solothurn
  ['white', [['stripe_middle', 'blue']]], // Zug
  ['red', [['half_vertical_right', 'blue']]], // Ticino
  ['yellow', [['half_vertical_right', 'red']]], // Genève
  ['white', [['half_vertical_right', 'red']]], // Valais
  ['white', [['stripe_center', 'black']]], // Basel
  ['red', [['straight_cross', 'white'], ['border', 'red']]], // Schweiz
];
const patternsSnbt = (pats) => `[${pats.map(([p, c]) => `{pattern:"minecraft:${p}",color:"${c}"}`).join(',')}]`;

const pr = {
  id: 'pr',
  group: 'claude',
  label: 'PR = canton flag',
  description: 'gh pr create: a new canton\'s flag is raised on the flagpole of the district square.',
  presets: ['basic'],
  onEvent(ctx, s, ev) {
    if (ev.kind !== 'PostToolUse' || !ev.ok || !ev.kinds.includes('pr')) return;
    const district = ctx.district(s.districtKey);
    const plaza = ctx.plazaOf(district);
    if (!plaza) return;
    const banner = ctx.meta(plaza).banners.find((b) => !b.wall) ?? ctx.meta(plaza).banners[0];
    if (!banner) return;
    district.prFlags = (district.prFlags ?? 0) + 1;
    const [base, pats] = CANTONS[district.prFlags % CANTONS.length];
    const x = plaza.x0 + banner.x;
    const y = plaza.y + banner.y;
    const z = plaza.z0 + banner.z;
    const tag = `alps_prflag_${district.index}`;
    const rot = banner.block.match(/rotation=(\d+)/)?.[1] ?? '0';
    const facing = banner.block.match(/facing=([a-z]+)/)?.[1];
    const block = banner.wall ? `minecraft:${base}_wall_banner[facing=${facing ?? 'north'}]` : `minecraft:${base}_banner[rotation=${rot}]`;
    // The flag climbs the pole as a display item, then becomes the real banner at the top.
    ctx.fx.push(async (cmd) => {
      await ctx.holdArea(`prflag:${district.key}`, { x1: x, z1: z, x2: x, z2: z }, 6000);
      await cmd(`summon minecraft:item_display ${x + 0.5} ${y - 5} ${z + 0.5} {${fxTagsSnbt(tag)},item:{id:"minecraft:${base}_banner",count:1,components:{"minecraft:banner_patterns":${patternsSnbt(pats)}}},transformation:{${ROT0},translation:[0f,0f,0f],scale:[1f,1f,1f]}}`);
    }, { cost: 3 });
    ctx.fx.later(150, `data merge entity @e[tag=${tag},limit=1] {start_interpolation:0,interpolation_duration:50,transformation:{${ROT0},translation:[0f,4.6f,0f],scale:[1f,1f,1f]}}`);
    ctx.fx.later(2800, [`setblock ${x} ${y} ${z} ${block}{patterns:${patternsSnbt(pats)}}`, `kill @e[tag=${tag}]`, `playsound minecraft:entity.firework_rocket.twinkle ambient @a ${x} ${y} ${z} 2 1`]);
    popText(ctx, s, '+1 PR', 'aqua');
  },
};

export default [tests, commits, push, pr];
