// City-level progress and information: ideas 19 (district rank Weiler → Dorf → Städtli → Stadt),
// 20 (francs for tokens, read from the transcript's usage numbers only), 21 (the Matterhorn progress
// bar on the nearest peak), 24 (the town hall dialog), 25 (builders on the locator bar),
// 26 ("while you were away" on joining).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureDatapack } from './datapack.mjs';
import { t } from '../i18n.mjs';
import { summitList } from '../smallforms.mjs';

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
      `title @a subtitle ${ctx.textJson(t('town.rank.up', { name: d.name, title }), 'yellow')}`,
      `title @a title ${ctx.textJson(title, color)}`,
    ]);
    if (rank === 3) ctx.achieve('stadt');
  }
}

const townRank = {
  id: 'townRank',
  group: 'progress',
  label: 'Settlement rank',
  description: 'A district grows with its number of houses: Weiler → Dorf (3) → Städtli (8) → Stadt (15). A new name over the square, a monument and a title on promotion.',
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
  group: 'progress',
  label: 'Francs for tokens',
  description: 'Over the main square, a "Kasse: CHF 12 480" board: 1 franc per 1000 tokens (only the usage numbers are read from transcripts).',
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
    // Only when the square is loaded (a player is near): summon once, then just update the text. The fixed
    // UUID keeps a second board from appearing when the check runs before the square's entities loaded.
    ctx.fx.push(async (cmd) => {
      await cmd(`execute if loaded ${Math.floor(x)} ${y} ${Math.floor(z)} unless entity @e[type=minecraft:text_display,tag=alps_kasse] run summon minecraft:text_display ${x} ${y} ${z} {UUID:[I;1097887603,1801548645,-1414812757,1347109971],Tags:["alps","alps_kasse"],billboard:"center",shadow:1b,background:1073741824,transformation:{left_rotation:[0f,0f,0f,1f],right_rotation:[0f,0f,0f,1f],translation:[0f,0f,0f],scale:[2f,2f,2f]}}`);
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

// The flag pole stands four blocks west of the summit, clear of the viewpoint shelter and its cross
// (economy's summit object, 5 x 5 around the peak); the flag flies away from it. Everything is placed
// relative to the ground of the pole's own column.
const FLAG_V = 2;
function tierCommands(peak, tier) {
  const { x, y, z } = peak;
  const out = [];
  if (tier === 1) {
    const at = (dx, dy, block) => `execute positioned ${x - 4} ${y + 20} ${z} positioned over motion_blocking_no_leaves run setblock ~${dx} ~${dy} ~ ${block}`;
    // The pole first; after it, "over motion_blocking" of its column is the air just above its top.
    out.push(`execute positioned ${x - 4} ${y + 20} ${z} positioned over motion_blocking_no_leaves run fill ~ ~ ~ ~ ~5 ~ spruce_fence keep`);
    for (let i = 1; i <= 5; i++)
      for (let j = 0; j < 5; j++) {
        const white = (j === 2 && i >= 2 && i <= 4) || (i === 3 && j >= 1 && j <= 3);
        out.push(at(-i, 2 + j - 6, white ? 'white_concrete' : 'red_concrete'));
      }
    out.push(at(0, 0, 'lantern'));
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

/**
 * The first version put the flag pole on the summit itself, through the viewpoint shelter's roof and
 * cross: take that flag down, rebuild the shelter from its own list and raise the flag beside it.
 */
function moveFlag(ctx, peak) {
  const { x, y, z } = peak;
  const r = { x1: x - 14, z1: z - 14, x2: x + 14, z2: z + 14 };
  const cmds = [
    `fill ${x + 1} ${y + 2} ${z} ${x + 5} ${y + 6} ${z} air replace minecraft:red_concrete`,
    `fill ${x + 1} ${y + 2} ${z} ${x + 5} ${y + 6} ${z} air replace minecraft:white_concrete`,
    `fill ${x} ${y} ${z} ${x} ${y + 6} ${z} air replace minecraft:spruce_fence`,
    `fill ${x} ${y} ${z} ${x} ${y + 6} ${z} air replace minecraft:lantern`,
  ];
  const summit = Object.values(ctx.state.objects ?? {}).find((o) => o.type === 'summit' && o.placed > 0);
  if (summit) for (const b of summitList().slice(0, summit.done ? undefined : summit.placed)) cmds.push(`setblock ${summit.x0 + b.x} ${summit.y0 + b.y} ${summit.z0 + b.z} ${b.block}`);
  cmds.push(...tierCommands(peak, 1));
  ctx.fx.push(() => ctx.holdArea('matterhorn', r, 10000), { cost: 2 });
  ctx.fx.later(2500, cmds, { cost: 20 });
  ctx.fx.later(2600, () => {
    peak.flagV = FLAG_V;
    ctx.save();
    ctx.log('Matterhorn flag moved beside the summit shelter');
  });
}

const matterhorn = {
  id: 'matterhorn',
  group: 'progress',
  label: 'Matterhorn progress bar',
  description: 'At 10 houses a Swiss flag goes up on the nearest peak, then every 10 houses add a new ring of lanterns. Visible at night from the valley.',
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
    if ((peak.tiers ?? 0) >= 1 && (peak.flagV ?? 1) < FLAG_V) return moveFlag(ctx, peak);
    const want = Math.min(12, Math.floor((ctx.state.totals.houses ?? 0) / 10));
    const built = peak.tiers ?? 0;
    if (built >= want) return;
    const tier = built + 1;
    const r = { x1: peak.x - 14, z1: peak.z - 14, x2: peak.x + 14, z2: peak.z + 14 };
    ctx.fx.push(() => ctx.holdArea('matterhorn', r, 8000), { cost: 2 });
    ctx.fx.later(2500, tierCommands(peak, tier));
    ctx.fx.later(2600, () => {
      peak.tiers = tier;
      if (tier === 1) peak.flagV = FLAG_V;
      ctx.save();
      ctx.log(`Matterhorn tier ${tier}`);
    });
  },
};

// --- 24: the town hall — a dialog with a teleport and a "follow" button for every builder, waiting ones first.

// Follow buttons can't run two commands (gamemode + spectate), so they set a trigger value that the
// bridge resolves: index in followTargets -> session id.
let followTargets = [];

function hallDialog(ctx) {
  const order = (s) => {
    const w = ctx.rt(s).waiting?.kind;
    return w === 'permission' || w === 'question' ? 0 : s.active ? 1 : 2;
  };
  const actions = [];
  let size = 300;
  followTargets = [];
  for (const s of ctx.sessions().filter((x) => x.at).sort((a, b) => order(a) - order(b))) {
    const site = ctx.siteOf(s.at);
    if (!site) continue;
    const o = order(s);
    const [x, y, z] = site.front;
    const pct = Math.floor((100 * site.rec.placed) / Math.max(1, site.rec.total));
    const label = `${o === 0 ? '⌛ ' : o === 1 ? '⚒ ' : '☾ '}${ctx.cleanText(s.name, 22)} · ${ctx.cleanText(site.label, 18)} ${pct}%`;
    // Teleport next to the builder itself (falls back to the plot front if it isn't loaded/spawned).
    const tp = { label: { text: label, color: o === 0 ? 'red' : o === 1 ? 'green' : 'gray' }, tooltip: { text: t('town.hall.tp') }, action: { type: 'run_command', command: `/execute unless entity ${ctx.builderSel(s)} run tp @s ${x + 0.5} ${y} ${z + 2.5}` } };
    const tpLive = { ...tp, action: { type: 'run_command', command: `/tp @s ${ctx.builderSel(s)}` } };
    const follow = { label: { text: '👁', color: 'aqua' }, tooltip: { text: t('town.hall.follow') }, width: 30, action: { type: 'run_command', command: `/trigger alps_follow set ${followTargets.length + 1}` } };
    const entry = [s.at && ctx.rt(s).spawned !== false ? tpLive : tp, follow];
    const len = Buffer.byteLength(JSON.stringify(entry));
    if (size + len > 1250) break; // one RCON packet
    size += len;
    followTargets.push(s.id);
    actions.push(...entry);
  }
  const sq = ctx.square();
  if (sq) actions.push({ label: { text: `⛰ ${t('town.hall.centre', { city: ctx.config.cityName })}`, color: 'gold' }, action: { type: 'run_command', command: `/tp @s ${ctx.state.city.cx} ${sq.y + 2} ${ctx.state.city.cz + 7}` } });
  actions.push({ label: { text: `🗺 ${t('town.hall.map')}`, color: 'aqua' }, tooltip: { text: t('town.hall.mapTip') }, action: { type: 'open_url', url: `http://127.0.0.1:${ctx.port()}/map` } });
  actions.push({ label: { text: `⚙ ${t('town.hall.settings')}`, color: 'aqua' }, width: 30, action: { type: 'open_url', url: `http://127.0.0.1:${ctx.port()}/` } });
  const body = { type: 'plain_message', contents: { text: followTargets.length ? t('town.hall.body') : t('town.hall.empty') } };
  return { type: 'multi_action', title: { text: t('town.hall.title', { city: ctx.config.cityName }) }, body, actions, columns: 2 };
}

const townHall = {
  id: 'townHall',
  group: 'info',
  label: 'Town hall',
  description: 'A window with every builder: those waiting for you on top, click to teleport. Opens from the pause menu or the [Town hall] link in chat.',
  presets: ['basic'],
  async setup(ctx) {
    await ctx.cmd('scoreboard objectives add alps_hall trigger');
    await ctx.cmd('scoreboard objectives add alps_follow trigger');
    await ensureDatapack(ctx).catch(() => false); // pause-menu button; the chat link works without it
  },
  onPlayers(ctx) {
    ctx.fx.push('scoreboard players enable @a alps_hall', { key: 'hall:enable' });
    ctx.fx.push('scoreboard players enable @a alps_follow', { key: 'follow:enable' });
  },
  async onPlayerJoin(ctx, name) {
    await ctx.tellraw(name, [{ text: '  ⌂ ', color: 'gray' }, { text: `[${t('town.hall.name')}]`, color: 'aqua', click_event: { action: 'run_command', command: '/trigger alps_hall' }, hover_event: { action: 'show_text', value: t('town.hall.linkTip') } }, { text: `  ${t('town.hall.link')}`, color: 'gray' }]);
  },
  async onTick(ctx, now) {
    if (now < (townHall.next ?? 0)) return;
    townHall.next = now + 1000;
    await followRequests(ctx);
    if (!(await ctx.cmd('execute if entity @a[scores={alps_hall=1..}]')).includes('passed')) return;
    for (const name of ctx.players()) {
      if (!(await ctx.cmd(`execute if entity @a[name=${name},scores={alps_hall=1..}]`)).includes('passed')) continue;
      await ctx.cmd(`scoreboard players set ${name} alps_hall 0`);
      await ctx.cmd(`scoreboard players enable ${name} alps_hall`);
      await ctx.cmd(`dialog show ${name} ${JSON.stringify(hallDialog(ctx))}`);
    }
  },
};

/** Resolves "👁" clicks: spectator camera attached to the chosen builder. */
async function followRequests(ctx) {
  if (!(await ctx.cmd('execute if entity @a[scores={alps_follow=1..}]')).includes('passed')) return;
  for (const name of ctx.players()) {
    const out = await ctx.cmd(`scoreboard players get ${name} alps_follow`);
    const n = Number(out.match(/has (\d+)/)?.[1] ?? 0);
    if (!n) continue;
    await ctx.cmd(`scoreboard players set ${name} alps_follow 0`);
    await ctx.cmd(`scoreboard players enable ${name} alps_follow`);
    const s = ctx.sessions().find((x) => x.id === followTargets[n - 1]);
    if (!s || !(await ctx.cmd(`execute if entity ${ctx.builderSel(s)}`)).includes('passed')) {
      await ctx.tellraw(name, [{ text: t('town.follow.gone'), color: 'gray' }]);
      continue;
    }
    await ctx.cmd(`gamemode spectator ${name}`);
    await ctx.cmd(`spectate ${ctx.builderSel(s)} ${name}`);
    await ctx.tellraw(name, [
      { text: `👁 ${t('town.follow.on')} `, color: 'gray' }, { text: ctx.cleanText(s.name, 26), color: 'yellow' },
      { text: `. ${t('town.follow.shift')} `, color: 'gray' },
      { text: `[${t('town.follow.creative')}]`, color: 'aqua', click_event: { action: 'run_command', command: '/gamemode creative' } },
      { text: ' ', color: 'gray' },
      { text: `[${t('town.hall.name')}]`, color: 'aqua', click_event: { action: 'run_command', command: '/trigger alps_hall' } },
    ]);
  }
}

// --- 25: builders on the locator bar; waiting ones red.

const locatorBar = {
  id: 'locatorBar',
  group: 'info',
  label: 'Builders on the locator bar',
  description: 'Builders show up on the locator bar; those waiting for you as a red dot. (The bar is visible in survival/adventure mode.)',
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

const whileAway = {
  id: 'whileAway',
  group: 'info',
  label: '"While you were away"',
  description: 'When you join: how many houses and commits appeared while you were away and who is waiting for you now, with teleport links.',
  presets: ['basic'],
  async onPlayerJoin(ctx, name) {
    ctx.state.players ??= {};
    const prev = ctx.state.players[name];
    const now = snapshot(ctx);
    const waiting = ctx.sessions().filter((s) => ['permission', 'question'].includes(ctx.rt(s).waiting?.kind) && s.at);
    if (prev && Date.now() - prev.seen > 10 * 60000) {
      const d = { houses: now.houses - prev.snap.houses, commits: now.commits - prev.snap.commits, prs: now.prs - prev.snap.prs, objects: now.objects - (prev.snap.objects ?? 0) };
      const bits = [d.houses > 0 && t('common.houses', { count: d.houses }), d.objects > 0 && t('town.away.objects', { count: d.objects }), d.commits > 0 && t('town.away.commits', { count: d.commits }), d.prs > 0 && `${d.prs} PR`].filter(Boolean);
      const hours = (Date.now() - prev.seen) / 3600000;
      const away = hours >= 1 ? t('status.ago.hours', { count: Math.floor(hours) }) : t('status.ago.min', { count: Math.round(hours * 60) });
      if (bits.length) await ctx.tellraw(name, [{ text: `${t('town.away.title', { away })} `, color: 'gold' }, { text: bits.join(', '), color: 'yellow' }]);
    }
    for (const s of waiting.slice(0, 5)) {
      const [x, y, z] = ctx.siteOf(s.at).front;
      await ctx.tellraw(name, [{ text: '  ⌛ ', color: 'red' }, { text: s.name, color: 'yellow' }, { text: ` ${t('town.away.waiting')} `, color: 'gray' }, { text: t('common.teleport'), color: 'aqua', click_event: { action: 'run_command', command: `/tp @s ${x + 0.5} ${y} ${z + 2.5}` } }]);
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
