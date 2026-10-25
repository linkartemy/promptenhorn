// Block colours and render classes for the map renderer.
//
// classify(name, props) -> {
//   color: [r,g,b],
//   td:   top-down handling: 'skip' (invisible, look below), 'blend' (tint the block below,
//         e.g. flowers/crops), 'glass' (tint + is a surface for height), 'water', 'solid',
//   alpha: blend strength for 'blend'/'glass',
//   iso:  isometric sprite: null (not drawn) | 'full' | 'slab' | 'topslab' | 'thin' | 'post' | 'wall' | 'small',
//   occl: true if it hides neighbouring faces in the iso view (full opaque cube),
//   water: true for water-ish blocks, unknown: true if the colour came from the hash fallback }

const DYES = {
  white: [233, 236, 236], orange: [240, 118, 19], magenta: [189, 68, 179], light_blue: [58, 175, 217],
  yellow: [248, 197, 39], lime: [112, 185, 25], pink: [237, 141, 172], gray: [62, 68, 71],
  light_gray: [142, 142, 134], cyan: [21, 137, 145], purple: [121, 42, 172], blue: [53, 57, 157],
  brown: [114, 71, 40], green: [84, 109, 27], red: [160, 39, 34], black: [20, 21, 25],
};
const CONCRETE = {
  white: [207, 213, 214], orange: [224, 97, 0], magenta: [169, 48, 159], light_blue: [35, 137, 198],
  yellow: [241, 175, 21], lime: [94, 168, 24], pink: [213, 101, 142], gray: [54, 57, 61],
  light_gray: [125, 125, 115], cyan: [21, 119, 136], purple: [100, 31, 156], blue: [44, 46, 143],
  brown: [96, 59, 31], green: [73, 91, 36], red: [142, 32, 32], black: [8, 10, 15],
};
const TERRACOTTA = {
  white: [209, 178, 161], orange: [161, 83, 37], magenta: [149, 88, 108], light_blue: [113, 108, 137],
  yellow: [186, 133, 35], lime: [103, 117, 52], pink: [161, 78, 78], gray: [57, 42, 35],
  light_gray: [135, 106, 97], cyan: [86, 91, 91], purple: [118, 70, 86], blue: [74, 59, 91],
  brown: [77, 51, 35], green: [76, 83, 42], red: [143, 61, 46], black: [37, 22, 16],
};
const DYE_RE = /^(white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)_/;

const C = {
  // stone family
  stone: [125, 125, 125], cobblestone: [122, 122, 122], mossy_cobblestone: [110, 118, 94],
  stone_bricks: [122, 121, 122], mossy_stone_bricks: [115, 121, 105], cracked_stone_bricks: [118, 117, 118],
  chiseled_stone_bricks: [120, 119, 120], smooth_stone: [159, 159, 159], andesite: [136, 136, 137],
  polished_andesite: [132, 135, 134], diorite: [189, 188, 189], polished_diorite: [193, 193, 195],
  granite: [149, 103, 86], polished_granite: [154, 107, 89], deepslate: [80, 80, 82],
  cobbled_deepslate: [77, 77, 80], polished_deepslate: [72, 72, 73], deepslate_bricks: [70, 70, 71],
  cracked_deepslate_bricks: [65, 65, 66], deepslate_tiles: [54, 54, 55], cracked_deepslate_tiles: [52, 52, 52],
  chiseled_deepslate: [54, 54, 54], reinforced_deepslate: [80, 82, 78], tuff: [108, 109, 102],
  polished_tuff: [98, 104, 99], tuff_bricks: [98, 103, 95], chiseled_tuff: [89, 94, 87], chiseled_tuff_bricks: [98, 102, 96],
  calcite: [223, 224, 220], dripstone_block: [134, 107, 92], pointed_dripstone: [129, 102, 89],
  quartz_block: [236, 230, 223], smooth_quartz: [236, 230, 223], quartz_bricks: [234, 229, 221],
  quartz_pillar: [235, 230, 224], chiseled_quartz_block: [231, 226, 218],
  sandstone: [216, 203, 155], smooth_sandstone: [223, 214, 170], cut_sandstone: [217, 205, 158], chiseled_sandstone: [216, 202, 154],
  red_sandstone: [181, 98, 31], smooth_red_sandstone: [181, 98, 31], cut_red_sandstone: [189, 101, 32],
  bricks: [150, 97, 83], mud_bricks: [137, 103, 79], packed_mud: [142, 106, 79], mud: [60, 57, 60],
  nether_bricks: [44, 21, 26], red_nether_bricks: [69, 7, 9], blackstone: [42, 36, 41],
  polished_blackstone: [53, 48, 56], polished_blackstone_bricks: [48, 42, 49], gilded_blackstone: [56, 43, 38],
  basalt: [80, 81, 86], smooth_basalt: [72, 72, 78], polished_basalt: [99, 98, 100], end_stone: [219, 222, 158],
  end_stone_bricks: [218, 224, 162], purpur_block: [169, 125, 169], purpur_pillar: [171, 129, 171],
  prismarine: [99, 156, 151], prismarine_bricks: [99, 171, 158], dark_prismarine: [51, 91, 75],
  obsidian: [15, 10, 24], crying_obsidian: [32, 10, 60], bedrock: [85, 85, 85], netherrack: [97, 38, 38],
  // ground
  grass_block: [109, 153, 72], dirt: [134, 96, 67], coarse_dirt: [119, 85, 59], rooted_dirt: [144, 103, 76],
  dirt_path: [158, 128, 70], podzol: [92, 63, 24], mycelium: [111, 99, 105], farmland: [110, 70, 40],
  gravel: [131, 127, 126], sand: [219, 207, 163], red_sand: [190, 102, 33], suspicious_sand: [217, 204, 159],
  suspicious_gravel: [129, 125, 124], clay: [160, 166, 179], moss_block: [89, 109, 45], pale_moss_block: [107, 116, 104],
  snow_block: [249, 254, 254], snow: [249, 254, 254], powder_snow: [248, 253, 253], ice: [145, 183, 253],
  packed_ice: [141, 180, 250], blue_ice: [116, 167, 253], frosted_ice: [140, 180, 250],
  soul_sand: [81, 62, 50], soul_soil: [75, 57, 46], magma_block: [142, 63, 31],
  // liquids
  water: [55, 95, 205], lava: [207, 92, 20], bubble_column: [55, 95, 205],
  // wood
  oak_planks: [162, 130, 78], spruce_planks: [114, 84, 48], birch_planks: [192, 175, 121],
  jungle_planks: [160, 115, 80], acacia_planks: [168, 90, 50], dark_oak_planks: [66, 43, 20],
  mangrove_planks: [117, 54, 48], cherry_planks: [226, 178, 172], bamboo_planks: [193, 173, 80],
  bamboo_mosaic: [190, 170, 78], crimson_planks: [101, 48, 70], warped_planks: [43, 104, 99],
  pale_oak_planks: [227, 217, 213],
  oak_log: [109, 85, 50], spruce_log: [58, 37, 16], birch_log: [216, 215, 210], jungle_log: [85, 67, 25],
  acacia_log: [103, 96, 86], dark_oak_log: [60, 46, 26], mangrove_log: [84, 66, 41], cherry_log: [54, 33, 44],
  pale_oak_log: [87, 77, 75], crimson_stem: [92, 25, 29], warped_stem: [57, 58, 78], bamboo_block: [127, 143, 52],
  stripped_oak_log: [177, 144, 86], stripped_spruce_log: [116, 89, 52], stripped_birch_log: [196, 176, 118],
  stripped_jungle_log: [171, 132, 84], stripped_acacia_log: [174, 92, 59], stripped_dark_oak_log: [72, 56, 36],
  stripped_mangrove_log: [119, 54, 47], stripped_cherry_log: [215, 145, 148], stripped_pale_oak_log: [245, 238, 236],
  // leaves (unbiomed approximations)
  oak_leaves: [62, 112, 38], spruce_leaves: [52, 84, 52], birch_leaves: [98, 136, 58], jungle_leaves: [48, 126, 28],
  acacia_leaves: [70, 118, 30], dark_oak_leaves: [48, 98, 28], mangrove_leaves: [70, 118, 40],
  azalea_leaves: [90, 115, 45], flowering_azalea_leaves: [112, 118, 76], cherry_leaves: [228, 177, 197],
  pale_oak_leaves: [160, 165, 150],
  // metals / minerals
  copper_block: [192, 107, 79], cut_copper: [191, 106, 80], chiseled_copper: [184, 100, 73], copper_grate: [190, 106, 79],
  exposed_copper: [161, 125, 103], exposed_cut_copper: [154, 121, 101], exposed_chiseled_copper: [154, 119, 100], exposed_copper_grate: [160, 124, 102],
  weathered_copper: [108, 153, 110], weathered_cut_copper: [109, 145, 107], weathered_chiseled_copper: [104, 150, 106], weathered_copper_grate: [108, 152, 110],
  oxidized_copper: [82, 162, 132], oxidized_cut_copper: [80, 154, 126], oxidized_chiseled_copper: [74, 158, 128], oxidized_copper_grate: [82, 160, 131],
  iron_block: [220, 220, 220], gold_block: [246, 208, 61], diamond_block: [98, 237, 228], emerald_block: [42, 203, 87],
  lapis_block: [31, 67, 140], redstone_block: [175, 24, 5], coal_block: [16, 15, 15], netherite_block: [66, 61, 63],
  amethyst_block: [133, 97, 191], raw_iron_block: [166, 135, 107], raw_gold_block: [221, 169, 46], raw_copper_block: [154, 105, 79],
  // misc
  glass: [175, 213, 219], tinted_glass: [44, 38, 46], glowstone: [171, 131, 84], sea_lantern: [172, 199, 190],
  shroomlight: [240, 146, 70], ochre_froglight: [250, 245, 206], verdant_froglight: [229, 244, 228], pearlescent_froglight: [245, 240, 239],
  hay_block: [166, 136, 38], bookshelf: [117, 94, 59], chiseled_bookshelf: [110, 88, 55], crafting_table: [120, 73, 42],
  barrel: [134, 100, 58], chest: [160, 110, 40], trapped_chest: [160, 110, 40], ender_chest: [40, 55, 55],
  furnace: [110, 110, 110], blast_furnace: [90, 90, 92], smoker: [100, 90, 80], lectern: [160, 125, 80],
  loom: [140, 115, 90], cartography_table: [100, 80, 60], fletching_table: [190, 170, 120], smithing_table: [60, 60, 70],
  composter: [110, 80, 40], cauldron: [70, 70, 75], anvil: [70, 70, 70], grindstone: [140, 140, 140], stonecutter: [120, 115, 110],
  bell: [250, 210, 60], beehive: [180, 145, 85], bee_nest: [200, 165, 75], target: [225, 175, 160], note_block: [90, 60, 45],
  jukebox: [95, 65, 50], tnt: [200, 60, 50], sponge: [195, 192, 74], wet_sponge: [171, 181, 70], slime_block: [111, 192, 91],
  honey_block: [251, 185, 52], pumpkin: [198, 118, 24], carved_pumpkin: [198, 118, 24], jack_o_lantern: [215, 150, 40],
  melon: [111, 145, 30], cactus: [85, 127, 43], dried_kelp_block: [50, 60, 40], scaffolding: [175, 140, 75],
  bamboo: [93, 144, 19], sugar_cane: [148, 192, 101], lily_pad: [32, 128, 48], vine: [70, 110, 30],
  torch: [250, 200, 80], soul_torch: [110, 200, 210], redstone_torch: [200, 40, 20], lantern: [240, 175, 80],
  soul_lantern: [110, 200, 210], campfire: [170, 110, 50], soul_campfire: [80, 170, 180], chain: [60, 65, 75],
  iron_bars: [110, 112, 112], end_rod: [230, 225, 215], lightning_rod: [192, 107, 79], rail: [125, 110, 90],
  redstone_wire: [150, 0, 0], flower_pot: [120, 65, 50], decorated_pot: [140, 80, 60], ladder: [125, 95, 55],
  cobweb: [228, 233, 234], beacon: [117, 220, 215], conduit: [160, 140, 110], spawner: [30, 50, 70],
  daylight_detector: [130, 115, 95], hopper: [70, 70, 75], dispenser: [110, 110, 110], dropper: [110, 110, 110],
  observer: [100, 100, 100], piston: [150, 130, 100], sticky_piston: [130, 150, 100], lodestone: [140, 140, 145],
  respawn_anchor: [60, 30, 100], crying_obsidian_: [32, 10, 60], enchanting_table: [130, 50, 60],
  brewing_stand: [120, 100, 80], sculk: [12, 30, 36], sculk_sensor: [20, 60, 80], sculk_catalyst: [40, 60, 60],
  mushroom_stem: [203, 196, 185], red_mushroom_block: [200, 46, 45], brown_mushroom_block: [149, 111, 81],
  nether_wart_block: [115, 3, 2], warped_wart_block: [22, 119, 121], hanging_roots: [160, 115, 90],
  // plants / flowers
  short_grass: [100, 150, 60], tall_grass: [100, 150, 60], fern: [90, 140, 60], large_fern: [90, 140, 60],
  dead_bush: [140, 100, 40], bush: [90, 140, 60], firefly_bush: [100, 140, 70], short_dry_grass: [180, 160, 90], tall_dry_grass: [180, 160, 90],
  seagrass: [55, 95, 205], tall_seagrass: [55, 95, 205], kelp: [55, 95, 205], kelp_plant: [55, 95, 205],
  poppy: [237, 48, 44], dandelion: [255, 236, 79], blue_orchid: [47, 162, 168], allium: [190, 140, 230],
  azure_bluet: [220, 230, 240], red_tulip: [230, 50, 40], orange_tulip: [240, 120, 40], white_tulip: [230, 240, 230],
  pink_tulip: [240, 180, 210], oxeye_daisy: [235, 235, 220], cornflower: [70, 100, 200], lily_of_the_valley: [240, 240, 240],
  wither_rose: [30, 30, 20], sunflower: [250, 200, 30], lilac: [200, 150, 200], rose_bush: [200, 40, 50], peony: [230, 180, 220],
  torchflower: [230, 140, 60], pitcher_plant: [100, 140, 200], pink_petals: [245, 180, 210], wildflowers: [240, 220, 120],
  leaf_litter: [140, 100, 50], cactus_flower: [230, 110, 170], open_eyeblossom: [240, 140, 60], closed_eyeblossom: [120, 110, 110],
  spore_blossom: [210, 110, 150], sweet_berry_bush: [60, 100, 50], azalea: [95, 125, 45], flowering_azalea: [125, 120, 80],
  wheat: [200, 180, 80], carrots: [90, 160, 40], potatoes: [100, 160, 50], beetroots: [110, 150, 50],
  melon_stem: [110, 150, 50], pumpkin_stem: [110, 150, 50], nether_wart: [140, 30, 30], cocoa: [140, 90, 40],
  glow_lichen: [110, 130, 120], moss_carpet: [89, 109, 45], pale_moss_carpet: [107, 116, 104], pale_hanging_moss: [107, 116, 104],
  big_dripleaf: [95, 145, 45], small_dripleaf: [95, 145, 45], brown_mushroom: [150, 110, 80], red_mushroom: [200, 46, 45],
};

const AIR = new Set(['air', 'cave_air', 'void_air', 'light', 'structure_void', 'barrier', 'moving_piston']);
const WATERY = new Set(['water', 'bubble_column', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant']);
const PLANTS = new Set([
  'short_grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'bush', 'firefly_bush', 'short_dry_grass', 'tall_dry_grass',
  'vine', 'glow_lichen', 'sculk_vein', 'hanging_roots', 'sweet_berry_bush', 'nether_sprouts', 'crimson_roots', 'warped_roots',
  'cave_vines', 'cave_vines_plant', 'twisting_vines', 'twisting_vines_plant', 'weeping_vines', 'weeping_vines_plant',
  'tripwire', 'cobweb', 'big_dripleaf_stem', 'small_dripleaf', 'pale_hanging_moss', 'resin_clump', 'sugar_cane',
  'brown_mushroom', 'red_mushroom', 'crimson_fungus', 'warped_fungus', 'spore_blossom', 'fire', 'soul_fire',
]);
const FLOWERS = new Set([
  'poppy', 'dandelion', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip',
  'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose', 'sunflower', 'lilac', 'rose_bush', 'peony', 'torchflower',
  'pitcher_plant', 'open_eyeblossom', 'closed_eyeblossom', 'cactus_flower',
]);
const CROPS = new Set(['wheat', 'carrots', 'potatoes', 'beetroots', 'melon_stem', 'pumpkin_stem', 'attached_melon_stem',
  'attached_pumpkin_stem', 'nether_wart', 'torchflower_crop', 'pitcher_crop']);
// Ignored in both views: things stuck to walls or too small to matter.
const IGNORE_RE = /(^|_)(button|lever|sign|banner|tripwire_hook|ladder|item_frame|painting|wall_fan|coral_fan)$|_wall_(sign|hanging_sign|banner)$/;
const TORCH_RE = /(^|_)torch$/;
const SMALL_RE = /(^|_)(lantern|candle|flower_pot|sea_pickle|amethyst_cluster|amethyst_bud|head|skull|turtle_egg|brewing_stand|conduit|frogspawn|sniffer_egg|bell|end_rod|lightning_rod|pointed_dripstone|chain|candle_cake|dragon_egg)$|^potted_|^(small|medium|large)_amethyst_bud$/;
const THIN_RE = /(_carpet|_pressure_plate|^rail|_rail|^redstone_wire|^repeater|^comparator|^lily_pad|^leaf_litter|^pink_petals|^wildflowers|^daylight_detector|_trapdoor|^snow$|^frogspawn|^sculk_vein|^heavy_core)$/;
const SLAB_LIKE_RE = /(_bed|^cake|campfire|^enchanting_table|^stonecutter|^chest|^trapped_chest|^ender_chest|^composter|^lectern|^sculk_sensor|^calibrated_sculk_sensor|^sculk_shrieker|^hopper|^grindstone|^bamboo$)$/;
const POST_RE = /(_fence|_fence_gate|^iron_bars|^bamboo)$/;
const WALL_RE = /_wall$/;
const PANE_RE = /(glass_pane|^iron_bars)$/;
const DOOR_RE = /_door$/;
const LEAVES_RE = /_leaves$/;

function hashColor(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
  h >>>= 0;
  const hue = (h % 360) / 360, sat = 0.35 + ((h >>> 9) % 30) / 100, lig = 0.4 + ((h >>> 17) % 25) / 100;
  const f = (n) => {
    const k = (n + hue * 12) % 12;
    const a = sat * Math.min(lig, 1 - lig);
    return Math.round(255 * (lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

const mix = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] * (1 - t) + b[i] * t));

/** Resolve a colour for a block id (without "minecraft:"), or null. */
export function colorOf(name) {
  if (C[name]) return C[name];
  let n = name.replace(/^waxed_/, '').replace(/^infested_/, '');
  if (C[n]) return C[n];
  // dyed families
  const dm = n.match(DYE_RE);
  if (dm) {
    const dye = dm[1], rest = n.slice(dye.length + 1);
    if (rest === 'concrete') return CONCRETE[dye];
    if (rest === 'concrete_powder') return mix(CONCRETE[dye], [255, 255, 255], 0.15);
    if (rest === 'terracotta') return TERRACOTTA[dye];
    if (rest === 'glazed_terracotta') return mix(CONCRETE[dye], [255, 255, 255], 0.2);
    if (rest === 'wool' || rest === 'carpet' || rest === 'bed' || rest === 'banner' || rest === 'wall_banner'
      || rest === 'candle' || rest === 'shulker_box') return DYES[dye];
    if (rest === 'stained_glass' || rest === 'stained_glass_pane') return mix(DYES[dye], [255, 255, 255], 0.25);
  }
  if (n === 'terracotta') return [152, 94, 67];
  if (n.endsWith('_ore')) return n.includes('deepslate') ? [85, 85, 88] : [128, 126, 124];
  if (n.startsWith('potted_')) return [120, 65, 50];
  if (n === 'glass_pane') return C.glass;
  if (n.endsWith('_wall_torch')) return C[n.replace('_wall_torch', '_torch')] ?? C.torch;
  if (n === 'wall_torch') return C.torch;
  if (n.endsWith('_wood') || n.endsWith('_hyphae')) {
    const log = n.replace(/_wood$/, '_log').replace(/_hyphae$/, '_stem');
    if (C[log]) return C[log];
  }
  // shaped variants -> base material
  const m = n.match(/^(.*?)_(stairs|slab|wall|fence_gate|fence|door|trapdoor|pressure_plate|button|sign|wall_sign|hanging_sign|wall_hanging_sign|grate|bulb)$/);
  if (m) {
    let base = m[1];
    if (base === 'petrified_oak') base = 'oak';
    for (const cand of [base, base + 's', base + '_planks', base + '_block', base.replace(/^cut_/, '') + '_block']) {
      if (C[cand]) return C[cand];
      const dc = cand !== base ? null : colorOf(cand);
      if (dc) return dc;
    }
    if (m[2] === 'door' || m[2] === 'trapdoor') {
      if (base === 'iron') return [200, 200, 200];
      if (base.includes('copper')) return colorOf(base.replace('copper', 'copper_block')) ?? C.copper_block;
    }
  }
  if (n.includes('coral')) return n.startsWith('dead_') ? [130, 123, 119] : [200, 90, 140];
  if (n.endsWith('_mushroom_block')) return [150, 110, 80];
  if (n.endsWith('_candle_cake')) return [240, 225, 220];
  if (n.endsWith('_shulker_box') || n === 'shulker_box') return [140, 100, 140];
  if (LEAVES_RE.test(n)) return C.oak_leaves;
  if (n.endsWith('_log') || n.endsWith('_stem')) return C.oak_log;
  if (n.endsWith('_planks')) return C.oak_planks;
  if (n.endsWith('_sapling') || n.endsWith('_propagule')) return [80, 130, 50];
  if (n.endsWith('_head') || n.endsWith('_skull')) return [90, 90, 90];
  if (n.endsWith('lantern')) return n.includes('soul') ? C.soul_lantern : C.lantern;
  if (n.endsWith('torch')) return C.torch;
  if (n.endsWith('chain')) return C.chain;
  if (n.endsWith('_shelf')) {
    const p = C[n.replace(/_shelf$/, '_planks')];
    if (p) return p;
  }
  if (n.endsWith('_bars')) return C.iron_bars;
  if (n.includes('copper')) return C.copper_block;
  return null;
}

export function classify(name, props) {
  if (AIR.has(name)) return { color: [0, 0, 0], td: 'skip', alpha: 0, iso: null, occl: false, water: false, air: true };
  let color = colorOf(name);
  let unknown = false;
  if (!color) { color = hashColor(name); unknown = true; }
  const waterlogged = props.waterlogged === 'true';
  const base = { color, unknown, alpha: 0, water: false, air: false };

  if (WATERY.has(name)) return { ...base, color: C.water, td: 'water', iso: 'full', occl: true, water: true };
  if (name === 'lava') return { ...base, td: 'solid', iso: 'full', occl: true };
  if (PLANTS.has(name) || name.endsWith('_sapling') || name.endsWith('_propagule') || /coral(_fan)?$/.test(name) && !name.endsWith('_block')) {
    return waterlogged ? { ...base, color: C.water, td: 'water', iso: 'full', occl: true, water: true }
      : { ...base, td: 'skip', iso: null, occl: false };
  }
  if (IGNORE_RE.test(name)) {
    return waterlogged ? { ...base, color: C.water, td: 'water', iso: 'full', occl: true, water: true }
      : { ...base, td: 'skip', iso: null, occl: false };
  }
  if (TORCH_RE.test(name) || name.endsWith('_wall_torch')) return { ...base, td: 'skip', iso: 'small', occl: false };
  if (FLOWERS.has(name)) return { ...base, td: 'blend', alpha: 0.55, iso: 'small', occl: false };
  if (CROPS.has(name)) return { ...base, td: 'blend', alpha: 0.6, iso: 'slab', occl: false };
  if (name === 'pink_petals' || name === 'wildflowers' || name === 'leaf_litter') {
    return { ...base, td: 'blend', alpha: 0.5, iso: 'thin', occl: false };
  }
  if (name === 'snow') {
    const layers = Number(props.layers ?? 1);
    return layers >= 8 ? { ...base, td: 'solid', iso: 'full', occl: true } : { ...base, td: 'solid', iso: layers >= 4 ? 'slab' : 'thin', occl: false };
  }
  if (PANE_RE.test(name)) return { ...base, td: 'glass', alpha: name === 'iron_bars' ? 0.35 : 0.45, iso: 'full', occl: false };
  if (name === 'glass' || name.endsWith('stained_glass') || name === 'tinted_glass') {
    return { ...base, td: 'glass', alpha: name === 'tinted_glass' ? 0.85 : 0.5, iso: 'full', occl: true };
  }
  if (SMALL_RE.test(name)) return { ...base, td: 'solid', iso: 'small', occl: false };
  if (THIN_RE.test(name)) {
    const iso = name.endsWith('_trapdoor') && props.open === 'true' ? 'post' : (name.endsWith('_trapdoor') && props.half === 'top' ? 'topthin' : 'thin');
    return { ...base, td: 'solid', iso, occl: false };
  }
  if (name.endsWith('_slab')) {
    const t = props.type ?? 'bottom';
    if (t === 'double') return { ...base, td: 'solid', iso: 'full', occl: true };
    return { ...base, td: 'solid', iso: t === 'top' ? 'topslab' : 'slab', occl: false };
  }
  if (DOOR_RE.test(name)) return { ...base, td: 'solid', iso: 'full', occl: false };
  if (WALL_RE.test(name)) return { ...base, td: 'solid', iso: 'wall', occl: false };
  if (POST_RE.test(name)) return { ...base, td: 'solid', iso: 'post', occl: false };
  if (SLAB_LIKE_RE.test(name)) return { ...base, td: 'solid', iso: 'slab', occl: false };
  if (name.endsWith('_stairs')) return { ...base, td: 'solid', iso: 'full', occl: false };
  if (LEAVES_RE.test(name)) return { ...base, td: 'solid', iso: 'full', occl: true, leaves: true };
  return { ...base, td: 'solid', iso: 'full', occl: true };
}
