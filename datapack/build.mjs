// Generates the Promptenhorn data pack: advancements ("achievement toasts") granted by the bridge via
// `advancement grant`, and the town hall entry in the pause menu.
// Data packs can't carry translations, so the texts are rendered from the locale catalog of the
// configured language when the bridge installs the pack (bridge/features/datapack.mjs calls packFiles()).
// `node datapack/build.mjs [lang]` writes an English (or <lang>) copy to datapack/promptenhorn/ for reference.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { t, LANGUAGES, DEFAULT_LANGUAGE } from '../bridge/i18n.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'promptenhorn');

// id, icon, frame, parent (default root). Title/description: datapack.adv.<id>.title / .desc
export const ADVANCEMENTS = [
  ['first_stone', 'minecraft:stone_bricks', 'task'],
  ['ten_houses', 'minecraft:oak_door', 'task', 'first_stone'],
  ['hundred_houses', 'minecraft:bell', 'challenge', 'ten_houses'],
  ['first_commit', 'minecraft:bell', 'task'],
  ['pull_request', 'minecraft:red_banner', 'task', 'first_commit'],
  ['green_light', 'minecraft:lime_dye', 'goal'],
  ['hive', 'minecraft:beehive', 'goal'],
  ['night_shift', 'minecraft:lantern', 'task'],
  ['kantonsrat', 'minecraft:white_banner', 'challenge'],
  ['stadt', 'minecraft:golden_helmet', 'goal'],
  ['storm', 'minecraft:lightning_rod', 'task'],
  ['coffee_break', 'minecraft:suspicious_stew', 'task'],
  ['marathon', 'minecraft:spruce_log', 'challenge'],
  ['public_works', 'minecraft:stone_brick_wall', 'task'],
  ['summit', 'minecraft:spruce_fence', 'goal'],
];

const json = (obj) => JSON.stringify(obj, null, 2) + '\n';

/** The pack's files in `lang`: [{ rel: 'data/…/x.json', text }], sorted by path. */
export function packFiles(lang = DEFAULT_LANGUAGE) {
  const tx = (key) => t(key, {}, lang);
  const files = [];
  const add = (rel, obj) => files.push({ rel, text: json(obj) });
  add('pack.mcmeta', { pack: { description: tx('datapack.pack.description'), min_format: [94, 0], max_format: [94, 999] } });
  add('data/promptenhorn/advancement/root.json', {
    display: {
      icon: { id: 'minecraft:bell' }, title: { text: 'Promptenhorn' }, description: { text: tx('datapack.adv.root.desc') },
      background: 'minecraft:gui/advancements/backgrounds/stone', show_toast: false, announce_to_chat: false,
    },
    criteria: { granted: { trigger: 'minecraft:impossible' } },
  });
  for (const [id, icon, frame, parent] of ADVANCEMENTS) {
    add(`data/promptenhorn/advancement/${id}.json`, {
      parent: `promptenhorn:${parent ?? 'root'}`,
      display: { icon: { id: icon }, title: { text: tx(`datapack.adv.${id}.title`) }, description: { text: tx(`datapack.adv.${id}.desc`) }, frame, show_toast: true, announce_to_chat: false },
      criteria: { granted: { trigger: 'minecraft:impossible' } },
    });
  }
  // Pause menu (and the quick-actions key) get a "town hall" button; the bridge answers the trigger
  // with a live list of builders to teleport to.
  add('data/promptenhorn/dialog/townhall.json', {
    type: 'minecraft:notice',
    title: { text: tx('datapack.hall.title') },
    body: { type: 'minecraft:plain_message', contents: { text: tx('datapack.hall.body') } },
    action: { label: { text: tx('datapack.hall.button') }, action: { type: 'minecraft:run_command', command: '/trigger alps_hall' } },
  });
  add('data/minecraft/tags/dialog/pause_screen_additions.json', { values: ['promptenhorn:townhall'] });
  add('data/minecraft/tags/dialog/quick_actions.json', { values: ['promptenhorn:townhall'] });
  return files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const lang = process.argv[2] ?? DEFAULT_LANGUAGE;
  if (!Object.hasOwn(LANGUAGES, lang)) {
    console.error(`Unknown language ${lang}: expected one of ${Object.keys(LANGUAGES).join(', ')}`);
    process.exit(1);
  }
  fs.rmSync(OUT, { recursive: true, force: true });
  for (const { rel, text } of packFiles(lang)) {
    const file = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  console.log(`wrote ${OUT} (${lang})`);
}
