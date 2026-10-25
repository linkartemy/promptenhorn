// Switch Promptenhorn features from the terminal (the same as the settings page at http://127.0.0.1:7777/).
//   node configure.mjs                  show the preset and every feature
//   node configure.mjs minimal|basic|max  choose a preset (clears per-feature changes)
//   node configure.mjs <feature> on|off   switch one feature on top of the preset
//   node configure.mjs <feature> reset    back to what the preset says
// Writes config.json (or $ALPS_CONFIG); a running bridge picks the change up within ~2 seconds.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESETS, DEFAULT_PRESET, inPreset, readConfigFile, writeConfigFile, resolve } from './bridge/settings.mjs';
import { FEATURES } from './bridge/features/index.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const file = process.env.ALPS_CONFIG || path.join(ROOT, 'config.json');
const cfg = readConfigFile(file);
let preset = PRESETS[cfg.preset] ? cfg.preset : DEFAULT_PRESET;
const overrides = { ...(cfg.features ?? {}) };
const [a, b] = process.argv.slice(2);

function show() {
  const on = resolve(FEATURES, preset, overrides);
  console.log(`Preset: ${preset} (${PRESETS[preset].label}) — ${file}`);
  let group = null;
  for (const f of FEATURES) {
    if (f.group !== group) console.log(`\n  ${(group = f.group)}`);
    const mark = f.id in overrides ? ' *' : '';
    console.log(`    [${on[f.id] ? 'x' : ' '}] ${f.id.padEnd(20)} ${f.label}${mark}${f.optIn ? '  (приватность, только вручную)' : ''}`);
  }
  console.log('\n  * = изменено относительно пресета.  Пресеты: minimal, basic, max');
}

function save() {
  for (const f of FEATURES) if (overrides[f.id] === inPreset(f, preset)) delete overrides[f.id];
  writeConfigFile(file, { preset, features: overrides });
}

if (!a || a === 'list') show();
else if (PRESETS[a]) {
  preset = a;
  for (const k of Object.keys(overrides)) delete overrides[k];
  save();
  show();
} else {
  const f = FEATURES.find((x) => x.id === a);
  if (!f || !['on', 'off', 'reset'].includes(b)) {
    console.error(`Usage: node configure.mjs [minimal|basic|max] | <feature> on|off|reset\nFeatures: ${FEATURES.map((x) => x.id).join(', ')}`);
    process.exit(1);
  }
  if (b === 'reset') delete overrides[a];
  else overrides[a] = b === 'on';
  save();
  show();
}
