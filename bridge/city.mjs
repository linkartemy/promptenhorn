// City layout: one grid of plots around a central square. Every project is a district
// (its own plaza plus the houses its chats build); districts grow outward and border each other.
import * as DefaultBuildings from './buildings.mjs';
import { rngFrom } from './blueprint.mjs';
import { PLOT, rect } from './terrain.mjs';
import { t, has } from './i18n.mjs';

// The generator module the city is laid out with (the bridge may load another copy, see generators.mjs).
let Buildings = DefaultBuildings;
export function useBuildings(mod) {
  Buildings = mod;
}

// Fallback selection table, used until buildings.mjs exports its own CATALOG.
const DEFAULT_CATALOG = {
  townhouse: { label: 'Old-town house', zones: { core: 6, inner: 4, outer: 1 } },
  church: { label: 'Church', zones: { core: 1, inner: 1, outer: 0.5, rural: 0.4 }, unique: 'district' },
  hotel: { label: 'Grand Hotel', zones: { core: 0.6, inner: 1.2, outer: 0.6 }, unique: 'district' },
  modern: { label: 'Modern house', zones: { inner: 2, outer: 4, rural: 0.5 } },
  chalet: { label: 'Chalet', zones: { inner: 0.5, outer: 3, rural: 6 } },
};

export const catalog = () => Buildings.CATALOG ?? DEFAULT_CATALOG;
export const labelOf = (type) => {
  const key = Buildings.LABEL_KEYS?.[type] ?? `building.${type}`;
  if (has(key)) return t(key);
  return type === 'square' ? 'Main square' : type === 'plaza' ? 'District square' : catalog()[type]?.label ?? Buildings.LABELS?.[type] ?? type;
};

/** World side ('N', 'E', 'S', 'W') of a shore lot that faces the water -> plot turns that put it on the
 * generator's local north (where shore types draw their water side, docs/generator-contract.md §7). */
export const turnsToWater = (side) => ['N', 'E', 'S', 'W'].indexOf(side);

export const ring = ([i, j]) => Math.max(Math.abs(i), Math.abs(j));
export const zoneOf = (cell) => {
  const r = ring(cell);
  return r <= 2 ? 'core' : r <= 4 ? 'inner' : r <= 6 ? 'outer' : 'rural';
};

export const STREETS = {
  core: { main: 'stone_bricks', alts: ['polished_andesite', 'andesite', 'cracked_stone_bricks', 'mossy_stone_bricks'] },
  inner: { main: 'cobblestone', alts: ['stone_bricks', 'andesite', 'mossy_cobblestone'] },
  outer: { main: 'cobblestone', alts: ['gravel', 'andesite', 'coarse_dirt'] },
  rural: { main: 'dirt_path', alts: ['coarse_dirt', 'gravel', 'dirt_path', 'rooted_dirt'] },
};

export const cellKey = ([i, j]) => `${i},${j}`;
export const parseCell = (key) => key.split(',').map(Number);
export const plotRect = (city, [i, j]) => {
  const x0 = city.cx - 10 + i * PLOT;
  const z0 = city.cz - 10 + j * PLOT;
  return rect(x0, z0, x0 + PLOT - 1, z0 + PLOT - 1);
};

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N8 = [...N4, [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * Plaza cell for a new district: walk out from the centre along a golden-angle ray (so districts spread
 * evenly around the old town) to the first free cell that is not crowding the centre or another plaza.
 */
export function districtSeed(state, index, terrain = null) {
  const angle = index * 2.39996323 + 0.6;
  const plazas = Object.values(state.districts).map((d) => d.seed).filter(Boolean);
  for (let r = 2; r < 80; r += 0.35) {
    const cell = [Math.round(Math.cos(angle) * r), Math.round(Math.sin(angle) * r)];
    if (ring(cell) < 2 || state.cells[cellKey(cell)]) continue;
    if (terrain && (terrain.reserved(cell) || !Number.isFinite(terrain.cost(cell)))) continue; // no plaza in the lake or on a cliff
    if (N8.some(([a, b]) => state.cells[cellKey([cell[0] + a, cell[1] + b])] && state.plots[state.cells[cellKey([cell[0] + a, cell[1] + b])]]?.type === 'plaza')) continue;
    if (plazas.some((p) => Math.hypot(p[0] - cell[0], p[1] - cell[1]) < 3.5)) continue;
    return cell;
  }
  return [index * 4 + 4, 0];
}

/**
 * Next cell for a district: a free neighbour of its own cells, close to the city centre and to its plaza.
 * With `terrain` ({ cost(cell) -> extra cost | Infinity, hop(cell) -> 'stairs' | 'bridge' | null,
 * reserved(cell) -> bool }) the cell's earthwork cost counts too, water / cliffs / reserved cells are never
 * picked, and the district may jump over a steep cell (stair lane) or a river (bridge) to buildable land
 * right behind it; the returned cell then carries `via` (the crossed cell), `viaKind` and `from`.
 */
export function nextCell(state, district, terrain = null) {
  const own = district.cells;
  const dist = (c, d) => Math.hypot(c[0] - d[0], c[1] - d[1]);
  const score = (c) => Math.hypot(c[0], c[1]) * 1.0 + dist(c, district.seed) * 0.8;
  const free = (c) => !state.cells[cellKey(c)] && !terrain?.reserved(c);
  const costOf = (c) => (terrain ? terrain.cost(c) : 0);
  let best = null;
  const consider = (c, extra = 0, hop = null) => {
    if (!free(c)) return;
    const k = costOf(c);
    if (!Number.isFinite(k)) return;
    const s = score(c) + k * 1.6 + extra;
    if (!best || s < best.s) best = { c, s, hop };
  };
  const result = () => {
    const c = [...best.c];
    if (best.hop) Object.assign(c, best.hop);
    return c;
  };
  for (const [i, j] of own.map(parseCell))
    for (const [a, b] of N4) {
      const n = [i + a, j + b];
      consider(n);
      if (!terrain || !free(n) || Number.isFinite(costOf(n))) continue;
      const kind = terrain.hop(n);
      if (kind) consider([i + 2 * a, j + 2 * b], kind === 'bridge' ? 6 : 4, { via: n, viaKind: kind, from: [i, j] });
    }
  if (best) return result();
  // Enclosed by other districts: take the free city-edge cell nearest to our plaza.
  for (const key of Object.keys(state.cells)) {
    const [i, j] = parseCell(key);
    for (const [a, b] of N4) {
      const c = [i + a, j + b];
      if (!free(c) || !Number.isFinite(costOf(c))) continue;
      const s = dist(c, district.seed) + costOf(c) * 1.6;
      if (!best || s < best.s) best = { c, s };
    }
  }
  if (best || !terrain) return result(); // (without terrain this is the old rule, unchanged)
  return null;
}

// Building preferences by terrain (used when the generators' CATALOG has no `terrain` weights of its own):
// chalets and huts climb the slopes, farms stay on the flat, the grand hotel and the cafe want the lake.
const TERRAIN_WEIGHTS = {
  slope: { chalet: 2, hut: 2.5, farmhouse: 0.4, townhouse: 0.7, apartment: 0.6, modern: 0.8 },
  stilts: { chalet: 2.5, hut: 3, farmhouse: 0.3, townhouse: 0.4, apartment: 0.3, hotel: 0.5 },
  waterfront: { hotel: 3, cafe: 2.5, modern: 1.4, townhouse: 1.2, farmhouse: 0.5 },
};

/** Weighted building choice for a cell, honouring per-district / per-city uniqueness and avoiding repeats. */
export function pickType(state, district, cell, seed, terrain = null) {
  const rng = rngFrom(`${seed}:type`);
  // terrain: { mode, cls } of the lot plan (null on the old rules).
  const tk = !terrain ? null : terrain.cls === 'shoreline' || terrain.waterSide ? 'waterfront' : terrain.mode === 'stilts' ? 'stilts' : terrain.mode && terrain.mode !== 'level' ? 'slope' : null;
  const zone = zoneOf(cell);
  const cat = catalog();
  const cityCounts = {};
  for (const p of Object.values(state.plots)) cityCounts[p.type] = (cityCounts[p.type] ?? 0) + 1;
  const recent = district.recentTypes ?? [];
  const entries = [];
  for (const [type, info] of Object.entries(cat)) {
    if (!Buildings.BUILDINGS?.[type]) continue;
    // Shore types (boathouse, lido, steamer landing…) stand only on lots that face the water.
    let w = info.kind === 'shore' ? (terrain?.waterSide ? info.zones?.shore ?? 0 : 0) : info.zones?.[zone] ?? 0;
    if (w <= 0) continue;
    if (info.unique === 'district' && district.typeCounts[type]) continue;
    if (info.unique === 'city' && cityCounts[type]) continue;
    if (recent.includes(type)) w *= recent[recent.length - 1] === type ? 0.15 : 0.5;
    if (tk) w *= info.terrain?.[tk] ?? TERRAIN_WEIGHTS[tk][type] ?? 1;
    entries.push([type, w]);
  }
  if (!entries.length) return Object.keys(Buildings.BUILDINGS)[0];
  return rng.weighted(entries);
}
