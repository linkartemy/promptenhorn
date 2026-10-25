// Smaller signals and touches: ideas 8 (web search = mail allay), 9 (compaction = coffee break),
// 10 (rate limit = thunderstorm over the far peaks), 11 (plan mode = architect with an outline),
// 16 (residents by house type), 17 (scaffolding), 27 (alphorn), 30 (quirks: TNT for rm -rf, helmet by
// model, dropping the tool on Ctrl+C).
import { fxTagsSnbt } from '../fx.mjs';

let fxSeq = 0;

const allay = {
  id: 'allay',
  group: 'Работа Claude',
  label: 'Веб-поиск = почтовый аллей',
  description: 'WebSearch/WebFetch: аллей вылетает от строителя за «письмом» и через 4 секунды возвращается. Не чаще раза в 10 секунд.',
  presets: [],
  onEvent(ctx, s, ev) {
    if (ev.kind !== 'PostToolUse' || !['WebSearch', 'WebFetch'].includes(ev.tool) || !s.at) return;
    const r = ctx.rt(s);
    if (Date.now() < (r.allayNext ?? 0)) return;
    r.allayNext = Date.now() + 10000;
    const tag = `alps_allay_${fxSeq++ % 100}`;
    const sel = `@e[type=minecraft:item_display,tag=${tag},limit=1]`;
    const b = ctx.builderSel(s);
    const ang = Math.random() * Math.PI * 2;
    const [dx, dz] = [Math.cos(ang) * 9, Math.sin(ang) * 9];
    // The allay rides an invisible display entity; teleporting that with teleport_duration makes the
    // client interpolate the flight smoothly, at the cost of three commands.
    ctx.fx.push([
      `execute at ${b} run summon minecraft:item_display ~ ~1.6 ~ {${fxTagsSnbt(tag)},teleport_duration:40,Passengers:[{id:"minecraft:allay",NoAI:1b,Silent:1b,Invulnerable:1b,PersistenceRequired:1b,${fxTagsSnbt(tag + '_a')}}]}`,
      `execute at ${b} run playsound minecraft:entity.allay.ambient_with_item neutral @a ~ ~ ~ 1 1`,
    ]);
    ctx.fx.later(150, `execute as ${sel} at @s run tp @s ~${dx.toFixed(1)} ~7 ~${dz.toFixed(1)}`);
    ctx.fx.later(2300, `execute as ${sel} at @s run tp @s ~${(-dx).toFixed(1)} ~-7 ~${(-dz).toFixed(1)}`);
    ctx.fx.later(4500, [`execute at ${sel} run playsound minecraft:entity.allay.item_given neutral @a ~ ~ ~ 1 1`, `execute at ${sel} run particle minecraft:note ~ ~1 ~ 0.3 0.3 0.3 1 3`, `kill @e[tag=${tag}_a]`, `kill ${sel}`]);
  },
};

const compact = {
  id: 'compact',
  group: 'Работа Claude',
  label: 'Компакция = перекур',
  description: 'Чат сжимает память: строитель присаживается с кружкой на несколько секунд, а рядом стоящие видят «чат сжал память».',
  presets: [],
  handPriority: 20,
  handItem(ctx, s) {
    return Date.now() < ctx.rt(s).compactUntil ? 'minecraft:suspicious_stew' : null;
  },
  canBuild(ctx, s) {
    return !(Date.now() < ctx.rt(s).compactUntil);
  },
  async onWork(ctx, s) {
    const r = ctx.rt(s);
    const on = Date.now() < r.compactUntil;
    if (on === !!r.compactShown) return;
    r.compactShown = on;
    const sel = ctx.builderSel(s);
    if (on) {
      await ctx.cmd(`data merge entity ${sel} {pose:"crouching"}`);
      await ctx.refreshHand(s);
      await ctx.cmd(`execute at ${sel} run title @a[distance=..48] actionbar {text:"☕ ${ctx.cleanText(s.name, 24).replace(/"/g, "'")}: чат сжал память, перекур",color:"aqua"}`);
    } else {
      s.pose = null; // the build loop puts the right pose back
      await ctx.refreshHand(s);
    }
  },
};

/** A lightning bolt on a far peak — never near villagers or the city (peaceful worlds stay safe anyway). */
function strike(ctx) {
  const { city } = ctx.state;
  const peaks = city.peaks?.length ? city.peaks : null;
  const radius = Math.max(60, ...Object.values(ctx.state.plots).map((p) => Math.hypot(p.cell[0], p.cell[1]) * ctx.PLOT)) + 60;
  const cmds = [];
  for (let k = 0; k < (peaks ? 1 : 5); k++) {
    let x;
    let z;
    if (peaks) [x, z] = (({ x: px, z: pz }) => [px + Math.round(Math.random() * 16 - 8), pz + Math.round(Math.random() * 16 - 8)])(peaks[Math.floor(Math.random() * peaks.length)]);
    else {
      const a = Math.random() * Math.PI * 2;
      const r = radius + Math.random() * 80;
      [x, z] = [Math.round(city.cx + Math.cos(a) * r), Math.round(city.cz + Math.sin(a) * r)];
    }
    // Only where the ground is high (a mountain), the chunk is loaded, and no villager or builder is near.
    cmds.push(`execute positioned ${x} ${city.baseY + 22} ${z} unless block ~ ~ ~ #minecraft:air positioned over motion_blocking unless entity @e[type=minecraft:villager,distance=..64] unless entity @e[tag=alps,distance=..64] run summon minecraft:lightning_bolt ~ ~ ~`);
  }
  return cmds;
}

let stormUntil = 0;
const storm = {
  id: 'storm',
  group: 'Работа Claude',
  label: 'Лимит API = гроза в горах',
  description: 'Чат упёрся в rate limit или перегрузку: на минуту гроза, молнии бьют только по дальним вершинам. Не чаще раза в 5 минут.',
  presets: [],
  onEvent(ctx, s, ev) {
    if (ev.kind !== 'StopFailure' || !['rate_limit', 'overloaded'].includes(ev.error)) return;
    if (Date.now() < stormUntil + 240000) return;
    stormUntil = Date.now() + 60000;
    ctx.needPeaks();
    ctx.fx.push('weather thunder 60s', { key: 'weather' });
    for (const at of [3000, 18000, 37000, 51000]) ctx.fx.later(at, strike(ctx));
    ctx.fx.later(61000, () => ctx.cmd(`weather ${ctx.weather.base ?? 'clear'}`), { key: 'weather:after' });
  },
};

/** Corners and roof line of the building the plan is for, in world coordinates. */
function outline(ctx, plot) {
  const m = ctx.meta(plot).struct;
  const h = Math.min(m.ymax, 28);
  return { x1: plot.x0 + m.x1, x2: plot.x0 + m.x2 + 1, z1: plot.z0 + m.z1, z2: plot.z0 + m.z2 + 1, y: plot.y + 1, h };
}

const planMode = {
  id: 'planMode',
  group: 'Работа Claude',
  label: 'Plan mode = архитектор',
  description: 'В режиме планирования строитель держит карту, а контур будущего дома мерцает искрами по углам. Стройка начинается после выхода из plan.',
  presets: [],
  handPriority: 30,
  handItem(ctx, s) {
    return s.active && s.planMode ? 'minecraft:filled_map' : null;
  },
  canBuild(ctx, s) {
    return !s.planMode;
  },
  async onWork(ctx, s, site) {
    const r = ctx.rt(s);
    if (!!s.planMode !== !!r.planShown) {
      r.planShown = !!s.planMode;
      await ctx.refreshHand(s);
    }
    if (!s.planMode || !s.active || site.obj || Date.now() < (r.planNext ?? 0)) return;
    r.planNext = Date.now() + 2000;
    const o = outline(ctx, site.plot);
    const mid = o.y + o.h / 2;
    ctx.fx.push([[o.x1, o.z1], [o.x2, o.z1], [o.x1, o.z2], [o.x2, o.z2]].map(([x, z]) => `particle minecraft:end_rod ${x} ${mid} ${z} 0 ${o.h / 4} 0 0 6`), { key: `plan:${s.id}` });
  },
};

const PROFESSION = { farmhouse: 'farmer', church: 'cleric', cafe: 'butcher', hotel: 'librarian', clocktower: 'toolsmith', hut: 'shepherd', apartment: 'cartographer', modern: 'librarian', townhouse: 'mason', chalet: 'farmer' };

const professions = {
  id: 'professions',
  group: 'Город',
  label: 'Жители по профессии дома',
  description: 'В ферму въезжает фермер, в церковь — священник, в кафе — мясник, в отель — библиотекарь. У фермы корова и коза; изредка слышен колокольчик.',
  presets: ['basic'],
  villagerProfession(ctx, plot) {
    return PROFESSION[plot.type] ?? null;
  },
  async onFinish(ctx, s, plot, { meta, firstTime }) {
    if (!firstTime || plot.type !== 'farmhouse') return;
    const d = ctx.district(plot.district);
    if (!d || (d.animals ?? 0) >= 6) return; // bounded: animals cost ticks too
    // Two free lawn cells, a few blocks apart.
    const cells = [];
    for (let x = 3; x <= 17; x++) for (let z = 3; z <= 17; z++) if (meta.freeCell(x, z) && !cells.some(([a, b]) => Math.abs(a - x) + Math.abs(b - z) < 4)) cells.push([x, z]);
    let n = 0;
    for (const [x, z] of cells.slice(0, 2)) {
      const kind = n === 0 ? 'cow' : 'goat';
      await ctx.cmd(`summon minecraft:${kind} ${plot.x0 + x + 0.5} ${plot.y + 1} ${plot.z0 + z + 0.5} {Tags:["alps","alps_animal"],NoAI:1b,PersistenceRequired:1b,Rotation:[${n * 90}f,0f]}`);
      n++;
    }
    d.animals = (d.animals ?? 0) + n;
    plot.animals = n > 0;
    ctx.save();
  },
  onTick(ctx, now) {
    if (now < (professions.next ?? 0)) return;
    professions.next = now + 60000 + Math.random() * 60000;
    const farms = Object.values(ctx.state.plots).filter((p) => p.animals);
    if (!farms.length) return;
    const f = farms[Math.floor(Math.random() * farms.length)];
    ctx.fx.push(`playsound minecraft:block.note_block.bell ambient @a ${f.x0 + 10} ${f.y + 1} ${f.z0 + 16} 0.6 ${(1.3 + Math.random() * 0.4).toFixed(2)}`);
  },
};

const SCAFFOLD = 'minecraft:scaffolding[bottom=false,distance=0,waterlogged=false]';

async function scaffoldDown(ctx, plot) {
  for (const c of plot.scaffold?.cols ?? []) await ctx.cmd(`fill ${c.x} ${plot.y + 1} ${c.z} ${c.x} ${plot.y + c.top} ${c.z} air replace minecraft:scaffolding`);
  delete plot.scaffold;
  ctx.save();
}

const scaffolding = {
  id: 'scaffolding',
  group: 'Город',
  label: 'Строительные леса',
  description: 'Пока дом строится, по его углам растут леса; на финише их снимают вместе с фейерверком.',
  presets: [],
  always: ['onFinish'],
  async onWork(ctx, s, site) {
    const plot = site.obj ? null : site.plot;
    if (!plot || plot.type === 'park' || plot.done) return;
    const r = ctx.rt(s);
    if (Date.now() < (r.scaffoldNext ?? 0)) return;
    r.scaffoldNext = Date.now() + 1000;
    const meta = ctx.meta(plot);
    if (!meta.scaffold.length) return;
    const { list } = ctx.buildList(plot);
    const current = plot.placed ? list[Math.min(plot.placed, list.length) - 1].y - plot.y + 1 : 1;
    plot.scaffold ??= { h: 0, cols: meta.scaffold.map((c) => ({ x: plot.x0 + c.x, z: plot.z0 + c.z, top: c.top })) };
    const target = Math.min(current, Math.max(...meta.scaffold.map((c) => c.top)));
    if (plot.scaffold.h >= target) return;
    const y = ++plot.scaffold.h;
    for (const c of plot.scaffold.cols) if (y <= c.top) await ctx.cmd(`execute if block ${c.x} ${plot.y + y} ${c.z} minecraft:air run setblock ${c.x} ${plot.y + y} ${c.z} ${SCAFFOLD}`);
    ctx.save();
  },
  async onFinish(ctx, s, plot) {
    if (plot.scaffold) await scaffoldDown(ctx, plot);
  },
  async onDisable(ctx) {
    for (const s of ctx.sessions()) {
      const site = ctx.siteOf(s.at);
      if (site?.plot && !site.obj && site.plot.scaffold) await scaffoldDown(ctx, site.plot);
    }
  },
};

const alphorn = {
  id: 'alphorn',
  group: 'Пасхалки',
  label: 'Альпхорн на финише',
  description: 'Когда дом достроен, по долине раскатывается низкий звук альпийского рога.',
  presets: ['basic'],
  onFinish(ctx, s, plot, { top }) {
    const [x, z] = [plot.x0 + 10, plot.z0 + 10];
    ctx.fx.push(`playsound minecraft:item.goat_horn.sound.0 ambient @a ${x} ${top} ${z} 6 0.5`);
    ctx.fx.later(1400, `playsound minecraft:item.goat_horn.sound.0 ambient @a ${x} ${top} ${z} 2.5 0.5`);
  },
};

const HELMETS = { opus: 'minecraft:golden_helmet', sonnet: 'minecraft:iron_helmet', haiku: 'minecraft:leather_helmet', fable: 'minecraft:chainmail_helmet' };

const quirks = {
  id: 'quirks',
  group: 'Пасхалки',
  label: 'Мелочи',
  description: 'rm -rf — строитель секунду держит динамит (без взрыва); каска по модели (Opus — золотая, Haiku — кожаная); Ctrl+C — роняет инструмент.',
  presets: [],
  handPriority: 10,
  handItem(ctx, s) {
    const r = ctx.rt(s);
    if (Date.now() < (r.tntUntil ?? 0)) return 'minecraft:tnt';
    if (Date.now() < (r.droppedUntil ?? 0)) return 'minecraft:air';
    return null;
  },
  onBuilderSpawn(ctx, s) {
    const helmet = HELMETS[s.model];
    if (helmet) ctx.fx.push(`item replace entity ${ctx.builderSel(s)} armor.head with ${helmet}`, { key: `helmet:${s.id}` });
  },
  onEvent(ctx, s, ev) {
    const r = ctx.rt(s);
    if ((ev.kind === 'SessionStart' || ev.kind === 'PostModelSwitch') && ev.model) quirks.onBuilderSpawn(ctx, s);
    if (ev.kinds.includes('rmrf')) {
      r.tntUntil = Date.now() + 1500;
      ctx.fx.push(() => ctx.refreshHand(s), { key: `hand:${s.id}` });
      ctx.fx.later(1600, () => ctx.refreshHand(s), { key: `hand2:${s.id}` });
    }
    if (ev.kind === 'PostToolUseFailure' && ev.interrupt && r.hand && r.hand !== 'minecraft:air') {
      const item = r.hand;
      r.droppedUntil = Date.now() + 3000;
      ctx.fx.push([
        `execute at ${ctx.builderSel(s)} run summon minecraft:item ~ ~1.2 ~ {${fxTagsSnbt()},PickupDelay:32767s,Age:5900s,Item:{id:"${item}",count:1},Motion:[0.1d,0.2d,0.1d]}`,
      ]);
      ctx.fx.push(() => ctx.refreshHand(s), { key: `hand:${s.id}` });
      ctx.fx.later(3100, () => ctx.refreshHand(s), { key: `hand2:${s.id}` });
    }
  },
  onDisable(ctx) {
    for (const s of ctx.sessions()) ctx.fx.push(`item replace entity ${ctx.builderSel(s)} armor.head with minecraft:air`, { key: `helmet:${s.id}` });
  },
};

export default [allay, compact, storm, planMode, professions, scaffolding, alphorn, quirks];
