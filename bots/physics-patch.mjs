// Client physics fix for Paper 1.21.11 (see docs/live-builders-spike.md, "Риски" 1).
//
// prismarine-physics 1.11.1 implements the old (1.12-era) step-up rule: when the bot lands and hits a
// wall in the same tick, it tries the 0.6-block step from the bounding box *before* the fall, i.e. from
// mid-air. Walking into a 1-block dip therefore lifts it onto the far edge, which modern vanilla never
// does (Entity.collide steps from the box *after* the vertical collision). The server disagrees with
// the client's position, resets it every tick and the bot freezes.
//
// The fix: step from the landed box, as vanilla does. Applied without touching node_modules: the patched
// source is compiled into require.cache under the original file name before mineflayer is loaded, so
// `npm install` stays clean. If the source does not look as expected (another version), nothing is
// patched and the walk-retry workaround in worker.mjs still copes.
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const FIND_Y = `    for (const blockBB of surroundingBBs) {
      dy = blockBB.computeOffsetY(playerBB, dy)
    }
    playerBB.offset(0, dy, 0)
`;
const STEP_HEAD = `      dy = physics.stepHeight
      const queryBB = oldBB.clone().extend(oldVelX, dy, oldVelZ)
      const surroundingBBs = getSurroundingBBs(world, queryBB)

      const BB1 = oldBB.clone()
      const BB2 = oldBB.clone()`;
const STEP_HEAD_FIXED = `      dy = physics.stepHeight
      const stepBase = oldBB.clone().offset(0, dyAfterY, 0) // promptenhorn: vanilla steps from the landed box
      const queryBB = stepBase.clone().extend(oldVelX, dy, oldVelZ)
      const surroundingBBs = getSurroundingBBs(world, queryBB)

      const BB1 = stepBase.clone()
      const BB2 = stepBase.clone()`;

/** Installs the patched module; returns 'patched' | 'already' | 'skipped:<why>'. */
export function patchPhysics() {
  let file;
  try {
    // Resolve the copy mineflayer itself will load.
    const mfRequire = createRequire(require.resolve('mineflayer'));
    file = mfRequire.resolve('prismarine-physics');
  } catch (err) {
    return `skipped:${err.message}`;
  }
  if (require.cache[file]?.promptenhornPatched) return 'already';
  const src = fs.readFileSync(file, 'utf8');
  const yAt = src.indexOf(FIND_Y);
  if (yAt < 0 || !src.includes(STEP_HEAD)) return 'skipped:source changed';
  const patched = src.slice(0, yAt + FIND_Y.length) + '    const dyAfterY = dy\n' + src.slice(yAt + FIND_Y.length).replace(STEP_HEAD, STEP_HEAD_FIXED);
  const m = new Module(file, null);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(patched, file);
  m.loaded = true;
  m.promptenhornPatched = true;
  require.cache[file] = m;
  return 'patched';
}
