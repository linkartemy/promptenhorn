// Ideas 14, 12, 13 — the night city. The world clock follows your real clock (the city sleeps when you
// do); the house a working chat builds glows from inside (invisible light blocks just behind its
// windows, switched off when the chat stops); its chimney campfire sends up a tall signal-smoke column
// while it works and goes cold when it idles. Light slots and chimneys come from the build list
// (plotmeta.mjs), so the generators need no changes.

/** Minecraft day time for a wall-clock time: tick 0 is 06:00, 1000 ticks per hour. */
export function ticksFor(date) {
  const h = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  return Math.round((((h - 6 + 24) % 24) * 1000)) % 24000;
}

let timeAt = 0;

const realTime = {
  id: 'realTime',
  group: 'Город',
  label: 'Реальные сутки',
  description: 'Время в мире идёт по твоим часам: ночью в городе ночь, утром рассвет. Обновляется раз в минуту.',
  presets: [],
  async setup(ctx) {
    await ctx.cmd('gamerule advance_time false');
    timeAt = 0;
  },
  async onEnable(ctx) {
    await ctx.cmd('gamerule advance_time false');
    await ctx.cmd(`time set ${ticksFor(ctx.now())}`);
  },
  async onTick(ctx, now) {
    if (now - timeAt < 60000) return;
    timeAt = now;
    ctx.fx.push(`time set ${ticksFor(ctx.now())}`, { key: 'time' });
  },
  async onDisable(ctx) {
    await ctx.cmd('gamerule advance_time true');
  },
};

/** Light blocks currently placed in a plot (persisted, so they can be switched off after a restart). */
async function lightsOff(ctx, plot) {
  for (const [x, y, z] of plot.lights ?? []) await ctx.cmd(`execute if block ${x} ${y} ${z} minecraft:light run setblock ${x} ${y} ${z} air`);
  delete plot.lights;
  ctx.save();
}

const windows = {
  id: 'windows',
  group: 'Город',
  label: 'Свет в окнах',
  description: 'В доме, который сейчас строит работающий чат, горит свет. Ночью сверху сразу видно, кто работает.',
  presets: ['basic'],
  always: ['onFinish', 'onRetire', 'onBuilderLeave'],
  async onWork(ctx, s, site) {
    const plot = site.obj ? null : site.plot;
    if (!plot || plot.type === 'park') return;
    const r = ctx.rt(s);
    if (Date.now() < (r.lightsNext ?? 0)) return;
    r.lightsNext = Date.now() + 3000;
    if (!s.active) {
      if (plot.lights?.length) await lightsOff(ctx, plot);
      return;
    }
    const have = new Set((plot.lights ?? []).map((p) => p.join(',')));
    const slots = ctx.meta(plot).lightSlots.filter((l) => l.i < plot.placed || plot.skip);
    let n = 0;
    for (const l of slots) {
      const p = [plot.x0 + l.x, plot.y + l.y, plot.z0 + l.z];
      if (have.has(p.join(','))) continue;
      // Only into air: never replace something a player (or a newer blueprint) put there.
      const out = await ctx.cmd(`execute if block ${p[0]} ${p[1]} ${p[2]} minecraft:air run setblock ${p[0]} ${p[1]} ${p[2]} minecraft:light[level=13]`);
      if (out.includes('Changed')) (plot.lights ??= []).push(p);
      if (++n >= 3) break;
    }
    if (n) ctx.save();
  },
  async onFinish(ctx, s, plot) {
    await lightsOff(ctx, plot);
  },
  async onRetire(ctx, s, plot) {
    if (plot) await lightsOff(ctx, plot);
  },
  async onBuilderLeave(ctx, s, site) {
    if (site?.plot && !site.obj) await lightsOff(ctx, site.plot);
  },
  async onDisable(ctx) {
    for (const s of ctx.sessions()) {
      const site = ctx.siteOf(s.at);
      if (site?.plot && !site.obj) await lightsOff(ctx, site.plot);
    }
  },
};

/** Campfire block string with lit / signal_fire set. */
const campfire = (block, lit, signal) => block.replace(/lit=(true|false)/, `lit=${lit}`).replace(/signal_fire=(true|false)/, `signal_fire=${signal}`);

async function setChimney(ctx, plot, mode) {
  if ((plot.chimney ?? 'built') === mode) return;
  for (const c of ctx.meta(plot).campfires) {
    if (c.i >= plot.placed && !plot.done) continue; // not built yet
    const block = mode === 'built' ? c.block : mode === 'working' ? campfire(c.block, true, true) : campfire(c.block, false, false);
    await ctx.cmd(`setblock ${plot.x0 + c.x} ${plot.y + c.y} ${plot.z0 + c.z} ${block}`);
  }
  plot.chimney = mode;
  if (mode === 'built') delete plot.chimney;
  ctx.save();
}

const chimney = {
  id: 'chimney',
  group: 'Город',
  label: 'Дым из трубы',
  description: 'Пока чат работает, из трубы его дома идёт высокий столб дыма; когда простаивает — труба холодная.',
  presets: ['basic'],
  always: ['onFinish', 'onBuilderLeave', 'onRetire'],
  async onWork(ctx, s, site) {
    const plot = site.obj ? null : site.plot;
    if (!plot || plot.type === 'park' || !ctx.meta(plot).campfires.length) return;
    const r = ctx.rt(s);
    if (Date.now() < (r.chimneyNext ?? 0)) return;
    r.chimneyNext = Date.now() + 3000;
    const built = ctx.meta(plot).campfires.some((c) => c.i < plot.placed);
    if (!built) return;
    // Re-placing the campfire after it was (re)built resets it, so track per placed count too.
    if (plot.chimneyAt !== plot.placed && s.active) delete plot.chimney;
    plot.chimneyAt = plot.placed;
    await setChimney(ctx, plot, s.active ? 'working' : 'cold');
  },
  async onFinish(ctx, s, plot) {
    plot.chimney = 'x';
    await setChimney(ctx, plot, 'built');
  },
  async onBuilderLeave(ctx, s, site) {
    if (site?.plot && !site.obj && site.plot.chimney) {
      const mode = site.plot.done ? 'built' : 'cold';
      await setChimney(ctx, site.plot, mode);
    }
  },
  async onRetire(ctx, s, plot) {
    if (plot && !plot.done && plot.chimney) await setChimney(ctx, plot, 'cold');
  },
  async onDisable(ctx) {
    for (const s of ctx.sessions()) {
      const site = ctx.siteOf(s.at);
      if (site?.plot && !site.obj && site.plot.chimney) await setChimney(ctx, site.plot, site.plot.done ? 'built' : 'cold');
    }
  },
};

export default [realTime, windows, chimney];
