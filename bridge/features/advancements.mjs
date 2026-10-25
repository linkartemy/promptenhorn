// Idea 18 — achievement toasts. The data pack defines advancements with the `impossible` trigger; the
// bridge grants them with `advancement grant` when the city reaches a milestone. Grants are kept in
// state, so players who were offline get them (silently re-granted) when they join.
import { ensureDatapack } from './datapack.mjs';
import { ADVANCEMENTS } from '../../datapack/build.mjs';

const IDS = new Set(ADVANCEMENTS.map((a) => a[0]));
const RANK_STADT = 15; // keep in sync with town.mjs RANKS

let ready = false;

function grant(ctx, id, target = '@a') {
  if (!ready) return;
  ctx.fx.push([`advancement grant ${target} only promptenhorn:root`, `advancement grant ${target} only promptenhorn:${id}`], { key: `adv:${target}:${id}` });
}

const advancements = {
  id: 'advancements',
  group: 'progress',
  label: 'Advancements',
  description: 'Pop-up achievements for the town\'s milestones: the first house, the night shift, a green light after three test failures, a hive of five subagents…',
  presets: [],
  async setup(ctx) {
    ready = await ensureDatapack(ctx);
  },
  async onEnable(ctx) {
    ready = await ensureDatapack(ctx);
    for (const name of ctx.players()) await advancements.onPlayerJoin(ctx, name);
  },
  achieve(ctx, id) {
    if (!IDS.has(id)) return;
    ctx.state.adv ??= {};
    if (ctx.state.adv[id]) return;
    ctx.state.adv[id] = Date.now();
    ctx.save();
    ctx.log(`Achievement: ${id}`);
    grant(ctx, id);
  },
  onEvent(ctx, s, ev) {
    const t = ctx.state.totals;
    const hour = ctx.now().getHours();
    if ((ev.kind === 'PostToolUse' || ev.kind === 'PostToolUseFailure') && hour >= 2 && hour < 5) advancements.achieve(ctx, 'night_shift');
    if (ev.kind === 'PostToolUse' && ev.ok && ev.kinds.includes('test') && (s.testPrevStreak ?? 0) >= 3) advancements.achieve(ctx, 'green_light');
    if (t.commits >= 1) advancements.achieve(ctx, 'first_commit');
    if (t.prs >= 1) advancements.achieve(ctx, 'pull_request');
    if (ev.kind === 'StopFailure' && (ev.error === 'rate_limit' || ev.error === 'overloaded')) advancements.achieve(ctx, 'storm');
    if (ev.kind === 'PreCompact') advancements.achieve(ctx, 'coffee_break');
    if (ctx.rt(s).agents.size >= 5) advancements.achieve(ctx, 'hive');
  },
  afterFinish(ctx, s, plot) {
    const t = ctx.state.totals;
    if (t.houses >= 1) advancements.achieve(ctx, 'first_stone');
    if (t.houses >= 10) advancements.achieve(ctx, 'ten_houses');
    if (t.houses >= 100) advancements.achieve(ctx, 'hundred_houses');
    if ((s.housesBuilt ?? 0) >= 5) advancements.achieve(ctx, 'marathon');
    if (plot.public && plot.type !== 'park') advancements.achieve(ctx, 'public_works');
    const d = ctx.district(plot.district);
    if (d && d.buildingsDone >= RANK_STADT) advancements.achieve(ctx, 'stadt');
  },
  onObjectDone(ctx, s, o) {
    if (o.public) advancements.achieve(ctx, 'public_works');
    if (o.type === 'summit') advancements.achieve(ctx, 'summit');
  },
  onDistrict(ctx) {
    if (Object.keys(ctx.state.districts).length >= 10) advancements.achieve(ctx, 'kantonsrat');
  },
  async onPlayerJoin(ctx, name) {
    if (!ready) return;
    // Re-granting is silent for players who already have it, and gives late-comers what they missed.
    ctx.fx.push(`advancement grant ${name} only promptenhorn:root`, { key: `adv:${name}:root` });
    for (const id of Object.keys(ctx.state.adv ?? {})) if (IDS.has(id)) ctx.fx.push(`advancement grant ${name} only promptenhorn:${id}`, { key: `adv:${name}:${id}` });
  },
};

export default advancements;
