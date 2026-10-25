// Ideas 15 and 29 — clocks. The Zytglogge strikes the real hours (7:00–22:00) on the city's clock
// tower bell while a little parade of polar bears circles the tower; the SBB station clock: real hands
// (display entities) on the clock towers' dials, the red second hand sweeping in 58.5 s and pausing
// at the top for 1.5 s ("stop-to-go"). All motion is client-side interpolation: four commands a
// minute per dial.
import { fxTagsSnbt } from '../fx.mjs';

const quiet = (h) => h >= 22 || h < 7;

/** Where the hour bell hangs: the first clock tower, else a church, else the main square. */
function hourBell(ctx) {
  const plots = Object.values(ctx.state.plots).filter((p) => p.done);
  for (const type of ['clocktower', 'church']) {
    for (const p of plots.filter((x) => x.type === type)) {
      const b = ctx.meta(p).bells[0];
      if (b) return { plot: p, x: p.x0 + b.x + 0.5, y: p.y + b.y, z: p.z0 + b.z + 0.5 };
    }
  }
  const sq = ctx.square();
  return sq ? { plot: sq, x: sq.x0 + 10.5, y: sq.y + 6, z: sq.z0 + 10.5 } : null;
}

let lastHour = null;
const clockBells = {
  id: 'clockBells',
  group: 'Город',
  label: 'Цитглогге бьёт часы',
  description: 'Каждый час (с 7 до 22) колокол часовой башни бьёт по реальному времени, а вокруг башни проходит парад белых медвежат. Ночью тихо.',
  presets: [],
  onTick(ctx) {
    const now = ctx.now();
    const hour = now.getHours();
    if (now.getMinutes() !== 0 || hour === lastHour) return;
    lastHour = hour;
    if (quiet(hour)) return;
    const bell = hourBell(ctx);
    if (!bell) return;
    const strikes = hour % 12 || 12;
    for (let k = 0; k < strikes; k++) ctx.fx.later(k * 1700, `playsound minecraft:block.bell.use block @a ${bell.x} ${bell.y} ${bell.z} 5 0.9`);
    // Parade: four small bears walk a circle around the tower (one command per step for all of them).
    const p = bell.plot;
    const [cx, cz] = [p.x0 + 10.5, p.z0 + 10.5];
    const tag = 'alps_bears';
    const r = 6.5;
    ctx.fx.push(async (cmd) => {
      await ctx.holdArea('parade', ctx.plotRect(p.cell), strikes * 1700 + 18000);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        const yaw = ((a * 180) / Math.PI + 180) % 360; // facing along the circle
        await cmd(`summon minecraft:polar_bear ${(cx + Math.cos(a) * r).toFixed(2)} ${p.y + 1} ${(cz + Math.sin(a) * r).toFixed(2)} {${fxTagsSnbt(tag)},NoAI:1b,Silent:1b,Invulnerable:1b,PersistenceRequired:1b,Rotation:[${yaw.toFixed(1)}f,0f],attributes:[{id:"minecraft:scale",base:0.5}]}`);
      }
    }, { cost: 5 });
    const steps = 26;
    for (let k = 1; k <= steps; k++) ctx.fx.later(600 + k * 500, `execute as @e[type=minecraft:polar_bear,tag=${tag}] at @s run tp @s ^ ^ ^0.75 ~6.6 ~`, { key: `bears:${k}` });
    ctx.fx.later(600 + (steps + 1) * 500, [`execute at @e[type=minecraft:polar_bear,tag=${tag}] run particle minecraft:poof ~ ~0.5 ~ 0.3 0.3 0.3 0.02 8`, `kill @e[type=minecraft:polar_bear,tag=${tag}]`]);
  },
};

// --- SBB clock

const ROT0 = '[0f,0f,0f,1f]';
/** Quaternion [x, y, z, w] for a rotation of `deg` degrees about a unit axis. */
function quat([ax, ay, az], deg) {
  const h = (deg * Math.PI) / 360;
  const s = Math.sin(h);
  return [ax * s, ay * s, az * s, Math.cos(h)];
}
const f = (n) => `${n.toFixed(4)}f`;

/** The dials the SBB hands go on: clock towers' and churches' dials (bounded, nearest the centre first). */
function dials(ctx) {
  const out = [];
  const plots = Object.values(ctx.state.plots).filter((p) => p.done && (p.type === 'clocktower' || p.type === 'church'));
  plots.sort((a, b) => Math.hypot(...a.cell) - Math.hypot(...b.cell));
  for (const p of plots) {
    for (const d of ctx.meta(p).clockFaces) {
      out.push({ id: `${p.key.replace(',', '_')}_${d.x}_${d.y}_${d.z}`, plot: p, x: p.x0 + d.x, y: p.y + d.y, z: p.z0 + d.z, n: d.normal, r: d.r });
      if (out.length >= 12) return out;
    }
  }
  return out;
}

const HANDS = {
  h: { block: 'black_concrete', len: 0.62, w: 0.16, off: 0.53 },
  m: { block: 'black_concrete', len: 0.92, w: 0.11, off: 0.55 },
  s: { block: 'red_concrete', len: 0.95, w: 0.05, off: 0.57 },
};

/** Transformation of a hand at clockwise angle `deg` (seen from outside the dial). */
function handTransform(d, hand, deg) {
  const k = HANDS[hand];
  const L = k.len * (d.r + 0.45);
  const axis = [d.n[0], 0, d.n[1]];
  const q = quat(axis, -deg); // clockwise for someone looking at the dial
  // The bar is the unit cube scaled to (w, L, thin) and centred on the dial axis; translation is applied
  // after the rotation, so rotate the centring offset too.
  const thin = 0.03;
  const sx = d.n[0] ? thin : k.w;
  const sz = d.n[0] ? k.w : thin;
  const c = [-sx / 2, -0.06, -sz / 2];
  const [x, y, z, w] = q;
  const rot = (v) => {
    // v' = q v q*
    const [vx, vy, vz] = v;
    const ix = w * vx + y * vz - z * vy;
    const iy = w * vy + z * vx - x * vz;
    const iz = w * vz + x * vy - y * vx;
    const iw = -x * vx - y * vy - z * vz;
    return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
  };
  const t = rot(c);
  return `{left_rotation:[${q.map(f).join(',')}],right_rotation:${ROT0},translation:[${t.map(f).join(',')}],scale:[${f(sx)},${f(L)},${f(sz)}]}`;
}

const handTag = (d, h) => `alps_sbb_${d.id}_${h}`;

function angles(now) {
  const s = now.getSeconds() + now.getMilliseconds() / 1000;
  const m = now.getMinutes();
  const h = now.getHours() % 12;
  return { s, m: m * 6, h: h * 30 + m * 0.5 };
}

let loaded = new Map(); // dial id -> loaded at the last minute check
let lastMinute = null;
let lastSegment = null;

const sbbClock = {
  id: 'sbbClock',
  group: 'Пасхалки',
  label: 'SBB-часы',
  description: 'На циферблатах башен и церквей — настоящие стрелки по твоему времени; красная секундная обходит круг за 58,5 с и замирает наверху на 1,5 с.',
  presets: [],
  setup() {
    loaded = new Map();
    lastMinute = null;
    lastSegment = null;
  },
  async onTick(ctx) {
    const now = ctx.now();
    const minute = now.getHours() * 60 + now.getMinutes();
    const list = dials(ctx);
    if (minute !== lastMinute) {
      lastMinute = minute;
      const a = angles(now);
      for (const d of list) {
        // Only dials in loaded chunks (a player nearby); summon the hands there if they are missing.
        ctx.fx.push(async (cmd) => {
          const isLoaded = (await cmd(`execute if loaded ${d.x} ${d.y} ${d.z}`)).includes('passed');
          loaded.set(d.id, isLoaded);
          if (!isLoaded) return;
          for (const h of ['h', 'm', 's']) {
            const k = HANDS[h];
            const [px, py, pz] = [d.x + 0.5 + d.n[0] * k.off, d.y + 0.5, d.z + 0.5 + d.n[1] * k.off];
            const deg = h === 'h' ? a.h : h === 'm' ? a.m : 0;
            await cmd(`execute unless entity @e[type=minecraft:block_display,tag=${handTag(d, h)}] run summon minecraft:block_display ${px} ${py} ${pz} {Tags:["alps","alps_sbb","${handTag(d, h)}"],block_state:{Name:"minecraft:${k.block}"},brightness:{sky:15,block:15},transformation:${handTransform(d, h, deg)}}`);
          }
          // The minute hand jumps, the hour hand creeps.
          await cmd(`data merge entity @e[type=minecraft:block_display,tag=${handTag(d, 'm')},limit=1] {start_interpolation:0,interpolation_duration:3,transformation:${handTransform(d, 'm', a.m)}}`);
          await cmd(`data merge entity @e[type=minecraft:block_display,tag=${handTag(d, 'h')},limit=1] {start_interpolation:0,interpolation_duration:3,transformation:${handTransform(d, 'h', a.h)}}`);
        }, { key: `sbb:${d.id}`, cost: 5 });
      }
    }
    // Second hand: four 90° sweeps of 14.625 s each, then the stop at 58.5 s.
    const { s } = angles(now);
    const seg = s >= 58.5 ? 4 : Math.floor(s / 14.625);
    const segKey = `${minute}:${seg}`;
    if (segKey === lastSegment) return;
    lastSegment = segKey;
    if (seg === 4) return; // pause at twelve (the hand already points up: 360° = 0°)
    const end = (seg + 1) * 14.625;
    const ticks = Math.max(1, Math.round((end - s) * 20));
    for (const d of list) {
      if (!loaded.get(d.id)) continue;
      ctx.fx.push(`data merge entity @e[type=minecraft:block_display,tag=${handTag(d, 's')},limit=1] {start_interpolation:0,interpolation_duration:${ticks},transformation:${handTransform(d, 's', (seg + 1) * 90)}}`, { key: `sbbs:${d.id}` });
    }
  },
  async onDisable(ctx) {
    await ctx.cmd('kill @e[type=minecraft:block_display,tag=alps_sbb]');
    loaded = new Map();
  },
};

export default [clockBells, sbbClock];
