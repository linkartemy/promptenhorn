// Generator markers (docs/generator-contract.md §4, §6) in world coordinates: door, lectern_spot,
// pet_spot, sign_spot, seat, bed, workstation, bell, clock_spot, light, painting_spot, pasture.
// Markers are a side channel of the blueprint (not in the block list or its hash), so they are taken
// from the same generator version, seed, stage and rotation the plot was built with. Plots whose
// generator version has no markers (older archives) get null: callers fall back to plotmeta.mjs.
const cache = new Map(); // `${key}:${bp}:${stage}` -> markers | null

function blueprintOf(B, rngFrom, plot) {
  if (plot.type === 'square') return B.square?.(rngFrom(plot.seed));
  if (plot.type === 'plaza') return B.plaza?.(rngFrom(plot.seed));
  if (!B.BUILDINGS?.[plot.type] || !B.generate) return null;
  const supported = Number(B.STAGES?.[plot.type]) || 1;
  // Same options as the build list (Generators.listWith): the stage, and the terrain variant of adaptive plots.
  const terrain = plot.terrain && B.TERRAIN_VARIANTS?.[plot.type]?.includes?.(plot.terrain.mode) ? { terrain: { ...plot.terrain, turns: plot.turns } } : {};
  return B.generate(plot.type, plot.seed, { stage: Math.min(plot.stage ?? 2, supported), ...terrain });
}

/** World-coordinate markers of a plot, or null when its generators have none. */
export async function markersOf(ctx, plot) {
  if (!plot || plot.type === 'park') return null;
  const k = `${plot.key}:${plot.bp}:${plot.stage}`;
  if (cache.has(k)) return cache.get(k);
  let out = null;
  try {
    const mod = plot.gen === ctx.gens.current ? ctx.gens.currentModule : await ctx.gens.load(plot.gen);
    const bp = mod && blueprintOf(mod.B, mod.rngFrom, plot);
    if (bp?.toMarkerList) {
      out = bp.toMarkerList({ turns: plot.turns, size: ctx.PLOT, offset: 2, clipMin: 0, clipMax: ctx.PLOT - 1 }).map((m) => ({ ...m, x: plot.x0 + m.x, y: plot.y + m.y, z: plot.z0 + m.z }));
    }
  } catch (err) {
    ctx.log(`markers of ${plot.key}: ${err.message}`);
  }
  if (cache.size > 2000) cache.clear();
  cache.set(k, out);
  return out;
}

/** Markers of one kind (empty list when there are none). */
export async function markersOfKind(ctx, plot, kind) {
  return ((await markersOf(ctx, plot)) ?? []).filter((m) => m.kind === kind);
}

export const YAW = { south: 0, west: 90, north: 180, east: -90 };
export const DIRS = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };

/**
 * NoAI mobs have no gravity: when a renovation or a new terrace changes the ground under them they
 * would hang in the air (or stand inside a block). Every mob placed with the `alps_grounded` tag is
 * re-snapped by this sweep: one block down while the block under its feet is replaceable (air, grass,
 * flowers), one block up while it stands inside a solid block. Cheap: four commands for all of them.
 */
export const groundSweep = () => [
  'execute as @e[tag=alps_grounded] at @s if block ~ ~-0.3 ~ #minecraft:replaceable unless block ~ ~-0.3 ~ minecraft:water run tp @s ~ ~-1 ~',
  'execute as @e[tag=alps_grounded] at @s if block ~ ~-0.3 ~ #minecraft:replaceable unless block ~ ~-0.3 ~ minecraft:water run tp @s ~ ~-1 ~',
  'execute as @e[tag=alps_grounded] at @s unless block ~ ~0.2 ~ #minecraft:replaceable unless block ~ ~0.2 ~ #minecraft:wool_carpets run tp @s ~ ~1 ~',
  'execute as @e[type=#minecraft:aquatic,tag=alps_fish] at @s unless block ~ ~ ~ minecraft:water run kill @s',
];
