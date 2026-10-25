// Colony economy: raw resources sold at the market chest become credits (Franken, "Fr."); building blocks
// are bought with credits and handed to the builder by the merchant (RCON give).
//
// Fairness rule: a block costs what its raw materials would fetch at the market, times a small
// workshop markup (1.2). Blocks the colony cannot make itself (calcite, copper, terracotta, glass,
// dyes, flowers…) carry an "import" price that reflects the effort a player would spend on them.
// Approximate effort: 1 log ≈ 6 s of chopping, 1 cobblestone ≈ 2 s, 1 raw iron ≈ 30 s incl. finding.

/** Sale prices (credits per item) at the market chest. Items not listed are not bought by the market. */
export const SELL = {
  log: 1, wood: 1, stem: 1, planks: 0.25, stick: 0.05,
  cobblestone: 0.25, cobbled_deepslate: 0.25, stone: 0.35, andesite: 0.25, diorite: 0.25, granite: 0.25, tuff: 0.25, deepslate: 0.3,
  dirt: 0.02, sand: 0.3, gravel: 0.15, clay_ball: 0.3, flint: 0.3,
  coal: 1, charcoal: 0.8, raw_iron: 3, iron_ingot: 4, raw_copper: 0.5, copper_ingot: 0.8, raw_gold: 4, gold_ingot: 5,
  diamond: 25, emerald: 10, lapis_lazuli: 0.6, redstone: 0.4, quartz: 1,
  rotten_flesh: 0.2, bone: 0.5, string: 0.6, gunpowder: 1.5, spider_eye: 0.4, arrow: 0.1, leather: 1, feather: 0.2, white_wool: 0.6,
  beef: 0.6, porkchop: 0.6, mutton: 0.5, chicken: 0.4, rabbit: 0.4, rabbit_hide: 0.3, egg: 0.1, apple: 0.5, sweet_berries: 0.1,
  cooked_beef: 1, cooked_porkchop: 1, cooked_mutton: 0.8, cooked_chicken: 0.7, wheat: 0.3,
};

/** Credits a stack of `name` fetches (0 = the market does not want it). */
export function sellPrice(name, mult = 1) {
  let p = SELL[name];
  if (p == null) {
    if (/_log$|_wood$/.test(name)) p = SELL.log;
    else if (/_planks$/.test(name)) p = SELL.planks;
    else if (/_wool$/.test(name)) p = SELL.white_wool;
    else return 0;
  }
  return p * mult;
}

const MARKUP = 1.2;
const P = SELL;
/** Import prices: blocks the colony cannot produce (the merchant brings them up the valley). */
const IMPORT = [
  [/^calcite$/, 0.8], [/terracotta$/, 1.2], [/^(waxed_)?(exposed_|weathered_|oxidized_)?cut_copper(_slab|_stairs)?$/, 1.6],
  [/^(waxed_)?(exposed_|weathered_|oxidized_)?copper_(block|trapdoor|door|grate|bulb)$/, 4], [/^(waxed_)?(exposed_|weathered_|oxidized_)?chiseled_copper$/, 2],
  [/^glass$|_stained_glass$/, 0.6], [/glass_pane$/, 0.25], [/^lantern$/, 2.5], [/^soul_lantern$/, 2.5], [/^iron_chain$|^chain$/, 0.8],
  [/_bed$/, 2.5], [/_banner$/, 3], [/_carpet$/, 0.4], [/_wool$/, 0.7], [/^(poppy|dandelion|cornflower|allium|azure_bluet|oxeye_daisy|.*_tulip|lily_of_the_valley)$/, 0.2],
  [/^potted_/, 0.6], [/^flower_pot$/, 0.5], [/^moss_block$|^moss_carpet$/, 0.4], [/_leaves$/, 0.15], [/^short_grass$|^fern$|^tall_grass$/, 0.05],
  [/^bricks$|^brick_(stairs|slab|wall)$/, 1.4], [/^mud_bricks|^packed_mud$/, 0.6], [/quartz/, 2], [/^bookshelf$/, 3], [/^chiseled_bookshelf$/, 3.5],
  [/^lectern$/, 4], [/^water_cauldron$|^cauldron$/, 7], [/^barrel$/, 1.8], [/^smoker$/, 3], [/^campfire$/, 1.6], [/^candle$/, 0.5], [/_sign$|_hanging_sign$/, 0.6],
  [/^hay_block$/, 2.7], [/^composter$/, 1], [/^bell$/, 10], [/^tuff|^polished_tuff/, 0.4], [/^amethyst/, 3], [/^dirt_path$|^coarse_dirt$|^rooted_dirt$|^grass_block$|^dirt$|^farmland$/, 0.05],
];

/** Credits to buy one block (by block id without namespace/state). */
export function buyPrice(name) {
  const wood = name.match(/^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)_(.*)$/);
  const w = (planks) => +(planks * P.planks * MARKUP).toFixed(2);
  if (wood) {
    const rest = wood[2];
    if (/^(log|wood|stem)$/.test(rest) || /^stripped_/.test(name)) return +(P.log * MARKUP).toFixed(2);
    if (rest === 'planks') return w(1);
    if (rest === 'slab') return w(0.5);
    if (rest === 'stairs') return w(1.5);
    if (rest === 'fence') return w(1.7);
    if (rest === 'fence_gate') return w(4);
    if (rest === 'trapdoor') return w(3);
    if (rest === 'door') return w(2);
    if (rest === 'leaves') return 0.15;
    if (/sign/.test(rest)) return 0.6;
  }
  if (/^stripped_/.test(name)) return +(P.log * MARKUP).toFixed(2);
  for (const [re, price] of IMPORT) if (re.test(name)) return price;
  // stone family: made from cobblestone / stone in the colony workshop
  const c = P.cobblestone;
  const s = P.stone;
  if (/^(cobblestone|mossy_cobblestone|cobbled_deepslate)$/.test(name)) return +(c * MARKUP + (name.startsWith('mossy') ? 0.1 : 0)).toFixed(2);
  if (/^(stone|smooth_stone|andesite|diorite|granite|deepslate|polished_\w+)$/.test(name)) return +(s * MARKUP).toFixed(2);
  if (/(stone_bricks|stone_brick_\w+|cracked_stone_bricks|mossy_stone_bricks)$/.test(name)) return +(s * MARKUP * 1.1).toFixed(2);
  if (/_slab$/.test(name)) return +(c * MARKUP * 0.6).toFixed(2);
  if (/_stairs$/.test(name)) return +(c * MARKUP * 1.5).toFixed(2);
  if (/_wall$/.test(name)) return +(c * MARKUP).toFixed(2);
  if (/^(crafting_table)$/.test(name)) return w(4);
  if (/^chest$/.test(name)) return w(8);
  if (/^ladder$/.test(name)) return 0.25;
  if (/^torch$|^wall_torch$/.test(name)) return 0.6;
  if (/^furnace$/.test(name)) return +(8 * c * MARKUP).toFixed(2);
  return 1; // anything else: a flat import price
}

/** The item that places a block (mirrors bridge itemFor). */
export function itemFor(name) {
  if (name.startsWith('potted_')) return 'flower_pot';
  if (name === 'water_cauldron') return 'cauldron';
  if (name === 'water') return 'water_bucket';
  return name.replace('_wall_banner', '_banner').replace('wall_torch', 'torch').replace('_wall_hanging_sign', '_hanging_sign').replace('_wall_sign', '_sign');
}
