
// ================================================================ town square (city centre, 21x21 incl. street ring)

/** Market stall facing `face` (towards the square), 3x3 with a striped canopy. (x, z) = back-left corner cell. */
function marketStall(bp, rng, x0, z0, face) {
  const [colA, colB] = rng.pick([['red', 'white'], ['green', 'white'], ['blue', 'white'], ['yellow', 'white'], ['orange', 'white']]);
  const goods = ['pumpkin', 'melon', 'cake', 'hay_block[axis=y]', 'potted_red_tulip', 'potted_poppy', 'decorated_pot[facing=south]', 'barrel[facing=up]', 'carved_pumpkin[facing=south]'];
  const toFront = face === 'east' ? [1, 0] : [-1, 0];
  const frontX = face === 'east' ? x0 + 2 : x0;
  const backX = face === 'east' ? x0 : x0 + 2;
  for (let z = z0; z <= z0 + 2; z++) {
    bp.set(frontX, 1, z, z === z0 + 1 ? `spruce_slab[type=top]` : 'barrel[facing=up]');
    bp.set(frontX, 2, z, z === z0 + 1 ? rng.pick(goods.slice(0, 4)) : 'spruce_fence');
    bp.set(frontX, 3, z, 'spruce_fence');
    bp.fill(backX, 1, z, backX, 3, z, z === z0 + 1 ? null : 'spruce_fence');
    for (let x = x0; x <= x0 + 2; x++) bp.set(x, 4, z, `${(x + z) % 2 ? colA : colB}_wool`);
  }
  bp.set(backX, 1, z0 + 1, rng.pick(['chest[facing=' + face + ']', 'barrel[facing=up]']));
  bp.set(x0 + 1, 1, z0 + 1, rng.pick(['hay_block[axis=y]', 'barrel[facing=up]', 'composter[level=7]']));
  bp.set(x0 + 1, 2, z0 + 1, rng.pick(['potted_red_tulip', 'pumpkin', 'melon', 'cake']));
  bp.set(frontX + toFront[0], 1, z0 + 2, rng.pick(['potted_poppy', 'decorated_pot[facing=south]', 'hay_block[axis=y]']));
  bp.set(x0 + 1, 3, z0 + 1, 'lantern[hanging=true]');
}

export function square(rng) {
  return autoMarks(squareBlocks(rng), 'square');
}

function squareBlocks(rng) {
  const bp = new Blueprint();
  const c = 8;
  const r = (x, z) => Math.hypot(x - c, z - c);
  const ringA = rng.pick(['polished_andesite', 'polished_tuff', 'smooth_stone']);
  const accent = rng.pick(['polished_deepslate', 'polished_granite', 'polished_blackstone', 'tuff_bricks']);
  bp.fill(-2, 0, -2, 18, 0, 18, (x, y, z) => {
    const d = r(x, z);
    if (d > 4.6 && d <= 6.2) return ringA;
    if (Math.abs(d - 9) < 0.55) return accent;
    if ((x === c || z === c) && d > 6) return ringA;
    if (Math.abs(x - c) === Math.abs(z - c) && d > 6.2 && d < 12) return accent;
    return rng.weighted([['stone_bricks', 5], ['cobblestone', 1], ['andesite', 1], ['mossy_stone_bricks', 0.3]]);
  });
  // Fountain: round basin, column with Swiss flags and a copper figure, four spouts.
  for (let x = c - 5; x <= c + 5; x++)
    for (let z = c - 5; z <= c + 5; z++) {
      const d = r(x, z);
      if (d <= 3.6) {
        bp.set(x, -1, z, 'stone_bricks');
        bp.set(x, 0, z, 'water');
      } else if (d <= 4.6) {
        bp.set(x, 0, z, 'stone_bricks');
        bp.set(x, 1, z, (x - c) * (z - c) === 0 || Math.abs(x - c) === Math.abs(z - c) ? 'chiseled_stone_bricks' : 'polished_andesite');
      }
    }
  bp.set(c, 0, c, 'chiseled_stone_bricks');
  bp.set(c, 1, c, 'chiseled_stone_bricks');
  bp.fill(c, 2, c, c, 5, c, 'quartz_pillar[axis=y]');
  bp.set(c, 6, c, 'chiseled_quartz_block');
  for (const f of Object.keys(DIR)) {
    bp.set(c + DIR[f][0], 6, c + DIR[f][1], `red_wall_banner[facing=${f}]${SWISS_FLAG}`);
    bp.set(c + DIR[f][0], 3, c + DIR[f][1], `lightning_rod[facing=${f}]`);
    bp.set(c + 2 * DIR[f][0], 3, c + 2 * DIR[f][1], 'water');
  }
  bp.set(c, 7, c, `waxed_copper_golem_statue[copper_golem_pose=${rng.pick(['standing', 'star'])},facing=south]`);
  // Benches facing the fountain.
  bench(bp, c - 1, c - 7, 'north', 3, 'spruce');
  bench(bp, c - 1, c + 7, 'south', 3, 'spruce');
  bench(bp, c - 7, c - 1, 'west', 3, 'spruce');
  bench(bp, c + 7, c - 1, 'east', 3, 'spruce');
  // Lamps first, then corner lindens in planters.
  for (const [x, z] of [[4, 4], [12, 4], [4, 12], [12, 12]]) lamp(bp, x, z, 3, 'double');
  for (const [x, z] of [[0, 0], [16, 0], [0, 16], [16, 16]]) {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) bp.set(x + dx, 0, z + dz, 'grass_block');
    for (const [px, pz] of perimeter(x - 2, z - 2, x + 2, z + 2)) bp.setIfEmpty(px, 1, pz, 'stone_brick_slab[type=bottom]');
    broadTree(bp, x, z, 5, 2, rng.pick(['oak', 'oak', 'birch']), -2, 18);
    for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1], [0, 1], [1, 0], [-1, 0], [0, -1]]) bp.setIfEmpty(x + dx, 1, z + dz, rng.pick(['red_tulip', 'white_tulip', 'poppy']));
  }
  // Market stalls and flags.
  marketStall(bp, rng, -1, 4, 'east');
  marketStall(bp, rng, 15, 10, 'west');
  flagPole(bp, c, -1, 8);
  // Town bell on a pedestal at the south edge: the meeting point.
  bp.set(c, 1, 17, 'chiseled_stone_bricks');
  bp.set(c, 2, 17, 'bell[attachment=floor,facing=south]');
  const [b1, d1] = rng.pick(CANTONS);
  const [b2, d2] = rng.pick(CANTONS);
  flagPole(bp, c - 3, -1, 6, `${b1}_banner[rotation=0]${d1}`);
  flagPole(bp, c + 3, -1, 6, `${b2}_banner[rotation=0]${d2}`);
  return bp;
}

// ================================================================ district plaza (cosy village square)

export function plaza(rng) {
  return autoMarks(plazaBlocks(rng), 'plaza');
}

function plazaBlocks(rng) {
  const bp = new Blueprint();
  const c = 8;
  const cob = () => rng.weighted([['cobblestone', 3], ['mossy_cobblestone', 1], ['stone_bricks', 1], ['andesite', 0.6]]);
  for (let x = -2; x <= 18; x++)
    for (let z = -2; z <= 18; z++) {
      const d = Math.max(Math.abs(x - c), Math.abs(z - c));
      const paved = (d <= 6 && Math.hypot(x - c, z - c) <= 7.9) || Math.abs(x - c) <= 1 || Math.abs(z - c) <= 1;
      bp.set(x, 0, z, paved ? cob() : 'grass_block');
    }
  // Village fountain: stone (or log) trough with a column, spout and geraniums.
  const wooden = rng.chance(0.35);
  for (const [x, z] of perimeter(6, 7, 10, 10)) bp.set(x, 1, z, wooden ? `stripped_spruce_log[axis=${z === 7 || z === 10 ? 'x' : 'z'}]` : rng.pick(['stone_bricks', 'stone_bricks', 'mossy_stone_bricks']));
  bp.fill(6, 0, 7, 10, 0, 10, 'stone_bricks');
  bp.fill(7, 1, 8, 9, 1, 9, 'water');
  bp.set(c, 2, 7, 'chiseled_stone_bricks');
  bp.set(c, 3, 7, wooden ? 'spruce_log[axis=y]' : 'stone_bricks');
  bp.set(c, 4, 7, 'chiseled_stone_bricks');
  bp.set(c, 5, 7, rng.pick(GERANIUMS));
  bp.set(c, 3, 8, 'lightning_rod[facing=south]');
  bp.set(c, 4, 6, `red_wall_banner[facing=north]${SWISS_FLAG}`);
  for (const x of [6, 10]) bp.set(x, 2, 10, rng.pick(GERANIUMS));
  // Linden with a round bench.
  const tx = rng.pick([3, 13]);
  const tz = 3;
  broadTree(bp, tx, tz, 5, 3, 'oak', -2, 18);
  for (const f of Object.keys(DIR)) bp.set(tx + DIR[f][0], 1, tz + DIR[f][1], `spruce_stairs[facing=${OPP[f]},half=bottom]`);
  for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) bp.set(tx + dx, 1, tz + dz, 'spruce_slab[type=bottom]');
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) bp.set(tx + dx, 0, tz + dz, 'rooted_dirt');
  // Benches, lamps, flag.
  bench(bp, c - 1, 13, 'south', 3, 'spruce');
  lamp(bp, 4, 12, 3);
  lamp(bp, 12, 12, 3);
  flagPole(bp, 16 - tx, 2, 7);
  // Notice board.
  bp.fill(11, 0, 15, 15, 0, 16, 'cobblestone');
  bp.fill(12, 1, 15, 12, 3, 15, 'spruce_log[axis=y]');
  bp.fill(14, 1, 15, 14, 3, 15, 'spruce_log[axis=y]');
  bp.fill(13, 2, 15, 13, 3, 15, 'spruce_planks');
  for (let x = 11; x <= 15; x++) {
    bp.set(x, 4, 15, 'spruce_slab[type=bottom]');
    bp.set(x, 4, 16, 'spruce_stairs[facing=north,half=bottom]');
  }
  bp.set(11, 3, 15, 'bell[attachment=ceiling,facing=south]');
  const notes = [['GEMEINDE', 'Markt: Samstag', '8 - 12 Uhr', ''], ['Turnverein', 'Schwingfest', 'Sonntag 14 Uhr', ''], ['Chor', 'Probe Mittwoch', '', ''], ['Velo', 'zu verkaufen', '', '']];
  bp.set(12, 2, 16, `spruce_wall_sign[facing=south]${signData(rng.pick(notes))}`);
  bp.set(13, 3, 16, `spruce_wall_sign[facing=south]${signData(notes[0])}`);
  bp.set(14, 2, 16, `spruce_wall_sign[facing=south]${signData(rng.pick(notes.slice(1)))}`);
  // Planters with geraniums, a spruce, wild flowers on the grass.
  for (const [x, z] of [[4, 4], [12, 4]]) if (!bp.get(x, 1, z)) {
    bp.set(x, 1, z, 'barrel[facing=up]');
    bp.set(x, 2, z, rng.pick(GERANIUMS));
  }
  spruce(bp, 1, 15, rng.int(7, 9), 2, -2, 18);
  for (let x = -2; x <= 18; x++)
    for (let z = -2; z <= 18; z++) if (/grass_block/.test(bp.get(x, 0, z)) && !bp.get(x, 1, z) && rng.chance(0.22)) bp.set(x, 1, z, rng.pick(MEADOW));
  return bp;
}
