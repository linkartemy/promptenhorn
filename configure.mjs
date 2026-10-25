// Switch Promptenhorn features from the terminal (the same as the settings page at http://127.0.0.1:7777/).
//   node configure.mjs                    show the language, the preset and every feature
//   node configure.mjs minimal|basic|max  choose a preset (clears per-feature changes)
//   node configure.mjs <feature> on|off   switch one feature on top of the preset
//   node configure.mjs <feature> reset    back to what the preset says
//   node configure.mjs language <code>    en, ru, es, de, fr, it, pt, zh, ja (in-game texts, pages, this CLI)
// Writes config.json (or $ALPS_CONFIG); a running bridge picks the change up within ~2 seconds.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESETS, DEFAULT_PRESET, inPreset, readConfigFile, writeConfigFile, resolve, featureText, validLanguage } from './bridge/settings.mjs';
import { FEATURES } from './bridge/features/index.mjs';
import { t, setLanguage, LANGUAGES, DEFAULT_LANGUAGE } from './bridge/i18n.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const file = process.env.ALPS_CONFIG || path.join(ROOT, 'config.json');
const cfg = readConfigFile(file);
let lang = setLanguage(validLanguage(cfg.language) ? cfg.language : DEFAULT_LANGUAGE);
let preset = PRESETS[cfg.preset] ? cfg.preset : DEFAULT_PRESET;
const overrides = { ...(cfg.features ?? {}) };
const [a, b] = process.argv.slice(2);

function show() {
  const on = resolve(FEATURES, preset, overrides);
  console.log(t('cli.language', { code: lang, name: LANGUAGES[lang] }));
  console.log(t('cli.preset', { id: preset, name: PRESETS[preset].label, file }));
  let group = null;
  for (const f of FEATURES) {
    const text = featureText(f);
    if (text.group !== group) console.log(`\n  ${(group = text.group)}`);
    const mark = f.id in overrides ? ' *' : '';
    const note = f.optIn ? `  (${t('cli.optIn')})` : f.experimental ? `  (${t('cli.experimental')})` : '';
    console.log(`    [${on[f.id] ? 'x' : ' '}] ${f.id.padEnd(20)} ${text.label}${mark}${note}`);
  }
  console.log(`\n  ${t('cli.legend', { presets: Object.keys(PRESETS).join(', ') })}`);
  console.log(`  ${t('cli.languages', { list: Object.keys(LANGUAGES).join(', ') })}`);
}

function save() {
  for (const f of FEATURES) if (overrides[f.id] === inPreset(f, preset)) delete overrides[f.id];
  writeConfigFile(file, { preset, features: overrides });
}

const usage = () => {
  console.error(t('cli.usage', { features: FEATURES.map((x) => x.id).join(', '), languages: Object.keys(LANGUAGES).join(', ') }));
  process.exit(1);
};

if (!a || a === 'list') show();
else if (a === 'language' || a === 'lang') {
  if (!b) {
    console.log(t('cli.language', { code: lang, name: LANGUAGES[lang] }));
    console.log(t('cli.languages', { list: Object.entries(LANGUAGES).map(([k, v]) => `${k} (${v})`).join(', ') }));
  } else if (!validLanguage(b)) {
    console.error(t('cli.unknownLanguage', { code: b, list: Object.keys(LANGUAGES).join(', ') }));
    process.exit(1);
  } else {
    lang = setLanguage(b);
    writeConfigFile(file, { language: lang });
    console.log(t('cli.languageSet', { code: lang, name: LANGUAGES[lang] }));
  }
} else if (PRESETS[a]) {
  preset = a;
  for (const k of Object.keys(overrides)) delete overrides[k];
  save();
  show();
} else {
  const f = FEATURES.find((x) => x.id === a);
  if (!f || !['on', 'off', 'reset'].includes(b)) usage();
  if (b === 'reset') delete overrides[a];
  else overrides[a] = b === 'on';
  save();
  show();
}
