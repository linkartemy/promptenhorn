// The colonist's own mine ("Stollen"): a 1-wide staircase that goes down from the surface outside the
// colony, then turns into a flat tunnel at ore depth. Never digs straight down; stops and turns when
// a fluid, a cave drop or a protected area is ahead; lights the tunnel with torches. Every step yields
// stone, and ores seen from the tunnel are mined on the way. The mine is remembered in the colony
// state, so the next trip walks down the existing stairs and extends it.
import { createRequire } from 'node:module';
import { Vec3 } from 'vec3';
import { walkTo, sleep } from './net.mjs';
import * as I from './items.mjs';

const require = createRequire(import.meta.url);
const { goals } = require('mineflayer-pathfinder');

const ORE_IDS = (bot) => Object.values(I.ORES).flat().map((n) => bot.registry.blocksByName[n]?.id).filter((x) => x != null);
const FLAT_BELOW_Y = 24; // the staircase levels out here (iron and coal are common above and below)
// west and north of the plaza: the farm is east, the house plots are south
const DIRS = [[-1, 0], [0, -1]];

function solid(b) {
  return !!b && b.boundingBox === 'block' && !/water|lava|leaves|powder_snow|gravel|sand$|suspicious/.test(b.name);
}
function fluid(b) {
  return !!b && /water|lava|bubble_column/.test(b.name);
}

export class Mine {
  constructor(colonist) {
    this.c = colonist;
  }

  get bot() {
    return this.c.bot;
  }

  state() {
    const col = this.c.colony.mineState(this.c);
    return col;
  }

  /** Picks the entrance on the first use: ~13 blocks out from the plaza, heading outward. */
  async ensure() {
    let m = this.state();
    if (m) return m;
    const bot = this.bot;
    const home = this.c.colony.home().floored();
    // a free entrance: west or north of the plaza, in parallel lanes, away from protected areas and other mines
    const others = this.c.colony.mineEntrances(this.c);
    let ex = null;
    let ez = null;
    let dx = -1;
    let dz = 0;
    for (let k = 0; k < 16 && ex == null; k++) {
      [dx, dz] = DIRS[k % 2];
      const lane = (Math.floor(k / 2) % 2 ? 1 : -1) * Math.ceil(Math.floor(k / 2) / 2) * 4; // 0, -4, +4, -8, +8 …
      const x = home.x + dx * 13 + (dz !== 0 ? lane : 0);
      const z = home.z + dz * 13 + (dx !== 0 ? lane : 0);
      let ok = !others.some((o) => Math.abs(o.x - x) + Math.abs(o.z - z) < 3);
      for (let i = 0; ok && i <= 6; i++) if (this.c.colony.isProtected(new Vec3(x + dx * i, home.y, z + dz * i))) ok = false;
      if (ok) {
        ex = x;
        ez = z;
      }
    }
    if (ex == null) return null;
    // surface height at the entrance (the bot has these chunks loaded: they are next to the plaza)
    await this.c.goNear(new Vec3(ex, home.y, ez), 3, { timeout: 40000 });
    let y = null;
    for (let yy = home.y + 16; yy > home.y - 16; yy--) {
      const b = bot.blockAt(new Vec3(ex, yy, ez));
      if (b && solid(b) && !/log|leaves/.test(b.name)) {
        y = yy + 1;
        break;
      }
    }
    if (y == null) y = home.y;
    m = { entrance: { x: ex, y, z: ez }, bottom: { x: ex, y, z: ez }, dir: [dx, dz], mode: 'down', steps: 0, torches: 0, turns: 0, path: [{ x: ex, y, z: ez }] };
    this.c.colony.setMineState(this.c, m);
    return m;
  }

  /** Walks to the end of the mine, extends it by up to `steps`, mining visible ores on the way. */
  async work({ steps = 6, oresOnly = false, maxMs = 120000 } = {}) {
    const bot = this.bot;
    const c = this.c;
    const m = await this.ensure();
    if (!m) return { ok: false, reason: 'no entrance' };
    const t0 = Date.now();
    const bottom = () => new Vec3(m.bottom.x, m.bottom.y, m.bottom.z);
    if (bot.entity.position.floored().distanceTo(bottom()) > 1.5) {
      // into the mine along its known cells (short local hops; a long A* through rock is slow)
      let r = { ok: true };
      if (m.path?.length > 1) r = await this.follow(m, m.path.length - 1);
      if (bot.entity.position.floored().distanceTo(bottom()) > 1.5) r = await c.go(new goals.GoalBlock(m.bottom.x, m.bottom.y, m.bottom.z), { timeout: 40000, retries: 2, inMine: true });
      if (!r.ok && bot.entity.position.floored().distanceTo(bottom()) > 2.5) {
        // the old tunnel is unusable (flooded, caved in): start a fresh one next to it
        m.failed = (m.failed ?? 0) + 1;
        if (m.failed >= 2) c.colony.setMineState(c, null);
        return { ok: false, reason: 'unreachable' };
      }
    }
    m.failed = 0;
    let done = 0;
    while (done < steps && Date.now() - t0 < maxMs && I.freeSlots(bot) > 2) {
      c.check();
      if (await this.mineOresNearby()) continue;
      const res = await this.step(m);
      if (res === 'turn') {
        m.dir = [-m.dir[1], m.dir[0]];
        m.turns++;
        if (m.turns > 8) {
          c.colony.setMineState(c, null); // boxed in: a new mine next time
          return { ok: false, reason: 'boxed' };
        }
        continue;
      }
      if (res !== 'ok') break;
      done++;
      m.steps++;
      if (m.steps % 7 === 0) await this.torch();
      c.colony.setMineState(c, m);
    }
    return { ok: true, steps: done };
  }

  /** Digs one step forward (down while in staircase mode). Returns 'ok' | 'turn' | 'stop'. */
  async step(m) {
    const bot = this.bot;
    const c = this.c;
    const feet = new Vec3(m.bottom.x, m.bottom.y, m.bottom.z);
    const f = feet.offset(m.dir[0], 0, m.dir[1]);
    const armoured = ['head', 'torso', 'legs', 'feet'].filter((s) => I.armorTier(I.equipped(bot, s)?.name ?? '') >= 3).length >= 2;
    const floorY = armoured ? FLAT_BELOW_Y : Math.max(FLAT_BELOW_Y, m.entrance.y - 18); // deep caves are for the armoured
    const down = m.mode === 'down' && feet.y > floorY;
    if (m.mode === 'down' && !down) m.mode = 'flat';
    const targets = down ? [f.offset(0, 1, 0), f, f.offset(0, -1, 0)] : [f.offset(0, 1, 0), f];
    const stand = down ? f.offset(0, -1, 0) : f;
    const floor = bot.blockAt(stand.offset(0, -1, 0));
    if (!floor) return 'stop';
    if (!solid(floor) || fluid(floor)) {
      // a cave or a drop ahead: level out and turn instead of falling in
      m.mode = 'flat';
      return 'turn';
    }
    for (const t of targets) {
      if (c.colony.isProtected(t) || c.colony.outsideBorder(t)) return 'turn';
      const b = bot.blockAt(t);
      if (fluid(b) || c.nearFluid(t)) return 'turn';
      // never open the ceiling under sand/gravel
      const above = bot.blockAt(t.offset(0, 1, 0));
      if (above && /gravel|sand$|suspicious|pointed_dripstone/.test(above.name)) return 'turn';
    }
    for (const t of targets) {
      const b = bot.blockAt(t);
      if (!b || b.boundingBox === 'empty' || b.name === 'air' || b.name === 'cave_air') continue;
      if (/torch/.test(b.name)) continue;
      const tool = bot.pathfinder.bestHarvestTool(b);
      if (tool) await bot.equip(tool, 'hand');
      try {
        await bot.dig(b, true);
      } catch {
        c.check();
        return 'stop';
      }
    }
    // step into the new cell
    const r = await walkTo(bot, new goals.GoalBlock(stand.x, stand.y, stand.z), { timeout: 5000, retries: 1, shouldStop: () => !!c.interruptWhy || c.dead, onStuck: () => c.unstick() });
    c.check();
    if (bot.entity.position.floored().distanceTo(stand) > 1.1 && !r.ok) return 'stop';
    m.bottom = { x: stand.x, y: stand.y, z: stand.z };
    (m.path ??= [m.entrance]).push({ ...m.bottom });
    if (m.path.length > 400) m.path.splice(1, m.path.length - 400);
    await sleep(80);
    return 'ok';
  }

  /** Index of the mine cell we are standing in (or next to), -1 if we are not in the mine. */
  where(m) {
    const me = this.bot.entity.position.floored();
    let best = -1;
    let bestD = 2.1;
    (m.path ?? []).forEach((p, i) => {
      const d = me.distanceTo(new Vec3(p.x, p.y, p.z));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  /** Walks the mine's cells from where we are to cell `to` (0 = the entrance). */
  async follow(m, to) {
    const bot = this.bot;
    const c = this.c;
    let i = this.where(m);
    if (i < 0) {
      if (to === 0) return { ok: false };
      // outside: go to the entrance first
      const e = m.path[0];
      const r = await c.go(new goals.GoalBlock(e.x, e.y, e.z), { timeout: 40000, retries: 2 });
      if (!r.ok) return r;
      i = 0;
    }
    const step = to > i ? 1 : -1;
    for (let k = i + step; step > 0 ? k <= to : k >= to; k += step) {
      c.check();
      const p = m.path[k];
      const r = await walkTo(bot, new goals.GoalBlock(p.x, p.y, p.z), { timeout: 6000, retries: 1, shouldStop: () => !!c.interruptWhy || c.dead, onStuck: () => c.unstick() });
      c.check();
      if (!r.ok && bot.entity.position.floored().distanceTo(new Vec3(p.x, p.y, p.z)) > 1.5) return { ok: false, error: r.error };
    }
    return { ok: true };
  }

  /** Out of the mine before a trip home: the staircase in reverse. */
  async exit() {
    const m = this.state();
    if (!m?.path || m.path.length < 2) return;
    const i = this.where(m);
    if (i <= 0) return;
    await this.follow(m, 0);
  }

  /** Ores visible from the tunnel within reach (or two steps): mine them. */
  async mineOresNearby() {
    const bot = this.bot;
    const c = this.c;
    const ids = ORE_IDS(bot);
    const me = bot.entity.position;
    const ores = bot.findBlocks({ matching: ids, maxDistance: 5, count: 8 }).filter((p) => !c.nearFluid(p) && !c.colony.isProtected(p) && p.distanceTo(me) < 5.5);
    for (const p of ores) {
      const b = bot.blockAt(p);
      if (!b) continue;
      const req = /iron|copper|lapis/.test(b.name) ? 1 : /gold|diamond|redstone|emerald/.test(b.name) ? 2 : 0;
      if (I.toolTier(bot, 'pickaxe') < req) continue;
      if (await c.mineBlock(p)) {
        const kind = Object.entries(I.ORES).find(([, names]) => names.includes(b.name))?.[0];
        if (kind) c.announceFind(kind);
        return true;
      }
      c.colony.blacklist(p);
    }
    return false;
  }

  /** A torch on the tunnel floor behind us (crafted from coal and a stick when we have none). */
  async torch() {
    const bot = this.bot;
    const c = this.c;
    if (!I.find(bot, 'torch')) {
      if (I.count(bot, /^(coal|charcoal)$/) > 0 && I.count(bot, 'stick') > 0) await c.craft('torch', 1, null).catch(() => {});
      else if (I.count(bot, /^(coal|charcoal)$/) > 0 && I.count(bot, I.PLANKS) >= 2) {
        await c.craft('stick', 1, null).catch(() => {});
        await c.craft('torch', 1, null).catch(() => {});
      }
    }
    const torch = I.find(bot, 'torch');
    if (!torch) return;
    // the floor block one step back (where we came from)
    const m = this.state();
    const back = new Vec3(m.bottom.x - m.dir[0], m.bottom.y + (m.mode === 'down' ? 1 : 0), m.bottom.z - m.dir[1]);
    const below = bot.blockAt(back.offset(0, -1, 0));
    const at = bot.blockAt(back);
    if (!below || !solid(below) || !at || at.name !== 'air' && at.name !== 'cave_air') return;
    try {
      await bot.equip(torch, 'hand');
      await bot.placeBlock(below, new Vec3(0, 1, 0));
      m.torches++;
    } catch {}
  }
}
