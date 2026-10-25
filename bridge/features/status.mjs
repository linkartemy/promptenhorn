import { t } from '../i18n.mjs';

// Ideas 23 + 7 — what a chat is doing, readable at a glance: a status line under the builder's name
// ("✎ правит · 64%", "⌛ ждёт тебя", "☾ спит 2 ч") and the matching tool in its hand (book for reading,
// brush for edits, pickaxe for shell commands…). Both only send a command when the text or the tool
// category actually changes, so a burst of tool calls costs nothing extra.
const CATS = {
  read: { icon: '⌕', item: 'minecraft:book' },
  edit: { icon: '✎', item: 'minecraft:brush' },
  bash: { icon: '⚒', item: 'minecraft:iron_pickaxe' },
  web: { icon: '✉', item: 'minecraft:compass' },
  agent: { icon: '☺', item: 'minecraft:bell' },
  plan: { icon: '☰', item: 'minecraft:writable_book' },
  mcp: { icon: '⚙', item: 'minecraft:amethyst_shard' },
  other: { icon: '⚙', item: null },
};
const RECENT_MS = 90000; // a tool category older than this no longer describes what the chat does

function ago(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 60) return t('status.ago.min', { count: Math.max(1, Math.round(min / 10) * 10) });
  return t('status.ago.hours', { count: Math.floor(min / 60) });
}

function statusOf(ctx, s, site) {
  const r = ctx.rt(s);
  const now = Date.now();
  const rec = site?.rec;
  const pct = rec ? Math.floor((20 * rec.placed) / Math.max(1, rec.total)) * 5 : 0; // 5 % steps
  const w = r.waiting;
  if (w?.kind === 'permission') return [`⌛ ${t('status.permission')}`, 'red'];
  if (w?.kind === 'question') return [`? ${t('status.question')}`, 'red'];
  if (!s.active && now < r.limitUntil) return [`⚡ ${t('status.limit')}`, 'yellow']; // a new prompt ends the pause
  if (now < r.compactUntil) return [`☕ ${t('status.compact')}`, 'aqua'];
  if (s.active && s.planMode) return [`✐ ${t('status.plan')}`, 'light_purple'];
  if (s.active) {
    const c = CATS[r.toolCat] && now - (r.toolAt ?? 0) < RECENT_MS ? CATS[r.toolCat] : CATS.other;
    return [`${c.icon} ${t(`status.verb.${CATS[r.toolCat] && now - (r.toolAt ?? 0) < RECENT_MS ? r.toolCat : 'other'}`)} · ${pct}%`, 'green'];
  }
  if (String(s.pose).includes('sleeping')) return [`☾ ${t('status.sleeping', { ago: ago(now - s.lastEvent) })}`, 'gray'];
  if (r.feier) return [`☕ ${t('status.feierabend')}`, 'gold'];
  if (w?.kind === 'idle') return [`… ${t('status.idle')} · ${pct}%`, 'yellow'];
  return [`· ${t('status.resting')} · ${pct}%`, 'gray'];
}

const status = {
  id: 'status',
  group: 'builders',
  label: 'Status under the name',
  description: 'A line under the builder\'s name: what the chat is doing ("✎ editing · 64%"), whether it waits for you, whether it sleeps and for how long.',
  presets: ['basic'],
  setup(ctx) {
    for (const s of ctx.sessions()) ctx.rt(s).statusKey = null;
  },
  onBuilderSpawn(ctx, s) {
    ctx.rt(s).statusKey = null;
  },
  onLanguage(ctx) {
    for (const s of ctx.sessions()) ctx.rt(s).statusKey = null; // redraw the lines in the new language
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
  group: 'builders',
  label: 'Tool in hand',
  description: 'The builder holds what the chat is working with: a book (reading), a brush (edits), a pickaxe (commands), a compass (web), a bell (subagents).',
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
