// Renovation: when the generators change, existing houses are repaired by diff instead of rebuilt.
// The old build list (regenerated from the archived generator version the plot was built with) and the
// new one are compared position by position: blocks only the old house had are removed (decorations
// first, then structure top-down, so nothing attached pops off and drops), blocks that changed or are
// new get placed in the normal build order (structure bottom-up, decorations last), and everything that
// stayed the same is never touched.

const key = (b) => `${b.x},${b.y},${b.z}`;

/**
 * Diff of two plot-local build lists. `oldCount` limits the old list to what was actually placed
 * (a half-built house). Returns removals (in safe order), the new-list indices that already match the
 * world (`same`), and the new-list indices that must be (re)placed (`place`, in build order).
 */
export function diffLists(oldList, newList, oldCount = oldList.length) {
  const old = new Map();
  for (let i = 0; i < Math.min(oldCount, oldList.length); i++) old.set(key(oldList[i]), oldList[i]);
  const next = new Map();
  for (const b of newList) next.set(key(b), b);
  const removeDecor = [];
  const removeStruct = [];
  for (const b of old.values()) {
    const n = next.get(key(b));
    if (b.decor && (!n || n.block !== b.block)) removeDecor.push(b); // a changed decoration may lose its support mid-way
    else if (!b.decor && !n) removeStruct.push(b);
  }
  const removed = new Set(removeDecor);
  removeDecor.sort((a, b) => b.y - a.y);
  removeStruct.sort((a, b) => b.y - a.y);
  const same = new Set();
  const place = [];
  newList.forEach((b, i) => {
    const o = old.get(key(b));
    if (o && o.block === b.block && !removed.has(o)) same.add(i);
    else place.push(i);
  });
  return { remove: [...removeDecor, ...removeStruct], same, place };
}

export class Renovator {
  /**
   * @param {object} d dependencies from the bridge: state(), gens, cmd, log, save, chunks, plotRect(cell),
   *   newList(plot) -> {hash, local}, hashList, PLOT, enabled() -> bool, rate() -> blocks/s,
   *   listWith(mod, plot) -> plot-local list under a generator module, helper(district) -> session|null,
   *   builderTag(s), labelOf(type), announce(parts, x, y, z),
   *   streetVersion, streetOps(plot) -> commands[], clearOps(plot) -> commands[], releaseLater(owner), textJson
   */
  constructor(d) {
    this.d = d;
    this.job = null; // { key, kind, ops: [{x, y, z, block}|{cmd}], world coords }
    this.credit = 0;
    this.sidebarKey = null;
    this.failed = new Set(); // plots whose renovation could not even be planned (logged once)
  }

  get state() {
    return this.d.state();
  }

  /** Plots that need work: done and built with another generator version, or with old street code. */
  pending() {
    const { gens, streetVersion } = this.d;
    const out = [];
    for (const p of Object.values(this.state.plots)) {
      if (!p.done || p.type === 'park' || this.failed.has(p.key)) continue; // parks are bridge-side, not versioned
      if (p.gen !== gens.current) out.push({ key: p.key, kind: 'gen' });
      else if (p.street !== streetVersion) out.push({ key: p.key, kind: 'street' });
    }
    // City square first, then district plazas, then houses from the centre outwards.
    const rank = (k) => {
      const p = this.state.plots[k];
      return (p.type === 'square' ? 0 : p.type === 'plaza' ? 1 : 2) * 1e6 + Math.hypot(p.cell[0], p.cell[1]);
    };
    return out.sort((a, b) => rank(a.key) - rank(b.key));
  }

  /** Builds the op list of a job. Old lists are regenerated from the archive, so a restart resumes exactly. */
  async plan(item) {
    const { gens, PLOT } = this.d;
    const plot = this.state.plots[item.key];
    const toWorld = (b) => ({ x: plot.x0 + b.x, y: plot.y + b.y, z: plot.z0 + b.z, block: b.block });
    if (item.kind === 'street') return { ...item, ops: this.d.streetOps(plot).map((cmd) => ({ cmd })) };
    let next;
    try {
      next = this.d.newList(plot);
    } catch (err) {
      next = null;
      this.d.log(`Renovation of ${plot.key}: the current generators cannot build a ${plot.type} (${err.message}); left as it is`);
    }
    if (!next) {
      plot.gen = gens.current; // nothing to renovate towards: keep the old house
      this.d.save();
      return null;
    }
    const mod = await gens.load(plot.gen);
    const oldList = mod && this.d.listWith(mod, plot);
    const ops = [];
    if (!oldList || this.d.hashList(oldList) !== plot.bp) {
      // The old version is not archived (or does not reproduce this house): clear the lot and rebuild it.
      this.d.log(`Renovation of ${plot.key}: old generator ${plot.gen ?? '?'} not available, rebuilding the ${plot.type}`);
      for (const c of this.d.clearOps(plot)) ops.push({ cmd: c });
      for (const b of next.local) ops.push(toWorld(b));
    } else {
      const diff = diffLists(oldList, next.local);
      for (const b of diff.remove) ops.push({ ...toWorld(b), block: 'minecraft:air' });
      if (diff.remove.length) ops.push({ cmd: `kill @e[type=minecraft:item,x=${plot.x0},y=${plot.y},z=${plot.z0},dx=${PLOT},dy=48,dz=${PLOT}]` });
      for (const i of diff.place) ops.push(toWorld(next.local[i]));
    }
    return { ...item, ops, hash: next.hash, total: next.local.length };
  }

  /** One renovation step; `dt` seconds since the last tick. Never runs more than `maxPerTick` ops. */
  async step(dt, maxPerTick) {
    const { cmd, chunks, enabled } = this.d;
    if (!enabled()) {
      if (this.job) await this.#pause();
      return;
    }
    if (!this.job) {
      const st = this.state.renovation;
      const next = st ? { key: st.key, kind: st.kind } : this.pending()[0];
      if (!next || !this.state.plots[next.key]) {
        delete this.state.renovation;
        await this.#sidebar(null);
        return;
      }
      const job = await this.plan(next);
      if (!job) {
        delete this.state.renovation;
        return;
      }
      this.job = job;
      if (!st || st.key !== job.key || st.kind !== job.kind) this.state.renovation = { key: job.key, kind: job.kind, idx: 0 };
      this.d.log(`Renovating ${job.key} (${job.kind}): ${job.ops.length} changes`);
      // A little beyond the lot: street seams reach into the neighbours' first rows.
      const r = this.d.plotRect(this.state.plots[job.key].cell);
      await chunks.hold(`renov:${job.key}`, { x1: r.x1 - 2, z1: r.z1 - 2, x2: r.x2 + 2, z2: r.z2 + 2 });
    }
    const job = this.job;
    const plot = this.state.plots[job.key];
    const st = this.state.renovation;
    const district = plot.district ? this.state.districts[plot.district] : null;
    const helper = this.d.helper(district);
    this.helperId = helper?.id ?? null;
    this.credit = Math.min(this.credit + this.d.rate(district, helper) * dt, 40);
    let n = Math.min(Math.floor(this.credit), maxPerTick);
    while (n-- > 0 && st.idx < job.ops.length) {
      const op = job.ops[st.idx];
      if (op.cmd) await cmd(op.cmd);
      else {
        const out = await cmd(`setblock ${op.x} ${op.y} ${op.z} ${op.block}`);
        if (out.includes('not loaded')) break; // chunk still loading: retry next tick
        if (helper && st.idx % 3 === 0) {
          const tag = this.d.builderTag(helper);
          await cmd(`tp @e[tag=${tag},limit=1] ${op.x + 0.5} ${op.y + 1} ${op.z + 0.5} ${[0, 90, 180, 270][st.idx % 4]} 20`);
          helper.pose = 'renovating'; // the bridge walks it back home afterwards
          if (!op.block.endsWith(':air')) await cmd(`particle minecraft:happy_villager ${op.x + 0.5} ${op.y + 0.7} ${op.z + 0.5} 0.3 0.3 0.3 0 2`);
        }
      }
      st.idx++;
      this.credit -= 1;
    }
    this.d.save();
    await this.#sidebar(plot, st.idx / Math.max(1, job.ops.length));
    if (st.idx >= job.ops.length) await this.#finish(job, plot, district);
  }

  async #finish(job, plot, district) {
    if (job.kind === 'gen') {
      plot.gen = this.d.gens.current;
      plot.bp = job.hash;
      plot.total = job.total;
      plot.placed = job.total;
    }
    plot.street = this.d.streetVersion;
    delete this.state.renovation;
    this.job = null;
    this.helperId = null;
    this.d.save();
    this.d.releaseLater(`renov:${job.key}`);
    this.d.log(`Renovation of ${job.key} done`);
    const left = this.pending().filter((p) => (this.state.plots[p.key].district ?? null) === (plot.district ?? null));
    if (!left.length && job.kind === 'gen') {
      const [x, z] = [plot.x0 + 10, plot.z0 + 10];
      if (district) await this.d.announce([{ text: 'Квартал ' }, { text: district.name, color: 'yellow' }, { text: ' отремонтирован' }], x, plot.y + 2, z);
      else if (plot.type === 'square') await this.d.announce([{ text: 'Главная площадь отремонтирована' }], x, plot.y + 2, z);
    }
  }

  /** Feature switched off mid-job: keep progress in state, just stop holding chunks. */
  async #pause() {
    this.d.releaseLater(`renov:${this.job.key}`);
    this.job = null;
    await this.#sidebar(null);
  }

  async #sidebar(plot, frac = 0) {
    const label = plot ? `${this.d.labelOf(plot.type)} ${Math.floor(frac * 100)}%` : null;
    if (label === this.sidebarKey) return;
    this.sidebarKey = label;
    const { cmd, textJson } = this.d;
    if (!label) {
      await cmd('scoreboard players reset alps_renov alps');
      return;
    }
    await cmd(`scoreboard players set alps_renov alps ${Math.floor(frac * 100)}`);
    await cmd(`scoreboard players display name alps_renov alps ${textJson('Ремонт', 'aqua')}`);
    await cmd(`scoreboard players display numberformat alps_renov alps fixed ${textJson(label, 'aqua')}`);
  }

  /** Whether `session`'s builder is currently out helping with a renovation. */
  helping(session) {
    return !!this.job && this.helperId === session.id;
  }

  /** Forget in-memory job state (after a reconnect); progress stays in state.renovation. */
  reset() {
    this.job = null;
    this.sidebarKey = null;
  }
}
