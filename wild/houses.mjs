// Houses the colony builds. "cabin" is a small Swiss colonist's cabin designed for survival hand-building:
// 7×9 footprint, whitewashed calcite ground floor, timber upper band, an attic reached by a ladder (so the
// builder can stand on the ceiling to lay the roof), a waxed copper ridge and terracotta flower boxes.
// Other types come from the city generators (bridge/buildings.mjs, read-only) and need a 21×21 plot.
import { Blueprint, rngFrom } from '../bridge/blueprint.mjs';

export const PLOT_SIZE = { cabin: { w: 11, d: 13 } };

export function cabin(seed) {
  const rng = rngFrom(`${seed}:cabin`);
  const bp = new Blueprint();
  const O = 2; // offset so the roof overhang stays at x, z >= 0
  const wood = rng.pick(['spruce', 'spruce', 'dark_oak']);
  const roof = rng.pick(['spruce', 'dark_oak', 'spruce']);
  const flower = rng.pick(['red_tulip', 'cornflower', 'poppy', 'oxeye_daisy']);
  const S = (x, y, z, b) => bp.set(x + O, y, z + O, b);
  const F = (x1, y1, z1, x2, y2, z2, b) => bp.fill(x1 + O, y1, z1 + O, x2 + O, y2, z2 + O, b);
  // floor: cobblestone rim, planks inside
  F(0, 0, 0, 6, 0, 8, 'cobblestone');
  F(1, 0, 1, 5, 0, 7, `${wood}_planks`);
  // walls: calcite masonry (y 1-2), timber band (y 3), log corners
  for (let y = 1; y <= 3; y++)
    for (let x = 0; x <= 6; x++)
      for (let z = 0; z <= 8; z++) {
        if (x !== 0 && x !== 6 && z !== 0 && z !== 8) continue;
        const corner = (x === 0 || x === 6) && (z === 0 || z === 8);
        S(x, y, z, corner ? `${wood}_log[axis=y]` : y <= 2 ? 'calcite' : `${wood}_planks`);
      }
  // ceiling ring of beams and plank attic floor (ladder hole at x=1, z=7)
  for (let x = 0; x <= 6; x++)
    for (let z = 0; z <= 8; z++) {
      const edgeX = z === 0 || z === 8;
      const edgeZ = x === 0 || x === 6;
      if (edgeX || edgeZ) S(x, 4, z, `stripped_${wood}_log[axis=${edgeX ? 'x' : 'z'}]`);
      else S(x, 4, z, `${wood}_planks`);
    }
  // gable walls
  for (const z of [0, 8]) {
    F(1, 5, z, 5, 5, z, `${wood}_planks`);
    F(2, 6, z, 4, 6, z, `${wood}_planks`);
    S(3, 7, z, `${wood}_planks`);
  }
  // roof: stairs from the eaves (overhang) up to a copper ridge
  const rows = [[-1, 4, 'east'], [0, 5, 'east'], [1, 6, 'east'], [2, 7, 'east'], [7, 4, 'west'], [6, 5, 'west'], [5, 6, 'west'], [4, 7, 'west']];
  for (const [x, y, facing] of rows) for (let z = -1; z <= 9; z++) S(x, y, z, `${roof}_stairs[facing=${facing},half=bottom,shape=straight]`);
  for (let z = -1; z <= 9; z++) S(3, 8, z, 'waxed_cut_copper_slab[type=bottom]');
  // openings: door (north), windows
  S(3, 1, 0, `${wood}_door[facing=north,half=lower,hinge=left,open=false]`);
  S(3, 2, 0, `${wood}_door[facing=north,half=upper,hinge=left,open=false]`);
  for (const [x, z] of [[1, 0], [5, 0], [3, 8], [0, 3], [0, 5], [6, 3], [6, 5]]) S(x, 2, z, 'glass_pane');
  S(3, 6, 0, 'glass_pane');
  S(3, 6, 8, 'glass_pane');
  // ladder to the attic
  for (let y = 1; y <= 4; y++) S(1, y, 7, 'ladder[facing=north]');
  // furniture
  S(5, 1, 6, 'red_bed[facing=south,part=head]');
  S(5, 1, 5, 'red_bed[facing=south,part=foot]');
  S(5, 1, 7, 'chest[facing=west]');
  S(1, 1, 1, 'lantern[hanging=false]');
  S(5, 1, 1, 'crafting_table');
  // flower boxes and a lantern post at the door
  for (const x of [1, 5]) {
    S(x, 1, -1, 'white_terracotta');
    S(x, 2, -1, flower);
  }
  S(4, 0, -1, 'dirt_path');
  S(3, 0, -1, 'dirt_path');
  S(3, 0, -2, 'dirt_path');
  return bp;
}

/** Build list for a project in plot-local coordinates (y=0 = ground layer). */
export function projectList(type, seed, generate) {
  if (type === 'cabin') {
    // the ladder goes in right after the ceiling: the builder climbs it to lay the roof from the attic
    const list = cabin(seed).toBuildList({ turns: 0, size: 13, offset: 0 });
    const ladder = list.filter((b) => b.block.includes('ladder'));
    const rest = list.filter((b) => !b.block.includes('ladder'));
    const at = rest.findIndex((b) => b.y >= 5);
    rest.splice(at < 0 ? rest.length : at, 0, ...ladder);
    return rest;
  }
  return generate(type, seed).toBuildList({ turns: 0, size: 21, offset: 2, clipMin: 0, clipMax: 20 });
}
