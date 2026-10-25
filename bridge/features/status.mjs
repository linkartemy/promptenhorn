// Ideas 23 + 7 — what a chat is doing, readable at a glance: a status line under the builder's name
// ("✎ правит · 64%", "⌛ ждёт тебя", "☾ спит 2 ч") and the matching tool in its hand (book for reading,
// brush for edits, pickaxe for shell commands…). Both only send a command when the text or the tool
// category actually changes, so a burst of tool calls costs nothing extra.
const CATS = {
  read: { icon: '⌕', verb: 'читает', item: 'minecraft:book' },
  edit: { icon: '✎', verb: 'правит', item: 'minecraft:brush' },
  bash: { icon: '⚒', verb: 'команды', item: 'minecraft:iron_pickaxe' },
  web: { icon: '✉', verb: 'ищет в сети', item: 'minecraft:compass' },
  agent: { icon: '☺', verb: 'с подмастерьями', item: 'minecraft:bell' },
  plan: { icon: '☰', verb: 'планирует', item: 'minecraft:writable_book' },
  mcp: { icon: '⚙', verb: 'инструменты', item: 'minecraft:amethyst_shard' },
  other: { icon: '⚙', verb: 'работает', item: null },
};
const RECENT_MS = 90000; // a tool category older than this no longer describes what the chat does

function ago(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${Math.max(1, Math.round(min / 10) * 10)} мин`;
  return `${Math.floor(min / 60)} ч`;
}

function statusOf(ctx, s, site) {
  const r = ctx.rt(s);
  const now = Date.now();
  const rec = site?.rec;
  const pct = rec ? Math.floor((20 * rec.placed) / Math.max(1, rec.total)) * 5 : 0; // 5 % steps
  const w = r.waiting;
  if (w?.kind === 'permission') return ['⌛ ждёт твоего разрешения', 'red'];
  if (w?.kind === 'question') return ['? ждёт ответа на вопрос', 'red'];
  if (now < r.limitUntil) return ['⚡ лимит API, пауза', 'yellow'];
  if (now < r.compactUntil) return ['☕ перекур: сжимает память', 'aqua'];
  if (s.active && s.planMode) return ['✐ планирует, стройка ждёт плана', 'light_purple'];
  if (s.active) {
    const c = CATS[r.toolCat] && now - (r.toolAt ?? 0) < RECENT_MS ? CATS[r.toolCat] : CATS.other;
    return [`${c.icon} ${c.verb} · ${pct}%`, 'green'];
  }
  if (String(s.pose).includes('sleeping')) return [`☾ спит ${ago(now - s.lastEvent)}`, 'gray'];
  if (w?.kind === 'idle') return [`… ждёт задачу · ${pct}%`, 'yellow'];
  return [`· отдыхает · ${pct}%`, 'gray'];
}

const status = {
  id: 'status',
  group: 'Строители',
  label: 'Статус под именем',
  description: 'Под ником строителя строка: чем занят чат («✎ правит · 64%»), ждёт ли тебя, спит ли и сколько.',
  presets: ['basic'],
  setup(ctx) {
    for (const s of ctx.sessions()) ctx.rt(s).statusKey = null;
  },
  onBuilderSpawn(ctx, s) {
    ctx.rt(s).statusKey = null;
  },
  onWork(ctx, s, site) {
    const [text, color] = statusOf(ctx, s, site);
    const key = `${text}|${color}`;
    const r = ctx.rt(s);
    if (r.statusKey === key) return;
    r.statusKey = key;
    ctx.fx.push(`data merge entity ${ctx.builderSel(s)} {hide_description:0b,description:${ctx.textJson(text, color)}}`, { key: `desc:${s.id}` });
  },
  onDisable(ctx) {
    for (const s of ctx.sessions()) {
      ctx.rt(s).statusKey = null;
      ctx.fx.push(`data merge entity ${ctx.builderSel(s)} {hide_description:1b}`, { key: `desc:${s.id}` });
    }
  },
};

const toolInHand = {
  id: 'toolInHand',
  group: 'Строители',
  label: 'Инструмент в руке',
  description: 'Строитель держит то, чем сейчас работает чат: книгу (чтение), кисть (правки), кирку (команды), компас (веб), колокольчик (субагенты).',
  presets: ['basic'],
  handPriority: 80,
  handItem(ctx, s) {
    const r = ctx.rt(s);
    if (!s.active || !r.toolCat || Date.now() - (r.toolAt ?? 0) > RECENT_MS) return null;
    return CATS[r.toolCat]?.item ?? null;
  },
  onWork(ctx, s) {
    const r = ctx.rt(s);
    // Switch the moment the category changes, not only every dozen blocks.
    if (!s.active || r.toolCat === r.handCat) return;
    r.handCat = r.toolCat;
    const item = CATS[r.toolCat]?.item;
    if (item) ctx.fx.push(() => ctx.refreshHand(s), { key: `hand:${s.id}` });
  },
};

export default [status, toolInHand];
