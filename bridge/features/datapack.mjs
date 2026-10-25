// Installs the Promptenhorn data pack (datapack/promptenhorn: advancements, town hall dialog) into the
// world's datapacks folder when it is missing or outdated, then reloads data packs (the vanilla
// `minecraft:reload`, not Paper's plugin reload) and enables it. Runs at most once per RCON connection
// and language: the pack's texts are rendered from the locale catalog (datapack/build.mjs packFiles()).
import fs from 'node:fs';
import path from 'node:path';
import { packFiles } from '../../datapack/build.mjs';
import { language } from '../i18n.mjs';

function filesOf(dir, base = dir, out = []) {
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) filesOf(p, base, out);
    else out.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return out;
}

let installing = null;
let connection = 0;
let installedLanguage = null;

/** Call from setup(); resolves to true when the pack is installed and enabled. */
export function ensureDatapack(ctx) {
  const conn = ctx.connection?.() ?? 0;
  if (installing && conn === connection && installedLanguage === language()) return installing;
  connection = conn;
  installedLanguage = language();
  installing = (async () => {
    const files = packFiles(installedLanguage);
    const dst = path.join(ctx.worldDir(), 'datapacks', 'promptenhorn');
    const present = fs.existsSync(dst) ? filesOf(dst) : [];
    const same = present.length === files.length && files.every((f) => present.includes(f.rel) && fs.readFileSync(path.join(dst, f.rel), 'utf8') === f.text);
    let copied = false;
    if (!same) {
      fs.rmSync(dst, { recursive: true, force: true });
      for (const f of files) {
        fs.mkdirSync(path.dirname(path.join(dst, f.rel)), { recursive: true });
        fs.writeFileSync(path.join(dst, f.rel), f.text);
      }
      copied = true;
      ctx.log(`Installed the Promptenhorn data pack (${installedLanguage}) into ${dst}`);
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
