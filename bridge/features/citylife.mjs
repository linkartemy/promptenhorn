// "Life of the city": residents with real routines, people sitting at the café / in church / at the
// family table, the builders' day (work clothes, their own bed, an evening drink, a little dance when a
// house is done) and animals in their places. Positions come from the generator markers (bed, seat,
// door, pet_spot, pasture, workstation, bell — docs/generator-contract.md §4/§6).
//
// Cost rules: every system has hard caps per district and per city (setting `lifeDensity`: low / medium /
// high); entities are only created where the chunk is loaded (a player is near) and are persistent after
// that, so the server never re-summons them while nobody looks; everything a system made is removed when
// it is switched off (entities in unloaded chunks are fetched with a short force-load).
//
// Residents are vanilla villagers WITH AI (gravity, beds at night, job sites by day, the bell as meeting
// point); the bridge's NoAI sync in setupWorld does not touch them (no `alps` tag). Golem spawning is
// suppressed through their brain memory, so a crowd of villagers never adds iron golems. NoAI animals get
// the `alps_grounded` tag: a sweep keeps them on the ground when renovations change the terrain.
import { t } from '../i18n.mjs';
import { rngFrom } from '../blueprint.mjs';
import { markersOf, YAW, DIRS, groundSweep } from './markers.mjs';
import { PROFESSION } from './life.mjs';

// ------------------------------------------------------------------ density and caps

/** Caps per density: residents [per house, per district, city], seated [per plot, city], animals [per district, city]. */
export const DENSITY = {
  low: { res: [1, 3, 12], seat: [2, 6], animal: [2, 8] },
  medium: { res: [2, 6, 30], seat: [3, 14], animal: [4, 20] },
  high: { res: [2, 10, 48], seat: [5, 24], animal: [6, 36] },
};
const density = (ctx) => DENSITY[ctx.config.lifeDensity] ?? DENSITY.medium;
const HOMES = new Set(['chalet', 'townhouse', 'modern', 'apartment', 'farmhouse', 'hut']);
const SKINS = ['steve', 'alex', 'ari', 'efe', 'kai', 'makena', 'noor', 'sunny', 'zuri'];
const BIOMES = ['plains', 'plains', 'snow', 'taiga'];

// ------------------------------------------------------------------ helpers

function hash32(text, seed = 2166136261) {
  let h = seed;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h | 0;
}
/** Deterministic entity UUID: the game refuses a second entity with the same UUID (no duplicates). */
const uuidOf = (id) => `[I;${[0, 1, 2, 3].map((k) => hash32(`${id}#${k}`, 0x811c9dc5 + k * 7919)).join(',')}]`;
const slug = (s) => String(s).replace(/[^A-Za-z0-9_.+-]/g, '_');
const groupTag = (sys, gid) => `alps_lg_${sys}_${slug(gid)}`;
const entTag = (id) => `alps_le_${(hash32(id) >>> 0).toString(36)}`;
const f1 = (n) => Number(n).toFixed(2);
const countOf = (out) => (out.includes('passed') ? Number(out.match(/Count: (\d+)/)?.[1] ?? 1) : 0);

function lifeState(ctx) {
  const L = (ctx.state.life ??= {});
  L.groups ??= {}; // `${sys}:${gid}` -> { sys, at: [x, y, z], ents: [id…] }
  L.cleanup ??= []; // [{ at, tag }] groups to remove from chunks that were not loaded when switched off
  return L;
}

const loadedSince = new Map(); // group key -> ms since its anchor chunk was seen loaded

/**
 * Brings one group (one system's entities on one plot) to the desired set: kills what is no longer
 * wanted, summons what is missing. Acts only when the anchor chunk has been loaded for a few seconds
 * (entities load a moment after their chunk: summoning earlier would duplicate them).
 * desired: [{ id, summon }] — `summon` is a full command (may be guarded with `execute if block …`).
 */
async function reconcile(ctx, sys, gid, at, desired) {
  const L = lifeState(ctx);
  const key = `${sys}:${gid}`;
  const g = L.groups[key];
  if (!g && !desired.length) return;
  const [x, y, z] = at.map(Math.floor);
  if (!(await ctx.cmd(`execute if loaded ${x} ${y} ${z}`)).includes('passed')) {
    loadedSince.delete(key);
    return;
  }
  if (!loadedSince.has(key)) loadedSince.set(key, Date.now());
  if (Date.now() - loadedSince.get(key) < 3000) return;
  const group = (L.groups[key] ??= { sys, at: [x, y, z], ents: [] });
  group.at = [x, y, z];
  const want = new Set(desired.map((d) => d.id));
  for (const id of group.ents) if (!want.has(id)) await ctx.cmd(`kill @e[tag=${entTag(id)}]`);
  group.ents = group.ents.filter((id) => want.has(id));
  const tag = groupTag(sys, gid);
  const n = countOf(await ctx.cmd(`execute if entity @e[tag=${tag}]`));
  if (n > desired.length) {
    await ctx.cmd(`kill @e[tag=${tag}]`); // duplicates (e.g. from an old save): start the group over
    group.ents = [];
  } else if (n < desired.length) {
    for (const d of desired) {
      const out = await ctx.cmd(d.summon);
      if (out.includes('Summoned') && !group.ents.includes(d.id)) group.ents.push(d.id);
    }
  }
  if (!desired.length) delete L.groups[key];
  ctx.save();
}

/** Removes every entity of a system: loaded ones at once, the rest via a short force-load (cleanup queue). */
async function removeSystem(ctx, sys) {
  const L = lifeState(ctx);
  for (const [key, g] of Object.entries(L.groups)) {
    if (g.sys !== sys) continue;
    const tag = groupTag(sys, key.slice(sys.length + 1));
    await ctx.cmd(`kill @e[tag=${tag}]`);
    for (const id of g.ents) await ctx.cmd(`kill @e[tag=${entTag(id)}]`);
    if (!(await ctx.cmd(`execute if loaded ${g.at.join(' ')}`)).includes('passed')) L.cleanup.push({ at: g.at, tags: [tag, ...g.ents.map(entTag)] });
    delete L.groups[key];
    loadedSince.delete(key);
  }
  ctx.save();
}

let cleanupAt = 0;
/** One pending cleanup per few seconds: load its chunk briefly, kill by tag. Runs even when the systems are off. */
async function cleanupStep(ctx, now) {
  const L = lifeState(ctx);
  if (!L.cleanup.length || now < cleanupAt) return;
  cleanupAt = now + 4000;
  const c = L.cleanup.shift();
  const [x, , z] = c.at;
  await ctx.holdArea(`lifeclean:${x},${z}`, { x1: x - 16, z1: z - 16, x2: x + 16, z2: z + 16 }, 6000);
  ctx.fx.later(3000, c.tags.map((tag) => `kill @e[tag=${tag}]`), { cost: c.tags.length });
  ctx.save();
}

/** Plans are recomputed at most once a minute (or when asked); reconciling walks them a few groups per call. */
class System {
  constructor(sys, plan) {
    this.sys = sys;
    this.plan = plan; // async (ctx) -> [{ gid, at, desired }]
    this.groups = [];
    this.planAt = 0;
    this.i = 0;
  }

  async step(ctx, now, perStep = 3) {
    if (ctx.config.lifeDensity !== this.density) {
      this.density = ctx.config.lifeDensity;
      this.planAt = 0;
    }
    if (now > this.planAt) {
      this.planAt = now + 60000;
      const planned = await this.plan(ctx);
      // Groups that disappeared from the plan (house demolished, schedule over) are emptied too.
      const keys = new Set(planned.map((p) => `${this.sys}:${p.gid}`));
      for (const [key, g] of Object.entries(lifeState(ctx).groups)) {
        if (g.sys === this.sys && !keys.has(key)) planned.push({ gid: key.slice(this.sys.length + 1), at: g.at, desired: [] });
      }
      this.groups = planned;
      this.i = 0;
    }
    for (let k = 0; k < perStep && this.groups.length; k++) {
      const p = this.groups[this.i++ % this.groups.length];
      await reconcile(ctx, this.sys, p.gid, p.at, p.desired);
    }
  }

  replan() {
    this.planAt = 0;
  }
}

/** Finished plots with their markers, grouped by district (shared by the planners, cached per minute). */
async function finishedPlots(ctx) {
  const out = [];
  for (const p of Object.values(ctx.state.plots)) {
    if (!p.done || p.type === 'park') continue;
    out.push({ plot: p, marks: (await markersOf(ctx, p)) ?? [] });
  }
  return out.sort((a, b) => Math.hypot(...a.plot.cell) - Math.hypot(...b.plot.cell) || a.plot.key.localeCompare(b.plot.key));
}
const plotCentre = (p) => [p.x0 + 10, p.y + 1, p.z0 + 10];

// ------------------------------------------------------------------ residents

function residentSummon(id, [x, y, z], gtag) {
  const rng = rngFrom(id);
  return `summon minecraft:villager ${f1(x)} ${y} ${f1(z)} {UUID:${uuidOf(id)},Tags:["alps_life","alps_res","${gtag}","${entTag(id)}"],PersistenceRequired:1b,VillagerData:{type:"minecraft:${rng.pick(BIOMES)}",profession:"minecraft:none",level:1},Brain:{memories:{"minecraft:golem_detected_recently":{value:1b,ttl:999999999L}}}}`;
}

async function planResidents(ctx) {
  const [perHouse, perDistrict, city] = density(ctx).res;
  const byDistrict = new Map();
  let total = 0;
  const out = [];
  for (const { plot, marks } of await finishedPlots(ctx)) {
    if (!HOMES.has(plot.type) || plot.public) continue;
    const beds = marks.filter((m) => m.kind === 'bed' && m.data?.owner !== 'guest').length;
    const n0 = Math.min(perHouse, Math.max(beds, marks.length ? 0 : 1)); // no markers (old house): one resident
    const used = byDistrict.get(plot.district) ?? 0;
    const n = Math.min(n0, perDistrict - used, city - total);
    if (n <= 0) continue;
    byDistrict.set(plot.district, used + n);
    total += n;
    const door = marks.find((m) => m.kind === 'door');
    const front = ctx.front(plot);
    const at = door ? [door.x + 0.5, door.y, door.z + 0.5] : front;
    const gtag = groupTag('res', plot.key);
    const desired = [];
    for (let k = 0; k < n; k++) {
      const id = `res:${plot.key}:${k}`;
      desired.push({ id, summon: residentSummon(id, [at[0] + (k ? 0.6 : 0), at[1], at[2]], gtag) });
    }
    out.push({ gid: plot.key, at, desired, plot });
  }
  return out;
}

/** The plot's door villager (bridge core) steps aside for the residents; it comes back when they go. */
async function retireDoorVillager(ctx, plot) {
  if (plot.lifeDoorChecked) return;
  plot.lifeDoorChecked = true;
  const out = await ctx.cmd(`kill @e[type=minecraft:villager,tag=alps,tag=!alps_res,x=${plot.x0},y=${plot.y - 2},z=${plot.z0},dx=20,dy=40,dz=20]`);
  if (/Killed/.test(out)) plot.lifeDoorGone = true; // it comes back when the residents are switched off
  ctx.save();
}

async function restoreDoorVillagers(ctx) {
  for (const plot of Object.values(ctx.state.plots)) {
    delete plot.lifeDoorChecked;
    if (!plot.lifeDoorGone) continue;
    delete plot.lifeDoorGone;
    const d = ctx.district(plot.district);
    if (plot.lifeDoorOwed) {
      // Finished while the residents lived here: the bridge skipped its door villager. Within the cap only.
      delete plot.lifeDoorOwed;
      if (!d || (d.villagers ?? 0) >= ctx.config.maxVillagersPerDistrict) continue;
      d.villagers = (d.villagers ?? 0) + 1;
    }
    const [vx, vz] = ctx.plotToWorld(plot, 8, 17);
    const rng = rngFrom(plot.key + ':villager');
    const profession = PROFESSION[plot.type] ?? 'mason';
    const noAI = ctx.config.villagerAI ? '' : 'NoAI:1b,';
    const summon = `summon minecraft:villager ${vx + 0.5} ${plot.y + 1} ${vz + 0.5} {Tags:["alps"],PersistenceRequired:1b,${noAI}VillagerData:{profession:"minecraft:${profession}",level:2,type:"minecraft:${rng.pick(['snow', 'taiga', 'plains'])}"}}`;
    ctx.fx.push(async () => {
      await ctx.holdArea(`doorvillager:${plot.key}`, ctx.plotRect(plot.cell), 6000);
      ctx.fx.later(3000, summon);
    }, { cost: 2 });
  }
  ctx.save();
}

const residentsSystem = new System('res', planResidents);

const residents = {
  id: 'residents',
  group: 'life',
  label: 'Residents with routines',
  description: 'Villagers live in the houses: they sleep in their beds at night, go to work at the workstations by day and meet at the bell. Replaces the villager standing at the door. Their number follows the life density.',
  presets: [],
  replacesVillager() {
    return true;
  },
  async setup(ctx) {
    // The bridge freezes villagers with the `alps` tag on connect; residents have their own tag, but
    // make sure older ones (or ones frozen by hand) move again.
    await ctx.cmd('execute as @e[type=minecraft:villager,tag=alps_res] run data merge entity @s {NoAI:0b,PersistenceRequired:1b}');
    residentsSystem.replan();
  },
  onEnable(ctx) {
    residentsSystem.replan();
  },
  afterFinish() {
    residentsSystem.replan();
  },
  onFinish(ctx, s, plot, { firstTime }) {
    if (firstTime && plot.type !== 'park' && !plot.lifeDoorChecked) {
      plot.lifeDoorChecked = true; // the bridge did not put a villager at its door (replacesVillager)
      plot.lifeDoorGone = true;
      plot.lifeDoorOwed = true;
    }
  },
  always: ['onTick'],
  async onTick(ctx, now) {
    await cleanupStep(ctx, now); // removal queue of every life system, also while they are off
    if (!ctx.on('residents')) return;
    if (now < (residents.next ?? 0)) return;
    residents.next = now + 2000;
    await residentsSystem.step(ctx, now);
    for (const p of residentsSystem.groups) if (p.plot && p.desired.length && !p.plot.lifeDoorGone && loadedSince.has(`res:${p.gid}`)) await retireDoorVillager(ctx, p.plot);
    if (now > (residents.golemAt ?? 0)) {
      residents.golemAt = now + 30000;
      // Belt and braces: an iron golem that appeared among the residents anyway leaves through the floor.
      ctx.fx.push('execute as @e[type=minecraft:iron_golem,tag=!alps_life] at @s if entity @e[type=minecraft:villager,tag=alps_res,distance=..48] run tp @s ~ -200 ~', { key: 'life:golems' });
    }
  },
  async onDisable(ctx) {
    await removeSystem(ctx, 'res');
    await restoreDoorVillagers(ctx);
  },
};

// ------------------------------------------------------------------ seated people

/** Who sits where right now: café terrace by day, church on Sunday morning, hotel at meals, family at supper. */
function seatSchedule(ctx, plot) {
  const now = ctx.now();
  const h = now.getHours() + now.getMinutes() / 60;
  const day = now.getDay();
  const [perPlot] = density(ctx).seat;
  if (plot.type === 'cafe') return h >= 8 && h < 20 ? { n: perPlot, items: ['minecraft:cookie', 'minecraft:pumpkin_pie', null] } : null;
  if (plot.type === 'church') return day === 0 && h >= 9 && h < 12 ? { n: perPlot * 2, items: ['minecraft:book', null] } : null;
  if (plot.type === 'hotel') return (h >= 12 && h < 14) || (h >= 18 && h < 22) ? { n: perPlot, items: ['minecraft:bread', 'minecraft:baked_potato', null] } : null;
  if (plot.type === 'plaza' || plot.type === 'square') return h >= 10 && h < 18 ? { n: 1, items: ['minecraft:paper', null] } : null;
  if (HOMES.has(plot.type) && !plot.public) return h >= 18 && h < 21 ? { n: Math.min(3, perPlot), items: [null], family: true } : null;
  return null;
}

function seatSummon(id, seat, gtag, item, rng) {
  const yaw = YAW[seat.facing] ?? 0;
  const [dx, dz] = DIRS[seat.facing] ?? [0, 0];
  // The rider's hips are at the vehicle's position: on the stair's tread, a little towards its back.
  const [x, y, z] = [seat.x + 0.5 - dx * 0.12, seat.y + 0.5, seat.z + 0.5 - dz * 0.12];
  const skin = `entity/player/${rng.chance(0.5) ? 'slim' : 'wide'}/${rng.pick(SKINS)}`;
  const hand = item ? `,equipment:{mainhand:{id:"${item}",count:1}}` : '';
  const sitter = `{id:"minecraft:mannequin",UUID:${uuidOf(`${id}:p`)},Tags:["alps_life","alps_seat_p","${entTag(id)}"],Rotation:[${yaw}f,0f],Invulnerable:1b,PersistenceRequired:1b,immovable:1b,hide_description:1b,profile:{texture:"${skin}"}${hand}}`;
  // Only onto a seat that is still there (renovations may have moved it).
  return `execute if block ${seat.x} ${seat.y} ${seat.z} #minecraft:stairs run summon minecraft:item_display ${f1(x)} ${f1(y)} ${f1(z)} {UUID:${uuidOf(id)},Tags:["alps_life","alps_seat","${gtag}","${entTag(id)}"],Passengers:[${sitter}]}`;
}

async function planSeated(ctx) {
  const [, city] = density(ctx).seat;
  const now = ctx.now();
  const hourKey = `${now.toDateString()}:${now.getHours()}`;
  let total = 0;
  const out = [];
  for (const { plot, marks } of await finishedPlots(ctx)) {
    const sched = seatSchedule(ctx, plot);
    let seats = marks.filter((m) => m.kind === 'seat');
    if (!sched || !seats.length || total >= city) continue;
    if (sched.family) {
      // The Stube: the seats of the lowest floor that are close together (the table), not the attic bench.
      const low = Math.min(...seats.map((s) => s.y));
      seats = seats.filter((s) => s.y === low);
    }
    const rng = rngFrom(`${plot.key}:${hourKey}:seats`);
    const pool = [...seats];
    const chosen = [];
    while (pool.length && chosen.length < Math.min(sched.n, city - total)) chosen.push(pool.splice(rng.int(0, pool.length - 1), 1)[0]);
    if (sched.family && chosen.length) {
      const [a] = chosen;
      chosen.splice(1, chosen.length, ...seats.filter((s) => s !== a && Math.abs(s.x - a.x) + Math.abs(s.z - a.z) <= 3).slice(0, sched.n - 1));
    }
    chosen.length = Math.min(chosen.length, city - total);
    total += chosen.length;
    const gtag = groupTag('seat', plot.key);
    const desired = chosen.map((seat) => {
      const id = `seat:${plot.key}:${seat.x},${seat.y},${seat.z}:${hourKey}`;
      const r = rngFrom(id);
      return { id, summon: seatSummon(id, seat, gtag, r.pick(sched.items), r) };
    });
    out.push({ gid: plot.key, at: [chosen[0]?.x ?? plotCentre(plot)[0], chosen[0]?.y ?? plot.y + 1, chosen[0]?.z ?? plotCentre(plot)[2]], desired });
  }
  return out;
}

const seatedSystem = new System('seat', planSeated);
let seatHour = null;

const seated = {
  id: 'seated',
  group: 'life',
  label: 'People at tables and in pews',
  description: 'People sit on the café terrace by day, in the church pews on Sunday morning, at the hotel restaurant at meal times and at the family table in the evening (real clock). Static and capped.',
  presets: [],
  setup() {
    seatedSystem.replan();
    seatHour = null;
  },
  afterFinish() {
    seatedSystem.replan();
  },
  async onTick(ctx, now) {
    if (now < (seated.next ?? 0)) return;
    seated.next = now + 2000;
    const hour = ctx.now().getHours();
    if (hour !== seatHour) {
      seatHour = hour; // a new hour, new guests
      seatedSystem.replan();
    }
    await seatedSystem.step(ctx, now);
  },
  async onDisable(ctx) {
    await removeSystem(ctx, 'seat');
  },
};

// ------------------------------------------------------------------ the builders' day

const ORANGE = 16744448; // hi-vis vest
const YELLOW = 16766720; // hard hat
const feierTag = (s) => `alps_feier_${s.id.slice(0, 8)}`;

function outfit(ctx, s) {
  const sel = ctx.builderSel(s);
  const cmds = [`item replace entity ${sel} armor.chest with minecraft:leather_chestplate[dyed_color=${ORANGE}]`];
  // The helmet by model (quirks) wins: Opus keeps its golden one.
  if (!ctx.on('quirks') || !['opus', 'sonnet', 'haiku', 'fable'].includes(s.model)) cmds.push(`item replace entity ${sel} armor.head with minecraft:leather_helmet[dyed_color=${YELLOW}]`);
  return cmds;
}

const silentMin = (s) => (Date.now() - s.lastEvent) / 60000;
const mannequinBody = (ctx, s) => ctx.rt(s).body !== 'bot';

/** The session's own finished house, with a family bed (marker) in it. */
async function homeBed(ctx, s) {
  const home = s.plotKey && ctx.state.plots[s.plotKey];
  if (!home?.done || home.type === 'park' || home.public) return null;
  const beds = ((await markersOf(ctx, home)) ?? []).filter((m) => m.kind === 'bed');
  const bed = beds.find((b) => b.data?.owner !== 'guest') ?? beds[0];
  return bed ? { home, bed } : null;
}

/** Lets go of a job that is not the own house (others may continue it; the chat picks work again when it wakes). */
function releaseJob(ctx, s) {
  if (!s.job) return true;
  const home = s.plotKey ? `plot:${s.plotKey}` : null;
  if (s.job === home) return true;
  const site = ctx.siteOf(s.job);
  if (site?.plot && !site.obj && !site.plot.public && site.plot.key === s.plotKey) return false;
  if (site?.rec && site.rec.sessionId === s.id && !site.rec.done) site.rec.sessionId = null;
  s.job = null;
  ctx.save();
  return true;
}

async function leaveFeierabend(ctx, s) {
  const r = ctx.rt(s);
  if (!r.feier) return;
  r.feier = null;
  await ctx.cmd(`ride ${ctx.builderSel(s)} dismount`);
  await ctx.cmd(`kill @e[type=minecraft:item_display,tag=${feierTag(s)}]`);
  if (s.pose === 'feierabend') s.pose = null;
  await ctx.refreshHand(s);
}

async function wake(ctx, s) {
  const r = ctx.rt(s);
  if (!r.lifeBed) return;
  r.lifeBed = null;
  await ctx.cmd(`data remove entity ${ctx.builderSel(s)} sleeping_pos`);
}

async function toBed(ctx, s) {
  const r = ctx.rt(s);
  const hb = await homeBed(ctx, s);
  if (!hb) return;
  const key = `${hb.bed.x},${hb.bed.y},${hb.bed.z}`;
  if (r.lifeBed === key) return;
  if (!releaseJob(ctx, s)) return;
  const site = ctx.siteOf(`plot:${hb.home.key}`);
  if (s.at !== site.key) await ctx.moveTo(s, site);
  await leaveFeierabend(ctx, s);
  const sel = ctx.builderSel(s);
  const { x, y, z } = hb.bed;
  if (r.mounted) await ctx.cmd(`ride ${sel} dismount`);
  const out = await ctx.cmd(`tp ${sel} ${x + 0.5} ${y + 0.5625} ${z + 0.5}`);
  if (!/Teleported/.test(out)) return;
  await ctx.cmd(`data merge entity ${sel} {pose:"sleeping",sleeping_pos:[I;${x},${y},${z}]}`);
  await ctx.setHand(s, 'minecraft:air');
  s.pose = 'idle-sleeping';
  r.lifeBed = key;
  r.pos = [x + 0.5, y + 0.5, z + 0.5];
}

/** The district café (finished), else the district plaza: where builders meet after work. */
function meetingPlace(ctx, s) {
  const d = ctx.district(s.districtKey);
  if (!d) return null;
  const cafe = Object.values(ctx.state.plots).find((p) => p.district === d.key && p.type === 'cafe' && p.done);
  return cafe ?? ctx.plazaOf(d);
}

async function toFeierabend(ctx, s, place, k) {
  const r = ctx.rt(s);
  if (r.feier?.place === place.key) return;
  if (!releaseJob(ctx, s)) return;
  const site = ctx.siteOf(`plot:${place.key}`);
  if (!site) return;
  if (s.at !== site.key) await ctx.moveTo(s, site);
  await wake(ctx, s);
  const sel = ctx.builderSel(s);
  if (r.mounted) await ctx.cmd(`ride ${sel} dismount`);
  const marks = (await markersOf(ctx, place)) ?? [];
  const seats = marks.filter((m) => m.kind === 'seat').sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z);
  const seat = seats[k];
  if (seat) {
    const [dx, dz] = DIRS[seat.facing] ?? [0, 0];
    const tag = feierTag(s);
    await ctx.cmd(`kill @e[type=minecraft:item_display,tag=${tag}]`);
    await ctx.cmd(`execute if block ${seat.x} ${seat.y} ${seat.z} #minecraft:stairs run summon minecraft:item_display ${f1(seat.x + 0.5 - dx * 0.12)} ${f1(seat.y + 0.5)} ${f1(seat.z + 0.5 - dz * 0.12)} {Tags:["alps_life","alps_feier","${tag}"]}`);
    await ctx.cmd(`tp ${sel} ${seat.x + 0.5} ${seat.y + 0.5} ${seat.z + 0.5} ${YAW[seat.facing] ?? 0} 0`);
    await ctx.cmd(`ride ${sel} mount @e[type=minecraft:item_display,tag=${tag},limit=1]`);
  } else {
    // Standing round in front of the door, facing each other.
    const door = marks.find((m) => m.kind === 'door');
    const [cx, cy, cz] = door ? [door.x + 0.5, door.y, door.z + 0.5] : site.front.map((v, i) => (i === 1 ? v : v + 0.5));
    const a = (k / 5) * Math.PI * 2;
    const [px, pz] = [cx + Math.cos(a) * 1.6, cz + 1.5 + Math.sin(a) * 1.6];
    const yaw = Math.round((Math.atan2(-(cx - px), cz + 1.5 - pz) * 180) / Math.PI);
    await ctx.cmd(`tp ${sel} ${f1(px)} ${cy} ${f1(pz)} ${yaw} 0`);
  }
  await ctx.cmd(`data merge entity ${sel} {pose:"standing"}`);
  r.feier = { place: place.key, since: Date.now() };
  s.pose = 'feierabend';
  await ctx.refreshHand(s);
}

async function celebrate(ctx, s) {
  const r = ctx.rt(s);
  r.celebrateUntil = Date.now() + 3200;
  const sel = ctx.builderSel(s);
  ctx.fx.push(() => ctx.refreshHand(s), { key: `hand:${s.id}` });
  // Two little hops and a crouch-cheer, with sparkles (gravity brings the mannequin back down).
  for (const [ms, cmd] of [[400, `data merge entity ${sel} {pose:"crouching"}`], [700, `execute as ${sel} at @s run tp @s ~ ~0.45 ~`], [700, `data merge entity ${sel} {pose:"standing"}`], [1300, `execute as ${sel} at @s run tp @s ~ ~0.45 ~`], [1300, `execute at ${sel} run particle minecraft:happy_villager ~ ~1.8 ~ 0.4 0.3 0.4 0 12`], [1900, `data merge entity ${sel} {pose:"crouching"}`], [2300, `data merge entity ${sel} {pose:"standing"}`]]) {
    ctx.fx.later(ms, cmd, { key: `cheer:${s.id}:${ms}:${cmd.length}` });
  }
  ctx.fx.later(3300, () => ctx.refreshHand(s), { key: `hand2:${s.id}` });
}

const builderLife = {
  id: 'builderLife',
  group: 'life',
  label: "The builders' day",
  description: 'Builders wear a hi-vis vest and a hard hat, cheer when a house is done, meet at the district café after work (17–20 h) and, once their chat has been quiet for a while, sleep in their own bed instead of in the street.',
  presets: [],
  always: ['onBuilderLeave', 'onRetire'],
  handPriority: 25,
  handItem(ctx, s) {
    const r = ctx.rt(s);
    if (Date.now() < (r.celebrateUntil ?? 0)) return 'minecraft:firework_rocket';
    if (r.feier) return 'minecraft:honey_bottle';
    return null;
  },
  onBuilderSpawn(ctx, s) {
    if (mannequinBody(ctx, s)) ctx.fx.push(outfit(ctx, s), { key: `outfit:${s.id}` });
    const r = ctx.rt(s);
    r.lifeBed = null;
    r.feier = null;
  },
  onEnable(ctx) {
    for (const s of ctx.sessions()) if (s.at && mannequinBody(ctx, s)) ctx.fx.push(outfit(ctx, s), { key: `outfit:${s.id}` });
  },
  onEvent(ctx, s, ev) {
    if ((ev.kind === 'SessionStart' || ev.kind === 'PostModelSwitch') && ev.model && s.at && mannequinBody(ctx, s)) ctx.fx.push(outfit(ctx, s), { key: `outfit:${s.id}` });
  },
  onFinish(ctx, s) {
    if (mannequinBody(ctx, s)) celebrate(ctx, s);
  },
  async onWork(ctx, s) {
    if (s.active) {
      await wake(ctx, s);
      await leaveFeierabend(ctx, s);
    }
  },
  async onTick(ctx, now) {
    if (now < (builderLife.next ?? 0)) return;
    builderLife.next = now + 5000;
    const hour = ctx.now().getHours();
    const evening = hour >= 17 && hour < 20;
    const crowd = new Map(); // meeting place -> builders there
    for (const s of ctx.sessions()) {
      if (!s.at || !mannequinBody(ctx, s)) continue;
      const r = ctx.rt(s);
      if (s.active) {
        await wake(ctx, s);
        await leaveFeierabend(ctx, s);
        continue;
      }
      if (r.waiting?.kind === 'permission' || r.waiting?.kind === 'question') continue; // it is calling you: stays put
      const quiet = silentMin(s);
      if (evening && quiet >= ctx.config.idleAfterMinutes && quiet < ctx.config.sleepAfterMinutes + 60) {
        const place = meetingPlace(ctx, s);
        if (place) {
          const k = crowd.get(place.key) ?? 0;
          if (k < 5) {
            crowd.set(place.key, k + 1);
            await toFeierabend(ctx, s, place, k);
            continue;
          }
        }
      }
      if (r.feier) await leaveFeierabend(ctx, s);
      if (quiet > ctx.config.sleepAfterMinutes) await toBed(ctx, s);
    }
  },
  async onBuilderLeave(ctx, s) {
    const r = ctx.rt(s);
    r.lifeBed = null;
    if (r.feier) {
      r.feier = null;
      await ctx.cmd(`kill @e[type=minecraft:item_display,tag=${feierTag(s)}]`);
    }
  },
  async onRetire(ctx, s) {
    await builderLife.onBuilderLeave(ctx, s);
  },
  async onDisable(ctx) {
    for (const s of ctx.sessions()) {
      await leaveFeierabend(ctx, s);
      await wake(ctx, s);
      if (s.at && mannequinBody(ctx, s)) {
        const sel = ctx.builderSel(s);
        const ours = outfit(ctx, s).map((c) => c.replace(/with minecraft:leather_\w+\[dyed_color=\d+\]$/, 'with minecraft:air'));
        ctx.fx.push(ours, { key: `outfit:${s.id}` });
      }
      s.pose = null; // the work loop puts the builder back where its site wants it
    }
    await ctx.cmd('kill @e[type=minecraft:item_display,tag=alps_feier]');
  },
};

// ------------------------------------------------------------------ animals

const CAT_VARIANTS = ['tabby', 'black', 'red', 'siamese', 'british_shorthair', 'calico', 'persian', 'ragdoll', 'white', 'jellie'];
const FISH_VARIANTS = [65536, 117899265, 67108865, 50790400, 917504, 459008];

/** A tamed, sitting pet (AI on, so it has gravity and looks around; the owner never comes). */
const petSummon = (kind, id, [x, y, z], gtag, extra) =>
  `summon minecraft:${kind} ${f1(x)} ${y} ${f1(z)} {UUID:${uuidOf(id)},Tags:["alps_life","alps_animal_l","${gtag}","${entTag(id)}"],PersistenceRequired:1b,Invulnerable:1b,Owner:${uuidOf(`owner:${id}`)},Sitting:1b,${extra}}`;
/** A NoAI animal standing still, kept on the ground by the sweep. */
const stillSummon = (kind, id, [x, y, z], gtag, extra = '', yaw = 0) =>
  `summon minecraft:${kind} ${f1(x)} ${y} ${f1(z)} {UUID:${uuidOf(id)},Tags:["alps_life","alps_animal_l","alps_grounded","${gtag}","${entTag(id)}"],PersistenceRequired:1b,Invulnerable:1b,NoAI:1b,Rotation:[${yaw}f,0f]${extra ? `,${extra}` : ''}}`;

async function planAnimals(ctx) {
  const [perDistrict, city] = density(ctx).animal;
  const byDistrict = new Map();
  let total = 0;
  const out = [];
  const take = (district, n) => {
    const used = byDistrict.get(district) ?? 0;
    const k = Math.max(0, Math.min(n, perDistrict - used, city - total));
    byDistrict.set(district, used + k);
    total += k;
    return k;
  };
  for (const { plot, marks } of await finishedPlots(ctx)) {
    const gtag = groupTag('ani', plot.key);
    const rng = rngFrom(`${plot.key}:animals`);
    const desired = [];
    const at = (m) => [m.x + 0.5, m.y, m.z + 0.5];
    let occupied = null; // cells of the build list, only for the plots that need them (farm, fountains)
    const taken = { has: (k) => (occupied ??= new Set(ctx.buildList(plot).list.map((b) => `${b.x},${b.y},${b.z}`))).has(k) };
    const pet = marks.find((m) => m.kind === 'pet_spot');
    const door = marks.find((m) => m.kind === 'door');
    if (plot.type === 'farmhouse') {
      const pasture = marks.find((m) => m.kind === 'pasture');
      if (pasture && !plot.animals) {
        // Fenced pasture: cows and a goat with AI (they graze and wander inside the fence).
        const [w, d] = [pasture.data?.w ?? 2, pasture.data?.d ?? 6];
        const [ex, ez] = plot.turns % 2 ? [d, w] : [w, d]; // extents in world x / z (marker data is in the generator's frame)
        // Free cells of the pasture (hay bales and troughs stand in it too), a couple of blocks apart.
        const cells = [];
        for (let dx = -Math.floor(ex / 2); dx <= Math.floor(ex / 2); dx++)
          for (let dz = -Math.floor(ez / 2); dz <= Math.floor(ez / 2); dz++) {
            const [x, z] = [pasture.x + dx, pasture.z + dz];
            if (taken.has(`${x},${pasture.y},${z}`) || taken.has(`${x},${pasture.y + 1},${z}`)) continue;
            if (cells.some(([cx, cz]) => Math.abs(cx - x) + Math.abs(cz - z) < 3)) continue;
            cells.push([x, z]);
          }
        const kinds = ['cow', 'cow', 'goat'].slice(0, Math.min(cells.length, take(plot.district, 3)));
        kinds.forEach((kind, k) => {
          const id = `ani:${plot.key}:pasture:${k}`;
          const [px, pz] = cells[k];
          desired.push({ id, summon: `summon minecraft:${kind} ${px + 0.5} ${pasture.y} ${pz + 0.5} {UUID:${uuidOf(id)},Tags:["alps_life","alps_animal_l","${gtag}","${entTag(id)}"],PersistenceRequired:1b,Invulnerable:1b}` });
        });
      }
      const spot = pet ?? door;
      if (spot) {
        for (let k = 0; k < take(plot.district, 2); k++) {
          const id = `ani:${plot.key}:hen:${k}`;
          desired.push({ id, summon: stillSummon('chicken', id, [spot.x + 0.5 + k * 0.8, spot.y, spot.z + 0.5 - k * 0.6], gtag, 'EggLayTime:999999999', rng.int(0, 3) * 90) });
        }
      }
    } else if (plot.type === 'hut' && (pet ?? door) && take(plot.district, 1)) {
      const id = `ani:${plot.key}:bernard`;
      desired.push({ id, summon: petSummon('wolf', id, at(pet ?? door), gtag, 'variant:"minecraft:spotted",CollarColor:14b,attributes:[{id:"minecraft:scale",base:1.25}]') });
    } else if (HOMES.has(plot.type) && !plot.public && pet && rng.chance(0.4) && take(plot.district, 1)) {
      const id = `ani:${plot.key}:cat`;
      desired.push({ id, summon: petSummon('cat', id, at(pet), gtag, `variant:"minecraft:${rng.pick(CAT_VARIANTS)}"`) });
    }
    if (plot.type === 'plaza' || plot.type === 'square') {
      // Fish in the fountain, a frog on its rim.
      const water = ctx.buildList(plot).list.filter((b) => b.block === 'minecraft:water' && b.y > plot.y);
      for (const w of water.slice(0, Math.min(2, take(plot.district ?? 'city', 2)))) {
        const id = `ani:${plot.key}:fish:${w.x},${w.z}`;
        desired.push({ id, summon: `execute if block ${w.x} ${w.y} ${w.z} minecraft:water run summon minecraft:tropical_fish ${w.x + 0.5} ${w.y + 0.3} ${w.z + 0.5} {UUID:${uuidOf(id)},Tags:["alps_life","alps_animal_l","alps_fish","${gtag}","${entTag(id)}"],PersistenceRequired:1b,Invulnerable:1b,NoAI:1b,Silent:1b,Variant:${rng.pick(FISH_VARIANTS)},Rotation:[${rng.int(0, 359)}f,0f]}` });
      }
      const { list } = ctx.buildList(plot);
      // A rim stone next to the water with nothing on top (not the fountain's column or a flower pot).
      const rim = list.find((b) => water.some((w) => b.y === w.y && Math.abs(b.x - w.x) + Math.abs(b.z - w.z) === 1) && b.block !== 'minecraft:water' && !taken.has(`${b.x},${b.y + 1},${b.z}`) && !taken.has(`${b.x},${b.y + 2},${b.z}`));
      if (rim && rng.chance(0.6) && take(plot.district ?? 'city', 1)) {
        const id = `ani:${plot.key}:frog`;
        desired.push({ id, summon: stillSummon('frog', id, [rim.x + 0.5, rim.y + 1, rim.z + 0.5], gtag, `variant:"minecraft:${rng.pick(['temperate', 'cold', 'warm'])}"`, rng.int(0, 3) * 90) });
      }
    }
    if ((plot.zone === 'rural' || plot.zone === 'outer') && HOMES.has(plot.type) && rng.chance(0.5)) {
      const meta = ctx.meta(plot);
      const cells = [];
      for (const [x, z] of [[3, 3], [17, 3], [3, 17], [17, 17], [4, 10], [16, 10]]) if (meta.freeCell(x, z)) cells.push([x, z]);
      if (cells.length && take(plot.district, 1)) {
        const [x, z] = cells[rng.int(0, cells.length - 1)];
        const id = `ani:${plot.key}:rabbit`;
        desired.push({ id, summon: stillSummon('rabbit', id, [plot.x0 + x + 0.5, plot.y + 1, plot.z0 + z + 0.5], gtag, `RabbitType:${rng.pick([0, 2, 3, 5])}`, rng.int(0, 359)) });
      }
    }
    if (desired.length) out.push({ gid: plot.key, at: plotCentre(plot), desired });
  }
  // Bees over the flower beds of plazas and parks; fish in the small fountains.
  for (const o of Object.values(ctx.state.objects ?? {})) {
    if (!o.done || !['flowerbed', 'fountain'].includes(o.type)) continue;
    const district = o.district ?? 'city';
    if (!take(district, 1)) continue;
    const gtag = groupTag('ani', `o${o.id}`);
    const id = `ani:obj:${o.id}`;
    const summon = o.type === 'flowerbed'
      ? `summon minecraft:bee ${o.x0 + 1.5} ${o.y0 + 2.4} ${o.z0 + 1.5} {UUID:${uuidOf(id)},Tags:["alps_life","alps_animal_l","${gtag}","${entTag(id)}"],PersistenceRequired:1b,Invulnerable:1b,NoAI:1b,Rotation:[${(o.id * 47) % 360}f,0f]}`
      : `execute if block ${o.x0 + 1} ${o.y0} ${o.z0 + 1} minecraft:water run summon minecraft:tropical_fish ${o.x0 + 1.5} ${o.y0 + 0.3} ${o.z0 + 1.5} {UUID:${uuidOf(id)},Tags:["alps_life","alps_animal_l","alps_fish","${gtag}","${entTag(id)}"],PersistenceRequired:1b,Invulnerable:1b,NoAI:1b,Silent:1b,Variant:${FISH_VARIANTS[o.id % FISH_VARIANTS.length]}}`;
    out.push({ gid: `o${o.id}`, at: [o.x0 + 1, o.y0 + 1, o.z0 + 1], desired: [{ id, summon }] });
  }
  return out;
}

const animalSystem = new System('ani', planAnimals);

const animals = {
  id: 'animals',
  group: 'life',
  label: 'Animals in their places',
  description: 'Cows and a goat in the farm pasture, hens by the farmhouse, a cat at some doors, a St. Bernard at the alpine hut, bees over the flower beds, fish in the fountains, a frog on the fountain rim, rabbits in the meadows. Capped by the life density.',
  presets: [],
  setup() {
    animalSystem.replan();
  },
  afterFinish() {
    animalSystem.replan();
  },
  onObjectDone() {
    animalSystem.replan();
  },
  async onTick(ctx, now) {
    if (now < (animals.next ?? 0)) return;
    animals.next = now + 2000;
    await animalSystem.step(ctx, now);
    if (now > (animals.groundAt ?? 0)) {
      animals.groundAt = now + 10000;
      ctx.fx.push(groundSweep(), { key: 'ground' });
    }
  },
  async onDisable(ctx) {
    await removeSystem(ctx, 'ani');
  },
};

// ------------------------------------------------------------------ settings

/** Life density (shared by the systems above); a change re-plans them. */
export const LIFE_PARAMS = [
  { key: 'lifeDensity', label: 'Life density', description: 'How many residents, seated people and animals the city gets (strict caps per district and city).', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] },
];

export { removeSystem, reconcile, uuidOf, entTag, groupTag, lifeState, System };
export const _test = { planResidents, planSeated, planAnimals, seatSchedule };
export default [residents, seated, builderLife, animals];
