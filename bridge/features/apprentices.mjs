// Idea 6 — subagents are apprentices: a small mannequin (scale 0.6, its own skin) appears next to the
// builder while a subagent runs, holding a spyglass (Explore), a map (Plan) or a book, hops between the
// next blocks of the build every ~2 s and vanishes with a poof when the subagent finishes (the build
// gets its usual subagent bonus). At most four per chat; a lost SubagentStop times out after 15 min.
const MAX_SHOWN = 4;
const TIMEOUT_MS = 15 * 60000;
const ITEMS = { Explore: 'minecraft:spyglass', Plan: 'minecraft:filled_map', 'general-purpose': 'minecraft:book', 'claude-code-guide': 'minecraft:compass' };

const sid = (s) => s.id.slice(0, 8);
const appTag = (s, n) => `alps_app_${sid(s)}_${n}`;

function hash(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

async function remove(ctx, s, a) {
  const tag = appTag(s, a.n);
  await ctx.cmd(`execute at @e[tag=${tag},limit=1] run particle minecraft:poof ~ ~0.6 ~ 0.2 0.3 0.2 0.02 12`);
  await ctx.cmd(`kill @e[tag=${tag}]`);
  a.spawned = false;
}

async function removeAll(ctx, s) {
  const r = ctx.rt(s);
  for (const a of r.apps?.values() ?? []) if (a.spawned) await remove(ctx, s, a);
}

const apprentices = {
  id: 'apprentices',
  group: 'Строители',
  label: 'Подмастерья',
  description: 'Каждый субагент — маленький помощник рядом со строителем: Explore с подзорной трубой, Plan с картой. Уходит, когда субагент закончил.',
  presets: ['basic'],
  always: ['onRetire', 'onBuilderLeave'],
  async setup(ctx) {
    await ctx.cmd('kill @e[tag=alps_app]');
    for (const s of ctx.sessions()) for (const a of ctx.rt(s).apps?.values() ?? []) a.spawned = false;
  },
  onEvent(ctx, s, ev) {
    const r = ctx.rt(s);
    r.apps ??= new Map();
    if (ev.kind === 'SubagentStart' && ev.agentId && !r.apps.has(ev.agentId)) {
      const used = new Set([...r.apps.values()].map((a) => a.n));
      let n = 0;
      while (used.has(n)) n++;
      r.apps.set(ev.agentId, { id: ev.agentId, n, type: ev.agentType ?? 'agent', since: Date.now(), spawned: false, next: 0 });
    } else if (ev.kind === 'SubagentStop' && ev.agentId) {
      const a = r.apps.get(ev.agentId);
      r.apps.delete(ev.agentId);
      if (a?.spawned) ctx.fx.push(() => remove(ctx, s, a), { cost: 2 });
    }
  },
  async onWork(ctx, s, site, dt) {
    const r = ctx.rt(s);
    if (!r.apps?.size) return;
    const now = Date.now();
    const built = site.obj ? null : ctx.buildList(site.plot);
    const list = built?.list ?? [];
    const placed = site.rec.placed;
    let shown = 0;
    for (const a of [...r.apps.values()].sort((x, y) => x.since - y.since)) {
      if (now - a.since > TIMEOUT_MS) {
        r.apps.delete(a.id);
        if (a.spawned) await remove(ctx, s, a);
        continue;
      }
      if (shown++ >= MAX_SHOWN) continue;
      const tag = appTag(s, a.n);
      if (!a.spawned) {
        const skins = ctx.SKINS.filter((k) => k !== s.skin);
        const skin = skins[hash(a.id) % skins.length];
        const item = ITEMS[a.type] ?? 'minecraft:wooden_shovel';
        const label = ctx.cleanText(a.type, 20);
        const off = [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]][a.n % 4];
        const out = await ctx.cmd(`execute at ${ctx.builderSel(s)} run summon minecraft:mannequin ~${off[0]} ~ ~${off[1]} {UUID:${ctx.builderUuid(s, { key: site.key }, `app:${a.id}:`)},Tags:["alps","alps_app","${tag}"],Invulnerable:1b,PersistenceRequired:1b,immovable:1b,hide_description:1b,CustomNameVisible:1b,CustomName:${ctx.textJson(label, 'gray')},profile:{texture:"entity/player/slim/${skin}"},attributes:[{id:"minecraft:scale",base:0.6}],equipment:{mainhand:{id:"${item}",count:1}}}`);
        if (out.includes('Summoned')) {
          a.spawned = true;
          await ctx.cmd(`execute at @e[tag=${tag},limit=1] run particle minecraft:poof ~ ~0.6 ~ 0.2 0.3 0.2 0.02 12`);
        } else if (/Unable to summon|not loaded/.test(out)) a.spawned = false;
        else a.spawned = true; // UUID taken: it is already standing there (e.g. after a bridge restart)
        a.next = now + 1500;
        continue;
      }
      if (now < a.next || !s.active) continue;
      a.next = now + 1800 + a.n * 250;
      // Hop to one of the next blocks of the build (or stay close to the builder on small jobs).
      const ahead = list.slice(placed, placed + 20);
      if (ahead.length) {
        const b = ahead[(hash(`${a.id}:${placed}`) % ahead.length)];
        ctx.fx.push(`tp @e[tag=${tag},limit=1] ${b.x + 0.5} ${b.y + 1} ${b.z + 0.5} ${(hash(a.id + placed) % 4) * 90} 15`, { key: `app:${tag}` });
      } else {
        ctx.fx.push(`execute at ${ctx.builderSel(s)} run tp @e[tag=${tag},limit=1] ~${(a.n % 2 ? 1 : -1) * 1.2} ~ ~${a.n > 1 ? 1.2 : -1.2}`, { key: `app:${tag}` });
      }
    }
    if (r.apps.size >= 5) ctx.achieve('hive');
  },
  async onFinish(ctx, s) {
    // The builder moves on; apprentices follow (re-appear at the next site).
    await removeAll(ctx, s);
  },
  async onObjectDone(ctx, s) {
    await removeAll(ctx, s);
  },
  async onBuilderLeave(ctx, s) {
    await removeAll(ctx, s);
  },
  async onRetire(ctx, s) {
    await removeAll(ctx, s);
    ctx.rt(s).apps?.clear();
  },
  async onDisable(ctx) {
    for (const s of ctx.sessions()) for (const a of ctx.rt(s).apps?.values() ?? []) a.spawned = false;
    await ctx.cmd('kill @e[tag=alps_app]');
  },
};

export default apprentices;
