// Landscape motion for "Life of the city": a cable car up to the nearest peak, a little red train looping
// through the districts' streets, paragliders gliding down from the peaks, a lake steamer between the
// harbour and the piers (anchors from the terrain agent: state.terrain.anchors, bridge/infra.mjs).
//
// Everything is display entities moved with `tp` + `teleport_duration`: the client interpolates the motion,
// the server sends one command per vehicle every ~2–3 s, and only while somebody is online. The track,
// cable and route are measured once (heightmap probes, one per tick) and kept in state.life.
import { t } from '../i18n.mjs';
import { fxTagsSnbt } from '../fx.mjs';
import { lifeState } from './citylife.mjs';

const ROT0 = '[0f,0f,0f,1f]';
const f2 = (n) => `${Number(n).toFixed(3)}f`;
const r2 = (n) => Number(n).toFixed(2);
const yawOf = (dx, dz) => Math.round((Math.atan2(-dx, dz) * 180) / Math.PI);
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
const lerp = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

/** Quaternion [x, y, z, w] rotating +z onto the unit vector d (shortest arc). */
function quatZTo([dx, dy, dz]) {
  const dot = dz;
  if (dot > 0.99999) return [0, 0, 0, 1];
  if (dot < -0.99999) return [0, 1, 0, 0];
  const [ax, ay, az] = [-dy, dx, 0]; // z × d
  const s = Math.sqrt((1 + dot) * 2);
  return [ax / s, ay / s, az / s, s / 2];
}
function rotate([x, y, z, w], [vx, vy, vz]) {
  const ix = w * vx + y * vz - z * vy;
  const iy = w * vy + z * vx - x * vz;
  const iz = w * vz + x * vy - y * vx;
  const iw = -x * vx - y * vy - z * vz;
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}

/** A thin straight bar from a to b (block_display at a, rotated and stretched in its transformation). */
function barSummon(a, b, block, w, tags) {
  const len = dist(a, b);
  const d = [(b[0] - a[0]) / len, (b[1] - a[1]) / len, (b[2] - a[2]) / len];
  const q = quatZTo(d);
  const tr = rotate(q, [-w / 2, -w / 2, 0]);
  return `summon minecraft:block_display ${r2(a[0])} ${r2(a[1])} ${r2(a[2])} {Tags:${tags},view_range:3f,block_state:{Name:"minecraft:${block}"},transformation:{left_rotation:[${q.map(f2).join(',')}],right_rotation:${ROT0},translation:[${tr.map(f2).join(',')}],scale:[${f2(w)},${f2(w)},${f2(len)}]}}`;
}
/** A box display (block scaled to sx·sy·sz, offset t, in the entity's own yaw frame). */
const box = (at, block, [tx, ty, tz], [sx, sy, sz], tags, extra = '') =>
  `summon minecraft:block_display ${r2(at[0])} ${r2(at[1])} ${r2(at[2])} {Tags:${tags},view_range:3f${extra},block_state:{Name:"minecraft:${block}"},transformation:{left_rotation:${ROT0},right_rotation:${ROT0},translation:[${f2(tx)},${f2(ty)},${f2(tz)}],scale:[${f2(sx)},${f2(sy)},${f2(sz)}]}}`;
const tagList = (...tags) => `[${['alps_life', ...tags].map((x) => `"${x}"`).join(',')}]`;

const online = (ctx) => ctx.players().length > 0;

/** Summons a vehicle's pieces once the chunk at `at` is held (summoning into an unloaded chunk loses them). */
function summonHeld(ctx, owner, at, cmds) {
  const [x, , z] = at.map(Math.floor);
  ctx.fx.push(async () => {
    await ctx.holdArea(owner, { x1: x - 2, z1: z - 2, x2: x + 2, z2: z + 2 }, 6000);
    ctx.fx.later(2000, cmds, { cost: cmds.length });
  }, { cost: 2 });
}
function cityRadius(ctx) {
  const { city } = ctx.state;
  let r = 30;
  for (const p of Object.values(ctx.state.plots)) r = Math.max(r, Math.hypot(p.x0 + 10 - city.cx, p.z0 + 10 - city.cz) + 15);
  return r;
}

/** Remembers where entities of a system stand, so switching it off can fetch them from unloaded chunks. */
function forget(ctx, rec, tag) {
  const L = lifeState(ctx);
  for (const at of rec?.anchors ?? []) L.cleanup.push({ at, tags: [tag] });
  ctx.save();
}

// ------------------------------------------------------------------ heightmap probes (one per tick)

class Probes {
  constructor(owner) {
    this.owner = owner;
    this.queue = [];
    this.out = [];
    this.phase = 0;
    this.tries = 0;
  }

  start(points) {
    this.queue = points.map(([x, z]) => [Math.round(x), Math.round(z)]);
    this.out = [];
    this.phase = 0;
  }

  get done() {
    return !this.queue.length;
  }

  /** One step: hold the column's chunk, then read the surface height and whether it is water. */
  async step(ctx) {
    const next = this.queue[0];
    if (!next) return;
    const [x, z] = next;
    if (this.phase === 0) {
      await ctx.holdOwner(this.owner, { x1: x, z1: z, x2: x, z2: z });
      this.phase = 1;
      this.tries = 0;
      return;
    }
    const out = await ctx.cmd(`execute positioned ${x} 0 ${z} positioned over motion_blocking_no_leaves run summon minecraft:marker ~ ~ ~ {Tags:["alps","alps_fx","alps_lifeprobe"]}`);
    if (!out.includes('Summoned') && ++this.tries < 40) return;
    const pos = (await ctx.cmd('data get entity @e[tag=alps_lifeprobe,limit=1] Pos')).match(/\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/);
    await ctx.cmd('kill @e[tag=alps_lifeprobe]');
    const y = pos ? Math.floor(Number(pos[2])) : null;
    const water = y != null && (await ctx.cmd(`execute if block ${x} ${y - 1} ${z} minecraft:water`)).includes('passed');
    this.out.push({ x, z, y, water });
    this.queue.shift();
    this.phase = 0;
    ctx.releaseLater(this.owner, 300);
  }
}

// ------------------------------------------------------------------ cable car

const CABLE_V = 1;
const cableProbes = new Probes('life:cableprobe');
let gondola = { s: 0, dir: 1, wait: 0, next: 0 };

/** Upper convex hull of points (s, h): the cable line that stays above every sampled clearance. */
function upperHull(pts) {
  const hull = [];
  for (const p of pts) {
    while (hull.length >= 2) {
      const [a, b] = hull.slice(-2);
      if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0) hull.pop();
      else break;
    }
    hull.push(p);
  }
  return hull;
}

function planCable(ctx) {
  const { city } = ctx.state;
  const peak = city.peaks?.[0];
  if (!peak) return null;
  const R = cityRadius(ctx);
  const [dx, dz] = [peak.x - city.cx, peak.z - city.cz];
  const len = Math.hypot(dx, dz);
  if (len < R + 40) return null; // the peak is (nearly) inside the town: nothing to ride up
  const [ux, uz] = [dx / len, dz / len];
  const base = [city.cx + ux * (R + 4), city.cz + uz * (R + 4)];
  const top = [peak.x - ux * 5, peak.z - uz * 5];
  const span = Math.hypot(top[0] - base[0], top[1] - base[1]);
  const n = Math.max(6, Math.min(24, Math.round(span / 12)));
  const points = [];
  for (let k = 0; k <= n; k++) points.push(lerp(base, top, k / n));
  return { v: CABLE_V, R, peak: [peak.x, peak.y, peak.z], base, top, u: [ux, uz], span, points, status: 'survey' };
}

function cableGeometry(plan, samples) {
  const ground = samples.map((s) => s.y ?? plan.peak[1]);
  const hB = ground[0] + 7;
  const hT = ground[ground.length - 1] + 5;
  const pts = samples.map((s, k) => [(k / (samples.length - 1)) * plan.span, k === 0 ? hB : k === samples.length - 1 ? hT : ground[k] + 9]);
  const hull = upperHull(pts);
  const at = (sv, h) => {
    const k = sv / plan.span;
    return [plan.base[0] + (plan.top[0] - plan.base[0]) * k, h, plan.base[1] + (plan.top[1] - plan.base[1]) * k];
  };
  const path = hull.map(([sv, h]) => at(sv, h));
  const pylons = hull.slice(1, -1).map(([sv, h], i) => ({ top: at(sv, h), ground: ground[Math.round((sv / plan.span) * (samples.length - 1))] ?? h - 9, i }));
  return { path, pylons, groundB: ground[0], groundT: ground[ground.length - 1] };
}

function cableSummons(plan) {
  const g = plan.geo;
  const tags = tagList('alps_cable');
  const cmds = [];
  const anchors = [];
  const yaw = yawOf(plan.u[0], plan.u[1]);
  // Stations: two posts and a red roof over the bullwheel, at both ends.
  for (const [end, gy] of [[g.path[0], g.groundB], [g.path[g.path.length - 1], g.groundT]]) {
    const at = [end[0], gy, end[2]];
    anchors.push(at);
    const h = end[1] - gy + 1.2;
    const rot = `,Rotation:[${yaw}f,0f]`;
    cmds.push(box(at, 'spruce_log', [-1.6, 0, -0.2], [0.4, h, 0.4], tags, rot));
    cmds.push(box(at, 'spruce_log', [1.2, 0, -0.2], [0.4, h, 0.4], tags, rot));
    cmds.push(box(at, 'red_concrete', [-2.2, h, -2.2], [4.4, 0.35, 4.4], tags, rot));
    cmds.push(box(at, 'smooth_stone', [-2.0, 0, -2.0], [4.0, 0.3, 4.0], tags, rot));
  }
  // Pylons: a steel mast with a cross arm.
  for (const p of g.pylons) {
    const at = [p.top[0], p.ground, p.top[2]];
    anchors.push(at);
    const h = p.top[1] - p.ground + 0.4;
    cmds.push(box(at, 'light_gray_concrete', [-0.3, 0, -0.3], [0.6, h, 0.6], tags, `,Rotation:[${yaw}f,0f]`));
    cmds.push(box(at, 'gray_concrete', [-1.4, h - 0.4, -0.2], [2.8, 0.3, 0.4], tags, `,Rotation:[${yaw}f,0f]`));
  }
  // Cable: pieces of at most 40 blocks (an entity is only sent to players near its own position).
  for (let i = 0; i + 1 < g.path.length; i++) {
    const [a, b] = [g.path[i], g.path[i + 1]];
    const pieces = Math.max(1, Math.ceil(dist(a, b) / 40));
    for (let k = 0; k < pieces; k++) {
      const p = lerp(a, b, k / pieces);
      const q = lerp(a, b, (k + 1) / pieces);
      anchors.push(p);
      cmds.push(barSummon(p, q, 'black_concrete', 0.09, tags));
    }
  }
  // The gondola (hanger, red cabin, window band, white roof), starting at the valley station.
  const s0 = g.path[0];
  const gtags = tagList('alps_cable', 'alps_cable_g');
  const at = [s0[0], s0[1], s0[2]];
  const extra = `,teleport_duration:59,Rotation:[${yaw}f,0f]`;
  cmds.push(box(at, 'gray_concrete', [-0.06, -1.3, -0.06], [0.12, 1.3, 0.12], gtags, extra));
  cmds.push(box(at, 'red_concrete', [-0.9, -3.0, -1.2], [1.8, 1.7, 2.4], gtags, extra));
  cmds.push(box(at, 'light_blue_stained_glass', [-0.93, -2.3, -1.23], [1.86, 0.6, 2.46], gtags, extra));
  cmds.push(box(at, 'white_concrete', [-0.95, -1.35, -1.25], [1.9, 0.12, 2.5], gtags, extra));
  return { cmds, anchors };
}

/** Position along the cable polyline at arc length s; also the distance to the next vertex ahead. */
function alongPath(path, s, dir) {
  let acc = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const L = dist(path[i], path[i + 1]);
    // Moving forward, a point on a vertex belongs to the segment after it; moving back, to the one before.
    const inside = dir > 0 ? s < acc + L - 1e-6 : s <= acc + L + 1e-6;
    if (inside || i + 2 === path.length) {
      const k = Math.max(0, Math.min(1, (s - acc) / L));
      const ahead = dir > 0 ? acc + L - s : s - acc;
      return { at: lerp(path[i], path[i + 1], k), ahead: Math.max(0, ahead) };
    }
    acc += L;
  }
  return { at: path[path.length - 1], ahead: 0 };
}
const pathLength = (path) => path.slice(1).reduce((n, p, i) => n + dist(path[i], p), 0);

const cableCar = {
  id: 'cableCar',
  group: 'life',
  label: 'Cable car',
  description: 'A red gondola runs on a cable from the edge of town up to the nearest peak, over pylons where the slope needs them. Moves only while somebody is in the game.',
  presets: [],
  setup(ctx) {
    ctx.needPeaks();
    gondola = { s: 0, dir: 1, wait: 0, next: 0, restore: true }; // where it stopped is in state (plan.pos)
  },
  onEnable(ctx) {
    ctx.needPeaks();
  },
  async onTick(ctx, now) {
    const L = lifeState(ctx);
    let plan = L.cable;
    if (!ctx.state.city || ctx.state.city.pending) return;
    // (Re)plan: first time, a new version, or the town grew towards the valley station.
    if (!plan || plan.v !== CABLE_V || (plan.status === 'built' && cityRadius(ctx) > plan.R + 10)) {
      if (now < (cableCar.planAt ?? 0)) return;
      cableCar.planAt = now + 60000;
      if (plan?.status === 'built') {
        await ctx.cmd('kill @e[tag=alps_cable]');
        forget(ctx, plan, 'alps_cable');
      }
      plan = L.cable = planCable(ctx);
      if (plan) cableProbes.start(plan.points);
      ctx.save();
      return;
    }
    if (plan.status === 'survey') {
      if (cableProbes.done && !cableProbes.out.length) cableProbes.start(plan.points); // after a restart
      await cableProbes.step(ctx);
      if (!cableProbes.done) return;
      plan.geo = cableGeometry(plan, cableProbes.out);
      plan.status = 'summon';
      ctx.save();
      ctx.log(`Cable car: ${Math.round(plan.span)} m to ${plan.peak.join(',')}, ${plan.geo.pylons.length} pylons`);
      return;
    }
    if (plan.status === 'summon') {
      const { cmds, anchors } = cableSummons(plan);
      plan.anchors = anchors;
      plan.status = 'built';
      ctx.save();
      // Each piece where its chunk is: hold, then summon (spread over the effect budget).
      cmds.forEach((c, i) => {
        const m = c.match(/^summon \S+ (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/);
        const [x, z] = [Number(m[1]), Number(m[3])];
        ctx.fx.later(i * 300, async (cmd) => {
          await ctx.holdArea(`life:cable:${i}`, { x1: x - 1, z1: z - 1, x2: x + 1, z2: z + 1 }, 4000);
          ctx.fx.later(1500, c);
        }, { cost: 2 });
      });
      gondola = { s: 0, dir: 1, wait: now + 20000, next: 0 };
      return;
    }
    if (plan.status !== 'built' || !online(ctx) || now < gondola.next) return;
    const path = plan.geo.path;
    const total = pathLength(path);
    if (gondola.restore) Object.assign(gondola, plan.pos ?? {}, { restore: false });
    if (now < gondola.wait) return;
    const { ahead } = alongPath(path, gondola.s, gondola.dir);
    const step = Math.min(15, ahead, gondola.dir > 0 ? total - gondola.s : gondola.s);
    gondola.s += gondola.dir * step;
    const { at } = alongPath(path, gondola.s, gondola.dir);
    gondola.next = now + 2950;
    plan.pos = { s: gondola.s, dir: gondola.dir };
    ctx.fx.push(`tp @e[type=minecraft:block_display,tag=alps_cable_g] ${r2(at[0])} ${r2(at[1])} ${r2(at[2])}`, { key: 'cable:gondola' });
    if (gondola.s <= 0.01 || gondola.s >= total - 0.01) {
      gondola.dir = -gondola.dir;
      gondola.wait = now + 15000; // doors open at the station
      ctx.fx.later(2900, `execute at @e[type=minecraft:block_display,tag=alps_cable_g,limit=1] run playsound minecraft:block.note_block.bell ambient @a ~ ~ ~ 1.5 0.8`);
    }
  },
  async onDisable(ctx) {
    const L = lifeState(ctx);
    await ctx.cmd('kill @e[tag=alps_cable]');
    if (L.cable?.status === 'built') forget(ctx, L.cable, 'alps_cable');
    delete L.cable;
    ctx.save();
  },
};

// ------------------------------------------------------------------ train

const TRAIN_V = 1;
const CARS = [
  { off: 0, body: 'red_concrete', len: 4.6, roof: 'light_gray_concrete', loco: true },
  { off: 5.0, body: 'red_concrete', len: 4.2, roof: 'white_concrete' },
  { off: 9.6, body: 'red_concrete', len: 4.2, roof: 'white_concrete' },
];
let train = { s: 0, next: 0, wait: 0 };

/** The loop: district plazas (and the main square) joined by the shortest street paths between them. */
function planTrain(ctx) {
  const { city } = ctx.state;
  const P = ctx.PLOT;
  const cells = new Map(Object.values(ctx.state.plots).map((p) => [p.key, p]));
  const plotAt = (i, j) => cells.get(`${i},${j}`);
  // Grid lines between plots; the track runs beside the line, in the street ring of the plot north / west
  // of it when there is one (clear of the lamp posts at plots' north-west corners), else of the other one.
  const X = (k) => city.cx - 10 + k * P;
  const Z = (l) => city.cz - 10 + l * P;
  const NEAR = -0.7;
  const FAR = 1.55;
  const side = ([k1, l1], [k2, l2]) => (l1 === l2 ? (plotAt(Math.min(k1, k2), l1 - 1) ? NEAR : FAR) : plotAt(k1 - 1, Math.min(l1, l2)) ? NEAR : FAR);
  /** World polyline of a closed node loop, every corner where the offset lines of its two edges meet. */
  const polyline = (ns, stopNodes) => {
    const out = [];
    const stopPts = [];
    const n = ns.length - 1; // ns[n] === ns[0]
    for (let i = 0; i < n; i++) {
      const [pin, here, nxt] = [ns[(i - 1 + n) % n], ns[i], ns[i + 1]];
      const y = nodeY(here[0], here[1]);
      const hIn = pin[1] === here[1];
      const hOut = here[1] === nxt[1];
      const [oIn, oOut] = [side(pin, here), side(here, nxt)];
      if (stopNodes.includes(i)) stopPts.push(out.length);
      if (hIn !== hOut) {
        const dz = hIn ? oIn : oOut;
        const dx = hIn ? oOut : oIn;
        out.push([X(here[0]) + dx, y, Z(here[1]) + dz]);
      } else if (hIn) {
        out.push([X(here[0]), y, Z(here[1]) + oIn]);
        if (oIn !== oOut) out.push([X(here[0]), y, Z(here[1]) + oOut]);
      } else {
        out.push([X(here[0]) + oIn, y, Z(here[1])]);
        if (oIn !== oOut) out.push([X(here[0]) + oOut, y, Z(here[1])]);
      }
    }
    // Straight runs need no vertex in every junction (fewer, longer hops).
    const keep = out.map((p, i) => {
      if (stopPts.includes(i) || i === 0) return true;
      const [a, b] = [out[i - 1], out[(i + 1) % out.length]];
      const line = (a[0] === p[0] && p[0] === b[0]) || (a[2] === p[2] && p[2] === b[2]);
      return !line || a[1] !== p[1] || b[1] !== p[1];
    });
    const path = out.filter((_, i) => keep[i]);
    const stops = stopPts.map((i) => keep.slice(0, i).filter(Boolean).length);
    path.push([...path[0]]);
    return { path, stops };
  };
  // Junctions: the plots around a grid corner. The train only uses gentle ones (heights within two blocks,
  // a rack-railway gradient): terraced streets with retaining walls and stair lanes are for walking.
  const around = (k, l) => [plotAt(k - 1, l - 1), plotAt(k, l - 1), plotAt(k - 1, l), plotAt(k, l)].filter(Boolean);
  const nodeY = (k, l) => Math.max(...around(k, l).map((p) => p.y)) + 1;
  const flat = (k, l) => {
    const ys = around(k, l).map((p) => p.y);
    return ys.length > 0 && Math.max(...ys) - Math.min(...ys) <= 2;
  };
  const nbrs = (k, l) => {
    const out = [];
    // A street runs along a grid line where a plot lies on at least one side of it.
    if (plotAt(k, l - 1) || plotAt(k, l)) out.push([k + 1, l]);
    if (plotAt(k - 1, l - 1) || plotAt(k - 1, l)) out.push([k - 1, l]);
    if (plotAt(k - 1, l) || plotAt(k, l)) out.push([k, l + 1]);
    if (plotAt(k - 1, l - 1) || plotAt(k, l - 1)) out.push([k, l - 1]);
    return flat(k, l) ? out.filter(([a, b]) => flat(a, b)).map(([a, b]) => [a, b, nodeY(a, b)]) : [];
  };
  // A stop is any corner of the plaza's cell in the street grid.
  const corners = (p) => [[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, b]) => [p.cell[0] + a, p.cell[1] + b]);
  const key = (n) => `${n[0]},${n[1]}`;
  // The stops the same street network reaches (a district joined to the town only diagonally, or up a
  // terrace, has no road for the train): the network with the most plazas, the main square's if tied.
  const all = [ctx.square(), ...Object.values(ctx.state.districts).map((d) => ctx.plazaOf(d))].filter((p) => p?.done);
  const reachOf = (p) => {
    const reach = new Set(corners(p).map(key));
    const todo = corners(p);
    while (todo.length && reach.size < 4000) for (const m of nbrs(...todo.shift())) if (!reach.has(key(m))) reach.add(key(m)) && todo.push(m);
    return reach;
  };
  // Candidate networks, the one with the most plazas first.
  const nets = [];
  for (const p of all) {
    const reach = reachOf(p);
    const here = all.filter((q) => corners(q).some((c) => reach.has(key(c)) && nbrs(...c).length));
    if (here.length && !nets.some((n) => n.includes(here[0]))) nets.push(here);
  }
  nets.sort((a, b) => b.length - a.length);
  /** Shortest street path from any of `froms` to any of `tos` (nodes [k, l, y of the edge into it]). */
  const bfs = (froms, tos) => {
    const goal = new Set(tos.map(key));
    const prev = new Map(froms.map((n) => [key(n), null]));
    const q = [...froms];
    let end = null;
    while (q.length && !end) {
      const n = q.shift();
      if (goal.has(key(n))) end = n;
      else if (prev.size > 4000) return null;
      else for (const m of nbrs(n[0], n[1])) {
        if (prev.has(key(m))) continue;
        prev.set(key(m), [n, m[2]]);
        q.push(m);
      }
    }
    if (!end) return null;
    const out = [];
    for (let n = end; n; n = prev.get(key(n))?.[0]) out.unshift([n[0], n[1], prev.get(key(n))?.[1] ?? null]);
    return out;
  };
  /** One stop: the little train circles its block (when the streets on all four sides are there). */
  const ring = (stop) => {
    const [a, b, c, d] = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, z]) => [stop.cell[0] + x, stop.cell[1] + z]);
    const has = (p, q) => nbrs(...p).some((m) => m[0] === q[0] && m[1] === q[1]);
    if (!(has(a, b) && has(b, c) && has(c, d) && has(d, a))) return null;
    const { path, stops: at } = polyline([a, b, c, d, a], [0]);
    return { v: TRAIN_V, key: `${stop.key}:ring:${Object.keys(ctx.state.plots).length}`, path, stops: at, total: pathLength(path) };
  };
  const loop = (stops) => {
    stops.sort((a, b) => Math.atan2(a.cell[1], a.cell[0]) - Math.atan2(b.cell[1], b.cell[0]));
    const nodes = [];
    const stopAt = [];
    let from = corners(stops[0]);
    for (let i = 0; i < stops.length; i++) {
      const last = i === stops.length - 1;
      const seg = bfs(from, last ? [nodes[0]] : corners(stops[i + 1]));
      if (!seg) return null;
      stopAt.push(nodes.length ? nodes.length - 1 : 0);
      nodes.push(...(nodes.length ? seg.slice(1) : seg));
      from = [seg[seg.length - 1]];
    }
    const { path, stops: stopIdx } = polyline(nodes, stopAt);
    if (path.length < 4) return null;
    return { v: TRAIN_V, key: stops.map((p) => p.key).join('|') + `:${Object.keys(ctx.state.plots).length}`, path, stops: stopIdx, total: pathLength(path) };
  };
  for (const net of nets) {
    const plan = net.length > 1 ? loop(net) : ring(net[0]);
    if (plan) return plan;
  }
  return null;
}

/** Arc lengths of the path's vertices. */
const vertexS = (path) => path.reduce((acc, p, i) => (i ? [...acc, acc[i - 1] + dist(path[i - 1], p)] : [0]), []);

function carAt(plan, s) {
  const total = plan.total;
  const S = ((s % total) + total) % total;
  const vs = (plan.vs ??= vertexS(plan.path));
  let i = vs.findIndex((v, k) => k + 1 < vs.length && S >= v && S < vs[k + 1]); // on a vertex: the segment after it
  if (i < 0) i = vs.length - 2;
  const a = plan.path[i];
  const b = plan.path[i + 1];
  const L = vs[i + 1] - vs[i] || 1;
  const at = lerp(a, b, (S - vs[i]) / L);
  return { at, yaw: yawOf(b[0] - a[0], b[2] - a[2]), ahead: vs[i + 1] - S };
}

function trainSummons(plan, s = 0) {
  const cmds = [];
  CARS.forEach((c, n) => {
    const { at, yaw } = carAt(plan, s - c.off);
    const tags = tagList('alps_train', `alps_train_${n}`);
    const extra = `,teleport_duration:40,Rotation:[${yaw}f,0f]`;
    const h = c.len / 2;
    cmds.push(box(at, c.body, [-0.6, 0.15, -h], [1.2, 1.25, c.len], tags, extra));
    cmds.push(box(at, 'black_stained_glass', [-0.62, 0.8, -h + 0.3], [1.24, 0.42, c.len - 0.6], tags, extra));
    cmds.push(box(at, c.roof, [-0.58, 1.4, -h + 0.1], [1.16, 0.15, c.len - 0.2], tags, extra));
    if (c.loco) cmds.push(box(at, 'gray_concrete', [-0.05, 1.6, -0.4], [0.1, 0.5, 0.8], tags, extra)); // pantograph
    else cmds.push(box(at, 'dark_oak_planks', [-0.5, 0, -h + 0.2], [1.0, 0.15, c.len - 0.4], tags, extra)); // chassis
  });
  return cmds;
}

const trainFeature = {
  id: 'train',
  group: 'life',
  label: 'Little red train',
  description: 'A small red train (locomotive and two coaches) loops along the streets between the main square and the district plazas and stops at each. Runs only while somebody is in the game.',
  presets: [],
  setup() {
    train = { s: 0, next: 0, wait: 0, restore: true };
  },
  async onTick(ctx, now) {
    if (!ctx.state.city || ctx.state.city.pending || now < train.next) return;
    const L = lifeState(ctx);
    if (L.train && train.restore) Object.assign(train, { s: L.train.pos?.s ?? 0, restore: false });
    if (now > (trainFeature.planAt ?? 0)) {
      trainFeature.planAt = now + 120000;
      const plan = planTrain(ctx);
      if (!plan) return;
      if (L.train?.key !== plan.key || L.train?.v !== TRAIN_V) {
        await ctx.cmd('kill @e[tag=alps_train]');
        if (L.train) forget(ctx, { anchors: [L.train.parked ?? L.train.path[0]] }, 'alps_train');
        L.train = plan;
        train = { s: 0, next: 0, wait: now + 5000 };
        summonHeld(ctx, 'life:train', plan.path[0], trainSummons(plan));
        ctx.save();
        return;
      }
      // Where the train should stand somebody is near, but it is not there (lost to a kill, a crash…): put it back.
      const at = (L.train.parked ?? L.train.path[0]).map(Math.floor);
      if ((await ctx.cmd(`execute if loaded ${at[0]} ${at[1]} ${at[2]}`)).includes('passed') && !(await ctx.cmd('execute if entity @e[tag=alps_train]')).includes('passed')) {
        summonHeld(ctx, 'life:train', at, trainSummons(L.train, train.s));
      }
    }
    const plan = L.train;
    if (!plan || !online(ctx) || now < train.wait) return;
    plan.total ??= pathLength(plan.path);
    // A hop never runs a car across a corner (the client would cut it diagonally through a house).
    const step = Math.max(0.2, Math.min(10, ...CARS.map((c) => carAt(plan, train.s - c.off).ahead)));
    train.s += step;
    train.next = now + 2000;
    const cmds = CARS.map((c, n) => {
      const { at, yaw } = carAt(plan, train.s - c.off);
      return `tp @e[type=minecraft:block_display,tag=alps_train_${n}] ${r2(at[0])} ${r2(at[1])} ${r2(at[2])} ${yaw} 0`;
    });
    ctx.fx.push(cmds, { key: 'train:hop' });
    const vs = (plan.vs ??= vertexS(plan.path));
    const S = train.s % plan.total;
    if (plan.stops.some((i) => Math.abs(vs[i] - S) < 0.05)) {
      train.wait = now + 8000; // station stop and the two-tone horn
      const loco = carAt(plan, train.s).at;
      ctx.fx.later(2000, [0.84, 1.12].map((p) => `playsound minecraft:block.note_block.flute neutral @a ${r2(loco[0])} ${r2(loco[1])} ${r2(loco[2])} 2 ${p}`));
    }
    plan.parked = carAt(plan, train.s).at;
    plan.pos = { s: train.s % plan.total };
  },
  async onDisable(ctx) {
    const L = lifeState(ctx);
    await ctx.cmd('kill @e[tag=alps_train]');
    if (L.train) forget(ctx, { anchors: [L.train.parked ?? L.train.path[0]] }, 'alps_train');
    delete L.train;
    ctx.save();
  },
};

// ------------------------------------------------------------------ paragliders

const gliderProbes = new Probes('life:glideprobe');
let gliders = []; // { tag, path: [[x,y,z]…], i, next }
let gliderSeq = 0;
const GLIDER_COLORS = ['red', 'orange', 'yellow', 'lime', 'light_blue', 'magenta'];

function gliderPath(start, land, seed) {
  const n = Math.max(4, Math.min(30, Math.round(dist(start, land) / 15))); // under two minutes in the air
  const [dx, dz] = [land[0] - start[0], land[2] - start[2]];
  const len = Math.hypot(dx, dz) || 1;
  const [px, pz] = [-dz / len, dx / len];
  const out = [];
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    const sway = Math.sin(u * Math.PI * 2 + seed) * 10 * Math.sin(u * Math.PI); // S-turns, none at take-off and landing
    const lift = Math.sin(u * Math.PI) * 6; // a thermal on the way
    const y = start[1] + (land[1] - start[1]) * u + lift;
    out.push([start[0] + dx * u + px * sway, y, start[2] + dz * u + pz * sway]);
  }
  return out;
}

/** Commands that launch one glider: the vehicle with pilot and centre wing, then the two tilted side wings riding it too. */
function gliderSummon(tag, at, yaw, seed) {
  const color = GLIDER_COLORS[seed % GLIDER_COLORS.length];
  const skin = ['steve', 'alex', 'kai', 'noor', 'sunny'][seed % 5];
  const pos = `${r2(at[0])} ${r2(at[1])} ${r2(at[2])}`;
  const tilt = (deg) => {
    const h = (deg * Math.PI) / 360;
    return `[0f,0f,${f2(Math.sin(h))},${f2(Math.cos(h))}]`;
  };
  const wing = (extraTags, tr, q) => `${fxTagsSnbt(tag, ...extraTags)},Rotation:[${yaw}f,0f],view_range:4f,block_state:{Name:"minecraft:${color}_wool"},transformation:{left_rotation:${q},right_rotation:${ROT0},translation:[${tr.map(f2).join(',')}],scale:[${f2(tr[0] < -2 || tr[0] > 1 ? 1.5 : 3.2)},0.12f,1.2f]}`;
  const pilot = `{id:"minecraft:mannequin",${fxTagsSnbt(tag)},Rotation:[${yaw}f,0f],Invulnerable:1b,immovable:1b,hide_description:1b,profile:{texture:"entity/player/wide/${skin}"},equipment:{head:{id:"minecraft:leather_helmet",count:1,components:{"minecraft:dyed_color":16777215}}}}`;
  const centre = `{id:"minecraft:block_display",${wing([], [-1.6, 3.4, -0.6], ROT0)}}`;
  return [
    `summon minecraft:item_display ${pos} {${fxTagsSnbt(tag, `${tag}_v`)},teleport_duration:59,Passengers:[${pilot},${centre}]}`,
    // The side wings hang down from the centre wing's edges (rotation about the forward axis).
    `summon minecraft:block_display ${pos} {${wing([`${tag}_w`], [-2.92, 2.7, -0.6], tilt(28))}}`,
    `summon minecraft:block_display ${pos} {${wing([`${tag}_w`], [1.6, 3.4, -0.6], tilt(-28))}}`,
    `execute as @e[type=minecraft:block_display,tag=${tag}_w] run ride @s mount @e[type=minecraft:item_display,tag=${tag}_v,limit=1]`,
  ];
}

const paragliders = {
  id: 'paragliders',
  group: 'life',
  label: 'Paragliders',
  description: 'On fine days (9–19 h) a paraglider now and then takes off from a peak and glides down to a meadow at the edge of town in lazy S-turns. At most two in the air.',
  presets: [],
  setup(ctx) {
    ctx.needPeaks();
    gliders = [];
  },
  onEnable(ctx) {
    ctx.needPeaks();
  },
  async onTick(ctx, now) {
    const { city } = ctx.state;
    if (!city || city.pending || !city.peaks?.length) return;
    const L = lifeState(ctx);
    // Landing meadows, once: a point outside town on the line towards each of the first three peaks.
    if (!L.landings) {
      if (gliderProbes.done && !gliderProbes.out.length) {
        const R = cityRadius(ctx);
        gliderProbes.start(city.peaks.slice(0, 3).map((p) => {
          const [dx, dz] = [p.x - city.cx, p.z - city.cz];
          const len = Math.hypot(dx, dz) || 1;
          return [city.cx + (dx / len) * (R + 12), city.cz + (dz / len) * (R + 12)];
        }));
      }
      await gliderProbes.step(ctx);
      if (gliderProbes.done) {
        L.landings = gliderProbes.out.map((o) => (o.y == null || o.water ? null : [o.x + 0.5, o.y + 1, o.z + 0.5]));
        ctx.save();
      }
      return;
    }
    // Fly the ones in the air.
    for (const g of gliders) {
      if (now < g.next) continue;
      g.i++;
      if (g.i >= g.path.length) {
        ctx.fx.push([`execute at @e[tag=${g.tag},limit=1] run particle minecraft:poof ~ ~1 ~ 0.6 0.4 0.6 0.02 12`, `kill @e[tag=${g.tag}]`], { key: `glide:${g.tag}` });
        g.done = true;
        continue;
      }
      const [x, y, z] = g.path[g.i];
      const [px, , pz] = g.path[g.i - 1];
      const yaw = yawOf(x - px, z - pz);
      ctx.fx.push([`tp @e[type=minecraft:item_display,tag=${g.tag}] ${r2(x)} ${r2(y)} ${r2(z)}`, `rotate @e[tag=${g.tag}] ${yaw} 0`], { key: `glide:${g.tag}` });
      g.next = now + 2950;
    }
    gliders = gliders.filter((g) => !g.done);
    // A new take-off now and then.
    const hour = ctx.now().getHours();
    if (!online(ctx) || gliders.length >= 2 || hour < 9 || hour >= 19 || ctx.weather.base === 'rain' || now < (paragliders.nextStart ?? 0)) return;
    paragliders.nextStart = now + 240000 + Math.random() * 180000;
    const k = gliderSeq % Math.min(3, city.peaks.length);
    const land = L.landings[k];
    const peak = city.peaks[k];
    if (!land || !peak) return;
    const seed = gliderSeq++;
    const start = [peak.x + 0.5, peak.y + 3, peak.z + 0.5];
    const path = gliderPath(start, land, seed);
    const tag = `alps_glide_${seed % 100}`;
    const yaw = yawOf(path[1][0] - start[0], path[1][2] - start[2]);
    ctx.fx.push(async () => {
      await ctx.holdArea(`life:glide:${tag}`, { x1: peak.x - 2, z1: peak.z - 2, x2: peak.x + 2, z2: peak.z + 2 }, 5000);
      ctx.fx.later(1500, gliderSummon(tag, start, yaw, seed));
    });
    gliders.push({ tag, path, i: 0, next: now + 4500 });
    ctx.log(`Paraglider ${tag}: ${path.length} legs from ${peak.x},${peak.y},${peak.z}`);
  },
  async onDisable(ctx) {
    for (const g of gliders) await ctx.cmd(`kill @e[tag=${g.tag}]`);
    gliders = [];
  },
};

// ------------------------------------------------------------------ lake steamer

const steamerProbes = new Probes('life:steamprobe');
let steamer = { s: 0, dir: 1, next: 0, wait: 0 };

/** Route candidates from the terrain agent's anchors: harbour berth -> mouth -> pier heads, over water only. */
function steamerStops(anchors) {
  const h = anchors?.harbours?.[0];
  if (!h?.mouth) return null;
  const basin = h.basin;
  const mid = basin ? [(basin.x1 + basin.x2) / 2, (basin.z1 + basin.z2) / 2] : [h.mouth[0], h.mouth[2]];
  const y = h.waterY;
  const stops = [];
  if (h.berth) {
    const [bx, , bz] = h.berth;
    const [dx, dz] = [h.mouth[0] - bx, h.mouth[2] - bz];
    const l = Math.hypot(dx, dz) || 1;
    stops.push([bx + (dx / l) * 2.5, y, bz + (dz / l) * 2.5]);
  } else stops.push([mid[0], y, mid[1]]);
  stops.push([h.mouth[0] + 0.5, y, h.mouth[2] + 0.5]);
  const [ox, oz] = [h.mouth[0] - mid[0], h.mouth[2] - mid[1]];
  const ol = Math.hypot(ox, oz) || 1;
  stops.push([h.mouth[0] + (ox / ol) * 25, y, h.mouth[2] + (oz / ol) * 25]); // out onto the lake
  for (const p of (anchors.piers ?? []).slice(0, 3)) {
    if (p.waterY !== y) continue;
    stops.push([p.head[0] + p.dir[0] * 3 + 0.5, y, p.head[2] + p.dir[1] * 3 + 0.5]);
  }
  return stops;
}

function steamerSummons(at, yaw) {
  const tags = tagList('alps_steamer');
  const extra = `,teleport_duration:59,Rotation:[${yaw}f,0f]`;
  return [
    // The entity sits on the water surface: 0.4 of the hull below the waterline, the rest above.
    box(at, 'white_concrete', [-1.4, -0.4, -4.2], [2.8, 1.0, 8.4], tags, extra),
    box(at, 'dark_oak_planks', [-1.3, 0.6, -4.0], [2.6, 0.12, 8.0], tags, extra),
    box(at, 'white_concrete', [-0.9, 0.72, -2.2], [1.8, 1.2, 3.8], tags, extra),
    box(at, 'black_stained_glass', [-0.92, 1.2, -2.1], [1.84, 0.45, 3.6], tags, extra),
    box(at, 'yellow_concrete', [-0.35, 1.9, -0.6], [0.7, 1.4, 0.7], tags, extra),
    box(at, 'black_concrete', [-0.36, 3.3, -0.61], [0.72, 0.3, 0.72], tags, extra),
    box(at, 'red_wool', [0, 2.5, 3.4], [0.05, 0.5, 0.8], tags, extra),
  ];
}

const boats = {
  id: 'boats',
  group: 'life',
  label: 'Lake steamer',
  description: "A white paddle steamer with a yellow funnel sails from the harbour's landing out onto the lake and along the piers. Needs a harbour (built by the town on a lake shore). Runs only while somebody is in the game.",
  presets: [],
  setup() {
    steamer = { s: 0, dir: 1, next: 0, wait: 0, restore: true };
  },
  async onTick(ctx, now) {
    if (!ctx.state.city || ctx.state.city.pending) return;
    const L = lifeState(ctx);
    const stops = steamerStops(ctx.state.terrain?.anchors);
    if (!stops) return;
    const key = stops.map((p) => p.map(Math.round).join(',')).join('|');
    if (!L.steamer || L.steamer.key !== key) {
      // Check the route over water: samples every ~6 blocks along each leg (bad legs are dropped).
      if (steamerProbes.done && (!steamer.surveying || steamer.surveying !== key)) {
        steamer.surveying = key;
        const pts = [];
        for (let i = 0; i + 1 < stops.length; i++) {
          const n = Math.max(1, Math.round(dist(stops[i], stops[i + 1]) / 6));
          for (let k = 1; k <= n; k++) pts.push(lerp(stops[i], stops[i + 1], k / n));
        }
        steamerProbes.start(pts.map((p) => [p[0], p[2]]));
        steamer.legs = stops.map((p, i) => (i + 1 < stops.length ? Math.max(1, Math.round(dist(p, stops[i + 1]) / 6)) : 0));
        return;
      }
      await steamerProbes.step(ctx);
      if (!steamerProbes.done) return;
      const route = [stops[0]];
      let o = 0;
      for (let i = 0; i + 1 < stops.length; i++) {
        const n = steamer.legs[i];
        const wet = steamerProbes.out.slice(o, o + n).every((s) => s.water);
        o += n;
        if (wet && route[route.length - 1] === stops[i]) route.push(stops[i + 1]);
      }
      if (L.steamer) {
        await ctx.cmd('kill @e[tag=alps_steamer]');
        forget(ctx, { anchors: [L.steamer.parked ?? L.steamer.path[0]] }, 'alps_steamer');
      }
      L.steamer = { key, path: route.map(([x, y, z]) => [x, y + 1, z]) }; // waterY is the top water block: its surface is one up
      ctx.save();
      if (route.length < 2) return ctx.log('Lake steamer: no water route from the harbour');
      const [a, b] = route;
      summonHeld(ctx, 'life:steamer', L.steamer.path[0], steamerSummons(L.steamer.path[0], yawOf(b[0] - a[0], b[2] - a[2])));
      steamer = { s: 0, dir: 1, next: 0, wait: now + 20000 };
      ctx.log(`Lake steamer: ${route.length} stops`);
      return;
    }
    const path = L.steamer.path;
    if (steamer.restore) Object.assign(steamer, L.steamer.pos ?? {}, { restore: false });
    if (path.length < 2 || !online(ctx) || now < steamer.next || now < steamer.wait) return;
    const total = pathLength(path);
    const { ahead } = alongPath(path, steamer.s, steamer.dir);
    const step = Math.min(8, ahead, steamer.dir > 0 ? total - steamer.s : steamer.s);
    const before = alongPath(path, steamer.s, steamer.dir).at;
    steamer.s += steamer.dir * step;
    const { at } = alongPath(path, steamer.s, steamer.dir);
    steamer.next = now + 2950;
    const yaw = yawOf(at[0] - before[0], at[2] - before[2]);
    ctx.fx.push(`tp @e[type=minecraft:block_display,tag=alps_steamer] ${r2(at[0])} ${r2(at[1])} ${r2(at[2])} ${yaw} 0`, { key: 'steamer:hop' });
    L.steamer.parked = at;
    L.steamer.pos = { s: steamer.s, dir: steamer.dir };
    if (steamer.s <= 0.01 || steamer.s >= total - 0.01) {
      steamer.dir = -steamer.dir;
      steamer.wait = now + (steamer.s <= 0.01 ? 40000 : 8000);
      ctx.fx.later(2900, `playsound minecraft:item.goat_horn.sound.3 ambient @a ${r2(at[0])} ${r2(at[1])} ${r2(at[2])} 3 0.6`);
    }
  },
  async onDisable(ctx) {
    const L = lifeState(ctx);
    await ctx.cmd('kill @e[tag=alps_steamer]');
    if (L.steamer) forget(ctx, { anchors: [L.steamer.parked ?? L.steamer.path[0]] }, 'alps_steamer');
    delete L.steamer;
    ctx.save();
  },
};

export const _test = { planTrain, planCable, cableGeometry, carAt, alongPath, gliderPath, gliderSummon, steamerStops, upperHull, trainSummons, steamerSummons };
export default [cableCar, trainFeature, paragliders, boats];
