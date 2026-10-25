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
import citylife, { LIFE_PARAMS } from './citylife.mjs';
import landscape from './landscape.mjs';
import chatter, { CHATTER_PARAMS } from './chatter.mjs';

const renovation = {
  id: 'renovation',
  group: 'city', // shown via feature.group.city / feature.renovation.label / .desc (locales)
  label: 'Renovation instead of demolition',
  description: "When the blueprints change, finished houses are repaired by the difference: the district's free builders change only what changed.",
  presets: ['basic'],
  // The work itself lives in renovate.mjs (core); this entry is only the switch. Half-built houses are
  // always migrated by diff, even with this off.
};

const economy = {
  id: 'economy',
  group: 'city',
  label: 'Chat economy',
  description: 'A short chat places a bench, a tree or a fountain on the square; its own house comes after 20 actions and grows in stages. Long chats build public works: a church, a tower, a park, then a forest and a lookout on the summit.',
  presets: ['basic'],
  // Lives in the bridge core (sites: forms, stages, public works). Off = one house after another, as before.
};

const smoothBuilders = {
  id: 'smoothBuilders',
  group: 'builders',
  label: 'Smooth motion',
  description: 'Fast mode: mannequin builders glide between work spots (they ride an invisible display the client interpolates) and turn to the next block, instead of jumping.',
  presets: [],
  // Lives in bridge/builders/mannequin.mjs; this entry is only the switch.
};

// Terrain-adaptive town (bridge/terrain.mjs, bridge/infra.mjs, docs/terrain-adaptive-design.md); these
// entries are only the switches. New plots only: existing plots are never rebuilt.
const adaptiveTerrain = {
  id: 'adaptive-terrain',
  group: 'city',
  label: 'Town follows the terrain',
  description: 'New plots climb the hillside in terraces with stone retaining walls instead of flattening it, never build on water or cliffs, and are linked by stair lanes; viewpoints appear at cliff edges. A new city is founded in a valley with a lake or river and hills around.',
  presets: ['basic'],
};
const waterfront = {
  id: 'waterfront',
  group: 'city',
  label: 'Lake front',
  description: 'Where the town meets the water: quays with railings, lamps and benches, jetties with boats, a promenade or a lido with parasols, and a harbour with a breakwater and a lighthouse.',
  presets: ['basic'],
};
const riverBridges = {
  id: 'river-bridges',
  group: 'city',
  label: 'Bridges over rivers',
  description: 'A district may grow across a river: a stone arch bridge, a covered wooden bridge with flower boxes and a water tower, or a viaduct over a gorge.',
  presets: ['basic'],
};
const shoreRenovation = {
  id: 'shore-renovation',
  group: 'city',
  label: 'Quays for existing plots',
  description: 'Additive renovation of the existing town: grass slopes that run into the water get a stone quay with steps, railings, lamps and benches, open water a jetty, the best bay a harbour. Nothing is demolished.',
  presets: ['basic'],
};

// Order = order on the settings page, roughly from most to least noticeable.
export const FEATURES = [
  ...callout, ...status, ...work, apprentices, smoothBuilders, ...night, advancements, ...chronicle, economy, renovation, adaptiveTerrain, waterfront, riverBridges, shoreRenovation, ...life, ...town, ...clocks, holidays,
  ...citylife, ...landscape, chatter,
];

/** Parameters declared by feature modules (the settings page shows them with the bridge's own). */
export const FEATURE_PARAMS = [...LIFE_PARAMS, ...CHATTER_PARAMS];

// Features verified end-to-end on the test server. Everything else is marked experimental: it stays out
// of every preset (so it cannot change a live city by surprise) until it is tested; users can still
// switch it on by hand on the settings page.
export const TESTED = new Set([
  'renovation',
  // Verified on the test server by the life agent, 25.10.2026 (docs/roadmap.md, "Verification round").
  'callout', 'idleCallout', 'status', 'toolInHand', 'tests', 'commits', 'push', 'pr', 'apprentices',
  'realTime', 'windows', 'chimney', 'advancements', 'chronicle', 'economy',
  'allay', 'compact', 'storm', 'planMode', 'professions', 'scaffolding', 'alphorn', 'quirks',
  'townRank', 'francs', 'matterhorn', 'clockBells', 'sbbClock', 'holidays',
  'residents', 'seated', 'builderLife', 'animals', 'cableCar', 'train', 'paragliders', 'boats', 'chatter',
  // Verified on the test server by the terrain agent, 25.10.2026 (docs/terrain-adaptive-design.md, "Implementation").
  'adaptive-terrain', 'waterfront', 'river-bridges', 'shore-renovation',
]);
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
