// Item knowledge for colonists: tool tiers, food, armor, what to keep and what goes to storage / market.

export const TIERS = ['wooden', 'stone', 'iron', 'diamond', 'netherite'];
export const tierOf = (name) => {
  const t = TIERS.findIndex((p) => name.startsWith(p + '_'));
  return t < 0 ? (name.startsWith('golden_') ? 0 : -1) : t;
};

export const LOG = /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_log$/;
export const PLANKS = /_planks$/;
export const STONE_DROP = /^(cobblestone|cobbled_deepslate|blackstone)$/;
export const ORES = {
  coal: ['coal_ore', 'deepslate_coal_ore'],
  iron: ['iron_ore', 'deepslate_iron_ore'],
  copper: ['copper_ore', 'deepslate_copper_ore'],
  gold: ['gold_ore', 'deepslate_gold_ore'],
  diamond: ['diamond_ore', 'deepslate_diamond_ore'],
  lapis: ['lapis_ore', 'deepslate_lapis_ore'],
  redstone: ['redstone_ore', 'deepslate_redstone_ore'],
};

export const HOSTILE = new Set([
  'zombie', 'husk', 'drowned', 'zombie_villager', 'skeleton', 'stray', 'bogged', 'spider', 'cave_spider', 'creeper',
  'witch', 'slime', 'phantom', 'pillager', 'vindicator', 'silverfish', 'endermite', 'magma_cube', 'blaze', 'zoglin',
  'piglin_brute', 'ravager', 'evoker', 'vex', 'guardian', 'breeze', 'parched', 'zombie_horse',
]);
export const RANGED = new Set(['skeleton', 'stray', 'bogged', 'pillager', 'witch', 'blaze', 'parched']);
export const ANIMALS = { cow: 'beef', pig: 'porkchop', sheep: 'mutton', chicken: 'chicken', rabbit: 'rabbit' };

// Food points (hunger restored); higher = preferred. Raw meat is eaten only when nothing else is left.
export const FOOD = {
  cooked_beef: 8, cooked_porkchop: 8, cooked_mutton: 6, cooked_chicken: 6, cooked_rabbit: 5, cooked_cod: 5, cooked_salmon: 6,
  bread: 5, baked_potato: 5, pumpkin_pie: 8, golden_carrot: 6, apple: 4, carrot: 3, sweet_berries: 2, glow_berries: 2,
  melon_slice: 2, beetroot: 1, cookie: 2, mushroom_stew: 6, rabbit_stew: 10, beetroot_soup: 6,
  beef: 3, porkchop: 3, mutton: 2, rabbit: 3, cod: 2, salmon: 2, potato: 1, chicken: 2, rotten_flesh: 4,
};
export const RAW_FOOD = { beef: 'cooked_beef', porkchop: 'cooked_porkchop', mutton: 'cooked_mutton', chicken: 'cooked_chicken', rabbit: 'cooked_rabbit', cod: 'cooked_cod', salmon: 'cooked_salmon', potato: 'baked_potato' };
export const LAST_RESORT_FOOD = new Set(['rotten_flesh', 'chicken', 'spider_eye', 'poisonous_potato', 'pufferfish']);

export const ARMOR_SLOTS = { helmet: 'head', chestplate: 'torso', leggings: 'legs', boots: 'feet' };
export const ARMOR_IDX = { head: 5, torso: 6, legs: 7, feet: 8 };
export const armorPart = (name) => Object.keys(ARMOR_SLOTS).find((p) => name.endsWith('_' + p));
const ARMOR_TIER = ['leather', 'golden', 'chainmail', 'iron', 'diamond', 'netherite'];
export const armorTier = (name) => ARMOR_TIER.findIndex((p) => name.startsWith(p + '_'));

/** What the colony wants to keep in storage before surplus goes to the market (item regex -> count). */
export const STORAGE_RESERVE = [
  [LOG, 32], [PLANKS, 32], [/^stick$/, 32], [STONE_DROP, 64], [/^coal$|^charcoal$/, 32], [/^raw_iron$|^iron_ingot$/, 64],
  [/^cooked_|^bread$|^baked_potato$|^apple$/, 32], [/^beef$|^porkchop$|^mutton$|^chicken$|^rabbit$/, 16],
  [/^torch$/, 32], [/_pickaxe$|_sword$|_axe$|_shovel$|^shield$/, 6], [/_helmet$|_chestplate$|_leggings$|_boots$/, 8],
  [/^dirt$/, 32], [/_bed$/, 4], [/^white_wool$|_wool$/, 9], [/^sand$/, 32], [/^leather$/, 16], [/^crafting_table$|^furnace$/, 2],
];
/** Never sold or stored: trash the colonist simply drops (it despawns). */
export const TRASH = /^(wheat_seeds|beetroot_seeds|pumpkin_seeds|melon_seeds|poisonous_potato|spider_eye|.*_sapling|stick_never|gravel_never)$/;
export const KEEP_PERSONAL = [
  [/_pickaxe$/, 1], [/_sword$/, 1], [/_axe$/, 1], [/_shovel$/, 1], [/_hoe$/, 1], [/^shield$/, 1], [/_helmet$|_chestplate$|_leggings$|_boots$/, 4],
  [/^cooked_|^bread$|^baked_potato$|^apple$|^carrot$|^sweet_berries$/, 16], [/^torch$/, 16], [/^dirt$|^cobblestone$|^cobbled_deepslate$/, 16],
  [/^stick$/, 4], [PLANKS, 8], [/^coal$|^charcoal$/, 4], [LOG, 4],
];

export const itemsOf = (bot) => bot.inventory.items();
export const count = (bot, re) => itemsOf(bot).filter((i) => (typeof re === 'string' ? i.name === re : re.test(i.name))).reduce((s, i) => s + i.count, 0);
export const find = (bot, re) => itemsOf(bot).find((i) => (typeof re === 'string' ? i.name === re : re.test(i.name)));
export const equipped = (bot, slot) => bot.inventory.slots[ARMOR_IDX[slot]] ?? null;

/** Best tool of a kind in the inventory ("pickaxe" | "sword" | "axe" | "shovel"); null if none. */
export function bestTool(bot, kind) {
  let best = null;
  const left = (i) => (i.maxDurability ? 1 - (i.durabilityUsed ?? 0) / i.maxDurability : 1);
  for (const it of itemsOf(bot)) if (it.name.endsWith('_' + kind) && (!best || tierOf(it.name) > tierOf(best.name) || (tierOf(it.name) === tierOf(best.name) && left(it) > left(best)))) best = it;
  const held = bot.heldItem;
  if (held?.name.endsWith('_' + kind) && (!best || tierOf(held.name) > tierOf(best.name))) best = held;
  return best;
}
export const toolTier = (bot, kind) => {
  const t = bestTool(bot, kind);
  return t ? tierOf(t.name) : -1;
};

export const freeSlots = (bot) => bot.inventory.emptySlotCount();

export function bestFood(bot, { allowRaw = false, allowBad = false } = {}) {
  let best = null;
  for (const it of itemsOf(bot)) {
    const v = FOOD[it.name];
    if (!v) continue;
    if (LAST_RESORT_FOOD.has(it.name) && !allowBad) continue;
    if (RAW_FOOD[it.name] && !allowRaw) continue;
    if (!best || v > FOOD[best.name]) best = it;
  }
  return best;
}
export const foodCount = (bot) => itemsOf(bot).filter((i) => FOOD[i.name] && !LAST_RESORT_FOOD.has(i.name)).reduce((s, i) => s + i.count, 0);

/** Localized item name for chat lines (locales: wild.item.<id>). */
export { itemName as ru } from '../../wild/lines.mjs';
