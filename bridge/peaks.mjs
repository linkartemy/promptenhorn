// Peak survey: finds the highest points around the city (for the summit viewpoint, the Matterhorn
// progress bar, lightning that only ever strikes far peaks, and 1 August bonfires). It samples the
// surface height on rings around the city with a heightmap probe, one sample per tick, so it never
// blocks the build loop; the result is stored in state.city.peaks.

export class PeakSurvey {
  constructor({ state, cmd, log, save, holdOwner, releaseLater, PLOT }) {
    Object.assign(this, { state, cmd, log, save, holdOwner, releaseLater, PLOT });
    this.queue = null;
    this.samples = [];
    this.wait = 0;
  }

  get city() {
    return this.state().city;
  }

  /** Starts a survey unless one ran already (or is running). */
  request() {
    if (!this.city || this.city.pending || this.city.peaks || this.queue) return;
    const radius = Math.max(60, ...Object.values(this.state().plots).map((p) => Math.hypot(p.cell[0], p.cell[1]) * this.PLOT));
    this.queue = [];
    for (const r of [radius + 60, radius + 100, radius + 140, radius + 180])
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2 + r * 0.01;
        this.queue.push([Math.round(this.city.cx + Math.cos(ang) * r), Math.round(this.city.cz + Math.sin(ang) * r)]);
      }
    this.samples = [];
    this.log(`Surveying ${this.queue.length} points for nearby peaks…`);
  }

  async step() {
    if (!this.queue) return;
    const next = this.queue[0];
    if (!next) return this.#finish();
    const [x, z] = next;
    if (this.wait === 0) {
      await this.holdOwner('probe:peak', { x1: x, z1: z, x2: x, z2: z });
      this.wait = 1;
      return;
    }
    const out = await this.cmd(`execute positioned ${x} 0 ${z} positioned over motion_blocking_no_leaves run summon minecraft:marker ~ ~ ~ {Tags:["alps","alps_fx","alps_peakprobe"]}`);
    if (!out.includes('Summoned')) {
      if (++this.wait < 40) return; // chunk still loading (or generating)
    } else {
      const pos = (await this.cmd('data get entity @e[tag=alps_peakprobe,limit=1] Pos')).match(/\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/);
      await this.cmd('kill @e[tag=alps_peakprobe]');
      if (pos) this.samples.push({ x, y: Math.floor(Number(pos[2])), z });
    }
    this.releaseLater('probe:peak', 200);
    this.queue.shift();
    this.wait = 0;
  }

  #finish() {
    const base = this.city.baseY;
    const peaks = [];
    for (const s of this.samples.sort((a, b) => b.y - a.y)) {
      if (s.y < base + 20) break;
      if (peaks.some((p) => Math.hypot(p.x - s.x, p.z - s.z) < 40)) continue;
      peaks.push(s);
      if (peaks.length >= 6) break;
    }
    this.city.peaks = peaks;
    this.queue = null;
    this.save();
    this.log(peaks.length ? `Peaks: ${peaks.map((p) => `${p.x},${p.y},${p.z}`).join('  ')}` : 'No peaks found around the city');
  }
}
