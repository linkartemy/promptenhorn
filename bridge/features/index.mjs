// Feature registry and dispatcher. A feature is a plain object:
//   { id, label, description, group, presets: ['basic'], optIn?,   (metadata for settings + presets)
//     setup(ctx, firstConnect), onEvent(ctx, s, ev, info), onWork(ctx, s, plot, dt), onTick(ctx, now, dt),
//     onFinish(ctx, s, plot, info), afterFinish(ctx, s, plot), onRetire(ctx, s, plot), onBuilderSpawn(ctx, s, plot),
//     onDistrict(ctx, d), onPlayerJoin(ctx, name), onPlayerLeave(ctx, name), onPlayers(ctx, names), achieve(ctx, id),
//     onEnable(ctx), onDisable(ctx),                                (lifecycle when switched in settings)
//     handItem(ctx, s, block) -> item|null, canBuild(ctx, s, plot) -> bool, villagerProfession(ctx, plot) -> id|null }
// Hooks run only while the feature is on, except the ones listed in `always` (cleanup that must happen
// even after the feature was switched off, e.g. taking scaffolding down when the house is finished).
// `max` contains every feature except opt-in ones; `minimal` contains none.
import { RconDisconnected } from '../rcon.mjs';
import callout from './callout.mjs';
import status from './status.mjs';
import work from './work.mjs';
import apprentices from './apprentices.mjs';
import night from './night.mjs';
import advancements from './advancements.mjs';
import chronicle from './chronicle.mjs';
import life from './life.mjs';
import town from './town.mjs';
import clocks from './clocks.mjs';
import holidays from './holidays.mjs';

const renovation = {
  id: 'renovation',
  group: 'Город',
  label: 'Ремонт вместо сноса',
  description: 'Когда меняются чертежи, готовые дома чинятся по разнице: свободные строители квартала меняют только то, что изменилось.',
  presets: ['basic'],
  // The work itself lives in renovate.mjs (core); this entry is only the switch. Half-built houses are
  // always migrated by diff, even with this off.
};

const economy = {
  id: 'economy',
  group: 'Город',
  label: 'Экономика чатов',
  description: 'Короткий чат ставит скамейку, дерево или фонтан на площади; свой дом — после 20 действий, и он растёт этапами. Длинные чаты строят общественное: церковь, башню, парк, потом лес и смотровую на вершине.',
  presets: ['basic'],
  // Lives in the bridge core (sites: forms, stages, public works). Off = one house after another, as before.
};

// Order = order on the settings page, roughly from most to least noticeable.
export const FEATURES = [
  ...callout, ...status, ...work, apprentices, ...night, advancements, ...chronicle, economy, renovation, ...life, ...town, ...clocks, holidays,
];

// Features verified end-to-end on the test server. Everything else is marked experimental: it stays out
// of every preset (so it cannot change a live city by surprise) until it is tested; users can still
// switch it on by hand on the settings page.
export const TESTED = new Set(['renovation']);
for (const f of FEATURES) if (!TESTED.has(f.id) && !f.optIn) f.experimental = true;

const ids = new Set();
for (const f of FEATURES) {
  if (!f.id || ids.has(f.id)) throw new Error(`feature id missing or duplicated: ${f.id}`);
  ids.add(f.id);
}

export class FeatureHost {
  constructor(modules, ctx, log) {
    this.modules = modules;
    this.ctx = ctx;
    this.log = log;
    this.settings = null; // set by the bridge once settings exist
    this.handOrder = [...modules].filter((m) => m.handItem).sort((a, b) => (a.handPriority ?? 50) - (b.handPriority ?? 50));
  }

  #runs(m, hook) {
    if (!m[hook]) return false;
    return this.settings?.on(m.id) || (m.always ?? []).includes(hook);
  }

  #fail(m, hook, err) {
    if (err instanceof RconDisconnected) throw err;
    this.log(`feature ${m.id}.${hook}: ${err.stack ?? err.message}`);
  }

  /** Awaits the hook on every feature that runs it. One failing feature never stops the others. */
  async emit(hook, ...args) {
    for (const m of this.modules) {
      if (!this.#runs(m, hook)) continue;
      try {
        await m[hook](this.ctx, ...args);
      } catch (err) {
        this.#fail(m, hook, err);
      }
    }
  }

  /** Calls the hook without waiting (event handlers): features queue their RCON work as effects. */
  emitSync(hook, ...args) {
    for (const m of this.modules) {
      if (!this.#runs(m, hook)) continue;
      try {
        const p = m[hook](this.ctx, ...args);
        if (p?.catch) p.catch((err) => err instanceof RconDisconnected || this.log(`feature ${m.id}.${hook}: ${err.stack ?? err.message}`));
      } catch (err) {
        if (!(err instanceof RconDisconnected)) this.log(`feature ${m.id}.${hook}: ${err.stack ?? err.message}`);
      }
    }
  }

  /** The first non-null answer (item in hand, villager profession…), in priority order. */
  first(hook, ...args) {
    const list = hook === 'handItem' ? this.handOrder : this.modules;
    for (const m of list) {
      if (!this.#runs(m, hook)) continue;
      try {
        const v = m[hook](this.ctx, ...args);
        if (v != null) return v;
      } catch (err) {
        this.log(`feature ${m.id}.${hook}: ${err.message}`);
      }
    }
    return null;
  }

  /** True unless some running feature answers false (e.g. building pauses while a chat waits for you). */
  every(hook, ...args) {
    for (const m of this.modules) {
      if (!this.#runs(m, hook)) continue;
      try {
        if (m[hook](this.ctx, ...args) === false) return false;
      } catch (err) {
        this.log(`feature ${m.id}.${hook}: ${err.message}`);
      }
    }
    return true;
  }

  /** A feature was switched in settings: let it set itself up or clean up after itself. */
  toggle(id, on) {
    const m = this.modules.find((x) => x.id === id);
    const hook = on ? 'onEnable' : 'onDisable';
    if (!m?.[hook]) return;
    Promise.resolve()
      .then(() => m[hook](this.ctx))
      .catch((err) => err instanceof RconDisconnected || this.log(`feature ${id}.${hook}: ${err.stack ?? err.message}`));
  }
}
