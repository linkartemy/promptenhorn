// Idea 22 + the chronicle — the history of every building: which chat built it, for which project,
// when, how long it actually worked, what it did (reads, edits, commands…), commits, tests, subagents,
// model. The bridge records this for every site (state: plot.chron / object.chron); this feature shows it:
//   - a lectern with a written book "Хроника дома" beside the door (rewritten at every stage);
//   - an invisible interaction box at the door: right-click it to get a short summary in chat, with the
//     session id and a copyable `claude --resume <id>`;
//   - `/trigger chronicle`: the summary of the nearest building;
//   - the "Летопись города" section on the settings page (GET /api/chronicle, POST /api/teleport).
// The prompt text is never stored or shown unless the opt-in `chronicleWithPrompt` is on.
const CAT_LABELS = { read: 'чтение', edit: 'правки', bash: 'команды', web: 'веб', agent: 'субагенты', plan: 'планы', mcp: 'MCP', other: 'прочее' };
const plotTag = (key) => `alps_chron_${String(key).replace(',', '_')}`;

const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
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
    const site = ctx.siteOf(`obj:${o.id}`);
    out.push({ key: `obj:${o.id}`, label: site.label, type: o.type, district: state.districts[o.district]?.name ?? (o.kind === 'tree' ? 'Склоны' : 'Город'), public: !!o.public, done: !!o.done, pct: Math.floor((100 * o.placed) / Math.max(1, o.total)), pos: site.front, chron: o.chron });
  }
  return out.sort((a, b) => (b.chron?.start ?? 0) - (a.chron?.start ?? 0));
}

function contributors(chron) {
  return Object.entries(chron?.sessions ?? {}).sort((a, b) => (b[1].blocks ?? 0) - (a[1].blocks ?? 0));
}

/** Chat summary as text components (for tellraw). */
function summary(ctx, rec) {
  const parts = [{ text: '' }, { text: `✦ ${rec.label}`, color: 'gold' }, { text: rec.district ? ` · ${rec.district}` : '', color: 'yellow' }];
  parts.push({ text: `\n  ${rec.done ? 'готово' : `строится, ${rec.pct}%`}${rec.stage ? `, этап ${rec.stage}` : ''} · начато ${fmtDate(rec.chron?.start)}${rec.chron?.end ? `, готово ${fmtDate(rec.chron.end)}` : ''}`, color: 'gray' });
  for (const [sid, c] of contributors(rec.chron).slice(0, 3)) {
    const acts = Object.entries(c.actions ?? {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${CAT_LABELS[k] ?? k} ${v}`).join(', ');
    parts.push({ text: `\n  ✎ ${c.name}`, color: 'white' }, { text: ` — ${c.blocks} блоков, ${minutes(c.activeSec)} мин работы${c.model ? `, ${c.model}` : ''}`, color: 'gray' });
    if (acts) parts.push({ text: `\n     ${acts}`, color: 'dark_gray' });
    const extra = [c.commits && `коммитов ${c.commits}`, (c.testsOk || c.testsFail) && `тесты ✔${c.testsOk} ✘${c.testsFail}`, c.agents && `субагентов ${c.agents}`, c.prs && `PR ${c.prs}`].filter(Boolean).join(', ');
    if (extra) parts.push({ text: `\n     ${extra}`, color: 'dark_gray' });
    parts.push({ text: '\n     ' }, { text: `[claude --resume ${sid.slice(0, 8)}…]`, color: 'aqua', click_event: { action: 'copy_to_clipboard', value: `claude --resume ${sid}` }, hover_event: { action: 'show_text', value: 'Клик — скопировать команду, чтобы продолжить этот чат' } });
    const task = ctx.on('chronicleWithPrompt') && ctx.state.sessions[sid]?.task;
    if (task) parts.push({ text: `\n     «${task}»`, color: 'gray', italic: true });
  }
  return parts;
}

/** Written book pages for the lectern (plain text, short enough for one RCON packet). */
function bookPages(ctx, rec) {
  const pages = [];
  const head = `${rec.label}\n${rec.district}\n\nНачато: ${fmtDate(rec.chron?.start)}\n${rec.chron?.end ? `Готово: ${fmtDate(rec.chron.end)}` : ''}${rec.stage ? `\nЭтап: ${rec.stage}` : ''}`;
  pages.push(head);
  for (const [sid, c] of contributors(rec.chron).slice(0, 2)) {
    const acts = Object.entries(c.actions ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${CAT_LABELS[k] ?? k}: ${v}`).join('\n');
    let page = `${c.name}\n\nБлоков: ${c.blocks}\nРаботы: ${minutes(c.activeSec)} мин\n${acts}\nКоммитов: ${c.commits ?? 0}\nТесты: ✔${c.testsOk ?? 0} ✘${c.testsFail ?? 0}\nСубагентов: ${c.agents ?? 0}\n\n${sid.slice(0, 18)}`;
    const task = ctx.on('chronicleWithPrompt') && ctx.state.sessions[sid]?.task;
    if (task) page += `\n\n«${ctx.cleanText(task, 120)}»`;
    pages.push(page);
  }
  return pages;
}

async function placeChronicle(ctx, plot, meta) {
  const rec = records(ctx).find((r) => r.key === `plot:${plot.key}`);
  if (!rec) return;
  // Lectern with the book.
  if (meta.lectern) {
    const { x, y, z, facing } = meta.lectern;
    const [wx, wy, wz] = [plot.x0 + x, plot.y + y, plot.z0 + z];
    const title = ctx.cleanText(`Хроника: ${rec.label}`, 32);
    let pages = bookPages(ctx, rec);
    let command;
    for (;;) {
      const snbtPages = pages.map((p) => ctx.snbt(p)).join(',');
      command = `data merge block ${wx} ${wy} ${wz} {Book:{id:"minecraft:written_book",count:1,components:{"minecraft:written_book_content":{title:${ctx.snbt(title)},author:"Claude",pages:[${snbtPages}]}}}}`;
      if (Buffer.byteLength(command) < 1350 || pages.length === 1) break;
      pages = pages.slice(0, -1);
    }
    await ctx.cmd(`setblock ${wx} ${wy} ${wz} minecraft:lectern[facing=${facing},has_book=true]`);
    await ctx.cmd(command);
  }
  // Interaction box in front of the door: right-click for the summary in chat.
  const door = meta.doors.sort((a, b) => a.y - b.y)[0];
  if (door) {
    const tag = plotTag(plot.key);
    const [x, y, z] = [plot.x0 + door.x + door.out[0] + 0.5, plot.y + door.y, plot.z0 + door.z + door.out[1] + 0.5];
    await ctx.cmd(`kill @e[type=minecraft:interaction,tag=${tag}]`);
    await ctx.cmd(`summon minecraft:interaction ${x} ${y} ${z} {Tags:["alps","alps_chron","${tag}"],width:0.9f,height:2.1f,response:1b}`);
  }
}

const chronicle = {
  id: 'chronicle',
  group: 'Прогресс',
  label: 'Хроника дома',
  description: 'У двери каждого дома — кафедра с книгой: кто и когда строил, сколько работал, коммиты, тесты. Клик по двери — сводка в чате и команда claude --resume.',
  presets: ['basic'],
  async setup(ctx) {
    await ctx.cmd('scoreboard objectives add chronicle trigger');
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
    // Clicked door boxes.
    const hits = await ctx.cmd('execute as @e[type=minecraft:interaction,tag=alps_chron] if data entity @s interaction run tag @s add alps_chron_hit');
    if (hits.includes('Added')) {
      for (let i = 0; i < 4; i++) {
        const tags = await ctx.cmd('data get entity @e[type=minecraft:interaction,tag=alps_chron_hit,limit=1] Tags');
        const m = tags.match(/alps_chron_(-?\d+)_(-?\d+)/);
        if (!m) break;
        const tag = `alps_chron_${m[1]}_${m[2]}`;
        const sel = `@e[type=minecraft:interaction,tag=${tag},tag=alps_chron_hit,limit=1]`;
        const rec = records(ctx).find((r) => r.key === `plot:${m[1]},${m[2]}`);
        if (rec) await ctx.cmd(`execute as ${sel} on target run tellraw @s ${JSON.stringify(summary(ctx, rec))}`);
        await ctx.cmd(`data remove entity ${sel} interaction`);
        await ctx.cmd(`tag ${sel} remove alps_chron_hit`);
      }
    }
    // /trigger chronicle: the nearest recorded building.
    if (!(await ctx.cmd('execute if entity @a[scores={chronicle=1..}]')).includes('passed')) return;
    for (const name of ctx.players()) {
      if (!(await ctx.cmd(`execute if entity @a[name=${name},scores={chronicle=1..}]`)).includes('passed')) continue;
      await ctx.cmd(`scoreboard players set ${name} chronicle 0`);
      await ctx.cmd(`scoreboard players enable ${name} chronicle`);
      const pos = (await ctx.cmd(`data get entity ${name} Pos`)).match(/\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/);
      if (!pos) continue;
      const [px, , pz] = pos.slice(1).map(Number);
      const near = records(ctx).map((r) => ({ r, d: Math.hypot(r.pos[0] - px, r.pos[2] - pz) })).sort((a, b) => a.d - b.d)[0];
      if (!near || near.d > 80) await ctx.tellraw(name, [{ text: 'Рядом нет построек с хроникой.', color: 'gray' }]);
      else await ctx.cmd(`tellraw ${name} ${JSON.stringify(summary(ctx, near.r))}`);
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
      if (!rec) throw new Error('unknown building');
      const players = ctx.players();
      const player = players.includes(body.player) ? body.player : players[0];
      if (!player) throw new Error('в игре нет игроков');
      const [x, y, z] = rec.pos;
      await ctx.cmd(`tp ${player} ${x + 0.5} ${y} ${z + 0.5}`);
      return { ok: true, player };
    },
  },
};

const chronicleWithPrompt = {
  id: 'chronicleWithPrompt',
  group: 'Приватность',
  label: 'Текст задачи в хронике',
  description: 'Записывать начало первого сообщения чата (до 200 символов) в книгу и сводку. Выключено во всех пресетах: текст промпта попадает в мир.',
  optIn: true,
  onDisable(ctx) {
    for (const s of Object.values(ctx.state.sessions)) delete s.task; // forget stored prompt text at once
    ctx.save();
  },
};

export default [chronicle, chronicleWithPrompt];
