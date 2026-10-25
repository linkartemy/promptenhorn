// Generator versions. Every plot remembers which version of buildings.mjs + blueprint.mjs it was built
// with (`plot.gen`). Each version the bridge has run is archived under bridge/archive/<dir>/ (the two
// files side by side, so the archived buildings.mjs imports its own blueprint.mjs), which lets the bridge
// regenerate exactly what an old house looks like and renovate it by diff instead of tearing it down.
//
// A version id is the first 12 hex digits of sha256(buildings.mjs + "\0" + blueprint.mjs). Archive
// directory names are free-form (the id is recomputed from the content); archive/legacy.txt names the
// directory whose version plots without a `gen` field (built before versioning existed) were built with.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parkList, yardExtras } from './smallforms.mjs';

const FILES = ['buildings.mjs', 'blueprint.mjs'];

export function versionOf(dir) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(path.join(dir, FILES[0])));
  h.update('\0');
  h.update(fs.readFileSync(path.join(dir, FILES[1])));
  return h.digest('hex').slice(0, 12);
}

export class Generators {
  /**
   * @param {object} o
   * @param {string} o.sourceDir directory with the current buildings.mjs + blueprint.mjs (normally bridge/)
   * @param {string} o.archiveDir where versions are archived
   */
  constructor({ sourceDir, archiveDir, log, archive = true }) {
    this.sourceDir = sourceDir;
    this.archiveDir = archiveDir;
    this.log = log;
    this.archive = archive; // tools pass false: only the bridge records the versions it actually runs
    this.dirs = new Map(); // version -> directory
    this.modules = new Map(); // version -> Promise<{ B, rngFrom }>
  }

  /**
   * Loads the current version and makes sure it is archived. Call once at startup.
   * The two source files are read once; that exact content is hashed, archived and then imported from
   * the archive, so the version id always names the code that is really running even if someone edits
   * the generators while the bridge starts.
   */
  async init() {
    const bytes = FILES.map((f) => fs.readFileSync(path.join(this.sourceDir, f)));
    this.current = crypto.createHash('sha256').update(bytes[0]).update('\0').update(bytes[1]).digest('hex').slice(0, 12);
    fs.mkdirSync(this.archiveDir, { recursive: true });
    for (const name of fs.readdirSync(this.archiveDir)) {
      const dir = path.join(this.archiveDir, name);
      if (!FILES.every((f) => fs.existsSync(path.join(dir, f)))) continue;
      try {
        this.dirs.set(versionOf(dir), dir);
      } catch {}
    }
    if (!this.dirs.has(this.current) && this.archive) {
      const dir = path.join(this.archiveDir, this.current);
      fs.mkdirSync(dir, { recursive: true });
      FILES.forEach((f, i) => fs.writeFileSync(path.join(dir, f), bytes[i]));
      this.dirs.set(this.current, dir);
      this.log(`Archived generator version ${this.current} in ${dir}`);
    }
    const legacyFile = path.join(this.archiveDir, 'legacy.txt');
    if (fs.existsSync(legacyFile)) {
      const dir = path.join(this.archiveDir, fs.readFileSync(legacyFile, 'utf8').trim());
      try {
        this.legacy = versionOf(dir);
        this.dirs.set(this.legacy, dir);
      } catch (err) {
        this.log(`archive/legacy.txt points to ${dir}, which is not a generator snapshot (${err.message})`);
      }
    }
    // Run the archived copy (identical bytes); tools that do not archive import the source directly.
    this.modules.set(this.current, this.#import(this.dirs.get(this.current) ?? this.sourceDir));
    this.currentModule = await this.modules.get(this.current);
    return this.currentModule;
  }

  async #import(dir) {
    const B = await import(pathToFileURL(path.join(dir, 'buildings.mjs')).href);
    const { rngFrom } = await import(pathToFileURL(path.join(dir, 'blueprint.mjs')).href);
    return { B, rngFrom };
  }

  has(version) {
    return version === this.current || this.dirs.has(version);
  }

  /** The generator module of a version, or null when that version is not archived (or fails to load). */
  async load(version) {
    if (!this.has(version)) return null;
    if (!this.modules.has(version)) this.modules.set(version, this.#import(this.dirs.get(version)));
    try {
      return await this.modules.get(version);
    } catch (err) {
      this.log(`generator version ${version} does not load: ${err.message}`);
      return null;
    }
  }

  /**
   * Plot-local build list of `plot` under a generator module (same seed, type and rotation as the
   * bridge uses; `stage` for generators that grow houses in stages). Returns null when that version
   * cannot build this type.
   */
  static listWith(mod, plot, { size, offset = 2, stage } = {}) {
    const { B, rngFrom } = mod;
    let bp;
    if (plot.type === 'square') bp = B.square?.(rngFrom(plot.seed));
    else if (plot.type === 'plaza') bp = B.plaza?.(rngFrom(plot.seed));
    else if (B.BUILDINGS?.[plot.type]) bp = B.generate(plot.type, plot.seed, stage ? { stage } : undefined); // older generators ignore the options
    if (!bp) return null;
    return bp.toBuildList({ turns: plot.turns, size, offset, clipMin: 0, clipMax: size - 1 });
  }
}

export const MAX_STAGE = 3;

/**
 * Plot-local build list of a plot under a generator module, at a growth stage (default: the plot's).
 * Generators that know stages export STAGES[type] (see docs/generator-contract.md); for the others
 * every stage is the full house and the last stage adds bridge-side yard extras (flag, flowers).
 * Parks are bridge-side lots and do not depend on the generators.
 */
export function stagedList(mod, plot, { size, stage = plot.stage ?? 2 }) {
  if (plot.type === 'park') return parkList(plot.seed);
  const supported = Number(mod.B.STAGES?.[plot.type]) || 1;
  const list = Generators.listWith(mod, plot, { size, stage: Math.min(stage, supported) });
  if (!list) return null;
  if (stage >= MAX_STAGE && supported < MAX_STAGE && !['square', 'plaza'].includes(plot.type) && !plot.public) {
    const cell = (x, z) => `${x},${z}`;
    const used = new Set(list.map((b) => cell(b.x, b.z)));
    const ground = new Set(list.filter((b) => b.y === 0).map((b) => cell(b.x, b.z)));
    const upper = new Set(list.filter((b) => b.y >= 1).map((b) => cell(b.x, b.z)));
    const free = (x, z) => x >= 3 && x <= 17 && z >= 3 && z <= 17 && !upper.has(cell(x, z)) && (ground.has(cell(x, z)) || !used.has(cell(x, z)));
    list.push(...yardExtras(plot.seed, free));
  }
  return list;
}
