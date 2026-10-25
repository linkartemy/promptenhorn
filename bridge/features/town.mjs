// City-level progress and information: ideas 19 (district rank Weiler → Dorf → Städtli → Stadt),
// 20 (francs for tokens, read from the transcript's usage numbers only), 21 (the Matterhorn progress
// bar on the nearest peak), 24 (the town hall dialog), 25 (builders on the locator bar),
// 26 ("while you were away" on joining).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureDatapack } from './datapack.mjs';

// --- 19: district rank

export const RANKS = [
  [0, 'Weiler', 'yellow'],
  [3, 'Dorf', 'yellow'],
  [8, 'Städtli', 'gold'],
  [15, 'Stadt', 'gold'],
];
const rankOf = (d) => RANKS.reduce((best, r, i) => (d.buildingsDone >= r[0] ? i : best), 0);
const STATUES = [
  null,
  ['minecraft:stone_brick_wall[east=none,north=none,south=none,west=none,up=true,waterlogged=false]', 'minecraft:lantern[hanging=false,waterlogged=false]'],
  ['minecraft:chiseled_stone_bricks', 'minecraft:waxed_copper_golem_statue[copper_golem_pose=standing,facing=south]'],
  ['minecraft:gold_block', 'minecraft:waxed_copper_golem_statue[copper_golem_pose=star,facing=south]'],
];

async function applyRank(ctx, d, announce) {
  const plaza = ctx.plazaOf(d);
  if (!plaza) return;
  const rank = rankOf(d);
  const [, title, color] = RANKS[rank];
  await ctx.holdArea(`rank:${d.key}`, ctx.plotRect(plaza.cell), 5000);
  ctx.fx.later(1500, async () => {
    await ctx.nameplate(`alps_name_${d.index}`, plaza, `${title} ${d.name}`, color, 2.5, 6);
    const statue = STATUES[rank];
    const spot = ctx.meta(plaza).statue;
    if (statue && spot) {
      const [x, y, z] = [plaza.x0 + spot.x, plaza.y + 1, plaza.z0 + spot.z];
      await ctx.cmd(`setblock ${x} ${y} ${z} ${statue[0]}`);
      await ctx.cmd(`setblock ${x} ${y + 1} ${z} ${statue[1]}`);
    }
  }, { cost: 4 });
  d.rank = rank;
  ctx.save();
  if (announce) {
    ctx.fx.push([
      `title @a subtitle ${ctx.textJson(`${d.name} теперь ${title}`, 'yellow')}`,
      `title @a title ${ctx.textJson(title, color)}`,
    ]);
    if (rank === 3) ctx.achieve('stadt');
  }
}

const townRank = {
  id: 'townRank',
  group: 'Прогресс',
  label: 'Статус посёлка',
  description: 'По числу домов квартал растёт: Weiler → Dorf (3) → Städtli (8) → Stadt (15). Новое имя над площадью, памятник и титр при повышении.',
  presets: ['basic'],
  setup(ctx) {
    // Silent catch-up for districts that grew while the feature was off (no titles).
    for (const d of Object.values(ctx.state.districts)) if (!d.pending && d.rank !== rankOf(d) && rankOf(d) > 0) applyRank(ctx, d, false);
  },
  onEnable(ctx) {
    townRank.setup(ctx);
  },
  afterFinish(ctx, s, plot) {
    const d = ctx.district(plot.district);
    if (d && rankOf(d) > (d.rank ?? 0)) applyRank(ctx, d, true);
  },
  async onDisable(ctx) {
    for (const d of Object.values(ctx.state.districts)) {
      const plaza = ctx.plazaOf(d);
      if (!plaza || !d.rank) continue;
      d.rank = 0;
      await ctx.holdArea(`rank:${d.key}`, ctx.plotRect(plaza.cell), 4000);
      ctx.fx.later(1500, () => ctx.nameplate(`alps_name_${d.index}`, plaza, d.name, 'yellow', 2.5, 6), { cost: 2 });
    }
    ctx.save();
  },
};

// --- 20: francs for tokens. Only the numbers in "usage" are read; message text is never parsed.

const TRANSCRIPTS = path.join(os.homedir(), '.claude');
// Field order inside "usage" is not guaranteed: look each number up within the usage object.
const usageOf = (line) => {
  const i = line.indexOf('"usage":{');
  if (i < 0) return null;
  const u = line.slice(i, i + 600);
  const num = (k) => Number(u.match(new RegExp(`"${k}":(\\d+)`))?.[1] ?? 0);
  return num('input_tokens') + num('cache_creation_input_tokens') + num('output_tokens'); // cache reads are not new work
};
const MSG_ID = /"message":\{[^]*?"id":"(msg_[A-Za-z0-9]+)"/;

async function readUsage(ctx, s, file) {
  const real = path.resolve(file);
  if (!real.startsWith(TRANSCRIPTS) || !real.endsWith('.jsonl')) return; // only Claude Code transcripts
  s.tokens ??= {};
  const key = path.basename(real);
  const st = (s.tokens[key] ??= { offset: 0, last: null });
  const stat = await fs.promises.stat(real).catch(() => null);
  if (!stat || stat.size <= st.offset) return;
  const fh = await fs.promises.open(real, 'r');
  try {
    const len = Math.min(stat.size - st.offset, 32 * 1024 * 1024);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, st.offset);
    const text = buf.toString('utf8');
    const end = text.lastIndexOf('\n');
    if (end < 0) return;
    let sum = 0;
    for (const line of text.slice(0, end).split('\n')) {
      if (!line.includes('"type":"assistant"')) continue;
      const u = usageOf(line);
      if (u == null) continue;
      const id = line.match(MSG_ID)?.[1];
      if (id && id === st.last) continue; // one API message is written as several lines with the same usage
      st.last = id ?? null;
      sum += u;
    }
    st.offset += Buffer.byteLength(text.slice(0, end + 1));
    ctx.state.totals.tokens = (ctx.state.totals.tokens ?? 0) + sum;
    const keys = Object.keys(s.tokens);
    if (keys.length > 20) delete s.tokens[keys[0]];
    ctx.save();
  } finally {
    await fh.close();
  }
}

const chf = (tokens) => Math.round(tokens / 1000).toLocaleString('de-CH').replace(/[’']/g, ' ');

const francs = {
  id: 'francs',
  group: 'Прогресс',
  label: 'Франки за токены',
  description: 'Над главной площадью табло «Kasse: CHF 12 480» — 1 франк за 1000 токенов (из транскриптов читаются только цифры usage).',
  presets: [],
  onEvent(ctx, s, ev) {
    if (ev.transcript && ['Stop', 'SubagentStop', 'SessionEnd', 'StopFailure'].includes(ev.kind)) return readUsage(ctx, s, ev.transcript);
  },
  onTick(ctx, now) {
    if (now < (francs.next ?? 0)) return;
    francs.next = now + 30000;
    const sq = ctx.square();
    if (!sq) return;
    const text = `Kasse: CHF ${chf(ctx.state.totals.tokens ?? 0)}`;
    const [x, y, z] = [ctx.state.city.cx + 0.5, sq.y + 11, ctx.state.city.cz + 0.5];
    if (francs.shown === text) return;
    // Only when the square is loaded (a player is near): summon once, then just update the text.
    ctx.fx.push(async (cmd) => {
      await cmd(`execute if loaded ${Math.floor(x)} ${y} ${Math.floor(z)} unless entity @e[type=minecraft:text_display,tag=alps_kasse] run summon minecraft:text_display ${x} ${y} ${z} {Tags:["alps","alps_kasse"],billboard:"center",shadow:1b,background:1073741824,transformation:{left_rotation:[0f,0f,0f,1f],right_rotation:[0f,0f,0f,1f],translation:[0f,0f,0f],scale:[2f,2f,2f]}}`);
      const out = await cmd(`data merge entity @e[type=minecraft:text_display,tag=alps_kasse,limit=1] {text:${ctx.textJson(text, 'gold')}}`);
      if (out.includes('Modified')) francs.shown = text;
    }, { key: 'kasse', cost: 2 });
  },
  async onDisable(ctx) {
    francs.shown = null;
    await ctx.cmd('kill @e[type=minecraft:text_display,tag=alps_kasse]');
  },
};

// --- 21: Matterhorn progress bar: a Swiss flag on the nearest peak at 10 houses, then a ring of
// lanterns per further 10 houses (visible at night from anywhere in the valley).

function tierCommands(peak, tier) {
  const { x, y, z } = peak;
  const out = [];
  if (tier === 1) {
    for (let h = 1; h <= 6; h++) out.push(`setblock ${x} ${y + h - 1} ${z} spruce_fence`);
    for (let i = 1; i <= 5; i++)
      for (let j = 0; j < 5; j++) {
        const white = (j === 2 && i >= 2 && i <= 4) || (i === 3 && j >= 1 && j <= 3);
        out.push(`setblock ${x + i} ${y + 2 + j} ${z} ${white ? 'white_concrete' : 'red_concrete'}`);
      }
    out.push(`setblock ${x} ${y + 6} ${z} lantern`);
    return out;
  }
  const r = tier; // tier 2 -> radius 2, …
  const n = Math.max(6, Math.round((2 * Math.PI * r) / 2));
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const [px, pz] = [Math.round(x + Math.cos(a) * r), Math.round(z + Math.sin(a) * r)];
    out.push(`execute positioned ${px} ${y + 12} ${pz} positioned over motion_blocking run setblock ~ ~ ~ lantern`);
  }
  return out;
}

const matterhorn = {
  id: 'matterhorn',
  group: 'Прогресс',
  label: 'Маттерхорн-прогрессбар',
  description: 'На ближайшей вершине на 10 домах поднимается швейцарский флаг, затем каждые 10 домов — новое кольцо фонарей. Видно ночью из долины.',
  presets: [],
  setup(ctx) {
    ctx.needPeaks();
  },
  onEnable(ctx) {
    ctx.needPeaks();
  },
  onTick(ctx, now) {
    if (now < (matterhorn.next ?? 0)) return;
    matterhorn.next = now + 60000;
    const peak = ctx.state.city?.peaks?.[0];
    if (!peak) return;
    const want = Math.min(12, Math.floor((ctx.state.totals.houses ?? 0) / 10));
    const built = peak.tiers ?? 0;
    if (built >= want) return;
    const tier = built + 1;
    const r = { x1: peak.x - 14, z1: peak.z - 14, x2: peak.x + 14, z2: peak.z + 14 };
    ctx.fx.push(() => ctx.holdArea('matterhorn', r, 8000), { cost: 2 });
    ctx.fx.later(2500, tierCommands(peak, tier));
    ctx.fx.later(2600, () => {
      peak.tiers = tier;
      ctx.save();
      ctx.log(`Matterhorn tier ${tier}`);
    });
  },
};

// --- 24: the town hall — a dialog with a teleport button for every builder, waiting ones first.

function hallDialog(ctx) {
  const order = (s) => {
    const w = ctx.rt(s).waiting?.kind;
    return w === 'permission' || w === 'question' ? 0 : s.active ? 1 : 2;
  };
  const actions = [];
  let size = 300;
  for (const s of ctx.sessions().filter((x) => x.at).sort((a, b) => order(a) - order(b))) {
    const site = ctx.siteOf(s.at);
    if (!site) continue;
    const o = order(s);
    const [x, y, z] = site.front;
    const pct = Math.floor((100 * site.rec.placed) / Math.max(1, site.rec.total));
    const label = `${o === 0 ? '⌛ ' : o === 1 ? '⚒ ' : '☾ '}${ctx.cleanText(s.name, 22)} · ${ctx.cleanText(site.label, 18)} ${pct}%`;
    const a = { label: { text: label, color: o === 0 ? 'red' : o === 1 ? 'green' : 'gray' }, action: { type: 'run_command', command: `/tp @s ${x + 0.5} ${y} ${z + 2.5}` } };
    const len = Buffer.byteLength(JSON.stringify(a));
    if (size + len > 1250) break; // one RCON packet
    size += len;
    actions.push(a);
  }
  const sq = ctx.square();
  if (sq) actions.push({ label: { text: `⛰ ${ctx.config.cityName} (центр)`, color: 'gold' }, action: { type: 'run_command', command: `/tp @s ${ctx.state.city.cx} ${sq.y + 2} ${ctx.state.city.cz + 7}` } });
  actions.push({ label: { text: '⚙ Настройки', color: 'aqua' }, action: { type: 'open_url', url: `http://127.0.0.1:${ctx.port()}/` } });
  const body = { type: 'plain_message', contents: { text: actions.length > 2 ? 'Кто ждёт тебя — сверху. Клик — телепорт.' : 'Пока ни одного строителя.' } };
  return { type: 'multi_action', title: { text: `Ратуша ${ctx.config.cityName}` }, body, actions, columns: 1 };
}

const townHall = {
  id: 'townHall',
  group: 'Информация',
  label: 'Ратуша',
  description: 'Окно со всеми строителями: кто ждёт тебя — сверху, клик — телепорт. Открывается из меню паузы или ссылкой [Ратуша] в чате.',
  presets: ['basic'],
  async setup(ctx) {
    await ctx.cmd('scoreboard objectives add alps_hall trigger');
    await ensureDatapack(ctx).catch(() => false); // pause-menu button; the chat link works without it
  },
  onPlayers(ctx) {
    ctx.fx.push('scoreboard players enable @a alps_hall', { key: 'hall:enable' });
  },
  async onPlayerJoin(ctx, name) {
    await ctx.tellraw(name, [{ text: '  ⌂ ', color: 'gray' }, { text: '[Ратуша]', color: 'aqua', click_event: { action: 'run_command', command: '/trigger alps_hall' }, hover_event: { action: 'show_text', value: 'Все строители и телепорт к ним' } }, { text: '  список строителей; ещё она есть в меню паузы', color: 'gray' }]);
  },
  async onTick(ctx, now) {
    if (now < (townHall.next ?? 0)) return;
    townHall.next = now + 1000;
    if (!(await ctx.cmd('execute if entity @a[scores={alps_hall=1..}]')).includes('passed')) return;
    for (const name of ctx.players()) {
      if (!(await ctx.cmd(`execute if entity @a[name=${name},scores={alps_hall=1..}]`)).includes('passed')) continue;
      await ctx.cmd(`scoreboard players set ${name} alps_hall 0`);
      await ctx.cmd(`scoreboard players enable ${name} alps_hall`);
      await ctx.cmd(`dialog show ${name} ${JSON.stringify(hallDialog(ctx))}`);
    }
  },
};

// --- 25: builders on the locator bar; waiting ones red.

const locatorBar = {
  id: 'locatorBar',
  group: 'Информация',
  label: 'Строители на locator bar',
  description: 'Строители видны на панели locator bar; кто ждёт тебя — красной точкой. (Панель видна в режиме выживания/приключения.)',
  presets: [],
  onBuilderSpawn(ctx, s) {
    ctx.rt(s).wpColor = null;
    ctx.fx.push(`attribute ${ctx.builderSel(s)} minecraft:waypoint_transmit_range base set 6000`, { key: `wp:${s.id}` });
  },
  onEnable(ctx) {
    for (const s of ctx.sessions()) if (s.at) locatorBar.onBuilderSpawn(ctx, s);
  },
  onWork(ctx, s) {
    const r = ctx.rt(s);
    const w = r.waiting?.kind;
    const color = w === 'permission' || w === 'question' ? 'red' : w === 'idle' ? 'yellow' : 'reset';
    if (r.wpColor === color) return;
    r.wpColor = color;
    ctx.fx.push(`waypoint modify ${ctx.builderSel(s)} color ${color}`, { key: `wpc:${s.id}` });
  },
  onDisable(ctx) {
    for (const s of ctx.sessions()) ctx.fx.push(`attribute ${ctx.builderSel(s)} minecraft:waypoint_transmit_range base set 0`, { key: `wp:${s.id}` });
  },
};

// --- 26: "while you were away".

const snapshot = (ctx) => ({ houses: ctx.state.totals.houses ?? 0, commits: ctx.state.totals.commits ?? 0, prs: ctx.state.totals.prs ?? 0, objects: Object.values(ctx.state.objects ?? {}).filter((o) => o.done).length });
const plural = (n, one, few, many) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many}`;

const whileAway = {
  id: 'whileAway',
  group: 'Информация',
  label: '«Пока тебя не было»',
  description: 'При входе в игру: сколько домов и коммитов появилось за время отсутствия и кто сейчас ждёт тебя — со ссылками-телепортами.',
  presets: ['basic'],
  async onPlayerJoin(ctx, name) {
    ctx.state.players ??= {};
    const prev = ctx.state.players[name];
    const now = snapshot(ctx);
    const waiting = ctx.sessions().filter((s) => ['permission', 'question'].includes(ctx.rt(s).waiting?.kind) && s.at);
    if (prev && Date.now() - prev.seen > 10 * 60000) {
      const d = { houses: now.houses - prev.snap.houses, commits: now.commits - prev.snap.commits, prs: now.prs - prev.snap.prs, objects: now.objects - (prev.snap.objects ?? 0) };
      const bits = [d.houses > 0 && plural(d.houses, 'дом', 'дома', 'домов'), d.objects > 0 && plural(d.objects, 'скамейка/дерево', 'скамейки/деревья', 'скамеек/деревьев'), d.commits > 0 && plural(d.commits, 'коммит', 'коммита', 'коммитов'), d.prs > 0 && `${d.prs} PR`].filter(Boolean);
      const hours = (Date.now() - prev.seen) / 3600000;
      const away = hours >= 1 ? `${Math.floor(hours)} ч` : `${Math.round(hours * 60)} мин`;
      if (bits.length) await ctx.tellraw(name, [{ text: `Пока тебя не было (${away}): `, color: 'gold' }, { text: bits.join(', '), color: 'yellow' }]);
    }
    for (const s of waiting.slice(0, 5)) {
      const [x, y, z] = ctx.siteOf(s.at).front;
      await ctx.tellraw(name, [{ text: '  ⌛ ', color: 'red' }, { text: s.name, color: 'yellow' }, { text: ' ждёт тебя ', color: 'gray' }, { text: '[телепорт]', color: 'aqua', click_event: { action: 'run_command', command: `/tp @s ${x + 0.5} ${y} ${z + 2.5}` } }]);
    }
  },
  onPlayers(ctx, names) {
    ctx.state.players ??= {};
    const snap = snapshot(ctx);
    for (const n of names) ctx.state.players[n] = { seen: Date.now(), snap };
    const keys = Object.keys(ctx.state.players);
    if (keys.length > 50) for (const k of keys.sort((a, b) => ctx.state.players[a].seen - ctx.state.players[b].seen).slice(0, keys.length - 50)) delete ctx.state.players[k];
  },
};

export default [townRank, francs, matterhorn, townHall, locatorBar, whileAway];
