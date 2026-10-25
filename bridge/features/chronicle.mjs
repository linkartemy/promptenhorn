// Idea 22 + the chronicle — the history of every building: which chat built it, for which project,
// when, how long it actually worked, what it did (reads, edits, commands…), commits, tests, subagents,
// model. The bridge records this for every site (state: plot.chron / object.chron); this feature shows it:
//   - a lectern with a written book "House chronicle" beside the door (rewritten at every stage);
//   - a small waxed sign beside the door ("⌂ Chronicle"): right-click it for a short summary in chat,
//     with the session id and a copyable `claude --resume <id>` (it runs `/trigger chronicle set <n>`);
//   - `/trigger chronicle`: the summary of the nearest building;
//   - the "City chronicle" section on the settings page (GET /api/chronicle, POST /api/teleport).
// Positions come from the generator markers (door, lectern_spot, sign_spot), else from plotmeta.
// The prompt text is never stored or shown unless the opt-in `chronicleWithPrompt` is on.
import { t, language } from '../i18n.mjs';
import { markersOf } from './markers.mjs';

const CATS = ['read', 'edit', 'bash', 'web', 'agent', 'plan', 'mcp', 'other'];
const catLabel = (k) => (CATS.includes(k) ? t(`chronicle.cat.${k}`) : k);
const plotTag = (key) => `alps_chron_${String(key).replace(',', '_')}`;
const CHRON_VERSION = 2; // 2: sign beside the door instead of an interaction box in front of it
const upgrading = new Set(); // plot keys whose chronicle is being moved to the version-2 spots

const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString(language(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const minutes = (sec) => Math.max(1, Math.round((sec ?? 0) / 60));

/** All recorded buildings and objects, newest first (for the page and for /trigger chronicle). */
export function records(ctx) {
  const out = [];
  const { state } = ctx;
  for (const p of Object.values(state.plots)) {
    if (!p.chron || p.type === 'square' || p.type === 'plaza') continue;
    const site = ctx.siteOf(`plot:${p.key}`);
    out.push({ key: `plot:${p.key}`, label: site.label, type: p.type, district: state.districts[p.district]?.name ?? '', public: !!p.public, done: !!p.done, stage: p.stage, pct: Math.floor((100 * p.placed) / Math.max(1, p.total)), pos: site.front, chron: p.chron });
  }
  for (const o of Object.values(state.objects ?? {})) {
    if (o.kind === 'tree') continue; // the forest on the slopes is anonymous work, not a building
    const site = ctx.siteOf(`obj:${o.id}`);
    out.push({ key: `obj:${o.id}`, label: site.label, type: o.type, district: state.districts[o.district]?.name ?? (o.kind === 'tree' ? t('chronicle.slopes') : t('chronicle.city')), public: !!o.public, done: !!o.done, pct: Math.floor((100 * o.placed) / Math.max(1, o.total)), pos: site.front, chron: o.chron });
  }
  return out.sort((a, b) => (b.chron?.start ?? 0) - (a.chron?.start ?? 0));
}

function contributors(chron) {
  return Object.entries(chron?.sessions ?? {}).sort((a, b) => (b[1].blocks ?? 0) - (a[1].blocks ?? 0));
}

const actionsText = (c, sep, n = 8) => Object.entries(c.actions ?? {}).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${catLabel(k)}${sep}${v}`);

/** Chat summary as text components (for tellraw). */
function summary(ctx, rec) {
  const parts = [{ text: '' }, { text: `✦ ${rec.label}`, color: 'gold' }, { text: rec.district ? ` · ${rec.district}` : '', color: 'yellow' }];
  const state = rec.done ? t('chronicle.done') : t('chronicle.building', { pct: rec.pct });
  const stage = rec.stage ? t('chronicle.stage', { stage: rec.stage }) : '';
  const when = t('chronicle.started', { date: fmtDate(rec.chron?.start) }) + (rec.chron?.end ? t('chronicle.finished', { date: fmtDate(rec.chron.end) }) : '');
  parts.push({ text: `\n  ${state}${stage} · ${when}`, color: 'gray' });
  for (const [sid, c] of contributors(rec.chron).slice(0, 3)) {
    const acts = actionsText(c, ' ').join(', ');
    parts.push({ text: `\n  ✎ ${c.name}`, color: 'white' }, { text: ` — ${t('chronicle.work', { blocks: c.blocks, minutes: minutes(c.activeSec) })}${c.model ? `, ${c.model}` : ''}`, color: 'gray' });
    if (acts) parts.push({ text: `\n     ${acts}`, color: 'dark_gray' });
    const extra = [c.commits && t('chronicle.commits', { count: c.commits }), (c.testsOk || c.testsFail) && t('chronicle.tests', { ok: c.testsOk, fail: c.testsFail }), c.agents && t('chronicle.agents', { count: c.agents }), c.prs && t('chronicle.prs', { count: c.prs })].filter(Boolean).join(', ');
    if (extra) parts.push({ text: `\n     ${extra}`, color: 'dark_gray' });
    parts.push({ text: '\n     ' }, { text: `[claude --resume ${sid.slice(0, 8)}…]`, color: 'aqua', click_event: { action: 'copy_to_clipboard', value: `claude --resume ${sid}` }, hover_event: { action: 'show_text', value: t('chronicle.resume.hover') } });
    const task = ctx.on('chronicleWithPrompt') && ctx.state.sessions[sid]?.task;
    if (task) parts.push({ text: `\n     «${task}»`, color: 'gray', italic: true });
  }
  return parts;
}

/** Written book pages for the lectern (plain text, short enough for one RCON packet). */
function bookPages(ctx, rec) {
  const pages = [];
  const lines = [rec.label, rec.district, '', t('chronicle.book.started', { date: fmtDate(rec.chron?.start) })];
  if (rec.chron?.end) lines.push(t('chronicle.book.finished', { date: fmtDate(rec.chron.end) }));
  if (rec.stage) lines.push(t('chronicle.book.stage', { stage: rec.stage }));
  pages.push(lines.join('\n'));
  for (const [sid, c] of contributors(rec.chron).slice(0, 2)) {
    let page = [c.name, '', t('chronicle.book.blocks', { count: c.blocks }), t('chronicle.book.minutes', { count: minutes(c.activeSec) }), ...actionsText(c, ': ', 4), t('chronicle.book.commits', { count: c.commits ?? 0 }), t('chronicle.book.tests', { ok: c.testsOk ?? 0, fail: c.testsFail ?? 0 }), t('chronicle.book.agents', { count: c.agents ?? 0 }), '', sid.slice(0, 18)].join('\n');
    const task = ctx.on('chronicleWithPrompt') && ctx.state.sessions[sid]?.task;
    if (task) page += `\n\n«${ctx.cleanText(task, 120)}»`;
    pages.push(page);
  }
  return pages;
}

/** Where the lectern, the sign and the door are: generator markers first, else derived from the build list. */
async function spots(ctx, plot, meta) {
  const marks = await markersOf(ctx, plot);
  const one = (kind) => marks?.find((m) => m.kind === kind) ?? null;
  const out = {};
  const door = one('door');
  const lectern = one('lectern_spot');
  if (lectern) out.lectern = { x: lectern.x, y: lectern.y, z: lectern.z, facing: lectern.facing ?? door?.facing ?? 'south' };
  else if (meta.lectern) {
    // Facing points at the reader: the side of the lectern away from the house.
    const d = meta.doors.sort((a, b) => a.y - b.y)[0];
    const facing = d?.dir ?? meta.lectern.facing;
    out.lectern = { x: plot.x0 + meta.lectern.x, y: plot.y + meta.lectern.y, z: plot.z0 + meta.lectern.z, facing };
  }
  const sign = one('sign_spot');
  if (sign) out.sign = { x: sign.x, y: sign.y, z: sign.z, facing: sign.facing ?? door?.facing ?? 'south' };
  else {
    // Beside the lowest door, one block up, on the wall next to the door frame (outside face).
    const d = meta.doors.sort((a, b) => a.y - b.y)[0];
    if (d) {
      const { list } = ctx.buildList(plot);
      const solid = new Set(list.map((b) => `${b.x},${b.y},${b.z}`));
      const [ox, oz] = d.out;
      const [ax, az] = [oz, ox];
      const [wx, wy, wz] = [plot.x0 + d.x, plot.y + d.y + 1, plot.z0 + d.z];
      for (const s of [1, -1]) {
        const wall = `${wx + ax * s},${wy},${wz + az * s}`;
        const cell = `${wx + ax * s + ox},${wy},${wz + az * s + oz}`;
        if (solid.has(wall) && !solid.has(cell)) {
          out.sign = { x: wx + ax * s + ox, y: wy, z: wz + az * s + oz, facing: d.dir };
          break;
        }
      }
    }
  }
  return out;
}

/** Stable small number for the sign's `/trigger chronicle set <n>` (1 means "the nearest building"). */
function chronId(ctx, plot) {
  if (!plot.chronId) {
    ctx.state.chronNext = Math.max(2, ctx.state.chronNext ?? 2);
    plot.chronId = ctx.state.chronNext++;
    ctx.save();
  }
  return plot.chronId;
}

async function placeChronicle(ctx, plot, meta) {
  const rec = records(ctx).find((r) => r.key === `plot:${plot.key}`);
  if (!rec) return;
  const at = await spots(ctx, plot, meta);
  if ((plot.chronV ?? 1) < CHRON_VERSION && meta.lectern && at.lectern) {
    // The first version put the lectern on a spot derived from the build list; markers may name another one.
    const [ox, oy, oz] = [plot.x0 + meta.lectern.x, plot.y + meta.lectern.y, plot.z0 + meta.lectern.z];
    if (ox !== at.lectern.x || oy !== at.lectern.y || oz !== at.lectern.z) await ctx.cmd(`execute if block ${ox} ${oy} ${oz} minecraft:lectern run setblock ${ox} ${oy} ${oz} air`);
  }
  if (at.lectern) {
    const { x, y, z, facing } = at.lectern;
    const title = ctx.cleanText(t('chronicle.book.title', { label: rec.label }), 32);
    let pages = bookPages(ctx, rec);
    let command;
    for (;;) {
      const snbtPages = pages.map((p) => ctx.snbt(p)).join(',');
      command = `data merge block ${x} ${y} ${z} {Book:{id:"minecraft:written_book",count:1,components:{"minecraft:written_book_content":{title:${ctx.snbt(title)},author:"Claude",pages:[${snbtPages}]}}}}`;
      if (Buffer.byteLength(command) < 1350 || pages.length === 1) break;
      pages = pages.slice(0, -1);
    }
    // Only into air or onto our own lectern: never over something a player built there.
    const out = await ctx.cmd(`execute if block ${x} ${y} ${z} #minecraft:replaceable run setblock ${x} ${y} ${z} minecraft:lectern[facing=${facing},has_book=true]`);
    if (out.includes('Changed') || (await ctx.cmd(`execute if block ${x} ${y} ${z} minecraft:lectern`)).includes('passed')) await ctx.cmd(command);
  }
  await ctx.cmd(`kill @e[type=minecraft:interaction,tag=${plotTag(plot.key)}]`); // the old click box in front of the door
  if (at.sign) {
    const { x, y, z, facing } = at.sign;
    const n = chronId(ctx, plot);
    const click = { action: 'run_command', command: `/trigger chronicle set ${n}` };
    const line = (text, color) => `{text:${ctx.snbt(text)},color:"${color}",click_event:{action:"${click.action}",command:"${click.command}"}}`;
    const lines = [line(t('chronicle.sign.title'), 'dark_blue'), line(ctx.cleanText(rec.label, 15), 'black'), line(ctx.cleanText(rec.district, 15), 'dark_gray'), line(t('chronicle.sign.click'), 'dark_green')];
    const nbt = `{is_waxed:1b,front_text:{has_glowing_text:0b,color:"black",messages:[${lines.join(',')}]},back_text:{messages:['','','','']}}`;
    const wood = /chalet|hut|farmhouse/.test(plot.type) ? 'spruce' : 'oak';
    const placed = await ctx.cmd(`execute if block ${x} ${y} ${z} #minecraft:replaceable run setblock ${x} ${y} ${z} minecraft:${wood}_wall_sign[facing=${facing},waterlogged=false]${nbt}`);
    if (!placed.includes('Changed')) await ctx.cmd(`execute if block ${x} ${y} ${z} #minecraft:wall_signs run data merge block ${x} ${y} ${z} ${nbt}`);
  }
  plot.chronV = CHRON_VERSION;
  plot.chronLang = language(); // books and signs are rewritten after a language switch
  upgrading.delete(plot.key);
}

async function tellSummary(ctx, name, rec) {
  if (rec) await ctx.cmd(`tellraw ${name} ${JSON.stringify(summary(ctx, rec))}`);
}

const chronicle = {
  id: 'chronicle',
  group: 'progress',
  label: 'House chronicle',
  description: 'A lectern with a book beside every door: who built it and when, how long it worked, commits, tests. Click the sign by the door for a summary in chat and the claude --resume command.',
  presets: ['basic'],
  async setup(ctx) {
    await ctx.cmd('scoreboard objectives add chronicle trigger');
    // Interaction boxes of the first version stood in front of doors and swallowed the clicks on them.
    await ctx.cmd('kill @e[type=minecraft:interaction,tag=alps_chron]');
  },
  async onFinish(ctx, s, plot, { meta }) {
    if (plot.type === 'park') return;
    await placeChronicle(ctx, plot, meta);
  },
  onPlayers(ctx) {
    ctx.fx.push('scoreboard players enable @a chronicle', { key: 'chronicle:enable' });
  },
  async onTick(ctx, now) {
    if (now < (chronicle.next ?? 0)) return;
    chronicle.next = now + 1000;
    // Finished houses from the first version (or written in another language): move their click box onto
    // a sign and rewrite the book, one house at a time.
    if (now > (chronicle.upgradeAt ?? 0)) {
      chronicle.upgradeAt = now + 3000;
      const old = Object.values(ctx.state.plots).find((p) => p.done && p.chron && ((p.chronV ?? 1) < CHRON_VERSION || (p.chronLang && p.chronLang !== language())) && !upgrading.has(p.key) && !['square', 'plaza', 'park'].includes(p.type));
      if (old) {
        ctx.fx.push(async () => {
          await ctx.holdArea(`chron:${old.key}`, ctx.plotRect(old.cell), 4000);
          ctx.fx.later(2500, () => placeChronicle(ctx, old, ctx.meta(old)), { key: `chron:${old.key}`, cost: 4 });
        }, { key: `chronhold:${old.key}`, cost: 2 });
        upgrading.add(old.key); // placeChronicle marks it done (retried after a restart if it never ran)
      }
    }
    // /trigger chronicle (1 = the nearest building) and clicks on door signs (n = that building).
    if (!(await ctx.cmd('execute if entity @a[scores={chronicle=1..}]')).includes('passed')) return;
    for (const name of ctx.players()) {
      const out = await ctx.cmd(`scoreboard players get ${name} chronicle`);
      const n = Number(out.match(/has (\d+)/)?.[1] ?? 0);
      if (!n) continue;
      await ctx.cmd(`scoreboard players set ${name} chronicle 0`);
      await ctx.cmd(`scoreboard players enable ${name} chronicle`);
      if (n >= 2) {
        const plot = Object.values(ctx.state.plots).find((p) => p.chronId === n);
        await tellSummary(ctx, name, plot && records(ctx).find((r) => r.key === `plot:${plot.key}`));
        continue;
      }
      const pos = (await ctx.cmd(`data get entity ${name} Pos`)).match(/\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/);
      if (!pos) continue;
      const [px, , pz] = pos.slice(1).map(Number);
      const near = records(ctx).map((r) => ({ r, d: Math.hypot(r.pos[0] - px, r.pos[2] - pz) })).sort((a, b) => a.d - b.d)[0];
      if (!near || near.d > 80) await ctx.tellraw(name, [{ text: t('chronicle.nothingNear'), color: 'gray' }]);
      else await tellSummary(ctx, name, near.r);
    }
  },
  async onDisable(ctx) {
    await ctx.cmd('kill @e[type=minecraft:interaction,tag=alps_chron]');
  },
  routes: {
    'GET /api/chronicle': (ctx) => ({
      players: ctx.players(),
      records: records(ctx).map(({ chron, ...r }) => ({
        ...r,
        start: chron?.start ?? null,
        end: chron?.end ?? null,
        contributors: contributors(chron).map(([sid, c]) => ({ session: sid, name: c.name, blocks: c.blocks, minutes: minutes(c.activeSec), actions: c.actions, commits: c.commits ?? 0, testsOk: c.testsOk ?? 0, testsFail: c.testsFail ?? 0, agents: c.agents ?? 0, model: c.model ?? null })),
      })),
    }),
    'POST /api/teleport': async (ctx, body) => {
      const rec = records(ctx).find((r) => r.key === body?.key);
      if (!rec) throw new Error(t('chronicle.api.unknown'));
      const players = ctx.players();
      const player = players.includes(body.player) ? body.player : players[0];
      if (!player) throw new Error(t('chronicle.api.noPlayers'));
      const [x, y, z] = rec.pos;
      await ctx.cmd(`tp ${player} ${x + 0.5} ${y} ${z + 0.5}`);
      return { ok: true, player };
    },
  },
};

const chronicleWithPrompt = {
  id: 'chronicleWithPrompt',
  group: 'privacy',
  label: 'Task text in the chronicle',
  description: "Write the start of the chat's first message (up to 200 characters) into the book and the summary. Off in every preset: the prompt text ends up in the world.",
  optIn: true,
  onDisable(ctx) {
    for (const s of Object.values(ctx.state.sessions)) delete s.task; // forget stored prompt text at once
    ctx.save();
  },
};

export default [chronicle, chronicleWithPrompt];
