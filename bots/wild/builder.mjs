// Colony construction: projects, buying building blocks at the market, hybrid hand placement.
//
// Economy: the next batch (cfg.buildBatch blocks) is bought from the treasury at wild/economy.mjs prices;
// the merchant hands the items to the builder (RCON give). The builder walks to the site and places every
// block it can by hand with a real place packet in survival (state steered by yaw / clicked face, as in
// bots/live-builder.mjs). Blocks that cannot be hand-placed (no support, NBT/tricky blocks, unreachable
// spots, wrong result) are set by RCON while the builder looks at them and swings ("the crew helps").
import { createRequire } from 'node:module';
import { Vec3 } from 'vec3';
import { walkTo, sleep } from './net.mjs';
import * as I from './items.mjs';
import { buyPrice, itemFor } from '../../wild/economy.mjs';
import { projectList, PLOT_SIZE } from '../../wild/houses.mjs';
import { generate } from '../../bridge/buildings.mjs';
import { t } from '../../bridge/i18n.mjs';

const require = createRequire(import.meta.url);
const { goals } = require('mineflayer-pathfinder');
const INTERACTABLE = new Set(require('mineflayer-pathfinder/lib/interactable.json'));

export const PROJECT_LABEL = { cabin: 'cabin', hut: 'hut', chalet: 'chalet' };
const REACH = 4.4;
const DIRS = { north: new Vec3(0, 0, -1), south: new Vec3(0, 0, 1), west: new Vec3(-1, 0, 0), east: new Vec3(1, 0, 0), up: new Vec3(0, 1, 0), down: new Vec3(0, -1, 0) };
const OPP = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };
const YAW = { north: 0, west: Math.PI / 2, south: Math.PI, east: -Math.PI / 2 };
const IGNORE = new Set(['north', 'south', 'east', 'west', 'up', 'down', 'waterlogged', 'distance', 'shape', 'power', 'powered', 'occupied', 'attached', 'in_wall', 'snowy', 'signal_fire', 'lit', 'note', 'instrument', 'triggered', 'has_book', 'bottom', 'age', 'stage', 'level', 'candles', 'leaves', 'flower_amount', 'persistent', 'tip', 'thickness', 'segment_amount', 'moisture', 'hatch', 'eggs', 'pickles', 'rotation', 'hinge']);
const TRICKY = /^potted_|_banner$|_sign$|_hanging_sign$|^water|^lava|^bubble|^fire$|_cauldron$|^piston_head|^moving_piston|^tall_seagrass|^kelp_plant|^dirt_path$|^farmland$/;

function parseBlock(s) {
  const m = /^(?:minecraft:)?([a-z0-9_]+)(?:\[([^\]]*)\])?(\{.*\})?$/.exec(s);
  if (!m) return { name: s, props: {}, nbt: '' };
  const props = {};
  if (m[2]) for (const kv of m[2].split(',')) {
    const [k, v] = kv.split('=');
    props[k] = v;
  }
  return { name: m[1], props, nbt: m[3] ?? '' };
}

function family(name) {
  for (const f of ['stairs', 'slab', 'trapdoor', 'door', 'fence_gate', 'bed', 'log', 'wall_torch', 'ladder', 'lantern', 'chest', 'barrel', 'furnace', 'campfire', 'carpet', 'pane', 'fence', 'wall'])
    if (name.endsWith(f) || name.includes(`_${f}`) || name === f) return f;
  return /_wood$|_stem$|^stripped_|basalt|pillar|hay_block|bone_block|chain$/.test(name) ? 'log' : 'block';
}

function matches(world, tb) {
  if (!world || world.name !== tb.name) return false;
  const wp = world.getProperties();
  for (const [k, v] of Object.entries(tb.props)) {
    if (IGNORE.has(k)) continue;
    if (k in wp && String(wp[k]) !== String(v)) return false;
  }
  return true;
}

export class Builder {
  constructor({ colony, state, cmd, log, save, event, chatter, cfg }) {
    Object.assign(this, { colony, state, cmd, log, save, event, chatter, cfg });
    this.batch = null; // { from, to, items: Map(name -> n) }
    this.yawRule = { stairs: 1, door: 1, bed: 1, fence_gate: 1, chest: -1, furnace: -1, barrel: -1, campfire: -1, block: -1, trapdoor: -1 };
    this.lists = new Map();
  }

  active() {
    return this.state.projects.find((p) => !p.done) ?? null;
  }

  list(p) {
    if (!this.lists.has(p.id)) {
      const local = projectList(p.type, p.seed, generate);
      const o = new Vec3(p.origin.x, p.origin.y, p.origin.z);
      this.lists.set(p.id, local.map((b) => ({ ...b, pos: o.offset(b.x, b.y, b.z), t: parseBlock(b.block) })));
    }
    return this.lists.get(p.id);
  }

  /** Starts the next project on a free plot when there is none (site levelled by the crew via RCON). */
  async tick() {
    const st = this.state;
    if (!st.colony || this.active()) return;
    const n = st.projects.length;
    const types = this.cfg.projects;
    if (n >= types.length || n >= st.colony.plots.length) return;
    const type = types[n];
    if (type !== 'cabin') return; // city generators need a 21x21 plot; only cabins fit the colony plots for now
    const origin = st.colony.plots[n];
    const { w, d } = PLOT_SIZE.cabin;
    const { x, y, z } = origin;
    const f = (c) => this.cmd(c);
    await f(`fill ${x - 1} ${y + 1} ${z - 1} ${x + w} ${y + 14} ${z + d} air`);
    await f(`fill ${x - 1} ${y - 3} ${z - 1} ${x + w} ${y - 1} ${z + d} dirt`);
    await f(`fill ${x - 1} ${y} ${z - 1} ${x + w} ${y} ${z + d} grass_block`);
    const p = { id: `p${n + 1}`, type, seed: `wild-${n + 1}`, origin, placed: 0, hand: 0, rcon: 0, creditsSpent: 0, done: false, started: Date.now(), box: [x - 1, y - 1, z - 1, x + w, y + 14, z + d] };
    p.total = this.list(p).length;
    st.projects.push(p);
    this.event('wild.ev.projectStart', { house: type });
    this.log(`project ${p.id}: ${type} at ${x} ${y} ${z}, ${p.total} blocks`);
    this.save();
  }

  /** The builder has work: a batch in hand, or enough money for the next one. */
  ready() {
    const p = this.active();
    if (!p) return false;
    if (this.batch && this.batch.project === p.id) return true;
    const next = this.nextBatch(p);
    if (!next) return false;
    if (this.state.credits >= next.price) return true;
    const now = Date.now();
    if (now - (this.lastPoor ?? 0) > 240000 && this.colony.builder) {
      this.lastPoor = now;
      this.chatter.say(this.colony.builder, 'poor', { need: next.price.toFixed(0), have: this.state.credits.toFixed(0) });
    }
    return false;
  }

  carrying(name) {
    return !!this.batch?.items.has(name);
  }

  nextBatch(p) {
    const list = this.list(p);
    if (p.placed >= list.length) return null;
    const to = Math.min(list.length, p.placed + this.cfg.buildBatch);
    const items = new Map();
    let price = 0;
    for (let i = p.placed; i < to; i++) {
      const name = list[i].t.name;
      if (name === 'air' || (list[i].t.props.half === 'upper' && family(name) === 'door') || (list[i].t.props.part === 'head' && family(name) === 'bed')) continue;
      price += buyPrice(name);
      const it = itemFor(name);
      if (!TRICKY.test(name)) items.set(it, (items.get(it) ?? 0) + 1);
    }
    return { from: p.placed, to, items, price: Math.round(price * 100) / 100 };
  }

  /** One build session of the builder colonist: buy a batch if needed, carry it to the site, place it. */
  async run(c) {
    const p = this.active();
    if (!p) return;
    const bot = c.bot;
    if (!this.batch || this.batch.project !== p.id) {
      const b = this.nextBatch(p);
      if (!b || this.state.credits < b.price) return;
      // to the market: the merchant hands over what the builder does not already carry
      await c.goNear(this.colony.base.market, 2, { timeout: 40000 });
      if (I.freeSlots(bot) < 12) await c.visitBase({ reason: 'build' });
      this.state.credits = Math.round((this.state.credits - b.price) * 100) / 100;
      this.state.spent = Math.round((this.state.spent + b.price) * 100) / 100;
      p.creditsSpent = Math.round((p.creditsSpent + b.price) * 100) / 100;
      let n = 0;
      for (const [item, k] of b.items) {
        const need = k - I.count(bot, item);
        if (need <= 0) continue;
        if (!bot.registry.itemsByName[item]) continue;
        await this.cmd(`give ${c.name} ${item} ${need}`);
        this.state.bought[item] = (this.state.bought[item] ?? 0) + need;
        n += need;
      }
      this.batch = { project: p.id, ...b };
      const exotic = [...b.items.keys()].filter((i) => /calcite|copper|terracotta|glass|lantern|bed|tulip|daisy|poppy|cornflower/.test(i));
      this.chatter.say(c, 'bought', { what: exotic.length ? exotic.slice(0, 3).map((i) => I.ru(i)).join(', ') : t('wild.what.blocks', { n: b.to - b.from }), price: b.price.toFixed(1) });
      this.event('wild.ev.batch', { name: c.name, n: b.to - b.from, price: b.price });
      this.save();
      await sleep(600);
    }
    const list = this.list(p);
    const pending = new Set(list.slice(p.placed).map((b) => b.pos.toString()));
    const center = new Vec3(p.origin.x + 5, p.origin.y + 1, p.origin.z + 6);
    if (bot.entity.position.distanceTo(center) > 10) await c.goNear(center, 4, { timeout: 60000 });
    const pct = Math.round((100 * p.placed) / p.total);
    if (p.placed === 0 || Math.random() < 0.3) this.chatter.say(c, 'building', { house: t(`wild.house.${p.type}`), pct });
    while (p.placed < this.batch.to) {
      c.check();
      const b = list[p.placed];
      pending.delete(b.pos.toString());
      this.upcoming = list.slice(p.placed, p.placed + 30).map((q) => q.pos);
      if (b.t.name !== 'air') {
        let how;
        try {
          how = await this.place(c, b, pending);
        } catch (e) {
          if (e.interrupted) throw e;
          how = await this.rconPlace(c, b);
        }
        if (how === 'hand') {
          p.hand++;
          c.stats.placedHand++;
        } else if (how === 'rcon') {
          p.rcon++;
          c.stats.placedRcon++;
        }
      }
      p.placed++;
      if (p.placed % 10 === 0) this.save();
      await sleep(Math.round(120 * (this.cfg.builderSpeed ?? 1)));
    }
    this.batch = null;
    this.save();
    if (p.placed >= list.length) await this.finish(c, p);
  }

  async finish(c, p) {
    // clean up: verify the whole house, fix with RCON what changed (mobs, physics)
    let fixed = 0;
    for (const b of this.list(p)) {
      const w = c.bot.blockAt(b.pos);
      if (w && !matches(w, b.t) && b.t.name !== 'air') {
        await this.cmd(`setblock ${b.pos.x} ${b.pos.y} ${b.pos.z} ${b.block}`);
        fixed++;
      }
    }
    p.done = true;
    p.finished = Date.now();
    p.fixedAtEnd = fixed;
    this.event('wild.ev.projectDone', { house: p.type, hand: p.hand, rcon: p.rcon });
    this.chatter.say(c, 'houseDone', { house: t(`wild.house.${p.type}`) }, { urgent: true });
    const o = p.origin;
    for (let i = 0; i < 3; i++) await this.cmd(`summon firework_rocket ${o.x + 5} ${o.y + 10} ${o.z + 6} {LifeTime:20,FireworksItem:{id:"minecraft:firework_rocket",count:1,components:{"minecraft:fireworks":{explosions:[{shape:"large_ball",colors:[I;16711680,16777215]}]}}}}`).catch(() => {});
    this.log(`project ${p.id} done: ${p.hand} by hand, ${p.rcon} by RCON, ${fixed} fixed at the end, ${p.creditsSpent} Fr.`);
    this.save();
  }

  // ------------------------------------------------------------------ placement

  async rconPlace(c, b) {
    const bot = c.bot;
    if (bot.entity.position.distanceTo(b.pos) < 10) {
      await bot.lookAt(b.pos.offset(0.5, 0.5, 0.5), true).catch(() => {});
      bot.swingArm('right');
    }
    await this.cmd(`setblock ${b.pos.x} ${b.pos.y} ${b.pos.z} ${b.block}`);
    // the item was bought for this block: it is used up
    const it = itemFor(b.t.name);
    if (I.count(bot, it) > 0) await this.cmd(`clear ${c.name} ${it} 1`).catch(() => {});
    return 'rcon';
  }

  /** Places one block; returns 'hand' | 'rcon' | 'already'. */
  async place(c, b, pending) {
    const bot = c.bot;
    const { pos: p, t: tb } = b;
    const fam = family(tb.name);
    let world = bot.blockAt(p);
    if (matches(world, tb)) return 'already';
    if ((fam === 'door' && tb.props.half === 'upper') || (fam === 'bed' && tb.props.part === 'head')) {
      await sleep(100);
      if (matches(bot.blockAt(p), tb)) return 'already';
      return this.rconPlace(c, b);
    }
    const item = itemFor(tb.name);
    if (TRICKY.test(tb.name) || tb.nbt || !bot.registry.itemsByName[item]) return this.rconPlace(c, b);
    if (!(await this.reach(c, p, pending))) return this.rconPlace(c, b);
    world = bot.blockAt(p);
    if (world && world.boundingBox !== 'empty' && !/air/.test(world.name)) {
      // something is in the way (grass, snow, a mob-placed block): clear it by hand
      await bot.dig(world, true).catch(() => {});
    }
    const it = I.find(bot, item);
    if (!it) {
      // not in the bag (dropped on death, used elsewhere): the merchant sends one more
      await this.cmd(`give ${c.name} ${item} 1`);
      await sleep(300);
    }
    const plans = this.plans(bot, p, tb);
    if (!plans.length) return this.rconPlace(c, b);
    const held = I.find(bot, item);
    if (!held) return this.rconPlace(c, b);
    await bot.equip(held, 'hand');
    for (let attempt = 0; attempt < Math.min(2, plans.length); attempt++) {
      const plan = plans[attempt];
      try {
        await this.placeOnce(bot, p, plan);
      } catch {
        continue;
      }
      await bot.waitForTicks(2);
      world = bot.blockAt(p);
      if (matches(world, tb)) {
        if (plan.yaw != null && tb.props.facing in YAW && fam in this.yawRule) {
          const same = Math.abs(((plan.yaw - YAW[tb.props.facing] + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) < 0.1;
          this.yawRule[fam] = same ? 1 : -1;
        }
        return 'hand';
      }
      if (world && world.name === tb.name) {
        // right block, wrong state: the crew fixes the state (no slow retries)
        if (plan.yaw != null && fam in this.yawRule) this.yawRule[fam] *= -1;
        await this.cmd(`setblock ${p.x} ${p.y} ${p.z} ${b.block}`);
        this.stateFixed = (this.stateFixed ?? 0) + 1;
        const pr = this.active();
        if (pr) pr.stateFixed = (pr.stateFixed ?? 0) + 1;
        return 'hand';
      }
    }
    return this.rconPlace(c, b);
  }

  eye(bot) {
    return bot.entity.position.offset(0, bot.entity.eyeHeight ?? 1.62, 0);
  }

  inReach(bot, p) {
    return this.eye(bot).distanceTo(p.offset(0.5, 0.5, 0.5)) <= REACH && !occupiesAt(bot.entity.position, p);
  }

  /** Walks to a free standing cell within reach of p that is not a cell still to be built. */
  async reach(c, p, pending) {
    const bot = c.bot;
    if (this.inReach(bot, p)) return true;
    const free = (q) => {
      const b = bot.blockAt(q);
      return !!b && (b.boundingBox === 'empty' || b.name === 'air') && !/water|lava/.test(b.name);
    };
    const cur = bot.entity.position;
    const spots = [];
    for (let dx = -4; dx <= 4; dx++)
      for (let dz = -4; dz <= 4; dz++)
        for (const dy of [-3, -2, -1, 0, 1]) {
          const cell = new Vec3(p.x + dx, p.y + dy, p.z + dz);
          const s = cell.offset(0.5, 0, 0.5);
          if (s.offset(0, 1.62, 0).distanceTo(p.offset(0.5, 0.5, 0.5)) > REACH - 0.3) continue;
          if (occupiesAt(s, p)) continue;
          if (!free(cell) || !free(cell.offset(0, 1, 0))) continue;
          if (pending.has(cell.toString()) || pending.has(cell.offset(0, 1, 0).toString())) continue;
          const below = bot.blockAt(cell.offset(0, -1, 0));
          if (!below || below.boundingBox !== 'block') continue; // survival: must stand on something
          let score = 0;
          for (const q of this.upcoming ?? []) if (s.offset(0, 1.62, 0).distanceTo(q.offset(0.5, 0.5, 0.5)) <= REACH - 0.2) score++;
          score -= 0.2 * s.distanceTo(cur);
          spots.push({ cell, score });
        }
    spots.sort((a, b) => b.score - a.score);
    for (const sp of spots.slice(0, 3)) {
      c.check();
      const r = await walkTo(bot, new goals.GoalBlock(sp.cell.x, sp.cell.y, sp.cell.z), { timeout: 12000, retries: 1, shouldStop: () => !!c.interruptWhy || c.dead, onStuck: () => c.unstick() });
      c.check();
      if (this.inReach(bot, p)) return true;
      if (!r.ok) continue;
    }
    return this.inReach(bot, p);
  }

  solidRef(bot, q) {
    const b = bot.blockAt(q);
    if (!b || b.boundingBox !== 'block' || INTERACTABLE.has(b.name) || /door|trapdoor|chest|barrel|bed|sign|banner|cauldron|pot|campfire|lantern|pane|fence|carpet|ladder|glass/.test(b.name)) return null;
    return b;
  }

  plans(bot, p, tb) {
    const fam = family(tb.name);
    const pr = tb.props;
    const out = [];
    const refFor = (d) => {
      const ref = this.solidRef(bot, p.minus(DIRS[d]));
      return ref ? { ref, face: DIRS[d] } : null;
    };
    const sides = ['north', 'south', 'east', 'west'];
    const halfTop = pr.half === 'top' || pr.type === 'top';
    const yawFor = (facing) => (facing in YAW ? YAW[(this.yawRule[fam] ?? 1) > 0 ? facing : OPP[facing]] : null);
    if (pr.axis) {
      for (const d of pr.axis === 'y' ? ['up', 'down'] : pr.axis === 'x' ? ['east', 'west'] : ['north', 'south']) {
        const r = refFor(d);
        if (r) out.push(r);
      }
    } else if (fam === 'ladder') {
      const r = refFor(pr.facing);
      if (r) out.push(r);
    } else if (fam === 'lantern') {
      const r = refFor(pr.hanging === 'true' ? 'down' : 'up');
      if (r) out.push(r);
    } else if (fam === 'door' || fam === 'bed') {
      const r = refFor('up');
      if (r) out.push({ ...r, yaw: yawFor(pr.facing), cursor: pr.hinge === 'right' ? 0.8 : 0.2 });
    } else if (fam === 'slab' || fam === 'stairs') {
      const v = refFor(halfTop ? 'down' : 'up');
      const yaw = pr.facing ? yawFor(pr.facing) : null;
      if (v) out.push({ ...v, yaw });
      for (const s of sides) {
        const r = refFor(s);
        if (r) out.push({ ...r, yaw, cy: halfTop ? 0.8 : 0.2 });
      }
    } else {
      const yaw = pr.facing && pr.facing in YAW ? yawFor(pr.facing) : null;
      for (const d of ['up', ...sides, 'down']) {
        const r = refFor(d);
        if (r) out.push({ ...r, yaw });
      }
    }
    return out;
  }

  async placeOnce(bot, p, plan) {
    const look = this.eye(bot);
    const d = p.offset(0.5, 0.5, 0.5).minus(look);
    const yaw = plan.yaw ?? Math.atan2(-d.x, -d.z);
    const pitch = Math.max(-1.2, Math.min(1.2, Math.atan2(d.y, Math.hypot(d.x, d.z))));
    await bot.look(yaw, pitch, true);
    await bot.waitForTicks(1);
    const f = plan.face;
    let delta;
    if (f.y === 0) {
      const along = plan.cursor ?? 0.5;
      delta = new Vec3(f.x === 0 ? along : 0.5 + f.x * 0.5, plan.cy ?? 0.5, f.z === 0 ? along : 0.5 + f.z * 0.5);
    } else delta = new Vec3(plan.cursor ?? 0.5, 0.5 + f.y * 0.5, 0.5);
    await bot._placeBlockWithOptions(plan.ref, f, { forceLook: 'ignore', delta, swingArm: 'right' });
  }
}

function occupiesAt(s, p) {
  return s.x + 0.3 > p.x && s.x - 0.3 < p.x + 1 && s.z + 0.3 > p.z && s.z - 0.3 < p.z + 1 && s.y + 1.8 > p.y && s.y < p.y + 1;
}

export function planProject() {}
