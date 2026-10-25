// Installs the Promptenhorn data pack (datapack/promptenhorn: advancements, town hall dialog) into the
// world's datapacks folder when it is missing or outdated, then reloads data packs (the vanilla
// `minecraft:reload`, not Paper's plugin reload) and enables it. Runs at most once per RCON connection.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function filesOf(dir, base = dir, out = []) {
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) filesOf(p, base, out);
    else out.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return out;
}

function digest(dir) {
  if (!fs.existsSync(dir)) return null;
  const h = crypto.createHash('sha256');
  for (const f of filesOf(dir)) {
    h.update(f);
    h.update(fs.readFileSync(path.join(dir, f)));
  }
  return h.digest('hex');
}

let installing = null;
let connection = 0;

/** Call from setup(); resolves to true when the pack is installed and enabled. */
export function ensureDatapack(ctx) {
  const conn = ctx.connection?.() ?? 0;
  if (installing && conn === connection) return installing;
  connection = conn;
  installing = (async () => {
    const src = path.join(ctx.root, 'datapack', 'promptenhorn');
    const dst = path.join(ctx.worldDir(), 'datapacks', 'promptenhorn');
    if (!fs.existsSync(src)) {
      ctx.log('datapack/promptenhorn is missing: run `node datapack/build.mjs`');
      return false;
    }
    let copied = false;
    if (digest(src) !== digest(dst)) {
      fs.rmSync(dst, { recursive: true, force: true });
      for (const f of filesOf(src)) {
        fs.mkdirSync(path.dirname(path.join(dst, f)), { recursive: true });
        fs.copyFileSync(path.join(src, f), path.join(dst, f));
      }
      copied = true;
      ctx.log(`Installed the Promptenhorn data pack into ${dst}`);
    }
    let enabled = (await ctx.cmd('datapack list enabled')).includes('file/promptenhorn');
    if (copied || !enabled) {
      await ctx.cmd('minecraft:reload');
      enabled = (await ctx.cmd('datapack list enabled')).includes('file/promptenhorn');
      if (!enabled) await ctx.cmd('datapack enable "file/promptenhorn"');
      enabled = (await ctx.cmd('datapack list enabled')).includes('file/promptenhorn');
    }
    if (!enabled) ctx.log('The Promptenhorn data pack could not be enabled; achievements and the pause-menu town hall stay off');
    return enabled;
  })().catch((err) => {
    installing = null;
    throw err;
  });
  return installing;
}
