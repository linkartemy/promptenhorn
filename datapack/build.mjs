// Generates the Promptenhorn data pack (datapack/promptenhorn/): advancements ("achievement toasts")
// granted by the bridge via `advancement grant`, and the town hall entry in the pause menu.
// The bridge copies the pack into the world's datapacks folder by itself; run this after editing
// the list below:  node datapack/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'promptenhorn');

// id, icon, title, description, frame, parent (default root)
export const ADVANCEMENTS = [
  ['first_stone', 'minecraft:stone_bricks', 'Первый камень', 'Первый дом города достроен', 'task'],
  ['ten_houses', 'minecraft:oak_door', 'Десять крыш', 'В городе 10 домов', 'task', 'first_stone'],
  ['hundred_houses', 'minecraft:bell', 'Stadt', 'В городе 100 домов', 'challenge', 'ten_houses'],
  ['first_commit', 'minecraft:bell', 'Динь!', 'Первый коммит прозвенел в колокол', 'task'],
  ['pull_request', 'minecraft:red_banner', 'Флаг поднят', 'Первый pull request', 'task', 'first_commit'],
  ['green_light', 'minecraft:lime_dye', 'Зелёный свет', 'Тесты прошли после трёх падений подряд', 'goal'],
  ['hive', 'minecraft:beehive', 'Улей', 'Пять субагентов одновременно в одном чате', 'goal'],
  ['night_shift', 'minecraft:lantern', 'Ночная смена', 'Чат работал между 2 и 5 часами ночи', 'task'],
  ['kantonsrat', 'minecraft:white_banner', 'Kantonsrat', 'В городе 10 кварталов', 'challenge'],
  ['stadt', 'minecraft:golden_helmet', 'Städtli → Stadt', 'Квартал дорос до статуса Stadt', 'goal'],
  ['storm', 'minecraft:lightning_rod', 'Гроза в горах', 'Чат упёрся в лимит API', 'task'],
  ['coffee_break', 'minecraft:suspicious_stew', 'Перекур', 'Чат впервые сжал свою память', 'task'],
  ['marathon', 'minecraft:spruce_log', 'Марафон', 'Один чат построил пять зданий', 'challenge'],
  ['public_works', 'minecraft:stone_brick_wall', 'Городской рабочий', 'Чат начал строить для квартала', 'task'],
  ['summit', 'minecraft:spruce_fence', 'На вершине', 'На ближайшей вершине поставлен крест', 'goal'],
];

function write(rel, obj) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.rmSync(OUT, { recursive: true, force: true });
  write('pack.mcmeta', { pack: { description: 'Promptenhorn: достижения и ратуша', min_format: [94, 0], max_format: [94, 999] } });
  write('data/promptenhorn/advancement/root.json', {
    display: {
      icon: { id: 'minecraft:bell' }, title: { text: 'Promptenhorn' }, description: { text: 'Город, который строят чаты с Claude' },
      background: 'minecraft:gui/advancements/backgrounds/stone', show_toast: false, announce_to_chat: false,
    },
    criteria: { granted: { trigger: 'minecraft:impossible' } },
  });
  for (const [id, icon, title, description, frame, parent] of ADVANCEMENTS) {
    write(`data/promptenhorn/advancement/${id}.json`, {
      parent: `promptenhorn:${parent ?? 'root'}`,
      display: { icon: { id: icon }, title: { text: title }, description: { text: description }, frame, show_toast: true, announce_to_chat: false },
      criteria: { granted: { trigger: 'minecraft:impossible' } },
    });
  }
  // Pause menu (and the quick-actions key) get a "town hall" button; the bridge answers the trigger
  // with a live list of builders to teleport to.
  write('data/promptenhorn/dialog/townhall.json', {
    type: 'minecraft:notice',
    title: { text: 'Ратуша Promptenhorn' },
    body: { type: 'minecraft:plain_message', contents: { text: 'Список строителей: кто ждёт тебя, кто работает. Клик по имени — телепорт.' } },
    action: { label: { text: 'Открыть ратушу' }, action: { type: 'minecraft:run_command', command: '/trigger alps_hall' } },
  });
  write('data/minecraft/tags/dialog/pause_screen_additions.json', { values: ['promptenhorn:townhall'] });
  write('data/minecraft/tags/dialog/quick_actions.json', { values: ['promptenhorn:townhall'] });
  console.log(`wrote ${OUT}`);
}
